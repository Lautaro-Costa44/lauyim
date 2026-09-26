import test from 'node:test';
import assert from 'node:assert/strict';
import { readApprovalSettings, validateApprovalSettings, effectiveMode, allowedStarts, needsProfilePrompt, profileHasData } from './approval.js';

const settings = obj => (key, fallback) => obj[key] ?? fallback;
const FIELDS_ON = { full_name: { enabled: true, required: true }, dni: { enabled: true, required: true }, phone: { enabled: false, required: false }, email: { enabled: false, required: false } };
const FIELDS_OFF = { full_name: { enabled: false }, dni: { enabled: false }, phone: { enabled: false }, email: { enabled: false } };

test('readApprovalSettings: apagado y "approve" por defecto; un modo desconocido cae en approve', () => {
  assert.deepEqual(readApprovalSettings(settings({})), { required: false, mode: 'approve' });
  assert.deepEqual(readApprovalSettings(settings({ approval_required: '1', approval_mode: 'trial' })), { required: true, mode: 'trial' });
  assert.equal(readApprovalSettings(settings({ approval_mode: 'x' })).mode, 'approve');
});

test('validateApprovalSettings: payment/trial necesitan cuotas; trial, DNI', () => {
  const on = { billingEnabled: true, dniEnabled: true };
  assert.deepEqual(validateApprovalSettings({ required: true, mode: 'payment' }, on).value, { required: true, mode: 'payment' });
  assert.equal(validateApprovalSettings({ mode: 'payment' }, { billingEnabled: false, dniEnabled: true }).error, 'billing_disabled');
  assert.equal(validateApprovalSettings({ mode: 'trial' }, { billingEnabled: true, dniEnabled: false }).error, 'trial_requires_dni');
  assert.equal(validateApprovalSettings({ mode: 'approve' }, { billingEnabled: false, dniEnabled: false }).value.mode, 'approve');
  assert.equal(validateApprovalSettings({ required: 'si' }, on).status, 400);
  assert.equal(validateApprovalSettings({ mode: 'otro' }, on).status, 400);
  assert.equal(validateApprovalSettings({}, on).status, 400);
});

test('effectiveMode / allowedStarts', () => {
  assert.equal(effectiveMode('trial', false), 'approve');
  assert.deepEqual(allowedStarts('trial', { billingEnabled: false, covered: false }), ['none']);
  assert.deepEqual(allowedStarts('approve', { billingEnabled: true, covered: false }), ['none', 'payment', 'trial']);
  assert.deepEqual(allowedStarts('payment', { billingEnabled: true, covered: false }), ['payment']);
  assert.deepEqual(allowedStarts('payment', { billingEnabled: true, covered: true }), ['payment', 'none']);
  assert.deepEqual(allowedStarts('trial', { billingEnabled: true, covered: false }), ['trial']);
});

test('needsProfilePrompt: una sola vez, solo socios sin datos y con la aprobación apagada', () => {
  const user = { approval_status: null, profile_prompted_at: null };
  const base = { admin: false, approvalRequired: false, fields: FIELDS_ON, profile: null };
  assert.equal(needsProfilePrompt(user, base), true);
  assert.equal(needsProfilePrompt(user, { ...base, profile: { fullName: 'Ana' } }), false);
  assert.equal(needsProfilePrompt({ ...user, profile_prompted_at: '2026-09-26T00:00:00Z' }, base), false);
  assert.equal(needsProfilePrompt({ ...user, approval_status: 'pending' }, base), false);
  assert.equal(needsProfilePrompt(user, { ...base, admin: true }), false);
  assert.equal(needsProfilePrompt(user, { ...base, approvalRequired: true }), false);
  assert.equal(needsProfilePrompt(user, { ...base, fields: FIELDS_OFF }), false);
  assert.equal(profileHasData({ fullName: '  ' }), false);
});
