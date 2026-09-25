// Importación de socios y pruebas en el historial, por HTTP sobre server.js de verdad (igual que
// trial.http.test.js): solo el owner, dry_run sin escribir, importación real, duplicados,
// avisos globales (cuotas apagado, DNI desactivado), "Datos incompletos", pagos importados no
// anulables y el historial de cuota con pagos y pruebas juntos.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gymToday, addDays } from './billing.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-import-http-'));
process.env.DATA_DIR = dataDir;
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);

const today = gymToday(Date.now(), 'America/Argentina/Buenos_Aires');
const dmy = iso => iso.split('-').reverse().join('/');
const db = await import('./database.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña' });              // el primer usuario es owner
db.createUser({ id: 'adm', name: 'Admin', admin: true });
// El socio que "ya existe" (el mismo DNI que usa el archivo de ejemplo del frontend).
db.createMember({ id: 'existe', name: 'Socio Existente', profile: { fullName: 'Socio Existente', dni: '30100001', dniNorm: '30100001', phone: null, phoneNorm: null, email: 'ya@mail.com' } });
const plan = db.createPlan({ name: 'Mensual', price: 20000, durationDays: 30 });
db.closeDatabase();

const PORT = 46000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
function cookie(uid) {
  const payload = `${uid}:${Date.now() + 3600000}:0`;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
async function call(uid, method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { 'Content-Type': 'application/json', ...(uid ? { Cookie: cookie(uid) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
function withDb(fn) { db.initDatabase(); try { return fn(db.getDatabase()); } finally { db.closeDatabase(); } }
const userCount = () => withDb(conn => conn.prepare('SELECT COUNT(*) AS n FROM users').get().n);
const auditRows = () => fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const IMPORT = '/api/owner/members/import';

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

const paidDay = addDays(today, -10);
const ROWS = [
  { rowNumber: 2, fullName: 'Lucía Gómez', dni: '40.200.001', phone: '11 2345-6789', planValue: 'Mensual', dueDate: dmy(addDays(today, 20)) },
  { rowNumber: 3, fullName: 'Pedro Ruiz', dni: '40200002', phone: '', planValue: 'Funcional', lastPaymentDate: dmy(paidDay), lastPaymentAmount: '$15.000' },
  { rowNumber: 4, fullName: 'Socio Existente', dni: '30.100.001', phone: '11 9999-8888', email: 'otro@mail.com' },
  { rowNumber: 5, fullName: '', dni: '40200004' },
  { rowNumber: 6, fullName: 'Repetida Uno', dni: '40200005' },
  { rowNumber: 7, fullName: 'Repetida Dos', dni: '40.200.005' },
];
const PLAN_MAP = [
  { value: 'Mensual', action: 'existing', planId: plan.id },
  { value: 'Funcional', action: 'create', name: 'Funcional', price: 15000, durationDays: 30 }
];
const body = (over = {}) => ({ rows: ROWS, planMap: PLAN_MAP, options: { duplicates: 'fill_empty', paymentMethod: 'efectivo' }, ...over });

test('solo el owner importa: admin → 403, sin sesión → 401', async () => {
  assert.equal((await call('adm', 'POST', IMPORT, body({ dry_run: true }))).status, 403);
  assert.equal((await call(null, 'POST', IMPORT, body({ dry_run: true }))).status, 401);
  assert.equal((await call('owner', 'POST', IMPORT, { rows: [] })).status, 400);
});

test('dry_run: resumen y motivos por fila, sin escribir nada', async () => {
  const users = userCount();
  const r = await call('owner', 'POST', IMPORT, body({ dry_run: true }));
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.summary, { nuevos: 2, existentes: 1, errores: 3, warnings: 1, completar: 1 });
  const byRow = Object.fromEntries(r.body.rows.map(x => [x.rowNumber, x]));
  assert.equal(byRow[4].status, 'existente');
  assert.equal(byRow[5].status, 'error');
  assert.match(byRow[6].messages.map(m => m.text).join(), /repetido en el archivo \(filas 6, 7\)/);
  assert.match(byRow[3].messages.map(m => m.text).join(), /Datos incompletos: falta celular/);
  assert.deepEqual(r.body.warnings, []);
  assert.equal(userCount(), users);
  assert.equal(withDb(conn => conn.prepare("SELECT COUNT(*) AS n FROM plans WHERE name = 'Funcional'").get().n), 0);
});

test('importación real: crea fichas, plan nuevo, cuota y pago importado; completa sin pisar', async () => {
  const r = await call('owner', 'POST', IMPORT, body());
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, created: 2, updated: 1, skipped: 0, errors: 3 });

  const list = (await call('owner', 'GET', '/api/admin/users')).body.users;
  const lucia = list.find(u => u.name === 'Lucía Gómez');
  const pedro = list.find(u => u.name === 'Pedro Ruiz');
  assert.deepEqual([lucia.hasApp, lucia.profileIncomplete, pedro.profileIncomplete], [false, false, true]);
  assert.equal(list.find(u => u.id === 'existe').profileIncomplete, false);   // se completó el celular

  const existing = (await call('owner', 'GET', '/api/admin/users/existe/profile')).body.profile;
  assert.deepEqual([existing.phone, existing.email], ['11 9999-8888', 'ya@mail.com']);   // el mail no se pisa

  const lb = (await call('owner', 'GET', `/api/admin/users/${lucia.id}/billing`)).body;
  assert.deepEqual([lb.billing.planName, lb.billing.dueDate], ['Mensual', addDays(today, 20)]);
  const pb = (await call('owner', 'GET', `/api/admin/users/${pedro.id}/billing`)).body;
  assert.deepEqual([pb.billing.planName, pb.billing.dueDate], ['Funcional', addDays(paidDay, 30)]);
  assert.equal(pb.payments.length, 1);
  assert.deepEqual([pb.payments[0].source, pb.payments[0].note, pb.payments[0].amount, pb.payments[0].method], ['import', 'Importado', 15000, 'efectivo']);
  assert.equal(pb.history[0].type, 'payment');

  // Un pago importado no se anula.
  const voided = await call('owner', 'POST', `/api/admin/users/${pedro.id}/payments/${pb.payments[0].id}/void`, {});
  assert.equal(voided.status, 409);
  assert.match(voided.body.error, /importado/);

  const ev = auditRows().find(a => a.ev === 'owner.member.import');
  assert.equal(ev.summary, '2 creados · 1 completados · 0 salteados · 3 con error · 1 planes nuevos · 1 pagos importados');
  assert.doesNotMatch(JSON.stringify(ev), /40200001|30100001|40\.200/);

  // Otra vez el mismo archivo: los DNI ya existen y se saltean.
  const again = await call('owner', 'POST', IMPORT, body({ options: { duplicates: 'skip', paymentMethod: 'efectivo' } }));
  assert.deepEqual(again.body, { ok: true, created: 0, updated: 0, skipped: 3, errors: 3 });
});

test('avisos globales: cuotas apagado ignora la cuota; DNI desactivado no detecta duplicados', async () => {
  await call('owner', 'PUT', '/api/owner/billing/enabled', { enabled: false });
  const off = await call('owner', 'POST', IMPORT, { dry_run: true, rows: [{ rowNumber: 2, fullName: 'Sin Cuota', dni: '40300001', phone: '1122334455', planValue: 'Otro', dueDate: 'cualquiera' }] });
  assert.equal(off.status, 200);
  assert.equal(off.body.summary.nuevos, 1);
  assert.match(off.body.warnings.join(), /Cuotas está apagado/);
  await call('owner', 'PUT', '/api/owner/billing/enabled', { enabled: true });

  await call('owner', 'PUT', '/api/admin/members/settings', { fields: { dni: { enabled: false, required: false } } });
  const noDni = await call('owner', 'POST', IMPORT, { dry_run: true, rows: [{ rowNumber: 2, fullName: 'Socio Existente', dni: '30100001', phone: '1122334455' }] });
  assert.equal(noDni.body.summary.nuevos, 1);
  assert.equal(noDni.body.summary.existentes, 0);
  assert.match(noDni.body.warnings.join(), /DNI está desactivado/);
  await call('owner', 'PUT', '/api/admin/members/settings', { fields: { dni: { enabled: true, required: true } } });
});

test('historial: la prueba aparece junto a los pagos, con días, fechas y quién la dio; monto 0 sin deuda', async () => {
  const created = await call('owner', 'POST', '/api/admin/members', { fullName: 'Con Prueba', dni: '40400001', phone: '1122334455', start: { type: 'trial' } });
  const id = created.body.member.userId;
  const view = (await call('owner', 'GET', `/api/admin/users/${id}/billing`)).body;
  assert.equal(view.payments.length, 0);
  assert.equal(view.history.length, 1);
  const [trial] = view.history;
  assert.deepEqual([trial.type, trial.startDate, trial.trialUntil, trial.days, trial.amount, trial.createdByName], ['trial', today, today, 1, 0, 'Dueña']);
  assert.equal(view.billing.debt, 0);

  // Un pago después: el historial queda pago (más nuevo) y prueba.
  await call('owner', 'POST', `/api/admin/users/${id}/payments`, { planId: plan.id, method: 'efectivo' });
  const later = (await call('owner', 'GET', `/api/admin/users/${id}/billing`)).body.history;
  assert.deepEqual(later.map(h => h.type), ['payment', 'trial']);

  // POST /trial también deja la fila.
  const other = (await call('owner', 'POST', '/api/admin/members', { fullName: 'Otra Prueba', dni: '40400002', phone: '1122334455' })).body.member.userId;
  assert.equal((await call('adm', 'POST', `/api/admin/users/${other}/trial`, {})).status, 200);
  const [t2] = (await call('owner', 'GET', `/api/admin/users/${other}/billing`)).body.history;
  assert.deepEqual([t2.type, t2.createdByName], ['trial', 'Admin']);
});

test('plantilla sin borrar la fila de ejemplo: la ignora y avisa en la vista previa', async () => {
  const r = await call('owner', 'POST', IMPORT, { dry_run: true, rows: [
    { rowNumber: 2, fullName: 'EJEMPLO – borrá esta fila', dni: '99.999.999', phone: '11 2345-6789' },
    { rowNumber: 3, fullName: 'Socia Real', dni: '40500001', phone: '1122334455' }
  ] });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.summary.nuevos, r.body.summary.errores], [1, 0]);
  assert.deepEqual(r.body.rows.map(x => x.rowNumber), [3]);
  assert.match(r.body.warnings.join(), /fila de ejemplo/);
});
