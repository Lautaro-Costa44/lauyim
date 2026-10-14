import { useState, useMemo } from 'react'
import { EXIDX, matchExercise } from '../lib/exercises.js'
import { exerciseNameFor } from '../lib/i18n.js'
import { exerciseDetailSheetNoAdd } from '../sheets.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'
import { NO_AUTOFILL } from '../lib/input-safety.js'
import { t } from '../lib/i18n.js'
import { obtenerAlternativas as obtenerAlternativasNormal, obtenerMasAlternativas as obtenerMasAlternativasNormal, buscarEnGrupoMuscular } from '../lib/generarRutina.js'
import { musclesOf, MUSCLE_NAME } from '../lib/muscles.js'
import { Thumb } from './Media.jsx'

function ExerciseReplacementSheet({ exActual, poolSeguro, usadosEnSemana, onReemplazar, close, tipo = 'normal' }) {
  const [masAlts, setMasAlts] = useState([])
  const [verMasCargado, setVerMasCargado] = useState(false)
  const [query, setQuery] = useState('')

  const exActualObj = useMemo(() => poolSeguro.find(e => e.id === (exActual.id || exActual.exerciseId)) || EXIDX[exActual.id] || exActual, [exActual, poolSeguro])
  const nombreActual = exerciseNameFor(exActualObj) || exActualObj.n || exActual.id

  // Para cardio y estiramientos, usamos lógica diferente
  const altsIniciales = useMemo(() => {
    if (tipo === 'cardio') {
      return obtenerAlternativasCardio(exActualObj, poolSeguro, usadosEnSemana, 3)
    } else if (tipo === 'stretch') {
      return obtenerAlternativasEstiramientos(exActualObj, poolSeguro, usadosEnSemana, 3)
    }
    // Lógica normal (ejercicios de fuerza)
    return obtenerAlternativasNormal(exActualObj, poolSeguro, usadosEnSemana, 3)
  }, [exActualObj, poolSeguro, usadosEnSemana, tipo])

  const cargarMas = () => {
    const yaMostrados = new Set(altsIniciales.map(a => a.id))
    let mas = []
    if (tipo === 'cardio') {
      mas = obtenerMasAlternativasCardio(exActualObj, poolSeguro, usadosEnSemana, yaMostrados, 5)
    } else if (tipo === 'stretch') {
      mas = obtenerMasAlternativasEstiramientos(exActualObj, poolSeguro, usadosEnSemana, yaMostrados, 5)
    } else {
      mas = obtenerMasAlternativasNormal(exActualObj, poolSeguro, usadosEnSemana, yaMostrados, 5)
    }
    setMasAlts(mas)
    setVerMasCargado(true)
  }

  const resultadosBusqueda = useMemo(() => {
    if (!query.trim()) return null
    if (tipo === 'cardio') {
      return buscarCardio(query, poolSeguro, usadosEnSemana)
    } else if (tipo === 'stretch') {
      return buscarEstiramientos(query, poolSeguro, usadosEnSemana)
    }
    return buscarEnGrupoMuscular(query, poolSeguro, exActualObj.tg, usadosEnSemana)
  }, [query, poolSeguro, exActualObj.tg, usadosEnSemana, tipo])

  const listaAMostrar = resultadosBusqueda !== null ? resultadosBusqueda : [...altsIniciales, ...masAlts]

  // Laid out like the exercise picker: search on top, one tappable row per alternative (the row
  // is the choice), details behind the ⓘ. No inner scroll box — the sheet itself scrolls.
  return <>
    <h3 style={{ marginBottom: 2 }}>{t('Replace')}</h3>
    <div className="muted small capitalize" style={{ marginBottom: 12 }}>{nombreActual}</div>

    <input {...NO_AUTOFILL} name="app-exercise-replacement-search"
      className="input"
      type="search"
      placeholder={tipo === 'cardio' ? t('Buscar cardio...') :
                   tipo === 'stretch' ? t('Buscar estiramientos...') :
                   t('Buscar en {0}...', exActualObj.tg ? t(exActualObj.tg) : t('mismo grupo'))}
      value={query}
      onChange={e => setQuery(e.target.value)}
    />
    <div className="muted small" style={{ margin: '12px 2px 8px' }}>
      {query ? t('Results') :
       tipo === 'cardio' ? t('Cardio alternatives for your equipment') :
       tipo === 'stretch' ? t('Alternative stretches') :
       t('Equivalent alternatives')}
    </div>

    {listaAMostrar.length === 0 ? (
      <div className="muted" style={{ padding: '16px 0' }}>
        {query ? t('No se encontraron ejercicios.') : t('No hay otras alternativas disponibles.')}
      </div>
    ) : (
      <div className="list">
        {listaAMostrar.map(alt => {
          const musculosPrimarios = Object.entries(musclesOf(alt))
            .filter(([, peso]) => peso >= 0.8)
            .map(([slug]) => t(MUSCLE_NAME[slug]))
            .slice(0, 2)
          const meta = [musculosPrimarios.join(', '), alt.eq ? t(alt.eq) : null].filter(Boolean).join(' · ')
          return (
            <div key={alt.id} className="item rep-item" onClick={() => { onReemplazar(alt); close() }}>
              <Thumb ex={alt} />
              <div className="grow">
                <div className="tt capitalize rep-name">{exerciseNameFor(alt) || alt.n || alt.id}</div>
                {meta && <div className="ss capitalize">{meta}</div>}
              </div>
              <button type="button" className="iconbtn" aria-label={t('Ver detalles')}
                onClick={e => { e.stopPropagation(); exerciseDetailSheetNoAdd(alt) }}><Icon name="info" /></button>
            </div>
          )
        })}
      </div>
    )}

    {!query && !verMasCargado && listaAMostrar.length > 0 && (
      <div style={{ marginTop: 10 }}>
        <Button variant="ghost" icon="plus" onClick={cargarMas}>{t('Ver más alternativas (+5)')}</Button>
      </div>
    )}
  </>
}

// Cardio y estiramientos: el generador pasa su propio pool (poolCardio / poolEstiramientos),
// ya filtrado por equipamiento y lesiones. El de fuerza no sirve: excluye a ambos.
const asSet = v => (v instanceof Set ? v : new Set(v || []))

function obtenerAlternativasCardio(ejercicioActual, pool = [], idsUsadosEnLaSemana = new Set(), n = 3) {
  return obtenerMasAlternativasCardio(ejercicioActual, pool, idsUsadosEnLaSemana, new Set(), n)
}

function obtenerMasAlternativasCardio(ejercicioActual, pool = [], idsUsadosEnLaSemana = new Set(), yaMostrados = new Set(), n = 5) {
  const usados = asSet(idsUsadosEnLaSemana), mostrados = asSet(yaMostrados)
  const actualId = ejercicioActual.id || ejercicioActual.exerciseId
  return pool.filter(e => e.id !== actualId && !usados.has(e.id) && !mostrados.has(e.id)).slice(0, n)
}

function buscarCardio(query, pool = [], idsUsadosEnLaSemana = new Set()) {
  if (!query || !query.trim()) return []
  const usados = asSet(idsUsadosEnLaSemana)
  return pool.filter(e => !usados.has(e.id) && matchExercise(e, query))
}

// Estiramientos: primero los del mismo músculo, después el resto.
function obtenerAlternativasEstiramientos(ejercicioActual, pool = [], idsUsadosEnLaSemana = new Set(), n = 3) {
  return obtenerMasAlternativasEstiramientos(ejercicioActual, pool, idsUsadosEnLaSemana, new Set(), n)
}

function obtenerMasAlternativasEstiramientos(ejercicioActual, pool = [], idsUsadosEnLaSemana = new Set(), yaMostrados = new Set(), n = 5) {
  const usados = asSet(idsUsadosEnLaSemana), mostrados = asSet(yaMostrados)
  const actualId = ejercicioActual.id || ejercicioActual.exerciseId
  const tg = ejercicioActual.tg
  return pool
    .filter(e => e.id !== actualId && !usados.has(e.id) && !mostrados.has(e.id))
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.tg === tg ? 0 : 1) - (b.e.tg === tg ? 0 : 1) || a.i - b.i)
    .map(x => x.e)
    .slice(0, n)
}

function buscarEstiramientos(query, pool = [], idsUsadosEnLaSemana = new Set()) {
  if (!query || !query.trim()) return []
  const usados = asSet(idsUsadosEnLaSemana)
  return pool.filter(e => !usados.has(e.id) && matchExercise(e, query))
}

export default ExerciseReplacementSheet
