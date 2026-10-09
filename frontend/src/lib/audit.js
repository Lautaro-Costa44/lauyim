// Rendering for the admin activity log (GET /api/admin/audit).
//
// The server stores reason codes, not sentences — `{ ev: 'auth.login.fail', msg: 'unknown-credential' }`
// rather than "someone tried a passkey we don't know". Turning those into readable labels
// belongs here and not in Admin.jsx: it is the only part of the feature that can be wrong in a way
// a person sees, and as a plain module it is testable without mounting the dashboard.
//
// Labels are source strings passed through t(), so the operator surface follows the active locale.
import { dateLocale, t } from './i18n-core.js'

// The first segment of an event name (legacy; the server now sends each event's category).
export const auditCat = ev => String(ev || '').split('.')[0]

// Categorías del registro (api/audit-categories.js manda `cat` en cada evento). '' es todo y
// 'fail' los fallidos de cualquiera.
export const AUDIT_FILTERS = [
  ['', 'Todo'], ['auth', 'Accesos'], ['members', 'Socios'], ['billing', 'Cuotas'], ['classes', 'Clases'],
  ['training', 'Entrenamiento'], ['checkin', 'Ingreso físico'], ['settings', 'Configuración'], ['fail', 'Fallidos']
]
const CATEGORY_LABELS = Object.fromEntries(AUDIT_FILTERS.filter(([v]) => v && v !== 'fail'))
export const auditCategoryLabel = cat => t(CATEGORY_LABELS[cat] || 'Otros')

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
  'auth.link.ok': 'Linked app access to a member record',
  'auth.link.fail': 'App access linking failed',
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
  'admin.billing.plan_create': 'Created a membership plan',
  'admin.billing.plan_update': 'Updated a membership plan',
  'admin.billing.assign': 'Assigned a membership plan',
  'admin.billing.payment': 'Recorded a payment',
  'admin.billing.payment_void': 'Voided a payment',
  'admin.billing.settings': 'Changed membership settings',
  'admin.billing.blocked': 'Membership blocked',
  'admin.billing.unblocked': 'Membership unblocked',
  'admin.billing.trial_start': 'Started a free trial',
  'admin.member.create': 'Created a member record',
  'admin.member.profile_update': 'Updated member details',
  'admin.member.link_code': 'Generated an app link code',
  'admin.member.link_code_revoke': 'Revoked an app link code',
  'admin.member.merge': 'Merged a member record into an account',
  'admin.denied': 'Blocked from the admin dashboard',
  'owner.denied': 'Blocked: owner access required',
  'owner.user.promote': 'Promoted to Admin',
  'owner.user.demote': 'Removed as Admin',
  'owner.user.delete': 'Deleted an account',
  'owner.qr.regenerate': 'Regenerated the QR access token',
  'owner.checkin.settings': 'Cambió la configuración de Ingreso Físico',
  'admin.checkin.device.create': 'Activó un dispositivo de Ingreso Físico',
  'admin.checkin.device.revoke': 'Revocó un dispositivo de Ingreso Físico',
  'checkin.ok': 'Ingreso Físico registrado',
  'checkin.fail': 'Ingreso Físico sin coincidencia',
  'checkin.blocked': 'Ingreso Físico rechazado: cuota bloqueada',
  'checkin.exit': 'Salió de la pantalla de Ingreso Físico',
  'checkin.exit.denied': 'Salida de Ingreso Físico rechazada (passkey sin permiso)',
  'owner.member.fields': 'Changed member record fields',
  'owner.member.import': 'Imported members',
  'owner.member.export': 'Exported members',
  'owner.billing.enabled': 'Turned membership billing on',
  'owner.billing.disabled': 'Turned membership billing off',
  'admin.notifications.settings': 'Changed membership notice time',
  'owner.privacy.settings': 'Changed the privacy notice details',
  'owner.approval.settings': 'Changed account approval',
  'admin.member.approve': 'Approved a pending account',
  'admin.member.reject': 'Rejected a pending account',
  'auth.profile.self': 'Filled in their member details',
  'auth.health.granted': 'Gave consent for health data',
  'auth.health.revoked': 'Withdrew consent for health data',
  'auth.health.deleted': 'Deleted their health data',
  'auth.legal.accepted': 'Accepted the terms and privacy notice',
  'owner.branding.settings': 'Changed the app personalization',
  'owner.branding.reset': 'Reset the app personalization to lauyim',
  // Registro y accesos
  'owner.audit.clear': 'Borró el registro de actividad',
  'auth.device.claim.fail': 'Falló la vinculación de un dispositivo',
  'auth.device.login.fail': 'Falló el ingreso desde un dispositivo vinculado',
  // Roles
  'admin.user.role': 'Cambió el rol de una persona',
  'owner.role.save': 'Guardó un rol',
  'owner.role.delete': 'Borró un rol',
  // Programas y plantillas
  'admin.preset.duplicate': 'Duplicó un preset',
  'admin.program.delete': 'Borró un programa',
  'admin.program.rename': 'Renombró un programa',
  'admin.program.visibility': 'Cambió la visibilidad de un programa',
  'admin.program.duplicate': 'Duplicó un programa',
  'admin.nutrition.template.create': 'Creó una plantilla de comidas',
  'admin.nutrition.template.update': 'Editó una plantilla de comidas',
  'admin.nutrition.template.delete': 'Borró una plantilla de comidas',
  // Clases
  'classes.type.save': 'Guardó una clase',
  'classes.type.archive': 'Archivó una clase',
  'classes.slot.save': 'Cambió el horario semanal de una clase',
  'classes.slot.delete': 'Sacó un día del horario de una clase',
  'classes.session.change': 'Cambió una fecha de clase',
  'classes.session.hide': 'Quitó de la vista una clase suspendida',
  'classes.session.delete': 'Eliminó una clase suelta',
  'classes.booking.add': 'Anotó a un socio en una clase',
  'classes.booking.cancel': 'Canceló la reserva de un socio',
  'classes.attendance': 'Tomó lista en una clase',
  'classes.message': 'Mandó un mensaje a los anotados',
  'classes.penalty.reset': 'Levantó la penalización de un socio',
  'classes.closure.add': 'Cerró el gimnasio',
  'classes.closure.delete': 'Reabrió el gimnasio',
  'gym.closure.add': 'Cerró el gimnasio',
  'gym.closure.delete': 'Reabrió el gimnasio',
  'owner.transfer': 'Pasó el rol de dueño',
  'owner.transfer.denied': 'Intentó pasar el rol de dueño con una passkey ajena',
  'owner.classes.settings': 'Cambió los ajustes de clases'
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
  'qr-invalid': 'invalid or outdated QR access token',
  'link-invalid': 'wrong, used, expired or revoked link code',
  'link-unavailable': 'the member already has app access or is disabled',
  'link-revoked': 'too many failed attempts, the link code was revoked'
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
