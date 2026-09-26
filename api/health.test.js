import test from 'node:test';
import assert from 'node:assert/strict';
import { healthConsentOf, healthDeclined, keepStoredHealth, stripHealth } from './health.js';

const STORED = {
  edad: 30, altura: 175, genero: 'femenino', grasaCorporal: 20, pesoKg: 70, targetW: 65,
  bodyweight: [{ d: '2026-09-01', w: 70, t: 1 }],
  respuestasEncuesta: { objetivo: 'fuerza', edad: 30, pesoKg: 70, sexoBiologico: 'femenino', lesiones: ['rodilla'] },
  nutritionGoals: { calories: 2000 }, routines: [{ id: 'r1' }], restSec: 90
};

test('consentimiento: granted / declined / null', () => {
  assert.equal(healthConsentOf({ health_consent: 'granted' }), 'granted');
  assert.equal(healthConsentOf({ health_consent: null }), null);
  assert.equal(healthConsentOf({ health_consent: 'x' }), null);
  assert.equal(healthDeclined({ health_consent: 'declined' }), true);
  assert.equal(healthDeclined({ health_consent: null }), false);
});

test('stripHealth: sin datos de salud, el resto igual', () => {
  const s = stripHealth(STORED);
  assert.deepEqual([s.edad, s.altura, s.genero, s.grasaCorporal, s.pesoKg, s.targetW], [null, null, null, null, null, null]);
  assert.deepEqual(s.bodyweight, []);
  assert.deepEqual(s.respuestasEncuesta, { objetivo: 'fuerza' });
  assert.equal(s.nutritionGoals, null);
  assert.deepEqual(s.routines, [{ id: 'r1' }]);
  assert.equal(s.restSec, 90);
  assert.equal(STORED.edad, 30);   // no muta
});

test('keepStoredHealth: lo del cliente, salvo los datos de salud del servidor', () => {
  const incoming = { ...stripHealth(STORED), edad: 99, bodyweight: [{ d: '2026-09-02', w: 1, t: 2 }], restSec: 120,
    respuestasEncuesta: { objetivo: 'hipertrofia', lesiones: [] } };
  const out = keepStoredHealth(incoming, STORED);
  assert.equal(out.edad, 30);
  assert.deepEqual(out.bodyweight, STORED.bodyweight);
  assert.equal(out.restSec, 120);
  assert.deepEqual(out.respuestasEncuesta, { objetivo: 'hipertrofia', edad: 30, pesoKg: 70, sexoBiologico: 'femenino', lesiones: ['rodilla'] });
  assert.equal(keepStoredHealth({ respuestasEncuesta: null }, {}).respuestasEncuesta, null);
});
