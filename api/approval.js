// Aprobación de cuentas (spec 12.3 y 12.6): reglas puras. La config vive en admin_settings.
import { MEMBER_FIELDS, parseMemberFields } from './members.js';

export const APPROVAL_REQUIRED_SETTING = 'approval_required';
export const APPROVAL_MODE_SETTING = 'approval_mode';
// approve: habilitar (con pago o prueba opcionales si hay cuotas) · payment: registrar el primer
// pago · trial: iniciar la prueba gratis. Los dos últimos necesitan cuotas; trial, además, DNI.
export const APPROVAL_MODES = ['approve', 'payment', 'trial'];

// getSetting(key, fallback) → { required, mode }
export function readApprovalSettings(getSetting) {
  const mode = getSetting(APPROVAL_MODE_SETTING, 'approve');
  return {
    required: getSetting(APPROVAL_REQUIRED_SETTING, '0') === '1',
    mode: APPROVAL_MODES.includes(mode) ? mode : 'approve'
  };
}

// body: { required?, mode? } → { value: { required?, mode? } } o { status, error, message }.
// El modo que no aplica hoy (sin cuotas o sin DNI) no se puede elegir.
export function validateApprovalSettings(body, { billingEnabled, dniEnabled }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { status: 400, error: 'Datos inválidos' };
  const value = {};
  if (body.required !== undefined) {
    if (typeof body.required !== 'boolean') return { status: 400, error: 'required debe ser true o false' };
    value.required = body.required;
  }
  if (body.mode !== undefined) {
    if (!APPROVAL_MODES.includes(body.mode)) return { status: 400, error: `mode debe ser uno de: ${APPROVAL_MODES.join(', ')}` };
    if (body.mode !== 'approve' && !billingEnabled) return { status: 409, error: 'billing_disabled', message: 'Este modo necesita el cobro de cuotas activado' };
    if (body.mode === 'trial' && !dniEnabled) return { status: 409, error: 'trial_requires_dni', message: 'La prueba necesita que se pida el DNI (una por persona)' };
    value.mode = body.mode;
  }
  if (!Object.keys(value).length) return { status: 400, error: 'Nada para guardar' };
  return { value };
}

// El modo que se aplica al confirmar: sin cuotas, siempre "approve".
export const effectiveMode = (mode, billingEnabled) => billingEnabled && APPROVAL_MODES.includes(mode) ? mode : 'approve';

// Qué puede elegir el staff al confirmar. En payment/trial, una cuenta que ya tiene un plan
// vigente o una prueba en curso (p. ej. después de unirla con su ficha) puede solo aprobarse.
export function allowedStarts(mode, { billingEnabled, covered }) {
  const m = effectiveMode(mode, billingEnabled);
  if (!billingEnabled) return ['none'];
  if (m === 'approve') return ['none', 'payment', 'trial'];
  return covered ? [m, 'none'] : [m];
}

const PROFILE_VALUE = { full_name: 'fullName', dni: 'dniNorm', phone: 'phone', email: 'email' };
export const profileHasData = profile => !!profile && MEMBER_FIELDS.some(k => String(profile[PROFILE_VALUE[k]] ?? '').trim());
export const anyFieldEnabled = fields => MEMBER_FIELDS.some(k => parseMemberFields(fields)[k].enabled);

// ¿Se le muestra (una sola vez) el formulario de datos a un socio que ya existía?
// user: fila de users. Solo con la aprobación apagada, nunca a staff ni a pendientes.
export function needsProfilePrompt(user, { admin, approvalRequired, fields, profile }) {
  if (!user || admin || approvalRequired) return false;
  if (user.approval_status === 'pending' || user.profile_prompted_at) return false;
  return anyFieldEnabled(fields) && !profileHasData(profile);
}
