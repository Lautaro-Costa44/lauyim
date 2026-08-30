/**
 * Tests del motor de generación de rutinas — v5
 */
import { describe, it, expect } from 'vitest'
import { generarRutina, rutinaGeneradaToRoutines, buildRoutineNames, derivarSplit, calcularCantidadEjercicios, filtrarPorPreferenciaEquipo, obtenerAlternativas } from './generarRutina.js'

const MOCK_DICT_ES = {
  bw001: 'Sentadilla con peso corporal',
  bw002: 'Puente de glúteos',
  bw003: 'Curl femoral tumbado',
  bw004: 'Elevación de talones',
  bw005: 'Abducción de cadera',
  bw006: 'Aducción de muslos',
  bw007: 'Flexiones en pica',
  bw008: 'Remo invertido',
  bw009: 'Flexiones diamante',
  bw010: 'Dominadas supinas',
  bw011: 'Sentadilla isométrica en pared',
  bw012: 'Plancha abdominal',
  bw013: 'Crunch invertido',
  bw014: 'Hiperextensiones',
  bw015: 'Dominadas',
  bw016: 'Fondos en banco',
  bw017: 'Flexiones inclinadas',
  bw018: 'Empuje de cadera a una pierna',
  bb001: 'Sentadilla con barra',
  bb002: 'Press de banca con barra',
  bb003: 'Peso muerto con barra',
  bb004: 'Remo con barra',
  bb005: 'Press militar con barra',
  db001: 'Press de banca con mancuernas',
  db002: 'Remo con mancuernas',
  cb001: 'Cruces de polea',
  cb002: 'Press de banca en máquina',
  cb003: 'Jalón al pecho',
  cb004: 'Extensiones de tríceps en polea',
  cb005: 'Remo en polea baja',
  fb001: 'Crunch en fitball',
  cardio_treadmill: 'Caminadora / Cinta de correr',
  cardio_bike: 'Bicicleta fija',
  cardio_stairmaster: 'Escaladora / Stairmaster',
  '1716': 'Estiramiento asistido de pectoral mayor',
  '1405': 'Estiramiento de espalda y pectorales',
  '1512': 'Estiramiento de cuádriceps',
}

const MOCK_DB = [
  { id: 'bw001', n: 'bodyweight squat', bp: 'upper legs', eq: 'body weight', tg: 'quads', mg: 'glutes', sm: ['glutes'] },
  { id: 'bw002', n: 'glute bridge', bp: 'upper legs', eq: 'body weight', tg: 'glutes', mg: 'hamstrings', sm: ['hamstrings'] },
  { id: 'bw003', n: 'lying leg curl', bp: 'upper legs', eq: 'body weight', tg: 'hamstrings', mg: 'glutes', sm: ['glutes'] },
  { id: 'bw004', n: 'calf raise', bp: 'lower legs', eq: 'body weight', tg: 'calves', mg: 'calves', sm: [] },
  { id: 'bw007', n: 'pike push up', bp: 'shoulders', eq: 'body weight', tg: 'delts', mg: 'triceps', sm: ['triceps'] },
  { id: 'bw015', n: 'pull up', bp: 'back', eq: 'body weight', tg: 'lats', mg: 'biceps', sm: ['biceps'] },
  { id: 'bb001', n: 'barbell squat', bp: 'upper legs', eq: 'barbell', tg: 'quads', mg: 'glutes', sm: ['glutes', 'hamstrings'] },
  { id: 'bb002', n: 'barbell bench press', bp: 'chest', eq: 'barbell', tg: 'pectorals', mg: 'triceps', sm: ['triceps', 'delts'] },
  { id: 'bb003', n: 'barbell deadlift', bp: 'upper legs', eq: 'barbell', tg: 'glutes', mg: 'hamstrings', sm: ['hamstrings', 'lats'] },
  { id: 'cb001', n: 'cable crossover', bp: 'chest', eq: 'cable', tg: 'pectorals', mg: 'triceps', sm: ['triceps'] },
  { id: 'cb002', n: 'lever bench press', bp: 'chest', eq: 'leverage machine', tg: 'pectorals', mg: 'triceps', sm: ['triceps'] },
  { id: 'cb003', n: 'cable pulldown', bp: 'back', eq: 'cable', tg: 'lats', mg: 'biceps', sm: ['biceps'] },
  { id: 'cb004', n: 'cable pushdown', bp: 'arms', eq: 'cable', tg: 'triceps', mg: 'triceps', sm: [] },
  { id: 'cb005', n: 'cable seated row', bp: 'back', eq: 'cable', tg: 'lats', mg: 'biceps', sm: ['biceps'] },
  { id: 'fb001', n: 'stability ball crunch', bp: 'waist', eq: 'stability ball', tg: 'abs', mg: 'abs', sm: [] },
]

const baseInput = {
  edad: 30,
  pesoKg: 70,
  objetivo: 'hipertrofia',
  nivel: 'intermedio',
  diasSeleccionados: ['lunes', 'miercoles', 'viernes'],
  tiempoPorSesion: '40-60',
  equipamiento: 'gimnasio_completo',
  preferenciaEjercicio: 'sin_preferencia',
  enfoque: 'balance',
  descansoSegundos: '90-120',
  tipoProgresion: 'doble_progresion',
  metricaEsfuerzo: 'rir',
  cardio: 'sin_cardio',
  movilidadEstiramientos: false,
  lesiones: [],
}

describe('generarRutina v5 — Requerimientos actualizados', () => {
  it('Requerimiento 1: Excluir peso corporal cuando se prefieren máquinas o pesos libres', () => {
    const r = generarRutina({ ...baseInput, preferenciaEjercicio: 'pesos_libres' }, MOCK_DB, MOCK_DICT_ES)
    const normales = r.dias.flatMap(d => d.ejercicios.filter(e => e.isNormal))
    const idsBodyweight = normales.map(e => e.id).filter(id => id.startsWith('bw'))
    expect(idsBodyweight.length).toBe(0)
  })

  it('Requerimiento 2: Respetar días exactos seleccionados', () => {
    const r = generarRutina(baseInput, MOCK_DB, MOCK_DICT_ES)
    const { week } = rutinaGeneradaToRoutines(r, baseInput)
    expect(week[1]).toBeDefined()
    expect(week[3]).toBeDefined()
    expect(week[5]).toBeDefined()
    expect(week[2]).toBeUndefined()
  })

  it('Nuevo split: pierna_prioridad cuando enfoque es piernas_gluteos', () => {
    const input = { ...baseInput, enfoque: 'piernas_gluteos', diasSeleccionados: ['lunes', 'miercoles', 'viernes'] }
    const r = generarRutina(input, MOCK_DB, MOCK_DICT_ES)
    expect(r.splitAsignado).toBe('pierna_prioridad')
  })

  it('Metadatos de esfuerzo y progresión presentes en ejercicios generados', () => {
    const input = { ...baseInput, metricaEsfuerzo: 'rpe', tipoProgresion: 'doble_progresion' }
    const r = generarRutina(input, MOCK_DB, MOCK_DICT_ES)
    const normal = r.dias[0].ejercicios.find(e => e.isNormal)
    expect(normal.metrica).toBe('rpe')
    expect(normal.valorEsfuerzo).toBe('8-9')
    expect(normal.progresion).toBe('doble_progresion')
  })

  it('filtrarPorPreferenciaEquipo exclamando fitball y stability ball cuando pide maquinas_poleas', () => {
    const filtrado = filtrarPorPreferenciaEquipo(MOCK_DB, 'maquinas_poleas')
    expect(filtrado.some(e => e.eq === 'stability ball')).toBe(false)
    expect(filtrado.every(e => ['leverage machine', 'cable', 'smith machine', 'assisted'].includes(e.eq))).toBe(true)
  })

  it('obtenerAlternativas sugiere ejercicios equivalentes con el mismo grupo objetivo', () => {
    const ejBench = { id: 'bb002', tg: 'pectorals' }
    const alts = obtenerAlternativas(ejBench, MOCK_DB, new Set(['bb002']), 3)
    expect(alts.length).toBeGreaterThan(0)
    expect(alts.every(e => e.tg === 'pectorals' && e.id !== 'bb002')).toBe(true)
  })
})
