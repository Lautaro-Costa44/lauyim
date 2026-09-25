// Fichas de socio: normalización de datos personales y configuración de campos.
// Sin acceso a la base: server.js y database.js lo usan para validar antes de escribir, y el
// registro con datos de una entrega posterior va a reutilizar lo mismo.

export const MEMBER_FIELDS = ['full_name', 'dni', 'phone', 'email'];
export const MEMBER_FIELDS_SETTING = 'member_fields';

// full_name, dni y phone habilitados y obligatorios; email habilitado y opcional.
export const DEFAULT_MEMBER_FIELDS = Object.freeze({
  full_name: Object.freeze({ enabled: true, required: true }),
  dni: Object.freeze({ enabled: true, required: true }),
  phone: Object.freeze({ enabled: true, required: true }),
  email: Object.freeze({ enabled: true, required: false })
});

const MAX_FULL_NAME = 80;
const MAX_EMAIL = 254;
const MAX_PHONE_INPUT = 30;
const MAX_DNI_INPUT = 20;

const cloneDefaults = () => Object.fromEntries(MEMBER_FIELDS.map(k => [k, { ...DEFAULT_MEMBER_FIELDS[k] }]));

// Config guardada (JSON en admin_settings) → config completa. Un valor corrupto o un campo
// faltante cae al default; nunca devuelve required sin enabled.
export function parseMemberFields(raw) {
  const out = cloneDefaults();
  let stored = null;
  try { stored = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { stored = null; }
  if (!stored || typeof stored !== 'object') return out;
  for (const key of MEMBER_FIELDS) {
    const f = stored[key];
    if (!f || typeof f !== 'object') continue;
    if (typeof f.enabled === 'boolean') out[key].enabled = f.enabled;
    if (typeof f.required === 'boolean') out[key].required = f.required;
    if (!out[key].enabled) out[key].required = false;
  }
  return out;
}

// Cambio parcial sobre la config actual: { dni: { required: false } } toca solo eso.
// → { value } con la config completa resultante, o { error }.
export function validateMemberFields(body, current = DEFAULT_MEMBER_FIELDS) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'La configuración debe ser un objeto' };
  const out = parseMemberFields(current);
  const keys = Object.keys(body);
  if (!keys.length) return { error: 'Nada para actualizar' };
  for (const key of keys) {
    if (!MEMBER_FIELDS.includes(key)) return { error: `Campo desconocido: ${key}` };
    const f = body[key];
    if (!f || typeof f !== 'object' || Array.isArray(f)) return { error: `${key} debe ser { enabled, required }` };
    for (const prop of Object.keys(f)) {
      if (prop !== 'enabled' && prop !== 'required') return { error: `${key}.${prop} no existe` };
      if (typeof f[prop] !== 'boolean') return { error: `${key}.${prop} debe ser true o false` };
    }
    if (f.enabled !== undefined) out[key].enabled = f.enabled;
    if (f.required !== undefined) out[key].required = f.required;
  }
  for (const key of MEMBER_FIELDS) {
    if (out[key].required && !out[key].enabled) return { error: `${key}: un campo obligatorio tiene que estar habilitado` };
  }
  return { value: out };
}

// DNI: solo dígitos (se aceptan puntos, espacios y guiones como separadores), sin ceros a la
// izquierda, 6 a 8 dígitos. → { dni (como se ingresó), dniNorm } o { error }.
export function normalizeDni(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return { error: 'DNI inválido' };
  const dni = String(raw).trim();
  if (!dni || dni.length > MAX_DNI_INPUT || !/^[\d.\s-]+$/.test(dni)) return { error: 'DNI inválido' };
  const dniNorm = dni.replace(/\D/g, '').replace(/^0+/, '');
  if (dniNorm.length < 6 || dniNorm.length > 8) return { error: 'El DNI debe tener entre 6 y 8 dígitos' };
  return { value: { dni, dniNorm } };
}

// Últimos 3 dígitos, para auditoría: nunca el DNI completo fuera de la ficha.
export const maskDni = dniNorm => dniNorm ? '***' + String(dniNorm).slice(-3) : null;

// Número nacional argentino (área + abonado, 10 dígitos) a partir de lo que queda después del
// 0 de larga distancia. Acepta el 15 de celular entre el área y el abonado. null si no cierra.
function arNational(n) {
  if (n.length === 10) return /^(11|[23])/.test(n) ? n : null;
  if (n.length !== 12) return null;
  // Área de 2 dígitos solo existe para 11 (AMBA); las demás son de 3 o 4 y nunca empiezan con 1.
  // Con el 15 en la posición 3 y en la 4 a la vez no hay número posible, así que no hay empate.
  const areaLengths = n.startsWith('11') ? [2] : /^[23]/.test(n) ? [3, 4] : [];
  for (const k of areaLengths) {
    if (n.slice(k, k + 2) === '15') return n.slice(0, k) + n.slice(k + 2);
  }
  return null;
}

// Celular: se guarda lo ingresado y un phone_norm E.164 best-effort para Argentina
// (+549 + área + abonado). Contempla 0 de larga distancia, 15 de celular y los prefijos +54,
// +54 9 y 00 54. Si no se puede normalizar, phoneNorm = null; se rechaza solo con menos de 8
// dígitos o caracteres que no son de teléfono. → { value: { phone, phoneNorm } } o { error }.
export function normalizePhone(raw) {
  if (typeof raw !== 'string' && typeof raw !== 'number') return { error: 'Celular inválido' };
  const phone = String(raw).trim();
  if (!phone || phone.length > MAX_PHONE_INPUT || !/^\+?[\d\s().\-/]+$/.test(phone)) return { error: 'Celular inválido' };
  let digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return { error: 'El celular debe tener al menos 8 dígitos' };

  let international = phone.startsWith('+');
  if (!international && digits.startsWith('00')) { international = true; digits = digits.slice(2); }
  if (digits.length > 15) return { error: 'Celular inválido' };

  let national = null;
  if (international) {
    if (!digits.startsWith('54')) {
      // Número de otro país: E.164 tal cual si el largo es plausible.
      return { value: { phone, phoneNorm: digits.length >= 8 && digits.length <= 15 ? '+' + digits : null } };
    }
    let rest = digits.slice(2);
    if (rest.startsWith('9') && (rest.length === 11 || rest.length === 13)) rest = rest.slice(1);
    if (rest.startsWith('0')) rest = rest.slice(1);
    national = arNational(rest);
  } else {
    national = arNational(digits.startsWith('0') ? digits.slice(1) : digits);
  }
  return { value: { phone, phoneNorm: national ? '+549' + national : null } };
}

// Mail: trim + minúsculas + forma básica usuario@dominio.tld.
export function normalizeEmail(raw) {
  if (typeof raw !== 'string') return { error: 'Mail inválido' };
  const email = raw.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL || !/^[^\s@]+@[^\s@]+\.[^\s@.]+$/.test(email)) return { error: 'Mail inválido' };
  return { value: email };
}

export function normalizeFullName(raw) {
  if (typeof raw !== 'string') return { error: 'Nombre y apellido inválido' };
  const fullName = raw.trim().replace(/\s+/g, ' ');
  if (!fullName || fullName.length > MAX_FULL_NAME) return { error: `Nombre y apellido: obligatorio, máx. ${MAX_FULL_NAME} caracteres` };
  return { value: fullName };
}

// Nombre de campo de la API ↔ clave de configuración.
const BODY_KEYS = { full_name: 'fullName', dni: 'dni', phone: 'phone', email: 'email' };
const FIELD_LABELS = { full_name: 'Nombre y apellido', dni: 'DNI', phone: 'Celular', email: 'Mail' };
const empty = v => v === undefined || v === null || (typeof v === 'string' && !v.trim());

// Perfil vacío en la forma de la base, para completar con lo que llega.
export const EMPTY_PROFILE = Object.freeze({ fullName: null, dni: null, dniNorm: null, phone: null, phoneNorm: null, email: null });

// Valida los datos personales contra la config de campos.
//   body     { fullName?, dni?, phone?, email? } — '' o null borran el campo.
//   current  perfil actual (PUT) o null (alta).
//   partial  PUT: solo cambia lo presente en body; los obligatorios se chequean sobre el
//            resultado. Alta (partial=false): todo lo que falta queda vacío.
// Un campo deshabilitado se ignora (ni se valida ni se escribe: conserva lo guardado).
// → { value: perfil completo resultante, changed: [claves de config que cambiaron] } o
//   { error, field }.
export function validateMemberProfile(body, fields, { current = null, partial = false } = {}) {
  const config = parseMemberFields(fields);
  const out = { ...EMPTY_PROFILE, ...(current || {}) };
  const changed = [];
  for (const key of MEMBER_FIELDS) {
    if (!config[key].enabled) continue;
    const bodyKey = BODY_KEYS[key];
    const present = Object.prototype.hasOwnProperty.call(body || {}, bodyKey);
    if (partial && !present) continue;
    const raw = present ? body[bodyKey] : undefined;
    const before = key === 'dni' ? out.dniNorm : key === 'phone' ? out.phone : key === 'full_name' ? out.fullName : out.email;
    if (empty(raw)) {
      if (key === 'full_name') out.fullName = null;
      else if (key === 'dni') { out.dni = null; out.dniNorm = null; }
      else if (key === 'phone') { out.phone = null; out.phoneNorm = null; }
      else out.email = null;
    } else if (key === 'full_name') {
      const r = normalizeFullName(raw); if (r.error) return { error: r.error, field: key };
      out.fullName = r.value;
    } else if (key === 'dni') {
      const r = normalizeDni(raw); if (r.error) return { error: r.error, field: key };
      out.dni = r.value.dni; out.dniNorm = r.value.dniNorm;
    } else if (key === 'phone') {
      const r = normalizePhone(raw); if (r.error) return { error: r.error, field: key };
      out.phone = r.value.phone; out.phoneNorm = r.value.phoneNorm;
    } else {
      const r = normalizeEmail(raw); if (r.error) return { error: r.error, field: key };
      out.email = r.value;
    }
    const after = key === 'dni' ? out.dniNorm : key === 'phone' ? out.phone : key === 'full_name' ? out.fullName : out.email;
    if ((before ?? null) !== (after ?? null)) changed.push(key);
  }
  for (const key of MEMBER_FIELDS) {
    if (!config[key].required) continue;
    const value = key === 'dni' ? out.dniNorm : key === 'phone' ? out.phone : key === 'full_name' ? out.fullName : out.email;
    if (empty(value)) return { error: `${FIELD_LABELS[key]} es obligatorio`, field: key };
  }
  return { value: out, changed };
}

// Resumen para auditoría: nombres de campos, DNI enmascarado, nunca el celular ni el mail.
export function profileChangeSummary(changed, profile) {
  return changed.map(key => key === 'dni'
    ? `DNI ${profile.dniNorm ? maskDni(profile.dniNorm) : 'borrado'}`
    : FIELD_LABELS[key].toLowerCase()).join(', ');
}

// Código de vinculación: XXXX-XXXX sin 0/O, 1/I/L. `pick(n)` devuelve un entero en [0, n).
export const LINK_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export function formatLinkCode(pick) {
  let code = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += '-';
    code += LINK_CODE_ALPHABET[pick(LINK_CODE_ALPHABET.length)];
  }
  return code;
}

// Lo que tipea el socio (minúsculas, espacios, sin guion) → XXXX-XXXX, o null si no tiene la forma.
export function canonicalLinkCode(raw) {
  const s = String(raw ?? '').toUpperCase().replace(/[\s-]/g, '');
  if (s.length !== 8) return null;
  for (const ch of s) if (!LINK_CODE_ALPHABET.includes(ch)) return null;
  return s.slice(0, 4) + '-' + s.slice(4);
}
