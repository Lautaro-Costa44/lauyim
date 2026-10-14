/**
 * Catálogo curado del generador de rutinas (v6).
 *
 * El generador ya no elige del catálogo crudo (~1.300 ejercicios, muchos raros o combinados):
 * cada sesión es una plantilla de slots por patrón de movimiento, y cada patrón tiene una lista
 * corta y ordenada de ejercicios probados. El catálogo completo queda para "Reemplazar → Ver
 * más" y la búsqueda manual.
 *
 * Niveles: un ejercicio con nivel 'intermedio' no se le da a un principiante; 'avanzado' solo a
 * avanzados. El orden de `candidatos` es el preferido para intermedio/avanzado; `principiante`
 * (opcional) reordena para quien recién empieza (máquinas y mancuernas antes que barra) y
 * `fuerza` (opcional) para el objetivo de fuerza (básicos con barra primero).
 */

export const NIVELES = ['principiante', 'intermedio', 'avanzado']
export const nivelIndex = nivel => Math.max(0, NIVELES.indexOf(nivel))

// [id, nivel mínimo]
const P = 'principiante', I = 'intermedio', A = 'avanzado'

/**
 * Patrones de movimiento.
 * - musculo: slug de muscles.js que el patrón trabaja como principal (volumen y explicación).
 * - tipo: 'compuesto' | 'aislamiento' (reps, descanso, orden y calentamiento).
 * - tgs: grupos del dataset para el respaldo cuando ningún candidato curado está disponible.
 * - sustitutos: patrones a probar si este queda vacío (equipamiento o lesiones).
 * - motivo: línea corta que explica por qué está en la rutina.
 */
export const PATRONES = {
  sentadilla: {
    musculo: 'quadriceps', tipo: 'compuesto', tgs: ['quads'], sustitutos: ['prensa', 'zancada'],
    motivo: 'Básico de piernas: cuádriceps y glúteos',
    candidatos: [['0043', I], ['0743', P], ['0755', P], ['1760', P], ['0534', P], ['sys_bw_squat', P], ['2368', P]],
    principiante: ['1760', '0743', '0755', '0534', 'sys_bw_squat', '2368'],
    fuerza: ['0043', '0743', '0755', '1760'],
  },
  prensa: {
    musculo: 'quadriceps', tipo: 'compuesto', tgs: ['quads'], sustitutos: ['sentadilla', 'zancada'],
    motivo: 'Piernas con la espalda apoyada: mucho trabajo de cuádriceps con poco riesgo',
    candidatos: [['0739', P], ['0760', P], ['0743', P], ['1760', P], ['sys_bw_squat', P], ['2368', P]],
  },
  zancada: {
    musculo: 'quadriceps', tipo: 'compuesto', tgs: ['quads', 'glutes'], sustitutos: ['prensa'],
    motivo: 'Trabajo a una pierna: corrige diferencias entre lados y suma glúteo',
    candidatos: [['0410', I], ['0381', P], ['0431', P], ['0336', P], ['1460', P], ['2368', P]],
    principiante: ['0381', '0431', '2368', '0336', '1460'],
  },
  extension_cuadriceps: {
    musculo: 'quadriceps', tipo: 'aislamiento', tgs: ['quads'], sustitutos: ['zancada'],
    motivo: 'Aislamiento de cuádriceps',
    candidatos: [['0585', P]],
  },
  bisagra: {
    musculo: 'hamstring', tipo: 'compuesto', tgs: ['hamstrings', 'glutes'], sustitutos: ['hip_thrust', 'curl_femoral'],
    motivo: 'Bisagra de cadera: isquiotibiales, glúteos y espalda baja',
    candidatos: [['0085', I], ['1459', P], ['0432', P], ['0196', P], ['1757', I], ['0811', I], ['0032', A]],
    principiante: ['1459', '0196', '0432'],
    fuerza: ['0032', '0811', '0085', '1459'],
  },
  hip_thrust: {
    musculo: 'gluteal', tipo: 'compuesto', tgs: ['glutes'], sustitutos: ['bisagra'],
    motivo: 'El ejercicio que más trabaja el glúteo',
    candidatos: [['sys_hip_thrust', P], ['1409', P], ['3013', P]],
  },
  curl_femoral: {
    musculo: 'hamstring', tipo: 'aislamiento', tgs: ['hamstrings'], sustitutos: ['bisagra', 'hip_thrust'],
    motivo: 'Aislamiento de isquiotibiales',
    candidatos: [['0599', P], ['0586', P], ['0339', P], ['0697', I], ['0496', A]],
  },
  gemelos: {
    musculo: 'calves', tipo: 'aislamiento', tgs: ['calves'], sustitutos: [],
    motivo: 'Gemelos',
    candidatos: [['0605', P], ['0594', P], ['1375', P], ['0417', P], ['1373', P]],
  },
  abduccion: {
    musculo: 'gluteal', tipo: 'aislamiento', tgs: ['abductors', 'glutes'], sustitutos: [],
    motivo: 'Glúteo medio: estabilidad de cadera y rodilla',
    candidatos: [['0597', P], ['0710', P]],
  },
  aduccion: {
    musculo: 'adductors', tipo: 'aislamiento', tgs: ['adductors'], sustitutos: [],
    motivo: 'Aductores',
    candidatos: [['0598', P], ['0168', P]],
  },
  press_horizontal: {
    musculo: 'chest', tipo: 'compuesto', tgs: ['pectorals'], sustitutos: ['press_inclinado'],
    motivo: 'Básico de empuje: pecho, hombro anterior y tríceps',
    candidatos: [['0025', I], ['0289', P], ['0577', P], ['0251', I], ['0662', P], ['0493', P]],
    principiante: ['0577', '0289', '0025', '0493', '0662'],
    fuerza: ['0025', '0289', '0577'],
  },
  press_inclinado: {
    musculo: 'chest', tipo: 'compuesto', tgs: ['pectorals'], sustitutos: ['press_horizontal'],
    motivo: 'Press inclinado: énfasis en la parte alta del pecho',
    candidatos: [['0314', P], ['0047', I], ['1299', P], ['0279', I], ['0662', P]],
    principiante: ['1299', '0314', '0662'],
  },
  aperturas: {
    musculo: 'chest', tipo: 'aislamiento', tgs: ['pectorals'], sustitutos: [],
    motivo: 'Aislamiento de pecho',
    candidatos: [['0188', P], ['0596', P], ['0308', P]],
  },
  press_vertical: {
    musculo: 'deltoids', tipo: 'compuesto', tgs: ['delts'], sustitutos: ['elevaciones_laterales'],
    motivo: 'Básico de hombros: empuje por encima de la cabeza',
    candidatos: [['0405', P], ['0091', I], ['0603', P], ['sys_pike_pushup', I]],
    principiante: ['0603', '0405'],
    fuerza: ['0091', '0405', '0603'],
  },
  elevaciones_laterales: {
    musculo: 'deltoids', tipo: 'aislamiento', tgs: ['delts'], sustitutos: ['deltoide_posterior'],
    motivo: 'Deltoides lateral: hombros más anchos',
    candidatos: [['0334', P], ['0178', P], ['0584', P]],
  },
  deltoide_posterior: {
    musculo: 'deltoids', tipo: 'aislamiento', tgs: ['delts'], sustitutos: [],
    motivo: 'Deltoides posterior: salud del hombro y postura',
    candidatos: [['0203', P], ['0602', P], ['0383', P]],
  },
  jalon: {
    musculo: 'upper-back', tipo: 'compuesto', tgs: ['lats'], sustitutos: ['remo'],
    motivo: 'Tirón vertical: dorsales y bíceps',
    candidatos: [['0198', P], ['0579', P], ['0652', I], ['0017', P], ['1326', I], ['2330', P]],
    principiante: ['0198', '0579', '0017', '2330'],
  },
  remo: {
    musculo: 'upper-back', tipo: 'compuesto', tgs: ['upper back', 'lats'], sustitutos: ['jalon'],
    motivo: 'Tirón horizontal: espalda media, dorsales y deltoides posterior',
    candidatos: [['0861', P], ['sys_db_row', P], ['1350', P], ['0027', I], ['0327', P], ['0293', I], ['0499', P], ['2300', P]],
    principiante: ['1350', '0861', 'sys_db_row', '0327', '2300', '0499'],
    fuerza: ['0027', '0861', 'sys_db_row'],
  },
  biceps: {
    musculo: 'biceps', tipo: 'aislamiento', tgs: ['biceps'], sustitutos: [],
    motivo: 'Bíceps',
    candidatos: [['0294', P], ['0447', P], ['0868', P], ['0315', I], ['1326', I]],
  },
  martillo: {
    musculo: 'biceps', tipo: 'aislamiento', tgs: ['biceps'], sustitutos: ['biceps'],
    motivo: 'Bíceps y antebrazo (braquial)',
    candidatos: [['0313', P], ['0165', P]],
  },
  triceps: {
    musculo: 'triceps', tipo: 'aislamiento', tgs: ['triceps'], sustitutos: ['triceps_overhead'],
    motivo: 'Tríceps',
    candidatos: [['0200', P], ['0201', P], ['0241', P], ['0129', P], ['0259', I], ['0283', I]],
  },
  triceps_overhead: {
    musculo: 'triceps', tipo: 'aislamiento', tgs: ['triceps'], sustitutos: ['triceps'],
    motivo: 'Tríceps estirado (cabeza larga)',
    candidatos: [['0194', P], ['0430', P], ['2188', P], ['0453', I], ['0283', I]],
  },
  core: {
    musculo: 'abs', tipo: 'aislamiento', tgs: ['abs'], sustitutos: [],
    motivo: 'Zona media: estabilidad para todos los demás ejercicios',
    candidatos: [['sys_plank', P], ['0276', P], ['0175', P], ['0872', P], ['0472', I]],
  },
}

// Para cada id curado, su patrón (el primero que lo lista). Lo usan las alternativas del
// reemplazo y la advertencia de lesiones del panel admin.
export const PATRON_DE_ID = {}
for (const [patron, def] of Object.entries(PATRONES)) {
  for (const [id] of def.candidatos) if (!PATRON_DE_ID[id]) PATRON_DE_ID[id] = patron
}

/**
 * Plantillas de sesión. Cada slot: [patrón, rango, variante?].
 * - El orden de la lista es el orden en la sesión (compuestos primero).
 * - `rango` decide qué entra cuando el tiempo alcanza para menos ejercicios (1 = imprescindible).
 * - `variante` (por defecto 0) elige el 2º candidato disponible del patrón, para que la sesión B
 *   no repita exactamente el mismo ejercicio que la A.
 */
export const PLANTILLAS = {
  fullbody_a: [['sentadilla', 1], ['press_horizontal', 2], ['jalon', 3], ['bisagra', 4], ['press_vertical', 5], ['curl_femoral', 7], ['biceps', 8], ['triceps', 9], ['core', 6]],
  fullbody_b: [['prensa', 1], ['press_inclinado', 2], ['remo', 3], ['bisagra', 4, 1], ['elevaciones_laterales', 5], ['zancada', 7], ['triceps_overhead', 8], ['martillo', 9], ['core', 6, 1]],
  torso_a: [['press_horizontal', 1], ['remo', 2], ['jalon', 3], ['press_vertical', 4], ['elevaciones_laterales', 7], ['triceps', 5], ['biceps', 6], ['deltoide_posterior', 8]],
  torso_b: [['press_inclinado', 1], ['jalon', 2, 1], ['remo', 3, 1], ['elevaciones_laterales', 4], ['aperturas', 7], ['triceps_overhead', 5], ['martillo', 6], ['deltoide_posterior', 8]],
  pierna_a: [['sentadilla', 1], ['bisagra', 2], ['prensa', 3], ['curl_femoral', 4], ['extension_cuadriceps', 5], ['gemelos', 6], ['core', 7]],
  pierna_b: [['bisagra', 1], ['zancada', 2], ['hip_thrust', 3], ['curl_femoral', 4], ['extension_cuadriceps', 6], ['gemelos', 5], ['abduccion', 7], ['core', 8]],
  push: [['press_horizontal', 1], ['press_vertical', 2], ['press_inclinado', 3], ['triceps', 4], ['elevaciones_laterales', 5], ['triceps_overhead', 6], ['aperturas', 7]],
  pull: [['jalon', 1], ['remo', 2], ['biceps', 3], ['deltoide_posterior', 4], ['remo', 5, 1], ['martillo', 6], ['core', 7]],
  legs: [['sentadilla', 1], ['bisagra', 2], ['prensa', 3], ['curl_femoral', 4], ['extension_cuadriceps', 5], ['gemelos', 6], ['core', 7]],
  pierna_quads: [['sentadilla', 1], ['prensa', 2], ['zancada', 3], ['extension_cuadriceps', 4], ['gemelos', 5], ['abduccion', 6], ['core', 7]],
  pierna_isquios_gluteo: [['bisagra', 1], ['hip_thrust', 2], ['curl_femoral', 3], ['abduccion', 4], ['zancada', 5, 1], ['gemelos', 6], ['core', 7]],
  pierna_gluteo: [['hip_thrust', 1], ['zancada', 2], ['prensa', 3], ['curl_femoral', 4], ['abduccion', 5], ['aduccion', 6], ['gemelos', 7]],
}

// Con el enfoque "Torso y brazos", los días de tren superior suman un slot de brazos (no se saca
// nada: el día tiene un ejercicio más).
export const EXTRA_ENFOQUE = {
  torso_brazos: { dias: ['fullbody_a', 'fullbody_b', 'torso_a', 'torso_b', 'push', 'pull'], slots: { push: 'triceps_overhead', pull: 'martillo', torso_b: 'triceps', fullbody_b: 'triceps', default: 'biceps' } },
}

/**
 * Lista negra del generador y del pool de reemplazos: olímpicos, combinados, máquinas raras,
 * variantes de riesgo o que no se pueden hacer solo. Se compara contra el nombre en inglés.
 */
export const LISTA_NEGRA = [
  'clean', 'snatch', 'jerk', 'guillotine', 'behind neck', 'behind the neck', 'upright row',
  'boxing', 'hook', 'jab', 'uppercut', 'balance board', 'bosu', 'stability ball', 'exercise ball',
  'roller', 'wheel', 'jump', 'plyo', 'kipping', 'archer', 'impossible', 'korean', 'gorilla',
  'skin the cat', 'pyramid', 'one arm chin', 'one arm push', 'one arm dip', '(male)', '(female)',
  'arm blaster', 'towel', 'potty', 'sissy', 'zercher', 'jefferson', 'speed squat', 'assisted ',
  'with throw', 'curl squat', 'squat curl', 'squatting', 'curl lunge', 'lunge with', 'with bicep curl',
  'with biceps curl', 'triceps extension lunge', 'to press', 'and press', 'to overhead', 'v. 2', 'v. 3',
  'stork', 'dragon', 'human flag', 'planche', 'muscle up', 'handstand',
]
// Los curados ya fueron elegidos a mano: la lista negra solo filtra el resto del catálogo
// (respaldo del generador y alternativas de "Reemplazar").
export function enListaNegra(ex) {
  if (!ex) return true
  if (PATRON_DE_ID[ex.id] || ESTIRAMIENTO_IDS.has(ex.id)) return false
  const n = ` ${String(ex.n || '').toLowerCase()} `
  return LISTA_NEGRA.some(kw => n.includes(kw))
}

/**
 * Estiramientos curados por músculo (slug de muscles.js). Todos sin compañero ni elementos.
 * - lados: true si se hace de a un lado (la duración es por lado).
 * - noCon: lesiones que lo desaconsejan (no se estira una zona lesionada sin indicación).
 */
export const ESTIRAMIENTOS = {
  chest: [{ id: '1271', noCon: ['hombros', 'pecho'] }],
  deltoids: [{ id: '0669', lados: true, noCon: ['hombros'] }],
  'upper-back': [{ id: '1346', noCon: ['hombros', 'espalda_alta'] }, { id: '1365', noCon: ['espalda_alta'] }],
  trapezius: [{ id: '1365', noCon: ['espalda_alta', 'cuello'] }],
  biceps: [{ id: 'sys_st_biceps', lados: true, noCon: ['biceps', 'hombros', 'codos'] }],
  triceps: [{ id: '0643', lados: true, noCon: ['triceps', 'hombros', 'codos'] }, { id: '0817', lados: true, noCon: ['triceps', 'codos'] }],
  forearm: [{ id: '0721', lados: true, noCon: ['antebrazos_munecas'] }],
  abs: [{ id: 'sys_st_abs', noCon: ['abdominales', 'espalda_baja'] }],
  'lower-back': [{ id: '1363', noCon: ['espalda_baja'] }],
  gluteal: [{ id: '1424', lados: true, noCon: ['gluteos'] }, { id: '2567', lados: true, noCon: ['gluteos'] }],
  quadriceps: [{ id: '0613', lados: true, noCon: ['cuadriceps', 'rodillas'] }, { id: '1512', lados: true, noCon: ['cuadriceps', 'rodillas'] }],
  'hip-flexors': [{ id: 'sys_st_hip_flexor', lados: true, noCon: ['rodillas', 'cuadriceps', 'espalda_baja'] }],
  hamstring: [{ id: '1511', noCon: ['isquiotibiales', 'espalda_baja'] }, { id: '1585', lados: true, noCon: ['isquiotibiales'] }],
  adductors: [{ id: '1494', noCon: ['aductores', 'rodillas'] }],
  calves: [{ id: '1377', lados: true, noCon: ['gemelos_tobillos'] }, { id: '1398', lados: true, noCon: ['gemelos_tobillos'] }],
}
export const ESTIRAMIENTO_IDS = new Set(Object.values(ESTIRAMIENTOS).flat().map(e => e.id))

/**
 * Lesiones. Cada zona dice qué se evita y qué se prefiere, en vez de sacar grupos enteros:
 * - patrones: patrones que no se programan (se prueba su sustituto).
 * - keywords: nombres (en inglés) que no se usan nunca con esta lesión.
 * - equipo: { patrón: [equipamientos a evitar] } (ej. press con barra con hombro lesionado).
 * - preferir: { patrón: [ids] } variantes más seguras, se ofrecen primero.
 * - bajoImpacto: el cardio va sin impacto (bici o elíptico; nada de trote, saltos ni HIIT de pie).
 * - sinHiit: sin intervalos de alta intensidad.
 * - notaEjercicio: { patrón: texto } nota que va en el ejercicio que sí se programa.
 * - nota: lo que se le explica al socio en el resumen.
 */
export const LESIONES = {
  hombros: {
    patrones: ['press_vertical', 'elevaciones_laterales'],
    keywords: ['overhead', 'military', 'arnold', 'dip', 'pull-up', 'chin-up', 'handstand', 'pike', 'lateral raise', 'behind'],
    equipo: { press_horizontal: ['barbell'], press_inclinado: ['barbell'], sentadilla: ['barbell'] },
    preferir: { press_horizontal: ['0577', '0289'], press_inclinado: ['1299', '0314'], sentadilla: ['0743', '0755', '1760'] },
    notaEjercicio: { press_horizontal: 'Por tu hombro: bajá solo hasta donde no moleste, codos a 45° del cuerpo.', press_inclinado: 'Por tu hombro: bajá solo hasta donde no moleste, codos a 45° del cuerpo.' },
    nota: 'Hombros: sin press por encima de la cabeza, elevaciones laterales, fondos ni barra en la espalda. El press de pecho va en máquina o con mancuernas, en un rango sin dolor.',
  },
  espalda_alta: {
    patrones: [],
    keywords: ['shrug', 'pull-up', 'chin-up', 'bent over row', 'deadlift'],
    equipo: { remo: ['barbell'] },
    preferir: { remo: ['1350', '0327', '0861'] },
    nota: 'Espalda alta: remos con apoyo o en máquina, sin dominadas, encogimientos ni peso muerto.',
  },
  espalda_baja: {
    patrones: ['bisagra'],
    keywords: ['deadlift', 'good morning', 'hyperextension', 'back extension', 'bent over row', 'sit-up', 'v-up', 'leg raise', 'superman', 'swing', 'pull through'],
    equipo: { sentadilla: ['barbell'], remo: ['barbell'], press_vertical: ['barbell'] },
    preferir: { sentadilla: ['0743', '0755'], remo: ['1350', '0327', '0861'], core: ['sys_plank', '0276'] },
    notaEjercicio: { prensa: 'Por tu espalda: no despegues la cadera del respaldo al bajar.', sentadilla: 'Por tu espalda: espalda neutra, sin redondear abajo.' },
    bajoImpacto: true,
    nota: 'Espalda baja: sin peso muerto ni sentadilla con barra en la espalda; piernas en máquina y zona media con plancha o dead bug. Cardio sin impacto.',
  },
  pecho: {
    patrones: ['press_horizontal', 'press_inclinado', 'aperturas'],
    keywords: ['dip', 'push-up', 'push up', 'pullover', 'fly'],
    nota: 'Pecho: sin press de pecho, aperturas ni fondos hasta que lo autorice un profesional.',
  },
  biceps: {
    patrones: ['biceps', 'martillo'],
    keywords: ['chin-up', 'biceps curl', 'barbell curl', 'hammer curl', 'preacher'],
    nota: 'Bíceps: sin curls ni dominadas supinas. Remos y jalones con peso moderado.',
  },
  triceps: {
    patrones: ['triceps', 'triceps_overhead'],
    keywords: ['dip', 'skull', 'close-grip', 'diamond', 'french press', 'triceps extension'],
    nota: 'Tríceps: sin extensiones de tríceps ni fondos. Los press, con peso moderado.',
  },
  codos: {
    patrones: ['triceps_overhead'],
    keywords: ['skull', 'lying triceps extension', 'french press', 'dip', 'close-grip', 'diamond', 'preacher', 'chin-up'],
    equipo: { press_horizontal: ['barbell'], biceps: ['barbell', 'ez barbell'] },
    preferir: { biceps: ['0313', '0165'] },
    nota: 'Codos: sin extensiones sobre la cabeza, fondos ni curl con barra; curl martillo y press con mancuernas o máquina.',
  },
  antebrazos_munecas: {
    patrones: [],
    keywords: ['push-up', 'push up', 'front squat', 'wrist', 'handstand', 'dip', 'pike'],
    equipo: { biceps: ['barbell', 'ez barbell'], press_horizontal: ['barbell'], press_inclinado: ['barbell'] },
    preferir: { biceps: ['0313', '0165'] },
    nota: 'Muñecas: sin flexiones ni barra; mancuernas con agarre neutro y máquinas.',
  },
  cuello: {
    patrones: [],
    keywords: ['shrug', 'behind', 'neck', 'upright row', 'crunch'],
    equipo: { sentadilla: ['barbell'] },
    nota: 'Cuello: sin encogimientos, sin barra apoyada en la espalda y sin crunch.',
  },
  abdominales: {
    patrones: ['core'],
    keywords: ['crunch', 'sit-up', 'v-up', 'plank', 'russian twist', 'leg raise', 'knee raise', 'rollout'],
    nota: 'Abdominales: sin ejercicios de zona media.',
  },
  gluteos: {
    patrones: ['hip_thrust', 'abduccion', 'zancada'],
    keywords: ['hip thrust', 'glute bridge', 'kickback', 'lunge', 'split squat', 'step-up', 'abduction'],
    nota: 'Glúteos: sin hip thrust, zancadas ni abducciones.',
  },
  cuadriceps: {
    patrones: ['sentadilla', 'zancada', 'extension_cuadriceps'],
    keywords: ['sprint', 'jump', 'pistol', 'lunge', 'squat', 'leg extension'],
    notaEjercicio: { prensa: 'Por tu lesión: peso liviano y solo en un rango sin dolor.' },
    bajoImpacto: true,
    nota: 'Cuádriceps: sin sentadillas, zancadas ni extensiones; prensa solo en un rango sin dolor. Cardio sin impacto.',
  },
  rodillas: {
    patrones: ['sentadilla', 'zancada', 'extension_cuadriceps'],
    keywords: ['jump', 'lunge', 'squat', 'step-up', 'step up', 'pistol', 'leg extension'],
    notaEjercicio: { prensa: 'Por tu rodilla: bajá solo hasta donde no moleste (no más de 90°).', curl_femoral: 'Por tu rodilla: peso moderado y sin dolor.' },
    bajoImpacto: true,
    nota: 'Rodillas: sin sentadilla libre, zancadas, saltos ni extensiones. La prensa va en un rango sin dolor. Cardio en bici o elíptico.',
  },
  isquiotibiales: {
    patrones: ['bisagra', 'curl_femoral'],
    keywords: ['deadlift', 'good morning', 'nordic', 'leg curl', 'sprint'],
    sinHiit: true,
    nota: 'Isquiotibiales: sin peso muerto ni curl femoral; sin sprints ni HIIT.',
  },
  aductores: {
    patrones: ['aduccion'],
    keywords: ['sumo', 'adductor', 'wide squat', 'lateral lunge', 'side split'],
    notaEjercicio: { sentadilla: 'Por tus aductores: pies al ancho de la cadera, sin abrir de más.' },
    nota: 'Aductores: sin sentadilla sumo, aductores ni zancadas laterales.',
  },
  gemelos_tobillos: {
    patrones: ['gemelos'],
    keywords: ['jump', 'skip', 'calf raise', ' run', 'sprint'],
    bajoImpacto: true,
    nota: 'Gemelos y tobillos: sin elevaciones de talones ni saltos. Cardio en bici.',
  },
}

/**
 * Cardio real para "Reemplazar": máquinas y opciones de casa. `impacto`: true si hay trote o
 * saltos (no se ofrece con lesiones de pierna o espalda baja). `casa`: se hace sin máquinas.
 */
export const CARDIO_OPCIONES = [
  { id: 'cardio_bike' }, { id: '2141' }, { id: '2331' }, { id: 'cardio_treadmill', impacto: true },
  { id: '3666' }, { id: 'cardio_stairmaster' }, { id: '2311' },
  { id: 'cardio_walk', casa: true }, { id: 'cardio_bodyweight_hiit', casa: true, impacto: true },
  { id: '2612', casa: true, impacto: true }, { id: '0630', casa: true, impacto: true },
]

/**
 * Cardio. Ids del catálogo y el texto que se muestra: siempre con ritmo explicado.
 */
export const CARDIO = {
  suave: { gym: 'cardio_bike', casa: 'cardio_walk', min: 20, speed: 0, nota: 'Ritmo suave: podés hablar sin agitarte.' },
  caminar: { gym: 'cardio_treadmill', casa: 'cardio_walk', min: 30, speed: 6, nota: 'Caminata rápida (5,5–6,5 km/h) o trote suave (7,5–9 km/h) si te sentís bien.' },
  hiit: { gym: 'cardio_bike', casa: 'cardio_bodyweight_hiit', min: 15, speed: 0, nota: '15 min: 30 s fuerte / 60 s suave. Empezá con 5 min suaves.' },
  bajoImpacto: { gym: 'cardio_bike', alt: '2141', casa: 'cardio_walk', nota: 'Sin impacto por tu lesión: bici o elíptico.' },
}
