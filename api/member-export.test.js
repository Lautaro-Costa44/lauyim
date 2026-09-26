import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, membersCsv } from './member-export.js';

test('csvCell: fórmulas neutralizadas, comillas y separador', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('+54 9 11 2345-6789'), "'+54 9 11 2345-6789");
  assert.equal(csvCell('-3'), "'-3");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('Pérez; Juan'), '"Pérez; Juan"');
  assert.equal(csvCell(null), '');
});

test('membersCsv: BOM, ";", columnas de cuota solo con cuotas encendido', () => {
  const members = [
    { name: 'ana', created: '2026-03-05T12:00:00.000Z', disabled: false, hasApp: true,
      profile: { fullName: 'Ana Gómez', dni: '30.111.222', phone: '+54 9 11 5555-5555', email: 'ana@x.com' },
      billing: { planName: 'Mensual', dueDate: '2026-10-10', status: 'al_dia' } },
    { name: '=cmd', created: null, disabled: true, hasApp: false, profile: null, billing: null }
  ];
  const on = membersCsv(members, { billingEnabled: true });
  assert.equal(on.count, 2);
  assert.ok(on.csv.startsWith('\uFEFFUsuario;Nombre y apellido;DNI;Celular;Mail;Usa la app;Estado;Alta;Plan;Vence;Estado de cuota\r\n'));
  const lines = on.csv.slice(1).trim().split('\r\n');
  assert.equal(lines[1], "ana;Ana Gómez;30.111.222;'+54 9 11 5555-5555;ana@x.com;Sí;Activo;05/03/2026;Mensual;10/10/2026;Al día");
  assert.equal(lines[2], "'=cmd;;;;;No;Desactivado;;;;");
  const off = membersCsv(members, { billingEnabled: false });
  assert.ok(!off.csv.includes('Plan'));
});
