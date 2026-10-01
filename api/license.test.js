import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLicenseConfig, licenseState } from './license.js';

const cfg = (env = {}) => parseLicenseConfig({ LICENSE_PAID_UNTIL: '2026-10', ...env }).config;
const at = (today, env) => licenseState(cfg(env), today);

test('pagó hasta octubre: al día, por vencer del 1 al 10, en mora del 11 al 25, suspendido desde el 26', () => {
  assert.equal(at('2026-10-31').status, 'ok');
  assert.deepEqual(at('2026-11-01'), { status: 'due', month: '2026-11', dueDate: '2026-11-10', suspendDate: '2026-11-26' });
  assert.equal(at('2026-11-10').status, 'due');
  assert.equal(at('2026-11-11').status, 'overdue');
  assert.equal(at('2026-11-25').status, 'overdue');
  assert.equal(at('2026-11-26').status, 'suspended');
  // Dos meses sin pagar: sigue suspendido.
  assert.equal(at('2027-01-05').status, 'suspended');
  // Pagó por adelantado: al día.
  assert.equal(at('2026-09-15').status, 'ok');
});

test('día de vencimiento y días de mora configurables; un día que el mes no tiene va al último', () => {
  assert.deepEqual(at('2027-02-01', { LICENSE_PAID_UNTIL: '2027-01', LICENSE_DUE_DAY: '31' }),
    { status: 'due', month: '2027-02', dueDate: '2027-02-28', suspendDate: '2027-03-16' });
  // La mora cruza al mes siguiente.
  assert.equal(at('2027-03-10', { LICENSE_PAID_UNTIL: '2027-01', LICENSE_DUE_DAY: '31' }).status, 'overdue');
  const short = { LICENSE_DUE_DAY: '5', LICENSE_SUSPEND_AFTER_DAYS: '3' };
  assert.equal(at('2026-11-05', short).status, 'due');
  assert.equal(at('2026-11-08', short).status, 'overdue');
  assert.equal(at('2026-11-09', short).status, 'suspended');
  // Sin mora: se suspende al día siguiente del vencimiento.
  assert.equal(at('2026-11-11', { LICENSE_SUSPEND_AFTER_DAYS: '0' }).status, 'suspended');
});

test('sin LICENSE_PAID_UNTIL no hay control mensual; valores mal escritos se informan y no cortan nada', () => {
  assert.deepEqual(parseLicenseConfig({}), { config: null, errors: [] });
  assert.equal(licenseState(null, '2030-01-01').status, 'ok');
  const bad = parseLicenseConfig({ LICENSE_PAID_UNTIL: 'octubre' });
  assert.equal(bad.config, null);
  assert.match(bad.errors[0], /LICENSE_PAID_UNTIL/);
  const badDay = parseLicenseConfig({ LICENSE_PAID_UNTIL: '2026-10', LICENSE_DUE_DAY: '40', LICENSE_SUSPEND_AFTER_DAYS: '-2' });
  assert.equal(badDay.config.dueDay, 10);
  assert.equal(badDay.config.suspendAfterDays, 15);
  assert.equal(badDay.errors.length, 2);
});
