// Texto en español para un error de la API, para toasts y avisos. Único lugar con la traducción
// código → texto: una pantalla que necesita un mensaje propio para un caso puntual lo resuelve
// antes de llamar acá (por ejemplo Rutinas con program_name_taken).
//
// Regla para distinguir un código de una frase (`error` del servidor, o `message` del Error):
//   /^[a-z0-9_]+$/  → es un CÓDIGO: se busca en ERROR_TEXTS; si no está, `message` en español que
//                     haya mandado el servidor; si tampoco, el genérico.
//   cualquier otra cosa → es una FRASE ya escrita para mostrar (el servidor las escribe en
//                     español): pasa tal cual.
// Sin respuesta del servidor, api() lanza code 'network_error' (ver lib/api.js).
//
// Errores de validación por campo: el servidor manda
// { error: 'validation_error', message, field, fields: { <campo>: '<código o frase>' } }.
// errorText da el resumen para un toast ("Revisá los datos ingresados."); fieldErrors, el detalle
// por campo, con esta misma regla para cada valor.
import { t } from './i18n.js'

export const GENERIC_ERROR = 'Ocurrió un error, intentá de nuevo'
const CODE = /^[a-z0-9_]+$/

// Cada código que emite el backend tiene que estar acá (lo verifica errors.test.js).
export const ERROR_TEXTS = {
  // conexión y servidor
  network_error: 'Sin conexión. Revisá tu internet e intentá de nuevo.',
  server_error: 'Ocurrió un error en el servidor, intentá de nuevo',
  rate_limited: 'Demasiados intentos, intentá de nuevo más tarde.',
  cross_origin: 'No se pudo completar el pedido. Recargá la app e intentá de nuevo.',
  license_expired: 'La licencia de este gimnasio venció.',
  // genéricos
  validation_error: 'Revisá los datos ingresados.',
  not_found: 'No se encontró lo que buscabas.',
  forbidden: 'No tenés permiso para hacer esto.',
  expired: 'El código venció. Pedí uno nuevo.',
  // cuenta
  account_disabled: 'Tu cuenta fue desactivada. Consultá en recepción.',
  account_rejected: 'Tu cuenta no fue habilitada. Consultá en recepción.',
  account_deleted: 'Tu cuenta fue eliminada.',
  account_pending: 'Tu cuenta todavía no fue habilitada.',
  account_not_active: 'La cuenta no está activa.',
  membership_blocked: 'Tu cuota está vencida. Pasá por recepción.',
  // clases
  class_overlap: 'Ya hay otra clase en ese horario.',
  class_cancelled: 'Esa clase se suspendió.',
  classes_disabled: 'El gimnasio no tiene clases por ahora.',
  booking_not_yet: 'Todavía no se puede reservar esa clase.',
  booking_started: 'La clase ya empezó.',
  booking_cancelled: 'Esa clase se suspendió.',
  class_not_cancelled: 'Solo se puede quitar de la vista una clase suspendida.',
  booking_penalty: 'Por ausencias no podés reservar por unos días.',
  attendance_closed: 'Ya no se puede cambiar la asistencia de esa clase.',
  rating_closed: 'Ya no se puede calificar esa clase.',
  own_class: 'Esa clase la da esa persona: no se anota.',
  class_over: 'Esa clase ya terminó o se suspendió.',
  no_recipients: 'No hay nadie anotado para avisarle.',
  message_limit: 'Ya mandaste 3 mensajes para esta fecha.',
  closure_overlap: 'Ya hay un cierre en esos días.',
  plan_limit: 'Llegaste al límite de clases de tu plan.',
  not_loose: 'Es una clase semanal: suspendé el día o sacala del horario.',
  // passkeys e ingreso
  challenge_expired: 'La solicitud venció. Intentá de nuevo.',
  passkey_verify_failed: 'No se pudo verificar la passkey. Intentá de nuevo.',
  unknown_passkey: 'No encontramos esa passkey. Creá un perfil primero.',
  credential_exists: 'Esa passkey ya está registrada.',
  pairing_expired: 'El código de vinculación venció. Generá uno nuevo.',
  code_not_found: 'El código no existe o venció.',
  invite_required: 'Necesitás un código de invitación.',
  invite_invalid: 'El código de invitación ya no es válido. Pedí uno nuevo.',
  invite_used: 'Esa invitación ya se usó y no se puede revocar.',
  link_invalid: 'El código es incorrecto, venció o ya se usó.',
  link_unavailable: 'Esta ficha ya no se puede vincular. Consultá en recepción.',
  privacy_required: 'Tenés que aceptar el aviso de privacidad.',
  health_consent_required: 'Tenés que aceptar el tratamiento de tus datos de salud.',
  legal_required: 'Tenés que aceptar los términos y condiciones y el aviso de privacidad.',
  legal_version_changed: 'Los términos se actualizaron recién. Revisalos y volvé a aceptar.',
  health_consent_active: 'El consentimiento de datos de salud sigue activo.',
  no_health_consent: 'Sin consentimiento de datos de salud.',
  // staff y usuarios
  admin_undisableable: 'No se puede desactivar a un administrador.',
  staff_undisableable: 'Tiene un rol del staff: quitale el rol antes de desactivarlo.',
  role_too_high: 'Ese rol tiene permisos que vos no tenés.',
  role_not_found: 'El rol ya no existe.',
  role_locked: 'El rol Administrador no se puede eliminar.',
  owner_role_locked: 'No se puede cambiar el rol del dueño.',
  owner_undeletable: 'No se puede eliminar la cuenta del dueño.',
  delete_requires_disabled: 'Solo se pueden eliminar cuentas desactivadas.',
  not_pending: 'La cuenta ya no está pendiente.',
  profile_locked: 'Los datos de esta ficha no se pueden modificar.',
  // fichas y DNI
  dni_exists: 'Ya hay un socio con ese DNI.',
  dni_duplicado: 'Ya hay un socio con ese DNI.',
  dni_deshabilitado: 'El DNI no se pide en este gimnasio.',
  ficha_has_app: 'La ficha ya tiene la app.',
  ficha_not_found: 'La ficha no existe.',
  same_user: 'No se puede unir una cuenta consigo misma.',
  target_not_found: 'La cuenta no existe.',
  target_without_app: 'La cuenta elegida no tiene la app.',
  target_is_staff: 'No se puede unir con una cuenta del staff.',
  ficha_has_role: 'Quitale el rol a la ficha antes de unirla.',
  // cuotas y pruebas
  billing_disabled: 'El cobro de cuotas está desactivado.',
  trial_requires_dni: 'La prueba necesita el DNI del socio (una por persona).',
  trial_used: 'Este socio ya usó su prueba.',
  has_plan: 'El socio tiene un plan vigente.',
  start_not_allowed: 'No se puede elegir la fecha de inicio para este plan.',
  // rutinas y programas
  too_many_exercises: 'La rutina tiene demasiados ejercicios.',
  routine_day_conflict: 'Ya hay una rutina planeada para ese día.',
  program_changed: 'El programa cambió; se recargó la lista.',
  program_name_taken: 'Ya existe un programa con ese nombre.',
  program_hidden: 'Ese programa no está disponible.',
  // Ingreso Físico
  feature_disabled: 'Ingreso Físico está desactivado.',
  device_revoked: 'Este dispositivo ya no está activado para Ingreso Físico.',
  invalid_ticket: 'La búsqueda venció. Ingresá el DNI de nuevo.',
  // notificaciones
  invalid_push_endpoint: 'Este navegador no permite recibir notificaciones.',
  // sync (conflictos que se descartan; no suelen llegar a un toast)
  set_not_object: 'Una serie tiene un formato inválido.',
  workout_not_object: 'Un entrenamiento tiene un formato inválido.',
  set_meta_too_large: 'Una serie tiene demasiados datos.',
  workout_meta_too_large: 'Un entrenamiento tiene demasiados datos.',
}

/**
 * @param {unknown} error  Lo que tiró api() (o cualquier Error / string).
 * @param {string} [fallback] Texto (en español) si el código no es conocido y no vino mensaje.
 */
export function errorText(error, fallback = GENERIC_ERROR) {
  const raw = typeof error === 'string' ? error : error?.code === 'network_error' ? 'network_error' : error?.data?.error ?? error?.message
  if (typeof raw !== 'string' || !raw.trim()) return t(fallback)
  // Errores del navegador (WebAuthn, etc.) y un cuerpo sin `error` ("HTTP 502"): nada para mostrar.
  if ((typeof DOMException !== 'undefined' && error instanceof DOMException) || /^HTTP \d+$/.test(raw)) return t(fallback)
  if (!CODE.test(raw)) return raw
  if (ERROR_TEXTS[raw]) return t(ERROR_TEXTS[raw])
  const message = error?.data?.message
  if (typeof message === 'string' && message.trim() && !CODE.test(message)) return message
  return t(fallback)
}

/**
 * Errores por campo de una respuesta del servidor → { <clave de campo>: texto en español }.
 * Vacío si el error no es de un campo (entonces va errorText a un toast o a un aviso general).
 * Acepta la forma nueva (`fields`) y la vieja (`field` + la frase en `message` o `error`).
 */
export function fieldErrors(error) {
  const data = error?.data
  if (!data) return {}
  const text = value => (typeof value === 'string' && value.trim() ? (CODE.test(value) ? t(ERROR_TEXTS[value] || GENERIC_ERROR) : value) : t(GENERIC_ERROR))
  if (data.fields && typeof data.fields === 'object') return Object.fromEntries(Object.entries(data.fields).map(([key, value]) => [key, text(value)]))
  if (typeof data.field === 'string') return { [data.field]: text(data.message || data.error) }
  return {}
}

