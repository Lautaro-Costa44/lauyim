// Rendering for the admin activity log (GET /api/admin/audit).
//
// The server stores reason codes, not sentences — `{ ev: 'auth.login.fail', msg: 'unknown-credential' }`
// rather than "someone tried a passkey we don't know". Turning those into readable labels
// belongs here and not in Admin.jsx: it is the only part of the feature that can be wrong in a way
// a person sees, and as a plain module it is testable without mounting the dashboard.
//
// Labels are source strings passed through t(), so the operator surface follows the active locale.
import { dateLocale, t } from './i18n-core.js'

// The first segment of an event name is also the filter chip it belongs to.
export const auditCat = ev => String(ev || '').split('.')[0]

const LABELS = {
  'auth.login.ok': 'Signed in',
  'auth.login.fail': 'Sign-in failed',
  'auth.register.ok': 'Created a profile',
  'auth.register.fail': 'Profile creation failed',
  'auth.register.denied': 'Signup refused',
  'auth.qr.validate.fail': 'QR access validation failed',
  'auth.logout': 'Signed out',
  'auth.logout.all': 'Signed out everywhere',
  'auth.device.approved': 'Approved a device',
  'auth.device.login': 'Signed in from a paired device',
  'auth.cred.added': 'Added a passkey',
  'admin.user.disable': 'Disabled an account',
  'admin.user.enable': 'Re-enabled an account',
  'admin.preset.create': 'Created a preset',
  'admin.preset.update': 'Updated a preset',
  'admin.preset.delete': 'Deleted a preset',
  'admin.attendance.settings': 'Changed attendance settings',
  'admin.invite.create': 'Created an invite code',
  'admin.invite.revoke': 'Revoked an invite code',
  'admin.push.send': 'Sent a push notification',
  'admin.audit.clear': 'Cleared the activity log',
  'admin.nutrition.goals.update': 'Updated nutrition goals',
  'admin.nutrition.suggestions.limit.update': 'Changed suggested meals limit',
  'admin.nutrition.suggestion.assign': 'Assigned a suggested meal',
  'admin.nutrition.suggestion.create': 'Created a suggested meal',
  'admin.nutrition.suggestion.update': 'Updated a suggested meal',
  'admin.nutrition.suggestion.enable': 'Changed a suggested meal status',
  'admin.nutrition.suggestion.remove': 'Removed a suggested meal',
  'admin.injury.update': 'Updated injuries',
  'admin.injury.exercise_warning.override': 'Overrode an injury warning',
  'admin.routine.update': 'Updated a routine',
  'admin.denied': 'Blocked from the admin dashboard',
  'owner.denied': 'Blocked: owner access required',
  'owner.user.promote': 'Promoted to Admin',
  'owner.user.demote': 'Removed as Admin',
  'owner.user.delete': 'Deleted an account',
  'owner.qr.regenerate': 'Regenerated the QR access token'
}

const UNKNOWN_EVENT = 'Unknown activity'

// Never expose a technical event identifier to an operator. Keep a console warning in
// development so a newly added server event is easy to catch during development.
export const auditLabel = ev => {
  if (!ev) return t(UNKNOWN_EVENT)
  const label = LABELS[ev]
  if (!label) {
    if (import.meta.env?.DEV) console.warn('[audit] Missing label for event:', ev)
    return t(UNKNOWN_EVENT)
  }
  return t(label)
}

const REASONS = {
  'challenge-expired': 'the sign-in took too long and expired',
  'unknown-credential': 'unknown passkey',
  'verify-error': 'the passkey could not be verified',
  'not-verified': 'the passkey was rejected',
  'user-missing': 'the passkey points at a profile that no longer exists',
  'account-disabled': 'the account is disabled',
  'credential-exists': 'that passkey already belongs to a profile',
  'invite-invalid': 'the invite code was used or revoked in the meantime',
  'invite-rejected': 'wrong or already-used invite code',
  'qr-invalid': 'invalid or outdated QR access token'
}
export const auditReason = msg => t(REASONS[msg] || (msg ? String(msg) : ''))

// → { title, sub }. `sub` is the house "a · b · c" metadata line used by every list row.
export function auditLine(e) {
  if (!e) return { title: '', sub: '' }
  const parts = []
  const identity = []
  if (e.name) identity.push(e.name)
  else if (e.uid) identity.push(e.uid)
  else if (!e.ok) identity.push(t('unknown caller'))
  if (e.tname) identity.push('→ ' + e.tname)
  if (identity.length) parts.push(identity.join(' '))
  if (e.summary) parts.push(e.summary)
  // The reason codes and the invite codes share the msg field; only failures read as a reason.
  if (e.msg) parts.push(e.ok ? e.msg : auditReason(e.msg))
  if (e.ip) parts.push(e.ip)
  return { title: auditLabel(e.ev), sub: parts.join(' · ') }
}

// The activity log is the one place in the app that needs a clock, and fmtDate() renders none —
// it is used by every other view and is not worth changing for this.
export function fmtWhen(ts, now = Date.now()) {
  if (!ts) return ''
  const d = new Date(ts)
  const time = d.toLocaleTimeString(dateLocale(), { hour: '2-digit', minute: '2-digit' })
  const n = new Date(now)
  const sameDay = d.toDateString() === n.toDateString()
  if (sameDay) return t('today') + ' ' + time
  if (now - ts < 6 * 86400000 && ts <= now) return d.toLocaleDateString(dateLocale(), { weekday: 'short' }) + ' ' + time
  return d.toLocaleDateString(dateLocale(), { day: 'numeric', month: 'short' }) + ' ' + time
}
