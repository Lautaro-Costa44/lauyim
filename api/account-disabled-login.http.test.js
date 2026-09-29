// Cuenta dada de baja en los caminos de ingreso: passkey (login/verify), código del gym
// (link/options y link/verify) y pareo de dispositivo (device/poll). Cada uno dice
// account_disabled / account_rejected SOLO después de validar la aserción, el código o el pareo,
// y nunca crea una sesión. Un pedido sin credencial válida no aprende nada del estado de la cuenta.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-disabled-login-'));
process.env.DATA_DIR = dataDir;
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);
const ORIGIN = 'http://localhost:8080';
const RP_ID = 'localhost';

// --- passkey simulada con clave privada propia: sirve para firmar aserciones reales ---
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
function newPasskey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = cbor(new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]));
  return { id: crypto.randomBytes(16).toString('base64url'), cose: cose.toString('base64url'), privateKey, counter: 0 };
}
function assertion(key, challenge, { tamper = false } = {}) {
  key.counter += 1;
  const count = Buffer.alloc(4); count.writeUInt32BE(key.counter);
  const authData = Buffer.concat([crypto.createHash('sha256').update(RP_ID).digest(), Buffer.from([0x05]), count]);
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: ORIGIN, crossOrigin: false }));
  const signed = Buffer.concat([authData, crypto.createHash('sha256').update(clientDataJSON).digest()]);
  const signature = crypto.sign('sha256', tamper ? Buffer.concat([signed, Buffer.from('x')]) : signed, key.privateKey);
  return {
    id: key.id, rawId: key.id, type: 'public-key',
    response: { authenticatorData: authData.toString('base64url'), clientDataJSON: clientDataJSON.toString('base64url'), signature: signature.toString('base64url') },
    clientExtensionResults: {}
  };
}
function fakeRegistration(challenge) {
  const key = newPasskey();
  const len = Buffer.alloc(2); len.writeUInt16BE(16);
  const credId = Buffer.from(key.id, 'base64url');
  const authData = Buffer.concat([crypto.createHash('sha256').update(RP_ID).digest(), Buffer.from([0x45]), Buffer.alloc(4), Buffer.alloc(16), len, credId, Buffer.from(key.cose, 'base64url')]);
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge, origin: ORIGIN, crossOrigin: false }));
  const attestationObject = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
  return {
    id: key.id, rawId: key.id, type: 'public-key',
    response: { clientDataJSON: clientDataJSON.toString('base64url'), attestationObject: attestationObject.toString('base64url'), transports: ['internal'] },
    clientExtensionResults: {}
  };
}

const db = await import('./database.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña' });
db.createUser({ id: 'adm', name: 'Admin', admin: true });
db.createCredential({ id: 'cred-owner', userId: 'owner', publicKey: 'x' });
db.createCredential({ id: 'cred-adm', userId: 'adm', publicKey: 'x' });
const keys = {};
for (const id of ['activo', 'baja', 'rechazado', 'pareo']) {
  db.createUser({ id, name: id, pending: id === 'rechazado' });
  keys[id] = newPasskey();
  db.createCredential({ id: keys[id].id, userId: id, publicKey: keys[id].cose });
}
db.updateUser('baja', { disabled: true });
db.updateUser('rechazado', { disabled: true });
db.closeDatabase();

const PORT = 48000 + Math.floor(Math.random() * 1500);
const BASE = `http://127.0.0.1:${PORT}`;
let server, ipSeq = 0;
const cookie = uid => {
  const payload = `${uid}:${Date.now() + 3600000}:0`;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
async function call(who, method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Real-IP': `198.19.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`, ...(who ? { Cookie: cookie(who) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => ({})), setCookie: res.headers.getSetCookie?.() || [] };
}
const sql = (query, ...params) => { db.initDatabase(); return db.getDatabase().prepare(query).all(...params); };

before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL('./server.js', import.meta.url))], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), LICENSE_EXPIRES_AT: '', ORIGIN, RP_ID },
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

const login = async (who, opts) => {
  const o = await call(null, 'POST', '/api/login/options', {});
  return call(null, 'POST', '/api/login/verify', { cid: o.body.cid, credential: assertion(keys[who], o.body.options.challenge, opts) });
};

test('passkey: una cuenta activa entra (valida el helper de aserciones)', async () => {
  const r = await login('activo');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.setCookie.find(c => c.startsWith('gymsid=')));
});

test('passkey: aserción válida de una cuenta desactivada → 403 account_disabled, sin sesión', async () => {
  const r = await login('baja');
  assert.deepEqual([r.status, r.body.error], [403, 'account_disabled']);
  assert.equal(r.setCookie.length, 0);
});

test('passkey: aserción válida de una cuenta rechazada → 403 account_rejected, sin sesión', async () => {
  const r = await login('rechazado');
  assert.deepEqual([r.status, r.body.error], [403, 'account_rejected']);
  assert.equal(r.setCookie.length, 0);
});

test('passkey: aserción inválida no revela el estado de la cuenta', async () => {
  for (const who of ['activo', 'baja', 'rechazado']) {
    const r = await login(who, { tamper: true });
    assert.equal(r.status, 400, who);
    assert.doesNotMatch(JSON.stringify(r.body), /account_/);
  }
  const o = await call(null, 'POST', '/api/login/options', {});
  const unknown = await call(null, 'POST', '/api/login/verify', { cid: o.body.cid, credential: assertion(newPasskey(), o.body.options.challenge) });
  assert.equal(unknown.status, 404);
  assert.doesNotMatch(JSON.stringify(unknown.body), /account_/);
});

// --- código del gym (ficha sin app) ---
async function newFicha(dni) {
  const r = await call('adm', 'POST', '/api/admin/members', { fullName: 'Ficha ' + dni.slice(-3).replace(/\d/g, d => 'abcdefghij'[d]), dni, phone: '11 5555-0000' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.member.userId;
}
const issueCode = async fichaId => (await call('adm', 'POST', `/api/admin/users/${fichaId}/link-code`, {})).body.code;

test('código del gym: código válido de una ficha desactivada → 403 account_disabled; código inválido no revela nada', async () => {
  const fichaId = await newFicha('50111222');
  const code = await issueCode(fichaId);
  assert.ok(code);
  assert.equal((await call('adm', 'POST', '/api/admin/user/disable', { id: fichaId, disabled: true })).status, 200);
  const r = await call(null, 'POST', '/api/link/options', { code });
  assert.deepEqual([r.status, r.body.error], [403, 'account_disabled']);
  assert.equal(r.setCookie.length, 0);
  const wrong = await call(null, 'POST', '/api/link/options', { code: 'AAAA-AAAA' });
  assert.deepEqual([wrong.status, wrong.body.error], [400, 'link_invalid']);
});

test('código del gym: baja entre el código y la vinculación → 403, sin crear la passkey ni gastar el código', async () => {
  const fichaId = await newFicha('50222333');
  const code = await issueCode(fichaId);
  const opts = await call(null, 'POST', '/api/link/options', { code });
  assert.equal(opts.status, 200);
  await call('adm', 'POST', '/api/admin/user/disable', { id: fichaId, disabled: true });
  const verified = await call(null, 'POST', '/api/link/verify', { cid: opts.body.cid, healthConsent: true, credential: fakeRegistration(opts.body.options.challenge) });
  assert.deepEqual([verified.status, verified.body.error], [403, 'account_disabled']);
  assert.equal(verified.setCookie.length, 0);
  assert.equal(sql('SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?', fichaId)[0].n, 0);
  assert.equal(sql('SELECT used_at FROM link_codes WHERE user_id = ?', fichaId)[0].used_at, null);
});

// --- pareo de dispositivo ---
test('pareo: aprobado y dado de baja antes del poll → 403 account_disabled, sin sesión; activo entra', async () => {
  const pair = async () => {
    const start = await call(null, 'POST', '/api/auth/device/start', {});
    const { pairingId, manualCode } = start.body;
    assert.equal((await call('pareo', 'POST', '/api/auth/device/claim', { code: manualCode })).status, 200);
    assert.equal((await call('pareo', 'POST', '/api/auth/device/confirm', { pairingId })).status, 200);
    return pairingId;
  };
  const okPairing = await pair();
  const ok = await call(null, 'GET', `/api/auth/device/poll?pairingId=${okPairing}`);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.ok(ok.setCookie.find(c => c.startsWith('gymsid=')));

  const pairing = await pair();
  db.initDatabase(); db.updateUser('pareo', { disabled: true }); db.closeDatabase();
  const r = await call(null, 'GET', `/api/auth/device/poll?pairingId=${pairing}`);
  assert.deepEqual([r.status, r.body.error], [403, 'account_disabled']);
  assert.equal(r.setCookie.length, 0);
  const unknown = await call(null, 'GET', '/api/auth/device/poll?pairingId=nope');
  assert.doesNotMatch(JSON.stringify(unknown.body), /account_/);
});

// --- atajo de Cuotas (Entrega 3.2): la ficha de cuota dice el estado de la cuenta y un admin
// que no es owner desactiva / reactiva con el mismo endpoint de Usuarios, que queda en el log.
test('ficha de cuota: account { disabled, hasApp, staff }; un admin no owner desactiva y reactiva, con log', async () => {
  const billingOf = async id => (await call('adm', 'GET', `/api/admin/users/${id}/billing`)).body.account;
  assert.deepEqual(await billingOf('activo'), { disabled: false, hasApp: true, staff: false });
  assert.deepEqual(await billingOf('adm'), { disabled: false, hasApp: true, staff: true });
  const ficha = await newFicha('50333444');
  assert.deepEqual(await billingOf(ficha), { disabled: false, hasApp: false, staff: false });

  assert.equal((await call('adm', 'POST', '/api/admin/user/disable', { id: 'activo', disabled: true })).status, 200);
  assert.equal((await billingOf('activo')).disabled, true);
  assert.equal((await call('adm', 'POST', '/api/admin/user/disable', { id: 'activo', disabled: false })).status, 200);
  assert.equal((await billingOf('activo')).disabled, false);
  const log = fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8');
  assert.match(log, /"admin\.user\.disable"[^\n]*"activo"|"activo"[^\n]*"admin\.user\.disable"/);
  assert.match(log, /admin\.user\.enable/);
});
