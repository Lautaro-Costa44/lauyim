// Pasar el rol de dueño sobre server.js de verdad, con passkeys simuladas (aserciones firmadas de
// verdad): solo el dueño, destinos válidos, la passkey tiene que ser del dueño y con verificación,
// desafío de un solo uso, y el cambio (la ex dueña pasa a Administrador). Puertos 52000–52989.
// owner-transfer-off.http.test.js lo corre con OWNER_TRANSFER_ENABLED=false.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ENABLED = process.env.OWNER_TRANSFER_TEST_OFF ? 'false' : 'true';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-owner-transfer-'));
process.env.DATA_DIR = dataDir;
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);
const ORIGIN = 'http://localhost:8080';
const RP_ID = 'localhost';

// --- passkeys simuladas (aserciones firmadas de verdad) ---
function cbor(value) {
  const head = (major, n) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b;
  };
  if (typeof value === 'number') return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  const parts = [head(5, value.size)];
  for (const [k, v] of value) parts.push(cbor(k), cbor(v));
  return Buffer.concat(parts);
}
function newPasskey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
  return { id: crypto.randomBytes(16).toString('base64url'), cose: cose.toString('base64url'), privateKey, counter: 0 };
}
function assertion(key, challenge) {
  key.counter += 1;
  const count = Buffer.alloc(4); count.writeUInt32BE(key.counter);
  const authData = Buffer.concat([crypto.createHash('sha256').update(RP_ID).digest(), Buffer.from([0x05]), count]);
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: ORIGIN, crossOrigin: false }));
  const signature = crypto.sign('sha256', Buffer.concat([authData, crypto.createHash('sha256').update(clientDataJSON).digest()]), key.privateKey);
  return { id: key.id, rawId: key.id, type: 'public-key', response: { authenticatorData: authData.toString('base64url'), clientDataJSON: clientDataJSON.toString('base64url'), signature: signature.toString('base64url') }, clientExtensionResults: {} };
}

// --- datos ---
const db = await import('./database.js');
db.initDatabase();
const keys = { owner: newPasskey(), owner2: newPasskey(), ana: newPasskey(), adm: newPasskey() };
db.createUser({ id: 'owner', name: 'Dueña' });
db.createCredential({ id: keys.owner.id, userId: 'owner', publicKey: keys.owner.cose });
db.createCredential({ id: keys.owner2.id, userId: 'owner', publicKey: keys.owner2.cose });
db.createUser({ id: 'ana', name: 'Ana' });
db.createCredential({ id: keys.ana.id, userId: 'ana', publicKey: keys.ana.cose });
db.setUserRole('ana', 'coach');
db.createUser({ id: 'adm', name: 'Admin', admin: true });
db.createCredential({ id: keys.adm.id, userId: 'adm', publicKey: keys.adm.cose });
db.createUser({ id: 'ficha', name: 'Ficha', member: true });
db.createUser({ id: 'off', name: 'Off' }); db.createCredential({ id: 'c-off', userId: 'off', publicKey: 'x' }); db.updateUser('off', { disabled: true });
db.createUser({ id: 'pend', name: 'Pend', pending: true }); db.createCredential({ id: 'c-pend', userId: 'pend', publicKey: 'x' });
db.closeDatabase();

const PORT = (process.env.OWNER_TRANSFER_TEST_OFF ? 52900 : 52000) + Math.floor(Math.random() * 90);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
const cookie = uid => {
  const payload = `${uid}:${Date.now() + 3600000}:0`;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
async function call(who, method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(who ? { Cookie: cookie(who) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL('./server.js', import.meta.url))], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), LICENSE_EXPIRES_AT: '', LICENSE_PAID_UNTIL: '', ADMIN_UIDS: '', ORIGIN, RP_ID, OWNER_TRANSFER_ENABLED: ENABLED },
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

const start = (who, userId) => call(who, 'POST', '/api/owner/transfer/options', { userId });
const finish = (who, cid, credential) => call(who, 'POST', '/api/owner/transfer/verify', { cid, credential });
const auditLog = () => { try { return fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8'); } catch { return ''; } };

if (ENABLED === 'true') {
  test('config avisa que está prendido', async () => {
    assert.equal((await call(null, 'GET', '/api/config')).body.owner_transfer_enabled, true);
  });

  test('solo el dueño; destinos que no pueden ser dueños', async () => {
    assert.equal((await start('adm', 'ana')).status, 403);
    assert.equal((await start('owner', 'nadie')).status, 404);
    for (const [id, err] of [['owner', 'already_owner'], ['ficha', 'no_passkey'], ['off', 'inactive'], ['pend', 'inactive']]) {
      const r = await start('owner', id);
      assert.deepEqual([r.status, r.body.error], [400, err], id);
    }
  });

  test('las opciones piden verificación y solo las passkeys del dueño', async () => {
    const r = await start('owner', 'ana');
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.options.userVerification, 'required');
    assert.deepEqual(r.body.options.allowCredentials.map(c => c.id).sort(), [keys.owner.id, keys.owner2.id].sort());
  });

  test('passkey de otro, sesión de otro o desafío inexistente: no cambia nada', async () => {
    let r = await start('owner', 'ana');
    assert.equal((await finish('owner', r.body.cid, assertion(keys.adm, r.body.options.challenge))).status, 403);
    r = await start('owner', 'ana');
    assert.equal((await finish('adm', r.body.cid, assertion(keys.owner, r.body.options.challenge))).status, 403);   // adm no es dueño
    r = await start('owner', 'ana');
    assert.equal((await finish('owner', 'otro-cid', assertion(keys.owner, r.body.options.challenge))).body.error, 'challenge_expired');
    assert.equal((await call('ana', 'GET', '/api/owner/branding')).status, 403);   // ana sigue sin ser dueña
    assert.match(auditLog(), /owner\.transfer\.denied/);
  });

  test('el cambio: ana dueña sin rol, la ex dueña Administrador; queda en el registro; el desafío no se reusa', async () => {
    const r = await start('owner', 'ana');
    const cred = assertion(keys.owner, r.body.options.challenge);
    const v = await finish('owner', r.body.cid, cred);
    assert.equal(v.status, 200, JSON.stringify(v.body));
    assert.deepEqual(v.body, { ok: true, owner: { id: 'ana', name: 'Ana' } });
    const meAna = (await call('ana', 'GET', '/api/me')).body.user;
    const meOld = (await call('owner', 'GET', '/api/me')).body.user;
    assert.deepEqual([meAna.owner, meAna.role], [true, null]);
    assert.deepEqual([meOld.owner, meOld.role?.id], [false, 'admin']);
    assert.equal((await call('owner', 'GET', '/api/owner/branding')).status, 403);
    assert.equal((await call('ana', 'GET', '/api/owner/branding')).status, 200);
    assert.equal((await finish('ana', r.body.cid, cred)).body.error, 'challenge_expired');
    assert.match(auditLog(), /owner\.transfer[^.]/);
  });
} else {
  test('apagado: config lo dice y las rutas responden owner_transfer_disabled', async () => {
    assert.equal((await call(null, 'GET', '/api/config')).body.owner_transfer_enabled, false);
    const r = await start('owner', 'ana');
    assert.deepEqual([r.status, r.body.error], [403, 'owner_transfer_disabled']);
  });
}
