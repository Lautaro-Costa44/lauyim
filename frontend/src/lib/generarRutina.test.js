/**
 * Tests del motor de generación de rutinas — v3 (correcciones.md)
 */
import { describe, it, expect } from 'vitest'
import { generarRutina, rutinaGeneradaToRoutines, buildRoutineNames } from './generarRutina.js'

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
  // Sin traducción a propósito:
  // untranslated01: no existe en MOCK_DICT_ES
}

const MOCK_DB = [
  { id: 'bw001', n: 'bodyweight squat', bp: 'upper legs', eq: 'body weight', tg: 'quads', mg: 'glutes', sm: ['glutes'] },
  { id: 'bw002', n: 'glute bridge', bp: 'upper legs', eq: 'body weight', tg: 'glutes', mg: 'hamstrings', sm: ['hamstrings'] },
  { id: 'bw003', n: 'lying leg curl', bp: 'upper legs', eq: 'body weight', tg: 'hamstrings', mg: 'glutes', sm: ['glutes'] },
  { id: 'bw004', n: 'calf raise', bp: 'lower legs', eq: 'body weight', tg: 'calves', mg: 'calves', sm: [] },
  { id: 'bw005', n: 'hip abduction', bp: 'upper legs', eq: 'body weight', tg: 'abductors', mg: 'glutes', sm: [] },
  { id: 'bw006', n: 'inner thigh squeeze', bp: 'upper legs', eq: 'body weight', tg: 'adductors', mg: 'adductors', sm: [] },
  { id: 'bw007', n: 'pike push up', bp: 'shoulders', eq: 'body weight', tg: 'delts', mg: 'triceps', sm: ['triceps'] },
  { id: 'bw008', n: 'inverted row', bp: 'back', eq: 'body weight', tg: 'upper back', mg: 'biceps', sm: ['biceps'] },
  { id: 'bw009', n: 'diamond push up', bp: 'chest', eq: 'body weight', tg: 'triceps', mg: 'pectorals', sm: ['pectorals'] },
  { id: 'bw010', n: 'chin up', bp: 'back', eq: 'body weight', tg: 'lats', mg: 'biceps', sm: ['biceps'] },
  { id: 'bw011', n: 'isometric wall sit', bp: 'upper legs', eq: 'body weight', tg: 'quads', mg: 'glutes', sm: ['glutes'] },
  { id: 'bw012', n: 'plank hold', bp: 'waist', eq: 'body weight', tg: 'abs', mg: 'spine', sm: [] },
  { id: 'bw013', n: 'reverse crunch', bp: 'waist', eq: 'body weight', tg: 'abs', mg: 'spine', sm: [] },
  { id: 'bw014', n: 'back extension', bp: 'waist', eq: 'body weight', tg: 'spine', mg: 'glutes', sm: ['glutes'] },
  { id: 'bw015', n: 'pull up', bp: 'back', eq: 'body weight', tg: 'lats', mg: 'biceps', sm: ['biceps'] },
  { id: 'bw016', n: 'dip bench', bp: 'upper arms', eq: 'body weight', tg: 'triceps', mg: 'pectorals', sm: [] },
  { id: 'bw017', n: 'incline push up', bp: 'chest', eq: 'body weight', tg: 'pectorals', mg: 'triceps', sm: ['triceps'] },
  { id: 'bw018', n: 'single leg hip thrust', bp: 'upper legs', eq: 'body weight', tg: 'glutes', mg: 'hamstrings', sm: [] },
  { id: 'bb001', n: 'barbell squat', bp: 'upper legs', eq: 'barbell', tg: 'quads', mg: 'glutes', sm: ['glutes', 'hamstrings'] },
  { id: 'bb002', n: 'barbell bench press', bp: 'chest', eq: 'barbell', tg: 'pectorals', mg: 'triceps', sm: ['triceps', 'delts'] },
  { id: 'bb003', n: 'barbell deadlift', bp: 'upper legs', eq: 'barbell', tg: 'glutes', mg: 'hamstrings', sm: ['hamstrings', 'lats'] },
  { id: 'bb004', n: 'barbell row', bp: 'back', eq: 'barbell', tg: 'lats', mg: 'upper back', sm: ['upper back', 'biceps'] },
  { id: 'bb005', n: 'overhead press', bp: 'shoulders', eq: 'barbell', tg: 'delts', mg: 'triceps', sm: ['triceps'] },
  // Ejercicio sin traducción para probar QA 6.4:
  { id: 'untranslated01', n: 'astride jumps (male)', bp: 'cardio', eq: 'body weight', tg: 'cardiovascular system' },
  // Ejercicio raro para probar §5.4:
  { id: 'rare01', n: 'bosu ball squat on wheel (female)', bp: 'upper legs', eq: 'body weight', tg: 'quads' },
]

const baseInput = {
  objetivo: 'fitness_general',
  tieneLesion: false,
  lesiones: [],
  diasSeleccionados: ['lunes', 'miercoles', 'viernes'],
  tiempoPorSesion: '30-40',
  nivel: 'intermedio',
  equipamiento: 'gimnasio_completo',
  preferenciaEjercicio: 'sin_preferencia',
  enfoque: 'balance',
  cardio: 'hiit',
  movilidadEstiramientos: true,
  edad: 28,
  pesoKg: 75,
  descansoSegundos: '60',
  tipoProgresion: 'lineal',
  metricaEsfuerzo: 'rir',
}

describe('generarRutina v3 — Correcciones QA', () => {
  it('Bug QA 6.3: Cardio NUNCA aparece dentro de ejercicios[]', () => {
    const r = generarRutina(baseInput, MOCK_DB, MOCK_DICT_ES)
    for (const dia of r.dias) {
      expect(dia.cardio).toBeDefined()
      expect(dia.cardio.tipo).toBe('hiit')
      expect(dia.cardio.duracionMin).toBe(15)
      // Verificar que ningún ejercicio del array de fuerza tenga id de cardio o note de cardio
      for (const ej of dia.ejercicios) {
        expect(ej.exerciseId).not.toBe('cardio_custom')
      }
    }
  })

  it('Bug QA 6.4: Descarta ejercicios sin traducción en el diccionario español', () => {
    const r = generarRutina(baseInput, MOCK_DB, MOCK_DICT_ES)
    const todosIds = r.dias.flatMap(d => d.ejercicios.map(e => e.exerciseId))
    expect(todosIds).not.toContain('untranslated01')
  })

  it('Filtro 5.4: Pruning de ejercicios raros o con male/female/bosu', () => {
    const r = generarRutina(baseInput, MOCK_DB, MOCK_DICT_ES)
    const todosIds = r.dias.flatMap(d => d.ejercicios.map(e => e.exerciseId))
    expect(todosIds).not.toContain('rare01')
  })

  it('Filtro 6.1: Slots por tiempo recalculados (30-40 min = 4 ejercicios)', () => {
    const r = generarRutina({ ...baseInput, tiempoPorSesion: '30-40' }, MOCK_DB, MOCK_DICT_ES)
    for (const dia of r.dias) {
      expect(dia.ejercicios.length).toBeLessThanOrEqual(4)
      expect(dia.ejercicios[0].series).toBe(3)
    }
  })

  it('Sección 8: Genera parametrosGlobales recomendados', () => {
    const r = generarRutina(baseInput, MOCK_DB, MOCK_DICT_ES)
    expect(r.parametrosGlobales).toBeDefined()
    expect(r.parametrosGlobales.descansoRecomendado).toContain('segundos')
    expect(r.parametrosGlobales.tipoProgresion).toBeDefined()
    expect(r.parametrosGlobales.metricaEsfuerzo).toBeDefined()
  })

  it('Ampliación de lesiones: codos excluye bench press pesado', () => {
    const input = {
      ...baseInput,
      tieneLesion: true,
      lesiones: ['codos'],
    }
    const r = generarRutina(input, MOCK_DB, MOCK_DICT_ES)
    const todosIds = r.dias.flatMap(d => d.ejercicios.map(e => e.exerciseId))
    expect(todosIds).not.toContain('bb002') // barbell bench press
  })

  it('Ampliación de lesiones: isquiotibiales excluye hamstrings', () => {
    const input = {
      ...baseInput,
      tieneLesion: true,
      lesiones: ['isquiotibiales'],
    }
    const r = generarRutina(input, MOCK_DB, MOCK_DICT_ES)
    const todosIds = r.dias.flatMap(d => d.ejercicios.map(e => e.exerciseId))
    expect(todosIds).not.toContain('bw003') // lying leg curl
  })
})
