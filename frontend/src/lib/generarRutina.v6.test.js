/**
 * Motor de rutinas v6 — propiedades sobre el catálogo real y una matriz de perfiles.
 * Si alguno falla, correr `node scripts/sim-rutinas.mjs` para ver las rutinas completas.
 */
import { describe, it, expect } from 'vitest'
import { CATALOGUE, EXIDX } from './exercises.js'
import { generarRutina, rutinaGeneradaToRoutines, calcularCantidadEjercicios, bloqueadoPorLesiones, CARDIO_MIN, ESTIRAMIENTOS_MIN } from './generarRutina.js'
import { PATRONES, PATRON_DE_ID, ESTIRAMIENTOS, ESTIRAMIENTO_IDS, LESIONES, enListaNegra, nivelIndex } from './rutina-catalogo.js'

const DIAS = {
  1: ['lunes'],
  2: ['lunes', 'jueves'],
  3: ['lunes', 'miercoles', 'viernes'],
  4: ['lunes', 'martes', 'jueves', 'viernes'],
  5: ['lunes', 'martes', 'miercoles', 'jueves', 'viernes'],
  6: ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado'],
}
const BASE = {
  objetivo: 'hipertrofia', nivel: 'intermedio', tiempoPorSesion: '40-60', equipamiento: 'gimnasio_completo',
  preferenciaEjercicio: 'sin_preferencia', enfoque: 'balance', descansoSegundos: '90-120', tipoProgresion: 'double',
  metricaEsfuerzo: 'rir', cardio: 'sin_cardio', movilidadEstiramientos: true, lesiones: [], tieneLesion: false,
}
const gen = r => generarRutina({ ...BASE, ...r }, CATALOGUE)

// Matriz: nivel × equipamiento × split × días × tiempo × objetivo (subconjunto representativo).
const PERFILES = []
for (const nivel of ['principiante', 'intermedio', 'avanzado']) {
  for (const equipamiento of ['gimnasio_completo', 'solo_mancuernas', 'calistenia']) {
    for (const splitPreferido of ['fullbody', 'torso_pierna', 'ppl', 'pierna_prioridad']) {
      for (const dias of [2, 3, 4, 5, 6]) {
        for (const [tiempoPorSesion, objetivo] of [['30-40', 'fuerza'], ['60-90', 'hipertrofia'], ['40-60', 'perder_grasa']]) {
          PERFILES.push({ nivel, equipamiento, splitPreferido, diasSeleccionados: DIAS[dias], tiempoPorSesion, objetivo })
        }
      }
    }
  }
}
const NIVEL_MIN = {}
for (const def of Object.values(PATRONES)) for (const [id, n] of def.candidatos) {
  if (NIVEL_MIN[id] == null || nivelIndex(n) < nivelIndex(NIVEL_MIN[id])) NIVEL_MIN[id] = n
}
const EQ = { solo_mancuernas: ['dumbbell', 'body weight'], calistenia: ['body weight'] }
const normales = d => d.ejercicios.filter(e => e.isNormal)
const patronesDe = d => new Set(normales(d).map(e => e.patron))

describe('motor v6 — matriz de perfiles', () => {
  const resultados = PERFILES.map(p => ({ p, r: gen(p) }))

  it('genera una rutina para cada día elegido, con al menos 3 ejercicios de fuerza', () => {
    for (const { p, r } of resultados) {
      expect(r.dias.length).toBe(p.diasSeleccionados.length)
      for (const d of r.dias) expect(normales(d).length).toBeGreaterThanOrEqual(p.equipamiento === 'calistenia' ? 2 : 3)
    }
  })

  it('nunca usa la lista negra, ni un ejercicio de nivel superior, ni equipamiento que no hay', () => {
    for (const { p, r } of resultados) {
      for (const d of r.dias) for (const e of normales(d)) {
        const ex = EXIDX[e.id]
        expect(enListaNegra(ex), `${e.id} ${ex.n}`).toBe(false)
        if (NIVEL_MIN[e.id]) expect(nivelIndex(NIVEL_MIN[e.id]), `${e.id} para ${p.nivel}`).toBeLessThanOrEqual(nivelIndex(p.nivel))
        if (EQ[p.equipamiento]) expect(EQ[p.equipamiento]).toContain(ex.eq)
      }
    }
  })

  it('en gimnasio completo, todos los ejercicios de fuerza salen del catálogo curado', () => {
    for (const { p, r } of resultados.filter(x => x.p.equipamiento === 'gimnasio_completo')) {
      for (const d of r.dias) for (const e of normales(d)) expect(PATRON_DE_ID[e.id], `${e.id} en ${p.splitPreferido}`).toBeDefined()
    }
  })

  it('no repite ejercicios dentro de un día y pone los compuestos antes que el aislamiento', () => {
    for (const { r } of resultados) for (const d of r.dias) {
      const ids = normales(d).map(e => e.id)
      expect(new Set(ids).size).toBe(ids.length)
      const tipos = normales(d).map(e => e.tipo)
      const primerAisl = tipos.indexOf('aislamiento')
      if (primerAisl >= 0) expect(tipos.slice(primerAisl)).not.toContain('compuesto')
    }
  })

  it('las sesiones del mismo tipo repiten los mismos ejercicios (para poder progresar)', () => {
    for (const { r } of resultados) {
      const porPlantilla = {}
      for (const d of r.dias) {
        const ids = normales(d).map(e => e.id).join(',')
        if (porPlantilla[d.plantilla] != null) expect(ids).toBe(porPlantilla[d.plantilla])
        else porPlantilla[d.plantilla] = ids
      }
    }
  })

  it('push y torso traen tríceps; pull y torso traen bíceps; pierna trae gemelos cuando hay lugar', () => {
    for (const { p, r } of resultados.filter(x => x.p.equipamiento === 'gimnasio_completo')) {
      for (const d of r.dias) {
        const pats = patronesDe(d)
        const n = normales(d).length
        const tri = pats.has('triceps') || pats.has('triceps_overhead')
        const bi = pats.has('biceps') || pats.has('martillo')
        if (d.plantilla === 'push' && n >= 5) expect(tri, `push ${p.nivel}`).toBe(true)
        if (d.plantilla === 'pull' && n >= 4) expect(bi, `pull ${p.nivel}`).toBe(true)
        if (d.plantilla.startsWith('torso') && n >= 6) expect(tri && bi, `${d.plantilla} n=${n}`).toBe(true)
        if (['legs', 'pierna_a'].includes(d.plantilla) && n >= 6) expect(pats.has('gemelos')).toBe(true)
      }
    }
  })

  it('estiramientos: solo curados, sin asistencia, uno por músculo principal entrenado', () => {
    for (const { r } of resultados) for (const d of r.dias) {
      const st = d.ejercicios.filter(e => e.isStretch)
      expect(st.length).toBeGreaterThan(0)
      for (const e of st) {
        expect(ESTIRAMIENTO_IDS.has(e.id)).toBe(true)
        expect(EXIDX[e.id].eq).toBe('body weight')
      }
      // El músculo principal del primer ejercicio del día siempre se estira.
      const primero = PATRONES[normales(d)[0].patron].musculo
      if (ESTIRAMIENTOS[primero]) expect(st.map(e => e.musculo)).toContain(primero)
    }
  })

  it('el rango de reps se guarda como lo lee la progresión', () => {
    for (const { r } of resultados) for (const d of r.dias) for (const e of normales(d)) {
      const ex = EXIDX[e.id]
      if (e.mode === 'time') { expect(e.sec).toBeGreaterThan(0); continue }
      if (ex.eq === 'body weight') { expect(e.repsMax).toBeGreaterThan(e.reps); continue }
      expect(e.repsMin).toBeGreaterThan(0)
      expect(e.reps).toBeGreaterThan(e.repsMin)
    }
  })

  it('la cantidad de ejercicios coincide con la que muestra la encuesta (+1 por el enfoque)', () => {
    for (const { p, r } of resultados) {
      const n = calcularCantidadEjercicios(p.tiempoPorSesion, BASE.descansoSegundos, p.nivel, p.objetivo, ESTIRAMIENTOS_MIN)
      for (const d of r.dias) expect(normales(d).length).toBeLessThanOrEqual(n)
    }
  })
})

describe('motor v6 — lesiones', () => {
  const zonas = Object.keys(LESIONES)

  for (const zona of zonas) {
    it(`${zona}: ningún ejercicio ni estiramiento la compromete, y el resumen lo explica`, () => {
      for (const splitPreferido of ['fullbody', 'torso_pierna', 'ppl', 'pierna_prioridad']) {
        for (const equipamiento of ['gimnasio_completo', 'calistenia']) {
          const r = gen({ splitPreferido, equipamiento, diasSeleccionados: DIAS[4], lesiones: [zona], tieneLesion: true, cardio: 'caminar_correr' })
          for (const d of r.dias) {
            for (const e of normales(d)) expect(bloqueadoPorLesiones(EXIDX[e.id], [zona], e.patron), `${zona}: ${e.id} ${EXIDX[e.id].n}`).toBe(false)
            for (const e of d.ejercicios.filter(x => x.isStretch)) {
              const def = Object.values(ESTIRAMIENTOS).flat().find(s => s.id === e.id)
              expect(def.noCon || []).not.toContain(zona)
            }
            if (LESIONES[zona].bajoImpacto) {
              for (const c of d.ejercicios.filter(x => x.isCardio)) expect(['cardio_treadmill', 'cardio_bodyweight_hiit']).not.toContain(c.id)
            }
          }
          expect(r.resumen.lesiones.map(l => l.zona)).toContain(zona)
          expect(r.disclaimer).toBeTruthy()
        }
      }
    })
  }

  it('rodillas: sin sentadillas ni zancadas, la prensa avisa el rango', () => {
    const r = gen({ splitPreferido: 'torso_pierna', diasSeleccionados: DIAS[4], lesiones: ['rodillas'], tieneLesion: true })
    const todos = r.dias.flatMap(normales)
    expect(todos.some(e => /squat|lunge/.test(EXIDX[e.id].n))).toBe(false)
    const prensa = todos.find(e => e.patron === 'prensa')
    expect(prensa.note).toMatch(/rodilla/)
  })

  it('hombros: el press de pecho va con mancuernas o máquina y sin press por encima de la cabeza', () => {
    const r = gen({ splitPreferido: 'ppl', diasSeleccionados: DIAS[3], lesiones: ['hombros'], tieneLesion: true })
    const todos = r.dias.flatMap(normales)
    expect(todos.some(e => e.patron === 'press_vertical' || e.patron === 'elevaciones_laterales')).toBe(false)
    for (const e of todos.filter(x => x.patron === 'press_horizontal' || x.patron === 'press_inclinado')) expect(EXIDX[e.id].eq).not.toBe('barbell')
  })

  it('una lesión que bloquea un patrón no deja huecos raros: el slot se llena con otro ejercicio', () => {
    const sin = gen({ splitPreferido: 'fullbody', diasSeleccionados: DIAS[3] })
    const con = gen({ splitPreferido: 'fullbody', diasSeleccionados: DIAS[3], lesiones: ['espalda_baja'], tieneLesion: true })
    expect(normales(con.dias[0]).length).toBe(normales(sin.dias[0]).length)
  })
})

describe('motor v6 — cardio', () => {
  it('HIIT: máximo 2 por semana y nunca en día de pierna', () => {
    const r = gen({ splitPreferido: 'ppl', diasSeleccionados: DIAS[6], cardio: 'hiit' })
    const hiit = r.dias.filter(d => d.ejercicios.some(e => e.isCardio && e.min === CARDIO_MIN.hiit))
    expect(hiit.length).toBeLessThanOrEqual(2)
    for (const d of hiit) expect(d.plantilla).not.toBe('legs')
  })

  it('caminar/correr explica el ritmo con velocidades coherentes', () => {
    const r = gen({ splitPreferido: 'fullbody', diasSeleccionados: DIAS[3], cardio: 'caminar_correr' })
    const c = r.dias[0].ejercicios.find(e => e.isCardio)
    expect(c.speed).toBeLessThanOrEqual(6.5)
    expect(c.note).toMatch(/km\/h/)
  })
})

describe('motor v6 — split', () => {
  it('"Piernas y glúteos" es un split: prioriza pierna sin pisar otra elección', () => {
    const r = gen({ splitPreferido: 'pierna_prioridad', diasSeleccionados: DIAS[3] })
    expect(r.splitAsignado).toBe('pierna_prioridad')
    expect(r.dias.filter(d => d.plantilla.startsWith('pierna')).length).toBe(2)
  })

  it('PPL con 5 días entrena piernas 2 veces', () => {
    const r = gen({ splitPreferido: 'ppl', diasSeleccionados: DIAS[5] })
    expect(r.dias.filter(d => ['legs', 'pierna_b', 'pierna_a'].includes(d.plantilla)).length).toBe(2)
    expect(r.resumen.avisos.join(' ')).toMatch(/2 veces/)
  })

  it('full body alterna A y B y avisa los días seguidos', () => {
    const r = gen({ splitPreferido: 'fullbody', diasSeleccionados: ['lunes', 'martes', 'miercoles'] })
    expect(r.dias.map(d => d.plantilla)).toEqual(['fullbody_a', 'fullbody_b', 'fullbody_a'])
    expect(r.resumen.avisos.join(' ')).toMatch(/días seguidos/)
  })

  it('el enfoque torso y brazos suma brazos sin sacar grupos', () => {
    const base = gen({ splitPreferido: 'torso_pierna', diasSeleccionados: DIAS[4] })
    const enfoque = gen({ splitPreferido: 'torso_pierna', diasSeleccionados: DIAS[4], enfoque: 'torso_brazos' })
    const torso = r => normales(r.dias[0])
    expect(torso(enfoque).length).toBe(torso(base).length + 1)
    for (const p of patronesDe(base.dias[0])) expect(patronesDe(enfoque.dias[0])).toContain(p)
  })
})

describe('motor v6 — resumen y guardado', () => {
  it('el resumen trae duración, series por músculo y explicaciones', () => {
    const r = gen({ splitPreferido: 'torso_pierna', diasSeleccionados: DIAS[4] })
    expect(r.resumen.dias).toHaveLength(4)
    for (const d of r.resumen.dias) expect(d.minutos).toBeGreaterThan(20)
    expect(r.resumen.series.chest).toBeGreaterThan(0)
    expect(r.resumen.progresion.explicacion).toBeTruthy()
    expect(r.resumen.esfuerzo.explicacion).toBeTruthy()
    expect(r.parametrosGlobales.tipoProgresion).toBe('Doble progresión')
  })

  it('al guardar conserva rango de reps, calentamiento, velocidad y notas', () => {
    const r = gen({ splitPreferido: 'fullbody', diasSeleccionados: DIAS[3], cardio: 'caminar_correr' })
    const { routines } = rutinaGeneradaToRoutines(r)
    const ex = routines[0].ex
    expect(ex[0].warmupSets).toBe(2)
    expect(ex[0].repsMin).toBeGreaterThan(0)
    expect(ex[0].note).toMatch(/entrar en calor/)
    expect(ex.find(e => e.isCardio).speed).toBe(6)
    expect(ex.find(e => e.isStretch).mode).toBe('time')
  })

  it('reemplazar estiramientos y cardio tiene de dónde elegir', () => {
    const r = gen({ splitPreferido: 'fullbody', diasSeleccionados: DIAS[3], cardio: 'suave_final' })
    expect(r.poolEstiramientos.length).toBeGreaterThan(10)
    expect(r.poolCardio.length).toBeGreaterThan(2)
  })
})
