// ISSN Position Stand: Diets and Body Composition (2017), J Int Soc Sports Nutr.
// ISSN Position Stand: Protein and Exercise (2017), J Int Soc Sports Nutr.
import { effectiveRoutine, lastBW } from './history.js'
import { todayISO } from './format.js'
import { calcularTMB, calcularTDEE } from './calories.js'

/**
 * Calcula la meta calórica diaria a partir del TDEE y del objetivo del usuario.
 *
 * @param {number} tdee - Gasto energético diario estimado, en kcal/día.
 * @param {'bajar'|'mantener'|'subir'|'subir_leve'} objetivo - Objetivo nutricional del usuario.
 * @param {number|null} grasaCorporal - Porcentaje de grasa corporal, o null si no fue cargado.
 * @returns {number} Meta calórica diaria entera, en kcal/día.
 * @throws {Error} Si objetivo no es uno de los cuatro valores válidos.
 */
export function calcularMetaCalorica(tdee, objetivo, grasaCorporal) {
  if (!['bajar', 'mantener', 'subir', 'subir_leve'].includes(objetivo)) {
    throw new Error(`Objetivo inválido: ${objetivo}`)
  }

  if (objetivo === 'mantener') return Math.round(tdee)

  const factor = objetivo === 'bajar'
    ? (grasaCorporal == null || grasaCorporal <= 20 ? 0.85 : 0.75)
    : objetivo === 'subir_leve' ? 1.08 : 1.15

  return Math.round(tdee * factor)
}

/**
 * Convierte el objetivo textual seleccionado en la UI al valor interno de nutrición.
 *
 * @param {'hipertrofia'|'fuerza'|'perder_grasa'|'fitness_general'} objetivoUI - Clave real del objetivo seleccionada en la app.
 * @returns {'subir'|'subir_leve'|'bajar'|'mantener'} Objetivo interno correspondiente.
 * @throws {Error} Si objetivoUI no coincide con una clave reconocida.
 */
export function mapearObjetivoUI(objetivoUI) {
  const mapeo = {
    hipertrofia: 'subir',
    fuerza: 'subir_leve',
    perder_grasa: 'bajar',
    fitness_general: 'mantener'
  }

  if (!Object.prototype.hasOwnProperty.call(mapeo, objetivoUI)) {
    throw new Error(`Objetivo no reconocido: ${objetivoUI}`)
  }

  return mapeo[objetivoUI]
}

/**
 * Calcula la meta diaria de proteína según el peso, el objetivo y la fase calórica.
 *
 * @param {number} pesoKg - Peso corporal del usuario, en kilogramos.
 * @param {boolean} enDeficit - Indica si el usuario está en déficit calórico activo.
 * @returns {number} Meta diaria de proteína, en gramos, con un decimal.
 */
export function calcularMetaProteina(pesoKg, enDeficit) {
  const factor = enDeficit ? 2.4 : 1.8
  return Math.round(pesoKg * factor * 10) / 10
}

/**
 * Ajusta de forma independiente la meta calórica para un día con entrenamiento.
 *
 * Este ajuste se aplica DESPUÉS del ajuste por objetivo (déficit/superávit) y no
 * reemplaza la lógica de calcularMetaCalorica.
 *
 * @param {number} caloriasBase - Meta calórica ya ajustada según el objetivo.
 * @param {boolean} huboEntrenoHoy - Indica si hoy hubo o hay entrenamiento.
 * @returns {number} Meta calórica diaria ajustada, en kcal/día.
 */
export function ajustarPorDiaEntreno(caloriasBase, huboEntrenoHoy) {
  return huboEntrenoHoy === true ? Math.round(caloriasBase * 1.12) : caloriasBase
}

/**
 * Deriva las metas nutricionales visibles a partir del estado del usuario.
 * Mantiene en un único lugar la misma cadena de cálculo usada por las vistas.
 */
export function calcularMetasNutricionales(S) {
  const resp = S.respuestasEncuesta || {}
  const bwObj = lastBW(S)
  const peso = bwObj ? bwObj.w : (resp.pesoKg || 70)
  const altura = S.altura || resp.altura || 170
  const edad = S.edad || resp.edad || 25
  const sexo = resp.sexoBiologico || (S.genero === 'femenino' ? 'femenino' : 'masculino')
  const dias = resp.diasSeleccionados || Object.keys(S.week || {})
  const objetivo = S.objetivo || resp.objetivo || 'fitness_general'
  const tmb = calcularTMB(peso, altura, edad, sexo)
  const tdee = calcularTDEE(tmb, dias)
  const objetivoInterno = mapearObjetivoUI(objetivo)
  const caloriasBase = calcularMetaCalorica(tdee, objetivoInterno, S.grasaCorporal)
  const huboEntrenoHoy = (S.workouts || []).some(w => w.d === todayISO()) || Boolean(effectiveRoutine(S, todayISO()))
  const sugerido = ajustarPorDiaEntreno(caloriasBase, huboEntrenoHoy)
  return {
    peso, altura, edad, objetivo, objetivoInterno, tmb, tdee,
    mantenimiento: tdee, sugerido,
    metaProteina: calcularMetaProteina(peso, objetivoInterno === 'bajar'),
  }
}
