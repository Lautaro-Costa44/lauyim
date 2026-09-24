// Levanta server.js de verdad (no se puede importar: escucha al cargar) sobre una base temporal
// y recorre Cuotas v1 por HTTP: endpoints admin, /api/me y el bloqueo en el dispatcher.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays, gymToday } from './billing.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-billing-http-'));
process.env.DATA_DIR = dataDir;
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);

const db = await import('./database.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña', created: Date.now() });   // el primer usuario es owner
db.createUser({ id: 'm1', name: 'Socio Uno', created: Date.now() });
db.createUser({ id: 'm2', name: 'Socio Dos', created: Date.now() });
db.closeDatabase();

const PORT = 42000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
const today = gymToday(Date.now(), 'America/Argentina/Buenos_Aires');
let server;

// Misma cookie que makeSession() en server.js: uid:exp:sv firmado con el secret de DATA_DIR.
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
  // Esperar a que el proceso suelte gym.db: en Windows borrar un archivo abierto falla.
  if (server && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

let planId;

test('planes: alta, validación y permisos', async () => {
  assert.equal((await call('m1', 'GET', '/api/admin/billing/plans')).status, 403);
  assert.equal((await call('owner', 'POST', '/api/admin/billing/plans', { name: 'Mensual', price: 1.5, durationDays: 30 })).status, 400);
  assert.equal((await call('owner', 'POST', '/api/admin/billing/plans', { name: '', price: 100, durationDays: 30 })).status, 400);
  const created = await call('owner', 'POST', '/api/admin/billing/plans', { name: 'Mensual', price: 20000, durationDays: 30 });
  assert.equal(created.status, 200);
  planId = created.body.plan.id;
  const list = await call('owner', 'GET', '/api/admin/billing/plans');
  assert.equal(list.body.plans.length, 1);
});

test('socio bloqueado: conserva la sesión y /api/me, pero no entrena ni sincroniza', async () => {
  const assigned = await call('owner', 'PUT', '/api/admin/users/m1/billing', { planId, dueDate: addDays(today, -10) });
  assert.equal(assigned.status, 200);
  assert.equal(assigned.body.billing.status, 'bloqueado');
  assert.equal(assigned.body.billing.debt, 20000);

  const me = await call('m1', 'GET', '/api/me');
  assert.equal(me.status, 200);
  assert.deepEqual(me.body.billing, { hasPlan: true, status: 'bloqueado', dueDate: addDays(today, -10), planName: 'Mensual', blocked: true });

  for (const [method, url, body] of [['POST', '/api/data/sync', { operations: [] }], ['GET', '/api/data'], ['PUT', '/api/data', { state: {} }],
    ['POST', '/api/activity', { active: false }], ['GET', '/api/presets'], ['GET', '/api/comidas'], ['GET', '/api/nutrition/goals']]) {
    const r = await call('m1', method, url, body);
    assert.equal(r.status, 403, `${method} ${url}`);
    assert.equal(r.body.error, 'membership_blocked', `${method} ${url}`);
  }
  // Rutas que el bloqueo no toca.
  assert.equal((await call('m1', 'GET', '/api/push/public-key')).status, 200);
  assert.equal((await call('m1', 'POST', '/api/push/rest-timer/cancel', {})).status, 200);
  // Sin sesión el gate no interviene: responde el 401 de siempre.
  assert.equal((await call(null, 'GET', '/api/data')).status, 401);
});

test('el staff nunca queda bloqueados por cuota', async () => {
  await call('owner', 'PUT', '/api/admin/users/owner/billing', { planId, dueDate: addDays(today, -30) });
  const me = await call('owner', 'GET', '/api/me');
  assert.equal(me.body.billing.status, 'bloqueado');
  assert.equal(me.body.billing.blocked, false);
  assert.equal((await call('owner', 'GET', '/api/data')).status, 200);
});

test('panel de cuotas y lista de usuarios', async () => {
  const billing = await call('owner', 'GET', '/api/admin/billing');
  assert.equal(billing.status, 200);
  assert.equal(billing.body.today, today);
  // La owner también está bloqueada, pero los admins no cuentan en el resumen ni en la deuda.
  assert.deepEqual(billing.body.summary, { al_dia: 0, por_vencer: 0, vencido: 0, bloqueado: 1, sin_plan: 1, deuda_total: 20000 });
  assert.equal(billing.body.members.find(m => m.id === 'owner').admin, true);
  assert.equal(billing.body.members.find(m => m.id === 'owner').status, 'bloqueado');
  assert.deepEqual(billing.body.members.find(m => m.id === 'm2'), { id: 'm2', name: 'Socio Dos', disabled: false, admin: false, planId: null, planName: null, dueDate: null, status: 'sin_plan', debt: 0 });

  const users = await call('owner', 'GET', '/api/admin/users');
  assert.equal(users.body.audit_enabled, true);
  assert.deepEqual(users.body.users.find(u => u.id === 'm1').billing, { status: 'bloqueado', dueDate: addDays(today, -10) });
});

test('registrar un pago desbloquea, mueve el vencimiento y queda auditado', async () => {
  assert.equal((await call('owner', 'POST', '/api/admin/users/m1/payments', { method: 'cheque' })).status, 400);
  assert.equal((await call('owner', 'POST', '/api/admin/users/m1/payments', { method: 'efectivo', amount: 0 })).status, 400);
  assert.equal((await call('owner', 'POST', '/api/admin/users/m2/payments', { method: 'efectivo' })).status, 400);   // sin plan

  const paid = await call('owner', 'POST', '/api/admin/users/m1/payments', { method: 'efectivo', note: 'recepción' });
  assert.equal(paid.status, 200);
  assert.equal(paid.body.billing.status, 'al_dia');
  assert.equal(paid.body.billing.dueDate, addDays(today, 30));          // estaba bloqueado: arranca hoy
  assert.equal(paid.body.payment.amount, 20000);                        // default: precio del plan
  assert.equal(paid.body.payment.periodStart, today);

  assert.equal((await call('m1', 'POST', '/api/data/sync', { operations: [] })).status, 200);
  const history = await call('owner', 'GET', '/api/admin/users/m1/billing');
  assert.equal(history.body.payments.length, 1);

  const log = fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8');
  for (const ev of ['admin.billing.plan_create', 'admin.billing.assign', 'admin.billing.payment', 'admin.billing.unblocked']) {
    assert.ok(log.includes(`"ev":"${ev}"`), ev);
  }
});

test('un plan inactivo no se asigna, pero quien ya lo tiene lo conserva', async () => {
  const off = await call('owner', 'PUT', `/api/admin/billing/plans/${planId}`, { active: false });
  assert.equal(off.body.plan.active, false);
  assert.equal((await call('owner', 'PUT', '/api/admin/users/m2/billing', { planId, dueDate: today })).status, 409);
  assert.equal((await call('owner', 'POST', '/api/admin/users/m1/payments', { method: 'transferencia', amount: 18000 })).status, 200);
  assert.equal((await call('owner', 'PUT', '/api/admin/users/m1/billing', { planId: null })).body.billing.status, 'sin_plan');
  assert.equal((await call('owner', 'PUT', '/api/admin/billing/plans/999', { active: true })).status, 404);
});

test('ajustes de cuotas: validación y guardado', async () => {
  assert.equal((await call('owner', 'PUT', '/api/admin/billing/settings', { grace_days: 31 })).status, 400);
  assert.equal((await call('owner', 'PUT', '/api/admin/billing/settings', { gym_tz: 'Marte/Olympus' })).status, 400);
  assert.equal((await call('owner', 'PUT', '/api/admin/billing/settings', { payment_methods: [] })).status, 400);
  const saved = await call('owner', 'PUT', '/api/admin/billing/settings', { grace_days: 7, payment_methods: ['efectivo'] });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.settings.grace_days, 7);
  assert.deepEqual(saved.body.settings.payment_methods, ['efectivo']);
  assert.equal((await call('owner', 'GET', '/api/admin/billing/settings')).body.settings.grace_days, 7);
  assert.equal((await call('m1', 'PUT', '/api/admin/billing/settings', { grace_days: 1 })).status, 403);
});

test('dry_run devuelve el vencimiento que quedaría sin guardar nada', async () => {
  const plan = (await call('owner', 'POST', '/api/admin/billing/plans', { name: 'Mensual B', price: 30000, durationDays: 30 })).body.plan;
  await call('owner', 'PUT', '/api/admin/users/m2/billing', { planId: plan.id, dueDate: today });
  const preview = await call('owner', 'POST', '/api/admin/users/m2/payments', { method: 'efectivo', dry_run: true });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.dry_run, true);
  assert.equal(preview.body.billing.dueDate, addDays(today, 30));
  assert.deepEqual(preview.body.period, { dueDate: addDays(today, 30), periodStart: today, periodEnd: addDays(today, 30) });
  const after = await call('owner', 'GET', '/api/admin/users/m2/billing');
  assert.equal(after.body.billing.dueDate, today);
  assert.equal(after.body.payments.length, 0);
  // La vista previa valida igual que el pago real.
  assert.equal((await call('owner', 'POST', '/api/admin/users/m2/payments', { method: 'cheque', dry_run: true })).status, 400);
});

test('anular pagos: solo el último vigente, en orden inverso, y el anulado no cuenta', async () => {
  const p1 = (await call('owner', 'POST', '/api/admin/users/m2/payments', { method: 'efectivo' })).body.payment;
  const p2 = (await call('owner', 'POST', '/api/admin/users/m2/payments', { method: 'efectivo' })).body.payment;
  assert.equal(p1.previousDueDate, today);
  assert.equal(p2.previousDueDate, addDays(today, 30));

  const notLast = await call('owner', 'POST', `/api/admin/users/m2/payments/${p1.id}/void`, {});
  assert.equal(notLast.status, 409);
  assert.match(notLast.body.error, /último pago/);

  const voided = await call('owner', 'POST', `/api/admin/users/m2/payments/${p2.id}/void`, { reason: 'cargado dos veces' });
  assert.equal(voided.status, 200);
  assert.equal(voided.body.billing.dueDate, addDays(today, 30));
  assert.ok(voided.body.payment.voidedAt);
  assert.equal(voided.body.payment.voidReason, 'cargado dos veces');
  assert.equal(voided.body.payment.voidedByName, 'Dueña');
  assert.equal((await call('owner', 'POST', `/api/admin/users/m2/payments/${p2.id}/void`, {})).status, 409);

  // Con p2 anulado, p1 pasa a ser el último vigente.
  const back = await call('owner', 'POST', `/api/admin/users/m2/payments/${p1.id}/void`, {});
  assert.equal(back.status, 200);
  assert.equal(back.body.billing.dueDate, today);
  const history = (await call('owner', 'GET', '/api/admin/users/m2/billing')).body.payments;
  assert.equal(history.length, 2);
  assert.ok(history.every(p => p.voidedAt));

  assert.equal((await call('owner', 'POST', `/api/admin/users/m1/payments/${p1.id}/void`, {})).status, 404);   // de otro socio
});

test('no se anula un pago si el vencimiento cambió después', async () => {
  const p = (await call('owner', 'POST', '/api/admin/users/m2/payments', { method: 'efectivo' })).body.payment;
  const billing = (await call('owner', 'GET', '/api/admin/users/m2/billing')).body.billing;
  await call('owner', 'PUT', '/api/admin/users/m2/billing', { planId: billing.planId, dueDate: addDays(billing.dueDate, 3) });
  const r = await call('owner', 'POST', `/api/admin/users/m2/payments/${p.id}/void`, {});
  assert.equal(r.status, 409);
  assert.match(r.body.error, /vencimiento cambió/);
});

test('anular devuelve el bloqueo y lo audita; un pago sin vencimiento previo no se anula', async () => {
  const plan = (await call('owner', 'GET', '/api/admin/users/m2/billing')).body.billing.planId;
  await call('owner', 'PUT', '/api/admin/users/m2/billing', { planId: plan, dueDate: addDays(today, -10) });
  const p = (await call('owner', 'POST', '/api/admin/users/m2/payments', { method: 'efectivo' })).body.payment;
  const r = await call('owner', 'POST', `/api/admin/users/m2/payments/${p.id}/void`, {});
  assert.equal(r.status, 200);
  assert.equal(r.body.billing.status, 'bloqueado');
  const log = fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8');
  for (const ev of ['admin.billing.payment_void', 'admin.billing.blocked']) assert.ok(log.includes(`"ev":"${ev}"`), ev);

  // Un pago anterior a estas columnas no sabe a qué vencimiento volver.
  const legacy = (await call('owner', 'POST', '/api/admin/users/m2/payments', { method: 'efectivo' })).body.payment;
  const { DatabaseSync } = await import('node:sqlite');
  const raw = new DatabaseSync(path.join(dataDir, 'gym.db'));
  raw.prepare('UPDATE payments SET previous_due_date = NULL WHERE id = ?').run(legacy.id);
  raw.close();
  const old = await call('owner', 'POST', `/api/admin/users/m2/payments/${legacy.id}/void`, {});
  assert.equal(old.status, 409);
  assert.match(old.body.error, /vencimiento anterior/);
});
