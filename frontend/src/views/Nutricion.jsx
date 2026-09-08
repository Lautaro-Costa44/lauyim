import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import LineChart from '../components/LineChart.jsx'
import { Button, Row, Section, Segmented, SelectRow } from '../components/ui.jsx'
import { bwSheet, goalSheet } from '../sheets.jsx'
import { fmtNum } from '../lib/format.js'
import { calcularMetasNutricionales, calcularMetasMacros, calcularNutrientesPorCantidad, porcionAGramos } from '../lib/nutricion.js'
import ResumenNutricional from '../components/ResumenNutricional.jsx'
import ScannerCodigoBarras from '../components/ScannerCodigoBarras.jsx'
import { api } from '../lib/api.js'
import { todayISO } from '../lib/format.js'
import { useUI } from '../store/useUI.js'

function caloricInfoSheet(close) {
  return <>
    <h3>{t('¿Cómo se calcula?')}</h3>
    <div className="muted small" style={{ lineHeight: 1.65, marginBottom: 16 }}>
      <p style={{ marginBottom: 10 }}>{t('Se usa la fórmula Mifflin-St Jeor, la más recomendada por el ACSM para estimar el metabolismo basal:')}</p>
      <p style={{ fontFamily: 'monospace', background: 'var(--surface-3)', borderRadius: 8, padding: '10px 12px', marginBottom: 10, lineHeight: 1.8 }}>
        <b>{t('Hombres:')}</b> 10×kg + 6.25×cm − 5×edad + 5<br />
        <b>{t('Mujeres:')}</b> 10×kg + 6.25×cm − 5×edad − 161
      </p>
      <p>{t('El resultado se multiplica por un factor de actividad según tus días de entrenamiento (1.2 a 1.55), y luego se ajusta según tu objetivo (+12.5% para ganar músculo, −17.5% para perder grasa).')}</p>
    </div>
    <Button onClick={close}>{t('Entendido')}</Button>
  </>
}

function CaloricCard({ S }) {
  const { peso, altura, edad, objetivo, tmb, mantenimiento, sugerido, metaProteina } = calcularMetasNutricionales(S)
  const objMetaMap = { hipertrofia: t('Ganar Músculo'), fuerza: t('Ganar Fuerza'), perder_grasa: t('Perder Grasa'), fitness_general: t('Mantener Peso') }
  const openInfo = () => useUI.getState().openSheet(close => caloricInfoSheet(close))
  return <div style={{ marginTop: 16 }}>
    <div className="row between" style={{ marginBottom: 10 }}><h2 style={{ margin: 0 }}>{t('Tus calorías diarias')}</h2><button className="helpbtn" aria-label={t('¿Cómo se calcula?')} onClick={openInfo}><Icon name="info" /></button></div>
    <div style={{ background: 'var(--surface-2)', borderRadius: 10, overflow: 'hidden', marginBottom: 12 }}>
      <div className="row between" style={{ padding: '11px 14px' }}><span style={{ fontSize: 15, color: 'var(--label-2)' }}>{t('En reposo')}</span><span style={{ fontWeight: 500 }}>{tmb.toLocaleString()} <span className="dim small">kcal</span></span></div>
      <div style={{ height: 'var(--hair)', background: 'var(--sep)', margin: '0 14px' }} />
      <div className="row between" style={{ padding: '11px 14px' }}><span style={{ fontSize: 15, color: 'var(--label-2)' }}>{t('Gasto total diario')}</span><span style={{ fontWeight: 500 }}>~{mantenimiento.toLocaleString()} <span className="dim small">kcal</span></span></div>
    </div>
    <div style={{ background: 'var(--acc-soft)', borderRadius: 12, padding: '14px 16px', textAlign: 'center', marginBottom: 10 }}><div style={{ fontSize: 13, color: 'var(--acc)', fontWeight: 600, marginBottom: 6, letterSpacing: '-.006em' }}>🎯 {t('Meta para {0}', objMetaMap[objetivo] || objetivo)}</div><div style={{ fontSize: 36, fontWeight: 700, letterSpacing: '-.028em', color: 'var(--acc)', lineHeight: 1 }}>{sugerido.toLocaleString()}</div><div className="dim small" style={{ marginTop: 4 }}>kcal / día</div></div>
    <div className="row between" style={{ padding: '11px 14px', background: 'var(--surface-2)', borderRadius: 10, marginBottom: 12 }}><span style={{ fontSize: 15, color: 'var(--label-2)' }}>{t('Meta de proteína')}</span><span style={{ fontWeight: 500 }}>{metaProteina.toLocaleString()} <span className="dim small">g / día</span></span></div>
    <div className="small dim" style={{ lineHeight: 1.45 }}>{t('Calculado para {0} kg, {1} cm, {2} años y tus días de entrenamiento.', fmtNum(peso), altura, edad)}</div>
  </div>
}

const FRANJAS = [
  { value: 'desayuno', label: 'Desayuno' }, { value: 'almuerzo', label: 'Almuerzo' },
  { value: 'merienda', label: 'Merienda' }, { value: 'cena', label: 'Cena' }, { value: 'extra', label: 'Extra' },
]

function MealForm({ alimento, franja, close, onSaved }) {
  const [mealFranja, setMealFranja] = useState(franja)
  const [modo, setModo] = useState('porciones')
  const [porcion, setPorcion] = useState(1)
  const [gramos, setGramos] = useState(porcionAGramos(1))
  const [saving, setSaving] = useState(false)
  const nutrientes = calcularNutrientesPorCantidad(alimento, gramos)
  const setQuick = p => { setModo('porciones'); setPorcion(p); setGramos(porcionAGramos(p)) }
  const save = async () => {
    if (!(gramos > 0)) return
    setSaving(true)
    try {
      await api('/api/comidas', { method: 'POST', body: JSON.stringify({ fecha: todayISO(), franja: mealFranja, nombre_alimento: alimento.nombre, cantidad_gramos: gramos, ...nutrientes }) })
      onSaved(); close()
    } catch { setSaving(false) }
  }
  return <>
    <h3>{alimento.nombre}</h3>
    {alimento.marca && <div className="dim small" style={{ marginBottom: 14 }}>{alimento.marca}</div>}
    <SelectRow title="Franja" value={mealFranja} options={FRANJAS} onChange={setMealFranja} sheetTitle="Elegir franja" />
    <div className="small dim" style={{ marginBottom: 8 }}>Cantidad</div>
    <Segmented value={modo} onChange={setModo} options={[{ value: 'porciones', label: 'Porciones' }, { value: 'manual', label: 'Manual' }]} />
    {modo === 'porciones' ? <div className="meal-quick">{[0.5, 1, 1.5, 2].map(p => <button key={p} className={porcion === p ? 'on' : ''} onClick={() => setQuick(p)}>{p} porción{p === 1 ? '' : 'es'}</button>)}</div> : <label className="meal-grams">Gramos<input type="number" min="0" value={gramos} onChange={e => { setModo('manual'); setGramos(Math.max(0, Number(e.target.value) || 0)) }} /></label>}
    <div className="nutri-live row between"><span>{gramos} g</span><span>{nutrientes.calorias} kcal · {nutrientes.proteina.toFixed(1)} g prot. · {nutrientes.carbohidratos.toFixed(1)} g carb. · {nutrientes.grasas.toFixed(1)} g grasas</span></div>
    <Button variant="primary" disabled={saving || !(gramos > 0)} onClick={save}>{saving ? 'Guardando…' : 'Confirmar'}</Button>
  </>
}

function FoodPicker({ franja, close, onSaved }) {
  const [tab, setTab] = useState('buscar')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (tab !== 'buscar' || query.trim().length < 2) { setResults([]); return undefined }
    const timer = setTimeout(() => api('/api/alimentos/buscar?q=' + encodeURIComponent(query.trim())).then(d => setResults(Array.isArray(d) ? d : d.alimentos || [])).catch(() => setResults([])), 400)
    return () => clearTimeout(timer)
  }, [query, tab])
  const pick = alimento => setSelected(alimento)
  const scan = async codigo => {
    try { setError(''); pick(await api('/api/alimentos/codigo/' + encodeURIComponent(codigo))) }
    catch (e) { if (e.status === 404) { setError('Producto no encontrado, probá buscarlo por nombre'); setTab('buscar') } else setError('No se pudo consultar el producto') }
  }
  if (selected) return <MealForm alimento={selected} franja={franja} close={close} onSaved={onSaved} />
  return <>
    <h3>Agregar comida</h3>
    <Segmented value={tab} onChange={v => { setError(''); setTab(v) }} options={[{ value: 'buscar', label: 'Buscar por nombre' }, { value: 'scan', label: 'Escanear código' }]} />
    {error && <p className="small" style={{ color: 'var(--acc-2)' }}>{error}</p>}
    {tab === 'buscar' ? <><input className="field" autoFocus placeholder="Buscar alimento…" value={query} onChange={e => setQuery(e.target.value)} />
      <div className="food-results">{results.map((a, i) => <Row key={`${a.nombre}-${i}`} title={a.nombre} subtitle={a.marca || 'Sin marca'} onClick={() => pick(a)} accessory="chevron" />)}</div></> : <ScannerCodigoBarras onScan={scan} onCancel={() => setTab('buscar')} />}
  </>
}

export default function Nutricion() {
  const S = useStore(s => s.S)
  const [range, setRange] = useState(90)
  const now = Date.now()
  const bwPts = (S.bodyweight || []).filter(b => range === 0 || (b.t || new Date(b.d).getTime()) > now - range * 86400000).map(b => ({ t: b.t || new Date(b.d).getTime(), y: b.w, d: b.d }))
  const [comidas, setComidas] = useState([])
  const [loadingComidas, setLoadingComidas] = useState(true)
  const { sugerido, metaProteina } = calcularMetasNutricionales(S)
  const { grasasMeta, carbosMeta } = calcularMetasMacros(sugerido, metaProteina)
  const loadComidas = () => { setLoadingComidas(true); api('/api/comidas?fecha=' + todayISO()).then(setComidas).catch(() => setComidas([])).finally(() => setLoadingComidas(false)) }
  useEffect(() => { loadComidas() }, [])
  const totals = useMemo(() => comidas.reduce((a, c) => ({ calorias: a.calorias + Number(c.calorias || 0), proteina: a.proteina + Number(c.proteina || 0), carbos: a.carbos + Number(c.carbohidratos || 0), grasas: a.grasas + Number(c.grasas || 0) }), { calorias: 0, proteina: 0, carbos: 0, grasas: 0 }), [comidas])
  const addMeal = franja => useUI.getState().openSheet(close => <FoodPicker franja={franja} close={close} onSaved={loadComidas} />)
  const removeMeal = async id => { await api('/api/comidas/' + id, { method: 'DELETE' }); loadComidas() }

  return <>
    <div className="hdr">
      <div><h1>{t('Nutrición')}</h1><div className="sub">{t('Tus metas diarias')}</div></div>
      <Icon name="apple" />
    </div>

    <div className="card">
      <div className="row between" style={{ marginBottom: 8 }}><h2 style={{ margin: 0 }}>{t('Body weight')}</h2><div className="row" style={{ gap: 8 }}><Button size="sm" icon="target" style={S.targetW ? { color: 'var(--yellow)' } : undefined} onClick={goalSheet}>{S.targetW ? fmtNum(S.targetW) : t('Goal')}</Button><Button size="sm" icon="plus" onClick={() => bwSheet()}>{t('Log')}</Button></div></div>
      <Segmented className="seg-range" value={range} onChange={setRange} options={[{ value: 30, label: '1M' }, { value: 90, label: '3M' }, { value: 365, label: '1Y' }, { value: 0, label: t('All') }]} />
      <div className="chart"><LineChart points={bwPts} h={160} unit={S.unit} goal={S.targetW} /></div>
      <CaloricCard S={S} />
    </div>

    <div className="card">
      <h2>Resumen nutricional de hoy</h2>
      <ResumenNutricional caloriasConsumidas={totals.calorias} caloriasMeta={sugerido} proteinaConsumida={totals.proteina} proteinaMeta={metaProteina} carbosConsumidos={totals.carbos} carbosMeta={carbosMeta} grasasConsumidas={totals.grasas} grasasMeta={grasasMeta} />
    </div>
    {loadingComidas ? <div className="card muted small">Cargando comidas…</div> : FRANJAS.map(franja => {
      const rows = comidas.filter(c => c.franja === franja.value)
      return <Section key={franja.value} title={franja.label} footer={<Button size="sm" icon="plus" onClick={() => addMeal(franja.value)}>Agregar</Button>}>
        {rows.length ? rows.map(c => <Row key={c.id} title={c.nombre_alimento} subtitle={`${c.cantidad_gramos} g · ${Math.round(c.calorias)} kcal`}><button className="iconbtn meal-delete" aria-label="Eliminar comida" onClick={() => removeMeal(c.id)}>×</button></Row>) : <div className="meal-empty">Sin comidas registradas</div>}
      </Section>
    })}
  </>
}
