import exerciseNamesEs from '../locales/exercise-names-es.js'

export const DAY_MAP = {
  domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6,
}
export const DAY_NAMES_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado']
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0]

export function defaultSplitRecomendado(nivel, dias, genero = 'hombre') {
  if (genero === 'mujer' && dias >= 3) return 'gluteos_piernas'
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

export function derivarSplit(nivel, dias, splitPreferido, genero = 'hombre') {
  if (dias === 1) {
    return { split: 'fullbody', splitAjustado: splitPreferido && splitPreferido !== 'fullbody' }
  }
  const split = splitPreferido || defaultSplitRecomendado(nivel, dias, genero)
  let avisoFrecuencia
  if (split === 'ppl' && dias <= 3) {
    avisoFrecuencia = 'Con 3 días, PPL entrena cada músculo 1 vez por semana. Para más frecuencia, sugerimos Full Body o Glúteos Focus.'
  }
  return { split, splitAjustado: Boolean(splitPreferido && splitPreferido !== split), avisoFrecuencia }
}

function jerarquiaEjercicio(n = '', eq = '', tg = '') {
  const nl = n.toLowerCase()
  if (nl.includes('squat') || nl.includes('deadlift') || nl.includes('bench press') || 
      nl.includes('overhead press') || nl.includes('hip thrust') || nl.includes('barbell row') || nl.includes('pull up')) {
    return 1
  }
  if (nl.includes('press') || nl.includes('lunge') || nl.includes('pulldown') || nl.includes('dip') || eq.includes('machine') || eq.includes('cable')) {
    return 2
  }
  return 3
}

export function buildRoutineNames(split, totalDias, genero = 'hombre') {
  const nombres = []

  if (split === 'gluteos_piernas') {
    const cicloMujer = [
      { base: 'Glúteos & Cuádriceps', grupos: ['glutes', 'quads', 'adductors', 'abs'] },
      { base: 'Torso & Glúteos Aislamiento', grupos: ['pectorals', 'lats', 'delts', 'glutes', 'triceps', 'biceps'] },
      { base: 'Glúteos & Cadena Posterior', grupos: ['glutes', 'hamstrings', 'calves', 'abductors'] },
      { base: 'Full Body & Glutes Focus', grupos: ['quads', 'glutes', 'lats', 'delts', 'hamstrings'] },
    ]

    const cicloHombre = [
      { base: 'Glúteos, Piernas & Pecho', grupos: ['glutes', 'quads', 'pectorals', 'abs'] },
      { base: 'Torso Completo (Empuje & Tracción)', grupos: ['pectorals', 'lats', 'delts', 'biceps', 'triceps'] },
      { base: 'Glúteos, Isquios & Espalda', grupos: ['glutes', 'hamstrings', 'lats', 'upper back'] },
      { base: 'Piernas Focus & Hombros', grupos: ['glutes', 'quads', 'delts', 'calves', 'abs'] },
    ]

    const ciclo = genero === 'hombre' ? cicloHombre : cicloMujer

    for (let i = 0; i < totalDias; i++) {
      const c = ciclo[i % ciclo.length]
      nombres.push({ rutinaNombre: c.base, grupos: c.grupos })
    }
    return nombres
  }

  if (split === 'fullbody') {
    const GRUPOS = ['pectorals', 'lats', 'quads', 'hamstrings', 'glutes', 'delts', 'triceps', 'biceps', 'abs']
    for (let i = 0; i < totalDias; i++) {
      nombres.push({ rutinaNombre: `Full Body ${i + 1}`, grupos: GRUPOS })
    }
  } else if (split === 'torso_pierna') {
    for (let i = 0; i < totalDias; i++) {
      const esTorso = i % 2 === 0
      const vuelta = Math.floor(i / 2) + 1
      nombres.push({
        rutinaNombre: esTorso ? `Torso ${vuelta}` : `Pierna ${vuelta}`,
        grupos: esTorso ? ['pectorals', 'lats', 'delts', 'triceps', 'biceps', 'upper back'] : ['quads', 'hamstrings', 'glutes', 'calves', 'adductors']
      })
    }
  } else {
    const ciclo = [
      { base: 'Push (Empuje)', grupos: ['pectorals', 'delts', 'triceps'] },
      { base: 'Pull (Tracción)', grupos: ['lats', 'upper back', 'biceps'] },
      { base: 'Legs (Pierna & Glúteos)', grupos: ['quads', 'hamstrings', 'glutes', 'calves'] },
    ]
    for (let i = 0; i < totalDias; i++) {
      const c = ciclo[i % 3]
      nombres.push({ rutinaNombre: c.base, grupos: c.grupos })
    }
  }
  return nombres
}

export function obtenerAlternativas(exerciseId, poolSeguro, count = 3) {
  const exActual = poolSeguro.find(e => e.id === exerciseId)
  if (!exActual) return []

  const similares = poolSeguro.filter(e => 
    e.id !== exerciseId && (e.tg === exActual.tg || e.bp === exActual.bp)
  )

  const exactamenteMismoTg = similares.filter(e => e.tg === exActual.tg)
  const listaBase = exactamenteMismoTg.length >= count ? exactamenteMismoTg : similares

  return listaBase.slice(0, count).map(e => ({
    id: e.id,
    n: e.n,
    eq: e.eq,
    tg: e.tg,
  }))
}

export function generarRutina(respuestas, exerciseDB, dictEs = exerciseNamesEs) {
  const {
    objetivo = 'fitness_general',
    genero = 'hombre',
    diasSeleccionados = [],
    diasPorSemana: rawDias,
    tiempoPorSesion = '40-60',
    nivel = 'intermedio',
    cardio = 'sin_cardio',
    splitPreferido,
    movilidadEstiramientos = false,
  } = respuestas

  const totalDias = diasSeleccionados.length || rawDias || 3
  const { split, splitAjustado, avisoFrecuencia } = derivarSplit(nivel, totalDias, splitPreferido, genero)

  const poolSeguro = exerciseDB.filter(ex => dictEs[ex.id])
  const routineConfigs = buildRoutineNames(split, totalDias, genero)

  const nEjerciciosFuerza = tiempoPorSesion === '30-40' ? 4 : tiempoPorSesion === '40-60' ? 5 : tiempoPorSesion === '60-90' ? 6 : 7
  const nSeries = tiempoPorSesion === '30-40' ? 3 : 4

  const dias = routineConfigs.map((cfg, i) => {
    let seleccionados = poolSeguro
      .filter(e => cfg.grupos.includes(e.tg))
      .slice(0, nEjerciciosFuerza)

    seleccionados.sort((a, b) => jerarquiaEjercicio(a.n, a.eq, a.tg) - jerarquiaEjercicio(b.n, b.eq, b.tg))

    return {
      diaLabel: `Día ${i + 1} — ${cfg.rutinaNombre}`,
      rutinaNombre: cfg.rutinaNombre,
      ejercicios: seleccionados.map(s => ({
        exerciseId: s.id,
        series: nSeries,
        repeticiones: objetivo === 'fuerza' ? '3-6' : '8-12',
      })),
      cardio: cardio !== 'sin_cardio' ? { tipo: cardio, duracionMin: 15 } : null,
      movilidad: movilidadEstiramientos ? { duracionMin: 8, descripcion: 'Estiramientos estáticos y movilidad' } : null,
    }
  })

  return {
    splitAsignado: split,
    splitAjustado,
    avisoFrecuencia,
    dias,
  }
}

export function rutinaGeneradaToRoutines(rutinaGenerada) {
  const routines = rutinaGenerada.dias.map((dia, i) => {
    const ejercicios = dia.ejercicios.map(ej => {
      const repsRaw = ej.repeticiones || '10'
      const reps = parseInt(repsRaw.split('-')[0], 10) || 10
      return {
        id: ej.exerciseId,
        sets: ej.series,
        reps,
        weight: 0,
      }
    })

    return {
      id: 'gen_' + Date.now() + '_' + i,
      name: dia.rutinaNombre,
      emoji: dia.rutinaNombre.includes('Legs') || dia.rutinaNombre.includes('Pierna')
        ? 'legs'
        : dia.rutinaNombre.includes('Pull') || dia.rutinaNombre.includes('Tracción')
        ? 'pullup'
        : 'dumbbell',
      ex: ejercicios,
    }
  })

  const week = {}
  for (let i = 0; i < rutinaGenerada.dias.length; i++) {
    const diaSemana = rutinaGenerada.dias[i].diaSemana !== undefined ? rutinaGenerada.dias[i].diaSemana : i % 7
    if (routines[i]) {
      week[diaSemana] = routines[i].id
    }
  }

  return { routines, week }
}