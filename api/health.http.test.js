// Datos de salud (Ley 25.326, art. 7): consentimiento en el registro y en la vinculación, la
// pregunta a las cuentas de antes, y qué pasa sin consentimiento (no se muestra, no se sincroniza,
// nutrición y el admin de nutrición/lesiones deshabilitados) y el borrado a pedido del socio.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays, gymToday } from './billing.js';


const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-health-http-'));
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

const noData = { profile: PROFILE, privacyAccepted: true };

test('registro: sin el consentimiento de salud no se puede', async () => {
  const r = await call(null, 'POST', '/api/register/options', { name: 'sin', ...noData, profile: { ...PROFILE, dni: '41111111' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'health_consent_required');
  const ok = await register('con', { ...noData, profile: { ...PROFILE, dni: '41111112' } });
  assert.equal(ok.status, 200);
  assert.equal((await call(ok.cookie, 'GET', '/api/me')).body.healthConsent, 'granted');
});

test('vinculación con código: exige el mismo consentimiento, sin gastar el código', async () => {
  const gen = await call('adm', 'POST', '/api/admin/users/ficha/link-code', {});
  assert.equal(gen.status, 200, JSON.stringify(gen.body));
  const opts = await call(null, 'POST', '/api/link/options', { code: gen.body.code });
  const credential = fakeRegistration(opts.body.options.challenge);
  const denied = await call(null, 'POST', '/api/link/verify', { cid: opts.body.cid, credential });
  assert.equal(denied.body.error, 'health_consent_required');
  assert.equal(sql('SELECT failed_attempts FROM link_codes WHERE user_id = ?', 'ficha')[0].failed_attempts, 0);
  const opts2 = await call(null, 'POST', '/api/link/options', { code: gen.body.code });
  const ok = await call(null, 'POST', '/api/link/verify', { cid: opts2.body.cid, credential: fakeRegistration(opts2.body.options.challenge), healthConsent: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(sql("SELECT health_consent FROM users WHERE id = 'ficha'")[0].health_consent, 'granted');
});

test('cuentas de antes: healthConsent null (se les pregunta una vez)', async () => {
  assert.equal((await call('old', 'GET', '/api/me')).body.healthConsent, null);
});

test('sin consentimiento: no se muestra, no se sincroniza, nutrición y admin deshabilitados; borrar a pedido', async () => {
  // Datos de salud cargados antes de retirar el consentimiento.
  const S = (await call('old2', 'GET', '/api/data')).body.state || {};
  const put = await call('old2', 'PUT', '/api/data', { state: { ...S, edad: 30, altura: 170, pesoKg: 70, restSec: 90,
    bodyweight: [{ d: '2026-09-01', w: 70, t: 1 }], respuestasEncuesta: { objetivo: 'fuerza', lesiones: ['rodilla'], edad: 30 }, _ts: Date.now() } });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal((await call('old2', 'POST', '/api/me/health-data/delete', {})).body.error, 'health_consent_active');

  assert.equal((await call('old2', 'POST', '/api/me/health-consent', { granted: false })).body.healthConsent, 'declined');
  assert.equal((await call('old2', 'GET', '/api/me')).body.healthConsent, 'declined');
  const view = (await call('old2', 'GET', '/api/data')).body.state;
  assert.deepEqual([view.edad, view.altura, view.pesoKg, view.bodyweight], [null, null, null, []]);
  assert.deepEqual(view.respuestasEncuesta, { objetivo: 'fuerza' });
  assert.equal(view.restSec, 90);

  // Un PUT con datos de salud nuevos no los cambia; el resto sí.
  await call('old2', 'PUT', '/api/data', { state: { ...view, edad: 99, restSec: 120, bodyweight: [{ d: '2026-09-02', w: 1, t: 2 }], _ts: Date.now() + 1000 } });
  const stored = db.getUserState('old2');
  assert.equal(stored.edad, 30);
  assert.equal(stored.restSec, 120);
  assert.deepEqual(stored.bodyweight.map(b => b.w), [70]);
  assert.deepEqual(stored.respuestasEncuesta.lesiones, ['rodilla']);

  assert.equal((await call('old2', 'GET', '/api/nutrition/goals')).body.error, 'health_consent_required');
  assert.equal((await call('old2', 'GET', '/api/comidas')).body.error, 'health_consent_required');
  assert.equal((await call('adm', 'GET', '/api/admin/users/old2/nutrition')).body.error, 'no_health_consent');
  assert.equal((await call('adm', 'PUT', '/api/admin/users/old2/injuries', { lesiones: [] })).body.error, 'no_health_consent');
  assert.equal((await call('old2', 'GET', '/api/admin/users/old2/nutrition')).status, 403);   // no admin: el handler responde como siempre
  const detail = await call('adm', 'GET', '/api/admin/user?id=old2');
  assert.deepEqual([detail.body.bodyweight, detail.body.user ? 'ok' : 'x', detail.body.healthConsent], [[], 'ok', 'declined']);
  assert.deepEqual((await call('adm', 'GET', '/api/admin/users/old2/routines')).body.lesiones, []);

  // Borrar: queda sin datos de salud; rutinas y el resto intactos.
  assert.equal((await call('old2', 'POST', '/api/me/health-data/delete', {})).status, 200);
  const after = db.getUserState('old2');
  assert.deepEqual([after.edad, after.altura, after.pesoKg, after.bodyweight], [null, null, null, []]);
  assert.deepEqual(after.respuestasEncuesta, { objetivo: 'fuerza' });
  assert.equal(after.restSec, 120);
  // Vuelve a aceptar: todo vuelve a funcionar.
  assert.equal((await call('old2', 'POST', '/api/me/health-consent', { granted: true })).body.healthConsent, 'granted');
  assert.equal((await call('old2', 'GET', '/api/nutrition/goals')).status, 200);
  const log = auditLog();
  for (const ev of ['auth.health.revoked', 'auth.health.deleted', 'auth.health.granted']) assert.ok(log.includes(ev), ev);
});
