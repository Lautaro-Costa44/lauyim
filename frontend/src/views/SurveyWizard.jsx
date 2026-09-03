import { useNavigate } from 'react-router-dom'
import { useState, useMemo, useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { CATALOGUE, EXIDX } from '../lib/exercises.js'
import { generarRutina, rutinaGeneradaToRoutines, defaultSplitRecomendado, derivarSplit } from '../lib/generarRutina.js'
import { todayISO } from '../lib/format.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { POLICIES, POLICY_NAME, POLICY_DESC } from '../lib/progression.js'
import { confirmSheet, exerciseDetailSheetNoAdd } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import ExerciseReplacementSheet from '../components/ExerciseReplacementSheet.jsx'

const PASOS = 5

const DIAS_OPCIONES = [
  { key: 'lunes', label: 'Lun', index: 1 },
  { key: 'martes', label: 'Mar', index: 2 },
  { key: 'miercoles', label: 'Mié', index: 3 },
  { key: 'jueves', label: 'Jue', index: 4 },
  { key: 'viernes', label: 'Vie', index: 5 },
  { key: 'sabado', label: 'Sáb', index: 6 },
  { key: 'domingo', label: 'Dom', index: 0 },
]

const OPT = {
  sexoBiologico: [
    { value: 'masculino', label: 'Masculino' },
    { value: 'femenino', label: 'Femenino' },
  ],
  objetivo: [
    { value: 'hipertrofia',     label: 'Ganar músculo',     sub: 'Volumen + progresión en cargas' },
    { value: 'fuerza',          label: 'Ganar fuerza',       sub: 'Compuestos pesados, pocas reps' },
    { value: 'perder_grasa',    label: 'Perder grasa',       sub: 'Misma base + más cardio' },
    { value: 'fitness_general', label: 'Fitness general',    sub: 'Rutina completa y equilibrada' },
  ],
  nivel: [
    { value: 'principiante', label: 'Principiante', sub: 'Menos de 1 año entrenando' },
    { value: 'intermedio',   label: 'Intermedio',   sub: '1–3 años de entrenamiento' },
    { value: 'avanzado',     label: 'Avanzado',     sub: 'Más de 3 años de entrenamiento' },
  ],
  tiempoPorSesion: [
    { value: '30-40', label: '30–40 min', sub: '4 ejercicios por sesión' },
    { value: '40-60', label: '40–60 min', sub: '5 ejercicios por sesión' },
    { value: '60-90', label: '60–90 min', sub: '6 ejercicios por sesión' },
    { value: '90+',   label: '90+ min',   sub: '7 ejercicios por sesión' },
  ],
  splitPreferido: [
    { value: 'fullbody',     label: 'Full Body',          sub: 'Todo el cuerpo en cada sesión' },
    { value: 'torso_pierna', label: 'Torso / Pierna',     sub: 'Un día tren superior, un día inferior' },
    { value: 'ppl',          label: 'Push / Pull / Legs', sub: 'Empuje, Tracción y Pierna' },
    { value: 'pierna_prioridad', label: 'Piernas y Glúteos', sub: 'Énfasis en tren inferior' },
  ],
  equipamiento: [
    { value: 'gimnasio_completo', label: 'Gimnasio completo', sub: 'Máquinas, poleas, barras, mancuernas…' },
    { value: 'solo_mancuernas',   label: 'Solo mancuernas',   sub: 'Mancuernas + peso corporal' },
    { value: 'calistenia',        label: 'Calistenia / Casa', sub: 'Solo con el peso del cuerpo' },
  ],
  preferenciaEjercicio: [
    { value: 'maquinas_poleas', label: 'Máquinas y poleas',  sub: 'Más control, ideal para aislar' },
    { value: 'pesos_libres',    label: 'Pesos libres',       sub: 'Barras y mancuernas' },
    { value: 'sin_preferencia', label: 'Sin preferencia',    sub: 'Mezcla balanceada de todo' },
  ],
  enfoque: [
    { value: 'balance',         label: 'Cuerpo completo',    sub: 'Distribución equilibrada' },
    { value: 'piernas_gluteos', label: 'Piernas y glúteos',  sub: '+30% volumen en tren inferior' },
    { value: 'torso_brazos',    label: 'Torso y brazos',     sub: '+30% volumen en tren superior' },
  ],
  descansoSegundos: [
    { value: '60',     label: '60 segundos',   sub: 'Ritmo ágil y dinámico' },
    { value: '90-120', label: '90–120 segundos', sub: 'Estándar para hipertrofia' },
    { value: '180+',   label: '180+ segundos', sub: 'Fuerza pesada y máxima recuperación' },
  ],
  tipoProgresion: [
    { value: 'linear',           label: 'Progresión lineal',       sub: 'Subir peso set a set' },
    { value: 'double',           label: 'Doble progresión',        sub: 'Primero reps, luego peso' },
    { value: 'dup',              label: 'Ondulante (DUP)',         sub: 'Variar intensidad por día' },
  ],
  metricaEsfuerzo: [
    { value: 'rir', label: 'RIR (Reps en reserva)', sub: 'RIR 1-2 (dejar 1 o 2 reps antes del fallo)' },
    { value: 'rpe', label: 'RPE (Esfuerzo percibido)', sub: 'RPE 8-9 (escala del 1 al 10)' },
  ],
  cardio: [
    { value: 'sin_cardio',     label: 'Sin cardio' },
    { value: 'suave_final',    label: 'Cardio suave al final', sub: '15–20 min de bici, cinta o elíptica' },
    { value: 'hiit',           label: 'HIIT',                  sub: '15 min de intervalos de alta intensidad' },
    { value: 'caminar_correr', label: 'Caminar / Correr',      sub: '30 min de caminata rápida o trote' },
  ],
  // Requerimiento 7 — Lista completa de lesiones anatomía PWA
  lesiones: [
    { value: 'hombros',           label: 'Hombros' },
    { value: 'espalda_alta',      label: 'Espalda alta' },
    { value: 'espalda_baja',      label: 'Espalda baja' },
    { value: 'pecho',             label: 'Pecho' },
    { value: 'biceps',            label: 'Bíceps' },
    { value: 'triceps',           label: 'Tríceps' },
    { value: 'codos',             label: 'Codos' },
    { value: 'antebrazos_munecas',label: 'Antebrazos / Muñecas' },
    { value: 'cuello',            label: 'Cuello' },
    { value: 'abdominales',       label: 'Abdominales' },
    { value: 'gluteos',           label: 'Glúteos' },
    { value: 'cuadriceps',        label: 'Cuádriceps' },
    { value: 'rodillas',          label: 'Rodillas' },
    { value: 'isquiotibiales',    label: 'Isquiotibiales' },
    { value: 'aductores',         label: 'Aductores' },
    { value: 'gemelos_tobillos',  label: 'Gemelos / Tobillos' },
  ],
}

const DEF_RESPUESTAS = {
  sexoBiologico: 'masculino',
  altura: 170,
  objetivo: 'fitness_general',
  nivel: 'intermedio',
  edad: 25,
  pesoKg: 70,
  diasSeleccionados: ['lunes', 'miercoles', 'viernes'],
  tiempoPorSesion: '40-60',
  splitPreferido: 'fullbody',
  equipamiento: 'gimnasio_completo',
  preferenciaEjercicio: 'sin_preferencia',
  enfoque: 'balance',
  descansoSegundos: '90-120',
  tipoProgresion: null,
  defaultIntensifier: null,
  metricaEsfuerzo: 'rir',
  cardio: 'sin_cardio',
  movilidadEstiramientos: false,
  tieneLesion: false,
  lesiones: [],
}

function OptionGrid({ opciones, valor, onSelect }) {
  return (
    <div className="survey-grid">
      {opciones.map(op => {
        const disabled = op.disabled
        return (
          <button
            key={op.value}
            className={'survey-option' + (valor === op.value ? ' on' : '') + (disabled ? ' disabled' : '')}
            onClick={() => !disabled && onSelect(op.value)}
            disabled={disabled}
            type="button"
            style={disabled ? { opacity: 0.4, cursor: 'not-allowed' } : {}}
          >
            <span className="survey-opt-label">{op.label} {disabled ? '(No disponible)' : ''}</span>
            {op.sub && <span className="survey-opt-sub">{op.sub}</span>}
          </button>
        )
      })}
    </div>
  )
}

function CheckPill({ checked, onChange, children }) {
  return (
    <button
      className={'survey-pill' + (checked ? ' on' : '')}
      onClick={() => onChange(!checked)}
      type="button"
    >
      {checked && <Icon name="check" style={{ fontSize: 13, marginRight: 4 }} />}
      {children}
    </button>
  )
}

export default function SurveyWizard() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const { update } = useStore()
  const toast = useUI(s => s.toast)

  const [resp, setResp] = useState(() => ({
    ...DEF_RESPUESTAS,
    tipoProgresion: S.progressionType || 'linear',
    defaultIntensifier: S.defaultIntensifier || { type: 'none' },
    ...(S.respuestasEncuesta || {}),
  }))
  const [paso, setPaso] = useState(1)
  const [generando, setGenerando] = useState(false)

  const set = (campo, valor) => setResp(r => ({ ...r, [campo]: valor }))

  // Requerimiento 3 — Restricciones lógicas y coherencia dinámica
  useEffect(() => {
    // Si equipamiento es Calistenia o Solo Mancuernas, "Máquinas y poleas" no es coherente
    if (resp.equipamiento === 'calistenia' || resp.equipamiento === 'solo_mancuernas') {
      if (resp.preferenciaEjercicio === 'maquinas_poleas') {
        set('preferenciaEjercicio', 'sin_preferencia')
      }
    }
    // Si hay 1 solo día, forzar split Full Body
    if (resp.diasSeleccionados.length === 1 && resp.splitPreferido !== 'fullbody') {
      set('splitPreferido', 'fullbody')
    }
  }, [resp.equipamiento, resp.diasSeleccionados.length])

  const toggleDia = (key) => {
    setResp(r => {
      const ya = r.diasSeleccionados.includes(key)
      const dias = ya ? r.diasSeleccionados.filter(d => d !== key) : [...r.diasSeleccionados, key]
      // Evitar dejar 0 días
      if (dias.length === 0) return r
      return { ...r, diasSeleccionados: dias }
    })
  }

  const toggleLesion = (lesion) => {
    setResp(r => {
      const ya = r.lesiones.includes(lesion)
      const lesiones = ya ? r.lesiones.filter(l => l !== lesion) : [...r.lesiones, lesion]
      return { ...r, lesiones }
    })
  }

  const totalDias = resp.diasSeleccionados.length
  const splitRecomendado = useMemo(
    () => defaultSplitRecomendado(resp.nivel, totalDias || 1),
    [resp.nivel, totalDias]
  )

  const avisoLive = useMemo(() => {
    const { avisoFrecuencia } = derivarSplit(resp.nivel, totalDias || 1, resp.splitPreferido, resp.enfoque)
    return avisoFrecuencia
  }, [resp.nivel, totalDias, resp.splitPreferido, resp.enfoque])

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [paso])

  const progressionOpciones = useMemo(() => POLICIES.filter(p => p !== 'time').map(p => ({
    value: p,
    label: t(POLICY_NAME[p]),
    sub: POLICY_DESC[p] ? t(POLICY_DESC[p]) : '',
  })), [])

  const intensifierOpciones = useMemo(() => [
    { value: 'none', label: t('Ninguno'), sub: t('Sin intensificador automático') },
    { value: 'dropset', label: t('Drop-set'), sub: t('Series descendentes sin pausa') },
    { value: 'topback', label: t('Top-set + Backoff'), sub: t('Serie pesada y series de retroceso') },
    { value: 'restpause', label: t('Rest-pause'), sub: t('Bloques con mini-descansos') },
  ], [])

  const avanzar = () => setPaso(p => Math.min(PASOS, p + 1))
  const retroceder = () => setPaso(p => Math.max(1, p - 1))

  const [planRevision, setPlanRevision] = useState(null)

  const finalizar = async () => {
    setGenerando(true)
    try {
      const respuestas = {
        ...resp,
        tieneLesion: resp.lesiones.length > 0,
        diasPorSemana: resp.diasSeleccionados.length,
        defaultIntensifier: resp.defaultIntensifier || S.defaultIntensifier || { type: 'none' },
      }

      const rutinaGenerada = generarRutina(respuestas, CATALOGUE)
      const { routines, week } = rutinaGeneradaToRoutines(rutinaGenerada, respuestas)

      setPlanRevision({
        rutinaGenerada,
        routines,
        week,
        poolSeguro: rutinaGenerada.poolSeguro || [],
        usadosEnSemana: new Set(rutinaGenerada.usadosEnSemana || []),
        respuestas,
      })
      setGenerando(false)
      setPaso(6)
    } catch (e) {
      toast(t('Hubo un error al generar tu rutina. Intentá de nuevo.'))
      setGenerando(false)
    }
  }

  const reemplazarEjercicio = (routineIdx, exIdx, exViejo, exNuevo) => {
    if (!planRevision) return
    const prevUsados = new Set(planRevision.usadosEnSemana)
    prevUsados.delete(exViejo.id)
    prevUsados.add(exNuevo.id)

    const newRoutines = planRevision.routines.map((r, rI) => {
      if (rI !== routineIdx) return r
      const newEx = [...r.ex]
      // Preservar propiedades específicas según tipo
      const isCardio = exViejo.isCardio
      const isStretch = exViejo.isStretch

      newEx[exIdx] = {
        ...newEx[exIdx],
        id: exNuevo.id,
        // Para cardio, preservar tiempo y modo
        ...(isCardio && {
          isCardio: true,
          mode: 'cardio',
          min: exViejo.min,
          speed: exViejo.speed,
          note: exNuevo.bp === 'cardio' ? exNuevo.st?.[0] || '' : exViejo.note,
        }),
        // Para estiramientos, preservar duración
        ...(isStretch && {
          isStretch: true,
          mode: 'time',
          sec: exViejo.sec,
          note: 'Estiramiento recomendado para los músculos de hoy',
        }),
        // Para ejercicios normales, preservar series y reps
        ...(!isCardio && !isStretch && {
          isNormal: true,
          sets: exViejo.sets,
          reps: exViejo.reps,
        }),
      }
      return { ...r, ex: newEx }
    })

    const newDias = planRevision.rutinaGenerada.dias.map((d, dI) => {
      if (dI !== routineIdx) return d
      const newEjercicios = [...(d.ejercicios || d.ex || [])]
      const isCardio = exViejo.isCardio
      const isStretch = exViejo.isStretch

      newEjercicios[exIdx] = {
        ...newEjercicios[exIdx],
        id: exNuevo.id,
        exerciseId: exNuevo.id,
        ...(isCardio && {
          isCardio: true,
          mode: 'cardio',
          min: exViejo.min,
          speed: exViejo.speed,
          note: exNuevo.bp === 'cardio' ? exNuevo.st?.[0] || '' : exViejo.note,
        }),
        ...(isStretch && {
          isStretch: true,
          mode: 'time',
          sec: exViejo.sec,
          note: 'Estiramiento recomendado para los músculos de hoy',
        }),
        ...(!isCardio && !isStretch && {
          isNormal: true,
          sets: exViejo.sets,
          reps: exViejo.reps,
        }),
      }
      return { ...d, ejercicios: newEjercicios, ex: newEjercicios }
    })

    const newRutinaGenerada = {
      ...planRevision.rutinaGenerada,
      dias: newDias,
      usadosEnSemana: prevUsados,
    }

    setPlanRevision({
      ...planRevision,
      routines: newRoutines,
      rutinaGenerada: newRutinaGenerada,
      usadosEnSemana: prevUsados,
    })
    useUI.getState().toast(t('Ejercicio reemplazado'))
  }

  const guardarDefinitivo = () => {
    if (!planRevision) return
    const { routines, week, respuestas, rutinaGenerada } = planRevision
    const tieneRutinasPrevias = S.routines.length > 0

    const guardar = () => {
      update(st => {
        st.routines = routines
        st.week = week
        st.estadoInicial = 'encuesta_completada'
        st.edad = Number.isFinite(+respuestas.edad) ? +respuestas.edad : null
        st.altura = Number.isFinite(+respuestas.altura) ? +respuestas.altura : null
        st.objetivo = respuestas.objetivo || st.objetivo || 'fitness_general'
        st.pesoKg = Number.isFinite(+respuestas.pesoKg) ? +respuestas.pesoKg : null
        st.nivel = respuestas.nivel || st.nivel || null
        st.genero = respuestas.sexoBiologico === 'femenino' ? 'femenino' : 'masculino'
        st.body = st.genero === 'femenino' ? 'female' : 'male'
        st.progressionType = respuestas.tipoProgresion || 'linear'
        st.defaultIntensifier = respuestas.defaultIntensifier || { type: 'none' }
        st.respuestasEncuesta = respuestas
        st.rutinaGenerada = rutinaGenerada
        st.fechaUltimaEncuesta = todayISO()

        if (respuestas.pesoKg && (!st.bodyweight || st.bodyweight.length === 0)) {
          st.bodyweight = [{ d: todayISO(), w: +respuestas.pesoKg, t: Date.now() }]
        }

        if (respuestas.descansoSegundos) {
          const mapSec = { '60': 60, '90-120': 90, '180+': 180 }
          st.restSec = mapSec[respuestas.descansoSegundos] || 90
        }

        if (respuestas.metricaEsfuerzo) {
          const mapEffort = { rir: 'rir', rpe: 'rpe' }
          st.effort = mapEffort[respuestas.metricaEsfuerzo] || 'rir'
        }
      })

      if (rutinaGenerada.avisoFrecuencia) {
        toast(rutinaGenerada.avisoFrecuencia)
      } else {
        toast(t('¡Tu rutina personalizada está lista!'))
      }
      nav('/home')
    }

    if (tieneRutinasPrevias) {
      confirmSheet({
        title: t('¿Reemplazar tu plan actual?'),
        message: t('La rutina recomendada va a reemplazar tu plan de entrenamiento actual. Tus entrenamientos registrados no se modifican.'),
        confirmText: t('Sí, reemplazar'),
        onConfirm: guardar,
      })
    } else {
      guardar()
    }
  }

  // Opciones filtradas dinámicamente según requerimiento 3
  const preferenciasOpciones = useMemo(() => {
    return OPT.preferenciaEjercicio.map(op => {
      if (op.value === 'maquinas_poleas' && (resp.equipamiento === 'calistenia' || resp.equipamiento === 'solo_mancuernas')) {
        return { ...op, disabled: true }
      }
      return op
    })
  }, [resp.equipamiento])

  const renderPaso = () => {
    switch (paso) {
      case 1:
        return (
          <>
            <h2 className="survey-step-title">Paso 1: Perfil & Biometría</h2>
            <p className="survey-step-sub muted">Datos básicos para calibrar metabolismo, volumen y descanso.</p>

            <h2 className="survey-step-title" style={{ fontSize: 16 }}>Sexo (biológico)</h2>
            <OptionGrid
              opciones={OPT.sexoBiologico}
              valor={resp.sexoBiologico}
              onSelect={v => {
                set('sexoBiologico', v)
                const genero = v === 'femenino' ? 'femenino' : 'masculino'
                update(st => {
                  st.genero = genero
                  st.body = genero === 'femenino' ? 'female' : 'male'
                })
              }}
            />

            <div style={{ height: 18 }} />
            <div className="survey-inputs-row" style={{ marginBottom: 20 }}>
              <div className="survey-input-card">
                <span className="lbl">Edad (14 - 90)</span>
                <input
                  type="number"
                  min="14"
                  max="90"
                  value={resp.edad ?? ''}
                  onChange={e => set('edad', e.target.value === '' ? '' : +e.target.value)}
                  onBlur={() => {
                    const n = +resp.edad
                    if (n && n < 14) set('edad', 14)
                    else if (n > 90) set('edad', 90)
                  }}
                  placeholder="25"
                />
              </div>
              <div className="survey-input-card">
                <span className="lbl">Peso kg (30 - 250)</span>
                <input
                  type="number"
                  step="0.5"
                  min="30"
                  max="250"
                  value={resp.pesoKg ?? ''}
                  onChange={e => set('pesoKg', e.target.value === '' ? '' : +e.target.value)}
                  onBlur={() => {
                    const n = +resp.pesoKg
                    if (n && n < 30) set('pesoKg', 30)
                    else if (n > 250) set('pesoKg', 250)
                  }}
                  placeholder="70"
                />
              </div>
              <div className="survey-input-card">
                <span className="lbl">Altura cm (100 - 250)</span>
                <input
                  type="number"
                  min="100"
                  max="250"
                  value={resp.altura ?? ''}
                  onChange={e => set('altura', e.target.value === '' ? '' : +e.target.value)}
                  onBlur={() => {
                    const n = +resp.altura
                    if (n && n < 100) set('altura', 100)
                    else if (n > 250) set('altura', 250)
                  }}
                  placeholder="170"
                />
              </div>
            </div>

            <h2 className="survey-step-title">Objetivo principal</h2>
            <OptionGrid opciones={OPT.objetivo} valor={resp.objetivo} onSelect={v => set('objetivo', v)} />

            <div style={{ height: 24 }} />
            <h2 className="survey-step-title">Nivel de experiencia</h2>
            <OptionGrid opciones={OPT.nivel} valor={resp.nivel} onSelect={v => set('nivel', v)} />
          </>
        )

      case 2:
        return (
          <>
            <h2 className="survey-step-title">Paso 2: Disponibilidad & Tiempo</h2>
            <p className="survey-step-sub muted">Marcá los días específicos de la semana en los que vas a entrenar.</p>
            <div className="survey-days-bar">
              {DIAS_OPCIONES.map(d => {
                const on = resp.diasSeleccionados.includes(d.key)
                return (
                  <button
                    key={d.key}
                    type="button"
                    className={'survey-day-btn' + (on ? ' on' : '')}
                    onClick={() => toggleDia(d.key)}
                  >
                    {d.label}
                  </button>
                )
              })}
            </div>
            <div className="muted small" style={{ marginBottom: 18, textAlign: 'center' }}>
              {totalDias === 1 ? '1 día seleccionado' : `${totalDias} días seleccionados por semana`}
            </div>

            <h2 className="survey-step-title">Tiempo por sesión</h2>
            <OptionGrid opciones={OPT.tiempoPorSesion} valor={resp.tiempoPorSesion} onSelect={v => set('tiempoPorSesion', v)} />

            <div style={{ height: 24 }} />
            <h2 className="survey-step-title">Distribución semanal (Split)</h2>
            <p className="survey-step-sub muted small">
              Elegí tu split preferido. Recomendado: <strong>{OPT.splitPreferido.find(s => s.value === splitRecomendado)?.label}</strong>.
            </p>
            <OptionGrid opciones={OPT.splitPreferido} valor={resp.splitPreferido} onSelect={v => set('splitPreferido', v)} />

            {avisoLive && (
              <div className="survey-banner" role="alert">
                <Icon name="info" style={{ fontSize: 16, marginTop: 1, flexShrink: 0 }} />
                <span>{avisoLive}</span>
              </div>
            )}
          </>
        )

      case 3:
        return (
          <>
            <h2 className="survey-step-title">Paso 3: Equipamiento & Preferencias</h2>
            <OptionGrid opciones={OPT.equipamiento} valor={resp.equipamiento} onSelect={v => set('equipamiento', v)} />

            <div style={{ height: 24 }} />
            <h2 className="survey-step-title">Preferencia de ejercicios</h2>
            <OptionGrid opciones={preferenciasOpciones} valor={resp.preferenciaEjercicio} onSelect={v => set('preferenciaEjercicio', v)} />

            <div style={{ height: 24 }} />
            <h2 className="survey-step-title">Enfoque muscular</h2>
            <OptionGrid opciones={OPT.enfoque} valor={resp.enfoque} onSelect={v => set('enfoque', v)} />
          </>
        )

      case 4:
        return (
          <>
            <h2 className="survey-step-title">Paso 4: Parámetros de Entrenamiento</h2>
            <p className="survey-step-sub muted">Ajustes finos de series, descansos y complementos.</p>

            <h2 className="survey-step-title">Descanso entre series</h2>
            <OptionGrid opciones={OPT.descansoSegundos} valor={resp.descansoSegundos} onSelect={v => set('descansoSegundos', v)} />

            <div style={{ height: 24 }} />
            <h2 className="survey-step-title">Métrica de esfuerzo</h2>
            <OptionGrid opciones={OPT.metricaEsfuerzo} valor={resp.metricaEsfuerzo} onSelect={v => set('metricaEsfuerzo', v)} />

            <div style={{ height: 24 }} />
            <h2 className="survey-step-title">Tipo de progresión</h2>
            <OptionGrid opciones={progressionOpciones} valor={resp.tipoProgresion} onSelect={v => set('tipoProgresion', v)} />

            <div style={{ height: 24 }} />
            <h2 className="survey-step-title">Intensificador por defecto</h2>
            <OptionGrid
              opciones={intensifierOpciones}
              valor={resp.defaultIntensifier?.type || null}
              onSelect={v => set('defaultIntensifier', v === 'none' ? { type: 'none' } : { type: v, count: 1, pct: 20, totalReps: 8, restSec: 15, backoffReps: 10 })}
            />

            <div style={{ height: 24 }} />
            <h2 className="survey-step-title">Cardio</h2>
            <OptionGrid opciones={OPT.cardio} valor={resp.cardio} onSelect={v => set('cardio', v)} />

            <div style={{ height: 24 }} />
            <h2 className="survey-step-title">Movilidad y estiramientos</h2>
            <p className="survey-step-sub muted small">Agrega ejercicios de movilidad al final de cada sesión.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <CheckPill
                checked={resp.movilidadEstiramientos}
                onChange={v => set('movilidadEstiramientos', v)}
              >
                {resp.movilidadEstiramientos ? '✓ Estiramientos finales activados' : 'Sin estiramientos'}
              </CheckPill>
            </div>
          </>
        )

      case 5:
        return (
          <>
            <h2 className="survey-step-title">Paso 5: Lesiones & Salud</h2>
            <p className="survey-step-sub muted">Excluiremos ejercicios que afecten a estas zonas del cuerpo.</p>
            <div style={{ marginTop: 12, marginBottom: 12 }}>
              <CheckPill
                checked={resp.lesiones.length === 0}
                onChange={() => setResp(r => ({ ...r, lesiones: [] }))}
              >
                Sin lesiones
              </CheckPill>
            </div>
            <div className="survey-pills">
              {OPT.lesiones.map(op => (
                <CheckPill
                  key={op.value}
                  checked={resp.lesiones.includes(op.value)}
                  onChange={() => toggleLesion(op.value)}
                >
                  {op.label}
                </CheckPill>
              ))}
            </div>
            {resp.lesiones.length > 0 && (
              <p className="muted small" style={{ marginTop: 16, lineHeight: 1.5 }}>
                ⚠️ La rutina excluirá automáticamente los ejercicios de riesgo para las zonas marcadas. Si sentís dolor agudo, detené la actividad y consultá a un profesional.
              </p>
            )}
          </>
        )

      case 6:
        if (!planRevision) return null
        return (
          <>
            <h2 className="survey-step-title">{t('Revisá y ajustá tus ejercicios')}</h2>
            <p className="survey-step-sub muted">
              {t('Esta es la lista completa de ejercicios generados. Podés reemplazar los que prefieras por alternativas equivalentes.')}
            </p>

            {planRevision.routines.map((r, rIdx) => (
              <div key={r.id} className="card" style={{ marginBottom: 14 }}>
                <h3 style={{ margin: '0 0 10px', fontSize: 16, fontWeight: 700 }}>{r.name}</h3>
                <div className="list" style={{ gap: 4 }}>
                  {r.ex.map((ex, exIdx) => {
                    const exObj = EXIDX[ex.id] || ex
                    const nombre = exerciseNameFor(exObj) || exObj.n || ex.id
                    const isNormal = ex.isNormal !== false && !ex.isCardio && !ex.isStretch
                    const isCardio = ex.isCardio
                    const isStretch = ex.isStretch
                    return (
                      <div key={exIdx} className="row between" style={{ padding: '8px 4px', borderBottom: exIdx < r.ex.length - 1 ? '1px solid var(--sep)' : 'none' }}>
                        <div style={{ cursor: 'pointer', flex: 1 }} onClick={() => exerciseDetailSheetNoAdd(exObj)}>
                          <div style={{ fontWeight: 600, fontSize: 14 }}>{nombre}</div>
                          <div className="small muted">
                            {isCardio ? `${ex.min} min` : isStretch ? `${ex.sec} s` : `${ex.sets} ${t('series')} × ${ex.reps} ${t('reps')}`}
                          </div>
                        </div>
                        {(isNormal || isCardio || isStretch) && (
                          <Button
                            size="sm"
                            variant="tinted"
                            icon="reset"
                            onClick={() => useUI.getState().openSheet(close => (
                              <ExerciseReplacementSheet
                                exActual={ex}
                                poolSeguro={planRevision.poolSeguro}
                                usadosEnSemana={planRevision.usadosEnSemana}
                                onReemplazar={(nueva) => reemplazarEjercicio(rIdx, exIdx, ex, nueva)}
                                close={close}
                                tipo={isCardio ? 'cardio' : isStretch ? 'stretch' : 'normal'}
                              />
                            ))}
                          >
                            {t('Reemplazar')}
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </>
        )

      default:
        return null
    }
  }

  const puedeAvanzar = () => {
    if (paso === 1) return !!resp.sexoBiologico && !!resp.objetivo && !!resp.nivel && resp.edad >= 14 && resp.edad <= 90 && resp.pesoKg >= 30 && resp.pesoKg <= 250 && resp.altura >= 100 && resp.altura <= 250
    if (paso === 2) return resp.diasSeleccionados.length >= 1 && !!resp.tiempoPorSesion
    if (paso === 3) return !!resp.equipamiento && !!resp.preferenciaEjercicio && !!resp.enfoque
    if (paso === 4) return !!resp.descansoSegundos && !!resp.metricaEsfuerzo && !!resp.tipoProgresion && !!resp.cardio
    return true
  }

  return (
    <div className="narrow survey-wizard">
      <div className="survey-header">
        <button
          className="iconbtn"
          onClick={() => {
            if (paso === 1) {
              confirmSheet({
                title: '¿Salir de la encuesta?',
                message: 'Tus respuestas no se guardarán.',
                confirmText: 'Salir',
                danger: true,
                onConfirm: () => nav('/home'),
              })
            } else {
              retroceder()
            }
          }}
          aria-label={paso === 1 ? 'Cerrar' : 'Atrás'}
        >
          <Icon name={paso === 1 ? 'xmark' : 'chevronLeft'} />
        </button>
        <div className="survey-progress-wrap">
          <div
            className="survey-progress-bar"
            style={{ width: `${(Math.min(paso, PASOS) / PASOS) * 100}%` }}
          />
        </div>
        <span className="muted small" style={{ whiteSpace: 'nowrap' }}>
          {paso > PASOS ? t('Revisión') : `${paso} / ${PASOS}`}
        </span>
      </div>

      <div className="survey-body">
        {renderPaso()}
      </div>

      <div className="survey-footer">
        {paso < PASOS ? (
          <Button
            variant="primary"
            icon="chevronRight"
            trailingIcon="chevronRight"
            onClick={avanzar}
            disabled={!puedeAvanzar()}
            style={{ width: '100%' }}
          >
            Siguiente
          </Button>
        ) : paso === PASOS ? (
          <Button
            variant="primary"
            icon="sparkles"
            onClick={finalizar}
            disabled={generando}
            style={{ width: '100%' }}
          >
            {generando ? 'Generando…' : '¡Crear mi rutina!'}
          </Button>
        ) : (
          <Button
            variant="primary"
            icon="check"
            onClick={guardarDefinitivo}
            style={{ width: '100%' }}
          >
            {t('Confirmar rutina')}
          </Button>
        )}
      </div>
    </div>
  )
}