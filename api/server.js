/* opengym-api — passkey (WebAuthn) auth + per-user state storage for openGym
   SQLite storage via node:sqlite, signed session cookies.                  */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import dns from 'node:dns';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server';
import { dayReminderPush, gymFeePush, restTimerPush, testPush } from './push-messages.js';
import { startScheduler } from './scheduler.js';
import { verifyError } from './verify-error.js';
import { processSyncBatch } from './sync.js';
import { ALIMENTOS_BASE } from './alimentos-base.js';
import { ALIMENTOS_USDA_DICT } from './alimentos-usda-dict.js';
import {
  initDatabase,
  getAllUsers,
  getUserById,
  deleteUser,
  createUser,
  updateUser,
  getCredentialById,
  getCredentialsByUserId,
  createCredential,
  updateCredentialCounter,
  getSubscriptionsByUserId,
  getAllSubscriptions,
  createSubscription,
  deleteSubscription,
  deleteSubscriptionsByUserId,
  getAllInvites,
  getInviteByCode,
  createInvite,
  updateInviteUsedBy,
  deleteInvite,
  getAllPresets,
  getPresetById,
  getPresetWithExercises,
  getPresetGroups,
  getPublicCustomExercises, savePublicCustomExercise, deletePublicCustomExercise,
  createPreset,
  updatePreset,
  deletePreset,
  getUserState,
  saveUserState,
  getWorkoutsByUserId,
  getAdminSetting,
  setAdminSetting,
  getAttendanceByDate,
  getDatabase
} from './database.js';

const PORT = +(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || '/data';
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || 'http://localhost:8080';
const RP_NAME = process.env.RP_NAME || 'openGym';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let apiVersion = '2.0.0';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  apiVersion = pkg.version || apiVersion;
} catch {}
// Admin dashboard (issue): admins are matched by uid; INVITE_ONLY gates new signups behind a
// code the admin generates. Both default off so a fresh self-hosted instance stays open.
const ADMIN_UIDS = (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
const DEMO_ADMIN_ALL_USERS = /^(1|true|yes|on)$/i.test(process.env.DEMO_ADMIN_ALL_USERS || '');
const INVITE_ONLY = /^(1|true|yes|on)$/i.test(process.env.INVITE_ONLY || '');
// Guest mode ("Continue without account") keeps everything in the browser and never touches this
// server — but on an instance meant for a known set of people, an entrance nobody can walk back
// out of is still the wrong front door (#42). Default ON, so existing instances are unchanged;
// the polarity is inverted from INVITE_ONLY because the safe default here is the permissive one.
const ALLOW_GUEST = !/^(0|false|no|off)$/i.test(process.env.ALLOW_GUEST || '');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Motor de encuesta de onboarding y generación de rutinas. Default true; poner SURVEY_ENABLED=false
// para ocultar completamente la opción en el frontend sin afectar rutinas ya generadas.
const SURVEY_ENABLED = !/^(0|false|no|off)$/i.test(process.env.SURVEY_ENABLED || 'true');
// 90 days keeps someone who trains a few times a week permanently signed in without a stolen
// cookie staying good for a year. Overridable because a family instance and one on the open
// internet don't want the same number. Only affects cookies minted from now on — the expiry is
// baked into each cookie when it's issued, so lowering this never cuts an existing session short.
const SESSION_DAYS = Math.max(1, +(process.env.SESSION_DAYS || 90) || 90);
const MAX_BODY = 5 * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_AUTH_MAX = 10;
const RATE_LIMIT_SHARE_MAX = 20;
const RATE_LIMIT_SUPPORT_MAX = 5;
// Secure cookies require HTTPS; over plain http://localhost the flag would drop the cookie
const SECURE = /^https:/i.test(ORIGIN) ? ' Secure;' : '';

// Licencia por fecha (LICENSE_EXPIRES_AT)
const LICENSE_EXPIRES_AT = process.env.LICENSE_EXPIRES_AT ? new Date(process.env.LICENSE_EXPIRES_AT).getTime() : null;

fs.mkdirSync(DATA, { recursive: true });

// Inicializar base de datos SQLite
initDatabase();

/* LEGACY DB CODE (db.json) - Comentado para preservar compatibilidad / rollback rápido:
let db = { users: [], creds: [], subs: [], invites: [], presets: [] };
function saveDb() { ... }
*/

function feeDueDate(reminder, today) {
  if (!reminder?.feeOn || !/^\d{4}-\d{2}-\d{2}$/.test(reminder.feeDate || '')) return null;
  const interval = reminder.feeInterval === 'annual' ? 12 : reminder.feeInterval === 'bimonthly' ? 2 : reminder.feeInterval === 'quarterly' ? 3 : 1;
  const anchor = new Date(reminder.feeDate + 'T12:00:00');
  if (Number.isNaN(anchor.getTime())) return null;
  if (reminder.feeDate > today) return null;
  let due = new Date(anchor);
  while (due.toISOString().slice(0, 10) <= today) {
    const next = new Date(due);
    next.setMonth(next.getMonth() + interval);
    due = next;
  }
  due.setMonth(due.getMonth() - interval);
  return due.toISOString().slice(0, 10);
}

/* ---------- secret ---------- */
const secretFile = path.join(DATA, 'secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(secretFile, 'utf8').trim();

// Funciones auxiliares para compatibilidad
const isAdmin = user => !!user && (DEMO_ADMIN_ALL_USERS || user.admin === 1 || user.admin === true || ADMIN_UIDS.includes(user.id));
const isOwner = user => !!user && (user.owner === 1 || user.owner === true);
function readState(uid) {
  return getUserState(uid);
}

function cleanPreset(body, existingId) {
  const name = String(body.name || '').trim().slice(0, 80);
  if (!name) return { error: 'name required' };
  const exercises = Array.isArray(body.ex) ? body.ex : [];
  if (exercises.length > 100) return { error: 'too many exercises' };
  const ex = exercises.map(item => {
    const id = String(item?.id || '').trim().slice(0, 80);
    const sets = Math.max(1, Math.min(20, Math.round(+item?.sets || 0)));
    const mode = item?.mode === 'time' ? 'time' : item?.mode === 'cardio' ? 'cardio' : 'reps';
    const out = { id, sets };
    if (mode === 'cardio') {
      out.min = Math.max(1, Math.min(1440, Math.round(+item?.min || 20)));
      out.speed = Math.max(0, Math.min(500, +item?.speed || 8));
    } else if (mode === 'time') {
      out.mode = 'time';
      out.sec = Math.max(1, Math.min(86400, Math.round(+item?.sec || 45)));
      out.weight = Math.max(0, Math.min(10000, +item?.weight || 0));
    } else {
      out.reps = Math.max(1, Math.min(100, Math.round(+item?.reps || 0)));
      out.weight = Math.max(0, Math.min(10000, +item?.weight || 0));
    }
    for (const key of ['bodyweight', 'side']) if (item?.[key]) out[key] = true;
    return out;
  });
  if (ex.some(item => !item.id || !item.sets || (item.mode === 'time' ? !item.sec : item.mode === 'cardio' ? !item.min : !item.reps))) return { error: 'invalid exercise' };
  return { value: { id: existingId || 'p' + crypto.randomBytes(8).toString('hex'), name, emoji: String(body.emoji || 'dumbbell').slice(0, 40), groupName: String(body.groupName || 'General').trim().slice(0, 80) || 'General', ex } };
}

const DEFAULT_PRESETS = [
  { id: 'starter-push', name: 'Push Day', emoji: 'barbell', ex: [['0025', 4, 8], ['0047', 3, 10], ['0426', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 3, 10]] },
  { id: 'starter-pull', name: 'Pull Day', emoji: 'pullup', ex: [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['0031', 3, 10], ['0313', 3, 12]] },
  { id: 'starter-legs', name: 'Leg Day', emoji: 'legs', ex: [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]] }
].map(r => ({ ...r, ex: r.ex.map(([id, sets, reps]) => ({ id, sets, reps, weight: 0 })) }));

if (getAllPresets().length === 0) {
  const db = getDatabase();
  db.exec('BEGIN');
  try {
    for (const p of DEFAULT_PRESETS) {
      createPreset(p);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  // saveDb(); // Eliminado: SQLite persiste automáticamente
}

/* ---------- push notifications (Web Push / VAPID) ---------- */
const vapidFile = path.join(DATA, 'vapid.json');
let vapid;
try { vapid = JSON.parse(fs.readFileSync(vapidFile, 'utf8')); }
catch { vapid = webpush.generateVAPIDKeys(); fs.writeFileSync(vapidFile, JSON.stringify(vapid), { mode: 0o600 }); }
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || (SECURE ? ORIGIN : 'mailto:admin@localhost');
webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);

const PUSH_TIMEOUT_MS = 10000;
const PUSH_CONCURRENCY = 6;
const MAX_SUBS_PER_USER = 20;

function isPrivateAddr(ip) {
  const v = String(ip).toLowerCase();
  const m4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(v);
  if (m4) {
    const a = +m4[1], b = +m4[2];
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 192 && b === 0) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  const m6 = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(v);
  if (m6) return isPrivateAddr(m6[1]);
  if (v === '::' || v === '::1') return true;
  if (/^fe[89ab]/.test(v)) return true;
  if (/^f[cd]/.test(v)) return true;
  return false;
}

function guardedLookup(hostname, options, cb) {
  dns.lookup(hostname, options, (err, address, family) => {
    if (err) return cb(err);
    const list = Array.isArray(address) ? address : [{ address, family }];
    if (list.some(a => isPrivateAddr(a.address))) {
      return cb(Object.assign(new Error('refusing to connect to a private address: ' + hostname), { code: 'EPUSHBLOCKED' }));
    }
    cb(null, address, family);
  });
}
const PUSH_AGENT = new https.Agent({ lookup: guardedLookup, keepAlive: false });

function pushEndpointError(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch { return 'endpoint is not a valid URL'; }
  if (u.protocol !== 'https:') return 'endpoint must be an https:// URL';
  if (u.username || u.password) return 'endpoint must not carry credentials';
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (/^[0-9.]+$/.test(host) || host.includes(':')) {
    if (isPrivateAddr(host)) return 'endpoint must not point at a private address';
  }
  return null;
}

async function sendPush(userId, payload) {
  const rawSubs = getSubscriptionsByUserId(userId);
  const subs = rawSubs.map(s => ({
    ...s,
    keys: typeof s.keys === 'string' ? JSON.parse(s.keys) : s.keys
  }));
  if (!subs.length) return;
  const body = JSON.stringify(payload);
  let next = 0;
  const worker = async () => {
    while (next < subs.length) {
      const sub = subs[next++];
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body,
          { urgency: 'high', timeout: PUSH_TIMEOUT_MS, agent: PUSH_AGENT });
      } catch (e) {
        console.error('push send failed', userId, e.statusCode, e.body || e.message);
        if (e.statusCode === 404 || e.statusCode === 410) {
          deleteSubscription(sub.endpoint);
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PUSH_CONCURRENCY, subs.length) }, worker));
  // saveDb(); // Eliminado: SQLite actualiza en tiempo real al ejecutar deleteSubscription
}

const restTimers = new Map();
function scheduleRestTimer(userId, sec, lang) {
  const t = restTimers.get(userId);
  if (t) clearTimeout(t);
  restTimers.set(userId, setTimeout(() => {
    restTimers.delete(userId);
    sendPush(userId, restTimerPush(lang));
  }, sec * 1000));
}
function cancelRestTimer(userId) {
  const t = restTimers.get(userId);
  if (t) { clearTimeout(t); restTimers.delete(userId); }
}

function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan?.[iso];
  if (ov === 'rest') return null;
  if (ov && S.routines?.some(r => r.id === ov)) return ov;
  const wd = new Date(iso + 'T12:00:00').getDay();
  return S.week?.[wd] || null;
}

function userNow(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date());
    const g = t => parts.find(p => p.type === t)?.value;
    return { date: `${g('year')}-${g('month')}-${g('day')}`, hhmm: `${g('hour')}:${g('minute')}` };
  } catch { return null; }
}


/* ---------- sessions (signed cookie) ---------- */
function sign(payload) {
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + mac;
}
function verifySig(token) {
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i), mac = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  } catch { return null; }
  return payload;
}

const sessionVersion = user => user.sv || 0;
function makeSession(user) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  return sign(user.id + ':' + exp + ':' + sessionVersion(user));
}

const COOKIE = SECURE ? '__Host-gymsid' : 'gymsid';
const LEGACY_COOKIE = 'gymsid';

function cookieValues(req, name) {
  const out = [];
  for (const c of (req.headers.cookie || '').split(';')) {
    const i = c.indexOf('=');
    if (i < 0) continue;
    if (c.slice(0, i).trim() === name) out.push(c.slice(i + 1).trim());
  }
  return out;
}
function cookieToken(req) {
  for (const name of (COOKIE === LEGACY_COOKIE ? [COOKIE] : [COOKIE, LEGACY_COOKIE])) {
    const vals = cookieValues(req, name);
    if (!vals.length) continue;
    if (vals.some(v => v !== vals[0])) return null;
    return vals[0];
  }
  return null;
}
function readSession(req) {
  const tok = cookieToken(req);
  if (!tok) return null;
  const payload = verifySig(tok);
  if (!payload) return null;
  const [uid, exp, ver] = payload.split(':');
  if (!uid || +exp < Date.now()) return null;
  const user = getUserById(uid);
  if (!user) return null;
  if (user.disabled) return null;
  const claimed = ver === undefined ? 0 : Number(ver);
  if (!Number.isInteger(claimed) || claimed !== sessionVersion(user)) return null;
  return user;
}

function requireAdmin(req, res) {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
  if (!isAdmin(user)) { audit(req, 'admin.denied', { ok: false, user }); json(res, 403, { error: 'forbidden' }); return null; }
  return user;
}

function requireOwner(req, res) {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'not signed in' }); return null; }
  if (!isOwner(user)) { audit(req, 'owner.denied', { ok: false, user }); json(res, 403, { error: 'owner required' }); return null; }
  return user;
}
const expireCookie = name => `${name}=; Path=/; Max-Age=0; HttpOnly;${SECURE} SameSite=Lax`;
function sessionCookie(user) {
  const fresh = `${COOKIE}=${makeSession(user)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly;${SECURE} SameSite=Lax`;
  return COOKIE === LEGACY_COOKIE ? [fresh] : [fresh, expireCookie(LEGACY_COOKIE)];
}
const clearCookie = COOKIE === LEGACY_COOKIE
  ? [expireCookie(LEGACY_COOKIE)]
  : [expireCookie(COOKIE), expireCookie(LEGACY_COOKIE)];

/* ---------- CSRF ---------- */
const CSRF_EXEMPT = new Set([
  'POST /api/register/options', 'POST /api/register/verify',
  'POST /api/login/options', 'POST /api/login/verify',
  'POST /api/auth/device/start', 'GET /api/auth/device/poll',
  'POST /api/share/plan'
]);

/* ---------- Shared Plans Store (QR sharing, TTL 10 mins) ---------- */
const sharedPlans = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [code, item] of sharedPlans.entries()) {
    if (now > item.expiresAt) sharedPlans.delete(code);
  }
}, 60000).unref();
const originsMatch = (a, b) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
function csrfOk(req, key) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true;
  if (CSRF_EXEMPT.has(key)) return true;
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'same-origin' || site === 'none';
  const origin = req.headers.origin;
  if (!origin) return true;
  return originsMatch(origin, ORIGIN);
}

/* ---------- challenge store ---------- */
const challenges = new Map();
function putChallenge(data) {
  const cid = crypto.randomBytes(16).toString('base64url');
  challenges.set(cid, { ...data, exp: Date.now() + 5 * 60000 });
  return cid;
}
function takeChallenge(cid) {
  const c = challenges.get(cid);
  challenges.delete(cid);
  if (!c || c.exp < Date.now()) return null;
  return c;
}
setInterval(() => { for (const [k, v] of challenges) if (v.exp < Date.now()) challenges.delete(k); }, 60000).unref();

/* ---------- device pairing store ---------- */
const pendingPairings = new Map();
const manualCodeMap = new Map();

function genManualCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) c += '-';
    c += chars[crypto.randomInt(0, chars.length)];
  }
  return c;
}

function cleanExpiredPairings() {
  const now = Date.now();
  for (const [id, p] of pendingPairings) {
    if (p.exp < now) {
      pendingPairings.delete(id);
      manualCodeMap.delete(p.manualCode);
    }
  }
}
setInterval(cleanExpiredPairings, 60000).unref();

/* ---------- helpers ---------- */
function json(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extraHeaders || {}) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', d => {
      size += d.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}
const b64uToBuf = s => Buffer.from(s, 'base64url');

/* ---------- live presence ---------- */
const presence = new Map();
const PRESENCE_TTL = 70000;
function livePresence(uid) {
  const p = presence.get(uid);
  if (!p) return null;
  if (Date.now() - p.updatedAt > PRESENCE_TTL) { presence.delete(uid); return null; }
  return p;
}
setInterval(() => { for (const [k, v] of presence) if (Date.now() - v.updatedAt > PRESENCE_TTL) presence.delete(k); }, 30000).unref();

/* ---------- audit log ---------- */
const AUDIT_ON = !/^(0|false|no|off)$/i.test(process.env.AUDIT_LOG || '');
const AUDIT_MAX = Math.max(0, +(process.env.AUDIT_MAX || 5000) || 0);
const AUDIT_DAYS = Math.max(0, +(process.env.AUDIT_DAYS || 90) || 0);
const AUDIT_IP = /^full$/i.test(process.env.AUDIT_IP || '') ? 'full'
  : /^(1|true|yes|on|net)$/i.test(process.env.AUDIT_IP || '') ? 'net' : 'off';
const auditFile = path.join(DATA, 'audit.log');
let auditSeq = 0;
let auditCount = 0;

function rawClientIp(req) {
  const raw = String(req.headers['cf-connecting-ip'] || '').trim()
    || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || String(req.headers['x-real-ip'] || '').trim()
    || String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '').trim();
  const ip = raw.replace(/^\[|\]$/g, '').slice(0, 45);
  if (!/^[0-9a-fA-F:.]{3,45}$/.test(ip)) return null;
  return ip;
}

function clientIp(req) {
  if (AUDIT_IP === 'off') return null;
  const ip = rawClientIp(req);
  if (!ip) return null;
  if (AUDIT_IP === 'full') return ip;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.replace(/\.\d{1,3}$/, '.0/24');
  const g = ip.split(':').filter(Boolean).slice(0, 3).join(':');
  return g ? g + '::/48' : null;
}

const rateLimits = new Map();
function rateLimit(req, res, routeKey, max) {
  const ip = rawClientIp(req);
  if (!ip) return true;
  const now = Date.now();
  const key = ip + ' ' + routeKey;
  let entry = rateLimits.get(key);
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    for (const [k, value] of rateLimits) {
      if (now - value.windowStart >= RATE_LIMIT_WINDOW_MS) rateLimits.delete(k);
    }
    entry = { count: 0, windowStart: now };
    rateLimits.set(key, entry);
  }
  entry.count += 1;
  if (entry.count > max) {
    json(res, 429, { error: 'Demasiados intentos, intentá de nuevo más tarde.' });
    return false;
  }
  return true;
}

function auditLines() {
  let text;
  try { text = fs.readFileSync(auditFile, 'utf8'); } catch { return []; }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try { const r = JSON.parse(line); if (r && r.id && r.ev) rows.push(r); } catch { /* torn line */ }
  }
  return rows;
}

function auditKeep(rows) {
  let out = rows;
  if (AUDIT_DAYS) { const cut = Date.now() - AUDIT_DAYS * 86400000; out = out.filter(r => r.ts >= cut); }
  if (AUDIT_MAX && out.length > AUDIT_MAX) out = out.slice(out.length - AUDIT_MAX);
  return out;
}

function compactAudit() {
  const rows = auditLines();
  for (const r of rows) if (+r.id > auditSeq) auditSeq = +r.id;
  const keep = auditKeep(rows);
  auditCount = keep.length;
  if (keep.length === rows.length) return;
  try { fs.writeFileSync(auditFile, keep.map(r => JSON.stringify(r)).join('\n') + (keep.length ? '\n' : '')); }
  catch (e) { console.error('audit compact failed', e.message); }
}

function audit(req, ev, f = {}) {
  if (!AUDIT_ON) return;
  const rec = { id: ++auditSeq, ts: Date.now(), ev, ok: f.ok !== false };
  if (f.user) { rec.uid = f.user.id; rec.name = String(f.user.name || '').slice(0, 40); }
  else {
    if (f.uid) rec.uid = f.uid;
    if (f.name) rec.name = String(f.name).slice(0, 40);
  }
  if (f.target) { rec.tgt = f.target.id; rec.tname = String(f.target.name || '').slice(0, 40); }
  if (f.msg) rec.msg = String(f.msg).slice(0, 120);
  const ip = clientIp(req);
  if (ip) rec.ip = ip;
  try { fs.appendFileSync(auditFile, JSON.stringify(rec) + '\n'); }
  catch (e) { return console.error('audit write failed', e.message); }
  if (AUDIT_MAX && ++auditCount > AUDIT_MAX * 1.25) compactAudit();
}

function normalizarTexto(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

const USDA_API_KEY = process.env.USDA_API_KEY || '';
let usdaKeyWarningLogged = false;

function nutrientValue(food, name, unitName) {
  const nutrient = food?.foodNutrients?.find(item => item?.nutrientName === name && (!unitName || item.unitName === unitName));
  if (nutrient?.value === null || nutrient?.value === undefined) return null;
  return Number.isFinite(Number(nutrient.value)) ? Number(nutrient.value) : null;
}

async function buscarAlimentosUSDA(query, db) {
  const tokens = normalizarTexto(query).split(/\s+/).filter(Boolean);
  const termino = ALIMENTOS_USDA_DICT.find(item => {
    const texto = normalizarTexto(item.es);
    return tokens.every(token => texto.includes(token));
  });
  if (!termino) return [];

  const cacheKey = `v2:usda:${query}`;
  const cached = db.prepare('SELECT resultado_json, fecha_cache FROM cache_alimentos WHERE query = ?').get(cacheKey);
  if (cached && Date.now() - new Date(cached.fecha_cache).getTime() < 24 * 60 * 60 * 1000) {
    try { return JSON.parse(cached.resultado_json); } catch { /* caché inválida: actualizar */ }
  }

  if (!USDA_API_KEY) {
    if (!usdaKeyWarningLogged) {
      console.warn('USDA_API_KEY is not configured; USDA food search is disabled');
      usdaKeyWarningLogged = true;
    }
    return [];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const searchUrl = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
    searchUrl.searchParams.set('api_key', USDA_API_KEY);
    searchUrl.searchParams.set('query', termino.en);
    searchUrl.searchParams.set('dataType', 'Foundation,SR Legacy');
    searchUrl.searchParams.set('pageSize', '5');
    const response = await fetch(searchUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(`USDA FoodData Central HTTP ${response.status}`);
    const data = await response.json();
    const food = Array.isArray(data.foods) ? data.foods[0] : null;
    const alimentos = food ? [{
      nombre: termino.label,
      marca: '',
      gramosPorUnidad: termino.gramosPorUnidad,
      unidadLabel: termino.unidadLabel,
      caloriasPor100g: nutrientValue(food, 'Energy', 'KCAL'),
      proteinaPor100g: nutrientValue(food, 'Protein'),
      carbosPor100g: nutrientValue(food, 'Carbohydrate, by difference'),
      grasasPor100g: nutrientValue(food, 'Total lipid (fat)')
    }] : [];
    db.prepare(`INSERT INTO cache_alimentos (query, resultado_json, fecha_cache)
      VALUES (?, ?, ?) ON CONFLICT(query) DO UPDATE SET resultado_json = excluded.resultado_json, fecha_cache = excluded.fecha_cache`)
      .run(cacheKey, JSON.stringify(alimentos), new Date().toISOString());
    return alimentos;
  } catch (error) {
    console.error('USDA food search error:', error);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function buscarAlimentosBase(query) {
  const tokens = normalizarTexto(query).split(/\s+/).filter(Boolean);
  return ALIMENTOS_BASE.filter(alimento => {
    const texto = normalizarTexto([alimento.nombre, ...(alimento.aliases || [])].join(' '));
    return tokens.every(token => texto.includes(token));
  }).map(alimento => ({
    nombre: alimento.nombre,
    marca: '',
    caloriasPor100g: alimento.caloriasPor100g,
    proteinaPor100g: alimento.proteinaPor100g,
    carbosPor100g: alimento.carbosPor100g,
    grasasPor100g: alimento.grasasPor100g,
    gramosPorUnidad: alimento.gramosPorUnidad,
    unidadLabel: alimento.unidadLabel,
  }));
}

function parseServingSize(texto) {
  try {
    const text = String(texto || '').trim();
    if (!text) return null;
    const number = '[0-9]+(?:[.,][0-9]+)?';
    const grouped = new RegExp(`^\\s*(${number})\\s+([^()]+?)\\s*\\(\\s*(${number})\\s*g(?:ramos?)?\\s*\\)\\s*$`, 'i').exec(text);
    if (grouped) {
      const count = Number(grouped[1].replace(',', '.'));
      const grams = Number(grouped[3].replace(',', '.'));
      if (!(count > 0) || !(grams > 0)) return null;
      const rawLabel = grouped[2].trim();
      const labels = {
        slice: 'rodaja', slices: 'rodaja', rebanada: 'rodaja', rebanadas: 'rodaja',
        portion: 'porción', portions: 'porción', porción: 'porción', porciones: 'porción'
      };
      return { gramosPorUnidad: grams / count, unidadLabel: labels[rawLabel.toLowerCase()] || rawLabel };
    }
    const simple = new RegExp(`^\\s*(${number})\\s*g(?:ramos?)?\\s*$`, 'i').exec(text);
    if (simple) {
      const grams = Number(simple[1].replace(',', '.'));
      return grams > 0 ? { gramosPorUnidad: grams, unidadLabel: 'porción' } : null;
    }
  } catch { /* serving_size inesperado: dejar el alimento en gramos */ }
  return null;
}

function mapearProductoOpenFoodFacts(product) {
  const n = product.nutriments || {};
  const numberOrNull = value => Number.isFinite(Number(value)) ? Number(value) : null;
  const serving = parseServingSize(product.serving_size);
  return {
    nombre: product.product_name || product.product_name_es || product.generic_name || '',
    marca: Array.isArray(product.brands) ? product.brands.join(', ') : product.brands || '',
    caloriasPor100g: numberOrNull(n['energy-kcal_100g'] ?? n['energy-kcal'] ?? n['energy-kcal_value']),
    proteinaPor100g: numberOrNull(n.proteins_100g),
    carbosPor100g: numberOrNull(n.carbohydrates_100g),
    grasasPor100g: numberOrNull(n.fat_100g),
    ...(serving || {})
  };
}

function combinarAlimentos(...listas) {
  const vistos = new Set();
  return listas.flat().filter(alimento => {
    if (!alimento.nombre) return false;
    const clave = `${normalizarTexto(alimento.nombre)}|${normalizarTexto(alimento.marca)}`;
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  }).slice(0, 15);
}

function inferirFranjasPlantilla(nombre, categoria) {
  if (categoria !== 'fitness') return [];
  const texto = String(nombre || '').toLowerCase();
  const franjas = new Set();
  if (/omelette|tostad|avena|yogur|huevo.*revuelt|panqueque|batido/.test(texto)) franjas.add('desayuno');
  if (/yogur|batido|galleta|panqueque|manzana|tostad|banana|mantequilla de maní/.test(texto)) franjas.add('merienda');
  if (/pollo|arroz|salmón|salmon|ensalada|bowl|wrap|bife|fideo|tofu|merluza|solomillo|lenteja|huevo.*arroz/.test(texto)) {
    franjas.add('almuerzo');
    franjas.add('cena');
  }
  if (/galleta|batido|manzana|yogur|atún con galletas|atun con galletas/.test(texto)) franjas.add('extra');
  return franjas.size ? [...franjas] : ['extra'];
}

function obtenerPlantillas(db, userId, categoria = '', soloUsuario = false, franja = '') {
  const soloCategoria = String(categoria || '').trim();
  const soloFranja = String(franja || '').trim();
  let where;
  let params;
  if (soloUsuario) {
    where = soloCategoria ? 'WHERE p.user_id = ? AND p.categoria = ?' : 'WHERE p.user_id = ?';
    params = soloCategoria ? [userId, soloCategoria] : [userId];
  } else {
    where = soloCategoria
      ? 'WHERE p.user_id IS NULL AND p.categoria = ?'
      : 'WHERE p.user_id IS NULL OR p.user_id = ?';
    params = soloCategoria ? [soloCategoria] : [userId];
  }
  const rows = db.prepare(`
    SELECT p.id AS plantilla_id, p.user_id, p.nombre AS plantilla_nombre, p.categoria, p.created_at, p.updated_at, p.franjas_recomendadas,
      i.id AS ingrediente_id, i.nombre_alimento, i.cantidad_gramos, i.calorias,
      i.proteina, i.carbohidratos, i.grasas
    FROM plantillas_comida p
    LEFT JOIN plantillas_ingredientes i ON i.plantilla_id = p.id
    ${where}
    ORDER BY CASE WHEN p.user_id = ? THEN 0 ELSE 1 END, p.id
  `).all(...params, userId);
  const plantillas = new Map();
  for (const row of rows) {
    let plantilla = plantillas.get(row.plantilla_id);
    if (!plantilla) {
      plantilla = {
        id: row.plantilla_id,
        user_id: row.user_id,
        nombre: row.plantilla_nombre,
        created_at: row.created_at,
        updated_at: row.updated_at || row.created_at,
        franjas_recomendadas: (() => {
          try {
            const franjas = JSON.parse(row.franjas_recomendadas || '[]');
            return franjas.length ? franjas : inferirFranjasPlantilla(row.plantilla_nombre, row.categoria);
          } catch { return inferirFranjasPlantilla(row.plantilla_nombre, row.categoria); }
        })(),
        ingredientes: []
      };
      plantillas.set(row.plantilla_id, plantilla);
    }
    if (row.ingrediente_id !== null) {
      plantilla.ingredientes.push({
        id: row.ingrediente_id,
        nombre_alimento: row.nombre_alimento,
        cantidad_gramos: row.cantidad_gramos,
        calorias: row.calorias,
        proteina: row.proteina,
        carbohidratos: row.carbohidratos,
        grasas: row.grasas
      });
    }
  }
  const resultado = [...plantillas.values()];
  return soloFranja
    ? resultado.filter(plantilla => plantilla.franjas_recomendadas.includes(soloFranja))
    : resultado;
}

function validarIngredientes(ingredientes) {
  return Array.isArray(ingredientes) && ingredientes.length > 0 && ingredientes.every(item => {
    const nombre = String(item?.nombre_alimento || '').trim();
    return nombre && Number.isFinite(Number(item?.cantidad_gramos)) && Number(item.cantidad_gramos) > 0 &&
      [item?.calorias, item?.proteina, item?.carbohidratos, item?.grasas]
        .every(value => Number.isFinite(Number(value)) && Number(value) >= 0);
  });
}

if (AUDIT_ON) {
  compactAudit();
  setInterval(compactAudit, 3600000).unref();
}

/* ---------- routes ---------- */
const routes = {
  'GET /api/health': async (req, res) => json(res, 200, { ok: true, users: getAllUsers().length }),

  'GET /api/alimentos/buscar': async (req, res) => {
    const query = normalizarTexto(new URL(req.url, 'http://x').searchParams.get('q')).slice(0, 100);
    if (!query) return json(res, 200, []);

    const db = getDatabase();
    const user = readSession(req);
    const plantillas = obtenerPlantillas(db, user?.id || null)
      .filter(plantilla => normalizarTexto(plantilla.nombre).includes(query))
      .map(plantilla => ({
        nombre: plantilla.nombre,
        marca: '',
        caloriasPor100g: null,
        proteinaPor100g: null,
        carbosPor100g: null,
        grasasPor100g: null,
        tipo: 'plantilla_comida',
        plantilla_id: plantilla.id,
        ingredientes: plantilla.ingredientes
      }));
    const baseResults = buscarAlimentosBase(query);
    const usdaResults = await buscarAlimentosUSDA(query, db);
    const cacheFor = scope => `v2:${scope}:${query}`;
    const freshCached = key => {
      const cached = db.prepare('SELECT resultado_json, fecha_cache FROM cache_alimentos WHERE query = ?').get(key);
      if (!cached || Date.now() - new Date(cached.fecha_cache).getTime() >= 24 * 60 * 60 * 1000) return null;
      try { return JSON.parse(cached.resultado_json); } catch { return null }
    };
    const cachedArgentina = freshCached(cacheFor('ar'));
    if (Array.isArray(cachedArgentina) && cachedArgentina.length) return json(res, 200, combinarAlimentos(plantillas, baseResults, usdaResults, cachedArgentina));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const searchUrl = new URL('https://search.openfoodfacts.org/search');
      searchUrl.searchParams.set('q', `countries_tags:"en:argentina" ${query}`);
      searchUrl.searchParams.set('langs', 'es');
      searchUrl.searchParams.set('page_size', '15');
      searchUrl.searchParams.set('fields', 'product_name,brands,serving_size,nutriments');
      const response = await fetch(searchUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'LauyimGym/1.0 (food search)' }
      });
      if (!response.ok) throw new Error(`Open Food Facts HTTP ${response.status}`);
      const data = await response.json();
      const hits = Array.isArray(data.hits) ? data.hits : [];
      const alimentos = hits.map(mapearProductoOpenFoodFacts).filter(item => item.nombre);
      db.prepare(`INSERT INTO cache_alimentos (query, resultado_json, fecha_cache)
        VALUES (?, ?, ?) ON CONFLICT(query) DO UPDATE SET resultado_json = excluded.resultado_json, fecha_cache = excluded.fecha_cache`)
        .run(cacheFor('ar'), JSON.stringify(alimentos), new Date().toISOString());
      if (data.count !== 0 && hits.length) return json(res, 200, combinarAlimentos(plantillas, baseResults, usdaResults, alimentos));

      const cachedFallback = freshCached(cacheFor('world-ar'));
      if (Array.isArray(cachedFallback)) return json(res, 200, combinarAlimentos(plantillas, baseResults, usdaResults, cachedFallback));
      const fallbackUrl = new URL('https://search.openfoodfacts.org/search');
      fallbackUrl.searchParams.set('q', query);
      fallbackUrl.searchParams.set('langs', 'es');
      fallbackUrl.searchParams.set('page_size', '15');
      fallbackUrl.searchParams.set('fields', 'product_name,brands,serving_size,nutriments');
      const fallbackResponse = await fetch(fallbackUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'LauyimGym/1.0 (food search)' }
      });
      if (!fallbackResponse.ok) throw new Error(`Open Food Facts HTTP ${fallbackResponse.status}`);
      const fallbackData = await fallbackResponse.json();
      const fallbackHits = Array.isArray(fallbackData.hits) ? fallbackData.hits : [];
      const fallbackAlimentos = fallbackHits.map(mapearProductoOpenFoodFacts).filter(item => item.nombre);
      db.prepare(`INSERT INTO cache_alimentos (query, resultado_json, fecha_cache)
        VALUES (?, ?, ?) ON CONFLICT(query) DO UPDATE SET resultado_json = excluded.resultado_json, fecha_cache = excluded.fecha_cache`)
        .run(cacheFor('world-ar'), JSON.stringify(fallbackAlimentos), new Date().toISOString());
      return json(res, 200, combinarAlimentos(plantillas, baseResults, usdaResults, fallbackAlimentos));
    } catch (error) {
      console.error('GET /api/alimentos/buscar error:', error);
      if (baseResults.length || usdaResults.length || plantillas.length) return json(res, 200, combinarAlimentos(plantillas, baseResults, usdaResults));
      return json(res, 502, { alimentos: [], error: 'No se pudo consultar Open Food Facts' });
    } finally {
      clearTimeout(timeout);
    }
  },

  'POST /api/plantillas': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const nombre = String(body.nombre || '').trim();
    if (!nombre || !validarIngredientes(body.ingredientes)) return json(res, 400, { error: 'nombre and ingredientes required' });

    const db = getDatabase();
    db.exec('BEGIN');
    try {
      const now = Date.now();
      const plantilla = db.prepare('INSERT INTO plantillas_comida (user_id, nombre, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(user.id, nombre, now, now);
      const plantillaId = Number(plantilla.lastInsertRowid);
      const stmt = db.prepare(`INSERT INTO plantillas_ingredientes
        (plantilla_id, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas)
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const item of body.ingredientes) {
        stmt.run(plantillaId, String(item.nombre_alimento).trim(), item.cantidad_gramos, item.calorias,
          item.proteina, item.carbohidratos, item.grasas);
      }
      db.exec('COMMIT');
      return json(res, 201, { id: plantillaId });
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  },

  'POST /api/comidas-compuestas': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const nombre = String(body.nombre || '').trim();
    if (!nombre || !validarIngredientes(body.ingredientes)) return json(res, 400, { error: 'nombre and ingredientes required' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.fecha || '')) || !['desayuno', 'almuerzo', 'merienda', 'cena', 'extra'].includes(body.franja)) {
      return json(res, 400, { error: 'fecha or franja invalid' });
    }

    const db = getDatabase();
    const grupoId = 'g' + crypto.randomBytes(16).toString('hex');
    db.exec('BEGIN');
    try {
      const now = Date.now();
      const plantilla = db.prepare('INSERT INTO plantillas_comida (user_id, nombre, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(user.id, nombre, now, now);
      const plantillaId = Number(plantilla.lastInsertRowid);
      const plantillaStmt = db.prepare(`INSERT INTO plantillas_ingredientes
        (plantilla_id, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas)
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
      const comidaStmt = db.prepare(`INSERT INTO comidas_registradas
        (user_id, grupo_id, grupo_nombre, fecha, franja, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const item of body.ingredientes) {
        const nombreIngrediente = String(item.nombre_alimento).trim();
        plantillaStmt.run(plantillaId, nombreIngrediente, item.cantidad_gramos, item.calorias,
          item.proteina, item.carbohidratos, item.grasas);
        comidaStmt.run(user.id, grupoId, nombre, body.fecha, body.franja, nombreIngrediente,
          item.cantidad_gramos, item.calorias, item.proteina, item.carbohidratos, item.grasas);
      }
      db.exec('COMMIT');
      return json(res, 201, { id: plantillaId, grupo_id: grupoId });
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  },

  'GET /api/plantillas': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const categoria = new URL(req.url, 'http://x').searchParams.get('categoria') || '';
    const requestUrl = new URL(req.url, 'http://x');
    const soloUsuario = requestUrl.searchParams.get('scope') === 'mine';
    const franja = requestUrl.searchParams.get('franja') || '';
    return json(res, 200, obtenerPlantillas(getDatabase(), user.id, categoria, soloUsuario, franja));
  },

  'PUT /api/plantillas/:id': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const id = new URL(req.url, 'http://x').pathname.split('/').pop();
    const db = getDatabase();
    const plantilla = db.prepare('SELECT id, user_id, updated_at FROM plantillas_comida WHERE id = ?').get(id);
    if (!plantilla) return json(res, 404, { error: 'template not found' });
    if (plantilla.user_id !== user.id) return json(res, 403, { error: 'forbidden' });
    const body = await readBody(req);
    const nombre = String(body.nombre || '').trim();
    if (!nombre || !validarIngredientes(body.ingredientes)) return json(res, 400, { error: 'nombre and ingredientes required' });

    db.exec('BEGIN');
    try {
      db.prepare('UPDATE plantillas_comida SET nombre = ?, updated_at = ? WHERE id = ?').run(nombre, Date.now(), id);
      db.prepare('DELETE FROM plantillas_ingredientes WHERE plantilla_id = ?').run(id);
      const stmt = db.prepare(`INSERT INTO plantillas_ingredientes
        (plantilla_id, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas)
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const item of body.ingredientes) {
        stmt.run(id, String(item.nombre_alimento).trim(), item.cantidad_gramos, item.calorias,
          item.proteina, item.carbohidratos, item.grasas);
      }
      db.exec('COMMIT');
      return json(res, 200, { ok: true });
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  },

  'DELETE /api/plantillas/:id': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const id = new URL(req.url, 'http://x').pathname.split('/').pop();
    const db = getDatabase();
    const plantilla = db.prepare('SELECT id, user_id FROM plantillas_comida WHERE id = ?').get(id);
    if (!plantilla) return json(res, 404, { error: 'template not found' });
    if (plantilla.user_id !== user.id) return json(res, 403, { error: 'forbidden' });
    db.prepare('DELETE FROM plantillas_comida WHERE id = ?').run(id);
    return json(res, 200, { ok: true });
  },

  'GET /api/alimentos/codigo/:codigo': async (req, res) => {
    const codigo = decodeURIComponent(new URL(req.url, 'http://x').pathname.split('/').pop() || '').trim();
    if (!codigo) return json(res, 400, { error: 'Código de barras requerido' });

    const cacheKey = `codigo:${codigo}`;
    const db = getDatabase();
    const cached = db.prepare('SELECT resultado_json, fecha_cache FROM cache_alimentos WHERE query = ?').get(cacheKey);
    if (cached && Date.now() - new Date(cached.fecha_cache).getTime() < 24 * 60 * 60 * 1000) {
      try { return json(res, 200, JSON.parse(cached.resultado_json)); } catch { /* caché inválida: actualizar */ }
    }

    const controller = new AbortController();
    let timeoutTriggered = false;
    const timeout = setTimeout(() => {
      timeoutTriggered = true;
      controller.abort();
    }, 5000);
    let response;
    try {
      const productUrl = new URL(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(codigo)}.json`);
      productUrl.searchParams.set('fields', 'product_name,brands,serving_size,nutriments');
      response = await fetch(productUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'LauyimGym/1.0 (barcode lookup)' }
      });
      if (!response.ok) throw new Error(`Open Food Facts HTTP ${response.status}`);
      const data = await response.json();
      if (data.status !== 1 || !data.product) return json(res, 404, { error: 'Producto no encontrado en Open Food Facts' });

      const alimento = mapearProductoOpenFoodFacts(data.product);
      if (!alimento.nombre) return json(res, 404, { error: 'Producto no encontrado en Open Food Facts' });

      db.prepare(`INSERT INTO cache_alimentos (query, resultado_json, fecha_cache)
        VALUES (?, ?, ?) ON CONFLICT(query) DO UPDATE SET resultado_json = excluded.resultado_json, fecha_cache = excluded.fecha_cache`)
        .run(cacheKey, JSON.stringify(alimento), new Date().toISOString());
      return json(res, 200, alimento);
    } catch (error) {
      const abortError = error?.name === 'AbortError' || controller.signal.aborted;
      console.error('GET /api/alimentos/codigo/:codigo error details:', {
        codigo,
        openFoodFactsStatus: response?.status ?? null,
        timeoutOrAbort: abortError,
        timeoutTriggered,
        networkErrorBeforeResponse: !response && !abortError,
        errorName: error?.name ?? null,
        errorMessage: error?.message ?? String(error)
      });
      console.error('GET /api/alimentos/codigo/:codigo error:', error);
      return json(res, 502, { error: 'No se pudo consultar Open Food Facts' });
    } finally {
      clearTimeout(timeout);
    }
  },

  'POST /api/comidas': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.fecha || '')) || !['desayuno', 'almuerzo', 'merienda', 'cena', 'extra'].includes(body.franja)) {
      return json(res, 400, { error: 'fecha or franja invalid' });
    }
    const values = [body.fecha, body.franja, String(body.nombre_alimento || '').trim(), body.cantidad_gramos, body.calorias, body.proteina, body.carbohidratos, body.grasas];
    if (!values[2] || values.slice(3).some(value => !Number.isFinite(Number(value)) || Number(value) < 0)) return json(res, 400, { error: 'invalid meal data' });
    const result = getDatabase().prepare(`INSERT INTO comidas_registradas
      (user_id, fecha, franja, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(user.id, ...values);
    return json(res, 201, { id: Number(result.lastInsertRowid) });
  },

  'POST /api/comidas/grupo': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.fecha || '')) || !['desayuno', 'almuerzo', 'merienda', 'cena', 'extra'].includes(body.franja)) {
      return json(res, 400, { error: 'fecha or franja invalid' });
    }
    const grupoNombre = String(body.grupo_nombre || '').trim();
    const ingredientes = Array.isArray(body.ingredientes) ? body.ingredientes : [];
    if (!grupoNombre || !ingredientes.length) return json(res, 400, { error: 'grupo_nombre and ingredientes required' });

    const values = ingredientes.map(item => [
      String(item?.nombre_alimento || '').trim(),
      item?.cantidad_gramos,
      item?.calorias,
      item?.proteina,
      item?.carbohidratos,
      item?.grasas
    ]);
    if (values.some(item => !item[0] || item.slice(1).some(value => !Number.isFinite(Number(value)) || Number(value) < 0))) {
      return json(res, 400, { error: 'invalid ingredient data' });
    }

    const db = getDatabase();
    const grupoId = 'g' + crypto.randomBytes(16).toString('hex');
    const stmt = db.prepare(`INSERT INTO comidas_registradas
      (user_id, grupo_id, grupo_nombre, fecha, franja, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    db.exec('BEGIN');
    try {
      for (const [nombre, cantidad, calorias, proteina, carbohidratos, grasas] of values) {
        stmt.run(user.id, grupoId, grupoNombre, body.fecha, body.franja, nombre, cantidad, calorias, proteina, carbohidratos, grasas);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return json(res, 201, { grupo_id: grupoId });
  },

  'GET /api/comidas': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const fecha = new URL(req.url, 'http://x').searchParams.get('fecha') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return json(res, 400, { error: 'fecha invalid' });
    const comidas = getDatabase().prepare('SELECT * FROM comidas_registradas WHERE user_id = ? AND fecha = ? ORDER BY id').all(user.id, fecha);
    return json(res, 200, comidas);
  },

  'GET /api/comidas/historial': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });

    const dias = Number(new URL(req.url, 'http://x').searchParams.get('dias') || 30);
    if (!Number.isInteger(dias) || dias < 1 || dias > 365) {
      return json(res, 400, { error: 'dias invalid' });
    }

    const desde = `-${dias - 1} days`;
    const historial = getDatabase().prepare(`
      SELECT
        fecha,
        SUM(calorias) AS calorias,
        SUM(proteina) AS proteina,
        SUM(carbohidratos) AS carbohidratos,
        SUM(grasas) AS grasas
      FROM comidas_registradas
      WHERE user_id = ? AND fecha >= date('now', ?)
      GROUP BY fecha
      ORDER BY fecha DESC
    `).all(user.id, desde);

    return json(res, 200, historial);
  },

  'DELETE /api/comidas/:id': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const id = new URL(req.url, 'http://x').pathname.split('/').pop();
    const result = getDatabase().prepare('DELETE FROM comidas_registradas WHERE id = ? AND user_id = ?').run(id, user.id);
    if (!result.changes) return json(res, 404, { error: 'meal not found' });
    return json(res, 200, { ok: true });
  },

  'DELETE /api/comidas/grupo/:grupo_id': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const grupoId = new URL(req.url, 'http://x').pathname.split('/').pop();
    const result = getDatabase().prepare('DELETE FROM comidas_registradas WHERE grupo_id = ? AND user_id = ?').run(grupoId, user.id);
    if (!result.changes) return json(res, 404, { error: 'meal group not found' });
    return json(res, 200, { ok: true });
  },

  'POST /api/share/plan': async (req, res) => {
    const body = await readBody(req);
    if (!body || !body.lauyim_plan) {
      return json(res, 400, { error: 'invalid plan data' });
    }
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    while (sharedPlans.has(code)) {
      code = '';
      for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    }
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutos exactos
    sharedPlans.set(code, { data: body, expiresAt });
    return json(res, 200, { code });
  },

  'POST /api/support': async (req, res) => {
    const body = await readBody(req);
    const asunto = String(body.asunto || '').trim().slice(0, 150);
    const mensaje = String(body.mensaje || '').trim().slice(0, 2000);
    const emailContacto = String(body.emailContacto || '').trim().slice(0, 100);
    const pwaInstalled = !!body.pwaInstalled;

    if (!asunto || !mensaje) {
      return json(res, 400, { error: 'Asunto y mensaje son requeridos' });
    }

    const brevoApiKey = process.env.BREVO_API_KEY;
    const supportDestination = process.env.SUPPORT_DESTINATION_EMAIL || 'soporte@lauyim.online';
    const instanceName = process.env.INSTANCE_NAME || body.hostname || req.headers['x-forwarded-host'] || req.headers['host'] || 'Desconocida';

    if (!brevoApiKey) {
      console.error('POST /api/support error: BREVO_API_KEY is not configured');
      return json(res, 500, { error: 'No se pudo enviar el reporte, intentá de nuevo' });
    }

    const userAgent = req.headers['user-agent'] || 'Desconocido';
    const appVersion = apiVersion;
    const user = readSession(req);
    const userInfo = user
      ? `Usuario: ${escapeHtml(user.name)} (ID: ${escapeHtml(user.id)})`
      : 'Usuario: Invitado / No autenticado';

    const safeInstanceName = escapeHtml(instanceName);
    const safeAsunto = escapeHtml(asunto);
    const safeMensaje = escapeHtml(mensaje).replace(/\n/g, '<br/>');
    const safeEmailContacto = escapeHtml(emailContacto);
    const safeUserAgent = escapeHtml(userAgent);

    const htmlContent = `
      <h2>Nuevo reporte de soporte / problema</h2>
      <p><strong>Instancia / Origen:</strong> ${safeInstanceName}</p>
      <p><strong>Asunto:</strong> ${safeAsunto}</p>
      <p><strong>Mensaje:</strong><br/>${safeMensaje}</p>
      <hr/>
      <h3>Datos de diagnóstico:</h3>
      <ul>
        <li><strong>Instancia:</strong> ${safeInstanceName}</li>
        <li><strong>Email de contacto:</strong> ${safeEmailContacto || 'No provisto'}</li>
        <li>${userInfo}</li>
        <li><strong>Versión de la app:</strong> v${appVersion}</li>
        <li><strong>PWA instalada:</strong> ${pwaInstalled ? 'Sí' : 'No'}</li>
        <li><strong>User Agent:</strong> ${safeUserAgent}</li>
      </ul>
    `;

    try {
      const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': brevoApiKey,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          sender: { name: 'Soporte Lauyim', email: 'soporte@lauyim.online' },
          to: [{ email: supportDestination }],
          subject: `[Soporte Lauyim] [${instanceName}] ${asunto}`,
          htmlContent
        })
      });

      if (!brevoRes.ok) {
        const errText = await brevoRes.text();
        console.error('Brevo API error:', brevoRes.status, errText);
        return json(res, 500, { error: 'No se pudo enviar el reporte, intentá de nuevo' });
      }

      return json(res, 200, { ok: true });
    } catch (e) {
      console.error('POST /api/support fetch error:', e);
      return json(res, 500, { error: 'No se pudo enviar el reporte, intentá de nuevo' });
    }
  },

  'GET /api/config': async (req, res) => {
    json(res, 200, { invite_only: INVITE_ONLY, allow_guest: ALLOW_GUEST });
  },

  'GET /api/me': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user), owner: !!user.owner } });
  },

  'POST /api/register/options': async (req, res) => {
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) return json(res, 400, { error: 'name required' });
    const code = String(body.code || '').trim().toUpperCase();
    if (INVITE_ONLY) {
      const inv = getInviteByCode(code);
      if (!inv || inv.used_by || inv.revoked) {
        audit(req, 'auth.register.denied', { ok: false, name, msg: 'invite-rejected' });
        return json(res, 403, { error: 'a valid invite code is required' });
      }
    }
    const uid = crypto.randomBytes(12).toString('base64url');
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID: RP_ID,
      userID: Buffer.from(uid), userName: name, userDisplayName: name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      excludeCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge, name, uid, code });
    json(res, 200, { cid, options });
  },

  'POST /api/register/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c || !c.uid) {
      audit(req, 'auth.register.fail', { ok: false, msg: 'challenge-expired' });
      return json(res, 400, { error: 'challenge expired — try again' });
    }
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false
      });
    } catch (e) {
      audit(req, 'auth.register.fail', { ok: false, name: c.name, msg: 'verify-error' });
      return json(res, 400, { error: verifyError(e, { rpId: RP_ID, origin: ORIGIN }) });
    }
    if (!verification.verified) {
      audit(req, 'auth.register.fail', { ok: false, name: c.name, msg: 'not-verified' });
      return json(res, 400, { error: 'not verified' });
    }
    const { credential } = verification.registrationInfo;
    if (getCredentialById(credential.id)) {
      audit(req, 'auth.register.fail', { ok: false, name: c.name, msg: 'credential-exists' });
      return json(res, 409, { error: 'credential already registered' });
    }
    let invite = null;
    if (INVITE_ONLY) {
      invite = getInviteByCode(c.code);
      if (!invite || invite.used_by || invite.revoked) {
        audit(req, 'auth.register.fail', { ok: false, name: c.name, msg: 'invite-invalid' });
        return json(res, 403, { error: 'invite code is no longer valid — ask for a new one' });
      }
    }
    const user = { id: c.uid, name: c.name, created: new Date().toISOString() };
    if (invite) { user.invitedBy = invite.code; }

    // Uso de transacción atómica para insertar usuario, credencial y actualizar invitación
    const db = getDatabase();
    db.exec('BEGIN');
    try {
      createUser(user);
      createCredential({
        id: credential.id, userId: user.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter || 0,
        transports: body.credential?.response?.transports || []
      });
      if (invite) {
        updateInviteUsedBy(invite.code, user.id);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    // saveDb(); // Eliminado: SQLite persiste automáticamente
    audit(req, 'auth.register.ok', { user, msg: invite ? invite.code : null });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user), owner: !!user.owner } }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/login/options': async (req, res) => {
    const options = await generateAuthenticationOptions({
      rpID: RP_ID, userVerification: 'preferred', allowCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge });
    json(res, 200, { cid, options });
  },

  'POST /api/login/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c) {
      audit(req, 'auth.login.fail', { ok: false, msg: 'challenge-expired' });
      return json(res, 400, { error: 'challenge expired — try again' });
    }
    const cred = getCredentialById(body.credential?.id);
    if (!cred) {
      audit(req, 'auth.login.fail', { ok: false, msg: 'unknown-credential' });
      return json(res, 404, { error: 'unknown passkey — create a profile first' });
    }
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false,
        credential: {
          id: cred.id,
          publicKey: b64uToBuf(cred.public_key || cred.publicKey),
          counter: cred.counter,
          transports: typeof cred.transports === 'string' ? JSON.parse(cred.transports) : cred.transports
        }
      });
    } catch (e) {
      audit(req, 'auth.login.fail', { ok: false, user: getUserById(cred.user_id || cred.userId), uid: cred.user_id || cred.userId, msg: 'verify-error' });
      return json(res, 400, { error: verifyError(e, { rpId: RP_ID, origin: ORIGIN }) });
    }
    if (!verification.verified) {
      audit(req, 'auth.login.fail', { ok: false, user: getUserById(cred.user_id || cred.userId), uid: cred.user_id || cred.userId, msg: 'not-verified' });
      return json(res, 400, { error: 'not verified' });
    }
    updateCredentialCounter(cred.id, verification.authenticationInfo.newCounter);
    // saveDb(); // Eliminado: SQLite persiste automáticamente
    const user = getUserById(cred.user_id || cred.userId);
    if (!user) {
      audit(req, 'auth.login.fail', { ok: false, uid: cred.user_id || cred.userId, msg: 'user-missing' });
      return json(res, 500, { error: 'user missing' });
    }
    if (user.disabled) {
      audit(req, 'auth.login.fail', { ok: false, user, msg: 'account-disabled' });
      return json(res, 403, { error: 'this account has been disabled' });
    }
    audit(req, 'auth.login.ok', { user });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user), owner: !!user.owner } }, { 'Set-Cookie': sessionCookie(user) });
  },

  /* ---------- Device Pairing Flow ---------- */
  'POST /api/auth/device/start': async (req, res) => {
    cleanExpiredPairings();
    const pairingId = crypto.randomBytes(16).toString('base64url');
    const manualCode = genManualCode();
    const exp = Date.now() + 5 * 60000;
    const data = { pairingId, manualCode, status: 'pending', user: null, attempts: 0, exp };
    pendingPairings.set(pairingId, data);
    manualCodeMap.set(manualCode, pairingId);
    json(res, 200, { pairingId, manualCode, expiresAt: exp });
  },

  'POST /api/auth/device/claim': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    cleanExpiredPairings();
    const rawCode = String(body.code || body.manualCode || body.pairingId || '').trim().toUpperCase();
    const pairingId = pendingPairings.has(rawCode) ? rawCode : manualCodeMap.get(rawCode);
    const pairing = pairingId ? pendingPairings.get(pairingId) : null;
    if (!pairing || pairing.exp < Date.now()) {
      return json(res, 400, { error: 'Código o QR no válido o expirado' });
    }
    if (pairing.attempts >= 5) {
      pendingPairings.delete(pairing.pairingId);
      manualCodeMap.delete(pairing.manualCode);
      return json(res, 400, { error: 'Demasiados intentos fallidos para este código' });
    }
    json(res, 200, { pairingId: pairing.pairingId, manualCode: pairing.manualCode, ok: true });
  },

  'POST /api/auth/device/confirm': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    cleanExpiredPairings();
    const pairingId = String(body.pairingId || '').trim();
    const pairing = pendingPairings.get(pairingId);
    if (!pairing || pairing.exp < Date.now()) {
      return json(res, 400, { error: 'Solicitud de vinculación expirada' });
    }
    pairing.status = 'approved';
    pairing.user = user;
    audit(req, 'auth.device.approved', { user, pairingId });
    json(res, 200, { ok: true });
  },

  'GET /api/auth/device/poll': async (req, res) => {
    cleanExpiredPairings();
    const u = new URL(req.url, ORIGIN);
    const pairingId = u.searchParams.get('pairingId') || u.searchParams.get('id');
    if (!pairingId) return json(res, 400, { error: 'pairingId required' });
    const pairing = pendingPairings.get(pairingId);
    if (!pairing || pairing.exp < Date.now()) {
      return json(res, 400, { status: 'expired', error: 'expired' });
    }
    if (pairing.status === 'pending') {
      return json(res, 200, { status: 'pending' });
    }
    if (pairing.status === 'approved' && pairing.user) {
      const user = pairing.user;
      pendingPairings.delete(pairingId);
      manualCodeMap.delete(pairing.manualCode);
      audit(req, 'auth.device.login', { user });
      return json(res, 200, { status: 'approved', user: { id: user.id, name: user.name, admin: isAdmin(user), owner: !!user.owner } }, { 'Set-Cookie': sessionCookie(user) });
    }
    json(res, 400, { status: 'expired', error: 'invalid state' });
  },

  /* ---------- Additional Passkey Registration ---------- */
  'POST /api/credentials/add/options': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const userCreds = getCredentialsByUserId(user.id);
    const excludeCredentials = userCreds.map(c => ({ id: c.id, type: 'public-key' }));
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID: RP_ID,
      userID: Buffer.from(user.id), userName: user.name, userDisplayName: user.name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      excludeCredentials
    });
    const cid = putChallenge({ challenge: options.challenge, uid: user.id });
    json(res, 200, { cid, options });
  },

  'POST /api/credentials/add/verify': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c || c.uid !== user.id) {
      return json(res, 400, { error: 'challenge expired — try again' });
    }
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false
      });
    } catch (e) {
      return json(res, 400, { error: verifyError(e, { rpId: RP_ID, origin: ORIGIN }) });
    }
    if (!verification.verified) {
      return json(res, 400, { error: 'not verified' });
    }
    const { credential } = verification.registrationInfo;
    if (getCredentialById(credential.id)) {
      return json(res, 409, { error: 'credential already registered' });
    }
    createCredential({
      id: credential.id, userId: user.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter || 0,
      transports: body.credential?.response?.transports || []
    });
    // saveDb(); // Eliminado: SQLite persiste automáticamente
    audit(req, 'auth.cred.added', { user });
    json(res, 200, { ok: true, msg: 'Passkey agregada con éxito' });
  },

  'POST /api/logout': async (req, res) => {
    const user = readSession(req);
    if (user) audit(req, 'auth.logout', { user });
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  'POST /api/logout/all': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const newSv = sessionVersion(user) + 1;
    updateUser(user.id, { sv: newSv });
    // saveDb(); // Eliminado: SQLite persiste automáticamente
    audit(req, 'auth.logout.all', { user });
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  'GET /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const state = getUserState(user.id);
    json(res, 200, { state });
  },

  'GET /api/public-exercises': async (req, res) => json(res, 200, { exercises: getPublicCustomExercises() }),
  'POST /api/admin/public-exercises': async (req, res) => { const admin = requireAdmin(req, res); if (!admin) return; const ex = await readBody(req); if (!ex.id || !ex.n) return json(res, 400, { error: 'invalid exercise' }); savePublicCustomExercise(ex); json(res, 200, { ok: true }); },
  'POST /api/admin/public-exercises/delete': async (req, res) => { const admin = requireAdmin(req, res); if (!admin) return; deletePublicCustomExercise((await readBody(req)).id); json(res, 200, { ok: true }); },

  'PUT /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (!body.state || typeof body.state !== 'object') return json(res, 400, { error: 'state required' });
    delete body.state.active;
    const currentState = getUserState(user.id) || {};
    const stateVersion = Math.max(Date.now(), Number(currentState._ts || 0) + 1);
    body.state._ts = stateVersion;
    const versions = {};
    for (const key of Object.keys(body.state)) {
      if (!['_ts', '_syncVersions'].includes(key)) versions[key] = stateVersion;
    }
    body.state._syncVersions = versions;
    saveUserState(user.id, body.state);
    json(res, 200, { ok: true, ts: body.state._ts || null });
  },

  // Incremental sync endpoint. The client sends a bounded batch of top-level patches;
  // applying them against the current server state prevents one device from replacing
  // unrelated fields changed by another device. The operation ids are client-side and
  // patches are idempotent, so a response lost after commit is safe to retry.
  'POST /api/data/sync': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (!Array.isArray(body.operations) || body.operations.length > 50) return json(res, 400, { error: 'invalid operations batch' });
    const processed = processSyncBatch({ db: getDatabase(), userId: user.id, operations: body.operations, getUserState, saveUserState });
    return json(res, 200, processed);
  },

  'GET /api/push/public-key': async (req, res) => json(res, 200, { key: vapid.publicKey }),

  'POST /api/push/subscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json(res, 400, { error: 'invalid subscription' });
    const bad = pushEndpointError(sub.endpoint);
    if (bad) return json(res, 400, { error: bad });
    
    const keys = { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) };
    
    const db = getDatabase();
    db.exec('BEGIN');
    try {
      deleteSubscription(sub.endpoint);
      const mine = getSubscriptionsByUserId(user.id);
      if (mine.length >= MAX_SUBS_PER_USER) {
        const drop = mine.slice(0, mine.length - MAX_SUBS_PER_USER + 1);
        for (const s of drop) {
          deleteSubscription(s.endpoint);
        }
      }
      createSubscription({ userId: user.id, endpoint: sub.endpoint, keys, created: new Date().toISOString() });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    // saveDb(); // Eliminado: SQLite persiste automáticamente
    json(res, 200, { ok: true });
  },

  'POST /api/push/unsubscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    deleteSubscription(body.endpoint);
    // saveDb(); // Eliminado: SQLite persiste automáticamente
    json(res, 200, { ok: true });
  },

  'POST /api/push/test': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    await sendPush(user.id, testPush(readState(user.id)?.lang));
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    const sec = Math.max(1, Math.min(3600, Math.round(+body.seconds || 0)));
    if (!sec) return json(res, 400, { error: 'seconds required' });
    scheduleRestTimer(user.id, sec, readState(user.id)?.lang);
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer/cancel': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    cancelRestTimer(user.id);
    json(res, 200, { ok: true });
  },

  'POST /api/activity': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (body.active) {
      presence.set(user.id, {
        name: String(body.name || '').slice(0, 60),
        exIdx: +body.exIdx || 0, exTotal: +body.exTotal || 0,
        setsDone: +body.setsDone || 0, setsTotal: +body.setsTotal || 0,
        startedAt: +body.startedAt || Date.now(),
        updatedAt: Date.now()
      });
    } else presence.delete(user.id);
    json(res, 200, { ok: true });
  },

  /* ---------- admin dashboard ---------- */
  'GET /api/presets': async (req, res) => {
    if (!readSession(req)) return json(res, 401, { error: 'not signed in' });
    const presets = getAllPresets().map(p => getPresetWithExercises(p.id));
    json(res, 200, { presets, groups: getPresetGroups() });
  },

  'POST /api/admin/presets': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const result = cleanPreset(await readBody(req));
    if (result.error) return json(res, 400, { error: result.error });
    createPreset(result.value);
    // saveDb(); // Eliminado: SQLite persiste automáticamente
    audit(req, 'admin.preset.create', { user: admin, msg: result.value.name });
    json(res, 200, { preset: result.value });
  },

  'PUT /api/admin/presets': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const existing = getPresetById(body.id);
    if (!existing) return json(res, 404, { error: 'no such preset' });
    const result = cleanPreset(body, existing.id);
    if (result.error) return json(res, 400, { error: result.error });
    updatePreset(existing.id, result.value);
    // saveDb(); // Eliminado: SQLite persiste automáticamente
    audit(req, 'admin.preset.update', { user: admin, msg: result.value.name });
    json(res, 200, { preset: result.value });
  },

  'POST /api/admin/presets/delete': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const preset = getPresetById(body.id);
    if (!preset) return json(res, 404, { error: 'no such preset' });
    deletePreset(preset.id);
    // saveDb(); // Eliminado: SQLite persiste automáticamente
    audit(req, 'admin.preset.delete', { user: admin, msg: preset.name });
    json(res, 200, { ok: true });
  },

  'GET /api/admin/users': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const dbUsers = getAllUsers();
    const users = dbUsers.map(u => {
      const S = readState(u.id) || {};
      const workouts = S.workouts || [];
      const last = workouts[workouts.length - 1];
      return {
        id: u.id, name: u.name, created: u.created || u.created_at || null,
        disabled: !!u.disabled, admin: isAdmin(u), owner: !!u.owner, invitedBy: u.invited_by || u.invitedBy || null,
        workouts: workouts.length,
        lastWorkout: last ? last.d : null,
        lastSync: S._ts || null,
        hasPush: getSubscriptionsByUserId(u.id).length > 0,
        live: livePresence(u.id)
      };
    });
    json(res, 200, { users, invite_only: INVITE_ONLY, now: Date.now() });
  },

  'GET /api/admin/attendance-heatmap': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const start = getAdminSetting('attendance_week_start', 'monday') === 'sunday' ? 'sunday' : 'monday';
    const endDate = new Date();
    endDate.setHours(12, 0, 0, 0);
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 27);
    const iso = d => d.toISOString().slice(0, 10);
    const rows = getAttendanceByDate(iso(startDate), iso(endDate));
    const days = Object.fromEntries(rows.map(r => [r.date, Number(r.users) || 0]));
    json(res, 200, { start, days, totalUsers: getAllUsers().length, now: Date.now() });
  },

  'POST /api/admin/attendance-week-start': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const start = body.start === 'sunday' ? 'sunday' : body.start === 'monday' ? 'monday' : null;
    if (!start) return json(res, 400, { error: 'start must be sunday or monday' });
    setAdminSetting('attendance_week_start', start);
    audit(req, 'admin.attendance.settings', { user: admin, msg: start });
    json(res, 200, { ok: true, start });
  },

  'GET /api/admin/user': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const u = getUserById(id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const S = readState(u.id) || {};
    json(res, 200, {
      user: { id: u.id, name: u.name, created: u.created || u.created_at || null, disabled: !!u.disabled, admin: isAdmin(u), owner: !!u.owner, invitedBy: u.invited_by || u.invitedBy || null },
      unit: S.unit || 'kg',
      lastSync: S._ts || null,
      routines: (S.routines || []).map(r => ({ id: r.id, name: r.name, emoji: r.emoji, count: (r.ex || []).length })),
      bodyweight: S.bodyweight || [],
      workouts: (S.workouts || []).slice().reverse()
    });
  },

  'POST /api/admin/user/disable': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const u = getUserById(body.id);
    if (!u) return json(res, 404, { error: 'no such user' });
    if (isAdmin(u)) return json(res, 400, { error: 'cannot disable an admin' });
    const newDisabled = !!body.disabled;
    updateUser(u.id, { disabled: newDisabled });
    if (newDisabled) presence.delete(u.id);
    // saveDb(); // Eliminado: SQLite persiste automáticamente
    audit(req, newDisabled ? 'admin.user.disable' : 'admin.user.enable', { user: admin, target: u });
    json(res, 200, { ok: true, id: u.id, disabled: newDisabled });
  },

  'POST /api/owner/user/admin': async (req, res) => {
    const owner = requireOwner(req, res); if (!owner) return;
    const body = await readBody(req);
    const id = String(body.id || '').trim();
    if (!id) return json(res, 400, { error: 'user id required' });
    const u = getUserById(id);
    if (!u) return json(res, 404, { error: 'no such user' });
    if (isOwner(u)) return json(res, 400, { error: 'cannot change the owner role' });
    const admin = !!body.admin;
    updateUser(u.id, { admin });
    audit(req, admin ? 'owner.user.promote' : 'owner.user.demote', { user: owner, target: u });
    json(res, 200, { ok: true, id: u.id, admin });
  },

  'POST /api/owner/user/delete': async (req, res) => {
    const owner = requireOwner(req, res); if (!owner) return;
    const body = await readBody(req);
    const id = String(body.id || '').trim();
    if (!id) return json(res, 400, { error: 'user id required' });
    const u = getUserById(id);
    if (!u) return json(res, 404, { error: 'no such user' });
    if (!u.disabled) return json(res, 400, { error: 'only disabled accounts can be deleted' });
    if (isOwner(u)) return json(res, 400, { error: 'cannot delete the owner account' });

    try {
      const deleted = deleteUser(u.id);
      audit(req, 'owner.user.delete', { user: owner, target: deleted });
      return json(res, 200, { ok: true, id: deleted.id });
    } catch (error) {
      audit(req, 'owner.user.delete', { ok: false, user: owner, target: u, msg: error.message });
      throw error;
    }
  },

  'GET /api/admin/invites': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const allInvites = getAllInvites();
    const invites = allInvites.map(i => {
      const usedBy = i.used_by || i.usedBy;
      const u = usedBy ? getUserById(usedBy) : null;
      return {
        code: i.code,
        note: i.note,
        createdBy: i.created_by || i.createdBy,
        created: i.created_at || i.created,
        usedBy: usedBy || null,
        usedAt: i.used_at || i.usedAt || null,
        revoked: !!i.revoked,
        usedByName: u ? u.name : null
      };
    });
    json(res, 200, { invites, invite_only: INVITE_ONLY });
  },

  'POST /api/admin/invites/new': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    let code;
    do { code = crypto.randomBytes(8).toString('hex').toUpperCase(); } while (getInviteByCode(code));
    const invite = { code, note: String(body.note || '').slice(0, 60), createdBy: admin.id, created: new Date().toISOString() };
    createInvite(invite);
    // saveDb(); // Eliminado: SQLite persiste automáticamente
    audit(req, 'admin.invite.create', { user: admin, msg: code });
    json(res, 200, { invite });
  },

  'POST /api/admin/invites/revoke': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const inv = getInviteByCode(String(body.code || '').toUpperCase());
    if (!inv) return json(res, 404, { error: 'no such code' });
    if (inv.used_by || inv.usedBy) return json(res, 400, { error: 'already used — cannot revoke' });
    deleteInvite(inv.code);
    // saveDb(); // Eliminado: SQLite persiste automáticamente
    audit(req, 'admin.invite.revoke', { user: admin, msg: inv.code });
    json(res, 200, { ok: true });
  },

  'POST /api/admin/push': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const titulo = String(body.titulo || '').trim();
    const texto = String(body.texto || '').trim();
    if (!titulo || !texto) return json(res, 400, { error: 'titulo and texto required' });
    if (titulo.length > 50) return json(res, 400, { error: 'titulo exceeds 50 characters' });
    if (texto.length > 120) return json(res, 400, { error: 'texto exceeds 120 characters' });

    let redirectUrl = body.redirectUrl ? String(body.redirectUrl).trim() : null;
    if (redirectUrl) {
      try {
        const u = new URL(redirectUrl);
        if (!['http:', 'https:'].includes(u.protocol)) throw new Error('invalid protocol');
      } catch {
        return json(res, 400, { error: 'invalid redirectUrl' });
      }
    }

    const rawSubs = getAllSubscriptions();
    if (!rawSubs.length) return json(res, 200, { ok: true, sent: 0 });

    const payload = {
      title: titulo,
      body: texto,
      tag: 'admin-custom',
      data: {
        redirectUrl: redirectUrl
      }
    };

    const payloadStr = JSON.stringify(payload);
    let sent = 0;
    for (const s of rawSubs) {
      const keys = typeof s.keys === 'string' ? JSON.parse(s.keys) : s.keys;
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys }, payloadStr, {
          urgency: 'high',
          timeout: PUSH_TIMEOUT_MS,
          agent: PUSH_AGENT
        });
        sent++;
      } catch (e) {
        console.error('admin push send failed', s.endpoint, e.statusCode, e.body || e.message);
        if (e.statusCode === 404 || e.statusCode === 410) {
          deleteSubscription(s.endpoint);
        }
      }
    }

    audit(req, 'admin.push.send', { user: admin, msg: titulo, sent });
    json(res, 200, { ok: true, sent });
  },

  /* ---------- activity log ---------- */
  'GET /api/admin/audit': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const q = new URL(req.url, 'http://x').searchParams;
    const limit = Math.max(1, Math.min(200, +q.get('limit') || 100));
    const before = +q.get('before') || Infinity;
    const cat = q.get('cat') || '';
    let rows = auditKeep(auditLines()).reverse();
    if (cat === 'fail') rows = rows.filter(r => !r.ok);
    else if (cat === 'admin') rows = rows.filter(r => String(r.ev).startsWith('admin.') || String(r.ev).startsWith('owner.'));
    else if (cat) rows = rows.filter(r => String(r.ev).startsWith(cat + '.'));
    const page = rows.filter(r => r.id < before).slice(0, limit);
    json(res, 200, {
      events: page,
      total: rows.length,
      nextBefore: page.length === limit ? page[page.length - 1].id : null,
      enabled: AUDIT_ON, ip_mode: AUDIT_IP,
      retention: { max: AUDIT_MAX, days: AUDIT_DAYS },
      now: Date.now()
    });
  },

  'POST /api/admin/audit/clear': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    try { fs.unlinkSync(auditFile); } catch { /* nothing logged yet */ }
    auditCount = 0;
    audit(req, 'admin.audit.clear', { user: admin });
    json(res, 200, { ok: true });
  }
};

http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && url.pathname.startsWith('/api/share/plan/')) {
    if (!rateLimit(req, res, 'GET /api/share/plan/:code', RATE_LIMIT_SHARE_MAX)) return;
    const code = url.pathname.replace('/api/share/plan/', '').trim().toUpperCase();
    const item = sharedPlans.get(code);
    if (!item || Date.now() > item.expiresAt) {
      if (item) sharedPlans.delete(code);
      return json(res, 404, { error: 'code not found or expired' });
    }
    return json(res, 200, item.data);
  }

  const key = req.method + ' ' + url.pathname;
  const routeKey = req.method === 'DELETE' && /^\/api\/comidas\/grupo\/[^/]+$/.test(url.pathname)
    ? 'DELETE /api/comidas/grupo/:grupo_id'
    : req.method === 'DELETE' && /^\/api\/comidas\/[^/]+$/.test(url.pathname)
    ? 'DELETE /api/comidas/:id'
    : req.method === 'GET' && /^\/api\/alimentos\/codigo\/[^/]+$/.test(url.pathname)
      ? 'GET /api/alimentos/codigo/:codigo'
    : req.method === 'PUT' && /^\/api\/plantillas\/[^/]+$/.test(url.pathname)
      ? 'PUT /api/plantillas/:id'
    : req.method === 'DELETE' && /^\/api\/plantillas\/[^/]+$/.test(url.pathname)
      ? 'DELETE /api/plantillas/:id'
    : key;

  const rateLimitMax = routeKey === 'POST /api/register/options'
    || routeKey === 'POST /api/register/verify'
    || routeKey === 'POST /api/login/options'
    || routeKey === 'POST /api/login/verify'
    ? RATE_LIMIT_AUTH_MAX
    : routeKey === 'POST /api/share/plan' ? RATE_LIMIT_SHARE_MAX
    : routeKey === 'POST /api/support' ? RATE_LIMIT_SUPPORT_MAX : null;
  if (rateLimitMax !== null && !rateLimit(req, res, routeKey, rateLimitMax)) return;

  // Verificar expiración de licencia por fecha (si está configurada y vencida)
  // Excluimos /api/health para que monitores o chequeos básicos puedan seguir funcionando si es necesario, 
  // pero endpoints protegidos / login / /api/me devuelven license_expired.
  if (LICENSE_EXPIRES_AT && Date.now() > LICENSE_EXPIRES_AT && url.pathname.startsWith('/api/') && url.pathname !== '/api/health' && url.pathname !== '/api/support') {
    return json(res, 403, { error: 'license_expired' });
  }

  const handler = routes[routeKey];
  if (!handler) return json(res, 404, { error: 'not found' });
  if (!csrfOk(req, routeKey)) {
    console.warn('refused cross-origin', routeKey, 'origin=' + req.headers.origin, 'expected=' + ORIGIN);
    return json(res, 403, { error: 'cross-origin request refused' });
  }
  try { await handler(req, res); }
  catch (e) {
    console.error(routeKey, e);
    if (!res.headersSent) json(res, 500, { error: 'server error' });
  }
}).listen(PORT, () => {
  console.log(`gym-api on :${PORT} (rpID=${RP_ID}, origin=${ORIGIN})`);
  startScheduler();
});
