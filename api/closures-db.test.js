// Cierres en la base: columnas del aviso general y de la extensión, avisos pendientes, destinatarios
// y extensiones de vencimiento (aplicar y devolver sobre el valor actual).
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-closures-db-'));
process.env.DATA_DIR = dataDir;
const db = await import('./database.js');
const kdb = await import('./closures-db.js');
const cdb = await import('./classes-db.js');
db.initDatabase();
after(() => { db.closeDatabase(); fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

const sql = () => db.getDatabase();
for (const id of ['ana', 'beto', 'caro', 'baja']) db.createUser({ id, name: id, created: Date.now() });
sql().prepare('UPDATE users SET disabled = 1 WHERE id = ?').run('baja');
const sub = id => sql().prepare('INSERT INTO subscriptions (endpoint, user_id, keys, created_at) VALUES (?, ?, ?, ?)').run('https://push/' + id, id, '{}', Date.now());
['ana', 'beto', 'baja'].forEach(sub);

test('alta con las columnas nuevas; classes-db sigue exportando lo mismo', () => {
  const k = kdb.addClosure({ from: '2026-10-12', to: '2026-10-12', reason: 'Feriado', createdBy: 'ana', notifyAll: true, announceAt: 1000, notifiedIds: ['beto'], extendDays: 1 });
  assert.deepEqual([k.notifyAll, k.announceAt, k.announcedAt, k.notifiedIds, k.extendDays], [true, 1000, null, ['beto'], 1]);
  assert.equal(cdb.getClosure(k.id).id, k.id);
  const plain = cdb.addClosure({ from: '2026-10-20', to: '2026-10-20', reason: '' });
  assert.deepEqual([plain.notifyAll, plain.announceAt, plain.notifiedIds, plain.extendDays], [false, null, [], 0]);
  assert.deepEqual(cdb.getClosures({ from: '2026-10-01', to: '2026-10-31' }).map(c => c.id), [k.id, plain.id]);
  kdb.deleteClosure(k.id); kdb.deleteClosure(plain.id);
});

test('avisos pendientes: vencidos, no enviados, de cierres que no terminaron; se marcan una vez', () => {
  const due = kdb.addClosure({ from: '2026-10-12', to: '2026-10-12', notifyAll: true, announceAt: 500 });
  kdb.addClosure({ from: '2026-10-14', to: '2026-10-14', notifyAll: true, announceAt: 5000 });
  kdb.addClosure({ from: '2026-10-01', to: '2026-10-02', notifyAll: true, announceAt: 100 });   // ya terminó
  kdb.addClosure({ from: '2026-10-16', to: '2026-10-16', notifyAll: false, announceAt: 100 });
  assert.deepEqual(kdb.pendingAnnouncements(1000, '2026-10-09').map(c => c.id), [due.id]);
  assert.equal(kdb.markAnnounced(due.id, 1000), true);
  assert.equal(kdb.markAnnounced(due.id, 1001), false);
  assert.equal(kdb.getClosure(due.id).announcedAt, 1000);
  assert.deepEqual(kdb.pendingAnnouncements(1000, '2026-10-09'), []);
  for (const c of kdb.getClosures()) kdb.deleteClosure(c.id);
});

test('destinatarios: activos con suscripción, menos los excluidos', () => {
  assert.deepEqual(kdb.announcementRecipients().sort(), ['ana', 'beto']);
  assert.deepEqual(kdb.announcementRecipients(['beto']), ['ana']);
});

test('extensiones: corren vencimiento o prueba, se registran y se revierten sobre el valor actual', () => {
  sql().prepare("INSERT INTO plans (id, name, price, duration_days, active, created_at, updated_at) VALUES (1, 'Mensual', 100, 30, 1, 0, 0)").run();
  sql().prepare("INSERT INTO member_billing (user_id, plan_id, due_date, trial_until, updated_at) VALUES ('ana', 1, '2026-11-01', NULL, 0)").run();
  sql().prepare("INSERT INTO member_billing (user_id, plan_id, due_date, trial_until, updated_at) VALUES ('beto', NULL, NULL, '2026-10-15', 0)").run();
  const k = kdb.addClosure({ from: '2026-10-12', to: '2026-10-14', extendDays: 3 });
  const n = kdb.applyExtensions(k.id, [{ userId: 'ana', field: 'due', before: '2026-11-01' }, { userId: 'beto', field: 'trial', before: '2026-10-15' }], 3, 777);
  assert.equal(n, 2);
  assert.equal(db.getMemberBilling('ana').dueDate, '2026-11-04');
  assert.equal(db.getMemberBilling('beto').trialUntil, '2026-10-18');
  assert.deepEqual(kdb.getExtensions({ userId: 'ana' }).map(e => [e.field, e.days, e.before, e.after, e.appliedAt, e.revertedAt]), [['due', 3, '2026-11-01', '2026-11-04', 777, null]]);
  // Un pago en el medio mueve el vencimiento: revertir resta sobre el valor actual.
  sql().prepare("UPDATE member_billing SET due_date = '2026-12-04' WHERE user_id = 'ana'").run();
  assert.equal(kdb.revertExtensions(k.id, 900), 2);
  assert.equal(db.getMemberBilling('ana').dueDate, '2026-12-01');
  assert.equal(db.getMemberBilling('beto').trialUntil, '2026-10-15');
  assert.equal(kdb.revertExtensions(k.id, 901), 0);
  assert.ok(kdb.getExtensions({ closureId: k.id }).every(e => e.revertedAt === 900));
});
