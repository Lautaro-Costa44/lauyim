// Ingreso Físico por HTTP: opciones (solo owner), dispositivos (token solo como sha256),
// búsqueda con tickets opacos, registro con un ingreso por día, gráfico de asistencia, módulo
// apagado, revocar y salida con passkey de admin. Los casos de "Probar" del spec.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays, gymToday } from './billing.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-checkin-'));
process.env.DATA_DIR = dataDir;
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);
const ORIGIN = 'http://localhost:8080';
const RP_ID = 'localhost';
const today = gymToday(Date.now(), 'America/Argentina/Buenos_Aires');

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
const keys = { adm: newPasskey(), juan: newPasskey() };
db.createUser({ id: 'owner', name: 'Dueña' });
db.createUser({ id: 'adm', name: 'Admin', admin: true });
db.createCredential({ id: 'cred-owner', userId: 'owner', publicKey: 'x' });
db.createCredential({ id: keys.adm.id, userId: 'adm', publicKey: keys.adm.cose });
const profile = (fullName, dni) => ({ fullName, dni, dniNorm: dni, phone: null, phoneNorm: null, email: null });
function member(id, fullName, dni, { app = false, disabled = false, pending = false } = {}) {
  db.createUser({ id, name: id, pending });
  db.writeRegistrationProfile(id, profile(fullName, dni));
  if (app) db.createCredential({ id: keys[id]?.id || 'cred-' + id, userId: id, publicKey: keys[id]?.cose || 'x' });
  if (disabled) db.updateUser(id, { disabled: true });
}
member('juan', 'Juan Pérez', '30111222', { app: true });
member('ficha', 'Ana Gómez', '40111333');                          // sin app
member('venc', 'Vera Vencida', '20500501');
member('bloq', 'Bruno Bloqueado', '20500502');
member('prueba', 'Pía Prueba', '20500503');
member('off', 'Oscar Off', '33333999', { disabled: true });
member('pend', 'Pedro Pendiente', '34444999', { pending: true });
member('rech', 'Rita Rechazada', '35555999', { pending: true, disabled: true });
for (const [i, n] of ['Carla Uno', 'Carlos Dos', 'Carmen Tres'].entries()) member('c' + i, n, `2${i}004444`);
for (let i = 0; i < 6; i++) member('m' + i, 'Muchos ' + i, `2${i}005555`);
const plan = db.createPlan({ name: 'Mensual', price: 10000, durationDays: 30 });
db.setMemberBilling('juan', { planId: plan.id, dueDate: addDays(today, 3) });
db.setMemberBilling('venc', { planId: plan.id, dueDate: addDays(today, -2) });
db.setMemberBilling('bloq', { planId: plan.id, dueDate: addDays(today, -40) });
db.getDatabase().prepare('INSERT INTO member_billing (user_id, trial_until, updated_at) VALUES (?, ?, ?)').run('prueba', addDays(today, 1), Date.now());
db.closeDatabase();

const PORT = 49600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
const cookie = uid => {
  const payload = `${uid}:${Date.now() + 3600000}:0`;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
async function call(who, method, url, body, { token, ip = '198.20.0.1' } = {}) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Real-IP': ip, ...(who ? { Cookie: cookie(who) } : {}), ...(token ? { 'X-Checkin-Token': token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => ({})), setCookie: res.headers.getSetCookie?.() || [] };
}
const sql = (q, ...p) => { db.initDatabase(); try { return db.getDatabase().prepare(q).all(...p).map(r => ({ ...r })); } finally { db.closeDatabase(); } };
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
  if (server && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const setSettings = patch => call('owner', 'PUT', '/api/owner/checkin/settings', patch);
const newDevice = async (name = 'Tablet recepción', who = 'adm') => (await call(who, 'POST', '/api/admin/checkin/devices', { name })).body;
const lookup = (token, dni, opts) => call(null, 'POST', '/api/checkin/lookup', { dni }, { token, ...opts });
const confirm = (token, ticket) => call(null, 'POST', '/api/checkin/confirm', { ticket }, { token });
async function checkIn(token, dni) {
  const l = await lookup(token, dni);
  assert.equal(l.body.status, 'found', JSON.stringify(l.body));
  assert.equal(l.body.candidates.length, 1);
  return confirm(token, l.body.candidates[0].ticket);
}

test('arranca apagado: el admin no owner no ve la sección, el owner sí, y nada del dispositivo funciona', async () => {
  assert.deepEqual(sql("SELECT value FROM admin_settings WHERE key = 'ingreso_fisico_enabled'"), [{ value: 'false' }]);
  assert.deepEqual((await call('adm', 'GET', '/api/admin/checkin')).body, { error: 'feature_disabled' });
  const own = await call('owner', 'GET', '/api/admin/checkin');
  assert.equal(own.status, 200);
  assert.equal(own.body.settings.enabled, false);
  assert.equal((await call('adm', 'POST', '/api/admin/checkin/devices', { name: 'X' })).body.error, 'feature_disabled');
  assert.deepEqual((await lookup('cualquier-token-de-mas-de-veinte', '30111222')).body, { error: 'feature_disabled' });
});

test('config: solo el owner; valida modo y dígitos', async () => {
  assert.equal((await call('adm', 'PUT', '/api/owner/checkin/settings', { enabled: true })).status, 403);
  assert.equal((await setSettings({ digits: 7 })).status, 400);
  assert.equal((await setSettings({ mode: 'otro' })).status, 400);
  const on = await setSettings({ enabled: true, mode: 'full' });
  assert.deepEqual(on.body.settings, { enabled: true, mode: 'full', digits: 4, showStatus: true });
});

test('dispositivo: token de 32 bytes, en la base solo el sha256; sin token o con uno inventado → 401', async () => {
  const { token, device } = await newDevice();
  assert.equal(Buffer.from(token, 'base64url').length, 32);
  const [row] = sql('SELECT token_hash FROM checkin_devices WHERE id = ?', device.id);
  assert.equal(row.token_hash, crypto.createHash('sha256').update(token).digest('hex'));
  assert.ok(!JSON.stringify(sql('SELECT * FROM checkin_devices')).includes(token));
  assert.equal((await lookup(undefined, '30111222')).status, 401);
  assert.equal((await lookup('x'.repeat(43), '30111222')).body.error, 'device_revoked');
  // Un token de dispositivo no sirve como sesión: el resto de la API sigue sin sesión.
  assert.equal((await call(null, 'GET', '/api/me', undefined, { token })).status, 401);
  assert.equal((await call(null, 'GET', '/api/admin/users', undefined, { token })).status, 401);
});

test('DNI completo: saludo, estado de cuota y días en gym_tz; el log no tiene el DNI completo', async () => {
  const { token } = await newDevice();
  assert.deepEqual((await call(null, 'POST', '/api/checkin/info', {}, { token })).body, { name: 'Tablet recepción', mode: 'full', digits: 4 });
  const r = await checkIn(token, '30.111.222');
  assert.deepEqual(r.body, { status: 'registered', fullName: 'Juan Pérez', nick: 'juan', billing: { status: 'por_vencer', days: 3 } });
  assert.deepEqual(sql('SELECT user_id, date, source FROM attendance WHERE user_id = ?', 'juan'), [{ user_id: 'juan', date: today, source: 'physical' }]);
  assert.ok(!auditLog().includes('30111222'));
  const miss = await lookup(token, '39999999');
  assert.deepEqual([miss.body.status, miss.body.candidates], ['not_found', []]);
  assert.ok(auditLog().includes('dni=***999'));
  assert.ok(!auditLog().includes('39999999'));
});

test('doble ingreso el mismo día: "already", sin otra fila', async () => {
  const { token } = await newDevice();
  const r = await checkIn(token, '30111222');
  assert.equal(r.body.status, 'already');
  assert.equal(sql('SELECT COUNT(*) AS n FROM attendance WHERE user_id = ?', 'juan')[0].n, 1);
});

test('ficha sin app, vencido, bloqueado y en prueba: se registran igual, cada uno con su estado', async () => {
  const { token } = await newDevice();
  assert.deepEqual((await checkIn(token, '40111333')).body, { status: 'registered', fullName: 'Ana Gómez', nick: 'ficha', billing: { status: 'sin_plan', days: null } });
  assert.deepEqual((await checkIn(token, '20500501')).body.billing, { status: 'vencido', days: -2 });
  assert.deepEqual((await checkIn(token, '20500502')).body.billing, { status: 'bloqueado', days: -40 });
  assert.deepEqual((await checkIn(token, '20500503')).body.billing, { status: 'prueba', days: 1 });
  assert.equal(sql("SELECT COUNT(*) AS n FROM attendance WHERE user_id IN ('ficha', 'venc', 'bloq', 'prueba')")[0].n, 4);
});

test('desactivadas, pendientes y rechazadas: como no encontradas, sin registrar', async () => {
  const { token } = await newDevice();
  for (const dni of ['33333999', '34444999', '35555999']) assert.equal((await lookup(token, dni)).body.status, 'not_found', dni);
  assert.equal(sql("SELECT COUNT(*) AS n FROM attendance WHERE user_id IN ('off', 'pend', 'rech')")[0].n, 0);
});

test('últimos dígitos: una coincidencia, varias (nombre + inicial, nunca el DNI) y más de 5 pide más', async () => {
  await setSettings({ mode: 'last', digits: 4 });
  const { token } = await newDevice();
  assert.equal((await lookup(token, '333')).status, 400);                  // menos de N dígitos
  const one = await lookup(token, '1333');
  assert.deepEqual(one.body.candidates.map(c => c.name), ['Ana G.']);
  const many = await lookup(token, '4444');
  assert.deepEqual(many.body.candidates.map(c => c.name), ['Carla U.', 'Carlos D.', 'Carmen T.']);
  assert.ok(!JSON.stringify(many.body).match(/\d{4,}/));
  assert.equal((await lookup(token, '5555')).body.status, 'too_many');
  assert.equal((await lookup(token, '1005555')).body.candidates.length, 1); // con más dígitos, uno
  await setSettings({ mode: 'full' });
});

test('confirm solo con un ticket válido: sin ticket, inventado, de otro dispositivo, reutilizado o vencido → 400', async () => {
  const a = await newDevice('A'), b = await newDevice('B');
  assert.equal((await confirm(a.token)).body.error, 'invalid_ticket');
  assert.equal((await call(null, 'POST', '/api/checkin/confirm', { userId: 'c0' }, { token: a.token })).body.error, 'invalid_ticket');
  assert.equal((await confirm(a.token, 'inventado')).body.error, 'invalid_ticket');
  const l = await lookup(a.token, '20004444');
  const ticket = l.body.candidates[0].ticket;
  assert.equal((await confirm(b.token, ticket)).status, 400);               // de otro dispositivo
  assert.equal((await confirm(a.token, ticket)).body.status, 'registered');  // el dueño todavía puede
  assert.equal((await confirm(a.token, ticket)).body.error, 'invalid_ticket'); // un solo uso
});

test('el ingreso cuenta en el gráfico de 4 semanas (una vez aunque también haya entrenado)', async () => {
  const heat = await call('adm', 'GET', '/api/admin/attendance-heatmap');
  assert.equal(heat.body.today, today);
  const registered = sql('SELECT COUNT(*) AS n FROM attendance WHERE date = ?', today)[0].n;
  assert.equal(heat.body.days[today], registered);
  // Juan además entrena con la app hoy: sigue contando una vez.
  db.initDatabase();
  db.getDatabase().prepare('INSERT INTO workouts (id, user_id, date, name, start, end) VALUES (?, ?, ?, ?, ?, ?)').run('w-juan', 'juan', today, 'Push', Date.now(), Date.now());
  db.closeDatabase();
  assert.equal((await call('adm', 'GET', '/api/admin/attendance-heatmap')).body.days[today], registered);
  // Ingresos de hoy en la sección del admin, con el origen.
  const section = await call('adm', 'GET', '/api/admin/checkin');
  assert.equal(section.body.checkins.length, registered);
  assert.ok(section.body.checkins.every(c => c.source === 'physical' && c.nick && c.at));
  // Nombre y apellido de la ficha y el nombre de usuario, por separado (la UI arma "Juan Pérez [juan]").
  assert.deepEqual(section.body.checkins.filter(c => c.userId === 'juan').map(c => [c.fullName, c.nick]), [['Juan Pérez', 'juan']]);
  // Con la cuota de hoy (días en gym_tz) para mostrar junto al nombre.
  assert.deepEqual(section.body.checkins.find(c => c.userId === 'juan').billing, { status: 'por_vencer', days: 3 });
  assert.deepEqual(section.body.checkins.find(c => c.userId === 'bloq').billing, { status: 'bloqueado', days: -40 });
});

test('registro de días anteriores: ?date= devuelve ese día; un día futuro o inválido → 400', async () => {
  db.initDatabase();
  db.getDatabase().prepare("INSERT INTO attendance (user_id, date, source, created_at) VALUES ('venc', ?, 'physical', 1)").run(addDays(today, -3));
  db.closeDatabase();
  const past = await call('adm', 'GET', `/api/admin/checkin?date=${addDays(today, -3)}`);
  assert.equal(past.body.date, addDays(today, -3));
  assert.deepEqual(past.body.checkins.map(c => c.userId), ['venc']);
  assert.equal((await call('adm', 'GET', `/api/admin/checkin?date=${addDays(today, 1)}`)).status, 400);
  assert.equal((await call('adm', 'GET', '/api/admin/checkin?date=ayer')).status, 400);
  assert.equal((await call('adm', 'GET', '/api/admin/checkin')).body.date, today);
});

test('rate limit por dispositivo (principal) y por IP real (X-Real-IP del proxy)', async () => {
  const { token } = await newDevice('Límite');
  let last;
  for (let i = 0; i < 61; i++) last = await lookup(token, '39999999', { ip: `198.21.0.${i}` });   // cupo por defecto: 60 cada 5 min
  assert.equal(last.status, 429);                                          // mismo dispositivo, IPs distintas
  const other = await newDevice('Otro');
  assert.equal((await lookup(other.token, '39999999', { ip: '198.21.0.1' })).status, 200);
});

test('revocar: cualquier admin; el dispositivo deja de funcionar', async () => {
  const { token, device } = await newDevice();
  assert.equal((await call('adm', 'DELETE', `/api/admin/checkin/devices/${device.id}`)).status, 200);
  assert.equal((await lookup(token, '30111222')).body.error, 'device_revoked');
  assert.equal((await call('adm', 'DELETE', `/api/admin/checkin/devices/${device.id}`)).status, 404);
});

test('salida: passkey de socio → 403; challenge de otro dispositivo o reutilizado → rechazo; admin → revoca sin sesión', async () => {
  const { token } = await newDevice('Salida');
  const other = await newDevice('Otra');
  const options = async t => (await call(null, 'POST', '/api/checkin/exit/options', {}, { token: t })).body;
  let o = await options(token);
  const socio = await call(null, 'POST', '/api/checkin/exit/verify', { cid: o.cid, credential: assertion(keys.juan, o.options.challenge) }, { token });
  assert.equal(socio.status, 403);
  assert.equal((await lookup(token, '30111222')).status, 200);             // sigue activo

  o = await options(other.token);
  const ajeno = await call(null, 'POST', '/api/checkin/exit/verify', { cid: o.cid, credential: assertion(keys.adm, o.options.challenge) }, { token });
  assert.equal(ajeno.body.error, 'challenge_expired');

  o = await options(token);
  const ok = await call(null, 'POST', '/api/checkin/exit/verify', { cid: o.cid, credential: assertion(keys.adm, o.options.challenge) }, { token });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.setCookie.length, 0);                                    // sin sesión de admin
  assert.equal((await lookup(token, '30111222')).body.error, 'device_revoked');
  const reuse = await call(null, 'POST', '/api/checkin/exit/verify', { cid: o.cid, credential: assertion(keys.adm, o.options.challenge) }, { token: other.token });
  assert.equal(reuse.body.error, 'challenge_expired');
});

test('apagar el módulo con un dispositivo abierto: deja de funcionar y no vuelve al encenderlo', async () => {
  const { token } = await newDevice('Apagado');
  assert.equal((await lookup(token, '30111222')).status, 200);
  await setSettings({ enabled: false });
  assert.equal((await lookup(token, '30111222')).body.error, 'feature_disabled');
  await setSettings({ enabled: true });
  assert.equal((await lookup(token, '30111222')).body.error, 'device_revoked');
  assert.equal((await call('owner', 'GET', '/api/admin/checkin')).body.devices.length, 0);
});

test('una ficha que se une a una cuenta conserva su asistencia', async () => {
  db.initDatabase();
  const d = db.getDatabase();
  d.prepare("INSERT INTO attendance (user_id, date, source, created_at) VALUES ('c1', '2026-01-10', 'physical', 1)").run();
  db.createUser({ id: 'cuenta', name: 'cuenta' });
  db.createCredential({ id: 'cred-cuenta', userId: 'cuenta', publicKey: 'x' });
  const merged = db.mergeMember({ fichaId: 'c1', targetId: 'cuenta' });
  db.closeDatabase();
  assert.ok(!merged.error, JSON.stringify(merged));
  assert.deepEqual(sql("SELECT user_id FROM attendance WHERE date = '2026-01-10'"), [{ user_id: 'cuenta' }]);
});
