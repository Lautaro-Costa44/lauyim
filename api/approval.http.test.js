import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays, gymToday } from './billing.js';


const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-approval-http-'));
process.env.DATA_DIR = dataDir;
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);
const ORIGIN = 'http://localhost:8080';
const RP_ID = 'localhost';

const db = await import('./database.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña' });   // el primer usuario es owner
db.createUser({ id: 'adm', name: 'Admin', admin: true });
db.createUser({ id: 'old', name: 'Socio Viejo' });          // cuenta de antes, sin datos
db.createUser({ id: 'old2', name: 'Socio Viejo 2' });
for (const id of ['owner', 'adm', 'old', 'old2']) db.createCredential({ id: 'cred-' + id, userId: id, publicKey: 'x' });
// Ficha cargada por el gym (sin app) con DNI y plan vigente.
db.createMember({ id: 'ficha', name: 'Ana Ficha', profile: { fullName: 'Ana Ficha', dni: '30111222', dniNorm: '30111222', phone: null, phoneNorm: null, email: null } });
const plan = db.createPlan({ name: 'Mensual', price: 20000, durationDays: 30 });
db.closeDatabase();

const PORT = 46000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
const today = gymToday(Date.now(), 'America/Argentina/Buenos_Aires');
let server;
let ipSeq = 0;

function cookie(uid) {
  const payload = `${uid}:${Date.now() + 3600000}:0`;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
async function call(who, method, url, body) {
  const c = !who ? null : who.startsWith('gymsid=') || who.startsWith('__Host') ? who : cookie(who);
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Real-IP': `198.19.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`, ...(c ? { Cookie: c } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => ({})), setCookie: res.headers.getSetCookie?.() || [] };
}
// --- passkey simulada: attestation 'none' con una clave P-256 ---
function cbor(value) {
  const head = (major, n) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b;
  };
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (typeof value === 'string') { const b = Buffer.from(value); return Buffer.concat([head(3, b.length), b]); }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  const parts = [head(5, value.size)];
  for (const [k, v] of value) parts.push(cbor(k), cbor(v));
  return Buffer.concat(parts);
}
function fakeRegistration(challenge) {
  const { publicKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const coseKey = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
  const credId = crypto.randomBytes(16);
  const len = Buffer.alloc(2); len.writeUInt16BE(credId.length);
  const authData = Buffer.concat([
    crypto.createHash('sha256').update(RP_ID).digest(),
    Buffer.from([0x45]),                 // UP + UV + AT
    Buffer.alloc(4), Buffer.alloc(16),   // signCount, aaguid
    len, credId, coseKey
  ]);
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin: ORIGIN, crossOrigin: false }));
  const attestationObject = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
  return {
    id: credId.toString('base64url'), rawId: credId.toString('base64url'), type: 'public-key',
    response: { clientDataJSON: clientDataJSON.toString('base64url'), attestationObject: attestationObject.toString('base64url'), transports: ['internal'] },
    clientExtensionResults: {}
  };
}

const sql = (query, ...params) => db.getDatabase().prepare(query).all(...params);
const auditLog = () => { try { return fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8'); } catch { return ''; } };

before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL('./server.js', import.meta.url))], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), LICENSE_EXPIRES_AT: '', ORIGIN, RP_ID, INVITE_ONLY: 'false' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  server.stderr.on('data', d => { log += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('el server no arrancó:\n' + log)), 15000);
    server.stdout.on('data', d => { if (String(d).includes('gym-api on')) { clearTimeout(timer); resolve(); } });
    server.on('exit', code => reject(new Error(`el server terminó (${code}):\n${log}`)));
  });
});

after(async () => {
  db.closeDatabase();
  if (server && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

// Registro completo con passkey simulada → { status, body, cookie }.
async function register(name, extra = {}) {
  const opt = await call(null, 'POST', '/api/register/options', { name, healthConsent: true, ...extra });
  if (opt.status !== 200) return opt;
  const ver = await call(null, 'POST', '/api/register/verify', { cid: opt.body.cid, credential: fakeRegistration(opt.body.options.challenge) });
  return { ...ver, cookie: ver.setCookie.map(c => c.split(';')[0]).join('; ') };
}
const PROFILE = { fullName: 'Juan Nuevo', dni: '40.123.456', phone: '11 2345-6789' };

test('sin aprobación: el registro pide los campos configurados y aceptar el aviso', async () => {
  const cfg = await call(null, 'GET', '/api/config');
  assert.equal(cfg.body.registration.approval, false);
  assert.equal(cfg.body.registration.fields.dni.required, true);
  assert.equal((await call(null, 'POST', '/api/register/options', { name: 'juan', healthConsent: true })).body.field, 'full_name');
  assert.equal((await call(null, 'POST', '/api/register/options', { name: 'juan', healthConsent: true, profile: PROFILE })).body.error, 'privacy_required');
  const bad = await call(null, 'POST', '/api/register/options', { name: 'juan', healthConsent: true, profile: { ...PROFILE, dni: '12' }, privacyAccepted: true });
  assert.equal(bad.body.field, 'dni');
  const ok = await register('juan', { profile: PROFILE, privacyAccepted: true });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.pending, false);
  const [row] = sql("SELECT u.approval_status, u.privacy_accepted_at, mp.dni_norm, mp.full_name FROM users u JOIN member_profile mp ON mp.user_id = u.id WHERE u.name = 'juan'");
  assert.equal(row.approval_status, null);
  assert.ok(row.privacy_accepted_at);
  assert.equal(row.dni_norm, '40123456');
  assert.equal(row.full_name, 'Juan Nuevo');
  const me = await call(ok.cookie, 'GET', '/api/me');
  assert.equal(me.body.pending, false);
  assert.equal(me.body.profilePrompt, null);
});

test('sin aprobación: un DNI que ya existe frena el registro (nunca vincula solo)', async () => {
  const r = await call(null, 'POST', '/api/register/options', { name: 'otra', healthConsent: true, profile: { ...PROFILE, dni: '30111222' }, privacyAccepted: true });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'dni_exists');
  assert.equal(r.body.message, 'Ya hay un socio con este DNI. Pedí en recepción tu código de vinculación');
  assert.equal(sql("SELECT COUNT(*) n FROM users WHERE name = 'otra'")[0].n, 0);
});

test('socio existente sin datos: formulario una sola vez (guardar o saltear)', async () => {
  const me = await call('old', 'GET', '/api/me');
  assert.ok(me.body.profilePrompt);
  assert.equal(me.body.profilePrompt.fields.dni.enabled, true);
  // DNI de otro: frena igual que el registro.
  assert.equal((await call('old', 'POST', '/api/me/profile', { profile: { ...PROFILE, dni: '30111222' }, privacyAccepted: true })).body.error, 'dni_exists');
  assert.equal((await call('old', 'POST', '/api/me/profile', { profile: { ...PROFILE, dni: '33444555' } })).body.error, 'privacy_required');
  assert.equal((await call('old', 'POST', '/api/me/profile', { profile: { ...PROFILE, dni: '33444555' }, privacyAccepted: true })).status, 200);
  assert.equal((await call('old', 'GET', '/api/me')).body.profilePrompt, null);
  // Ya no lo puede cambiar él: después, el DNI lo edita el staff.
  assert.equal((await call('old', 'POST', '/api/me/profile', { profile: { ...PROFILE, dni: '33444556' }, privacyAccepted: true })).body.error, 'profile_locked');
  assert.equal(sql("SELECT dni_norm FROM member_profile WHERE user_id = 'old'")[0].dni_norm, '33444555');
  // Saltear también lo cierra.
  assert.equal((await call('old2', 'POST', '/api/me/profile', { skip: true })).status, 200);
  assert.equal((await call('old2', 'GET', '/api/me')).body.profilePrompt, null);
  // Staff nunca.
  assert.equal((await call('adm', 'GET', '/api/me')).body.profilePrompt, null);
  assert.ok(auditLog().includes('auth.profile.self'));
});

test('config de aprobación: solo el owner; los modos que no aplican se rechazan', async () => {
  assert.equal((await call('adm', 'PUT', '/api/owner/approval', { required: true })).status, 403);
  assert.equal((await call('adm', 'GET', '/api/admin/approval')).body.required, false);
  assert.equal((await call('owner', 'PUT', '/api/owner/approval', { mode: 'nada' })).status, 400);
  // Cuotas apagado: payment/trial no.
  await call('owner', 'PUT', '/api/owner/billing/enabled', { enabled: false });
  assert.equal((await call('owner', 'PUT', '/api/owner/approval', { mode: 'payment' })).body.error, 'billing_disabled');
  await call('owner', 'PUT', '/api/owner/billing/enabled', { enabled: true });
  const r = await call('owner', 'PUT', '/api/owner/approval', { required: true, mode: 'payment' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.required, r.body.mode, r.body.effectiveMode], [true, 'payment', 'payment']);
  assert.equal((await call(null, 'GET', '/api/config')).body.registration.approval, true);
  assert.ok(auditLog().includes('owner.approval.settings'));
});

let pendingCookie, pendingId;
test('con aprobación: registro con solo el nombre; queda pendiente y sin entrenar', async () => {
  const r = await register('pepe');
  assert.equal(r.status, 200);
  assert.equal(r.body.pending, true);
  pendingCookie = r.cookie;
  pendingId = r.body.user.id;
  const me = await call(pendingCookie, 'GET', '/api/me');
  assert.equal(me.body.pending, true);
  assert.equal(me.body.profilePrompt, null);
  assert.equal((await call(pendingCookie, 'GET', '/api/data')).body.error, 'account_pending');
  assert.equal((await call(pendingCookie, 'POST', '/api/data/sync', { operations: [] })).body.error, 'account_pending');
  const list = await call('adm', 'GET', '/api/admin/users');
  assert.equal(list.body.users.find(u => u.id === pendingId).pending, true);
  assert.equal(list.body.users.find(u => u.id === 'old').pending, false);
  assert.equal((await call('adm', 'GET', '/api/admin/user?id=' + pendingId)).body.user.pending, true);
  assert.equal((await call('adm', 'GET', '/api/admin/approval')).body.pendingCount, 1);
});

test('aprobar: modo primer pago exige el pago; DNI de una ficha → 409 para vincular', async () => {
  const url = `/api/admin/users/${pendingId}/approve`;
  const r1 = await call('adm', 'POST', url, { profile: { ...PROFILE, dni: '41000111' } });
  assert.equal(r1.body.error, 'start_not_allowed');
  assert.deepEqual(r1.body.allowed, ['payment']);
  const opts = await call('adm', 'POST', url, { dry_run: true });
  assert.deepEqual([opts.status, opts.body.mode, opts.body.allowed, opts.body.covered], [200, 'payment', ['payment'], false]);
  const dup = await call('adm', 'POST', url, { profile: { ...PROFILE, dni: '30.111.222' }, start: { type: 'payment', planId: plan.id, method: 'efectivo' } });
  assert.equal(dup.status, 409);
  assert.deepEqual([dup.body.error, dup.body.userId, dup.body.hasApp], ['dni_duplicado', 'ficha', false]);
  assert.equal((await call('adm', 'POST', url, { profile: { fullName: 'Pepe' }, start: { type: 'payment', planId: plan.id, method: 'efectivo' } })).body.field, 'dni');
  const preview = await call('adm', 'POST', url, { dry_run: true, start: { type: 'payment', planId: plan.id, method: 'efectivo' } });
  assert.equal(preview.body.dueDate, addDays(today, 30));
  // Sigue pendiente después del dry_run.
  assert.equal((await call(pendingCookie, 'GET', '/api/me')).body.pending, true);
  const ok = await call('adm', 'POST', url, { profile: { ...PROFILE, dni: '41000111', fullName: 'Pepe Pérez' }, start: { type: 'payment', planId: plan.id, method: 'efectivo' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.member.billing.dueDate, addDays(today, 30));
  const me = await call(pendingCookie, 'GET', '/api/me');
  assert.equal(me.body.pending, false);
  assert.equal((await call(pendingCookie, 'GET', '/api/data')).status, 200);
  assert.equal((await call('adm', 'POST', url, { profile: PROFILE })).body.error, 'not_pending');
  assert.equal(sql('SELECT COUNT(*) n FROM payments WHERE user_id = ?', pendingId)[0].n, 1);
  const log = auditLog();
  assert.ok(log.includes('admin.member.approve'));
  assert.ok(!log.includes('41000111'));   // el DNI va enmascarado
});

test('aprobar después de vincular la ficha: con plan vigente alcanza con "solo aprobar"', async () => {
  const r = await register('ana');
  const anaId = r.body.user.id;
  // La ficha con plan vigente se une a la cuenta pendiente (merge existente).
  await call('adm', 'PUT', '/api/admin/users/ficha/billing', { planId: plan.id, dueDate: addDays(today, 20) });
  const merged = await call('adm', 'POST', `/api/admin/users/ficha/merge`, { targetId: anaId });
  assert.equal(merged.status, 200, JSON.stringify(merged.body));
  const me = await call(r.cookie, 'GET', '/api/me');
  assert.equal(me.body.pending, true);   // unir no la habilita: falta confirmar
  const ok = await call('adm', 'POST', `/api/admin/users/${anaId}/approve`, { profile: { fullName: 'Ana Ficha', dni: '30111222', phone: '11 5555-5555' }, start: { type: 'none' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await call(r.cookie, 'GET', '/api/me')).body.pending, false);
});

test('rechazar: desactiva con motivo en Logs y sale de pendientes', async () => {
  const r = await register('spam');
  const id = r.body.user.id;
  assert.equal((await call('adm', 'POST', `/api/admin/users/${id}/reject`, {})).status, 400);
  assert.equal((await call('adm', 'POST', `/api/admin/users/${id}/reject`, { reason: 'No es socio' })).status, 200);
  assert.equal((await call(r.cookie, 'GET', '/api/me')).status, 401);
  assert.ok(auditLog().includes('Motivo: No es socio'));
  assert.equal((await call('adm', 'POST', `/api/admin/users/${id}/reject`, { reason: 'otra vez' })).body.error, 'not_pending');
});

test('las cuentas de antes de encender la aprobación no quedan pendientes', async () => {
  assert.equal((await call('old', 'GET', '/api/me')).body.pending, false);
  assert.equal((await call('old', 'GET', '/api/data')).status, 200);
  // Con la aprobación encendida no hay formulario de una sola vez.
  assert.equal((await call('old2', 'GET', '/api/me')).body.profilePrompt, null);
});
