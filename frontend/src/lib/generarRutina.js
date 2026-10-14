/**
 * Motor de generación de rutinas personalizadas — lauyim (v6)
 *
 * Cada sesión es una plantilla de slots por patrón de movimiento (rutina-catalogo.js) y cada
 * patrón elige de una lista curada, según nivel, equipamiento, preferencia y lesiones. El
 * catálogo completo solo se usa como respaldo y para las alternativas de "Reemplazar".
 *
 *  - Mismos básicos en las sesiones del mismo tipo (Push 1 y Push 2 son iguales; Full Body
 *    alterna A/B) para poder progresar en carga.
 *  - Compuestos primero, aislamiento después; calentamiento en los primeros compuestos.
 *  - Reps y series según objetivo y nivel; el rango se guarda como lo lee la progresión.
 *  - Estiramientos derivados de lo que se entrenó ese día, sin compañero ni elementos.
 *  - Cardio que respeta lesiones, días de pierna y un máximo de 2 HIIT por semana.
 *  - Un resumen explicado (series por músculo, duración, avisos) para mostrar antes de guardar.
 */

import exerciseNamesEs from '../locales/exercise-names-es.js'
import { CUSTOM_CARDIO_EXERCISES, SYSTEM_EXERCISES, matchExercise } from './exercises.js'
import { musclesOf } from './muscles.js'
import {
  PATRONES, PATRON_DE_ID, PLANTILLAS, EXTRA_ENFOQUE, ESTIRAMIENTOS, ESTIRAMIENTO_IDS, LESIONES, CARDIO, CARDIO_OPCIONES,
  nivelIndex, enListaNegra,
} from './rutina-catalogo.js'

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
   §1 — Split
   ============================================================ */
export function defaultSplitRecomendado(nivel, dias) {
  if (dias <= 3) return 'fullbody'
  if (nivel === 'principiante' || dias === 4) return 'torso_pierna'
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

  // Respuestas guardadas antes de v6: "Piernas y glúteos" era un enfoque. Hoy es un split.
  if (enfoque === 'piernas_gluteos') {
    return { split: 'pierna_prioridad', splitAjustado: Boolean(splitPreferido && splitPreferido !== 'pierna_prioridad') }
  }

  const split = splitPreferido || defaultSplitRecomendado(nivel, dias)
  let avisoFrecuencia

  if (split === 'ppl' && dias === 2) {
    avisoFrecuencia = 'Con 2 días, Push/Pull/Legs deja las piernas sin entrenar. Te recomendamos Full Body.'
  } else if (split === 'ppl' && dias === 3) {
    avisoFrecuencia = 'Con 3 días, cada grupo muscular se entrena 1 vez por semana. Si buscás más frecuencia por músculo, te recomendamos Full Body.'
  } else if (split === 'ppl' && dias === 4) {
    avisoFrecuencia = 'Con 4 días armamos Push, Pull, Legs y un Full Body, así las piernas se entrenan 2 veces por semana.'
  } else if (split === 'ppl' && dias === 5) {
    avisoFrecuencia = 'Con 5 días combinamos Push/Pull/Legs con Torso y Pierna, así cada grupo se entrena 2 veces por semana.'
  } else if (split === 'torso_pierna' && dias === 2) {
    avisoFrecuencia = 'Con 2 días, Torso/Pierna entrena cada músculo 1 vez por semana. Full Body le da 2 estímulos por semana a cada músculo.'
  } else if (split === 'torso_pierna' && dias === 3) {
    avisoFrecuencia = 'Con 3 días, una mitad del cuerpo se entrena 2 veces y la otra 1. Full Body reparte mejor.'
  }

  return { split, splitAjustado: Boolean(splitPreferido && splitPreferido !== split), avisoFrecuencia }
}

export function diasPiernaTorso(totalDias) {
  const diasPierna = Math.max(1, Math.min(totalDias - 1, Math.round(totalDias * 0.6)))
  return { diasPierna, diasTorso: totalDias - diasPierna }
}

/**
 * Nombre y plantilla de cada día. `tipo` es la clave de PLANTILLAS.
 */
export function buildRoutineNames(split, totalDias) {
  const nombres = []
  if (split === 'fullbody') {
    for (let i = 0; i < totalDias; i++) {
      nombres.push({ rutinaNombre: `Full Body ${i + 1}`, tipo: i % 2 === 0 ? 'fullbody_a' : 'fullbody_b' })
    }
  } else if (split === 'pierna_prioridad') {
    const { diasPierna, diasTorso } = diasPiernaTorso(totalDias)
    const legSessions = [
      { rutinaNombre: 'Pierna — Cuádriceps', tipo: 'pierna_quads' },
      { rutinaNombre: 'Pierna — Isquios y glúteo', tipo: 'pierna_isquios_gluteo' },
      { rutinaNombre: 'Pierna — Glúteo', tipo: 'pierna_gluteo' },
    ]
    let pIdx = 0, tIdx = 0
    let pRestantes = diasPierna
    let tRestantes = diasTorso
    for (let i = 0; i < totalDias; i++) {
      const preferTorso = tRestantes > 0 && (i % 2 === 1 || pRestantes === 0)
      if (preferTorso) {
        const letra = diasTorso > 1 ? ' ' + String.fromCharCode(65 + tIdx) : ''
        nombres.push({ rutinaNombre: 'Torso' + letra, tipo: tIdx % 2 === 0 ? 'torso_a' : 'torso_b' })
        tIdx++
        tRestantes--
      } else {
        nombres.push(legSessions[pIdx % legSessions.length])
        pIdx++
        pRestantes--
      }
    }
  } else if (split === 'torso_pierna') {
    for (let i = 0; i < totalDias; i++) {
      const vuelta = Math.floor(i / 2)
      const sufijo = String.fromCharCode(65 + vuelta)
      const esTorso = i % 2 === 0
      const ab = vuelta % 2 === 0 ? 'a' : 'b'
      nombres.push({ rutinaNombre: esTorso ? `Torso ${sufijo}` : `Pierna ${sufijo}`, tipo: (esTorso ? 'torso_' : 'pierna_') + ab })
    }
  } else {
    const ciclo = [{ base: 'Push', tipo: 'push' }, { base: 'Pull', tipo: 'pull' }, { base: 'Legs', tipo: 'legs' }]
    if (totalDias === 4) {
      return [...ciclo.map(c => ({ rutinaNombre: c.base, tipo: c.tipo })), { rutinaNombre: 'Full Body', tipo: 'fullbody_a' }]
    }
    if (totalDias === 5) {
      return [...ciclo.map(c => ({ rutinaNombre: c.base, tipo: c.tipo })), { rutinaNombre: 'Torso', tipo: 'torso_a' }, { rutinaNombre: 'Pierna', tipo: 'pierna_b' }]
    }
    for (let i = 0; i < totalDias; i++) {
      const c = ciclo[i % 3]
      const vuelta = Math.floor(i / 3)
      nombres.push({ rutinaNombre: vuelta === 0 ? c.base : `${c.base} ${vuelta + 1}`, tipo: c.tipo })
    }
  }
  return nombres
}

const DIAS_PIERNA = new Set(['pierna_a', 'pierna_b', 'legs', 'pierna_quads', 'pierna_isquios_gluteo', 'pierna_gluteo'])

/* ============================================================
   §2 — Tiempo, series y reps
   ============================================================ */
export const MINUTOS_POR_TIEMPO = { '30-40': 35, '40-60': 50, '60-90': 75, '90+': 100 }
export const DESCANSO_SEG = { '60': 60, '90-120': 105, '180+': 180 }
export const DESCANSO_AISLAMIENTO_MAX = 75
export const CALENTAMIENTO_SEG = 300
export const TRABAJO_SERIE_SEG = 40
export const TRANSICION_SEG = 60
const TOPE_POR_TIEMPO = { '30-40': 5, '40-60': 6, '60-90': 7, '90+': 8 }

/**
 * Ejercicios de fuerza por sesión. Es la única fuente: la encuesta muestra este mismo número.
 * Los compuestos descansan lo elegido y el aislamiento como mucho 75 s.
 */
// Minutos que el cardio y los estiramientos le sacan a la fuerza dentro de la sesión.
export const CARDIO_MIN = { suave_final: 20, caminar_correr: 30, hiit: 15 }
export const ESTIRAMIENTOS_MIN = 4

export function calcularCantidadEjercicios(tiempoPorSesion, descansoSegundos, nivel, objetivo, extrasMin = 0) {
  const sesionMin = Math.max(0, (MINUTOS_POR_TIEMPO[tiempoPorSesion] || 50) - (Number(extrasMin) || 0))
  const descanso = DESCANSO_SEG[descansoSegundos] || 105
  const descansoMedio = (descanso + Math.min(descanso, DESCANSO_AISLAMIENTO_MAX)) / 2
  const [comp, aisl] = (SERIES[objetivo] || SERIES.fitness_general)[nivel] || [3, 3]
  const porEjercicio = ((comp + aisl) / 2) * (TRABAJO_SERIE_SEG + descansoMedio) + TRANSICION_SEG
  const tope = Math.min(TOPE_POR_TIEMPO[tiempoPorSesion] || 6, nivel === 'principiante' ? 6 : 8)
  return Math.max(3, Math.min(tope, Math.floor((sesionMin * 60 - CALENTAMIENTO_SEG) / porEjercicio)))
}

// [mínimo, máximo, fijo] de reps por objetivo y tipo de ejercicio.
export const ESQUEMAS_REPS = {
  hipertrofia: { compuesto: [6, 10, 8], aislamiento: [10, 15, 12] },
  fuerza: { compuesto: [3, 6, 5], aislamiento: [8, 12, 10] },
  perder_grasa: { compuesto: [8, 12, 10], aislamiento: [12, 15, 12] },
  fitness_general: { compuesto: [8, 12, 10], aislamiento: [10, 15, 12] },
}

// [series en compuestos, series en aislamiento]
const SERIES = {
  hipertrofia: { principiante: [3, 2], intermedio: [3, 3], avanzado: [4, 3] },
  fuerza: { principiante: [3, 2], intermedio: [4, 3], avanzado: [5, 3] },
  perder_grasa: { principiante: [3, 2], intermedio: [3, 2], avanzado: [3, 3] },
  fitness_general: { principiante: [3, 2], intermedio: [3, 2], avanzado: [3, 3] },
}

// Series semanales orientativas por músculo grande, según nivel.
export const VOLUMEN_OBJETIVO = { principiante: [6, 10], intermedio: [10, 16], avanzado: [12, 20] }

export const VALOR_ESFUERZO = {
  rir: '1-2',
  rpe: '8-9',
}

// Valores viejos de la encuesta → política de progression.js.
export function politicaProgresion(tipo) {
  const map = { lineal: 'linear', doble_progresion: 'double', ondulante: 'dup' }
  const p = map[tipo] || tipo
  return ['off', 'linear', 'greyskull', 'double', 'dup'].includes(p) ? p : 'linear'
}

const NOMBRE_PROGRESION = {
  linear: ['Progresión lineal', 'Cuando completás todas las series, la próxima vez sube un poco el peso.'],
  greyskull: ['Greyskull', 'Dos series fijas y la última al máximo de reps: si superás el objetivo, sube el peso.'],
  double: ['Doble progresión', 'Primero subís reps dentro del rango; cuando llegás arriba en todas las series, sube el peso y volvés abajo.'],
  dup: ['Ondulante (DUP)', 'Cada día cambia la intensidad: pesado, moderado y liviano.'],
  off: ['Sin progresión automática', 'Vos decidís cuándo subir el peso.'],
}

/* ============================================================
   §3 — Equipamiento, preferencia y catálogo seguro
   ============================================================ */
const EQUIPO_PERMITIDO = {
  solo_mancuernas: ['dumbbell', 'body weight'],
  calistenia: ['body weight'],
}
const EQ_MAQUINAS = ['leverage machine', 'cable', 'smith machine', 'sled machine']
const EQ_LIBRES = ['barbell', 'dumbbell', 'olympic barbell', 'ez barbell', 'kettlebell', 'trap bar']

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

const equipoPermitido = (ex, equipamiento) => {
  const permitidos = EQUIPO_PERMITIDO[equipamiento]
  return !permitidos || permitidos.includes(ex.eq)
}

const RARE_KEYWORDS = ['male', 'female', 'pyramid', 'wheel', 'bosu', 'single leg cable', 'roller', 'foam', 'stability ball', 'swiss ball', 'towel', 'stick']
const esRaro = n => {
  const nl = (n || '').toLowerCase()
  return RARE_KEYWORDS.some(kw => nl.includes(kw))
}

function esEstiramiento(ex) {
  const n = (ex.n || '').toLowerCase()
  return ESTIRAMIENTO_IDS.has(ex.id) || n.includes('stretch') || n.includes('yoga') || n.includes('mobility') || n.includes('warm-up')
}
const esCardio = ex => (ex.bp || '').toLowerCase() === 'cardio' || ex.tg === 'cardiovascular system'

/* ============================================================
   §4 — Lesiones
   ============================================================ */
// Reglas genéricas por grupo/zona del dataset. Se usan para lo que NO está en el catálogo curado
// (respaldo del generador, alternativas y advertencias del panel admin sobre cualquier ejercicio).
const LESION_RULES = {
  hombros: { bpExclude: ['shoulders'], tgExclude: ['delts'], keywords: ['overhead', 'military press', 'behind the neck', 'dip', 'upright row', 'arnold press', 'handstand', 'lateral raise'] },
  espalda_alta: { bpExclude: [], tgExclude: ['traps'], keywords: ['shrug', 'upright row', 'behind the neck', 'pull-up', 'chin-up'] },
  espalda_baja: { bpExclude: [], tgExclude: ['spine'], keywords: ['deadlift', 'good morning', 'hyperextension', 'bent over row', 'back squat', 'clean', 'snatch', 'superman', 'sit-up'] },
  pecho: { bpExclude: ['chest'], tgExclude: ['pectorals'], keywords: ['bench press', 'chest fly', 'chest dip', 'push-up', 'push up'] },
  biceps: { tgExclude: ['biceps'], keywords: ['biceps curl', 'barbell curl', 'dumbbell curl', 'chin up', 'chin-up', 'preacher'] },
  triceps: { tgExclude: ['triceps'], keywords: ['triceps extension', 'skull crusher', 'french press', 'triceps pushdown', 'dip'] },
  codos: { bpExclude: [], keywords: ['skull crusher', 'triceps extension', 'french press', 'bench press', 'barbell curl', 'dip', 'pushdown'] },
  antebrazos_munecas: { bpExclude: ['lower arms'], tgExclude: ['forearms'], keywords: ['push-up', 'push up', 'plank', 'handstand', 'front squat', 'clean', 'wrist curl', 'barbell curl'] },
  cuello: { bpExclude: ['neck'], keywords: ['shrug', 'behind the neck', 'neck'] },
  abdominales: { bpExclude: ['waist'], tgExclude: ['abs', 'obliques'], keywords: ['crunch', 'sit-up', 'v-up', 'plank', 'russian twist'] },
  gluteos: { tgExclude: ['glutes'], keywords: ['hip thrust', 'glute bridge', 'kickback'] },
  cuadriceps: { tgExclude: ['quads'], keywords: ['squat', 'lunge', 'leg extension', 'sprint', 'jump'] },
  rodillas: { bpExclude: [], keywords: ['squat', 'lunge', 'leg extension', 'jump', 'box jump', 'step up', 'step-up', 'pistol', 'hack squat'] },
  isquiotibiales: { tgExclude: ['hamstrings'], keywords: ['deadlift', 'leg curl', 'good morning', 'nordic'] },
  aductores: { tgExclude: ['adductors'], keywords: ['sumo', 'adductor', 'inner thigh'] },
  gemelos_tobillos: { bpExclude: ['lower legs'], tgExclude: ['calves'], keywords: ['jump', 'box jump', 'calf raise', 'skip', 'ankle'] },
}

/**
 * ¿Este ejercicio no se le da a alguien con estas lesiones? `patron` es el slot en el que se
 * usaría (o el patrón curado del ejercicio). Los curados siguen las reglas finas de
 * rutina-catalogo.js (patrón, equipo, palabras clave); el resto, además, las genéricas.
 */
export function bloqueadoPorLesiones(ex, lesiones = [], patron = PATRON_DE_ID[ex?.id]) {
  if (!ex || !lesiones || !lesiones.length) return false
  const nombre = ` ${String(ex.n || '').toLowerCase()} `
  const curado = Boolean(PATRON_DE_ID[ex.id])
  for (const lesion of lesiones) {
    const fina = LESIONES[lesion]
    if (fina) {
      if (patron && fina.patrones?.includes(patron)) return true
      if (patron && fina.equipo?.[patron]?.includes(ex.eq)) return true
      if ((fina.keywords || []).some(kw => nombre.includes(kw))) return true
    }
    if (!curado) {
      const rule = LESION_RULES[lesion]
      if (!rule) continue
      if (rule.bpExclude?.includes(ex.bp)) return true
      if (rule.tgExclude?.includes(ex.tg)) return true
      if ((rule.keywords || []).some(kw => nombre.includes(kw))) return true
    }
  }
  return false
}

// Panel admin (Fase 7): ¿avisar al asignar este ejercicio a un socio con esta lesión?
export function ejercicioAfectaLesion(ex, lesion) {
  if (!ex || !LESION_RULES[lesion]) return false
  return bloqueadoPorLesiones(ex, [lesion])
}

// Lesiones (de las que tiene el socio) que este ejercicio afecta, según la regla de arriba.
export function lesionesAfectadasPorEjercicio(ex, lesiones = []) {
  return (lesiones || []).filter(lesion => ejercicioAfectaLesion(ex, lesion))
}

/* ============================================================
   §5 — Pool seguro (respaldo y alternativas)
   ============================================================ */
function patronDeMovimiento(ex) {
  if (PATRON_DE_ID[ex.id]) return PATRON_DE_ID[ex.id]
  const n = (ex.n || '').toLowerCase()
  const tg = (ex.tg || '').toLowerCase()
  if (n.includes('pull-up') || n.includes('pull up') || n.includes('chin-up') || n.includes('chin up') || n.includes('pulldown')) return 'jalon'
  if (n.includes('row')) return 'remo'
  if (n.includes('overhead press') || n.includes('military press') || n.includes('shoulder press') || n.includes('arnold press') || n.includes('pike push')) return 'press_vertical'
  if (n.includes('incline') && (n.includes('press') || n.includes('push'))) return 'press_inclinado'
  if (n.includes('bench press') || n.includes('chest press') || n.includes('push-up') || n.includes('push up') || n.includes('dip')) return 'press_horizontal'
  if (n.includes('leg press')) return 'prensa'
  if (n.includes('squat')) return 'sentadilla'
  if (n.includes('lunge') || n.includes('step-up') || n.includes('step up')) return 'zancada'
  if (n.includes('deadlift') || n.includes('good morning')) return 'bisagra'
  if (n.includes('hip thrust') || n.includes('glute bridge')) return 'hip_thrust'
  if (n.includes('leg curl')) return 'curl_femoral'
  if (n.includes('leg extension')) return 'extension_cuadriceps'
  if (n.includes('hammer curl')) return 'martillo'
  if (n.includes('curl')) return 'biceps'
  if (n.includes('triceps extension') || n.includes('skull crusher') || n.includes('french press')) return 'triceps_overhead'
  if (n.includes('pushdown')) return 'triceps'
  if (n.includes('lateral raise')) return 'elevaciones_laterales'
  if (n.includes('reverse fly') || n.includes('rear delt') || n.includes('face pull')) return 'deltoide_posterior'
  if (n.includes('fly') || n.includes('crossover')) return 'aperturas'
  if (n.includes('calf raise')) return 'gemelos'
  if (n.includes('crunch') || n.includes('sit-up') || n.includes('leg raise') || n.includes('plank')) return 'core'
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

function prepararPoolSeguro(exDB, equipamiento, preferenciaEjercicio, lesiones = [], dictEs = exerciseNamesEs) {
  const conDict = dictEs && Object.keys(dictEs).length > 0
  // Con preferencia por máquinas o pesos libres, el respaldo no recae en peso corporal (salvo
  // en calistenia, donde es todo lo que hay). Los curados lo resuelven con su propio orden.
  const sinPesoCorporal = equipamiento !== 'calistenia' && (preferenciaEjercicio === 'maquinas_poleas' || preferenciaEjercicio === 'pesos_libres')
  const pool = exDB.filter(ex => {
    if (!ex || esEstiramiento(ex) || esCardio(ex)) return false
    if (!equipoPermitido(ex, equipamiento)) return false
    if (sinPesoCorporal && ex.eq === 'body weight' && !PATRON_DE_ID[ex.id]) return false
    if (conDict && !dictEs[ex.id]) return false
    if (enListaNegra(ex)) return false
    if (bloqueadoPorLesiones(ex, lesiones)) return false
    return true
  })
  const noRaros = pool.filter(ex => PATRON_DE_ID[ex.id] || !esRaro(ex.n))
  return noRaros.length >= 10 ? noRaros : pool
}

function prepararPoolCardio(dbCompleta, equipamiento, lesiones) {
  const bajoImpacto = lesiones.some(l => LESIONES[l]?.bajoImpacto)
  const casa = equipamiento === 'calistenia' || equipamiento === 'solo_mancuernas'
  const idx = new Map(dbCompleta.map(e => [e.id, e]))
  return CARDIO_OPCIONES
    .filter(o => (!casa || o.casa) && !(bajoImpacto && o.impacto))
    .map(o => idx.get(o.id))
    .filter(Boolean)
}

function prepararPoolEstiramientos(dbCompleta, lesiones) {
  const bloqueados = new Set(Object.values(ESTIRAMIENTOS).flat().filter(e => (e.noCon || []).some(l => lesiones.includes(l))).map(e => e.id))
  return dbCompleta.filter(ex => {
    if (bloqueados.has(ex.id)) return false
    if (ESTIRAMIENTO_IDS.has(ex.id)) return true
    const n = String(ex.n || '').toLowerCase()
    return n.includes('stretch') && ex.eq === 'body weight' && !enListaNegra(ex) && !n.includes('assisted')
  })
}

/* ============================================================
   §6 — Selección por patrón
   ============================================================ */
// Nivel mínimo de cada curado (el más bajo si aparece en varios patrones).
const NIVEL_DE_ID = {}
for (const def of Object.values(PATRONES)) {
  for (const [id, nivel] of def.candidatos) {
    if (NIVEL_DE_ID[id] == null || nivelIndex(nivel) < nivelIndex(NIVEL_DE_ID[id])) NIVEL_DE_ID[id] = nivel
  }
}
const nivelPermite = (id, nivel) => !NIVEL_DE_ID[id] || nivelIndex(NIVEL_DE_ID[id]) <= nivelIndex(nivel)

function ordenCandidatos(def, ctx) {
  const base = def.candidatos.map(([id]) => id)
  const preferido = ctx.objetivo === 'fuerza' && ctx.nivel !== 'principiante' && def.fuerza
    ? def.fuerza
    : ctx.nivel === 'principiante' && def.principiante ? def.principiante : base
  const ids = [...new Set([...preferido, ...base])]
  const nivelMin = Object.fromEntries(def.candidatos)
  return ids.filter(id => nivelIndex(nivelMin[id] || 'principiante') <= nivelIndex(ctx.nivel))
}

// Orden estable según la preferencia de la encuesta: lo preferido primero y el peso corporal al
// final (si hay otra cosa) cuando se eligió máquinas o pesos libres.
function rankPreferencia(ex, preferencia) {
  if (preferencia === 'maquinas_poleas') return EQ_MAQUINAS.includes(ex.eq) ? 0 : ex.eq === 'body weight' ? 2 : 1
  if (preferencia === 'pesos_libres') return EQ_LIBRES.includes(ex.eq) ? 0 : ex.eq === 'body weight' ? 2 : 1
  return 0
}

function candidatosCurados(patron, ctx, usadosDia) {
  const def = PATRONES[patron]
  if (!def) return []
  const preferir = ctx.lesiones.flatMap(l => LESIONES[l]?.preferir?.[patron] || [])
  const ids = ordenCandidatos(def, ctx)
  const lista = ids
    .map(id => ctx.idx[id])
    .filter(ex => ex && !usadosDia.has(ex.id))
    .filter(ex => equipoPermitido(ex, ctx.equipamiento))
    .filter(ex => !ctx.conDict || ctx.dictEs[ex.id])
    .filter(ex => !bloqueadoPorLesiones(ex, ctx.lesiones, patron))
  const rank = ex => (preferir.includes(ex.id) ? -1 : 0) * 10 + rankPreferencia(ex, ctx.preferencia)
  return lista
    .map((ex, i) => ({ ex, i }))
    .sort((a, b) => rank(a.ex) - rank(b.ex) || a.i - b.i)
    .map(x => x.ex)
}

function candidatosRespaldo(patron, ctx, usadosDia, patronesDia) {
  const def = PATRONES[patron]
  if (!def) return []
  const prefEq = ctx.preferencia === 'maquinas_poleas' ? EQ_MAQUINAS : ctx.preferencia === 'pesos_libres' ? EQ_LIBRES : []
  const lista = ctx.poolSeguro.filter(ex => def.tgs.includes(ex.tg) && !usadosDia.has(ex.id) && nivelPermite(ex.id, ctx.nivel) && !bloqueadoPorLesiones(ex, ctx.lesiones, patron))
  const sinRepetirPatron = lista.filter(ex => !patronesDia.has(patronDeMovimiento(ex)))
  return [...(sinRepetirPatron.length ? sinRepetirPatron : lista)].sort((a, b) => {
    const aUsado = ctx.usadosEnSemana.has(a.id) ? 1 : 0
    const bUsado = ctx.usadosEnSemana.has(b.id) ? 1 : 0
    if (aUsado !== bUsado) return aUsado - bUsado
    const aPref = prefEq.includes(a.eq) ? 1 : 0
    const bPref = prefEq.includes(b.eq) ? 1 : 0
    if (aPref !== bPref) return bPref - aPref
    return jerarquiaScore(b) - jerarquiaScore(a)
  })
}

/**
 * Ejercicio para un slot. Orden: curados del patrón → curados de sus sustitutos → respaldo del
 * catálogo por grupo muscular. Las sesiones del mismo tipo reusan la elección (`ctx.memo`).
 */
function elegirParaSlot(slot, ctx, usadosDia, patronesDia, tipoDia, patronesPlantilla) {
  const clave = `${tipoDia}|${slot.patron}|${slot.variante}`
  const memo = ctx.memo.get(clave)
  if (memo && !usadosDia.has(memo.ex.id)) return memo

  // Un sustituto que ya tiene su propio slot en el día no se usa: sería repetir el patrón
  // (dos prensas en un día de pierna para alguien con rodillas lesionadas).
  const sustitutos = (PATRONES[slot.patron]?.sustitutos || []).filter(p => !patronesPlantilla.has(p))
  const patrones = [slot.patron, ...sustitutos]
  for (const [i, patron] of patrones.entries()) {
    const lista = candidatosCurados(patron, ctx, usadosDia)
    if (lista.length) {
      // La variante B toma el 2º disponible, salvo que sea el único.
      const ex = lista[Math.min(i === 0 ? slot.variante : 0, lista.length - 1)]
      const r = { ex, patron }
      ctx.memo.set(clave, r)
      return r
    }
  }
  const respaldo = candidatosRespaldo(slot.patron, ctx, usadosDia, patronesDia)
  if (respaldo.length) {
    const r = { ex: respaldo[0], patron: slot.patron }
    ctx.memo.set(clave, r)
    return r
  }
  return null
}

function slotsDelDia(tipoDia, enfoque) {
  const slots = (PLANTILLAS[tipoDia] || PLANTILLAS.fullbody_a).map(([patron, rango, variante = 0], orden) => ({ patron, rango, variante, orden }))
  const extra = EXTRA_ENFOQUE[enfoque]
  let extraAplicado = false
  if (extra && extra.dias.includes(tipoDia)) {
    const patron = extra.slots[tipoDia] || extra.slots.default
    // Entra apenas después de los básicos del día, para que no lo saque el tiempo disponible.
    slots.push({ patron, rango: 3.5, variante: slots.some(s => s.patron === patron) ? 1 : 0, orden: slots.length, extra: true })
    extraAplicado = true
  }
  return { slots, extraAplicado }
}

/* ============================================================
   §7 — Cardio y estiramientos
   ============================================================ */
const BAJO_IMPACTO = 'Por tu lesión, el cardio es sin impacto: bici, elíptico o caminata, sin trote ni saltos.'

function cardioDelDia({ opcion, equipamiento, lesiones, tipoDia, hiitUsados, idx }) {
  if (!opcion || opcion === 'sin_cardio') return null
  const casa = equipamiento === 'calistenia' || equipamiento === 'solo_mancuernas'
  const bajoImpacto = lesiones.some(l => LESIONES[l]?.bajoImpacto)
  const sinHiit = lesiones.some(l => LESIONES[l]?.sinHiit)
  const esPierna = DIAS_PIERNA.has(tipoDia)
  const disponible = id => (idx[id] ? id : null)

  const suave = (motivo) => {
    const id = casa ? 'cardio_walk' : (disponible(CARDIO.suave.gym) || 'cardio_treadmill')
    return { id, min: CARDIO.suave.min, note: CARDIO.suave.nota, ajuste: motivo || null }
  }

  if (opcion === 'suave_final') return suave()

  if (opcion === 'hiit') {
    if (esPierna) return suave('Los días de pierna el HIIT pasa a cardio suave: las piernas ya trabajaron mucho.')
    if (sinHiit) return suave('Por tu lesión, el cardio es suave en vez de HIIT.')
    if (hiitUsados.n >= 2) return null
    hiitUsados.n++
    if (casa) {
      if (bajoImpacto) return { id: 'cardio_walk', min: 20, note: 'Por tu lesión, caminata a buen ritmo en vez de HIIT con saltos.', ajuste: BAJO_IMPACTO }
      return { id: 'cardio_bodyweight_hiit', min: CARDIO.hiit.min, note: '15 min: 30 s de jumping jacks, burpees o escaladores y 30 s de pausa.' }
    }
    return { id: disponible(CARDIO.hiit.gym) || 'cardio_treadmill', min: CARDIO.hiit.min, note: CARDIO.hiit.nota }
  }

  if (opcion === 'caminar_correr') {
    if (bajoImpacto) {
      if (casa) return { id: 'cardio_walk', min: 30, note: 'Caminata a ritmo constante, sin trote (por tu lesión).', ajuste: BAJO_IMPACTO }
      const id = disponible(CARDIO.bajoImpacto.alt) || disponible(CARDIO.bajoImpacto.gym) || 'cardio_bike'
      return { id, min: 30, note: `${CARDIO.bajoImpacto.nota} 30 min a ritmo constante.`, ajuste: BAJO_IMPACTO }
    }
    if (casa) return { id: 'cardio_walk', min: CARDIO.caminar.min, note: CARDIO.caminar.nota }
    return { id: CARDIO.caminar.gym, min: CARDIO.caminar.min, speed: CARDIO.caminar.speed, note: CARDIO.caminar.nota }
  }
  return null
}

/**
 * Estiramientos del día: 1 por músculo trabajado (de los ejercicios realmente elegidos), los más
 * trabajados primero. Nunca uno que la lesión desaconseja.
 */
function estiramientosDelDia(normales, ctx, maximo) {
  const carga = {}
  for (const n of normales) {
    const m = musclesOf(ctx.idx[n.id] || n)
    for (const slug in m) carga[slug] = (carga[slug] || 0) + m[slug] * (n.sets || 1)
  }
  // Sentadillas, prensas y zancadas acortan el flexor de cadera aunque no lo "trabajen".
  if (carga.quadriceps) carga['hip-flexors'] = Math.max(carga['hip-flexors'] || 0, carga.quadriceps * 0.5)
  // Primero el músculo principal de cada ejercicio, en el orden de la sesión; después el resto
  // de lo trabajado, de más a menos carga.
  const principales = [...new Set(normales.map(n => PATRONES[n.patron]?.musculo).filter(Boolean))]
  const resto = Object.keys(carga).filter(slug => carga[slug] >= 2 && !principales.includes(slug)).sort((a, b) => carga[b] - carga[a])
  const musculos = [...principales, ...resto].filter(slug => ESTIRAMIENTOS[slug])
  const usados = new Set()
  const out = []
  for (const slug of musculos) {
    if (out.length >= maximo) break
    const st = ESTIRAMIENTOS[slug].find(e => !usados.has(e.id) && ctx.idxCompleto[e.id] && !(e.noCon || []).some(l => ctx.lesiones.includes(l)))
    if (!st) continue
    usados.add(st.id)
    out.push({
      id: st.id,
      sets: 1,
      sec: st.lados ? 30 : 45,
      mode: 'time',
      weight: 0,
      note: st.lados ? 'Por lado' : undefined,
      isStretch: true,
      musculo: slug,
    })
  }
  return out
}

/* ============================================================
   §8 — Función principal
   ============================================================ */
function minutosDelDia(ejercicios, descanso) {
  let seg = CALENTAMIENTO_SEG
  for (const e of ejercicios) {
    if (e.isCardio) seg += (e.min || 0) * 60
    else if (e.isStretch) seg += (e.sec || 0) * (e.note === 'Por lado' ? 2 : 1) + 15
    else {
      const rest = e.tipo === 'aislamiento' ? Math.min(descanso, DESCANSO_AISLAMIENTO_MAX) : descanso
      seg += (e.sets || 3) * (TRABAJO_SERIE_SEG + rest) + TRANSICION_SEG + (e.warmupSets || 0) * 60
    }
  }
  return Math.round(seg / 60 / 5) * 5
}

function seriesPorMusculo(dias, idx) {
  const total = {}
  for (const d of dias) {
    for (const e of d.ejercicios.filter(x => x.isNormal)) {
      const m = musclesOf(idx[e.id] || e)
      for (const slug in m) total[slug] = (total[slug] || 0) + m[slug] * (e.sets || 0)
    }
  }
  return Object.fromEntries(Object.entries(total).map(([k, v]) => [k, Math.round(v)]).filter(([, v]) => v > 0))
}

const GRANDES = ['chest', 'upper-back', 'quadriceps', 'hamstring', 'gluteal', 'deltoids']

function diasSeguidos(indices) {
  const set = new Set(indices)
  return indices.some(d => set.has((d + 1) % 7))
}

export function generarRutina(respuestas, exerciseDB, dictEs = exerciseNamesEs) {
  const {
    objetivo: objetivoRaw = 'fitness_general',
    tieneLesion = false,
    lesiones: lesionesRaw = [],
    diasSeleccionados = [],
    diasPorSemana: rawDias,
    tiempoPorSesion = '40-60',
    descansoSegundos = '90-120',
    nivel: nivelRaw = 'intermedio',
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
  const objetivo = ESQUEMAS_REPS[objetivoRaw] ? objetivoRaw : 'fitness_general'
  const nivel = ['principiante', 'intermedio', 'avanzado'].includes(nivelRaw) ? nivelRaw : 'intermedio'
  const lesiones = tieneLesion || (lesionesRaw || []).length ? (lesionesRaw || []).filter(l => LESIONES[l] || LESION_RULES[l]) : []

  let diasIndices = []
  if (Array.isArray(diasSeleccionados) && diasSeleccionados.length > 0) {
    const indices = diasSeleccionados.map(d => DAY_MAP[String(d).toLowerCase()]).filter(x => x !== undefined)
    diasIndices = WEEK_ORDER.filter(w => indices.includes(w))
  }
  const totalDias = diasIndices.length > 0 ? diasIndices.length : (rawDias || 3)

  const avisos = []
  const { split, splitAjustado, avisoFrecuencia } = derivarSplit(nivel, totalDias, splitPreferido, enfoque)
  if (avisoFrecuencia) avisos.push(avisoFrecuencia)
  const enfoqueEfectivo = enfoque === 'piernas_gluteos' || split === 'pierna_prioridad' ? 'balance' : enfoque

  const dbCompleta = [
    ...exerciseDB,
    ...CUSTOM_CARDIO_EXERCISES.filter(c => !exerciseDB.some(e => e.id === c.id)),
    ...SYSTEM_EXERCISES.filter(c => !exerciseDB.some(e => e.id === c.id)),
  ]
  const idxCompleto = Object.fromEntries(dbCompleta.map(e => [e.id, e]))
  const poolSeguro = prepararPoolSeguro(exerciseDB, equipamiento, preferenciaEjercicio, lesiones, dictEs)
  const conDict = Boolean(dictEs && Object.keys(dictEs).length > 0)
  const ctx = {
    objetivo, nivel, equipamiento, preferencia: preferenciaEjercicio, lesiones, dictEs, conDict,
    idx: Object.fromEntries(exerciseDB.map(e => [e.id, e])), idxCompleto, poolSeguro,
    usadosEnSemana: new Set(), memo: new Map(),
  }

  const tieneMovilidad = movilidadEstiramientos || incluirMovilidad
  const extrasMin = (CARDIO_MIN[cardio] || 0) + (tieneMovilidad ? ESTIRAMIENTOS_MIN : 0)
  const nSlotsBase = calcularCantidadEjercicios(tiempoPorSesion, descansoSegundos, nivel, objetivo, extrasMin)
  const descanso = DESCANSO_SEG[descansoSegundos] || 105
  const esquema = ESQUEMAS_REPS[objetivo]
  const [seriesComp, seriesAisl] = SERIES[objetivo][nivel]
  const seriesFijas = respuestas.defaultSets !== undefined && respuestas.defaultSets !== null ? Number(respuestas.defaultSets) : null
  const politica = politicaProgresion(tipoProgresion)
  const defaultIntensifier = respuestas.defaultIntensifier || { type: 'none' }
  const intensificador = defaultIntensifier?.type && defaultIntensifier.type !== 'none' ? defaultIntensifier : undefined
  const hiitUsados = { n: 0 }
  const ajustesCardio = new Set()

  const routineConfigs = buildRoutineNames(split, totalDias)
  const dias = []

  for (let i = 0; i < routineConfigs.length; i++) {
    const { rutinaNombre, tipo } = routineConfigs[i]
    const diaSemanaIdx = diasIndices[i] !== undefined ? diasIndices[i] : WEEK_ORDER[i % 7]
    const diaSemanaNombre = DAY_NAMES_ES[diaSemanaIdx]

    // 1. Fuerza: los slots de mayor prioridad que entran en el tiempo, en el orden de la plantilla.
    const { slots, extraAplicado } = slotsDelDia(tipo, enfoqueEfectivo)
    const nSlots = Math.min(8, nSlotsBase + (extraAplicado ? 1 : 0))
    const usadosDia = new Set()
    const patronesDia = new Set()
    const elegidos = []
    const patronesPlantilla = new Set(slots.map(s => s.patron))
    for (const slot of [...slots].sort((a, b) => a.rango - b.rango)) {
      if (elegidos.length >= nSlots) break
      const r = elegirParaSlot(slot, ctx, usadosDia, patronesDia, tipo, patronesPlantilla)
      if (!r) continue
      usadosDia.add(r.ex.id)
      patronesDia.add(patronDeMovimiento(r.ex))
      ctx.usadosEnSemana.add(r.ex.id)
      elegidos.push({ ...r, slot })
    }
    const tipoDe = r => PATRONES[r.patron]?.tipo || 'compuesto'
    elegidos.sort((a, b) => (tipoDe(a) === 'compuesto' ? 0 : 1) - (tipoDe(b) === 'compuesto' ? 0 : 1) || a.slot.orden - b.slot.orden)

    let compuestosConCalentamiento = 0
    let compuestosVistos = 0
    const ejerciciosArray = elegidos.map(({ ex, patron }, j) => {
      const tipoEj = tipoDe({ patron })
      // En fuerza, pesado (3–6) solo en los 2 básicos del día; el resto de los compuestos son
      // accesorios en rango de hipertrofia, si no la sesión se vuelve eterna y poco productiva.
      const accesorio = objetivo === 'fuerza' && tipoEj === 'compuesto' && compuestosVistos >= 2
      if (tipoEj === 'compuesto') compuestosVistos++
      const [lo, hi, fijo] = accesorio ? ESQUEMAS_REPS.hipertrofia.compuesto : esquema[tipoEj]
      const sets = seriesFijas || (accesorio ? 3 : tipoEj === 'compuesto' ? seriesComp : seriesAisl)
      const pesoCorporal = ex.eq === 'body weight'
      const timed = ex.id === 'sys_plank'
      const out = {
        id: ex.id,
        exerciseId: ex.id,
        sets,
        series: sets,
        weight: 0,
        isNormal: true,
        patron,
        tipo: tipoEj,
        motivo: PATRONES[patron]?.motivo,
        metrica: metricaEsfuerzo,
        valorEsfuerzo: VALOR_ESFUERZO[metricaEsfuerzo] || null,
        progresion: tipoProgresion,
      }
      if (timed) {
        Object.assign(out, { mode: 'time', sec: nivel === 'principiante' ? 30 : 45, reps: 0, repeticiones: `${nivel === 'principiante' ? 30 : 45} s` })
      } else if (pesoCorporal) {
        // Peso corporal: la progresión sube reps hasta el techo y después suma una serie.
        Object.assign(out, { reps: lo, repsMax: hi, repeticiones: `${lo}-${hi}` })
      } else if (politica === 'double') {
        // Doble progresión: `reps` es el techo del rango y `repsMin` el piso (progression.js).
        Object.assign(out, { reps: hi, repsMin: lo, repeticiones: `${lo}-${hi}` })
      } else {
        Object.assign(out, { reps: fijo, repeticiones: `${lo}-${hi}` })
      }
      if (tipoEj === 'compuesto' && !pesoCorporal && !timed && compuestosConCalentamiento < 2) {
        out.warmupSets = compuestosConCalentamiento === 0 ? 2 : 1
        compuestosConCalentamiento++
      }
      if (intensificador && tipoEj === 'aislamiento' && !pesoCorporal && !timed) out.intensifier = intensificador
      const notas = []
      if (j === 0) notas.push('Antes de empezar: 5 min de cardio suave para entrar en calor.')
      for (const l of lesiones) {
        const n = LESIONES[l]?.notaEjercicio?.[patron]
        if (n && !notas.includes(n)) notas.push(n)
      }
      if (notas.length) out.note = notas.join(' ')
      return out
    })

    // 2. Cardio (si aplica)
    const ejCardio = cardioDelDia({ opcion: cardio, equipamiento, lesiones, tipoDia: tipo, hiitUsados, idx: idxCompleto })
    if (ejCardio) {
      const { ajuste, ...c } = ejCardio
      if (ajuste) ajustesCardio.add(ajuste)
      ejerciciosArray.push({ ...c, sets: 1, mode: 'cardio', isCardio: true })
    }

    // 3. Estiramientos de lo que se entrenó hoy
    if (tieneMovilidad) {
      const maximo = nSlots <= 4 ? 4 : 5
      ejerciciosArray.push(...estiramientosDelDia(ejerciciosArray.filter(e => e.isNormal), ctx, maximo))
    }

    dias.push({
      diaLabel: `${diaSemanaNombre} — ${rutinaNombre}`,
      rutinaNombre,
      diaSemana: diaSemanaIdx,
      plantilla: tipo,
      minutos: minutosDelDia(ejerciciosArray, descanso),
      ejercicios: ejerciciosArray,
      ex: ejerciciosArray,
    })
  }

  // Avisos del plan completo.
  if (cardio === 'hiit' && hiitUsados.n >= 2 && dias.length > 2) {
    avisos.push('El HIIT quedó en 2 días por semana: más seguido le saca recuperación a la fuerza.')
  }
  for (const nota of ajustesCardio) if (!avisos.includes(nota)) avisos.push(nota)
  if (split === 'fullbody' && totalDias > 1 && diasSeguidos(diasIndices)) {
    avisos.push('Elegiste días seguidos: con Full Body conviene dejar un día de descanso entre sesiones. Si no podés, bajá el peso el segundo día.')
  }
  const tope = { '30-40': 40, '40-60': 60, '60-90': 90, '90+': 120 }[tiempoPorSesion] || 60
  const maxMin = Math.max(0, ...dias.map(d => d.minutos))
  if (maxMin > tope + 10) {
    avisos.push(`Algunas sesiones llegan a ~${maxMin} min, más de lo que elegiste. Si no te alcanza, bajá el descanso o hacé el cardio en otro momento.`)
  }
  const series = seriesPorMusculo(dias, idxCompleto)
  const [volMin, volMax] = VOLUMEN_OBJETIVO[nivel]
  const grandes = GRANDES.map(m => series[m] || 0).filter(v => v > 0).sort((a, b) => a - b)
  const mediana = grandes.length ? grandes[Math.floor(grandes.length / 2)] : 0
  if (grandes.length && mediana < volMin * 0.7) {
    avisos.push('Con estos días y este tiempo, el volumen semanal queda bajo para tu nivel. Si podés, sumá un día o más tiempo por sesión.')
  }

  const [progNombre, progExplicacion] = NOMBRE_PROGRESION[politica]
  const resultado = {
    version: 6,
    splitAsignado: split,
    splitAjustado,
    poolSeguro,
    poolCardio: prepararPoolCardio(dbCompleta, equipamiento, lesiones),
    poolEstiramientos: prepararPoolEstiramientos(dbCompleta, lesiones),
    usadosEnSemana: ctx.usadosEnSemana,
    parametrosGlobales: {
      descansoRecomendado: descansoSegundos === '60' ? '60 segundos entre series' : descansoSegundos === '180+' ? '180+ segundos (fuerza)' : '90-120 segundos entre series',
      tipoProgresion: progNombre,
      metricaEsfuerzo: metricaEsfuerzo === 'rpe' ? 'RPE 8-9' : 'RIR 1-2 (dejar 1 a 2 reps en recámara)',
    },
    resumen: {
      split,
      dias: dias.map(d => ({ diaSemana: d.diaSemana, rutinaNombre: d.rutinaNombre, minutos: d.minutos, ejercicios: d.ejercicios.filter(e => e.isNormal).length })),
      series,
      volumenObjetivo: [volMin, volMax],
      reps: {
        compuesto: `${esquema.compuesto[0]}–${esquema.compuesto[1]}`,
        aislamiento: `${esquema.aislamiento[0]}–${esquema.aislamiento[1]}`,
      },
      descanso: { compuestos: descanso, aislamiento: Math.min(descanso, DESCANSO_AISLAMIENTO_MAX) },
      progresion: { nombre: progNombre, explicacion: progExplicacion },
      esfuerzo: metricaEsfuerzo === 'rpe'
        ? { nombre: 'RPE 8–9', explicacion: 'En una escala de 1 a 10, cada serie termina en 8 o 9: te quedan 1 o 2 reps antes de no poder más.' }
        : { nombre: 'RIR 1–2', explicacion: 'Cada serie termina cuando te quedan 1 o 2 reps en reserva antes de no poder más.' },
      lesiones: lesiones.filter(l => LESIONES[l]).map(l => ({ zona: l, nota: LESIONES[l].nota })),
      avisos,
    },
    dias,
  }

  if (avisos.length > 0) {
    resultado.mensajeAjuste = avisos.join(' · ')
    resultado.avisoFrecuencia = avisoFrecuencia || avisos[0]
  }

  if (lesiones.length > 0) {
    resultado.disclaimer = 'Rutina adaptada a tus lesiones. Si sentís dolor agudo durante cualquier ejercicio, detené la actividad y consultá a un profesional de salud antes de continuar.'
    resultado.resumen.disclaimer = resultado.disclaimer
  }

  return resultado
}

export function rutinaGeneradaToRoutines(rutinaGenerada, respuestas = {}) {
  const routines = rutinaGenerada.dias.map((dia, i) => {
    const ejercicios = (dia.ejercicios || dia.ex || []).map(ej => {
      const out = {
        id: ej.id || ej.exerciseId,
        sets: ej.sets || ej.series || 3,
        reps: ej.reps ?? (ej.repeticiones ? parseInt(ej.repeticiones.split('-')[0], 10) : 10),
        weight: ej.weight || 0,
        mode: ej.mode,
        min: ej.min,
        sec: ej.sec,
        speed: ej.speed,
        note: ej.note,
        isNormal: ej.isNormal,
        isCardio: ej.isCardio,
        isStretch: ej.isStretch,
      }
      if (ej.repsMin) out.repsMin = ej.repsMin
      if (ej.repsMax) out.repsMax = ej.repsMax
      if (ej.warmupSets) out.warmupSets = ej.warmupSets
      if (ej.intensifier) out.intensifier = ej.intensifier
      for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k]
      return out
    })

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

/* ============================================================
   §9 — Alternativas para "Reemplazar"
   ============================================================ */
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

// Curados del mismo patrón que están en el pool (ya filtrado por equipamiento y lesiones).
function curadosDelPatron(patron, poolSeguro, excluir) {
  const def = PATRONES[patron]
  if (!def) return []
  const enPool = new Map(poolSeguro.map(e => [e.id, e]))
  return def.candidatos.map(([id]) => enPool.get(id)).filter(e => e && !excluir.has(e.id))
}

export function obtenerAlternativas(ejercicioActual, poolSeguro = [], idsUsadosEnLaSemana = new Set(), n = 3) {
  const actualDB = poolSeguro.find(e => e.id === (ejercicioActual.id || ejercicioActual.exerciseId)) || ejercicioActual
  const targetTg = actualDB.tg
  const actualId = actualDB.id || ejercicioActual.id || ejercicioActual.exerciseId
  const idsSet = idsUsadosEnLaSemana instanceof Set ? idsUsadosEnLaSemana : new Set(idsUsadosEnLaSemana || [])
  const excluir = new Set([...idsSet, actualId])

  // Primero, las otras opciones curadas del mismo patrón (press por press, remo por remo).
  const patron = ejercicioActual.patron || PATRON_DE_ID[actualId]
  const elegidos = curadosDelPatron(patron, poolSeguro, excluir).slice(0, n)
  if (elegidos.length >= n) return elegidos

  const candidatos = poolSeguro.filter(e => e.tg === targetTg && !excluir.has(e.id) && !elegidos.includes(e))
  const patronesVistos = new Set(elegidos.map(patronDeMovimiento))
  for (const c of [...candidatos].sort((a, b) => jerarquiaScore(b) - jerarquiaScore(a))) {
    if (elegidos.length === n) break
    const p = patronDeMovimiento(c)
    if (patronesVistos.has(p)) continue
    patronesVistos.add(p)
    elegidos.push(c)
  }
  for (const c of candidatos) {
    if (elegidos.length === n) break
    if (!elegidos.includes(c)) elegidos.push(c)
  }
  return elegidos
}

export function obtenerMasAlternativas(ejercicioActual, poolSeguro = [], idsUsadosEnLaSemana = new Set(), yaMostrados = new Set(), n = 5) {
  const actualDB = poolSeguro.find(e => e.id === (ejercicioActual.id || ejercicioActual.exerciseId)) || ejercicioActual
  const targetTg = actualDB.tg
  const actualId = actualDB.id || ejercicioActual.id || ejercicioActual.exerciseId

  const idsSet = idsUsadosEnLaSemana instanceof Set ? idsUsadosEnLaSemana : new Set(idsUsadosEnLaSemana || [])
  const mostradosSet = yaMostrados instanceof Set ? yaMostrados : new Set(yaMostrados || [])
  const excluir = new Set([...idsSet, ...mostradosSet, actualId])
  const patron = ejercicioActual.patron || PATRON_DE_ID[actualId]
  const curados = curadosDelPatron(patron, poolSeguro, excluir)

  const resto = poolSeguro
    .filter(e => e.tg === targetTg && !excluir.has(e.id) && !curados.includes(e))
    .sort((a, b) => jerarquiaScore(b) - jerarquiaScore(a))
  return [...curados, ...resto].slice(0, n)
}

export function buscarEnGrupoMuscular(query, poolSeguro = [], tg, idsUsadosEnLaSemana = new Set()) {
  if (!query || !query.trim()) return []
  const idsSet = idsUsadosEnLaSemana instanceof Set ? idsUsadosEnLaSemana : new Set(idsUsadosEnLaSemana || [])

  return poolSeguro.filter(e =>
    e.tg === tg &&
    !idsSet.has(e.id) &&
    matchExercise(e, query)
  )
}
