/* opengym-api — passkey (WebAuthn) auth + per-user state storage for openGym
   SQLite storage via better-sqlite3, signed session cookies.               */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import dns from 'node:dns';
import webpush from 'web-push';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server';
import { dayReminderPush, gymFeePush, restTimerPush, testPush } from './push-messages.js';
import { verifyError } from './verify-error.js';
import {
  initDatabase,
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  getCredentialById,
  getCredentialsByUserId,
  createCredential,
  updateCredentialCounter,
  getSubscriptionsByUserId,
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
  createPreset,
  updatePreset,
  deletePreset,
  getUserState,
  saveUserState,
  getWorkoutsByUserId,
  getDatabase
} from './database.js';

const PORT = +(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || '/data';
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || 'http://localhost:8080';
const RP_NAME = process.env.RP_NAME || 'openGym';
// Admin dashboard (issue): admins are matched by uid; INVITE_ONLY gates new signups behind a
// code the admin generates. Both default off so a fresh self-hosted instance stays open.
const ADMIN_UIDS = (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
const INVITE_ONLY = /^(1|true|yes|on)$/i.test(process.env.INVITE_ONLY || '');
// Guest mode ("Continue without account") keeps everything in the browser and never touches this
// server — but on an instance meant for a known set of people, an entrance nobody can walk back
// out of is still the wrong front door (#42). Default ON, so existing instances are unchanged;
// the polarity is inverted from INVITE_ONLY because the safe default here is the permissive one.
const ALLOW_GUEST = !/^(0|false|no|off)$/i.test(process.env.ALLOW_GUEST || '');
// Motor de encuesta de onboarding y generación de rutinas. Default true; poner SURVEY_ENABLED=false
// para ocultar completamente la opción en el frontend sin afectar rutinas ya generadas.
const SURVEY_ENABLED = !/^(0|false|no|off)$/i.test(process.env.SURVEY_ENABLED || 'true');
// 90 days keeps someone who trains a few times a week permanently signed in without a stolen
// cookie staying good for a year. Overridable because a family instance and one on the open
// internet don't want the same number. Only affects cookies minted from now on — the expiry is
// baked into each cookie when it's issued, so lowering this never cuts an existing session short.
const SESSION_DAYS = Math.max(1, +(process.env.SESSION_DAYS || 90) || 90);
const MAX_BODY = 5 * 1024 * 1024;
// Secure cookies require HTTPS; over plain http://localhost the flag would drop the cookie
const SECURE = /^https:/i.test(ORIGIN) ? ' Secure;' : '';

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
const isAdmin = user => !!user && (user.admin === 1 || user.admin === true || ADMIN_UIDS.includes(user.id));
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
  return { value: { id: existingId || 'p' + crypto.randomBytes(8).toString('hex'), name, emoji: String(body.emoji || 'dumbbell').slice(0, 40), ex } };
}

const DEFAULT_PRESETS = [
  { id: 'starter-push', name: 'Push Day', emoji: 'barbell', ex: [['0025', 4, 8], ['0047', 3, 10], ['0426', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 3, 10]] },
  { id: 'starter-pull', name: 'Pull Day', emoji: 'pullup', ex: [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['0031', 3, 10], ['0313', 3, 12]] },
  { id: 'starter-legs', name: 'Leg Day', emoji: 'legs', ex: [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]] }
].map(r => ({ ...r, ex: r.ex.map(([id, sets, reps]) => ({ id, sets, reps, weight: 0 })) }));

if (getAllPresets().length === 0) {
  const transaction = getDatabase().transaction(() => {
    for (const p of DEFAULT_PRESETS) {
      createPreset(p);
    }
  });
  transaction();
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

setInterval(() => {
  const allUsers = getAllUsers();
  for (const user of allUsers) {
    const subs = getSubscriptionsByUserId(user.id);
    if (!subs.length) continue;
    const S = readState(user.id);
    if (!S?.reminder || (!S.reminder.on && !S.reminder.feeOn)) continue;
    const now = userNow(S.reminder.tz || 'UTC');
    if (!now || S.reminder.time !== now.hhmm) continue;
    if (S.reminder.on && user.lastReminder !== now.date && !(S.workouts || []).some(w => w.d === now.date)) {
      const rid = effectiveRoutineId(S, now.date);
      if (rid) {
        const routine = (S.routines || []).find(r => r.id === rid);
        console.log('reminder firing', user.id, rid);
        updateUser(user.id, { lastReminder: now.date });
        // saveDb(); // Eliminado: SQLite persiste automáticamente
        sendPush(user.id, dayReminderPush(S.lang, routine));
      }
    }
    const feeDate = feeDueDate(S.reminder, now.date);
    if (feeDate && user.lastFeeReminder !== feeDate) {
      updateUser(user.id, { lastFeeReminder: feeDate });
      // saveDb(); // Eliminado: SQLite persiste automáticamente
      sendPush(user.id, gymFeePush(S.lang, S.reminder.feeInterval));
    }
  }
}, 10000).unref();

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
  'POST /api/auth/device/start', 'GET /api/auth/device/poll'
]);
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

function clientIp(req) {
  if (AUDIT_IP === 'off') return null;
  const raw = String(req.headers['cf-connecting-ip'] || '').trim()
    || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    || String(req.headers['x-real-ip'] || '').trim()
    || String(req.socket?.remoteAddress || '').replace(/^::ffff:/, '').trim();
  const ip = raw.replace(/^\[|\]$/g, '').slice(0, 45);
  if (!/^[0-9a-fA-F:.]{3,45}$/.test(ip)) return null;
  if (AUDIT_IP === 'full') return ip;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.replace(/\.\d{1,3}$/, '.0/24');
  const g = ip.split(':').filter(Boolean).slice(0, 3).join(':');
  return g ? g + '::/48' : null;
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

if (AUDIT_ON) {
  compactAudit();
  setInterval(compactAudit, 3600000).unref();
}

/* ---------- routes ---------- */
const routes = {
  'GET /api/health': async (req, res) => json(res, 200, { ok: true, users: getAllUsers().length }),

  'GET /api/config': async (req, res) => json(res, 200, { invite_only: INVITE_ONLY, allow_guest: ALLOW_GUEST, survey_enabled: SURVEY_ENABLED }),

  'GET /api/me': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user) } });
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
    const transaction = getDatabase().transaction(() => {
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
    });
    transaction();

    // saveDb(); // Eliminado: SQLite persiste automáticamente
    audit(req, 'auth.register.ok', { user, msg: invite ? invite.code : null });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user) } }, { 'Set-Cookie': sessionCookie(user) });
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
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user) } }, { 'Set-Cookie': sessionCookie(user) });
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
      return json(res, 200, { status: 'approved', user: { id: user.id, name: user.name, admin: isAdmin(user) } }, { 'Set-Cookie': sessionCookie(user) });
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

  'PUT /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'not signed in' });
    const body = await readBody(req);
    if (!body.state || typeof body.state !== 'object') return json(res, 400, { error: 'state required' });
    delete body.state.active;
    saveUserState(user.id, body.state);
    json(res, 200, { ok: true, ts: body.state._ts || null });
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
    
    const transaction = getDatabase().transaction(() => {
      deleteSubscription(sub.endpoint);
      const mine = getSubscriptionsByUserId(user.id);
      if (mine.length >= MAX_SUBS_PER_USER) {
        const drop = mine.slice(0, mine.length - MAX_SUBS_PER_USER + 1);
        for (const s of drop) {
          deleteSubscription(s.endpoint);
        }
      }
      createSubscription({ userId: user.id, endpoint: sub.endpoint, keys, created: new Date().toISOString() });
    });
    transaction();

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
    json(res, 200, { presets });
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
        disabled: !!u.disabled, admin: isAdmin(u), invitedBy: u.invited_by || u.invitedBy || null,
        workouts: workouts.length,
        lastWorkout: last ? last.d : null,
        lastSync: S._ts || null,
        hasPush: getSubscriptionsByUserId(u.id).length > 0,
        live: livePresence(u.id)
      };
    });
    json(res, 200, { users, invite_only: INVITE_ONLY, now: Date.now() });
  },

  'GET /api/admin/user': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const u = getUserById(id);
    if (!u) return json(res, 404, { error: 'no such user' });
    const S = readState(u.id) || {};
    json(res, 200, {
      user: { id: u.id, name: u.name, created: u.created || u.created_at || null, disabled: !!u.disabled, admin: isAdmin(u), invitedBy: u.invited_by || u.invitedBy || null },
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

  /* ---------- activity log ---------- */
  'GET /api/admin/audit': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const q = new URL(req.url, 'http://x').searchParams;
    const limit = Math.max(1, Math.min(200, +q.get('limit') || 100));
    const before = +q.get('before') || Infinity;
    const cat = q.get('cat') || '';
    let rows = auditKeep(auditLines()).reverse();
    if (cat === 'fail') rows = rows.filter(r => !r.ok);
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
  const key = req.method + ' ' + url.pathname;
  const handler = routes[key];
  if (!handler) return json(res, 404, { error: 'not found' });
  if (!csrfOk(req, key)) {
    console.warn('refused cross-origin', key, 'origin=' + req.headers.origin, 'expected=' + ORIGIN);
    return json(res, 403, { error: 'cross-origin request refused' });
  }
  try { await handler(req, res); }
  catch (e) {
    console.error(key, e);
    if (!res.headersSent) json(res, 500, { error: 'server error' });
  }
}).listen(PORT, () => console.log(`gym-api on :${PORT} (rpID=${RP_ID}, origin=${ORIGIN})`));