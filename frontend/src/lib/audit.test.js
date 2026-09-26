import { describe, it, expect } from 'vitest'
import { auditCat, auditLabel, auditReason, auditLine, fmtWhen } from './audit.js'

// Every event name and reason code the server can emit (api/server.js, the audit block).
// If a new one is added there without a label here, the first test fails rather than the
// dashboard quietly printing a dotted identifier at a person.
const EVENTS = [
  'auth.login.ok', 'auth.login.fail', 'auth.register.ok', 'auth.register.fail',
  'auth.register.denied', 'auth.qr.validate.fail', 'auth.logout', 'auth.logout.all', 'auth.device.approved',
  'auth.device.login', 'auth.cred.added', 'admin.user.disable', 'admin.user.enable',
  'admin.preset.create', 'admin.preset.update', 'admin.preset.delete',
  'admin.attendance.settings', 'admin.invite.create', 'admin.invite.revoke',
  'admin.push.send', 'admin.audit.clear', 'admin.denied', 'owner.denied',
    'admin.nutrition.goals.update', 'admin.nutrition.suggestions.limit.update',
    'admin.nutrition.suggestion.assign', 'admin.nutrition.suggestion.create',
    'admin.nutrition.suggestion.update', 'admin.nutrition.suggestion.enable',
  'admin.nutrition.suggestion.remove', 'admin.injury.update',
  'admin.injury.exercise_warning.override', 'admin.routine.update',
  'owner.user.promote', 'owner.user.demote', 'owner.user.delete', 'owner.qr.regenerate',
  'admin.billing.plan_create', 'admin.billing.plan_update', 'admin.billing.assign', 'admin.billing.payment',
  'admin.billing.payment_void', 'admin.billing.settings', 'admin.billing.blocked', 'admin.billing.unblocked',
  'admin.member.create', 'admin.member.profile_update', 'admin.member.link_code', 'admin.member.link_code_revoke',
  'admin.member.merge', 'owner.member.fields', 'auth.link.ok', 'auth.link.fail',
  'owner.billing.enabled', 'owner.billing.disabled', 'admin.notifications.settings', 'admin.billing.trial_start',
  'owner.privacy.settings', 'owner.approval.settings', 'admin.member.approve', 'admin.member.reject',
  'auth.profile.self', 'auth.health.granted', 'auth.health.revoked', 'auth.health.deleted'
]
const REASONS = [
  'challenge-expired', 'unknown-credential', 'verify-error', 'not-verified',
  'user-missing', 'account-disabled', 'credential-exists', 'invite-invalid', 'invite-rejected', 'qr-invalid',
  'link-invalid', 'link-unavailable', 'link-revoked'
]

describe('auditLabel', () => {
  it('has a sentence for every event the server emits', () => {
    for (const ev of EVENTS) {
      expect(auditLabel(ev), ev).not.toBe(ev)
      expect(auditLabel(ev)).toMatch(/^[A-Z]/)
    }
  })

  it('renders final-state summaries for new admin events', () => {
    expect(auditLabel('admin.nutrition.goals.update')).not.toBe('Unknown activity')
    expect(auditLine({ ev: 'admin.nutrition.goals.update', ok: true, name: 'doctora', tname: 'socio', summary: 'Metas: manual · 2000 kcal · quema 500 · P150 C200 G60' }).sub)
      .toBe('doctora → socio · Metas: manual · 2000 kcal · quema 500 · P150 C200 G60')
    expect(auditLine({ ev: 'admin.injury.update', ok: true, summary: 'Lesiones: ninguna' }).sub)
      .toBe('Lesiones: ninguna')
  })

  it('keeps old records without a summary unchanged', () => {
    expect(auditLine({ ev: 'admin.routine.update', ok: true, name: 'doctora', tname: 'socio' }).sub)
      .toBe('doctora → socio')
  })

  it('uses a readable fallback instead of exposing a technical event name', () => {
    expect(auditLabel('auth.something.new')).toBe('Unknown activity')
    expect(auditLabel(undefined)).toBe('Unknown activity')
    expect(auditLabel('')).toBe('Unknown activity')
  })
})

describe('auditCat', () => {
  it('takes the filter category from the first segment', () => {
    expect(auditCat('auth.login.ok')).toBe('auth')
    expect(auditCat('admin.invite.create')).toBe('admin')
  })
  it('survives a missing event name', () => {
    expect(auditCat(undefined)).toBe('')
  })
  it('puts every known event in exactly auth or admin', () => {
    expect([...new Set(EVENTS.map(auditCat))].sort()).toEqual(['admin', 'auth', 'owner'])
  })

  it('keeps owner actions identifiable for the administration filter', () => {
    expect(auditCat('owner.user.promote')).toBe('owner')
    expect(auditCat('owner.user.demote')).toBe('owner')
    expect(auditCat('owner.user.delete')).toBe('owner')
  })
})

describe('auditReason', () => {
  it('has plain English for every reason code', () => {
    for (const m of REASONS) {
      expect(auditReason(m), m).not.toBe(m)
      expect(auditReason(m).length).toBeGreaterThan(3)
    }
  })
  it('falls back to the raw code and tolerates none at all', () => {
    expect(auditReason('brand-new-code')).toBe('brand-new-code')
    expect(auditReason(undefined)).toBe('')
  })
})

describe('auditLine', () => {
  it('names the person who did it', () => {
    expect(auditLine({ ev: 'auth.login.ok', ok: true, uid: 'u1', name: 'Duarte' }))
      .toEqual({ title: 'Signed in', sub: 'Duarte' })
  })

  it('shows both sides of an admin action', () => {
    const l = auditLine({ ev: 'admin.user.disable', ok: true, uid: 'a', name: 'Duarte', tgt: 'b', tname: 'Ana' })
    expect(l.title).toBe('Disabled an account')
    expect(l.sub).toBe('Duarte → Ana')
  })

  it('shows both sides of owner actions', () => {
    const l = auditLine({ ev: 'owner.user.promote', ok: true, name: 'doctora', tname: 'santiago miano' })
    expect(l.title).toBe('Promoted to Admin')
    expect(l.sub).toBe('doctora → santiago miano')
  })

  it('joins actor, target, and summary without a dangling separator', () => {
    expect(auditLine({ ev: 'admin.routine.update', ok: true, name: 'doctora', tname: 'testeando', summary: "Rutina 'Push' actualizada" }).sub)
      .toBe("doctora → testeando · Rutina 'Push' actualizada")
    expect(auditLine({ ev: 'admin.routine.update', ok: true, tname: 'testeando', summary: 'Grupo actualizado' }).sub)
      .toBe('→ testeando · Grupo actualizado')
  })

  it('translates the reason on a failure but not the invite code on a success', () => {
    expect(auditLine({ ev: 'auth.login.fail', ok: false, msg: 'unknown-credential' }).sub)
      .toBe('unknown caller · unknown passkey')
    // admin.invite.* put the actual code in msg — that must not be run through auditReason.
    expect(auditLine({ ev: 'admin.invite.create', ok: true, name: 'Duarte', msg: 'A1B2C3D4' }).sub)
      .toBe('Duarte · A1B2C3D4')
  })

  it('says "unknown caller" only when a failure carries no identity', () => {
    expect(auditLine({ ev: 'auth.login.fail', ok: false }).sub).toBe('unknown caller')
    // A successful event without a name is not an anonymous attacker, so it stays blank.
    expect(auditLine({ ev: 'auth.logout', ok: true }).sub).toBe('')
  })

  it('falls back to the uid when the name was never recorded', () => {
    expect(auditLine({ ev: 'auth.login.fail', ok: false, uid: 'Xy1', msg: 'user-missing' }).sub)
      .toBe('Xy1 · the passkey points at a profile that no longer exists')
  })

  it('appends the network when the operator opted into IPs', () => {
    expect(auditLine({ ev: 'auth.login.ok', ok: true, name: 'Duarte', ip: '203.0.113.0/24' }).sub)
      .toBe('Duarte · 203.0.113.0/24')
  })

  it('renders nothing rather than throwing on a missing record', () => {
    expect(auditLine(undefined)).toEqual({ title: '', sub: '' })
  })

  it('renders an old record without actor, target, or summary', () => {
    expect(auditLine({ ev: 'admin.routine.update', ok: true }).sub).toBe('')
  })
})

describe('fmtWhen', () => {
  const at = (y, m, d, h, min) => new Date(y, m - 1, d, h, min).getTime()
  const now = at(2026, 8, 23, 15, 0)   // Sunday

  it('says "today" for the same calendar day', () => {
    expect(fmtWhen(at(2026, 8, 23, 9, 5), now)).toMatch(/^today /)
    expect(fmtWhen(at(2026, 8, 23, 0, 1), now)).toMatch(/^today /)
  })

  it('uses the weekday inside the last six days', () => {
    const s = fmtWhen(at(2026, 8, 21, 18, 30), now)
    expect(s).not.toMatch(/^today/)
    expect(s).toMatch(/^[A-Za-zÀ-ÿ.]+ \d/)
  })

  it('falls back to a date once it is older', () => {
    expect(fmtWhen(at(2026, 8, 12, 14, 32), now)).toMatch(/\d/)
    expect(fmtWhen(at(2026, 8, 12, 14, 32), now)).not.toMatch(/^today/)
  })

  it('always carries a time of day — that is the whole point of not reusing fmtDate', () => {
    for (const ts of [at(2026, 8, 23, 9, 5), at(2026, 8, 21, 18, 30), at(2026, 8, 12, 14, 32)]) {
      expect(fmtWhen(ts, now)).toMatch(/\d{1,2}[:.]\d{2}/)
    }
  })

  it('does not call a future timestamp "3 days ago"', () => {
    // Clock skew between server and browser is real; a tomorrow must not read as a weekday.
    expect(fmtWhen(at(2026, 8, 30, 10, 0), now)).not.toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/)
  })

  it('returns an empty string for a missing timestamp', () => {
    expect(fmtWhen(0)).toBe('')
    expect(fmtWhen(undefined)).toBe('')
  })
})
