// Protección SSRF del envío de Web Push: helper único (push-send.js), bloqueo sin conexión
// de endpoints privados, scheduler que no se corta por un socio con endpoints malos.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-push-send-'));
process.env.DATA_DIR = dataDir;
// Se lee al cargar push-send.js: tiene que estar antes del import.
process.env.PUSH_HOST_ALLOWLIST = ' push.gym.test , *.extra.test ';

const db = await import('./database.js');
const { isPrivateAddr, isAllowedPushHost, pushEndpointError, sendPushToSubscription, PUSH_AGENT, PUSH_TIMEOUT_MS } = await import('./push-send.js');
const { runSchedulerTick } = await import('./scheduler.js');
db.initDatabase();

after(() => {
  db.closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

// Claves reales: web-push cifra el payload antes de conectar, con claves inválidas fallaría antes.
const keys = {
  p256dh: crypto.createECDH('prime256v1').generateKeys().toString('base64url'),
  auth: crypto.randomBytes(16).toString('base64url')
};
const PUBLIC_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/lauyim-test';
const PRIVATE_ENDPOINTS = [
  'https://127.0.0.1/push',
  'https://10.0.0.5/push',
  'https://192.168.1.10/push',
  'https://169.254.169.254/latest/meta-data',
  'https://[::1]/push',
  'https://[::ffff:127.0.0.1]/push'
];

// Servidor local que cuenta conexiones TCP entrantes (IPv4 e IPv6).
async function countingServer() {
  const server = net.createServer(sock => { server.hits++; sock.destroy(); });
  server.hits = 0;
  await new Promise(resolve => server.listen({ port: 0, host: '::', ipv6Only: false }, resolve));
  return server;
}

test('isPrivateAddr cubre loopback, privadas, link-local, metadatos e IPv6 mapeadas', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.0.1', '169.254.169.254', '0.0.0.0',
    '100.64.0.1', '::', '::1', 'fe80::1', 'fd00::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe',
    '::7f00:1', '64:ff9b::a00:1', '2002:c0a8:101::1', '[::1]', 'fe80::1%eth0']) {
    assert.equal(isPrivateAddr(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '142.250.0.1', '172.32.0.1', '2607:f8b0::1', '::ffff:8.8.8.8', 'fcm.googleapis.com']) {
    assert.equal(isPrivateAddr(ip), false, ip);
  }
});

test('pushEndpointError rechaza IPs privadas en cualquier notación que normalice URL', () => {
  for (const ep of [...PRIVATE_ENDPOINTS, 'https://2130706433/', 'https://0x7f.1/', 'https://[::7f00:1]/']) {
    assert.equal(pushEndpointError(ep), 'endpoint must not point at a private address', ep);
  }
  assert.equal(pushEndpointError('http://fcm.googleapis.com/x'), 'endpoint must be an https:// URL');
  assert.equal(pushEndpointError(PUBLIC_ENDPOINT), null);
});

test('allowlist: solo servicios de push conocidos, https en 443 y largo acotado', () => {
  for (const ep of [
    PUBLIC_ENDPOINT,
    'https://FCM.googleapis.com./fcm/send/x',
    'https://android.googleapis.com/gcm/send/x',
    'https://updates.push.services.mozilla.com/wpush/v2/x',
    'https://wns2-by3p.notify.windows.com/w/?token=x',
    'https://web.push.apple.com/x',
    'https://api.push.apple.com/x',
    'https://fcm.googleapis.com:443/x',
    'https://push.gym.test/x',       // PUSH_HOST_ALLOWLIST exacto
    'https://a.b.extra.test/x'       // PUSH_HOST_ALLOWLIST comodín
  ]) assert.equal(pushEndpointError(ep), null, ep);

  const notKnown = 'endpoint host is not a known push service';
  for (const ep of [
    'https://example.com/x',
    'https://localhost/x',
    'https://8.8.8.8/x',
    'https://fcm.googleapis.com.evil.com/x',
    'https://evilfcm.googleapis.com/x',
    'https://notify.windows.com.attacker.net/x',
    'https://evilnotify.windows.com/x',
    'https://sub.push.gym.test/x',   // entrada exacta no habilita subdominios
    'https://extra.test/x'           // el comodín no incluye el dominio base
  ]) assert.equal(pushEndpointError(ep), notKnown, ep);

  assert.equal(pushEndpointError('https://fcm.googleapis.com:8443/x'), 'endpoint must use the default https port');
  assert.equal(pushEndpointError('https://fcm.googleapis.com/' + 'a'.repeat(2048)), 'endpoint is too long');
  assert.equal(isAllowedPushHost('.notify.windows.com'), false);
});

test('endpoint con IP privada literal: no abre ningún socket', async (t) => {
  const connect = t.mock.method(net.Socket.prototype, 'connect');
  for (const endpoint of PRIVATE_ENDPOINTS) {
    await assert.rejects(sendPushToSubscription({ endpoint, keys }, '{}'), { code: 'EPUSHBLOCKED' }, endpoint);
  }
  assert.equal(connect.mock.callCount(), 0);
});

// Por qué hace falta la validación previa: con una IP literal, net.connect no llama a lookup,
// así que PUSH_AGENT solo no alcanza.
test('PUSH_AGENT solo no frena una IP literal (motivo del chequeo previo)', async () => {
  const server = await countingServer();
  const { port } = server.address();
  await new Promise(resolve => {
    const req = https.request({ hostname: '127.0.0.1', port, agent: PUSH_AGENT }, () => {});
    req.on('error', () => resolve());
    req.end();
  });
  assert.equal(server.hits, 1);
  server.close();
});

test('hostname fuera de la allowlist: rechazado sin resolver ni conectar', async (t) => {
  const connect = t.mock.method(net.Socket.prototype, 'connect');
  await assert.rejects(sendPushToSubscription({ endpoint: 'https://localhost/push', keys }, '{}'), { code: 'EPUSHBLOCKED' });
  assert.equal(connect.mock.callCount(), 0);
});

// Segunda capa: si un host permitido resolviera a una IP privada (DNS rebinding o una entrada
// mal puesta en PUSH_HOST_ALLOWLIST), el agente corta al resolver.
test('hostname que resuelve a loopback: PUSH_AGENT lo corta al resolver DNS, sin conexión', async () => {
  const server = await countingServer();
  const { port } = server.address();
  const err = await new Promise(resolve => {
    const req = https.request({ hostname: 'localhost', port, agent: PUSH_AGENT }, () => resolve(null));
    req.on('error', resolve);
    req.end();
  });
  assert.equal(err?.code, 'EPUSHBLOCKED');
  assert.equal(server.hits, 0);
  server.close();
});

test('endpoint público: se envía con PUSH_AGENT; 410 borra la suscripción', async (t) => {
  const send = t.mock.method(webpush, 'sendNotification', async () => ({ statusCode: 201 }));
  await sendPushToSubscription({ endpoint: PUBLIC_ENDPOINT, keys: JSON.stringify(keys) }, '{"a":1}');
  assert.equal(send.mock.callCount(), 1);
  const [sub, body, opts] = send.mock.calls[0].arguments;
  assert.deepEqual(sub, { endpoint: PUBLIC_ENDPOINT, keys });
  assert.equal(body, '{"a":1}');
  assert.equal(opts.agent, PUSH_AGENT);
  assert.equal(opts.urgency, 'high');
  assert.equal(opts.timeout, PUSH_TIMEOUT_MS);

  db.createUser({ id: 'gone', name: 'Gone', created: Date.now() });
  db.createSubscription({ userId: 'gone', endpoint: PUBLIC_ENDPOINT + '/gone', keys, created: Date.now() });
  send.mock.mockImplementation(async () => { throw Object.assign(new Error('Gone'), { statusCode: 410 }); });
  await assert.rejects(sendPushToSubscription({ endpoint: PUBLIC_ENDPOINT + '/gone', keys }, '{}'), { statusCode: 410 });
  assert.equal(db.getSubscriptionsByUserId('gone').length, 0);
});

test('tick del scheduler: endpoints privados no conectan y el resto de los socios recibe', async (t) => {
  const today = new Date().toISOString().slice(0, 10);
  const conn = db.getDatabase();
  const addMember = (id, endpoints) => {
    db.createUser({ id, name: id, created: Date.now() });
    conn.prepare(`INSERT INTO reminder_settings (user_id, "on", time, tz, fee_on, fee_interval, fee_date)
      VALUES (?, 0, NULL, 'UTC', 1, 'monthly', ?)`).run(id, today);
    for (const endpoint of endpoints) db.createSubscription({ userId: id, endpoint, keys, created: Date.now() });
  };
  // El socio malo va primero: si su envío rompiera el tick, el bueno no recibiría.
  addMember('bad', [...PRIVATE_ENDPOINTS, 'https://attacker.example/push']);
  addMember('good', [PUBLIC_ENDPOINT]);

  const connect = t.mock.method(net.Socket.prototype, 'connect');
  const sent = [];
  t.mock.method(webpush, 'sendNotification', async (sub, _body, opts) => {
    assert.equal(opts.agent, PUSH_AGENT);
    sent.push(sub.endpoint);
    return { statusCode: 201 };
  });
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});

  runSchedulerTick();
  const lastFee = id => conn.prepare('SELECT last_fee_reminder_sent_date d FROM users WHERE id = ?').get(id).d;
  for (let i = 0; i < 100 && lastFee('good') !== today; i++) await new Promise(r => setTimeout(r, 20));

  assert.equal(lastFee('good'), today);
  assert.equal(lastFee('bad'), null);
  assert.deepEqual(sent, [PUBLIC_ENDPOINT]);
  assert.equal(connect.mock.callCount(), 0);
  // Bloqueado no es 404/410: la suscripción se conserva, igual que antes.
  assert.equal(db.getSubscriptionsByUserId('bad').length, PRIVATE_ENDPOINTS.length + 1);
});

test('ningún archivo de api/ llama a webpush.sendNotification fuera de push-send.js', () => {
  const root = path.dirname(fileURLToPath(import.meta.url));
  const offenders = [];
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(c|m)?js$/.test(e.name) && full !== path.join(root, 'push-send.js')
        && /\.sendNotification\s*\(/.test(fs.readFileSync(full, 'utf8'))) {
        offenders.push(path.relative(root, full));
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders, []);
});
