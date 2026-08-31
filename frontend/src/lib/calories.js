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

export function calcularCaloriasSugeridas(tmb, diasSeleccionados = [], objetivo = 'fitness_general') {
  const nDias = Array.isArray(diasSeleccionados) ? diasSeleccionados.length : (+diasSeleccionados || 3)
  const factorActividad = nDias >= 5 ? 1.55 : nDias >= 3 ? 1.375 : 1.2
  const mantenimiento = Math.round(tmb * factorActividad)

  const ajuste = {
    hipertrofia: 1.125,
    fuerza: 1.125,
    perder_grasa: 0.825,
    fitness_general: 1.0,
  }[objetivo] || 1.0

  const sugerido = Math.round(mantenimiento * ajuste)
  return { mantenimiento, sugerido }
}
