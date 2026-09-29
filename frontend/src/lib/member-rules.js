// Reglas de formato de los datos del socio, copia mínima de api/members.js (el servidor es quien
// decide; esto es para marcar los errores al tocar "Siguiente" o "Habilitar cuenta" sin esperar
// la respuesta). Copia a propósito, no import: web y api se construyen por separado (cada
// Dockerfile copia solo su carpeta).
//
// Si cambiás una regla acá o en api/members.js, cambiá la otra: member-rules.test.js corre la
// misma tabla de casos contra las dos y falla si difieren.
//
// Solo decide si hay error y qué texto mostrar; la normalización que se guarda (dniNorm,
// phoneNorm) la hace el servidor.

const MAX_FULL_NAME = 80
const MAX_EMAIL = 254
const MAX_PHONE_INPUT = 30
const MAX_DNI_INPUT = 20
export const MAX_USERNAME = 40

const FIELD_LABELS = { full_name: 'Nombre y apellido', dni: 'DNI', phone: 'Celular', email: 'Mail' }
const PROPS = { full_name: 'fullName', dni: 'dni', phone: 'phone', email: 'email' }
export const MEMBER_FIELD_KEYS = ['full_name', 'dni', 'phone', 'email']
const empty = v => v === undefined || v === null || (typeof v === 'string' && !v.trim())

export function dniError(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return 'DNI inválido'
  const dni = String(raw).trim()
  if (!dni || dni.length > MAX_DNI_INPUT || !/^[\d.\s-]+$/.test(dni)) return 'DNI inválido'
  const dniNorm = dni.replace(/\D/g, '').replace(/^0+/, '')
  if (dniNorm.length < 6 || dniNorm.length > 8) return 'El DNI debe tener entre 6 y 8 dígitos'
  return null
}

export function phoneError(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return 'Celular inválido'
  const phone = String(raw).trim()
  if (!phone || phone.length > MAX_PHONE_INPUT || !/^\+?[\d\s().\-/]+$/.test(phone)) return 'Celular inválido'
  let digits = phone.replace(/\D/g, '')
  if (digits.length < 8) return 'El celular debe tener al menos 8 dígitos'
  if (!phone.startsWith('+') && digits.startsWith('00')) digits = digits.slice(2)
  if (digits.length > 15) return 'Celular inválido'
  return null
}

export function emailError(raw) {
  if (typeof raw !== 'string') return 'Mail inválido'
  const email = raw.trim().toLowerCase()
  if (!email || email.length > MAX_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@.]+$/.test(email)) return 'Mail inválido'
  return null
}

export function fullNameError(raw) {
  if (typeof raw !== 'string') return 'Nombre y apellido inválido'
  const fullName = raw.trim().replace(/\s+/g, ' ')
  if (!fullName || fullName.length > MAX_FULL_NAME) return `Nombre y apellido: obligatorio, máx. ${MAX_FULL_NAME} caracteres`
  return null
}

export function usernameError(raw) {
  return typeof raw === 'string' && raw.trim() ? null : 'El nombre de usuario es obligatorio'
}

const CHECK = { full_name: fullNameError, dni: dniError, phone: phoneError, email: emailError }

/**
 * Errores de los datos del socio según la config de campos del owner (enabled/required).
 * @param {object} values  { fullName, dni, phone, email } (y `name` si se pasa withUsername)
 * @param {object} fields  config: { full_name: { enabled, required }, ... }
 * @returns {Record<string,string>} { <clave de campo>: texto }, en el orden del formulario;
 *   vacío si está todo bien. `username` primero cuando se valida.
 */
export function profileErrors(values, fields, { withUsername = false } = {}) {
  const out = {}
  if (withUsername) { const e = usernameError(values?.name); if (e) out.username = e }
  for (const key of MEMBER_FIELD_KEYS) {
    const cfg = fields?.[key]
    if (!cfg?.enabled) continue
    const raw = values?.[PROPS[key]]
    if (empty(raw)) { if (cfg.required) out[key] = `${FIELD_LABELS[key]} es obligatorio`; continue }
    const e = CHECK[key](raw)
    if (e) out[key] = e
  }
  return out
}
