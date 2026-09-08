// Calculation of Basal Metabolic Rate (TMB) via Mifflin-St Jeor formula and TDEE estimation
export function calcularTMB(pesoKg, alturaCm, edad, sexoBiologico = 'masculino') {
  const p = Math.max(30, Math.min(250, +pesoKg || 70))
  const a = Math.max(100, Math.min(250, +alturaCm || 170))
  const e = Math.max(14, Math.min(90, +edad || 25))

  if (sexoBiologico === 'femenino') {
    return Math.round(10 * p + 6.25 * a - 5 * e - 161)
  }
  return Math.round(10 * p + 6.25 * a - 5 * e + 5)
}

/**
 * Calcula el gasto energético diario total según los días de entrenamiento.
 *
 * @param {number} tmb - Tasa metabólica basal, en kcal/día.
 * @param {Array|number} diasSeleccionados - Días de entrenamiento seleccionados o su cantidad.
 * @returns {number} Gasto energético diario total entero, en kcal/día.
 */
export function calcularTDEE(tmb, diasSeleccionados = []) {
  const nDias = Array.isArray(diasSeleccionados) ? diasSeleccionados.length : (+diasSeleccionados || 3)
  const factorActividad = nDias >= 5 ? 1.55 : nDias >= 3 ? 1.375 : 1.2
  return Math.round(tmb * factorActividad)
}
