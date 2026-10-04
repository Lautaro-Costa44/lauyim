// Cada evento que el servidor escribe en el registro cae en una categoría (no en "other"): si se
// suma uno nuevo sin regla, este test lo encuentra.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditCategory, AUDIT_CATEGORIES } from './audit-categories.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
export function emittedAuditEvents() {
  const events = new Set();
  for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.js') && !f.includes('.test.'))) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of src.matchAll(/audit\(req,\s*'([a-z_.]+)'/g)) events.add(m[1]);
    // audit(req, cond ? 'a.b' : 'c.d', …)
    for (const m of src.matchAll(/audit\(req,\s*[^'(),]+\?\s*'([a-z_.]+)'\s*:\s*'([a-z_.]+)'/g)) { events.add(m[1]); events.add(m[2]); }
  }
  return [...events].sort();
}

test('cada evento del registro tiene categoría', () => {
  const events = emittedAuditEvents();
  assert.ok(events.length > 90, String(events.length));
  assert.deepEqual(events.filter(ev => auditCategory(ev) === 'other'), []);
});

test('categorías de ejemplo', () => {
  const cases = {
    'auth.login.ok': 'auth', 'admin.denied': 'auth', 'classes.closure.add': 'classes', 'owner.classes.settings': 'classes',
    'admin.billing.payment': 'billing', 'owner.billing.enabled': 'billing', 'admin.notifications.settings': 'billing',
    'checkin.ok': 'checkin', 'owner.checkin.settings': 'checkin', 'admin.routine.update': 'training', 'admin.program.rename': 'training',
    'admin.nutrition.template.create': 'training', 'admin.member.create': 'members', 'admin.user.role': 'members', 'owner.user.delete': 'members',
    'admin.push.send': 'members', 'owner.branding.settings': 'settings', 'owner.role.save': 'settings', 'owner.audit.clear': 'settings',
    'admin.attendance.settings': 'settings', 'algo.nuevo': 'other'
  };
  for (const [ev, cat] of Object.entries(cases)) assert.equal(auditCategory(ev), cat, ev);
  assert.deepEqual(AUDIT_CATEGORIES, ['auth', 'members', 'billing', 'classes', 'training', 'checkin', 'settings']);
});
