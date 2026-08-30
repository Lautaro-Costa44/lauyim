/**
 * Motor de generación de rutinas personalizadas — lauyim (v5)
 * Implementa los requerimientos actualizados:
 *  1. Ejercicios de cardio inyectados con notas formateadas (tiempo + velocidad/intensidad).
 *  2. Estiramientos estrictamente coherentes con los músculos trabajados en cada sesión específica.
 *  3. Secuenciación visual: Fuerza -> Cardio -> Estiramientos.
 *  4. Exclusión de peso corporal si el usuario prefiere máquinas, poleas o pesos libres.
 */

import exerciseNamesEs from '../locales/exercise-names-es.js'
import { CUSTOM_CARDIO_EXERCISES } from './exercises.js'

export const DAY_MAP = {
  domingo: 0,
  lunes: 1,
  martes: 2,
  miercoles: 3,
  jueves: 4,
  viernes: 5,
  sabado: 6,
}

export const DAY_NAMES_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

/* ============================================================
   §1 — Derivación del Split
   ============================================================ */
export function defaultSplitRecomendado(nivel, dias) {
  if (dias === 1) return 'fullbody'
  if (nivel === 'principiante') return 'fullbody'
  if (nivel === 'intermedio') {
    if (dias <= 3) return 'fullbody'
    if (dias === 4) return 'torso_pierna'
    return 'ppl'
  }
  if (dias <= 3) return 'fullbody'
  if (dias === 4) return 'torso_pierna'
  return 'ppl'
}

export function derivarSplit(nivel, dias, splitPreferido, enfoque) {
  if (dias === 1) {
    const split = 'fullbody'
    let avisoFrecuencia
    if (splitPreferido && splitPreferido !== 'fullbody') {
      avisoFrecuencia = 'Con 1 solo día disponible, asignamos Full Body para que todo tu cuerpo reciba estímulo en esa sesión.'
    }
    return { split, splitAjustado: Boolean(avisoFrecuencia), avisoFrecuencia }
  }

  if (enfoque === 'piernas_gluteos') {
    return { split: 'pierna_prioridad', splitAjustado: Boolean(splitPreferido && splitPreferido !== 'pierna_prioridad') }
  }

  const split = splitPreferido || defaultSplitRecomendado(nivel, dias)
  let avisoFrecuencia

  if (split === 'ppl' && dias <= 3) {
    avisoFrecuencia = 'Con 3 días, cada grupo muscular se entrena 1 vez por semana. Si buscás más frecuencia por músculo, te recomendamos Full Body.'
  } else if (split === 'torso_pierna' && dias < 4) {
    avisoFrecuencia = `Con ${dias} días, la frecuencia de Torso/Pierna puede quedar desbalanceada. Te sugerimos Full Body para estimular todo el cuerpo por igual.`
  }

  return { split, splitAjustado: Boolean(splitPreferido && splitPreferido !== split), avisoFrecuencia }
}

/* ============================================================
   Lesiones completas mapeadas a anatomía PWA
   ============================================================ */
const LESION_RULES = {
  hombros: { bpExclude: ['shoulders'], tgExclude: ['delts'], keywords: ['overhead', 'military press', 'behind the neck', 'dip', 'upright row', 'arnold press', 'handstand', 'lateral raise'] },
  espalda_alta: { bpExclude: [], tgExclude: ['upper back', 'traps', 'lats'], keywords: ['shrug', 'upright row', 'behind the neck'] },
  espalda_baja: { bpExclude: [], tgExclude: ['spine'], keywords: ['deadlift', 'good morning', 'hyperextension', 'bent over row', 'back squat', 'clean', 'snatch', 'superman', 'sit-up'] },
  pecho: { bpExclude: ['chest'], tgExclude: ['pectorals'], keywords: ['bench press', 'chest fly', 'chest dip', 'push-up', 'push up'] },
  biceps: { tgExclude: ['biceps'], keywords: ['biceps curl', 'barbell curl', 'dumbbell curl', 'chin up', 'preacher'] },
  triceps: { tgExclude: ['triceps'], keywords: ['triceps extension', 'skull crusher', 'french press', 'triceps pushdown', 'dip'] },
  codos: { bpExclude: [], keywords: ['skull crusher', 'triceps extension', 'french press', 'bench press', 'barbell curl', 'dip', 'pushdown'] },
  antebrazos_munecas: { bpExclude: ['lower arms'], tgExclude: ['forearms'], keywords: ['push-up', 'push up', 'plank', 'handstand', 'front squat', 'clean', 'wrist curl', 'barbell curl'] },
  cuello: { bpExclude: ['neck'], keywords: ['shrug', 'behind the neck', 'neck'] },
  abdominales: { bpExclude: ['waist'], tgExclude: ['abs', 'obliques'], keywords: ['crunch', 'sit-up', 'v-up', 'plank', 'russian twist'] },
  gluteos: { tgExclude: ['glutes'], keywords: ['hip thrust', 'glute bridge', 'kickback'] },
  cuadriceps: { tgExclude: ['quads'], keywords: ['squat', 'lunge', 'leg extension', 'sprint', 'jump'] },
  rodillas: { bpExclude: [], keywords: ['squat', 'lunge', 'leg extension', 'jump', 'box jump', 'step up', 'pistol', 'hack squat'] },
  isquiotibiales: { tgExclude: ['hamstrings'], keywords: ['deadlift', 'leg curl', 'good morning', 'nordic'] },
  aductores: { tgExclude: ['adductors'], keywords: ['sumo', 'adductor', 'inner thigh'] },
  gemelos_tobillos: { bpExclude: ['lower legs'], tgExclude: ['calves'], keywords: ['jump', 'box jump', 'calf raise', 'skip', 'ankle'] },
}

const RARE_KEYWORDS = ['male', 'female', 'pyramid', 'wheel', 'bosu', 'single leg cable', 'roller', 'foam', 'stability ball', 'swiss ball', 'towel', 'stick']

function esRaro(n) {
  const nl = (n || '').toLowerCase()
  return RARE_KEYWORDS.some(kw => nl.includes(kw))
}

function esEstiramiento(ex) {
  const n = (ex.n || '').toLowerCase()
  const bp = (ex.bp || '').toLowerCase()
  return bp === 'cardio' || n.includes('stretch') || n.includes('stretching') || n.includes('yoga') || n.includes('mobility') || n.includes('warm-up')
}

function patronDeMovimiento(ex) {
  const n = (ex.n || '').toLowerCase()
  const tg = (ex.tg || '').toLowerCase()

  if (n.includes('pull-up') || n.includes('pull up') || n.includes('chin-up') || n.includes('chin up') || n.includes('lat pulldown') || n.includes('pulldown')) return 'vertical_pull'
  if (n.includes('row') || n.includes('inverted row')) return 'horizontal_pull'
  if (n.includes('overhead press') || n.includes('military press') || n.includes('shoulder press') || n.includes('arnold press') || n.includes('pike push')) return 'vertical_press'
  if (n.includes('bench press') || n.includes('chest press') || n.includes('push-up') || n.includes('push up') || n.includes('dip')) return 'horizontal_press'
  if (n.includes('squat') || n.includes('leg press')) return 'squat_pattern'
  if (n.includes('deadlift') || n.includes('good morning') || n.includes('hip thrust') || n.includes('glute bridge')) return 'hip_hinge'
  if (n.includes('biceps curl') || n.includes('barbell curl') || n.includes('dumbbell curl') || n.includes('hammer curl') || n.includes('preacher')) return 'bicep_curl'
  if (n.includes('triceps extension') || n.includes('skull crusher') || n.includes('pushdown') || n.includes('french press')) return 'tricep_ext'
  if (n.includes('lateral raise')) return 'lateral_raise'
  if (n.includes('calf raise')) return 'calf_raise'
  if (n.includes('crunch') || n.includes('sit-up') || n.includes('leg raise')) return 'abs_flexion'

  return `${tg}_${ex.bp}`
}

function jerarquiaScore(ex) {
  const n = (ex.n || '').toLowerCase()
  const eq = (ex.eq || '').toLowerCase()
  let score = 5
  if (['barbell', 'dumbbell', 'leverage machine', 'cable'].includes(eq)) score += 3
  if (n.includes('squat') || n.includes('bench press') || n.includes('deadlift') || n.includes('overhead press') || n.includes('pull up') || n.includes('row')) score += 5
  return score
}

function filtrarPorEquipamiento(exDB, equipamiento, preferenciaEjercicio) {
  let pool = exDB
  if (equipamiento === 'solo_mancuernas') {
    pool = exDB.filter(e => ['dumbbell', 'body weight'].includes(e.eq))
  } else if (equipamiento === 'calistenia') {
    pool = exDB.filter(e => e.eq === 'body weight')
  }

  // Requerimiento 4: Si prefiere máquinas o pesos libres, EXCLUIR peso corporal
  if (preferenciaEjercicio === 'maquinas_poleas' || preferenciaEjercicio === 'pesos_libres') {
    pool = pool.filter(e => e.eq !== 'body weight')
  }

  return pool
}

export const EQUIPO_POR_PREFERENCIA = {
  maquinas_poleas: ['leverage machine', 'cable', 'smith machine', 'assisted'],
  pesos_libres: ['barbell', 'dumbbell', 'olympic barbell', 'ez barbell', 'kettlebell', 'trap bar'],
  sin_preferencia: null,
}

export function filtrarPorPreferenciaEquipo(pool, preferencia) {
  const permitidos = EQUIPO_POR_PREFERENCIA[preferencia]
  if (!permitidos) return pool
  const filtrado = pool.filter(e => permitidos.includes(e.eq))
  return filtrado.length >= 5 ? filtrado : pool
}

function prepararPoolSeguro(exDB, equipamiento, preferenciaEjercicio, lesiones = [], dictEs = exerciseNamesEs) {
  let pool = filtrarPorEquipamiento(exDB, equipamiento, preferenciaEjercicio)
  pool = filtrarPorPreferenciaEquipo(pool, preferenciaEjercicio)
  if (dictEs && Object.keys(dictEs).length > 0) {
    pool = pool.filter(ex => Boolean(dictEs[ex.id]))
  }

  const bpSet = new Set(), tgSet = new Set(), kwList = []
  if (lesiones && lesiones.length > 0) {
    for (const lesion of lesiones) {
      const rule = LESION_RULES[lesion]
      if (!rule) continue
      if (rule.bpExclude) rule.bpExclude.forEach(bp => bpSet.add(bp))
      if (rule.tgExclude) rule.tgExclude.forEach(tg => tgSet.add(tg))
      if (rule.keywords) rule.keywords.forEach(kw => kwList.push(kw.toLowerCase()))
    }
  }

  pool = pool.filter(ex => {
    if (esEstiramiento(ex)) return false
    if (bpSet.has(ex.bp)) return false
    if (tgSet.has(ex.tg)) return false
    const nLower = (ex.n || '').toLowerCase()
    for (const kw of kwList) {
      if (nLower.includes(kw)) return false
    }
    return true
  })

  const noRaros = pool.filter(ex => !esRaro(ex.n))
  return noRaros.length >= 10 ? noRaros : pool
}

export const SLOTS_POR_TIEMPO = {
  '30-40': { ejercicios: 4, series: 3 },
  '40-60': { ejercicios: 5, series: 3 },
  '60-90': { ejercicios: 6, series: 4 },
  '90+':   { ejercicios: 7, series: 4 },
}

export const SERIES_POR_TIEMPO   = { '30-40': 3, '40-60': 3, '60-90': 4, '90+': 4 }
export const MINUTOS_POR_TIEMPO  = { '30-40': 35, '40-60': 50, '60-90': 75, '90+': 100 }
export const DESCANSO_SEG        = { '60': 60, '90-120': 105, '180+': 180 }
export const CALENTAMIENTO_SEG = 300
export const TRABAJO_SERIE_SEG = 40
export const TRANSICION_SEG    = 60

export function calcularCantidadEjercicios(tiempoPorSesion, descansoSegundos) {
  const series      = SERIES_POR_TIEMPO[tiempoPorSesion] || 3
  const sesionMin   = MINUTOS_POR_TIEMPO[tiempoPorSesion] || 50
  const descanso    = DESCANSO_SEG[descansoSegundos] || 90
  const disponible  = sesionMin * 60 - CALENTAMIENTO_SEG
  const porEjercicio = series * (TRABAJO_SERIE_SEG + descanso) + TRANSICION_SEG
  const maxCap      = tiempoPorSesion === '30-40' ? 4 : tiempoPorSesion === '40-60' ? 6 : tiempoPorSesion === '60-90' ? 7 : 8
  return Math.max(3, Math.min(maxCap, Math.floor(disponible / porEjercicio)))
}

export function diasPiernaTorso(totalDias) {
  const diasPierna = Math.max(1, Math.min(totalDias - 1, Math.round(totalDias * 0.6)))
  return { diasPierna, diasTorso: totalDias - diasPierna }
}

export function buildRoutineNames(split, totalDias) {
  const nombres = []
  if (split === 'fullbody') {
    for (let i = 0; i < totalDias; i++) {
      nombres.push({ rutinaNombre: `Full Body ${i + 1}`, tipo: 'fullbody' })
    }
  } else if (split === 'pierna_prioridad') {
    const { diasPierna, diasTorso } = diasPiernaTorso(totalDias)
    const legSessions = [
      { rutinaNombre: 'Pierna — Cuádriceps', tipo: 'pierna_quads' },
      { rutinaNombre: 'Pierna — Isquios/Glúteo', tipo: 'pierna_isquios_gluteo' },
      { rutinaNombre: 'Pierna — Unilateral', tipo: 'pierna_unilateral' },
    ]
    let pIdx = 0
    let pRestantes = diasPierna
    let tRestantes = diasTorso

    for (let i = 0; i < totalDias; i++) {
      const preferTorso = tRestantes > 0 && (i % 2 === 1 || pRestantes === 0)
      if (preferTorso) {
        nombres.push({ rutinaNombre: 'Torso', tipo: 'torso' })
        tRestantes--
      } else {
        const leg = legSessions[pIdx % legSessions.length]
        nombres.push(leg)
        pIdx++
        pRestantes--
      }
    }
  } else if (split === 'torso_pierna') {
    for (let i = 0; i < totalDias; i++) {
      const vuelta = Math.floor(i / 2)
      const sufijo = String.fromCharCode(65 + vuelta)
      const esTorso = i % 2 === 0
      nombres.push({ rutinaNombre: esTorso ? `Torso ${sufijo}` : `Pierna ${sufijo}`, tipo: esTorso ? 'torso' : 'pierna' })
    }
  } else {
    const ciclo = [{ base: 'Push', tipo: 'push' }, { base: 'Pull', tipo: 'pull' }, { base: 'Legs', tipo: 'legs' }]
    for (let i = 0; i < totalDias; i++) {
      const idx = i % 3
      const vuelta = Math.floor(i / 3)
      const c = ciclo[idx]
      nombres.push({ rutinaNombre: vuelta === 0 ? c.base : `${c.base} ${vuelta + 1}`, tipo: c.tipo })
    }
  }
  return nombres
}

function calcularDistribucionMuscular(tipoDia, nSlots, enfoque) {
  let cuotas = {}
  if (tipoDia === 'pierna_quads') {
    cuotas = { quads: Math.round(nSlots * 0.5), glutes: Math.round(nSlots * 0.2), hamstrings: Math.round(nSlots * 0.15), calves: Math.max(1, Math.round(nSlots * 0.15)) }
  } else if (tipoDia === 'pierna_isquios_gluteo') {
    cuotas = { hamstrings: Math.round(nSlots * 0.4), glutes: Math.round(nSlots * 0.35), quads: Math.round(nSlots * 0.15), calves: Math.max(1, Math.round(nSlots * 0.1)) }
  } else if (tipoDia === 'pierna_unilateral') {
    cuotas = { glutes: Math.round(nSlots * 0.4), quads: Math.round(nSlots * 0.2), hamstrings: Math.round(nSlots * 0.2), abductors: Math.max(1, Math.round(nSlots * 0.1)), adductors: Math.max(1, Math.round(nSlots * 0.1)) }
  } else if (tipoDia === 'push') {
    cuotas = { pectorals: Math.round(nSlots * 0.5), delts: Math.round(nSlots * 0.33), triceps: Math.max(1, Math.round(nSlots * 0.17)) }
  } else if (tipoDia === 'pull') {
    cuotas = { lats: Math.round(nSlots * 0.35), 'upper back': Math.round(nSlots * 0.25), biceps: Math.round(nSlots * 0.25), traps: Math.max(1, Math.round(nSlots * 0.15)) }
  } else if (tipoDia === 'legs') {
    cuotas = { quads: Math.round(nSlots * 0.4), hamstrings: Math.round(nSlots * 0.3), glutes: Math.round(nSlots * 0.15), calves: Math.max(1, Math.round(nSlots * 0.15)) }
  } else if (tipoDia === 'torso') {
    cuotas = { pectorals: Math.round(nSlots * 0.3), lats: Math.round(nSlots * 0.3), delts: Math.round(nSlots * 0.2), biceps: Math.round(nSlots * 0.1), triceps: Math.round(nSlots * 0.1) }
  } else if (tipoDia === 'pierna') {
    cuotas = { quads: Math.round(nSlots * 0.4), hamstrings: Math.round(nSlots * 0.3), glutes: Math.round(nSlots * 0.15), calves: Math.max(1, Math.round(nSlots * 0.15)) }
  } else {
    cuotas = { pectorals: 1, lats: 1, quads: 1, hamstrings: 1, delts: 1, abs: Math.max(0, nSlots - 5) }
  }

  if (enfoque === 'piernas_gluteos' && !['pierna_quads', 'pierna_isquios_gluteo', 'pierna_unilateral'].includes(tipoDia)) {
    if (cuotas.quads) cuotas.quads = Math.ceil(cuotas.quads * 1.3)
    if (cuotas.glutes) cuotas.glutes = Math.ceil(cuotas.glutes * 1.3)
  } else if (enfoque === 'torso_brazos') {
    if (cuotas.pectorals) cuotas.pectorals = Math.ceil(cuotas.pectorals * 1.3)
    if (cuotas.lats) cuotas.lats = Math.ceil(cuotas.lats * 1.3)
    if (cuotas.biceps) cuotas.biceps = Math.ceil(cuotas.biceps * 1.3)
    if (cuotas.triceps) cuotas.triceps = Math.ceil(cuotas.triceps * 1.3)
  }

  const targetGroups = []
  for (const [tg, count] of Object.entries(cuotas)) {
    for (let c = 0; c < count; c++) targetGroups.push(tg)
  }
  return targetGroups.slice(0, nSlots)
}

export const TG_SUSTITUTO = {
  quads: ['hamstrings', 'glutes', 'calves'],
  hamstrings: ['glutes', 'quads', 'calves'],
  glutes: ['hamstrings', 'adductors', 'abductors', 'quads'],
  adductors: ['abductors', 'glutes'],
  abductors: ['adductors', 'glutes'],
  calves: ['quads', 'hamstrings'],
  pectorals: ['delts', 'triceps'],
  lats: ['upper back', 'traps', 'biceps'],
  'upper back': ['lats', 'traps', 'delts'],
  traps: ['upper back', 'delts'],
  delts: ['pectorals', 'upper back', 'traps'],
  biceps: ['forearms', 'lats'],
  triceps: ['pectorals', 'delts'],
  forearms: ['biceps'],
  abs: ['spine'],
  spine: ['abs'],
  'serratus anterior': ['abs', 'upper back'],
  'levator scapulae': ['traps'],
}

export function candidatosConSustitucion(poolSeguro, tg, usadosEsteDia) {
  let candidatos = poolSeguro.filter(e => e.tg === tg && !usadosEsteDia.has(e.id))
  if (candidatos.length > 0) return candidatos

  for (const sustituto of TG_SUSTITUTO[tg] || []) {
    candidatos = poolSeguro.filter(e => e.tg === sustituto && !usadosEsteDia.has(e.id))
    if (candidatos.length > 0) return candidatos
  }

  return poolSeguro.filter(e => !usadosEsteDia.has(e.id))
}

function seleccionarEjerciciosNormales(poolSeguro, targetGroups, nSlots, preferenciaEjercicio, usadosEnSemana) {
  const PREF_EQ = {
    maquinas_poleas: ['leverage machine', 'cable', 'smith machine'],
    pesos_libres:    ['barbell', 'dumbbell', 'olympic barbell', 'kettlebell', 'ez barbell'],
    sin_preferencia: [],
  }[preferenciaEjercicio] || []

  const seleccionados = []
  const usadosEsteDia = new Set()
  const patronesUsadosEsteDia = new Set()

  for (const tg of targetGroups) {
    if (seleccionados.length >= nSlots) break

    const candidatos = candidatosConSustitucion(poolSeguro, tg, usadosEsteDia)

    const sinPatronDuplicado = candidatos.filter(e => !patronesUsadosEsteDia.has(patronDeMovimiento(e)))
    const poolFiltrado = sinPatronDuplicado.length > 0 ? sinPatronDuplicado : candidatos

    const ordenado = [...poolFiltrado].sort((a, b) => {
      const aUsado = usadosEnSemana.has(a.id) ? 1 : 0
      const bUsado = usadosEnSemana.has(b.id) ? 1 : 0
      if (aUsado !== bUsado) return aUsado - bUsado

      const aPref = PREF_EQ.includes(a.eq) ? 1 : 0
      const bPref = PREF_EQ.includes(b.eq) ? 1 : 0
      if (aPref !== bPref) return bPref - aPref

      return jerarquiaScore(b) - jerarquiaScore(a)
    })

    if (ordenado.length === 0) continue

    const elegido = ordenado[0]
    seleccionados.push(elegido)
    usadosEsteDia.add(elegido.id)
    patronesUsadosEsteDia.add(patronDeMovimiento(elegido))
    usadosEnSemana.add(elegido.id)
  }

  return seleccionados
}

/* ============================================================
   Requerimiento 1: Inyección de cardio con nota formateada
   ============================================================ */
function seleccionarCardio(cardioOption, equipamiento) {
  if (!cardioOption || cardioOption === 'sin_cardio') return null
  const isCalistenia = equipamiento === 'calistenia'

  if (cardioOption === 'suave_final') {
    return {
      id: 'cardio_treadmill',
      sets: 1,
      min: 20,
      mode: 'cardio',
      speed: 6.5,
      note: isCalistenia ? '15-20 min • Caminata o trote suave en exterior' : '15-20 min • Velocidad sugerida: 6.0 - 7.5 km/h',
    }
  }

  if (cardioOption === 'hiit') {
    if (isCalistenia) {
      return {
        id: 'cardio_bodyweight_hiit',
        sets: 1,
        min: 15,
        mode: 'cardio',
        speed: 8,
        note: '15 min • Intervalos de peso corporal (30s jumping jacks / burpees / mountain climbers x 30s descanso)',
      }
    }
    return {
      id: 'cardio_stairmaster',
      sets: 1,
      min: 15,
      mode: 'cardio',
      speed: 8,
      note: '15 min • Resistencia moderada (30s trabajo / 30s descanso)',
    }
  }

  if (cardioOption === 'caminar_correr') {
    return {
      id: 'cardio_treadmill',
      sets: 1,
      min: 30,
      mode: 'cardio',
      speed: 8,
      note: isCalistenia ? '30 min • Caminata o trote a ritmo constante' : '30 min • Cinta a ritmo constante y moderado',
    }
  }

  return null
}

/* ============================================================
   Requerimiento 2: Estiramientos estrictamente coherentes
   ============================================================ */
const ESTIRAMIENTOS_POR_GRUPO = {
  pectorals: ['1716', '1405'],
  delts: ['1405', '1716'],
  triceps: ['0018'],
  lats: ['1405'],
  'upper back': ['1405'],
  biceps: ['1405'],
  quads: ['1512', '1713', '1714'],
  hamstrings: ['1708', '1709', '1710', '0016'],
  glutes: ['1709', '1710', '1712'],
  calves: ['1708', '1368'],
  adductors: ['1712'],
}

function seleccionarEstiramientos(movilidadOption, targetGroups, exerciseDB) {
  if (!movilidadOption) return []

  const idsRecomendados = new Set()
  for (const tg of targetGroups) {
    const ids = ESTIRAMIENTOS_POR_GRUPO[tg] || []
    ids.forEach(id => idsRecomendados.add(id))
  }

  let candidatos = exerciseDB.filter(e => idsRecomendados.has(e.id))

  if (candidatos.length < 3) {
    const mapaMusculos = new Set(targetGroups)
    const porMusculo = exerciseDB.filter(e => {
      const n = (e.n || '').toLowerCase()
      const esSt = n.includes('stretch') || n.includes('mobility') || n.includes('yoga')
      if (!esSt) return false
      return mapaMusculos.has(e.tg) || mapaMusculos.has(e.bp)
    })
    candidatos = [...candidatos, ...porMusculo]
  }

  const unicos = []
  const idsUsados = new Set()
  for (const c of candidatos) {
    if (!idsUsados.has(c.id)) {
      unicos.push(c)
      idsUsados.add(c.id)
    }
    if (unicos.length >= 4) break
  }

  return unicos.slice(0, 4).map(e => ({
    id: e.id,
    sets: 1,
    sec: 45,
    mode: 'time',
    weight: 0,
    note: 'Estiramiento recomendado para los músculos de hoy',
  }))
}

export const VALOR_ESFUERZO = {
  rir: '1-2',
  rpe: '8-9',
}

/* ============================================================
   Función principal — generarRutina (v5)
   ============================================================ */
export function generarRutina(respuestas, exerciseDB, dictEs = exerciseNamesEs) {
  const {
    objetivo = 'fitness_general',
    tieneLesion = false,
    lesiones = [],
    diasSeleccionados = [],
    diasPorSemana: rawDias,
    tiempoPorSesion = '40-60',
    descansoSegundos = '90-120',
    nivel = 'intermedio',
    equipamiento = 'gimnasio_completo',
    preferenciaEjercicio = 'sin_preferencia',
    enfoque = 'balance',
    cardio = 'sin_cardio',
    splitPreferido,
    movilidadEstiramientos = false,
    incluirMovilidad = false,
    metricaEsfuerzo,
    tipoProgresion,
  } = respuestas

  let diasIndices = []
  if (Array.isArray(diasSeleccionados) && diasSeleccionados.length > 0) {
    const indices = diasSeleccionados.map(d => DAY_MAP[d.toLowerCase()]).filter(x => x !== undefined)
    diasIndices = WEEK_ORDER.filter(w => indices.includes(w))
  }
  const totalDias = diasIndices.length > 0 ? diasIndices.length : (rawDias || 3)

  const mensajesAjuste = []
  const { split, splitAjustado, avisoFrecuencia } = derivarSplit(nivel, totalDias, splitPreferido, enfoque)
  if (avisoFrecuencia) mensajesAjuste.push(avisoFrecuencia)

  const poolSeguro = prepararPoolSeguro(exerciseDB, equipamiento, preferenciaEjercicio, tieneLesion ? lesiones : [], dictEs)
  const nSlotsNormales = calcularCantidadEjercicios(tiempoPorSesion, descansoSegundos)
  const configTiempo = SLOTS_POR_TIEMPO[tiempoPorSesion] || SLOTS_POR_TIEMPO['40-60']
  const nSeries = configTiempo.series
  const reps = objetivo === 'fuerza' ? '3-6' : objetivo === 'perder_grasa' ? '8-15' : '8-12'

  const routineConfigs = buildRoutineNames(split, totalDias)
  const usadosEnSemana = new Set()
  const dias = []
  const tieneMovilidad = movilidadEstiramientos || incluirMovilidad

  const dbCompleta = exerciseDB.some(e => e.id === 'cardio_treadmill')
    ? exerciseDB
    : [...exerciseDB, ...CUSTOM_CARDIO_EXERCISES]

  for (let i = 0; i < routineConfigs.length; i++) {
    const { rutinaNombre, tipo } = routineConfigs[i]
    const diaSemanaIdx = diasIndices[i] !== undefined ? diasIndices[i] : WEEK_ORDER[i % 7]
    const diaSemanaNombre = DAY_NAMES_ES[diaSemanaIdx]
    const diaLabel = `${diaSemanaNombre} — ${rutinaNombre}`

    // 1. Ejercicios de Fuerza/Hipertrofia
    const targetGroups = calcularDistribucionMuscular(tipo, nSlotsNormales, enfoque)
    const normales = seleccionarEjerciciosNormales(poolSeguro, targetGroups, nSlotsNormales, preferenciaEjercicio, usadosEnSemana)

    const ejerciciosArray = normales.map(ex => ({
      id: ex.id,
      sets: nSeries,
      reps: parseInt(reps.split('-')[0], 10) || 10,
      weight: 0,
      exerciseId: ex.id,
      series: nSeries,
      repeticiones: reps,
      isNormal: true,
      metrica: metricaEsfuerzo,
      valorEsfuerzo: VALOR_ESFUERZO[metricaEsfuerzo] || null,
      progresion: tipoProgresion,
    }))

    // 2. Cardio (si aplica)
    const ejCardio = seleccionarCardio(cardio, equipamiento)
    if (ejCardio) {
      ejerciciosArray.push({ ...ejCardio, isCardio: true })
    }

    // 3. Estiramientos (coincidentes con los músculos trabajados)
    const ejEstiramientos = seleccionarEstiramientos(tieneMovilidad, targetGroups, dbCompleta)
    if (ejEstiramientos.length > 0) {
      ejEstiramientos.forEach(st => ejerciciosArray.push({ ...st, isStretch: true }))
    }

    const dia = {
      diaLabel,
      rutinaNombre,
      diaSemana: diaSemanaIdx,
      ejercicios: ejerciciosArray,
      ex: ejerciciosArray,
    }

    dias.push(dia)
  }

  const resultado = {
    splitAsignado: split,
    splitAjustado,
    poolSeguro,
    usadosEnSemana,
    parametrosGlobales: {
      descansoRecomendado: descansoSegundos === '60' ? '60 segundos entre series' : descansoSegundos === '180+' ? '180+ segundos (fuerza)' : '90-120 segundos entre series',
      tipoProgresion: tipoProgresion === 'lineal' ? 'Progresión lineal' : tipoProgresion === 'ondulante' ? 'Progresión ondulante (DUP)' : 'Doble progresión: aumenta reps, luego peso',
      metricaEsfuerzo: metricaEsfuerzo === 'rpe' ? 'RPE 8-9' : 'RIR 1-2 (dejar 1 a 2 reps en recámara)',
    },
    dias,
  }

  if (mensajesAjuste.length > 0) {
    resultado.mensajeAjuste = mensajesAjuste.join(' · ')
    resultado.avisoFrecuencia = mensajesAjuste[0]
  }

  if (tieneLesion && lesiones.length > 0) {
    resultado.disclaimer = 'Rutina adaptada a tus condiciones físicas. Si sentís dolor agudo durante cualquier ejercicio, detené la actividad y consultá a un profesional de salud antes de continuar.'
  }

  return resultado
}

export function rutinaGeneradaToRoutines(rutinaGenerada, respuestas = {}) {
  const routines = rutinaGenerada.dias.map((dia, i) => {
    const ejercicios = (dia.ejercicios || dia.ex || []).map(ej => ({
      id: ej.id || ej.exerciseId,
      sets: ej.sets || ej.series || 3,
      reps: ej.reps || (ej.repeticiones ? parseInt(ej.repeticiones.split('-')[0], 10) : 10),
      weight: ej.weight || 0,
      mode: ej.mode,
      min: ej.min,
      sec: ej.sec,
      note: ej.note,
      isNormal: ej.isNormal,
      isCardio: ej.isCardio,
      isStretch: ej.isStretch,
    }))

    return {
      id: 'gen_' + Date.now() + '_' + i,
      name: dia.rutinaNombre,
      emoji: dia.rutinaNombre.includes('Legs') || dia.rutinaNombre.includes('Pierna') ? 'legs' : dia.rutinaNombre.includes('Pull') ? 'pullup' : 'dumbbell',
      ex: ejercicios,
    }
  })

  const week = {}
  for (let i = 0; i < rutinaGenerada.dias.length; i++) {
    const diaSemana = rutinaGenerada.dias[i].diaSemana
    if (diaSemana !== undefined && routines[i]) {
      week[diaSemana] = routines[i].id
    }
  }

  return { routines, week }
}

export function obtenerAlternativas(ejercicioActual, poolSeguro = [], idsUsadosEnLaSemana = new Set(), n = 3) {
  const actualDB = poolSeguro.find(e => e.id === (ejercicioActual.id || ejercicioActual.exerciseId)) || ejercicioActual
  const targetTg = actualDB.tg
  const actualId = actualDB.id || ejercicioActual.id || ejercicioActual.exerciseId

  const idsSet = idsUsadosEnLaSemana instanceof Set ? idsUsadosEnLaSemana : new Set(idsUsadosEnLaSemana || [])

  let candidatos = poolSeguro.filter(e =>
    e.tg === targetTg &&
    e.id !== actualId &&
    !idsSet.has(e.id)
  )

  const elegidos = []
  const patronesVistos = new Set()
  for (const c of [...candidatos].sort((a, b) => jerarquiaScore(b) - jerarquiaScore(a))) {
    const patron = patronDeMovimiento(c)
    if (patronesVistos.has(patron)) continue
    patronesVistos.add(patron)
    elegidos.push(c)
    if (elegidos.length === n) break
  }

  if (elegidos.length < n) {
    for (const c of candidatos) {
      if (elegidos.length === n) break
      if (!elegidos.includes(c)) elegidos.push(c)
    }
  }

  return elegidos
}