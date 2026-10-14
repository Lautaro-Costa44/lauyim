import { EXDB } from './exercises-data.js'
import { USER_EXERCISE_MUSCLE_OVERRIDES, exerciseMuscleMetadataFor } from './exercise-muscle-batch-1.js'
import { t, getVersion, exerciseNameSearchText } from './i18n-core.js'
import { BODY_PARTS_ES } from '../locales/body-parts-es.js'

export { EXDB }

// The generated dataset remains the compatibility/raw export. The runtime catalogue applies
// owner-approved muscle metadata as a narrow overlay, so imports and historical tests that rely
// on the upstream shape keep working while EXIDX and pickers see the corrected model.
const catalogueExercise = ex => {
  const metadata = exerciseMuscleMetadataFor(ex?.id)
  if (!Object.keys(metadata).length) return ex
  const out = { ...ex, ...metadata }
  const user = USER_EXERCISE_MUSCLE_OVERRIDES[ex?.id] || {}
  // A future dataset row may carry explicit arrays of its own; preserve those over generated
  // defaults unless the owner has deliberately supplied a correction for the same field.
  for (const key of ['primaries', 'secondaries']) {
    if (Object.prototype.hasOwnProperty.call(ex, key) && !Object.prototype.hasOwnProperty.call(user, key)) out[key] = ex[key]
  }
  if (Array.isArray(out.primaries)) out.primaries = [...out.primaries]
  if (Array.isArray(out.secondaries)) out.secondaries = [...out.secondaries]
  return out
}

export const CUSTOM_CARDIO_EXERCISES = [
  { id: 'cardio_treadmill', n: 'treadmill running / walking', bp: 'cardio', eq: 'treadmill', tg: 'cardiovascular system', mg: 'quadriceps', sm: ['calves', 'hamstrings'], st: ['Walk or run on the treadmill at a steady or interval pace.'] },
  { id: 'cardio_bike', n: 'stationary bike cycling', bp: 'cardio', eq: 'stationary bike', tg: 'cardiovascular system', mg: 'quadriceps', sm: ['hamstrings', 'calves'], st: ['Pedal on the stationary bike at a steady cadence or interval resistance.'] },
  { id: 'cardio_stairmaster', n: 'stairmaster climbing', bp: 'cardio', eq: 'leverage machine', tg: 'cardiovascular system', mg: 'quadriceps', sm: ['glutes', 'calves'], st: ['Step on the stairmaster maintaining an upright posture.'] },
  { id: 'cardio_bodyweight_hiit', n: 'bodyweight hiit (jumping jacks / burpees / mountain climbers)', bp: 'cardio', eq: 'body weight', tg: 'cardiovascular system', mg: 'quadriceps', sm: ['calves', 'hamstrings'], st: ['Intervals of bodyweight exercises like jumping jacks, burpees, and mountain climbers.'] },
  { id: 'cardio_walk', n: 'brisk walking', bp: 'cardio', eq: 'body weight', tg: 'cardiovascular system', mg: 'quadriceps', sm: ['calves', 'hamstrings'], st: ['Caminá a paso rápido, con un ritmo que te deje hablar pero no cantar.'] },
]

// Básicos que el dataset no trae y que el generador de rutinas necesita (plancha, sentadilla
// sin peso, remo a un brazo…). Sin video: el detalle muestra solo los pasos, en español
// porque el pack de instrucciones generado no los conoce.
export const SYSTEM_EXERCISES = [
  { id: 'sys_bw_squat', n: 'bodyweight squat', bp: 'upper legs', eq: 'body weight', tg: 'quads', mg: 'glutes', sm: ['hamstrings', 'adductors'], st: ['Parate con los pies al ancho de los hombros y las puntas un poco hacia afuera.', 'Bajá llevando la cadera hacia atrás y abajo, con el pecho alto y las rodillas en la línea de los pies.', 'Bajá hasta donde puedas sin redondear la espalda (idealmente, muslos paralelos al piso).', 'Subí empujando el piso con todo el pie.'] },
  { id: 'sys_db_row', n: 'dumbbell one arm row', bp: 'back', eq: 'dumbbell', tg: 'upper back', mg: 'lats', sm: ['biceps', 'rear deltoids'], st: ['Apoyá una rodilla y la mano del mismo lado en un banco, con la espalda recta.', 'Con la otra mano tomá la mancuerna con el brazo estirado.', 'Llevá el codo hacia atrás y arriba, cerca del cuerpo, hasta que la mancuerna llegue a la cadera.', 'Bajá controlando y repetí. Después cambiá de lado.'] },
  { id: 'sys_hip_thrust', n: 'barbell hip thrust', bp: 'upper legs', eq: 'barbell', tg: 'glutes', mg: 'hamstrings', sm: ['hamstrings', 'quads'], st: ['Sentate en el piso con la parte alta de la espalda apoyada en un banco y la barra sobre la cadera (con protector).', 'Pies apoyados al ancho de la cadera, rodillas flexionadas.', 'Empujá con los talones y subí la cadera hasta que el torso quede alineado con los muslos, apretando los glúteos.', 'Bajá controlando sin apoyar del todo y repetí.'] },
  { id: 'sys_plank', n: 'front plank', bp: 'waist', eq: 'body weight', tg: 'abs', mg: 'abs', sm: ['obliques', 'lower back'], st: ['Apoyá los antebrazos en el piso con los codos debajo de los hombros.', 'Estirá las piernas y apoyá las puntas de los pies.', 'Mantené el cuerpo en línea recta, apretando abdomen y glúteos, sin dejar caer la cadera.', 'Respirá normal y sostené el tiempo indicado.'] },
  { id: 'sys_pike_pushup', n: 'pike push-up', bp: 'shoulders', eq: 'body weight', tg: 'delts', mg: 'triceps', sm: ['triceps', 'upper chest'], st: ['Desde posición de flexión, subí la cadera formando una V invertida.', 'Flexioná los codos llevando la cabeza hacia el piso, entre las manos.', 'Empujá hasta estirar los brazos, manteniendo la cadera alta.'] },
  { id: 'sys_st_biceps', n: 'wall biceps stretch', bp: 'upper arms', eq: 'body weight', tg: 'biceps', mg: 'biceps', sm: ['chest', 'shoulders'], st: ['Apoyá la palma en una pared a la altura del hombro, con el brazo estirado y el pulgar hacia arriba.', 'Girá el cuerpo despacio hacia el lado contrario hasta sentir el estiramiento en el bíceps.', 'Sostené sin rebotes y cambiá de brazo.'] },
  { id: 'sys_st_hip_flexor', n: 'kneeling hip flexor stretch', bp: 'upper legs', eq: 'body weight', tg: 'quads', mg: 'hip flexors', sm: ['quads'], st: ['Apoyá una rodilla en el piso (con algo blando abajo) y el otro pie adelante, rodilla a 90°.', 'Apretá el glúteo de la pierna de atrás y llevá la cadera un poco hacia adelante.', 'Sentí el estiramiento en el frente de la cadera, sin arquear la espalda baja.', 'Sostené y cambiá de lado.'] },
  { id: 'sys_st_abs', n: 'cobra abdominal stretch', bp: 'waist', eq: 'body weight', tg: 'abs', mg: 'abs', sm: ['hip flexors'], st: ['Acostate boca abajo con las manos debajo de los hombros.', 'Empujá suave el piso y levantá el pecho, con la cadera apoyada.', 'Subí solo hasta donde no moleste la espalda baja y sostené.'] },
]

export const CATALOGUE = [...EXDB, ...CUSTOM_CARDIO_EXERCISES, ...SYSTEM_EXERCISES].map(catalogueExercise)

// The generated dataset already supplies secondary muscles for most exercises. Keep the
// handful of conservative catalogue additions that are useful to the muscle map here so a
// dataset refresh does not erase them. Values follow the dataset's existing alias vocabulary.
const SECONDARY_ADDITIONS = {
  '0027': ['rear deltoids'], // barbell bent over row
  '0293': ['rear deltoids'], // dumbbell bent over row
  '0499': ['rear deltoids'], // inverted row
  '0861': ['rear deltoids'], // cable seated row
}

// Secondary muscles for an exercise, with the small conservative additions applied as an
// overlay. The raw dataset is never mutated - consumers that want the pristine catalogue
// (export, print, import) keep reading EXDB untouched, while the muscle map sees the
// enriched list. Values follow the dataset's existing alias vocabulary.
export const smOf = ex => {
  const base = Array.isArray(ex?.sm) ? ex.sm : (ex?.sm ? [ex.sm] : [])
  return [...new Set([...base, ...(SECONDARY_ADDITIONS[ex?.id] || [])])]
}

export const EXIDX = {}
CATALOGUE.forEach(e => { EXIDX[e.id] = e })
export const BODYPARTS = [...new Set(CATALOGUE.map(e => e.bp))].sort()

// Equipment options present in a given list of exercises, most common first (issue #6).
// Deriving them from the *already filtered* list keeps the chip row short and means
// every body-part × equipment combination on screen has results behind it.
export function equipmentOf(list) {
  const c = {}
  list.forEach(e => { if (e.eq) c[e.eq] = (c[e.eq] || 0) + 1 })
  return Object.keys(c).sort((a, b) => c[b] - c[a] || (a < b ? -1 : 1))
}

// Custom (user-created) exercises live in synced state S.customEx (issue #11) and are
// merged into the id index here so every EXIDX[id] lookup keeps working unchanged.
let customIds = []
export function registerCustom(list) {
  customIds.forEach(id => {
    delete EXIDX[id]
    const builtIn = CATALOGUE.find(ex => ex.id === id)
    if (builtIn) EXIDX[id] = builtIn
  })
  customIds = (list || []).map(e => e.id)
  // Con dos entradas del mismo id (la copia propia que un cliente viejo guardaba de un ejercicio
  // que el admin compartió), gana la compartida: es la que existe para todos.
  ;(list || []).forEach(e => { if (e.shared || !EXIDX[e.id]?.shared) EXIDX[e.id] = e })
}
// Full searchable catalogue — customs first so your own exercises are easy to find.
// Una sola entrada por id: si un estado viejo trae un compartido y su copia, va el compartido.
export const allExercises = st => [...uniqueCustom(st.customEx), ...CATALOGUE]
function uniqueCustom(list) {
  const byId = new Map()
  for (const e of list || []) {
    const prev = byId.get(e.id)
    if (!prev || (e.shared && !prev.shared)) byId.set(e.id, e)
  }
  return [...byId.values()]
}

function searchableText(value) {
  if (Array.isArray(value)) return value.map(searchableText).join(' ')
  if (value == null) return ''
  try { return String(value) } catch { return '' }
}

/** Case-insensitive search over built-in and legacy custom exercise metadata. */
function isSubsequence(needle, hay) {
  let i = 0
  for (const ch of hay) {
    if (ch === needle[i]) i++
    if (i === needle.length) return true
  }
  return false
}

// Fuzzy match score for one exercise against a query. Best hits: exact field match, then
// field prefix, then word-boundary starts, then substrings (closer to the start scores
// better), and finally typo-tolerant ordered subsequences. Fields are weighted - the name
// dominates, target/equipment matter, muscles and description are supporting evidence.
// 0 means no match, so matchesExerciseSearch stays a boolean filter while the picker can
// rank results by score.
export function searchScore(exercise, query) {
  const needle = searchableText(query).toLowerCase().trim()
  if (!needle) return 1
  const source = exercise && typeof exercise === 'object' ? exercise : {}
  const fields = [['n', 100], ['tg', 40], ['eq', 40], ['sm', 30], ['muscleGroups', 30], ['primaries', 30], ['secondaries', 30], ['desc', 10], ['cues', 10]]
  // Token-level matching: every query word must match somewhere (any order), so
  // "press bench" finds "Bench Press". The score sums each token's best hit.
  const tokens = needle.split(/[^a-z0-9]+/).filter(Boolean)
  if (!tokens.length) return 0
  let total = 0
  for (const token of tokens) {
    let best = 0
    for (const [field, weight] of fields) {
      const hay = searchableText(source[field]).toLowerCase()
      if (!hay) continue
      if (hay === token) best = Math.max(best, weight * 4)
      else if (hay.startsWith(token)) best = Math.max(best, weight * 3)
      const idx = hay.indexOf(token)
      if (idx > 0) best = Math.max(best, weight * 2 - Math.min(idx, 20) * 0.5)
      if (hay.split(/[^a-z0-9]+/).some(w => w.startsWith(token))) best = Math.max(best, weight * 2.5)
      if (isSubsequence(token, hay)) best = Math.max(best, weight + Math.max(0, 10 - (hay.length - token.length)))
    }
    if (!best) return 0 // every token must match
    total += best
  }
  return total
}

export function matchesExerciseSearch(exercise, query) {
  return searchScore(exercise, query) > 0
}

// Media normally sits next to the app (img/ and gif/, mounted into the web container).
// A build can point them somewhere else — the demo build pulls them off a CDN instead of
// shipping ~140 MB of images into the deployment. `import.meta.env` is undefined in plain
// Node; the guard keeps this module loadable without Vite.
const ENV = import.meta.env || {}
const IMG_BASE = ENV.VITE_IMG_BASE || 'img/'
const GIF_BASE = ENV.VITE_GIF_BASE || 'gif/'
export const imgSrc = ex => IMG_BASE + ex.img
export const gifSrc = ex => GIF_BASE + ex.gif

// Cardio exercises log time + speed instead of weight × reps.
export const isCardio = idOrEx => (typeof idOrEx === 'string' ? EXIDX[idOrEx] : idOrEx)?.bp === 'cardio'
export const isStretch = idOrEx => Boolean((typeof idOrEx === 'string' ? EXIDX[idOrEx] : idOrEx)?.isStretch)

// Exercises the dataset already knows carry no external load (issue #32) — a quarter of the
// catalogue. This seeds the `bw` flag on a fresh config so a push-up never asks for a weight
// nobody was going to enter. It is only the default: the flag lives on the config, so a dip
// done with a belt can turn it off and a custom exercise can turn it on.
export const isBodyweightEq = idOrEx =>
  (typeof idOrEx === 'string' ? EXIDX[idOrEx] : idOrEx)?.eq === 'body weight'

// An id that resolves to nothing — a plan file built against a different exercise dataset,
// a custom exercise deleted on another device before the sync arrived — still has to
// render. A placeholder keeps it visible (and removable) instead of taking the whole view
// down on the first `ex.n`.
export const exOr = id => EXIDX[id] ||
  { id, n: t('Unknown exercise'), bp: '', tg: '', eq: '', sm: [], st: [], missing: true }

// Normalizes text by lowercasing and stripping diacritics/accents (e.g. "elevação" -> "elevacao")
export const normalizeStr = s => (s || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()

// Multi-token, accent-insensitive and multilingual exercise search.
// Matches when all whitespace-separated words in the query appear anywhere in the exercise's
// name, equipment, target muscle, body part (both in English and translated to active language),
// secondary muscles or description.
//
// The haystack is built once per exercise and cached: NFD-normalising ~1300 catalogue entries
// on every keystroke costs ~8ms on a desktop and several times that on a phone. The cache key
// is the i18n version (bumped by every setLang), so switching language rebuilds the translated
// terms. Custom exercises are re-cached automatically — the store clones state on update, so an
// edited exercise arrives as a new object the WeakMap has never seen.
const corpusCache = new WeakMap()

function corpusOf(e) {
  const v = getVersion()
  const hit = corpusCache.get(e)
  if (hit && hit.v === v) return hit.s
  
  const sm = Array.isArray(e?.sm) ? e.sm : []

  // Obtener alias musculares en español si existen para el target o bodypart
  const tgAliases = BODY_PARTS_ES[e?.tg?.toLowerCase()] || []
  const bpAliases = BODY_PARTS_ES[e?.bp?.toLowerCase()] || []

  const s = normalizeStr([
    exerciseNameSearchText(e),
    e?.tg || '', t(e?.tg || ''), ...tgAliases,
    e?.eq || '', t(e?.eq || ''),
    e?.bp || '', t(e?.bp || ''), ...bpAliases,
    ...sm, ...sm.map(m => t(m)),
    e?.desc || ''
  ].join(' '))
  
  corpusCache.set(e, { v, s })
  return s
}

export function matchExercise(e, query) {
  if (!query) return true
  const tokens = normalizeStr(query).split(/\s+/).filter(Boolean)
  if (!tokens.length) return true
  if (!e || typeof e !== 'object') return false
  const corpus = corpusOf(e)
  return tokens.every(tok => corpus.includes(tok))
}
