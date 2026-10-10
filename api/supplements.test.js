import test from 'node:test';
import assert from 'node:assert/strict';
import { validateItem, validateLog, logDateOk, proteinMeal, reminderDue, supplementsEnabled } from './supplements.js';

const base = { id: 'a1b2c3d4', catalogId: 'creatina', dose: 5, unit: 'g', scoopG: 5, doses: 1, slot: 'morning', days: 'daily', reminderTimes: ['09:00'] };

test('validateItem: valores conocidos, rangos y nombre en los propios', () => {
  assert.deepEqual(validateItem(base).value, { ...base, name: null, meta: null });
  assert.match(validateItem({ ...base, catalogId: 'quemadores' }).error, /no se puede seguir/);
  assert.ok(validateItem({ ...base, slot: 'siesta' }).error);
  assert.ok(validateItem({ ...base, days: 'a veces' }).error);
  assert.ok(validateItem({ ...base, doses: 9 }).error);
  assert.ok(validateItem({ ...base, dose: -1 }).error);
  assert.ok(validateItem({ ...base, reminderTimes: ['25:00'] }).error);
  assert.ok(validateItem({ ...base, reminderTimes: ['09:00', '13:00'] }).error);          // más horas que dosis
  assert.deepEqual(validateItem({ ...base, doses: 3, reminderTimes: ['20:00', '09:00', '09:00'] }).value.reminderTimes, ['09:00', '20:00']);
  assert.ok(validateItem({ ...base, catalogId: null, name: '' }).error);
  assert.equal(validateItem({ ...base, catalogId: null, name: '  Ashwagandha ' }).value.name, 'Ashwagandha');
  assert.ok(validateItem({ ...base, id: 'x' }).error);
  assert.equal(validateItem({ ...base, catalogId: 'proteina', meta: { macros: { proteina: 24, calorias: 120, carbos: 3, grasas: 1.5 } } }).value.meta.macros.proteina, 24);
});

test('logDateOk: ventana con tolerancia de zona horaria', () => {
  assert.equal(logDateOk('2026-10-09', '2026-10-09'), true);
  assert.equal(logDateOk('2026-10-10', '2026-10-09'), true);
  assert.equal(logDateOk('2026-10-11', '2026-10-09'), false);
  assert.equal(logDateOk('2026-10-01', '2026-10-09'), true);
  assert.equal(logDateOk('2026-09-30', '2026-10-09'), false);
});

test('validateLog: toma de un item o fuente de cafeína', () => {
  const item = { id: 'it', catalogId: 'creatina' };
  assert.deepEqual(validateLog({ id: 'l1abcdef', itemId: 'it', date: '2026-10-09', amount: 5 }, { today: '2026-10-09', item }).value,
    { id: 'l1abcdef', itemId: 'it', date: '2026-10-09', source: null, amount: 5 });
  assert.equal(validateLog({ id: 'l2abcdef', source: 'mate', date: '2026-10-09', amount: 80 }, { today: '2026-10-09', item: null }).value.source, 'mate');
  assert.ok(validateLog({ id: 'l3abcdef', source: 'whisky', date: '2026-10-09', amount: 1 }, { today: '2026-10-09', item: null }).error);
  assert.ok(validateLog({ id: 'l4abcdef', itemId: 'it', date: '2026-10-20', amount: 5 }, { today: '2026-10-09', item }).error);
  assert.ok(validateLog({ id: 'l5abcdef', itemId: 'nope', date: '2026-10-09', amount: 5 }, { today: '2026-10-09', item: null }).error);
  assert.ok(validateLog({ id: 'l6abcdef', source: 'otro', date: '2026-10-09', amount: 5000 }, { today: '2026-10-09', item: null }).error);
});

test('proteinMeal: franja por hora y macros por scoop', () => {
  const item = { catalogId: 'proteina', scoopG: 30, meta: { macros: { proteina: 24, calorias: 120, carbos: 3, grasas: 1.5 } } };
  assert.deepEqual(proteinMeal({ item, amount: 60, date: '2026-10-09', today: '2026-10-09', time: '18:30' }),
    { fecha: '2026-10-09', franja: 'merienda', nombre_alimento: 'Proteína en polvo', cantidad_gramos: 60, calorias: 240, proteina: 48, carbohidratos: 6, grasas: 3 });
  assert.equal(proteinMeal({ item, amount: 30, date: '2026-10-08', today: '2026-10-09', time: '08:00' }).franja, 'extra');
  assert.equal(proteinMeal({ item: { catalogId: 'proteina', meta: null }, amount: 30, date: '2026-10-09', today: '2026-10-09', time: '07:00' }).proteina, 24);
});

test('reminderDue: a su hora (5 min), si toca, si falta y una vez por día', () => {
  const item = { id: 'it', doses: 1, days: 'daily', status: 'active', createdAt: '2026-09-01T00:00:00Z' };
  const at = (localTime, extra = {}) => reminderDue({ item, time: '09:00', index: 0, localDate: '2026-10-09', localTime, lastSent: null, taken: 0, trainingDay: false, ...extra });
  assert.equal(at('08:59'), false);
  assert.equal(at('09:00'), true);
  assert.equal(at('09:04'), true);
  assert.equal(at('09:05'), false);
  assert.equal(at('09:01', { lastSent: '2026-10-09' }), false);
  assert.equal(at('09:01', { taken: 1 }), false);
  assert.equal(reminderDue({ item: { ...item, days: 'training' }, time: '09:00', localDate: '2026-10-09', localTime: '09:00', lastSent: null, taken: 0, trainingDay: false }), false);
  // Varias dosis: el de la segunda sale si todavía hay menos de 2 marcadas.
  const tres = { ...item, doses: 3 };
  assert.equal(reminderDue({ item: tres, time: '13:00', index: 1, localDate: '2026-10-09', localTime: '13:00', lastSent: null, taken: 1, trainingDay: false }), true);
  assert.equal(reminderDue({ item: tres, time: '13:00', index: 1, localDate: '2026-10-09', localTime: '13:00', lastSent: null, taken: 2, trainingDay: false }), false);
  // Alta a la noche local (UTC del día siguiente): el recordatorio de esa noche sale igual.
  const tarde = { ...item, createdAt: '2026-10-10T00:30:00Z' };
  assert.equal(reminderDue({ item: tarde, time: '22:00', localDate: '2026-10-09', localTime: '22:01', lastSent: null, taken: 0, trainingDay: false, createdDate: '2026-10-09' }), true);
});

test('supplementsEnabled: prendido salvo "0"', () => {
  assert.equal(supplementsEnabled(null), true);
  assert.equal(supplementsEnabled('1'), true);
  assert.equal(supplementsEnabled('0'), false);
});
