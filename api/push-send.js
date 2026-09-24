/* Único punto de envío de Web Push. Todo push sale por acá para que siempre pase por la
   protección SSRF: el endpoint lo elige el cliente al suscribirse, así que el servidor no
   puede conectarse a cualquier host que figure en la tabla subscriptions.            */
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';
import webpush from 'web-push';
import { deleteSubscription } from './database.js';

export const PUSH_TIMEOUT_MS = 10000;

function isPrivateV4(a, b) {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a >= 224) return true;
  return false;
}

// '::ffff:7f00:1' → [0,0,0,0,0,0xffff,0x7f00,1]. Acepta la cola en notación IPv4.
function ipv6Words(v) {
  let s = v;
  const tail = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (tail) {
    const [, a, b, c, d] = tail.map(Number);
    s = s.slice(0, tail.index) + ((a << 8) | b).toString(16) + ':' + ((c << 8) | d).toString(16);
  }
  const [head, rest] = s.split('::');
  const h = head ? head.split(':') : [];
  const r = rest ? rest.split(':') : [];
  const fill = s.includes('::') ? Array(8 - h.length - r.length).fill('0') : [];
  return [...h, ...fill, ...r].map(x => parseInt(x, 16));
}

export function isPrivateAddr(ip) {
  const v = String(ip).toLowerCase().replace(/^\[|\]$/g, '').replace(/%.*$/, '');
  const kind = net.isIP(v);
  if (kind === 4) {
    const [a, b] = v.split('.').map(Number);
    return isPrivateV4(a, b);
  }
  if (kind !== 6) return false;
  const w = ipv6Words(v);
  const v4 = (hi) => isPrivateV4(hi >> 8, hi & 0xff);
  const zero = (from, to) => w.slice(from, to).every(x => x === 0);
  if (zero(0, 7) && w[7] <= 1) return true;                              // :: y ::1
  if (zero(0, 5) && w[5] === 0xffff) return v4(w[6]);                    // ::ffff:a.b.c.d (mapped)
  if (zero(0, 6)) return v4(w[6]);                                       // ::a.b.c.d (compatible)
  if (w[0] === 0x64 && w[1] === 0xff9b && zero(2, 6)) return v4(w[6]);   // NAT64
  if (w[0] === 0x2002) return v4(w[1]);                                  // 6to4
  if ((w[0] & 0xffc0) === 0xfe80) return true;                           // link-local
  if ((w[0] & 0xfe00) === 0xfc00) return true;                           // ULA
  if ((w[0] & 0xff00) === 0xff00) return true;                           // multicast
  return false;
}

// Corre en cada conexión (después de resolver DNS), así también frena DNS rebinding.
export function guardedLookup(hostname, options, cb) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return cb(err);
    const list = Array.isArray(address) ? address : [{ address, family }];
    if (list.some(a => isPrivateAddr(a.address))) {
      return cb(Object.assign(new Error('refusing to connect to a private address: ' + hostname), { code: 'EPUSHBLOCKED' }));
    }
    cb(null, address, family);
  });
}
export const PUSH_AGENT = new https.Agent({ lookup: guardedLookup, keepAlive: false });

export const MAX_ENDPOINT_LENGTH = 2048;

// Servicios de push de los navegadores. 'host' = exacto; '*.dominio' = cualquier subdominio.
// PUSH_HOST_ALLOWLIST (separado por comas, mismo formato) agrega entradas, no reemplaza.
const DEFAULT_PUSH_HOSTS = [
  'fcm.googleapis.com',               // Chrome, Edge Android, Opera, Samsung
  'android.googleapis.com',           // FCM legacy
  'updates.push.services.mozilla.com',
  '*.push.services.mozilla.com',
  '*.notify.windows.com',             // WNS (Edge en Windows)
  'web.push.apple.com',               // Safari / PWA en iOS
  '*.push.apple.com'
];
const PUSH_HOSTS = [...DEFAULT_PUSH_HOSTS, ...String(process.env.PUSH_HOST_ALLOWLIST || '').split(',')]
  .map(h => h.trim().toLowerCase().replace(/\.$/, ''))
  .filter(Boolean);

export function isAllowedPushHost(hostname) {
  const host = String(hostname).toLowerCase().replace(/\.$/, '');
  return PUSH_HOSTS.some(entry => entry.startsWith('*.')
    ? host.endsWith(entry.slice(1)) && host.length > entry.length - 1
    : host === entry);
}

export function pushEndpointError(raw) {
  const str = String(raw || '');
  if (str.length > MAX_ENDPOINT_LENGTH) return 'endpoint is too long';
  let u;
  try { u = new URL(str); } catch { return 'endpoint is not a valid URL'; }
  if (u.protocol !== 'https:') return 'endpoint must be an https:// URL';
  if (u.username || u.password) return 'endpoint must not carry credentials';
  if (u.port && u.port !== '443') return 'endpoint must use the default https port';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^[0-9.]+$/.test(host) || host.includes(':')) {
    if (isPrivateAddr(host)) return 'endpoint must not point at a private address';
  }
  if (!isAllowedPushHost(host)) return 'endpoint host is not a known push service';
  return null;
}

/**
 * Envía un push a una suscripción guardada ({ endpoint, keys }; keys puede venir como JSON).
 * Rechaza sin abrir conexión si el endpoint no pasa pushEndpointError (IP literal privada o
 * host fuera de la allowlist): el agente solo ve hostnames que pasan por DNS, y net.connect
 * no llama a lookup con una IP literal. Las suscripciones rechazadas no se borran: un error
 * en PUSH_HOST_ALLOWLIST no debe vaciar la tabla.
 * Si el servicio responde 404/410 borra la suscripción y relanza el error igual.
 */
export async function sendPushToSubscription(sub, body) {
  const bad = pushEndpointError(sub.endpoint);
  if (bad) throw Object.assign(new Error(bad), { code: 'EPUSHBLOCKED' });
  const keys = typeof sub.keys === 'string' ? JSON.parse(sub.keys) : sub.keys;
  try {
    return await webpush.sendNotification({ endpoint: sub.endpoint, keys }, body,
      { urgency: 'high', timeout: PUSH_TIMEOUT_MS, agent: PUSH_AGENT });
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 410) deleteSubscription(sub.endpoint);
    throw e;
  }
}
