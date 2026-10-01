import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeExerciseDef, MAX_STEPS, MAX_STEP_LENGTH, MAX_DESC } from './custom-exercise.js';

test('sanitizeExerciseDef keeps the known fields and drops everything else', () => {
  const { value } = sanitizeExerciseDef({
    id: 'c1', n: '  Remo en polea  ', tipo: 'fuerza', equipamiento: ['leverage machine'], grupo_muscular: 'back',
    bp: 'back', eq: 'leverage machine', tg: 'back', mg: '', sm: ['biceps'], primaries: ['back'], secondaries: ['biceps'],
    muscleGroups: ['back', 'biceps'], st: ['Sentate.', 'Tirá.'], desc: 'Agarre neutro', map: false,
    custom: true, shared: true, created: 1, evil: '<script>'
  });
  assert.deepEqual(value, {
    id: 'c1', n: 'Remo en polea', tipo: 'fuerza', equipamiento: ['leverage machine'], grupo_muscular: 'back',
    bp: 'back', eq: 'leverage machine', tg: 'back', mg: '', sm: ['biceps'], primaries: ['back'], secondaries: ['biceps'],
    muscleGroups: ['back', 'biceps'], st: ['Sentate.', 'Tirá.'], desc: 'Agarre neutro', map: false
  });
});

test('sanitizeExerciseDef caps instructions, description and lists', () => {
  const long = 'x'.repeat(MAX_STEP_LENGTH + 50);
  const { value } = sanitizeExerciseDef({
    id: 'c2', n: 'Plancha', st: Array.from({ length: MAX_STEPS + 5 }, () => long), desc: 'y'.repeat(MAX_DESC + 10),
    sm: ['a', 2, null, ' ', 'b']
  });
  assert.equal(value.st.length, MAX_STEPS);
  assert.equal(value.st[0].length, MAX_STEP_LENGTH);
  assert.equal(value.desc.length, MAX_DESC);
  assert.deepEqual(value.sm, ['a', 'b']);
  assert.equal(value.tipo, 'fuerza');
  assert.equal('map' in value, false);
  assert.equal('primaries' in value, false);
});

test('sanitizeExerciseDef rejects a definition without id or name', () => {
  assert.ok(sanitizeExerciseDef({ n: 'Sin id' }).error);
  assert.ok(sanitizeExerciseDef({ id: 'c3', n: '   ' }).error);
  assert.ok(sanitizeExerciseDef(null).error);
  assert.ok(sanitizeExerciseDef(['c4']).error);
});
