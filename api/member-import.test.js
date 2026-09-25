// Importación de socios, reglas puras: fechas, montos y el análisis fila por fila (sin base).
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseImportDate, parseImportAmount, parseImportBody, analyzeImport, planKey, MAX_IMPORT_ROWS } from './member-import.js';
import { DEFAULT_MEMBER_FIELDS } from './members.js';

const checkNewPlan = body => (typeof body.name === 'string' && body.name.trim() && Number.isInteger(body.price) && body.price >= 0 && Number.isInteger(body.durationDays) && body.durationDays > 0)
  ? { value: { name: body.name.trim(), price: body.price, durationDays: body.durationDays } }
  : { error: 'plan inválido' };
const PLAN = { id: 1, name: 'Mensual', price: 20000, durationDays: 30, active: true };
const ctx = (over = {}) => ({
  fields: DEFAULT_MEMBER_FIELDS, billingEnabled: true, paymentMethods: ['efectivo', 'transferencia'], today: '2026-09-25',
  plans: [PLAN, { id: 2, name: 'Viejo', price: 1, durationDays: 7, active: false }], existingProfiles: [], ...over
});
let n = 0;
const row = (over = {}) => ({ rowNumber: ++n + 1, fullName: 'Ana Pérez', dni: String(30000000 + n), phone: '11 1234-5678', ...over });
const run = (rows, { planMap = [], options = {}, ...over } = {}) => {
  const body = parseImportBody({ rows, planMap, options: { paymentMethod: 'efectivo', ...options } }, checkNewPlan);
  assert.equal(body.error, undefined, body.error);
  return analyzeImport(body.value, ctx(over));
};
const texts = r => r.messages.map(m => m.text).join(' | ');

test('fechas: dd/mm/aaaa, d/m/aa, aaaa-mm-dd y número de serie de Excel', () => {
  assert.deepEqual(parseImportDate('05/03/2026'), { value: '2026-03-05' });
  assert.deepEqual(parseImportDate('5/3/26'), { value: '2026-03-05' });
  assert.deepEqual(parseImportDate('2026-03-05'), { value: '2026-03-05' });
  assert.deepEqual(parseImportDate('2026-3-5'), { value: '2026-03-05' });
  assert.deepEqual(parseImportDate('46086'), { value: '2026-03-05' });      // serie de Excel
  assert.deepEqual(parseImportDate('46086.75'), { value: '2026-03-05' });   // con hora
  assert.deepEqual(parseImportDate('  '), { value: null });
  for (const bad of ['31/02/2026', '2026/03/05', '05-03-2026', 'marzo', '13/13/2026', '123', '99999', '5/3']) {
    assert.ok(parseImportDate(bad).error, bad);
  }
});

test('montos: pesos enteros con o sin $, puntos de miles y ,00', () => {
  for (const [raw, value] of [['$30.000', 30000], ['30000', 30000], ['30.000,00', 30000], ['$ 30.000', 30000], ['30,000', 30000], ['30000.00', 30000], ['1.234.567', 1234567], ['0', 0]]) {
    assert.deepEqual(parseImportAmount(raw), { value }, raw);
  }
  assert.deepEqual(parseImportAmount(''), { value: null });
  assert.match(parseImportAmount('30.000,50').error, /centavos/);
  for (const bad of ['treinta', '30.00.0', '-500', '30000$', '1e5']) assert.ok(parseImportAmount(bad).error, bad);
});

test('planKey agrupa sin tildes, mayúsculas ni espacios de más', () => {
  assert.equal(planKey('  Musculación   Libre '), 'musculacion libre');
  assert.equal(planKey('MUSCULACION libre'), planKey('Musculación Libre'));
});

test('body: tope de filas, rowNumber único, celdas de texto, planMap y opciones', () => {
  const ok = { rows: [{ rowNumber: 2, fullName: 'A' }] };
  assert.ok(parseImportBody(ok, checkNewPlan).value);
  assert.match(parseImportBody({ rows: Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ({ rowNumber: i + 1 })) }, checkNewPlan).error, /2000/);
  assert.ok(parseImportBody({ rows: [] }, checkNewPlan).error);
  assert.ok(parseImportBody({ rows: [{ rowNumber: 2 }, { rowNumber: 2 }] }, checkNewPlan).error);
  assert.ok(parseImportBody({ rows: [{ rowNumber: 2, dni: { $gt: 1 } }] }, checkNewPlan).error);
  assert.ok(parseImportBody({ ...ok, planMap: [{ value: 'X', action: 'borrar' }] }, checkNewPlan).error);
  assert.ok(parseImportBody({ ...ok, planMap: [{ value: 'X', action: 'none' }, { value: ' x ', action: 'none' }] }, checkNewPlan).error);
  assert.ok(parseImportBody({ ...ok, planMap: [{ value: 'X', action: 'create', name: 'X', price: -1, durationDays: 30 }] }, checkNewPlan).error);
  assert.ok(parseImportBody({ ...ok, options: { duplicates: 'overwrite' } }, checkNewPlan).error);
  assert.equal(parseImportBody({ ...ok, dry_run: true }, checkNewPlan).value.dryRun, true);
});

test('errores de fila: nombre, DNI faltante/inválido/de 9 dígitos, repetido en el archivo, fechas y montos', () => {
  const rows = [
    row({ fullName: '' }),
    row({ dni: '' }),
    row({ dni: 'abc' }),
    row({ dni: '123456789' }),
    row({ dni: '40.111.222' }), row({ dni: '40111222' }),
    row({ planValue: 'Mensual', dueDate: '31/02/2026' }),
    row({ planValue: 'Mensual', lastPaymentDate: 'ayer' }),
    row({ planValue: 'Mensual', lastPaymentDate: '01/09/2026', lastPaymentAmount: 'mucho' }),
    row({ planValue: 'Mensual', lastPaymentDate: '01/12/2026' }),
  ]
  const out = run(rows, { planMap: [{ value: 'Mensual', action: 'existing', planId: 1 }] });
  assert.equal(out.summary.errores, rows.length);
  assert.equal(out.summary.nuevos, 0);
  const msg = out.rows.map(texts);
  assert.match(msg[0], /Falta el nombre/);
  assert.match(msg[1], /Falta el DNI/);
  assert.match(msg[2], /DNI inválido/);
  assert.match(msg[3], /entre 6 y 8/);
  assert.match(msg[4], /repetido en el archivo \(filas 6, 7\)/);
  assert.match(msg[5], /repetido/);
  assert.match(msg[6], /Vencimiento: Fecha no reconocida/);
  assert.match(msg[7], /Fecha último pago/);
  assert.match(msg[8], /Monto último pago/);
  assert.match(msg[9], /futura/);
  assert.equal(out.write.members.length, 0);
});

test('obligatorios vacíos y celular/mail inválidos no frenan: "Datos incompletos"', () => {
  const out = run([row({ phone: '' }), row({ phone: 'no tengo', email: 'ana@' })]);
  assert.equal(out.summary.nuevos, 2);
  assert.equal(out.summary.warnings, 2);
  assert.match(texts(out.rows[0]), /Datos incompletos: falta celular/);
  assert.match(texts(out.rows[1]), /Celular inválido: queda vacío/);
  assert.match(texts(out.rows[1]), /Mail inválido: queda vacío/);
  assert.equal(out.write.members[1].profile.phone, null);
  assert.equal(out.write.members[1].profile.email, null);
});

test('alta: perfil normalizado, users.name con tope de 40, DNI con puntos', () => {
  const long = 'Ana María de los Ángeles Fernández Gutiérrez Pérez';
  const out = run([row({ fullName: `  ${long}  `, dni: '20.123.456', email: 'ANA@Mail.com' })]);
  const m = out.write.members[0];
  assert.equal(m.profile.fullName, long);
  assert.equal(m.name, long.slice(0, 40).trim());
  assert.deepEqual([m.profile.dni, m.profile.dniNorm, m.profile.email, m.profile.phoneNorm], ['20.123.456', '20123456', 'ana@mail.com', '+5491112345678']);
});

test('cuota: plan + vencimiento; plan + pago sin vencimiento; ambos manda el vencimiento', () => {
  const planMap = [{ value: 'mensual', action: 'existing', planId: 1 }];
  const out = run([
    row({ planValue: 'Mensual', dueDate: '10/10/2026' }),
    row({ planValue: 'MENSUAL', lastPaymentDate: '01/09/2026', lastPaymentAmount: '$18.000' }),
    row({ planValue: 'Mensual', dueDate: '2026-10-20', lastPaymentDate: '05/09/26' }),
  ], { planMap });
  const [a, b, c] = out.write.members;
  assert.deepEqual(a.billing, { planId: 1, dueDate: '2026-10-10' });
  assert.equal(a.payment, null);
  assert.deepEqual(b.billing, { planId: 1, dueDate: '2026-10-01' });
  assert.equal(b.payment.amount, 18000);
  assert.deepEqual([b.payment.periodStart, b.payment.periodEnd, b.payment.method], ['2026-09-01', '2026-10-01', 'efectivo']);
  assert.equal(new Date(b.payment.paidAt).toISOString().slice(0, 10), '2026-09-01');
  assert.deepEqual(c.billing, { planId: 1, dueDate: '2026-10-20' });      // manda el vencimiento
  assert.equal(c.payment.amount, 20000);                                   // sin monto: precio del plan
  assert.equal(c.payment.periodStart, '2026-09-05');
});

test('cuota: vencimiento sin plan, plan "sin plan" y plan sin fechas → aviso, sin cuota', () => {
  const out = run([
    row({ dueDate: '10/10/2026' }),
    row({ planValue: 'Pase libre', dueDate: '10/10/2026' }),
    row({ planValue: 'Mensual' }),
    row({ planValue: 'Mensual', lastPaymentAmount: '20000', dueDate: '10/10/2026' }),
  ], { planMap: [{ value: 'Pase libre', action: 'none' }, { value: 'Mensual', action: 'existing', planId: 1 }] });
  assert.equal(out.summary.nuevos, 4);
  assert.match(texts(out.rows[0]), /sin plan: se ignora la cuota/);
  assert.match(texts(out.rows[1]), /Sin plan: se ignoran/);
  assert.match(texts(out.rows[2]), /Plan sin vencimiento ni fecha de pago/);
  assert.match(texts(out.rows[3]), /Monto sin fecha de pago/);
  assert.deepEqual(out.write.members.map(m => m.billing?.dueDate ?? null), [null, null, null, '2026-10-10']);
  assert.ok(out.write.members.every(m => !m.payment));
});

test('planMap create: el plan se crea solo si alguna fila importada lo usa; existente inactivo o inexistente → 400', () => {
  const out = run([row({ planValue: 'Funcional', lastPaymentDate: '01/09/2026' })], {
    planMap: [{ value: 'Funcional', action: 'create', name: 'Funcional 3x', price: 15000, durationDays: 30 }, { value: 'Nadie', action: 'create', name: 'Nadie', price: 1, durationDays: 7 }]
  });
  assert.deepEqual(out.write.plans, [{ key: 'funcional', name: 'Funcional 3x', price: 15000, durationDays: 30 }]);
  assert.deepEqual(out.write.members[0].billing, { planKey: 'funcional', dueDate: '2026-10-01' });
  assert.equal(out.write.members[0].payment.amount, 15000);

  const body = rows => parseImportBody({ rows, planMap: [{ value: 'Viejo', action: 'existing', planId: 2 }] }, checkNewPlan).value;
  assert.match(analyzeImport(body([row({ planValue: 'Viejo' })]), ctx()).error, /inactivo/);
  assert.match(analyzeImport(parseImportBody({ rows: [row()], planMap: [{ value: 'X', action: 'existing', planId: 99 }] }, checkNewPlan).value, ctx()).error, /no existe/);
  assert.match(analyzeImport(parseImportBody({ rows: [row({ planValue: 'Otro' })] }, checkNewPlan).value, ctx()).error, /Falta elegir/);
  assert.match(analyzeImport(parseImportBody({ rows: [row({ lastPaymentDate: '01/09/2026' })], options: { paymentMethod: 'cheque' } }, checkNewPlan).value, ctx()).error, /paymentMethod/);
});

test('existentes por DNI: skip por defecto; fill_empty completa solo lo vacío, nunca la cuota', () => {
  const existingProfiles = [{ userId: 'u1', name: 'Ana', dniNorm: '25111222', fullName: 'Ana Vieja', phone: null, email: 'vieja@mail.com' }];
  const rows = [row({ dni: '25.111.222', fullName: 'Ana Nueva', phone: '11 5555-6666', email: 'nueva@mail.com', planValue: 'Mensual', dueDate: '10/10/2026' })];
  const planMap = [{ value: 'Mensual', action: 'existing', planId: 1 }];
  const skip = run(rows, { planMap, existingProfiles });
  assert.equal(skip.summary.existentes, 1);
  assert.equal(skip.rows[0].status, 'existente');
  assert.match(texts(skip.rows[0]), /Ya existe: Ana/);
  assert.match(texts(skip.rows[0]), /Se saltea/);
  assert.match(texts(skip.rows[0]), /cuota de un socio existente no se toca/);
  assert.deepEqual([skip.write.members.length, skip.write.fills.length], [0, 0]);

  const fill = run(rows.map(r => ({ ...r, rowNumber: r.rowNumber + 100 })), { planMap, existingProfiles, options: { duplicates: 'fill_empty' } });
  assert.deepEqual(fill.write.fills, [{ userId: 'u1', values: { phone: '11 5555-6666', phoneNorm: '+5491155556666' } }]);
  assert.match(texts(fill.rows[0]), /Se completa: celular/);
  assert.equal(fill.summary.completar, 1);
  assert.equal(fill.write.members.length, 0);
});

test('billing apagado: ignora las columnas de cuota con un aviso global', () => {
  const out = run([row({ planValue: 'Cualquiera', dueDate: 'no es fecha', lastPaymentAmount: 'x' })], { billingEnabled: false });
  assert.equal(out.summary.nuevos, 1);
  assert.match(out.warnings.join(' '), /Cuotas está apagado/);
  assert.equal(out.write.members[0].billing, null);
});

test('DNI desactivado: sin duplicados (ni del archivo ni de la base) y aviso global', () => {
  const fields = { ...DEFAULT_MEMBER_FIELDS, dni: { enabled: false, required: false } };
  const out = run([row({ dni: '25111222' }), row({ dni: '25111222' }), row({ dni: '' })], {
    fields, existingProfiles: [{ userId: 'u1', name: 'Ana', dniNorm: '25111222' }]
  });
  assert.equal(out.summary.nuevos, 3);
  assert.match(out.warnings.join(' '), /DNI está desactivado/);
  assert.ok(out.write.members.every(m => m.profile.dniNorm === null));
});

test('fila de ejemplo de la plantilla: por nombre o por DNI se ignora con un aviso, no es error', () => {
  const out = run([
    row({ fullName: 'EJEMPLO – borrá esta fila', dni: '30.123.456' }),
    row({ fullName: 'Lucía Gómez', dni: '99.999.999' }),
    row({ fullName: 'ejemplo - borra esta fila', dni: '' }),
    row(),
  ]);
  assert.deepEqual([out.summary.nuevos, out.summary.errores, out.rows.length], [1, 0, 1]);
  assert.deepEqual(out.warnings, ['Se ignoró la fila de ejemplo de la plantilla.']);
  assert.deepEqual(run([row()]).warnings, []);
});

test('la fila de ejemplo es la misma constante en el frontend', async () => {
  const { TEMPLATE_EXAMPLE_NAME, TEMPLATE_EXAMPLE_DNI } = await import('./member-import.js');
  const front = (await import('node:fs')).readFileSync(new URL('../frontend/src/views/admin/members/import-parse.js', import.meta.url), 'utf8');
  assert.ok(front.includes(`export const TEMPLATE_EXAMPLE_NAME = '${TEMPLATE_EXAMPLE_NAME}'`));
  assert.ok(front.includes(`export const TEMPLATE_EXAMPLE_DNI = '${TEMPLATE_EXAMPLE_DNI}'`));
});
