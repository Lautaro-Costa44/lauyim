// NEW_USERS_ADMIN=1 (demo de venta): quien se registra por su cuenta queda admin en la base y se
// le puede sacar; una ficha, quien la activa con el código del gym y una cuenta pendiente (hasta
// habilitarla) no. Reemplaza a DEMO_ADMIN_ALL_USERS: sin la variable nadie más es admin.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays, gymToday } from './billing.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-new-admin-'));
process.env.DATA_DIR = dataDir;
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);
const ORIGIN = 'http://localhost:8080';
const RP_ID = 'localhost';
const today = gymToday(Date.now(), 'America/Argentina/Buenos_Aires');

const db = await import('./database.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña' });
db.createCredential({ id: 'cred-owner', userId: 'owner', publicKey: 'x' });
// Socio de ejemplo cargado por el gym, con la cuota vencida hace mucho: tiene que verse bloqueado.
db.createMember({ id: 'ficha', name: 'Ana Ficha', profile: { fullName: 'Ana Ficha', dni: '30111222', dniNorm: '30111222', phone: null, phoneNorm: null, email: null } });
const plan = db.createPlan({ name: 'Mensual', price: 20000, durationDays: 30 });
db.setMemberBilling('ficha', { planId: plan.id, dueDate: addDays(today, -40) });
db.closeDatabase();

const PORT = 47500 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
let server, ipSeq = 0;
const cookie = uid => {
  const payload = `${uid}:${Date.now() + 3600000}:0`;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
async function call(who, method, url, body) {
  const c = !who ? null : who.startsWith('gymsid=') ? who : cookie(who);
  const res = await fetch(BASE + url, {
    method, headers: { 'Content-Type': 'application/json', 'X-Real-IP': `198.22.0.${ipSeq++ & 255}`, ...(c ? { Cookie: c } : {}) },
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
  const authData = Buffer.concat([crypto.createHash('sha256').update(RP_ID).digest(), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, credId, coseKey]);
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin: ORIGIN, crossOrigin: false }));
  const attestationObject = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
  return {
    id: credId.toString('base64url'), rawId: credId.toString('base64url'), type: 'public-key',
    response: { clientDataJSON: clientDataJSON.toString('base64url'), attestationObject: attestationObject.toString('base64url'), transports: ['internal'] },
    clientExtensionResults: {}
  };
}

let dniSeq = 40000000;
async function register(name) {
  const profile = { fullName: 'Prueba ' + name, dni: String(dniSeq++), phone: '11 2345-6789' };
  const opt = await call(null, 'POST', '/api/register/options', { name, healthConsent: true, profile, privacyAccepted: true });
  assert.equal(opt.status, 200, JSON.stringify(opt.body));
  const ver = await call(null, 'POST', '/api/register/verify', { cid: opt.body.cid, credential: fakeRegistration(opt.body.options.challenge) });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  return { id: ver.body.user.id, cookie: ver.setCookie.map(c => c.split(';')[0]).join('; ') };
}

before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL('./server.js', import.meta.url))], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), LICENSE_EXPIRES_AT: '', ORIGIN, RP_ID, INVITE_ONLY: 'false', NEW_USERS_ADMIN: '1' },
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
  if (server && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('quien se registra queda admin en la base (entra al panel) y el owner se lo puede sacar', async () => {
  const pro = await register('dueno-prueba');
  const me = await call(pro.cookie, 'GET', '/api/me');
  assert.deepEqual([me.body.user.admin, me.body.user.staff], [true, true]);
  assert.equal((await call(pro.cookie, 'GET', '/api/admin/users')).status, 200);
  assert.equal((await call('owner', 'POST', '/api/owner/user/admin', { id: pro.id, admin: false })).status, 200);
  const after = await call(pro.cookie, 'GET', '/api/me');
  assert.deepEqual([after.body.user.admin, after.body.user.staff], [false, false]);
  assert.equal((await call(pro.cookie, 'GET', '/api/admin/users')).status, 403);
});

test('el socio de ejemplo (ficha) no es admin: se ve con su cuota y bloqueado en la tabla', async () => {
  const users = (await call('owner', 'GET', '/api/admin/users')).body.users;
  const ficha = users.find(u => u.id === 'ficha');
  assert.equal(ficha.admin, false);
  assert.equal(ficha.billing.status, 'bloqueado');
});

test('activar la ficha con el código del gym no la hace admin', async () => {
  const code = (await call('owner', 'POST', '/api/admin/users/ficha/link-code', {})).body.code;
  const opts = await call(null, 'POST', '/api/link/options', { code });
  const ver = await call(null, 'POST', '/api/link/verify', { cid: opts.body.cid, credential: fakeRegistration(opts.body.options.challenge), healthConsent: true });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  assert.equal(ver.body.user.admin, false);
});

test('con aprobación: la cuenta queda pendiente y sin admin; al habilitarla, admin', async () => {
  assert.equal((await call('owner', 'PUT', '/api/owner/approval', { required: true })).status, 200);
  const opt = await call(null, 'POST', '/api/register/options', { name: 'pendiente', healthConsent: true });
  const ver = await call(null, 'POST', '/api/register/verify', { cid: opt.body.cid, credential: fakeRegistration(opt.body.options.challenge) });
  assert.equal(ver.status, 200, JSON.stringify(ver.body));
  const id = ver.body.user.id;
  const cookieP = ver.setCookie.map(c => c.split(';')[0]).join('; ');
  const pending = await call(cookieP, 'GET', '/api/me');
  assert.deepEqual([pending.body.pending, pending.body.user.admin], [true, false]);
  const ok = await call('owner', 'POST', `/api/admin/users/${id}/approve`, { profile: { fullName: 'Pedro Pendiente', dni: '41222333', phone: '11 2345-6789' }, start: { type: 'none' } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const approved = await call(cookieP, 'GET', '/api/me');
  assert.deepEqual([approved.body.pending, approved.body.user.admin], [false, true]);
});
