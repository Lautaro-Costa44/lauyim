// Prueba gratis y alta con cuota inicial por HTTP, sobre server.js de verdad (igual que
// billing.http.test.js): condiciones de la prueba, bloqueo sin tolerancia al terminar, el pago
// que la cierra, alta con start (pago / prueba / dry_run) y el interruptor de cuotas.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays, gymToday } from './billing.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-trial-http-'));
process.env.DATA_DIR = dataDir;
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);

const today = gymToday(Date.now(), 'America/Argentina/Buenos_Aires');
const db = await import('./database.js');
const profile = dni => ({ fullName: 'Socio ' + dni, dni, dniNorm: dni, phone: null, phoneNorm: null, email: null });
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña', created: Date.now() });
db.createMember({ id: 't1', name: 'Tomás', profile: profile('30100001') });
db.createMember({ id: 'nodni', name: 'Sin DNI', profile: profile(null) });
db.createMember({ id: 'withplan', name: 'Con plan', profile: profile('30100002') });
db.createMember({ id: 'late', name: 'Atrasado', profile: profile('30100003') });
const plan = db.createPlan({ name: 'Mensual', price: 20000, durationDays: 30 });
db.setMemberBilling('withplan', { planId: plan.id, dueDate: addDays(today, 10) });
db.setMemberBilling('late', { planId: plan.id, dueDate: addDays(today, -30) });      // bloqueado: no es plan vigente
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
// Escribe en la base mientras el server corre (WAL): simula que pasaron los días.
function withDb(fn) { db.initDatabase(); try { return fn(db.getDatabase()); } finally { db.closeDatabase(); } }
const auditEvents = () => fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8').trim().split('\n').map(l => JSON.parse(l).ev);
const userCount = () => withDb(conn => conn.prepare('SELECT COUNT(*) AS n FROM users').get().n);

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

test('la ficha de cuota dice si se puede dar la prueba y por qué no', async () => {
  const ok = await call('owner', 'GET', '/api/admin/users/t1/billing');
  assert.deepEqual(ok.body.trial, { days: 1, until: today, available: true, blocker: null });
  assert.equal((await call('owner', 'GET', '/api/admin/users/nodni/billing')).body.trial.blocker, 'trial_requires_dni');
  assert.equal((await call('owner', 'GET', '/api/admin/users/withplan/billing')).body.trial.blocker, 'has_plan');
  assert.equal((await call('owner', 'GET', '/api/admin/users/late/billing')).body.trial.available, true);
});

test('iniciar prueba: requiere DNI, sin plan vigente; 1 día = solo hoy; una por persona', async () => {
  assert.equal((await call('owner', 'POST', '/api/admin/users/nodni/trial', {})).body.error, 'trial_requires_dni');
  assert.equal((await call('owner', 'POST', '/api/admin/users/withplan/trial', {})).body.error, 'has_plan');
  assert.equal((await call('t1', 'POST', '/api/admin/users/t1/trial', {})).status, 403);

  const started = await call('owner', 'POST', '/api/admin/users/t1/trial', {});
  assert.equal(started.status, 200);
  assert.equal(started.body.billing.status, 'prueba');
  assert.equal(started.body.billing.trialUntil, today);
  assert.equal(started.body.billing.debt, 0);
  const again = await call('owner', 'POST', '/api/admin/users/t1/trial', {});
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'trial_used');
  assert.ok(auditEvents().includes('admin.billing.trial_start'));

  const board = await call('owner', 'GET', '/api/admin/billing');
  assert.equal(board.body.summary.en_prueba, 1);
  assert.equal(board.body.members.find(m => m.id === 't1').trialUntil, today);
});

test('prueba vencida: bloqueado al día siguiente, sin tolerancia ni deuda; trialEnded en /api/me', async () => {
  withDb(conn => conn.prepare('UPDATE member_billing SET trial_until = ? WHERE user_id = ?').run(addDays(today, -1), 't1'));
  const me = await call('t1', 'GET', '/api/me');
  assert.equal(me.body.billing.status, 'bloqueado');
  assert.equal(me.body.billing.trialEnded, true);
  assert.equal(me.body.billing.blocked, true);
  assert.equal((await call('t1', 'GET', '/api/data')).body.error, 'membership_blocked');
  const view = await call('owner', 'GET', '/api/admin/users/t1/billing');
  assert.equal(view.body.billing.debt, 0);
  assert.equal(view.body.trial.blocker, 'trial_used');
  assert.equal((await call('owner', 'POST', '/api/admin/users/t1/trial', {})).body.error, 'trial_used');
});

test('con cuotas apagado la prueba vencida no bloquea y no se pueden dar pruebas', async () => {
  await call('owner', 'PUT', '/api/owner/billing/enabled', { enabled: false });
  assert.equal((await call('t1', 'GET', '/api/data')).status, 200);
  assert.equal((await call('owner', 'POST', '/api/admin/users/late/trial', {})).body.error, 'billing_disabled');
  assert.equal((await call('owner', 'POST', '/api/admin/members', { fullName: 'X Y', dni: '30100009', start: { type: 'trial' } })).body.error, 'billing_disabled');
  await call('owner', 'PUT', '/api/owner/billing/enabled', { enabled: true });
});

test('el pago cierra la prueba: desbloquea y vence a fecha de pago + duración', async () => {
  const paid = await call('owner', 'POST', '/api/admin/users/t1/payments', { planId: plan.id, method: 'efectivo' });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.billing.status, 'al_dia');
  assert.equal(paid.body.billing.trialUntil, null);
  assert.equal(paid.body.billing.dueDate, addDays(today, 30));
  assert.equal((await call('t1', 'GET', '/api/me')).body.billing.trialEnded, false);
});

test('anular el pago que cerró la prueba vencida: vuelve a bloqueado por prueba, no a "sin plan"', async () => {
  const pays = (await call('owner', 'GET', '/api/admin/users/t1/billing')).body.payments;
  const voided = await call('owner', 'POST', `/api/admin/users/t1/payments/${pays[0].id}/void`, { reason: 'error de carga' });
  assert.equal(voided.status, 200);
  assert.equal(voided.body.billing.status, 'bloqueado');
  assert.equal(voided.body.billing.trialUntil, addDays(today, -1));
  assert.equal(voided.body.billing.planId, null);
  assert.equal(voided.body.billing.debt, 0);
  const me = await call('t1', 'GET', '/api/me');
  assert.equal(me.body.billing.trialEnded, true);
  assert.equal((await call('t1', 'GET', '/api/data')).body.error, 'membership_blocked');
  // Y se puede volver a pagar: el nuevo pago vuelve a cerrar la prueba.
  const again = await call('owner', 'POST', '/api/admin/users/t1/payments', { planId: plan.id, method: 'efectivo' });
  assert.equal(again.body.billing.status, 'al_dia');
  assert.equal(again.body.billing.trialUntil, null);
});

test('alta con start payment: ficha + pago juntos; dry_run no guarda', async () => {
  const users = userCount();
  const dry = await call('owner', 'POST', '/api/admin/members', { dry_run: true, start: { type: 'payment', planId: plan.id, method: 'efectivo' } });
  assert.deepEqual(dry.body, { dry_run: true, dueDate: addDays(today, 30), amount: 20000, trialUntil: null, trialDays: 1 });
  assert.equal(userCount(), users);

  const bad = await call('owner', 'POST', '/api/admin/members', { fullName: 'Pago Malo', dni: '30100010', phone: '1155550000', start: { type: 'payment', planId: plan.id, method: 'cheque' } });
  assert.equal(bad.status, 400);
  assert.equal(userCount(), users);

  const made = await call('owner', 'POST', '/api/admin/members', { fullName: 'Pago Bueno', dni: '30100010', phone: '1155550000', start: { type: 'payment', planId: plan.id, amount: 18000, method: 'transferencia', note: 'promo' } });
  assert.equal(made.status, 200);
  assert.equal(made.body.member.billing.status, 'al_dia');
  assert.equal(made.body.member.billing.dueDate, addDays(today, 30));
  const pays = (await call('owner', 'GET', `/api/admin/users/${made.body.member.userId}/billing`)).body.payments;
  assert.deepEqual(pays.map(p => [p.amount, p.method, p.note]), [[18000, 'transferencia', 'promo']]);
  assert.equal((await call('owner', 'POST', '/api/admin/members', { fullName: 'A B', dni: '30100011', phone: '1155550000', planId: plan.id, dueDate: today, start: { type: 'payment', planId: plan.id, method: 'efectivo' } })).status, 400);
});

test('alta con start trial: exige DNI; la prueba empieza con la ficha', async () => {
  await call('owner', 'PUT', '/api/admin/billing/settings', { trial_days: 3 });
  const dry = await call('owner', 'POST', '/api/admin/members', { dry_run: true, start: { type: 'trial' } });
  assert.equal(dry.body.trialUntil, addDays(today, 2));
  // Sin DNI (opcional en la config): 409 y no se crea nada.
  await call('owner', 'PUT', '/api/admin/members/settings', { fields: { dni: { enabled: true, required: false } } });
  const users = userCount();
  const noDni = await call('owner', 'POST', '/api/admin/members', { fullName: 'Sin Documento', phone: '1155550000', start: { type: 'trial' } });
  assert.equal(noDni.status, 409);
  assert.equal(noDni.body.error, 'trial_requires_dni');
  assert.equal(userCount(), users);

  const made = await call('owner', 'POST', '/api/admin/members', { fullName: 'Prueba Tres', dni: '30100012', phone: '1155550000', start: { type: 'trial' } });
  assert.equal(made.status, 200);
  assert.equal(made.body.member.billing.status, 'prueba');
  assert.equal(made.body.member.billing.trialUntil, addDays(today, 2));
  assert.equal((await call('owner', 'POST', `/api/admin/users/${made.body.member.userId}/trial`, {})).status, 409);
});

test('DNI: 6 a 8 dígitos en el alta y en la búsqueda', async () => {
  const nine = await call('owner', 'POST', '/api/admin/members', { fullName: 'Nueve Dígitos', dni: '301000123', phone: '1155550000' });
  assert.equal(nine.status, 400);
  assert.equal(nine.body.field, 'dni');
  assert.equal((await call('owner', 'GET', '/api/admin/members/lookup?dni=301000123')).status, 400);
  assert.equal((await call('owner', 'GET', '/api/admin/members/lookup?dni=30100012')).body.userId !== undefined, true);
});
