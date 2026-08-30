import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { EXDB } from '../lib/exercises.js'
import { generarRutina, rutinaGeneradaToRoutines, defaultSplitRecomendado, derivarSplit, obtenerAlternativas } from '../lib/generarRutina.js'
import exerciseNamesEs from '../locales/exercise-names-es.js'
import { todayISO } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

const PASOS = 6

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
    { value: '30-40', label: '30–40 min', sub: '3-4 ejercicios por sesión' },
    { value: '40-60', label: '40–60 min', sub: '5-6 ejercicios por sesión' },
    { value: '60-90', label: '60–90 min', sub: '6-7 ejercicios por sesión' },
    { value: '90+',   label: '90+ min',   sub: '7-8 ejercicios por sesión' },
  ],
  splitPreferido: [
    { value: 'fullbody',        label: 'Full Body',               sub: 'Todo el cuerpo en cada sesión' },
    { value: 'torso_pierna',    label: 'Torso / Pierna',          sub: 'Un día tren superior, un día inferior' },
    { value: 'ppl',             label: 'Push / Pull / Legs',      sub: 'Empuje, Tracción y Pierna' },
    { value: 'gluteos_piernas', label: 'Glúteos & Piernas Focus', sub: 'Énfasis en tren inferior + soporte de torso' },
  ],
  equipamiento: [
    { value: 'gimnasio_completo', label: 'Gimnasio completo', sub: 'Máquinas, barras, mancuernas…' },
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
    { value: 'lineal',           label: 'Progresión lineal',       sub: 'Subir peso set a set' },
    { value: 'doble_progresion', label: 'Doble progresión',        sub: 'Primero reps, luego peso' },
    { value: 'ondulante',        label: 'Ondulante (DUP)',         sub: 'Variar intensidad por día' },
  ],
  metricaEsfuerzo: [
    { value: 'rir',           label: 'RIR (Reps en reserva)',   sub: 'RIR 1-2 (dejar 1 o 2 reps antes del fallo)' },
    { value: 'rpe',           label: 'RPE (Esfuerzo percibido)', sub: 'RPE 8-9 (escala del 1 al 10)' },
    { value: 'porcentaje_rm', label: '% 1RM',                   sub: 'Porcentaje de tu repetición máxima' },
  ],
  cardio: [
    { value: 'sin_cardio',     label: 'Sin cardio' },
    { value: 'suave_final',    label: 'Cardio suave al final', sub: '15–20 min de bici, cinta o elíptica' },
    { value: 'hiit',           label: 'HIIT',                  sub: '15 min de intervalos de alta intensidad' },
    { value: 'caminar_correr', label: 'Caminar / Correr',      sub: '30 min de caminata rápida o trote' },
  ],
  lesiones: [
    { value: 'hombros',        label: 'Hombros' },
    { value: 'espalda_baja',   label: 'Espalda baja' },
    { value: 'rodillas',       label: 'Rodillas' },
    { value: 'munecas',        label: 'Muñecas' },
    { value: 'cuello',         label: 'Cuello' },
    { value: 'cuadriceps',     label: 'Cuádriceps' },
    { value: 'isquiotibiales', label: 'Isquiotibiales' },
    { value: 'codos',          label: 'Codos' },
    { value: 'tobillos',       label: 'Tobillos' },
  ],
}

const DEF_RESPUESTAS = {
  genero: 'hombre',
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
  tipoProgresion: 'doble_progresion',
  metricaEsfuerzo: 'rir',
  cardio: 'sin_cardio',
  movilidadEstiramientos: false,
  tieneLesion: false,
  lesiones: [],
}

function OptionGrid({ opciones, valor, onSelect }) {
  return (
    <div className="survey-grid">
      {opciones.map(op => (
        <button
          key={op.value}
          className={'survey-option' + (valor === op.value ? ' on' : '')}
          onClick={() => onSelect(op.value)}
          type="button"
        >
          <span className="survey-opt-label">{op.label}</span>
          {op.sub && <span className="survey-opt-sub">{op.sub}</span>}
        </button>
      ))}
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
    ...(S.respuestasEncuesta || {}),
  }))
  const [paso, setPaso] = useState(1)
  const [generando, setGenerando] = useState(false)

  // Estados para Previsualización y Cambio de Ejercicios
  const [rutinaDraft, setRutinaDraft] = useState(null)
  const [ejercicioAEditar, setEjercicioAEditar] = useState(null)
  const [opcionesCambio, setOpcionesCambio] = useState([])

  const set = (campo, valor) => setResp(r => ({ ...r, [campo]: valor }))

  const toggleDia = (key) => {
    setResp(r => {
      const ya = r.diasSeleccionados.includes(key)
      const dias = ya ? r.diasSeleccionados.filter(d => d !== key) : [...r.diasSeleccionados, key]
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
    () => defaultSplitRecomendado(resp.nivel, totalDias || 1, resp.genero),
    [resp.nivel, totalDias, resp.genero]
  )

  const avisoLive = useMemo(() => {
    const { avisoFrecuencia } = derivarSplit(resp.nivel, totalDias || 1, resp.splitPreferido, resp.genero)
    return avisoFrecuencia
  }, [resp.nivel, totalDias, resp.splitPreferido, resp.genero])

  const avanzar = () => {
    if (paso === 5) {
      const respuestas = {
        ...resp,
        tieneLesion: resp.lesiones.length > 0,
        diasPorSemana: resp.diasSeleccionados.length,
      }
      const borrador = generarRutina(respuestas, EXDB)
      setRutinaDraft(borrador)
      setPaso(6)
    } else {
      setPaso(p => Math.min(PASOS, p + 1))
    }
  }

  const retroceder = () => setPaso(p => Math.max(1, p - 1))

  const abrirCambioEjercicio = (diaIdx, ejIdx, exerciseId) => {
    const alts = obtenerAlternativas(exerciseId, EXDB, 3)
    setOpcionesCambio(alts)
    setEjercicioAEditar({ diaIdx, ejIdx })
  }

  const reemplazarEjercicio = (nuevoId) => {
    if (!ejercicioAEditar || !rutinaDraft) return
    const copia = JSON.parse(JSON.stringify(rutinaDraft))
    copia.dias[ejercicioAEditar.diaIdx].ejercicios[ejercicioAEditar.ejIdx].exerciseId = nuevoId
    setRutinaDraft(copia)
    setEjercicioAEditar(null)
  }

  const finalizar = async () => {
    setGenerando(true)
    try {
      const respuestas = {
        ...resp,
        tieneLesion: resp.lesiones.length > 0,
        diasPorSemana: resp.diasSeleccionados.length,
      }

      const rutinaAFinal = rutinaDraft || generarRutina(respuestas, EXDB)
      const { routines, week } = rutinaGeneradaToRoutines(rutinaAFinal)

      const tieneRutinasPrevias = S.routines.length > 0

      const guardar = () => {
        update(st => {
          st.routines = routines
          st.week = week
          st.estadoInicial = 'encuesta_completada'
          st.respuestasEncuesta = respuestas
          st.rutinaGenerada = rutinaAFinal
          st.fechaUltimaEncuesta = todayISO()

          if (resp.pesoKg && (!st.bodyweight || st.bodyweight.length === 0)) {
            st.bodyweight = [{ d: todayISO(), w: +resp.pesoKg, t: Date.now() }]
          }

          if (resp.descansoSegundos) {
            const mapSec = { '60': 60, '90-120': 90, '180+': 180 }
            st.restSec = mapSec[resp.descansoSegundos] || 90
          }

          if (resp.metricaEsfuerzo) {
            st.effort = resp.metricaEsfuerzo.startsWith('rpe') ? 'rpe' : 'rir'
          }
        })

        if (rutinaAFinal.avisoFrecuencia) {
          toast(rutinaAFinal.avisoFrecuencia)
        } else {
          toast(t('¡Tu rutina personalizada está lista!'))
        }
        nav('/home')
      }

      if (tieneRutinasPrevias) {
        setGenerando(false)
        confirmSheet({
          title: t('¿Reemplazar tu plan actual?'),
          message: t('La rutina recomendada va a reemplazar tu plan de entrenamiento actual. Tus entrenamientos registrados no se modifican.'),
          confirmText: t('Sí, reemplazar'),
          onConfirm: guardar,
        })
      } else {
        guardar()
      }
    } catch (e) {
      toast(t('Hubo un error al generar tu rutina. Intentá de nuevo.'))
      setGenerando(false)
    }
  }

  const renderPaso = () => {
    switch (paso) {
      case 1:
        return (
          <>
            <h2 className="survey-step-title">Paso 1: Perfil & Biometría</h2>
            <p className="survey-step-sub muted">Datos básicos para calibrar volumen y descanso.</p>

            <h2 className="survey-step-title">Género</h2>
            <OptionGrid
              opciones={[
                { value: 'hombre', label: 'Hombre', sub: 'Mayor volumen relativo en torso' },
                { value: 'mujer',  label: 'Mujer',  sub: 'Recomendación automática de Glúteos Focus' },
              ]}
              valor={resp.genero || 'hombre'}
              onSelect={v => set('genero', v)}
            />

            <div className="survey-inputs-row" style={{ marginBottom: 20, marginTop: 16 }}>
              <div className="survey-input-card">
                <span className="lbl">Edad (14 - 90 años)</span>
                <input
                  type="number"
                  min="14"
                  max="90"
                  value={resp.edad || ''}
                  onChange={e => set('edad', Math.min(90, Math.max(14, +e.target.value)) || +e.target.value)}
                  placeholder="25"
                />
              </div>
              <div className="survey-input-card">
                <span className="lbl">Peso actual en kg (30 - 250)</span>
                <input
                  type="number"
                  step="0.5"
                  min="30"
                  max="250"
                  value={resp.pesoKg || ''}
                  onChange={e => set('pesoKg', Math.min(250, Math.max(30, +e.target.value)) || +e.target.value)}
                  placeholder="70"
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
              <div className="survey-banner" role="alert" style={{ marginTop: 12 }}>
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
            <OptionGrid opciones={OPT.preferenciaEjercicio} valor={resp.preferenciaEjercicio} onSelect={v => set('preferenciaEjercicio', v)} />

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
            <OptionGrid opciones={OPT.tipoProgresion} valor={resp.tipoProgresion} onSelect={v => set('tipoProgresion', v)} />

            <div style={{ height: 24 }} />
            <h2 className="survey-step-title">Cardio</h2>
            <OptionGrid opciones={OPT.cardio} valor={resp.cardio} onSelect={v => set('cardio', v)} />

            <div style={{ height: 24 }} />
            <h2 className="survey-step-title">Movilidad y estiramientos</h2>
            <p className="survey-step-sub muted small">Agrega un bloque de 8 min de movilidad al final de cada sesión.</p>
            <div style={{ display: 'flex', gap: 10 }}>
              <CheckPill
                checked={resp.movilidadEstiramientos}
                onChange={v => set('movilidadEstiramientos', v)}
              >
                {resp.movilidadEstiramientos ? '✓ Bloque de movilidad activado' : 'Sin bloque de movilidad'}
              </CheckPill>
            </div>
          </>
        )

      case 5:
        return (
          <>
            <h2 className="survey-step-title">Paso 5: Lesiones & Salud</h2>
            <p className="survey-step-sub muted">Excluiremos ejercicios que involucren sobrecarga o impacto en esas zonas.</p>
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
                ⚠️ La rutina excluirá automáticamente los ejercicios de riesgo para las zonas marcadas.
              </p>
            )}
          </>
        )

      case 6:
        return (
          <div className="preview-container">
            <h2 className="survey-step-title">Previsualización de tu Rutina</h2>
            <p className="survey-step-sub muted">Revisá los ejercicios asignados. Podés tocar "Cambiar" para ver opciones similares.</p>

            {rutinaDraft && rutinaDraft.dias.map((dia, dIdx) => (
              <div key={dIdx} style={{ background: 'var(--surface)', padding: 14, borderRadius: 10, marginBottom: 12 }}>
                <h4 style={{ margin: '0 0 10px 0' }}>{dia.diaLabel}</h4>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {dia.ejercicios.map((ej, eIdx) => {
                    const nombreEs = exerciseNamesEs[ej.exerciseId] || ej.exerciseId
                    return (
                      <li key={eIdx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                        <span style={{ fontSize: 14 }}>{ej.series}x{ej.repeticiones} — <strong>{nombreEs}</strong></span>
                        <button
                          type="button"
                          className="survey-pill"
                          onClick={() => abrirCambioEjercicio(dIdx, eIdx, ej.exerciseId)}
                          style={{ fontSize: 12, padding: '2px 8px' }}
                        >
                          🔄 Cambiar
                        </button>
                      </li>
                    )
                  })}
                </ul>

                {dia.cardio && (
                  <div style={{ fontSize: 12, marginTop: 8, color: 'var(--acc)' }}>
                    🏃 Cardio: {dia.cardio.duracionMin} min ({dia.cardio.tipo})
                  </div>
                )}
                {dia.movilidad && (
                  <div style={{ fontSize: 12, marginTop: 4, color: 'var(--acc)' }}>
                    🧘 Movilidad: {dia.movilidad.duracionMin} min
                  </div>
                )}
              </div>
            ))}

            {ejercicioAEditar && (
              <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
                <div style={{ background: 'var(--surface)', padding: 20, borderRadius: 12, maxWidth: 350, width: '90%' }}>
                  <h3 style={{ marginTop: 0 }}>Seleccioná un reemplazo</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: '16px 0' }}>
                    {opcionesCambio.map(alt => (
                      <button
                        key={alt.id}
                        type="button"
                        className="survey-option"
                        onClick={() => reemplazarEjercicio(alt.id)}
                      >
                        <strong>{exerciseNamesEs[alt.id] || alt.n}</strong>
                        <span className="small muted"> ({alt.eq})</span>
                      </button>
                    ))}
                  </div>
                  <Button variant="secondary" onClick={() => setEjercicioAEditar(null)} style={{ width: '100%' }}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}
          </div>
        )

      default:
        return null
    }
  }

  const puedeAvanzar = () => {
    if (paso === 1) return !!resp.objetivo && !!resp.nivel && resp.edad >= 14 && resp.edad <= 90 && resp.pesoKg >= 30 && resp.pesoKg <= 250
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
            style={{ width: `${(paso / PASOS) * 100}%` }}
          />
        </div>
        <span className="muted small" style={{ whiteSpace: 'nowrap' }}>
          {paso} / {PASOS}
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
            {paso === 5 ? 'Ver previsualización' : 'Siguiente'}
          </Button>
        ) : (
          <Button
            variant="primary"
            icon="sparkles"
            onClick={finalizar}
            disabled={generando}
            style={{ width: '100%' }}
          >
            {generando ? 'Generando…' : '¡Confirmar y crear mi rutina!'}
          </Button>
        )}
      </div>
    </div>
  )
}