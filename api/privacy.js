// Aviso de privacidad: datos del responsable (el gym) que configura el owner en Acceso.
// Se guardan en admin_settings; la página pública (/#/privacidad) los lee sin sesión.
export const PRIVACY_GYM_NAME_SETTING = 'privacy_gym_name';
export const PRIVACY_CONTACT_SETTING = 'privacy_contact';
export const MAX_PRIVACY_GYM_NAME = 80;
export const MAX_PRIVACY_CONTACT = 200;

const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : null;

// body: { gymName?, contact? } (strings; '' borra). → { value: { gymName?, contact? } } o { error }.
export function validatePrivacySettings(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Datos inválidos' };
  const value = {};
  for (const [key, max, label] of [['gymName', MAX_PRIVACY_GYM_NAME, 'El nombre del gimnasio'], ['contact', MAX_PRIVACY_CONTACT, 'El contacto']]) {
    if (body[key] === undefined) continue;
    const v = clean(body[key]);
    if (v === null) return { error: `${label} tiene que ser texto` };
    if (v.length > max) return { error: `${label} admite hasta ${max} caracteres` };
    value[key] = v;
  }
  if (!Object.keys(value).length) return { error: 'Nada para guardar' };
  return { value };
}
