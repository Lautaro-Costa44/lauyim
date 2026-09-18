import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { api } from '../lib/api.js'
import { calcularMetasNutricionales } from '../lib/nutricion.js'
import { useStore } from '../store/useStore.js'

const HISTORY_CACHE_KEY = 'gym_nutrition_history_v1:30'
const readHistoryCache = () => {
  try {
    const cached = JSON.parse(localStorage.getItem(HISTORY_CACHE_KEY) || 'null')
    return cached && Array.isArray(cached.items) ? cached.items : null
  } catch { return null }
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatDate(fecha) {
  const date = new Date(fecha + 'T12:00:00')
  const parts = date.toLocaleDateString('es-AR', {
    weekday: 'long',
    day: '2-digit',
    month: 'long'
  }).replace(',', '').split(' ')

  return `${capitalize(parts[0])} ${parts[1]} de ${capitalize(parts[3])}`
}

function formatMacros(dia) {
  return `${Math.round(Number(dia.calorias || 0))} kcal · ` +
    `${Number(dia.proteina || 0).toFixed(1)} g prot. · ` +
    `${Number(dia.carbohidratos || 0).toFixed(1)} g carb. · ` +
    `${Number(dia.grasas || 0).toFixed(1)} g grasas`
}

function MacroBar({ label, actual, target }) {
  const percentage = target > 0 ? Math.round(actual / target * 100) : 0
  const width = Math.min(percentage, 100)

  return <div style={{ marginTop: 14 }}>
    <div className="row between small" style={{ marginBottom: 6 }}>
      <span>{label}</span>
      <span className="muted">{percentage}% / 100%</span>
    </div>
    <div style={{ height: 9, background: 'var(--surface-2)', borderRadius: 99, position: 'relative' }}>
      <div style={{ width: `${width}%`, height: '100%', background: 'var(--label)', borderRadius: 99 }} />
      <div style={{ position: 'absolute', left: 'calc(100% - 2px)', top: -3, width: 2, height: 15, background: 'var(--acc)', borderRadius: 2 }} />
    </div>
  </div>
}

export default function HistorialNutricion({ close, S }) {
  const [dias, setDias] = useState([])
  const [loading, setLoading] = useState(true)
  const historyEntryRef = useRef(false)
  const closingRef = useRef(false)

  const automaticoHabilitado = useStore(s => s.config?.nutricion_automatico) !== false
  const { sugerido, metaProteina, carbosMeta, grasasMeta, sinMetas } = calcularMetasNutricionales(S, { automaticoHabilitado })
  const total = dias.reduce((result, dia) => ({
    calorias: result.calorias + Number(dia.calorias || 0),
    proteina: result.proteina + Number(dia.proteina || 0),
    carbohidratos: result.carbohidratos + Number(dia.carbohidratos || 0),
    grasas: result.grasas + Number(dia.grasas || 0)
  }), { calorias: 0, proteina: 0, carbohidratos: 0, grasas: 0 })

  const promedio = {
    calorias: total.calorias / 30,
    proteina: total.proteina / 30,
    carbohidratos: total.carbohidratos / 30,
    grasas: total.grasas / 30
  }

  const cerrar = useCallback((fromPopstate = false) => {
    if (closingRef.current) return
    closingRef.current = true
    if (historyEntryRef.current) {
      historyEntryRef.current = false
      if (!fromPopstate) window.history.back()
    }
    close()
  }, [close])

  useEffect(() => {
    historyEntryRef.current = true
    window.history.pushState({ ...(window.history.state || {}), historialNutricion: true }, '', window.location.href)
    const onPopState = () => {
      // The global sheet manager ignores locked sheets on back. This screen
      // owns the next back action and must close before the page can navigate.
      cerrar(true)
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
      if (!closingRef.current && historyEntryRef.current) {
        historyEntryRef.current = false
        window.history.back()
      }
    }
  }, [cerrar])

  useEffect(() => {
    const cached = readHistoryCache()
    if (cached) { setDias(cached); setLoading(false) }
    api('/api/comidas/historial?dias=30')
      .then(next => { const items = Array.isArray(next) ? next : []; setDias(items); localStorage.setItem(HISTORY_CACHE_KEY, JSON.stringify({ at: Date.now(), items })) })
      .catch(() => { if (!cached) setDias([]) })
      .finally(() => setLoading(false))
  }, [])

  return <div className="nutrition-history">
    <div className="hdr">
      <div>
        <h1>Historial de nutrición</h1>
        <div className="sub">Últimos 30 días</div>
      </div>
      <button className="iconbtn" onClick={() => cerrar()} aria-label="Cerrar">
        <Icon name="xmark" />
      </button>
    </div>

    {!loading && <>
      <div className="card">
        <h2 style={{ marginBottom: 4 }}>Cumplimiento nutricional promedio</h2>
        <div className="small muted">Promedio diario de los últimos 30 días</div>
        {sinMetas
          ? <div className="dim small" style={{ marginTop: 10 }}>Todavía no tenés metas nutricionales configuradas.</div>
          : <>
            <MacroBar label="Calorías" actual={promedio.calorias} target={sugerido} />
            <MacroBar label="Proteínas" actual={promedio.proteina} target={metaProteina} />
            <MacroBar label="Carbohidratos" actual={promedio.carbohidratos} target={carbosMeta} />
            <MacroBar label="Grasas" actual={promedio.grasas} target={grasasMeta} />
          </>}
      </div>

      <div style={{ height: 'var(--hair)', background: 'var(--sep)', margin: '16px 14px' }} />

      {dias.length ? <div className="card">
        {dias.map((dia, index) => <div key={dia.fecha} style={{ padding: '14px 0', borderBottom: index === dias.length - 1 ? 0 : '1px solid var(--sep)' }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>{formatDate(dia.fecha)}</div>
          <div className="small muted">{formatMacros(dia)}</div>
        </div>)}
      </div> : <div className="card muted">No hay comidas registradas.</div>}
    </>}
  </div>
}
