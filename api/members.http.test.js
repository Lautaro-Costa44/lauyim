// Levanta server.js sobre una base temporal (igual que billing.http.test.js) y recorre las fichas
// de socio por HTTP: config de campos, alta, perfil, listados, códigos de vinculación, la
// vinculación con una passkey simulada (attestation 'none') y el merge.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays, gymToday } from './billing.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-members-http-'));
process.env.DATA_DIR = dataDir;
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);
const ORIGIN = 'http://localhost:8080';
const RP_ID = 'localhost';

const db = await import('./database.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña' });   // el primer usuario es owner
db.createUser({ id: 'adm', name: 'Admin', admin: true });
for (const [id, name] of [['acc', 'Cuenta Uno'], ['acc2', 'Cuenta Dos'], ['acc3', 'Cuenta Tres']]) db.createUser({ id, name });
for (const id of ['owner', 'adm', 'acc', 'acc2', 'acc3']) db.createCredential({ id: 'cred-' + id, userId: id, publicKey: 'x' });
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
// Cada llamada sale de una IP distinta (X-Real-IP; el test es loopback = proxy de confianza)
// salvo que se pase una: así los cupos por IP no se mezclan entre tests.
async function call(who, method, url, body, ip) {
  const c = !who ? null : who.startsWith('gymsid=') || who.startsWith('__Host') ? who : cookie(who);
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Real-IP': ip || `198.18.${(ipSeq >> 8) & 255}.${ipSeq++ & 255}`, ...(c ? { Cookie: c } : {}) },
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

// Lectura directa de la base (WAL admite un segundo lector mientras el server corre).
const sql = (query, ...params) => db.getDatabase().prepare(query).all(...params);
const auditLog = () => { try { return fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8'); } catch { return ''; } };

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

const ANA = { fullName: 'Ana Pérez', dni: '20.123.456', phone: '11 1234-5678', email: 'Ana@Mail.com' };
let ana;

test('config de campos: GET para admins, PUT solo owner, required implica enabled', async () => {
  const got = await call('adm', 'GET', '/api/admin/members/settings');
  assert.equal(got.status, 200);
  assert.deepEqual(got.body.fields, {
    full_name: { enabled: true, required: true }, dni: { enabled: true, required: true },
    phone: { enabled: true, required: true }, email: { enabled: true, required: false }
  });
  assert.equal((await call('acc', 'GET', '/api/admin/members/settings')).status, 403);
  assert.equal((await call('adm', 'PUT', '/api/admin/members/settings', { fields: { email: { required: true } } })).status, 403);
  assert.equal((await call('owner', 'PUT', '/api/admin/members/settings', { fields: { phone: { enabled: false } } })).status, 400);

  const req = await call('owner', 'PUT', '/api/admin/members/settings', { fields: { email: { required: true } } });
  assert.equal(req.status, 200);
  assert.deepEqual(req.body.fields.email, { enabled: true, required: true });
  const missing = await call('adm', 'POST', '/api/admin/members', { ...ANA, email: undefined });
  assert.equal(missing.status, 400);
  assert.equal(missing.body.field, 'email');
  await call('owner', 'PUT', '/api/admin/members/settings', { fields: { email: { required: false } } });
});

test('alta de ficha: usuario sin passkey, perfil normalizado, plan opcional', async () => {
  const bad = await call('adm', 'POST', '/api/admin/members', { ...ANA, phone: '' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, 'phone');
  assert.equal((await call('adm', 'POST', '/api/admin/members', { ...ANA, dni: undefined })).body.field, 'dni');
  assert.equal((await call('adm', 'POST', '/api/admin/members', { ...ANA, planId: plan.id })).status, 400);   // falta dueDate
  assert.equal((await call('acc', 'POST', '/api/admin/members', ANA)).status, 403);

  const created = await call('adm', 'POST', '/api/admin/members', { ...ANA, name: 'anita', admin: true, owner: true, planId: plan.id, dueDate: addDays(today, 20) });
  assert.equal(created.status, 200);
  ana = created.body.member;
  assert.equal(ana.name, 'anita');
  assert.equal(ana.hasApp, false);
  assert.equal(ana.billing.planId, plan.id);
  const [row] = sql('SELECT admin, owner, created_at FROM users WHERE id = ?', ana.userId);
  assert.deepEqual([row.admin, row.owner], [0, 0]);
  assert.match(row.created_at, /^\d{4}-\d{2}-\d{2}T/);
  const [p] = sql('SELECT * FROM member_profile WHERE user_id = ?', ana.userId);
  assert.deepEqual([p.full_name, p.dni, p.dni_norm, p.phone, p.phone_norm, p.email],
    ['Ana Pérez', '20.123.456', '20123456', '11 1234-5678', '+5491112345678', 'ana@mail.com']);

  // Sin nombre de usuario: toma el nombre y apellido.
  const noName = await call('adm', 'POST', '/api/admin/members', { fullName: 'Beto Gómez', dni: '25111222', phone: '351 15 1234567' });
  assert.equal(noName.body.member.name, 'Beto Gómez');
});

test('DNI duplicado → 409 con los datos de quien lo tiene', async () => {
  const dup = await call('adm', 'POST', '/api/admin/members', { ...ANA, dni: '020123456', fullName: 'Otra Ana' });
  assert.equal(dup.status, 409);
  assert.deepEqual(dup.body, { error: 'dni_duplicado', userId: ana.userId, name: 'anita', hasApp: false });
});

test('lookup por DNI', async () => {
  assert.deepEqual((await call('adm', 'GET', '/api/admin/members/lookup?dni=20123456')).body, { userId: ana.userId, name: 'anita', hasApp: false });
  assert.equal((await call('adm', 'GET', '/api/admin/members/lookup?dni=99999999')).status, 404);
  assert.equal((await call('adm', 'GET', '/api/admin/members/lookup?dni=12')).status, 400);
  assert.equal((await call('acc', 'GET', '/api/admin/members/lookup?dni=20123456')).status, 403);
});

test('perfil: GET/PUT para fichas y cuentas con app; DNI de otra persona → 409', async () => {
  const got = await call('adm', 'GET', `/api/admin/users/${ana.userId}/profile`);
  assert.equal(got.status, 200);
  assert.equal(got.body.profile.dni, '20.123.456');
  assert.equal(got.body.profile.phone, '11 1234-5678');
  assert.ok(got.body.fields.dni);

  // Cuenta con app sin perfil: el primer PUT tiene que traer los obligatorios.
  assert.equal((await call('adm', 'PUT', '/api/admin/users/acc/profile', { email: 'x@y.com' })).status, 400);
  const accProfile = await call('adm', 'PUT', '/api/admin/users/acc/profile', { fullName: 'Carla Uno', dni: '30111222', phone: '0351 15 123-4567' });
  assert.equal(accProfile.status, 200);
  assert.equal(accProfile.body.profile.hasApp, true);
  assert.equal(accProfile.body.profile.phoneNorm, '+5493511234567');

  const clash = await call('adm', 'PUT', '/api/admin/users/acc/profile', { dni: '20.123.456' });
  assert.equal(clash.status, 409);
  assert.deepEqual(clash.body, { error: 'dni_duplicado', userId: ana.userId, name: 'anita', hasApp: false });

  const renamed = await call('adm', 'PUT', `/api/admin/users/${ana.userId}/profile`, { name: 'Ana P', email: '' });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.body.profile.name, 'Ana P');
  assert.equal(renamed.body.profile.email, null);
  assert.equal(sql('SELECT name FROM users WHERE id = ?', ana.userId)[0].name, 'Ana P');
  assert.equal((await call('adm', 'PUT', `/api/admin/users/${ana.userId}/profile`, { fullName: '' })).status, 400);
  assert.equal((await call('adm', 'GET', '/api/admin/users/nadie/profile')).status, 404);
});

test('listados: hasApp y hasProfile, nunca DNI ni celular', async () => {
  const users = await call('adm', 'GET', '/api/admin/users');
  const byId = Object.fromEntries(users.body.users.map(u => [u.id, u]));
  assert.deepEqual([byId[ana.userId].hasApp, byId[ana.userId].hasProfile], [false, true]);
  assert.deepEqual([byId.acc.hasApp, byId.acc.hasProfile], [true, true]);
  assert.deepEqual([byId.acc2.hasApp, byId.acc2.hasProfile], [true, false]);
  const detail = await call('adm', 'GET', `/api/admin/user?id=${ana.userId}`);
  assert.deepEqual([detail.body.user.hasApp, detail.body.user.hasProfile], [false, true]);
  const billing = await call('adm', 'GET', '/api/admin/billing');
  assert.equal(billing.body.members.find(m => m.id === ana.userId).hasApp, false);
  assert.equal(billing.body.members.find(m => m.id === 'acc').hasApp, true);
  for (const r of [users, detail, billing]) {
    const text = JSON.stringify(r.body);
    for (const secret of ['20123456', '20.123.456', '1234-5678', '12345678', '+549', '30111222', 'dni', 'phone']) {
      assert.ok(!text.includes(secret), secret);
    }
  }
  // Las fichas no cuentan como usuarios de la app.
  const heat = await call('adm', 'GET', '/api/admin/attendance-heatmap');
  assert.equal(heat.body.totalUsers, 5);
});

test('DNI deshabilitado: lookup y duplicados responden como no disponibles', async () => {
  assert.equal((await call('owner', 'PUT', '/api/admin/members/settings', { fields: { dni: { enabled: false, required: false } } })).status, 200);
  const lookup = await call('adm', 'GET', '/api/admin/members/lookup?dni=20123456');
  assert.equal(lookup.status, 409);
  assert.equal(lookup.body.error, 'dni_deshabilitado');
  const noDni = await call('adm', 'POST', '/api/admin/members', { ...ANA, fullName: 'Sin DNI' });
  assert.equal(noDni.status, 200);
  assert.equal(sql('SELECT dni_norm FROM member_profile WHERE user_id = ?', noDni.body.member.userId)[0].dni_norm, null);
  // El PUT ignora el DNI y conserva el guardado.
  assert.equal((await call('adm', 'PUT', '/api/admin/users/acc/profile', { dni: '20123456' })).status, 200);
  assert.equal(sql('SELECT dni_norm FROM member_profile WHERE user_id = ?', 'acc')[0].dni_norm, '30111222');
  await call('owner', 'PUT', '/api/admin/members/settings', { fields: { dni: { enabled: true, required: true } } });
});

// El nombre no lleva el DNI: el test de auditoría busca que el DNI completo nunca aparezca.
async function newFicha(dni, over = {}) {
  const r = await call('adm', 'POST', '/api/admin/members', { fullName: 'Ficha ' + dni.slice(-3).replace(/\d/g, d => 'abcdefghij'[d]), dni, phone: '11 5555-0000', ...over });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.member.userId;
}
const linkOptions = (code, ip) => call(null, 'POST', '/api/link/options', { code }, ip);

test('link-code: formato, un solo vigente, revocar, vencido, no para cuentas con app ni desactivados', async () => {
  const issued = await call('adm', 'POST', `/api/admin/users/${ana.userId}/link-code`, {});
  assert.equal(issued.status, 200);
  assert.match(issued.body.code, /^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
  assert.equal(issued.body.link, `${ORIGIN}/?link=${issued.body.code}`);
  const ttl = Date.parse(issued.body.expiresAt) - Date.now();
  assert.ok(ttl > 71.9 * 3600000 && ttl <= 72 * 3600000, String(ttl));
  // Solo el hash queda en la base.
  assert.equal(sql('SELECT COUNT(*) AS n FROM link_codes WHERE code_hash = ?', issued.body.code)[0].n, 0);

  const opts = await linkOptions(issued.body.code.toLowerCase().replace('-', ''));
  assert.equal(opts.status, 200);
  assert.equal(opts.body.name, 'Ana P');
  assert.equal(opts.body.fullName, 'Ana Pérez');

  const second = await call('adm', 'POST', `/api/admin/users/${ana.userId}/link-code`, {});
  assert.equal((await linkOptions(issued.body.code)).body.error, 'link_invalid');
  assert.equal((await linkOptions(second.body.code)).status, 200);
  const revoked = await call('adm', 'DELETE', `/api/admin/users/${ana.userId}/link-code`);
  assert.deepEqual(revoked.body, { ok: true, revoked: 1 });
  assert.equal((await linkOptions(second.body.code)).status, 400);

  const third = await call('adm', 'POST', `/api/admin/users/${ana.userId}/link-code`, {});
  db.getDatabase().prepare('UPDATE link_codes SET expires_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(new Date(Date.now() - 1000).toISOString(), ana.userId);
  assert.equal((await linkOptions(third.body.code)).status, 400);

  assert.equal((await call('adm', 'POST', '/api/admin/users/acc/link-code', {})).status, 409);
  const off = await newFicha('40111222');
  await call('adm', 'POST', '/api/admin/user/disable', { id: off, disabled: true });
  assert.equal((await call('adm', 'POST', `/api/admin/users/${off}/link-code`, {})).status, 409);
  assert.equal((await call('acc', 'POST', `/api/admin/users/${ana.userId}/link-code`, {})).status, 403);
});

test('vinculación: passkey nueva, sesión, un solo uso; un socio bloqueado por cuota vincula igual', async () => {
  const fichaId = await newFicha('40222333', { planId: plan.id, dueDate: addDays(today, -30) });
  const { body: issued } = await call('adm', 'POST', `/api/admin/users/${fichaId}/link-code`, {});
  const opts = await linkOptions(issued.code);
  assert.equal(opts.status, 200);
  const credential = fakeRegistration(opts.body.options.challenge);
  const verified = await call(null, 'POST', '/api/link/verify', { cid: opts.body.cid, credential, healthConsent: true });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  assert.equal(verified.body.user.id, fichaId);
  const session = verified.setCookie.find(c => c.startsWith('gymsid='));
  assert.ok(session);

  const me = await call(session.split(';')[0], 'GET', '/api/me');
  assert.equal(me.status, 200);
  assert.equal(me.body.user.id, fichaId);
  assert.equal(me.body.billing.blocked, true);
  assert.equal(sql('SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?', fichaId)[0].n, 1);
  assert.ok(sql('SELECT used_at FROM link_codes WHERE user_id = ?', fichaId)[0].used_at);

  assert.equal((await linkOptions(issued.code)).status, 400);                                  // un solo uso
  assert.equal((await call('adm', 'POST', `/api/admin/users/${fichaId}/link-code`, {})).status, 409);   // ya tiene app
  assert.equal((await call('adm', 'GET', `/api/admin/user?id=${fichaId}`)).body.user.hasApp, true);
});

test('vinculación: 5 verificaciones fallidas revocan el código', async () => {
  const fichaId = await newFicha('40333444');
  const { body: issued } = await call('adm', 'POST', `/api/admin/users/${fichaId}/link-code`, {});
  for (let i = 0; i < 5; i++) {
    const opts = await linkOptions(issued.code);
    assert.equal(opts.status, 200, `intento ${i}`);
    const bad = await call(null, 'POST', '/api/link/verify', { cid: opts.body.cid, healthConsent: true, credential: { id: 'x', rawId: 'x', type: 'public-key', response: {} } });
    assert.equal(bad.status, 400);
  }
  assert.equal((await linkOptions(issued.code)).status, 400);
  const [row] = sql('SELECT failed_attempts, revoked_at, used_at FROM link_codes WHERE user_id = ?', fichaId);
  assert.equal(row.failed_attempts, 5);
  assert.ok(row.revoked_at);
  assert.equal(row.used_at, null);
  assert.ok(auditLog().includes('"msg":"link-revoked"'));
});

test('link/*: cupo por IP y sin CSRF (como register)', async () => {
  const ip = '203.0.113.77';
  // Códigos distintos: el cupo por código (20) no interviene, solo el de IP.
  const code = i => 'ZZZZ-Z' + '23456789ABCDEFGHJKMNPQRSTUVWXYZ'[i] + 'ZZ';
  for (let i = 0; i < 30; i++) assert.equal((await linkOptions(code(i), ip)).status, 400);
  assert.equal((await linkOptions(code(30), ip)).status, 429);
  const crossSite = await fetch(BASE + '/api/link/options', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'cross-site', 'X-Real-IP': '203.0.113.78' },
    body: JSON.stringify({ code: 'ZZZZ-ZZZZ' })
  });
  assert.equal(crossSite.status, 400);   // llega al handler: no es el 403 de CSRF
});

test('merge por HTTP: dry run sin cambios, conflicto de plan, elección respetada, ficha borrada', async () => {
  const fichaId = await newFicha('40444555', { planId: plan.id, dueDate: addDays(today, 10) });
  assert.equal((await call('adm', 'POST', `/api/admin/users/${fichaId}/payments`, { method: 'efectivo' })).status, 200);
  await call('adm', 'PUT', '/api/admin/users/acc2/billing', { planId: plan.id, dueDate: addDays(today, 60) });

  const before = JSON.stringify(sql('SELECT user_id, COUNT(*) AS n FROM payments GROUP BY user_id ORDER BY user_id'));
  const dry = await call('adm', 'POST', `/api/admin/users/${fichaId}/merge`, { targetId: 'acc2', dry_run: true });
  assert.equal(dry.status, 200);
  assert.equal(dry.body.dry_run, true);
  assert.equal(dry.body.payments, 1);
  assert.equal(dry.body.billing.conflict, true);
  assert.deepEqual(dry.body.profile, { ficha: true, cuenta: false, conflict: false, action: 'move' });
  assert.equal(JSON.stringify(sql('SELECT user_id, COUNT(*) AS n FROM payments GROUP BY user_id ORDER BY user_id')), before);
  assert.ok(sql('SELECT id FROM users WHERE id = ?', fichaId).length);

  const conflict = await call('adm', 'POST', `/api/admin/users/${fichaId}/merge`, { targetId: 'acc2' });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.error, 'billing_conflict');
  assert.equal((await call('adm', 'POST', `/api/admin/users/${fichaId}/merge`, { targetId: 'acc2', keepBilling: 'otra' })).status, 400);

  const fichaDue = sql('SELECT due_date FROM member_billing WHERE user_id = ?', fichaId)[0].due_date;
  const merged = await call('adm', 'POST', `/api/admin/users/${fichaId}/merge`, { targetId: 'acc2', keepBilling: 'ficha' });
  assert.equal(merged.status, 200, JSON.stringify(merged.body));
  assert.equal(sql('SELECT id FROM users WHERE id = ?', fichaId).length, 0);
  assert.equal(sql('SELECT due_date FROM member_billing WHERE user_id = ?', 'acc2')[0].due_date, fichaDue);
  const pays = sql('SELECT user_id, user_name FROM payments WHERE user_name = ?', 'Ficha fff');
  assert.deepEqual(pays.map(p => ({ ...p })), [{ user_id: 'acc2', user_name: 'Ficha fff' }]);
  assert.equal(sql('SELECT dni_norm FROM member_profile WHERE user_id = ?', 'acc2')[0].dni_norm, '40444555');
});

test('merge: precondiciones por HTTP (cualquier admin puede)', async () => {
  const fichaId = await newFicha('40555666');
  assert.equal((await call('acc', 'POST', `/api/admin/users/${fichaId}/merge`, { targetId: 'acc3' })).status, 403);
  assert.equal((await call('adm', 'POST', `/api/admin/users/${fichaId}/merge`, {})).status, 400);
  assert.equal((await call('adm', 'POST', `/api/admin/users/${fichaId}/merge`, { targetId: fichaId })).status, 400);
  assert.equal((await call('adm', 'POST', `/api/admin/users/${fichaId}/merge`, { targetId: 'owner' })).body.error, 'target_is_staff');
  assert.equal((await call('adm', 'POST', `/api/admin/users/${fichaId}/merge`, { targetId: ana.userId })).body.error, 'target_without_app');
  assert.equal((await call('adm', 'POST', '/api/admin/users/acc/merge', { targetId: 'acc3' })).body.error, 'ficha_has_app');
  assert.equal((await call('adm', 'POST', '/api/admin/users/nadie/merge', { targetId: 'acc3' })).status, 404);
  // DNI distinto en los dos perfiles.
  await call('adm', 'PUT', '/api/admin/users/acc3/profile', { fullName: 'Tres', dni: '41000000', phone: '11 4444-5555' });
  const clash = await call('adm', 'POST', `/api/admin/users/${fichaId}/merge`, { targetId: 'acc3' });
  assert.equal(clash.status, 409);
  assert.equal(clash.body.error, 'dni_conflict');
  // Admin (no owner) hace el merge cuando no hay conflicto.
  const clean = await newFicha('40666777');
  await call('adm', 'PUT', `/api/admin/users/${clean}/profile`, { dni: '' }).then(r => assert.equal(r.status, 400));   // DNI obligatorio
  await call('owner', 'PUT', '/api/admin/members/settings', { fields: { dni: { required: false } } });
  await call('adm', 'PUT', `/api/admin/users/${clean}/profile`, { dni: '' });
  assert.equal((await call('adm', 'POST', `/api/admin/users/${clean}/merge`, { targetId: 'acc3' })).status, 200);
});

test('auditoría: eventos nuevos, DNI enmascarado, nunca el celular ni el DNI completo', async () => {
  const log = auditLog();
  for (const ev of ['admin.member.create', 'admin.member.profile_update', 'admin.member.link_code', 'admin.member.link_code_revoke',
    'admin.member.merge', 'auth.link.ok', 'auth.link.fail', 'owner.member.fields']) {
    assert.ok(log.includes(`"ev":"${ev}"`), ev);
  }
  assert.ok(log.includes('DNI ***456'));
  for (const secret of ['20123456', '20.123.456', '1234-5678', '5555-0000', '+549', '40222333', '30111222']) {
    assert.ok(!log.includes(secret), secret);
  }
});
