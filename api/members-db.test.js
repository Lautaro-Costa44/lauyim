// Fichas de socio a nivel base: merge (dry run, conflictos, rollback) y códigos de vinculación.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'lauyim-members-db-'));
process.env.DATA_DIR = tmpDir;

const dbMod = await import('./database.js');
dbMod.initDatabase();
// Siempre la conexión vigente: el primer test reabre la base.
const q = () => dbMod.getDatabase();
const profile = (over = {}) => ({ fullName: 'Ana Pérez', dni: '20.123.456', dniNorm: '20123456', phone: '11 1234-5678', phoneNorm: '+5491112345678', email: null, ...over });
// Una ficha como primera fila de la base: no se vuelve owner (createUser sí lo haría).
dbMod.createMember({ id: 'f-first', name: 'Primera ficha', profile: profile({ dni: '11111111', dniNorm: '11111111' }) });
dbMod.createUser({ id: 'owner', name: 'Dueña', owner: true });
dbMod.createCredential({ id: 'cred-owner', userId: 'owner', publicKey: 'x' });
const plan = dbMod.createPlan({ name: 'Mensual', price: 20000, durationDays: 30 });

function account(id, credId) {
  dbMod.createUser({ id, name: id });
  dbMod.createCredential({ id: credId, userId: id, publicKey: 'x' });
}
const payment = userId => dbMod.recordPayment({
  userId, userName: 'Ficha ' + userId, planId: plan.id, planName: plan.name, amount: 20000, method: 'efectivo',
  paidAt: Date.now(), periodStart: '2026-09-01', periodEnd: '2026-10-01', dueDate: '2026-10-01', createdBy: 'owner'
});
// Todo lo que el merge puede tocar, para comparar antes/después.
const snapshot = () => JSON.stringify({
  users: q().prepare('SELECT id, name FROM users ORDER BY id').all(),
  profiles: q().prepare('SELECT * FROM member_profile ORDER BY user_id').all(),
  billing: q().prepare('SELECT user_id, plan_id, due_date FROM member_billing ORDER BY user_id').all(),
  payments: q().prepare('SELECT id, user_id, user_name FROM payments ORDER BY id').all(),
  routines: q().prepare('SELECT id, user_id FROM routines ORDER BY id').all()
});

test('las tablas nuevas existen y initDatabase sigue idempotente', () => {
  dbMod.initDatabase();
  const cols = t => dbMod.getDatabase().prepare(`PRAGMA table_info(${t})`).all().map(c => c.name);
  for (const c of ['full_name', 'dni', 'dni_norm', 'phone', 'phone_norm', 'email', 'created_at']) assert.ok(cols('member_profile').includes(c), c);
  for (const c of ['code_hash', 'expires_at', 'used_at', 'revoked_at', 'failed_attempts']) assert.ok(cols('link_codes').includes(c), c);
});

test('una ficha nunca es admin ni owner, aunque sea la primera fila de la base', () => {
  const row = dbMod.getDatabase().prepare('SELECT admin, owner, created_at FROM users WHERE id = ?').get('f-first');
  assert.deepEqual({ admin: row.admin, owner: row.owner }, { admin: 0, owner: 0 });
  assert.match(row.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});

test('índice único de DNI: la segunda alta con el mismo DNI falla y no deja el usuario a medias', () => {
  dbMod.createMember({ id: 'f-dup1', name: 'Dup', profile: profile({ dni: '30.000.001', dniNorm: '30000001' }) });
  assert.throws(() => dbMod.createMember({ id: 'f-dup2', name: 'Dup 2', profile: profile({ dni: '30000001', dniNorm: '30000001' }) }),
    error => dbMod.isDniUniqueError(error));
  assert.equal(dbMod.getUserById('f-dup2'), undefined);
  assert.deepEqual(dbMod.findMemberByDni('30000001'), { userId: 'f-dup1', name: 'Dup', hasApp: false });
  assert.equal(dbMod.findMemberByDni('30000001', 'f-dup1'), null);
});

test('códigos de vinculación: un solo vigente por socio, vencimiento, fallos', () => {
  dbMod.createMember({ id: 'f-link', name: 'Link', profile: profile({ dni: '30000002', dniNorm: '30000002' }) });
  const future = new Date(Date.now() + 3600000).toISOString();
  dbMod.issueLinkCode({ userId: 'f-link', codeHash: 'h1', createdBy: 'owner', expiresAt: future });
  dbMod.issueLinkCode({ userId: 'f-link', codeHash: 'h2', createdBy: 'owner', expiresAt: future });
  assert.equal(dbMod.isLinkCodeUsable(dbMod.getLinkCodeByHash('h1')), false);
  assert.equal(dbMod.isLinkCodeUsable(dbMod.getLinkCodeByHash('h2')), true);

  dbMod.issueLinkCode({ userId: 'f-link', codeHash: 'h-old', createdBy: 'owner', expiresAt: new Date(Date.now() - 1000).toISOString() });
  assert.equal(dbMod.isLinkCodeUsable(dbMod.getLinkCodeByHash('h-old')), false);

  dbMod.issueLinkCode({ userId: 'f-link', codeHash: 'h3', createdBy: 'owner', expiresAt: future });
  const id = dbMod.getLinkCodeByHash('h3').id;
  for (let i = 0; i < 4; i++) assert.equal(dbMod.recordLinkCodeFailure(id), false);
  assert.equal(dbMod.recordLinkCodeFailure(id), true);
  assert.equal(dbMod.isLinkCodeUsable(dbMod.getLinkCodeByHash('h3')), false);
  // Borrar el socio se lleva sus códigos.
  dbMod.deleteUser('f-link');
  assert.equal(dbMod.getLinkCodeByHash('h2'), null);
});

test('consumeLinkCode: re-chequea dentro de la transacción', () => {
  dbMod.createMember({ id: 'f-use', name: 'Use', profile: profile({ dni: '30000003', dniNorm: '30000003' }) });
  dbMod.issueLinkCode({ userId: 'f-use', codeHash: 'u1', createdBy: 'owner', expiresAt: new Date(Date.now() + 3600000).toISOString() });
  const linkId = dbMod.getLinkCodeByHash('u1').id;
  assert.deepEqual(dbMod.consumeLinkCode({ linkId, userId: 'otro', credential: { id: 'c-x', publicKey: 'k' } }), { error: 'link-invalid' });
  assert.deepEqual(dbMod.consumeLinkCode({ linkId, userId: 'f-use', credential: { id: 'cred-owner', publicKey: 'k' } }), { error: 'credential-exists' });
  const ok = dbMod.consumeLinkCode({ linkId, userId: 'f-use', credential: { id: 'c-use', publicKey: 'k' } });
  assert.equal(ok.user.id, 'f-use');
  assert.equal(dbMod.countCredentials('f-use'), 1);
  assert.ok(dbMod.getLinkCodeByHash('u1').used_at);
  // Un solo uso.
  assert.deepEqual(dbMod.consumeLinkCode({ linkId, userId: 'f-use', credential: { id: 'c-use2', publicKey: 'k' } }), { error: 'link-invalid' });
});

test('merge: dry run no modifica nada y cuenta lo que se perdería', () => {
  account('acc-dry', 'cred-dry');
  dbMod.createMember({ id: 'f-dry', name: 'Dry', profile: profile({ dni: '30000004', dniNorm: '30000004' }), billing: { planId: plan.id, dueDate: '2026-10-01' } });
  payment('f-dry');
  q().prepare('INSERT INTO routines (id, user_id, name, created_at) VALUES (?, ?, ?, ?)').run('r-dry', 'f-dry', 'Rutina', Date.now());
  const before = snapshot();
  const out = dbMod.mergeMember({ fichaId: 'f-dry', targetId: 'acc-dry', dryRun: true });
  assert.equal(snapshot(), before);
  assert.equal(out.plan.payments, 1);
  assert.deepEqual(out.plan.lost, { routines: 1 });
  assert.deepEqual(out.plan.billing, { ficha: { planId: plan.id, planName: 'Mensual', dueDate: '2026-10-01' }, cuenta: null, conflict: false, keep: 'ficha' });
  assert.deepEqual(out.plan.profile, { ficha: true, cuenta: false, conflict: false, action: 'move' });
});

test('merge: mueve pagos, plan y perfil, y borra la ficha', () => {
  const out = dbMod.mergeMember({ fichaId: 'f-dry', targetId: 'acc-dry' });
  assert.ok(out.result);
  assert.equal(dbMod.getUserById('f-dry'), undefined);
  assert.equal(q().prepare('SELECT COUNT(*) AS n FROM routines WHERE id = ?').get('r-dry').n, 0);
  const pays = dbMod.getPaymentsByUserId('acc-dry');
  assert.equal(pays.length, 1);
  assert.equal(pays[0].userName, 'Ficha f-dry');            // el snapshot no cambia
  assert.equal(dbMod.getMemberBilling('acc-dry').planId, plan.id);
  assert.equal(dbMod.getMemberProfile('acc-dry').dniNorm, '30000004');
});

test('merge: conflicto de plan sin keepBilling → error; con keepBilling respeta la elección', () => {
  account('acc-bill', 'cred-bill');
  dbMod.setMemberBilling('acc-bill', { planId: plan.id, dueDate: '2026-12-31' });
  dbMod.createMember({ id: 'f-bill', name: 'Bill', profile: profile({ dni: '30000005', dniNorm: '30000005' }), billing: { planId: plan.id, dueDate: '2026-10-15' } });
  const before = snapshot();
  assert.equal(dbMod.mergeMember({ fichaId: 'f-bill', targetId: 'acc-bill' }).error, 'billing_conflict');
  assert.equal(snapshot(), before);
  assert.ok(dbMod.mergeMember({ fichaId: 'f-bill', targetId: 'acc-bill', keepBilling: 'cuenta' }).result);
  assert.equal(dbMod.getMemberBilling('acc-bill').dueDate, '2026-12-31');

  dbMod.createMember({ id: 'f-bill2', name: 'Bill 2', profile: profile({ dni: null, dniNorm: null }), billing: { planId: plan.id, dueDate: '2026-10-20' } });
  assert.ok(dbMod.mergeMember({ fichaId: 'f-bill2', targetId: 'acc-bill', keepBilling: 'ficha' }).result);
  assert.equal(dbMod.getMemberBilling('acc-bill').dueDate, '2026-10-20');
});

test('merge: perfiles — completa vacíos; DNI distinto → error', () => {
  account('acc-prof', 'cred-prof');
  q().prepare("INSERT INTO member_profile (user_id, full_name, email, created_at) VALUES ('acc-prof', 'Nombre Cuenta', 'cuenta@mail.com', ?)").run(new Date().toISOString());
  dbMod.createMember({ id: 'f-prof', name: 'Prof', profile: profile({ dni: '30000007', dniNorm: '30000007', fullName: 'Nombre Ficha', email: 'ficha@mail.com' }) });
  assert.ok(dbMod.mergeMember({ fichaId: 'f-prof', targetId: 'acc-prof' }).result);
  const p = dbMod.getMemberProfile('acc-prof');
  assert.deepEqual([p.fullName, p.email, p.dniNorm, p.phoneNorm], ['Nombre Cuenta', 'cuenta@mail.com', '30000007', '+5491112345678']);

  dbMod.createMember({ id: 'f-prof2', name: 'Prof 2', profile: profile({ dni: '30000008', dniNorm: '30000008' }) });
  const before = snapshot();
  assert.equal(dbMod.mergeMember({ fichaId: 'f-prof2', targetId: 'acc-prof', dryRun: true }).plan.profile.conflict, true);
  assert.equal(dbMod.mergeMember({ fichaId: 'f-prof2', targetId: 'acc-prof' }).error, 'dni_conflict');
  assert.equal(snapshot(), before);
});

test('merge: precondiciones', () => {
  account('acc-pre', 'cred-pre');
  dbMod.createMember({ id: 'f-pre', name: 'Pre', profile: profile({ dni: '30000009', dniNorm: '30000009' }) });
  const m = (fichaId, targetId) => dbMod.mergeMember({ fichaId, targetId }).error;
  assert.equal(m('f-pre', 'f-pre'), 'same_user');
  assert.equal(m('nadie', 'acc-pre'), 'ficha_not_found');
  assert.equal(m('f-pre', 'nadie'), 'target_not_found');
  assert.equal(m('acc-pre', 'acc-dry'), 'ficha_has_app');
  dbMod.createMember({ id: 'f-pre2', name: 'Pre 2', profile: profile({ dni: '30000010', dniNorm: '30000010' }) });
  assert.equal(m('f-pre', 'f-pre2'), 'target_without_app');
  assert.equal(m('f-pre', 'owner'), 'target_is_staff');
});

test('merge: si algo falla a mitad, rollback completo (pagos, plan, perfil y ficha intactos)', () => {
  account('acc-rb', 'cred-rb');
  dbMod.createMember({ id: 'f-rb', name: 'Rollback', profile: profile({ dni: '30000011', dniNorm: '30000011' }), billing: { planId: plan.id, dueDate: '2026-10-01' } });
  payment('f-rb');
  // El borrado de la ficha (último paso, después de mover pagos, plan y perfil) revienta.
  q().exec("CREATE TEMP TRIGGER boom BEFORE DELETE ON users WHEN OLD.id = 'f-rb' BEGIN SELECT RAISE(ABORT, 'boom'); END;");
  const before = snapshot();
  assert.throws(() => dbMod.mergeMember({ fichaId: 'f-rb', targetId: 'acc-rb' }), /boom/);
  assert.equal(snapshot(), before);
  assert.equal(dbMod.getMemberProfile('f-rb').dniNorm, '30000011');
  assert.equal(dbMod.getPaymentsByUserId('f-rb').length, 1);
  assert.equal(dbMod.getMemberBilling('acc-rb').planId, null);
  q().exec('DROP TRIGGER boom;');
  // Después del rollback la conexión sigue usable y el merge sale.
  assert.ok(dbMod.mergeMember({ fichaId: 'f-rb', targetId: 'acc-rb' }).result);
});

test('deleteUser con transacción externa: no abre ni cierra la suya', () => {
  dbMod.createMember({ id: 'f-tx', name: 'Tx', profile: profile({ dni: '30000012', dniNorm: '30000012' }) });
  q().exec('BEGIN IMMEDIATE');
  assert.equal(dbMod.deleteUser('f-tx', { inTransaction: true }).id, 'f-tx');
  q().exec('ROLLBACK');
  assert.ok(dbMod.getUserById('f-tx'));
  // Sin la opción, sigue siendo su propia transacción.
  assert.equal(dbMod.deleteUser('f-tx').id, 'f-tx');
  assert.equal(dbMod.getUserById('f-tx'), undefined);
});
