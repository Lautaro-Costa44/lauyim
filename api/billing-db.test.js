import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'lauyim-billing-db-'));
process.env.DATA_DIR = tmpDir;

const dbMod = await import('./database.js');

test('initDatabase es idempotente con las tablas de cuotas', () => {
  dbMod.initDatabase();
  dbMod.initDatabase();
  const tables = dbMod.getDatabase().prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name);
  for (const t of ['plans', 'member_billing', 'payments']) assert.ok(tables.includes(t), t);
});

test('planes: CHECK de precio y duración, parche parcial', () => {
  const plan = dbMod.createPlan({ name: 'Mensual', price: 20000, durationDays: 30 });
  assert.deepEqual({ name: plan.name, price: plan.price, durationDays: plan.durationDays, active: plan.active }, { name: 'Mensual', price: 20000, durationDays: 30, active: true });
  assert.throws(() => dbMod.createPlan({ name: 'Mal', price: -1, durationDays: 30 }));
  assert.throws(() => dbMod.createPlan({ name: 'Mal', price: 100, durationDays: 0 }));
  const off = dbMod.updatePlan(plan.id, { active: false });
  assert.equal(off.active, false);
  assert.equal(off.price, 20000);
});

test('un pago rechazado por la base no deja el vencimiento a medio mover', () => {
  dbMod.createUser({ id: 'r1', name: 'Rollback', created: Date.now() });
  const plan = dbMod.createPlan({ name: 'Semanal', price: 5000, durationDays: 7 });
  dbMod.setMemberBilling('r1', { planId: plan.id, dueDate: '2026-03-01' });
  assert.throws(() => dbMod.recordPayment({ userId: 'r1', planId: plan.id, amount: 0, method: 'efectivo', paidAt: 1, periodStart: '2026-03-01', periodEnd: '2026-03-08', dueDate: '2026-03-08' }));
  assert.equal(dbMod.getMemberBilling('r1').dueDate, '2026-03-01');
  assert.equal(dbMod.getPaymentsByUserId('r1').length, 0);
});

test('borrar un socio borra su plan vigente y conserva sus pagos', () => {
  dbMod.createUser({ id: 'u1', name: 'Ana', created: Date.now() });
  const plan = dbMod.createPlan({ name: 'Trimestral', price: 55000, durationDays: 90 });
  dbMod.setMemberBilling('u1', { planId: plan.id, dueDate: '2026-03-01' });
  dbMod.recordPayment({ userId: 'u1', userName: 'Ana', planId: plan.id, planName: plan.name, amount: 55000, method: 'efectivo', paidAt: 1000, periodStart: '2026-03-01', periodEnd: '2026-05-30', dueDate: '2026-05-30', createdBy: 'admin' });
  assert.equal(dbMod.getMemberBilling('u1').dueDate, '2026-05-30');
  assert.equal(dbMod.getMemberBilling('u1').pushSentForDue, null);

  dbMod.updateUser('u1', { disabled: true });
  dbMod.deleteUser('u1');

  const db = dbMod.getDatabase();
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM member_billing WHERE user_id = ?').get('u1').n, 0);
  const payments = dbMod.getPaymentsByUserId('u1');
  assert.equal(payments.length, 1);
  assert.equal(payments[0].userName, 'Ana');
  assert.equal(payments[0].planName, 'Trimestral');
  assert.equal(payments[0].amount, 55000);
});

test('markDuePushSent solo marca el vencimiento que sigue vigente', () => {
  dbMod.createUser({ id: 'p1', name: 'Push', created: Date.now() });
  const plan = dbMod.createPlan({ name: 'Quincenal', price: 9000, durationDays: 15 });
  dbMod.setMemberBilling('p1', { planId: plan.id, dueDate: '2026-04-10' });
  dbMod.markDuePushSent('p1', '2026-03-10');     // un vencimiento viejo no pisa el nuevo
  assert.equal(dbMod.getMemberBilling('p1').pushSentForDue, null);
  dbMod.markDuePushSent('p1', '2026-04-10');
  assert.equal(dbMod.getMemberBilling('p1').pushSentForDue, '2026-04-10');
  dbMod.setMemberBilling('p1', { planId: plan.id, dueDate: '2026-04-25' });   // reasignar reinicia el aviso
  assert.equal(dbMod.getMemberBilling('p1').pushSentForDue, null);
});

test.after(async () => {
  dbMod.closeDatabase();
  await rm(tmpDir, { recursive: true, force: true });
});
