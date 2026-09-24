// Levanta server.js sobre una base temporal (igual que billing.http.test.js) y cubre sesiones
// (users.sv y logout/all), created_at normalizado, invites, el device pairing y el rate limit.
// El test se conecta desde 127.0.0.1 (loopback = proxy de confianza), así que X-Real-IP hace de
// la IP que nginx pone para cada visitante.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-auth-http-'));
process.env.DATA_DIR = dataDir;
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);

const db = await import('./database.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña' });   // el primer usuario es owner
db.createUser({ id: 'm1', name: 'Socio Uno' });
db.createUser({ id: 'm2', name: 'Socio Dos' });
db.createUser({ id: 'lo', name: 'Logout' });
db.createUser({ id: 'm3', name: 'Socio Tres' });
db.createUser({ id: 'm4', name: 'Socio Cuatro' });
// created_at como lo dejaron versiones viejas: ms, segundos y el DEFAULT CURRENT_TIMESTAMP.
const raw = db.getDatabase().prepare('INSERT INTO users (id, name, created_at) VALUES (?, ?, ?)');
raw.run('ms', 'En ms', 1700000000000);
raw.run('sec', 'En segundos', 1700000000);
raw.run('sql', 'Default SQL', '2023-11-14 22:13:20');
db.createInvite({ code: 'INV1', createdBy: 'owner', created: new Date().toISOString(), note: 'para Ana' });
db.createUser({ id: 'inv', name: 'Invitada', invitedBy: 'INV1' });
db.updateInviteUsedBy('INV1', 'inv');
db.closeDatabase();

const PORT = 44000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
let server;

// Misma cookie que makeSession() en server.js: uid:exp:sv firmado con el secret de DATA_DIR.
function cookie(uid, sv = 0, exp = Date.now() + 3600000) {
  const payload = `${uid}:${exp}:${sv}`;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
async function call(who, method, url, body, headers = {}) {
  const c = !who ? null : who.startsWith('gymsid=') ? who : cookie(who);
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(c ? { Cookie: c } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL('./server.js', import.meta.url))], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), LICENSE_EXPIRES_AT: '' },
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

test('logout/all invalida todas las sesiones del usuario, incluida la actual', async () => {
  const a = cookie('lo', 0, Date.now() + 3600000);
  const b = cookie('lo', 0, Date.now() + 7200000);   // otra sesión (otro dispositivo)
  assert.equal((await call(a, 'GET', '/api/me')).status, 200);
  assert.equal((await call(b, 'GET', '/api/me')).status, 200);
  const out = await call(a, 'POST', '/api/logout/all', {});
  assert.equal(out.status, 200);
  assert.equal((await call(a, 'GET', '/api/me')).status, 401);
  assert.equal((await call(b, 'GET', '/api/me')).status, 401);
  // Una sesión nueva (firmada con sv=1) funciona; las demás cuentas no se tocan.
  assert.equal((await call(cookie('lo', 1), 'GET', '/api/me')).status, 200);
  assert.equal((await call('m1', 'GET', '/api/me')).status, 200);
});

test('created sale siempre en ISO, aunque la base tenga ms, segundos o el default de SQLite', async () => {
  const expected = new Date(1700000000000).toISOString();
  const list = (await call('owner', 'GET', '/api/admin/users')).body.users;
  const byId = Object.fromEntries(list.map(u => [u.id, u]));
  for (const id of ['ms', 'sec', 'sql']) {
    assert.equal(byId[id].created, expected, id);
    assert.equal((await call('owner', 'GET', '/api/admin/user?id=' + id)).body.user.created, expected, id);
  }
  assert.match(byId.m1.created, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('invites: note, used_at y users.invited_by se persisten', async () => {
  const detail = await call('owner', 'GET', '/api/admin/user?id=inv');
  assert.equal(detail.body.user.invitedBy, 'INV1');
  const inv = (await call('owner', 'GET', '/api/admin/invites')).body.invites.find(i => i.code === 'INV1');
  assert.equal(inv.note, 'para Ana');
  assert.equal(inv.usedBy, 'inv');
  assert.match(inv.usedAt, /^\d{4}-\d{2}-\d{2}T/);
  const created = await call('owner', 'POST', '/api/admin/invites/new', { note: 'recepción' });
  const listed = (await call('owner', 'GET', '/api/admin/invites')).body.invites.find(i => i.code === created.body.invite.code);
  assert.equal(listed.note, 'recepción');
});

test('device pairing: confirm sin claim previo del mismo usuario es rechazado', async () => {
  const { body: p } = await call(null, 'POST', '/api/auth/device/start', {});
  assert.equal((await call('m1', 'POST', '/api/auth/device/confirm', { pairingId: p.pairingId })).status, 409);
  assert.equal((await call('m1', 'POST', '/api/auth/device/claim', { code: p.manualCode })).status, 200);
  // Otro usuario no puede confirmar el pairing que reclamó m1.
  assert.equal((await call('m2', 'POST', '/api/auth/device/confirm', { pairingId: p.pairingId })).status, 409);
  assert.equal((await call(null, 'GET', '/api/auth/device/poll?pairingId=' + p.pairingId)).body.status, 'pending');
  assert.equal((await call('m1', 'POST', '/api/auth/device/confirm', { pairingId: p.pairingId })).status, 200);
  const poll = await call(null, 'GET', '/api/auth/device/poll?pairingId=' + p.pairingId);
  assert.equal(poll.body.status, 'approved');
  assert.equal(poll.body.user.id, 'm1');
});

test('device pairing: 5 claims fallidos invalidan el pairing', async () => {
  const { body: p } = await call(null, 'POST', '/api/auth/device/start', {});
  assert.equal((await call('m1', 'POST', '/api/auth/device/claim', { code: p.manualCode })).status, 200);
  for (let i = 0; i < 5; i++) {
    assert.equal((await call('m2', 'POST', '/api/auth/device/claim', { code: p.manualCode })).status, 409);
  }
  assert.equal((await call('m1', 'POST', '/api/auth/device/claim', { code: p.manualCode })).status, 400);
  assert.equal((await call('m1', 'POST', '/api/auth/device/confirm', { pairingId: p.pairingId })).status, 400);
  assert.equal((await call(null, 'GET', '/api/auth/device/poll?pairingId=' + p.pairingId)).body.status, 'expired');
});

const from = ip => ({ 'X-Real-IP': ip });

test('rate limit: dos IPs distintas no comparten cupo', async () => {
  const hit = ip => call(null, 'POST', '/api/login/options', {}, from(ip));
  for (let i = 0; i < 60; i++) assert.equal((await hit('203.0.113.1')).status, 200);
  assert.equal((await hit('203.0.113.1')).status, 429);
  assert.equal((await hit('203.0.113.2')).status, 200);
});

test('rate limit: login/verify tiene cupo por credencial además del de IP', async () => {
  // El challenge no existe, así que el handler responde 400; lo que importa es cuándo llega el 429.
  const verify = credId => call(null, 'POST', '/api/login/verify', { cid: 'x', credential: { id: credId } }, from('203.0.113.9'));
  for (let i = 0; i < 10; i++) assert.equal((await verify('cred-A')).status, 400);
  assert.equal((await verify('cred-A')).status, 429);
  assert.equal((await verify('cred-B')).status, 400);   // misma IP, otra credencial: pasa
  assert.equal((await call(null, 'POST', '/api/login/verify', { cid: 'x', credential: { id: 'cred-A' } }, from('203.0.113.10'))).status, 429);
});

test('rate limit: device/claim tiene cupo por usuario', async () => {
  const claim = (uid, ip) => call(uid, 'POST', '/api/auth/device/claim', { code: 'NOPE-NOPE' }, from(ip));
  for (let i = 0; i < 10; i++) assert.equal((await claim('m3', '198.51.100.' + (i + 1))).status, 400);
  assert.equal((await claim('m3', '198.51.100.50')).status, 429);   // otra IP, mismo usuario
  assert.equal((await claim('m4', '198.51.100.50')).status, 400);   // misma IP, otro usuario
});
