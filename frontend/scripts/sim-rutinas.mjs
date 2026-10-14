#!/usr/bin/env node
// Imprime las rutinas que genera la encuesta para una serie de perfiles, en texto legible,
// para revisarlas a ojo antes de mergear un cambio del motor (spec módulo 4, §4.6).
//
//   node scripts/sim-rutinas.mjs              todos los perfiles
//   node scripts/sim-rutinas.mjs rodillas     solo los perfiles cuyo nombre contiene "rodillas"

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }

const { CATALOGUE, EXIDX } = await import('../src/lib/exercises.js')
const { generarRutina } = await import('../src/lib/generarRutina.js')
const { default: es } = await import('../src/locales/exercise-names-es.js')

const D3 = ['lunes', 'miercoles', 'viernes']
const D4 = ['lunes', 'martes', 'jueves', 'viernes']
const D5 = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes']
const PERFILES = [
  ['principiante full body 3 días', { nivel: 'principiante', diasSeleccionados: D3, splitPreferido: 'fullbody' }],
  ['intermedio torso/pierna 4 días 60-90', { diasSeleccionados: D4, splitPreferido: 'torso_pierna', tiempoPorSesion: '60-90' }],
  ['avanzado PPL 5 días fuerza HIIT', { nivel: 'avanzado', objetivo: 'fuerza', diasSeleccionados: D5, splitPreferido: 'ppl', cardio: 'hiit' }],
  ['piernas y glúteos 3 días máquinas 30-40', { diasSeleccionados: D3, splitPreferido: 'pierna_prioridad', tiempoPorSesion: '30-40', preferenciaEjercicio: 'maquinas_poleas' }],
  ['calistenia principiante 3 días', { nivel: 'principiante', equipamiento: 'calistenia', diasSeleccionados: D3, splitPreferido: 'fullbody', cardio: 'hiit' }],
  ['solo mancuernas perder grasa', { objetivo: 'perder_grasa', equipamiento: 'solo_mancuernas', diasSeleccionados: D3, splitPreferido: 'fullbody', cardio: 'suave_final' }],
  ['lesión rodillas + espalda baja', { lesiones: ['rodillas', 'espalda_baja'], diasSeleccionados: D3, splitPreferido: 'fullbody', cardio: 'caminar_correr' }],
  ['lesión hombros torso y brazos', { lesiones: ['hombros'], enfoque: 'torso_brazos', diasSeleccionados: D4, splitPreferido: 'torso_pierna' }],
]
const BASE = {
  objetivo: 'hipertrofia', nivel: 'intermedio', tiempoPorSesion: '40-60', equipamiento: 'gimnasio_completo',
  preferenciaEjercicio: 'sin_preferencia', enfoque: 'balance', descansoSegundos: '90-120', tipoProgresion: 'double',
  metricaEsfuerzo: 'rir', cardio: 'sin_cardio', movilidadEstiramientos: true,
}

const nombre = id => es[id] || EXIDX[id]?.n || id
const filtro = (process.argv[2] || '').toLowerCase()

for (const [titulo, perfil] of PERFILES) {
  if (filtro && !titulo.toLowerCase().includes(filtro)) continue
  const r = generarRutina({ ...BASE, ...perfil, tieneLesion: !!perfil.lesiones?.length }, CATALOGUE)
  console.log(`\n## ${titulo} → ${r.splitAsignado}`)
  for (const a of r.resumen.avisos) console.log(`   aviso: ${a}`)
  for (const l of r.resumen.lesiones) console.log(`   lesión: ${l.nota}`)
  console.log(`   series/semana: ${Object.entries(r.resumen.series).map(([m, n]) => `${m} ${n}`).join(', ')}`)
  for (const d of r.dias) {
    console.log(`\n   ${d.diaLabel} (~${d.minutos} min)`)
    for (const e of d.ejercicios) {
      const detalle = e.isStretch ? `${e.sec} s${e.note ? ' ' + e.note.toLowerCase() : ''}`
        : e.isCardio ? `${e.min} min — ${e.note}`
          : e.mode === 'time' ? `${e.sets} × ${e.sec} s`
            : `${e.sets} × ${e.repeticiones}${e.warmupSets ? ` (+${e.warmupSets} de calentamiento)` : ''}`
      const nota = e.isNormal && e.note ? `   · ${e.note}` : ''
      console.log(`     - ${nombre(e.id)}: ${detalle}${nota}`)
    }
  }
}
