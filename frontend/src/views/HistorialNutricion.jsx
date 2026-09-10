import { useEffect, useState } from 'react'
import Icon from '../components/Icon.jsx'
import { api } from '../lib/api.js'

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

export default function HistorialNutricion({ close }) {
  const [dias, setDias] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api('/api/comidas/historial?dias=30')
      .then(setDias)
      .catch(() => setDias([]))
      .finally(() => setLoading(false))
  }, [])

  return <div className="nutrition-history">
    <div className="hdr">
      <div>
        <h1>Historial de nutrición</h1>
        <div className="sub">Últimos 30 días</div>
      </div>
      <button className="iconbtn" onClick={close} aria-label="Cerrar">
        <Icon name="xmark" />
      </button>
    </div>

    {loading ? <div className="card muted small">Cargando historial…</div> : dias.length ? <div className="card">
      {dias.map((dia, index) => <div key={dia.fecha} style={{ padding: '14px 0', borderBottom: index === dias.length - 1 ? 0 : '1px solid var(--sep)' }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>{formatDate(dia.fecha)}</div>
        <div className="small muted">{formatMacros(dia)}</div>
      </div>)}
    </div> : <div className="card muted">No hay comidas registradas.</div>}
  </div>
}
