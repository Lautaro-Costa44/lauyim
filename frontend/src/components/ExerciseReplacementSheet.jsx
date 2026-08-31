import { useState, useMemo } from 'react'
import { EXIDX } from '../lib/exercises.js'
import { exerciseNameFor } from '../lib/i18n.js'
import { exerciseDetailSheetNoAdd } from '../sheets.jsx'
import Icon from './Icon.jsx'
import { Button } from './ui.jsx'
import { t } from '../lib/i18n.js'
import { obtenerAlternativas as obtenerAlternativasNormal, obtenerMasAlternativas as obtenerMasAlternativasNormal, buscarEnGrupoMuscular } from '../lib/generarRutina.js'

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
      return buscarEstiramientos(query, poolSeguro, exActualObj.tg, usadosEnSemana)
    }
    return buscarEnGrupoMuscular(query, poolSeguro, exActualObj.tg, usadosEnSemana)
  }, [query, poolSeguro, exActualObj.tg, usadosEnSemana, tipo])

  const listaAMostrar = resultadosBusqueda !== null ? resultadosBusqueda : [...altsIniciales, ...masAlts]

  return <>
    <h3>{t('Reemplazar {0}', nombreActual)}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {tipo === 'cardio' ? t('Seleccioná una alternativa de cardio según tu equipo disponible:') :
       tipo === 'stretch' ? t('Seleccioná un estiramiento alternativo:') :
       t('Seleccioná una alternativa equivalente para este ejercicio:')}
    </div>

    {listaAMostrar.length === 0 ? (
      <div className="muted" style={{ padding: '16px 0' }}>
        {query ? t('No se encontraron ejercicios.') : t('No hay otras alternativas disponibles.')}
      </div>
    ) : (
      <div className="list" style={{ maxHeight: 260, overflowY: 'auto' }}>
        {listaAMostrar.map(alt => {
          const nombreAlt = exerciseNameFor(alt) || alt.n || alt.id
          return (
            <div key={alt.id} className="item" onClick={() => exerciseDetailSheetNoAdd(alt)}>
              <span className="lrow-i"><Icon name="dumbbell" /></span>
              <div className="grow">
                <div className="tt">{nombreAlt}</div>
                <div className="ss">{alt.eq || alt.bp || ''}</div>
              </div>
              <button
                className="tag acc"
                style={{ background: 'var(--acc-soft)', color: 'var(--acc)', border: 'none', cursor: 'pointer', borderRadius: 6, padding: '4px 10px', fontSize: 13, fontWeight: 600 }}
                onClick={e => { e.stopPropagation(); onReemplazar(alt); close() }}
              >
                {t('Elegir')}
              </button>
            </div>
          )
        })}
      </div>
    )}

    {!query && !verMasCargado && listaAMostrar.length > 0 && (
      <div style={{ margin: '10px 0 6px' }}>
        <Button size="sm" variant="tinted" icon="plus" onClick={cargarMas} style={{ width: '100%' }}>
          {t('Ver más alternativas (+5)')}
        </Button>
      </div>
    )}

    <div style={{ marginTop: 12 }}>
      <input
        className="input"
        type="text"
        placeholder={tipo === 'cardio' ? t('Buscar cardio...') :
                     tipo === 'stretch' ? t('Buscar estiramientos...') :
                     t('Buscar en {0}...', exActualObj.tg || t('mismo grupo'))}
        value={query}
        onChange={e => setQuery(e.target.value)}
        style={{ fontSize: 14 }}
      />
    </div>

    <div style={{ height: 12 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancelar')}</Button>
  </>
}

// Funciones para alternativas de cardio
function obtenerAlternativasCardio(ejercicioActual, poolSeguro = [], idsUsadosEnLaSemana = new Set(), n = 3) {
  const idsSet = idsUsadosEnLaSemana instanceof Set ? idsUsadosEnLaSemana : new Set(idsUsadosEnLaSemana || [])
  const actualId = ejercicioActual.id || ejercicioActual.exerciseId

  // Filtrar ejercicios de cardio que no sean el actual y no estén usados
  let candidatos = poolSeguro.filter(e =>
    e.bp === 'cardio' &&
    e.id !== actualId &&
    !idsSet.has(e.id)
  )

  return candidatos.slice(0, n)
}

function obtenerMasAlternativasCardio(ejercicioActual, poolSeguro = [], idsUsadosEnLaSemana = new Set(), yaMostrados = new Set(), n = 5) {
  const idsSet = idsUsadosEnLaSemana instanceof Set ? idsUsadosEnLaSemana : new Set(idsUsadosEnLaSemana || [])
  const mostradosSet = yaMostrados instanceof Set ? yaMostrados : new Set(yaMostrados || [])
  const actualId = ejercicioActual.id || ejercicioActual.exerciseId

  return poolSeguro
    .filter(e =>
      e.bp === 'cardio' &&
      e.id !== actualId &&
      !idsSet.has(e.id) &&
      !mostradosSet.has(e.id)
    )
    .slice(0, n)
}

function buscarCardio(query, poolSeguro = [], idsUsadosEnLaSemana = new Set()) {
  if (!query || !query.trim()) return []
  const idsSet = idsUsadosEnLaSemana instanceof Set ? idsUsadosEnLaSemana : new Set(idsUsadosEnLaSemana || [])
  const q = query.toLowerCase()

  return poolSeguro.filter(e =>
    e.bp === 'cardio' &&
    !idsSet.has(e.id) &&
    (e.n?.toLowerCase().includes(q) || e.id?.toLowerCase().includes(q))
  )
}

// Funciones para alternativas de estiramientos
function obtenerAlternativasEstiramientos(ejercicioActual, poolSeguro = [], idsUsadosEnLaSemana = new Set(), n = 3) {
  const idsSet = idsUsadosEnLaSemana instanceof Set ? idsUsadosEnLaSemana : new Set(idsUsadosEnLaSemana || [])
  const actualId = ejercicioActual.id || ejercicioActual.exerciseId
  const targetTg = ejercicioActual.tg

  // Filtrar estiramientos del mismo grupo muscular
  let candidatos = poolSeguro.filter(e => {
    const n = (e.n || '').toLowerCase()
    const esSt = n.includes('stretch') || n.includes('stretching') || n.includes('yoga') || n.includes('mobility')
    return esSt &&
           e.tg === targetTg &&
           e.id !== actualId &&
           !idsSet.has(e.id)
  })

  return candidatos.slice(0, n)
}

function obtenerMasAlternativasEstiramientos(ejercicioActual, poolSeguro = [], idsUsadosEnLaSemana = new Set(), yaMostrados = new Set(), n = 5) {
  const idsSet = idsUsadosEnLaSemana instanceof Set ? idsUsadosEnLaSemana : new Set(idsUsadosEnLaSemana || [])
  const mostradosSet = yaMostrados instanceof Set ? yaMostrados : new Set(yaMostrados || [])
  const actualId = ejercicioActual.id || ejercicioActual.exerciseId
  const targetTg = ejercicioActual.tg

  return poolSeguro.filter(e => {
    const n = (e.n || '').toLowerCase()
    const esSt = n.includes('stretch') || n.includes('stretching') || n.includes('yoga') || n.includes('mobility')
    return esSt &&
           e.tg === targetTg &&
           e.id !== actualId &&
           !idsSet.has(e.id) &&
           !mostradosSet.has(e.id)
  }).slice(0, n)
}

function buscarEstiramientos(query, poolSeguro = [], tg, idsUsadosEnLaSemana = new Set()) {
  if (!query || !query.trim()) return []
  const idsSet = idsUsadosEnLaSemana instanceof Set ? idsUsadosEnLaSemana : new Set(idsUsadosEnLaSemana || [])
  const q = query.toLowerCase()

  return poolSeguro.filter(e => {
    const n = (e.n || '').toLowerCase()
    const esSt = n.includes('stretch') || n.includes('stretching') || n.includes('yoga') || n.includes('mobility')
    return esSt &&
           e.tg === tg &&
           !idsSet.has(e.id) &&
           (n.includes(q) || e.id?.toLowerCase().includes(q))
  })
}

export default ExerciseReplacementSheet