// Datos de salud (Ley 25.326, art. 7: sensibles, con consentimiento expreso). Decisión de
// Lautaro (26/09/2026): peso corporal, edad, género, altura, % de grasa, lesiones y nutrición.
// Sin consentimiento la app sirve igual para entrenar: estos datos no se muestran, no se
// sincronizan ni se procesan; lo ya cargado se conserva hasta que el socio pida borrarlo.

// users.health_consent: 'granted' | 'declined' | NULL (cuenta de antes: todavía no se le preguntó;
// hasta que conteste se comporta como antes).
export const healthConsentOf = user => user?.health_consent === 'granted' || user?.health_consent === 'declined' ? user.health_consent : null;
export const healthDeclined = user => healthConsentOf(user) === 'declined';

// Campos del estado del socio (getUserState) que son datos de salud.
export const HEALTH_STATE_FIELDS = ['edad', 'altura', 'genero', 'grasaCorporal', 'pesoKg', 'targetW'];
// Respuestas de la encuesta (respuestasEncuesta) que son datos de salud.
export const HEALTH_SURVEY_KEYS = ['edad', 'pesoKg', 'altura', 'sexoBiologico', 'lesiones', 'tieneLesion'];

const withoutKeys = (obj, keys) => {
  if (!obj || typeof obj !== 'object') return obj ?? null;
  const out = { ...obj };
  for (const k of keys) delete out[k];
  return out;
};

// Lo que ve el socio sin consentimiento: el estado sin datos de salud.
export function stripHealth(state) {
  if (!state) return state;
  const out = { ...state };
  for (const k of HEALTH_STATE_FIELDS) out[k] = null;
  out.bodyweight = [];
  out.respuestasEncuesta = withoutKeys(state.respuestasEncuesta, HEALTH_SURVEY_KEYS);
  out.nutritionGoals = null;
  return out;
}

// Lo que se guarda sin consentimiento: lo que manda el cliente, pero con los datos de salud que
// ya estaban en el servidor (ni se pisan ni se borran por un sync).
export function keepStoredHealth(incoming, stored) {
  if (!incoming) return incoming;
  const out = { ...incoming };
  for (const k of HEALTH_STATE_FIELDS) out[k] = stored?.[k] ?? null;
  out.bodyweight = Array.isArray(stored?.bodyweight) ? stored.bodyweight : [];
  const survey = withoutKeys(incoming.respuestasEncuesta, HEALTH_SURVEY_KEYS);
  const kept = {};
  for (const k of HEALTH_SURVEY_KEYS) if (stored?.respuestasEncuesta && k in stored.respuestasEncuesta) kept[k] = stored.respuestasEncuesta[k];
  out.respuestasEncuesta = survey || Object.keys(kept).length ? { ...(survey || {}), ...kept } : null;
  return out;
}
