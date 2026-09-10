import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import LineChart from '../components/LineChart.jsx'
import { Button, Row, Section, Segmented, SelectRow } from '../components/ui.jsx'
import { bwSheet, goalSheet, confirmSheet } from '../sheets.jsx'
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

const NO_AUTOFILL = {
  autoComplete: 'off', autoCorrect: 'off', autoCapitalize: 'none', spellCheck: false,
  'data-lpignore': 'true', 'data-1p-ignore': 'true', 'data-bwignore': 'true', 'data-form-type': 'other',
}

function MealForm({ alimento, franja, close, onBack, onSaved, onAddIngrediente, onAdded }) {
  const [mealFranja, setMealFranja] = useState(franja)
  const [modo, setModo] = useState('porciones')
  const [porcion, setPorcion] = useState(1)
  const [unidades, setUnidades] = useState(1)
  const [gramos, setGramos] = useState(porcionAGramos(1))
  const [saving, setSaving] = useState(false)
  const nutrientes = calcularNutrientesPorCantidad(alimento, gramos)
  const setQuick = p => { setModo('porciones'); setPorcion(p); setGramos(porcionAGramos(p)) }
  const setUnitCount = value => {
    const next = Math.max(1, Math.round(Number(value) || 0))
    setUnidades(next)
    setGramos(next * alimento.gramosPorUnidad)
  }
  const unitLabel = alimento.unidadLabel || 'unidad'
  const pluralUnitLabel = { huevo: 'huevos', rodaja: 'rodajas', banana: 'bananas', manzana: 'manzanas', porción: 'porciones' }[unitLabel] || `${unitLabel}s`
  const setMode = value => {
    setModo(value)
    if (value === 'unidades') setGramos(unidades * alimento.gramosPorUnidad)
  }
  const save = async () => {
    if (!(gramos > 0)) return
    setSaving(true)
    try {
      const ingrediente = { nombre_alimento: alimento.nombre, cantidad_gramos: gramos, ...nutrientes }
      if (onAddIngrediente) {
        onAddIngrediente(ingrediente)
        onAdded?.()
        onBack()
      } else {
        await api('/api/comidas', { method: 'POST', body: JSON.stringify({ fecha: todayISO(), franja: mealFranja, ...ingrediente }) })
        onSaved(); close()
      }
    } catch { setSaving(false) }
  }
  return <>
    <div className="row between">
      <h3 style={{ margin: 0 }}>{alimento.nombre}</h3>
      <button type="button" className="iconbtn" onClick={onBack} aria-label="Volver"><Icon name="xmark" /></button>
    </div>
    {alimento.marca && <div className="dim small" style={{ marginBottom: 14 }}>{alimento.marca}</div>}
    {!onAddIngrediente && <SelectRow title="Franja" value={mealFranja} options={FRANJAS} onChange={setMealFranja} sheetTitle="Elegir franja" />}
    <div className="small dim" style={{ marginBottom: 8 }}>Cantidad</div>
    <Segmented value={modo} onChange={setMode} options={[{ value: 'porciones', label: 'Porciones' }, ...(alimento.gramosPorUnidad !== undefined ? [{ value: 'unidades', label: 'Unidades' }] : []), { value: 'manual', label: 'Manual' }]} />
    {modo === 'porciones' ? <div className="meal-quick">{[0.5, 1, 1.5, 2].map(p => <button key={p} className={porcion === p ? 'on' : ''} onClick={() => setQuick(p)}>{p} porción{p === 1 ? '' : 'es'}</button>)}</div> : modo === 'unidades' ? <div className="meal-quick meal-units"><button type="button" onClick={() => setUnitCount(unidades - 1)} aria-label="Restar unidad">-</button><span>{unidades} {unidades === 1 ? unitLabel : pluralUnitLabel}</span><button type="button" onClick={() => setUnitCount(unidades + 1)} aria-label="Sumar unidad">+</button></div> : <label className="meal-grams">Gramos<input {...NO_AUTOFILL} name="app-meal-grams" className="field" type="number" min="0" value={gramos} onChange={e => { setModo('manual'); setGramos(Math.max(0, Number(e.target.value) || 0)) }} /></label>}
    <div className="nutri-live row between"><span>{gramos} g</span><span>{nutrientes.calorias} kcal · {nutrientes.proteina.toFixed(1)} g prot. · {nutrientes.carbohidratos.toFixed(1)} g carb. · {nutrientes.grasas.toFixed(1)} g grasas</span></div>
    <Button variant="primary" disabled={saving || !(gramos > 0)} onClick={save}>{saving ? 'Guardando…' : 'Confirmar'}</Button>
  </>
}

function ManualFoodForm({ franja, close, onBack, onSaved, onAddIngrediente }) {
  const [nombre, setNombre] = useState('')
  const [gramos, setGramos] = useState('100')
  const [calorias, setCalorias] = useState('')
  const [proteina, setProteina] = useState('')
  const [carbohidratos, setCarbohidratos] = useState('')
  const [grasas, setGrasas] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const save = async event => {
    event.preventDefault()
    const rawValues = [gramos, calorias, proteina, carbohidratos, grasas]
    const values = rawValues.map(Number)
    if (!nombre.trim() || rawValues.some(value => String(value).trim() === '') || values.some(value => !Number.isFinite(value) || value < 0) || values[0] <= 0) {
      setError('Completá el nombre y todos los valores nutricionales con números válidos.')
      return
    }
    setSaving(true)
    try {
      const ingrediente = {
        nombre_alimento: nombre.trim(), cantidad_gramos: values[0],
        calorias: values[1] * values[0] / 100, proteina: values[2] * values[0] / 100,
        carbohidratos: values[3] * values[0] / 100, grasas: values[4] * values[0] / 100,
      }
      if (onAddIngrediente) {
        onAddIngrediente(ingrediente)
      } else await api('/api/comidas', { method: 'POST', body: JSON.stringify({
        fecha: todayISO(), franja, nombre_alimento: nombre.trim(), cantidad_gramos: values[0],
        calorias: values[1] * values[0] / 100, proteina: values[2] * values[0] / 100,
        carbohidratos: values[3] * values[0] / 100, grasas: values[4] * values[0] / 100,
      }) })
      if (!onAddIngrediente) { onSaved(); close() }
    } catch { setError('No se pudo guardar la comida. Intentá nuevamente.'); setSaving(false) }
  }
  return <form className="manual-food" onSubmit={save}>
    <div className="manual-food-header">
      {onAddIngrediente && <button type="button" className="iconbtn" onClick={onBack} aria-label="Volver"><Icon name="chevronLeft" /></button>}
      <h3>Ingreso Manual</h3>
    </div>
    {error && <p className="small" style={{ color: 'var(--acc-2)' }}>{error}</p>}
    <label>Nombre<input {...NO_AUTOFILL} className="field" type="search" name="alimento-manual-nombre" inputMode="search" value={nombre} onChange={event => setNombre(event.target.value)} /></label>
    <div className="manual-food-grid">
    <label>Gramos<input {...NO_AUTOFILL} name="app-food-grams" className="field" type="number" min="1" inputMode="decimal" value={gramos} onChange={event => setGramos(event.target.value)} /></label>
    <label>Calorías / 100 g<input {...NO_AUTOFILL} name="app-food-calories" className="field" type="number" min="0" inputMode="decimal" value={calorias} onChange={event => setCalorias(event.target.value)} /></label>
    <label>Proteínas / 100 g<input {...NO_AUTOFILL} name="app-food-protein" className="field" type="number" min="0" inputMode="decimal" value={proteina} onChange={event => setProteina(event.target.value)} /></label>
    <label>Carbohidratos / 100 g<input {...NO_AUTOFILL} name="app-food-carbs" className="field" type="number" min="0" inputMode="decimal" value={carbohidratos} onChange={event => setCarbohidratos(event.target.value)} /></label>
    <label>Grasas / 100 g<input {...NO_AUTOFILL} name="app-food-fat" className="field" type="number" min="0" inputMode="decimal" value={grasas} onChange={event => setGrasas(event.target.value)} /></label>
    </div>
    <Button type="submit" size="sm" variant="tinted" disabled={saving}>{saving ? 'Guardando…' : 'Guardar comida'}</Button>
  </form>
}

function FoodPicker({ franja, close, onSaved, onAddIngrediente, onAdded }) {
  const [tab, setTab] = useState('buscar')
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [selected, setSelected] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const requestRef = useRef(0)
  useEffect(() => {
    if (tab !== 'buscar' || query.trim().length < 2) {
      requestRef.current += 1
      setResults([])
      setLoading(false)
      return undefined
    }
    const requestId = ++requestRef.current
    setLoading(true)
    setError('')
    const timer = setTimeout(() => api('/api/alimentos/buscar?q=' + encodeURIComponent(query.trim())).then(d => {
      if (requestId === requestRef.current) setResults(Array.isArray(d) ? d : d.alimentos || [])
    }).catch(() => {
      if (requestId === requestRef.current) { setResults([]); setError('No se pudo buscar. Podés ingresar el alimento manualmente.') }
    }).finally(() => { if (requestId === requestRef.current) setLoading(false) }), 400)
    return () => clearTimeout(timer)
  }, [query, tab])
  const pick = useCallback(async alimento => {
    if (alimento?.tipo === 'plantilla_comida') {
      if (onAddIngrediente) return
      confirmSheet({
        title: '¿Agregar comida compuesta?',
        message: `“${alimento.nombre}” se agregará a ${franja}.`,
        confirmText: 'Agregar',
        variant: 'meal',
        onConfirm: async () => {
          try {
            await api('/api/comidas/grupo', { method: 'POST', body: JSON.stringify({
              grupo_nombre: alimento.nombre, franja, fecha: todayISO(), ingredientes: alimento.ingredientes,
            }) })
            onSaved()
            close()
          } catch {
            setError('No se pudo agregar la comida compuesta. Intentá nuevamente.')
          }
        },
      })
      return
    }
    setSelected(alimento)
  }, [close, franja, onAddIngrediente, onSaved])
  const scan = useCallback(async codigo => {
    try { setError(''); pick(await api('/api/alimentos/codigo/' + encodeURIComponent(codigo))) }
    catch (e) { setError(e.status === 404 ? 'Producto no encontrado. Podés ingresar sus datos manualmente.' : 'No se pudo consultar el producto. Podés ingresarlo manualmente.') }
  }, [pick])
  const addIngrediente = useCallback(ingrediente => {
    onAddIngrediente(ingrediente)
    setSelected(null)
    setTab('buscar')
    setQuery('')
    onAdded?.()
  }, [onAddIngrediente, onAdded])
  const visibleResults = onAddIngrediente ? results.filter(a => a.tipo !== 'plantilla_comida') : results
  if (selected) return <MealForm alimento={selected} franja={franja} close={close} onBack={() => setSelected(null)} onSaved={onSaved} onAddIngrediente={onAddIngrediente} onAdded={onAdded} />
  if (tab === 'manual') return <ManualFoodForm franja={franja} close={close} onBack={() => setTab('buscar')} onSaved={onSaved} onAddIngrediente={onAddIngrediente ? addIngrediente : undefined} />
  return <>
    <h3>Agregar comida</h3>
    <Segmented value={tab} onChange={v => { setError(''); setTab(v) }} options={[{ value: 'buscar', label: 'Buscar' }, { value: 'scan', label: 'Escanear' }, { value: 'manual', label: 'Manual' }]} />
    {error && <p className="small" style={{ color: 'var(--acc-2)' }}>{error}</p>}
    {tab === 'buscar' ? <><input {...NO_AUTOFILL} className="field food-search" type="search" name="food-search-query" inputMode="search" placeholder="Buscar alimento…" value={query} onChange={e => setQuery(e.target.value)} />
      <div className="food-results">{loading ? <div className="meal-empty">Buscando…</div> : visibleResults.length ? visibleResults.map((a, i) => <Row key={`${a.nombre}-${a.marca || ''}-${i}`} title={a.nombre} subtitle={a.tipo === 'plantilla_comida' ? 'Comida compuesta guardada' : (a.marca || 'Alimento genérico')} onClick={() => pick(a)} accessory="chevron" />) : query.trim().length >= 2 ? <div className="meal-empty">{results.length > visibleResults.length ? 'Hay comidas compuestas guardadas con ese nombre, pero no se pueden usar como ingrediente.' : 'Sin resultados. Podés ingresarlo manualmente.'}</div> : <div className="meal-empty">Escribí al menos 2 letras.</div>}</div></> : <ScannerCodigoBarras onScan={scan} onCancel={() => setTab('buscar')} />}
  </>
}

function ComidaCompuestaBuilder({ close, onSaved, plantillaId, initialNombre = '', initialIngredientes = [] }) {
  const esEdicion = plantillaId != null
  const [nombreComida, setNombreComida] = useState(initialNombre)
  const [franjaSeleccionada, setFranjaSeleccionada] = useState(FRANJAS[0].value)
  const [ingredientes, setIngredientes] = useState(initialIngredientes)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const historyEntryRef = useRef(false)
  const closingRef = useRef(false)
  const requestCloseRef = useRef(null)
  const initialStateRef = useRef(JSON.stringify({ nombre: initialNombre, ingredientes: initialIngredientes }))
  const totales = useMemo(() => ingredientes.reduce((total, ingrediente) => ({
    calorias: total.calorias + Number(ingrediente.calorias || 0),
    proteina: total.proteina + Number(ingrediente.proteina || 0),
    carbohidratos: total.carbohidratos + Number(ingrediente.carbohidratos || 0),
    grasas: total.grasas + Number(ingrediente.grasas || 0),
  }), { calorias: 0, proteina: 0, carbohidratos: 0, grasas: 0 }), [ingredientes])
  const hasUnsavedChanges = useMemo(() => JSON.stringify({ nombre: nombreComida, ingredientes }) !== initialStateRef.current, [nombreComida, ingredientes])
  const cleanupHistory = useCallback((fromPopstate = false) => {
    if (!historyEntryRef.current) return
    historyEntryRef.current = false
    if (!fromPopstate) window.history.back()
  }, [])
  const finishClose = useCallback((fromPopstate = false) => {
    if (closingRef.current) return
    closingRef.current = true
    cleanupHistory(fromPopstate)
    close()
  }, [cleanupHistory, close])
  const requestClose = useCallback((fromPopstate = false) => {
    if (closingRef.current) return
    if (!hasUnsavedChanges) return finishClose(fromPopstate)
    confirmSheet({
      title: '¿Salir de la comida compuesta?',
      message: 'Se perderán los cambios que todavía no guardaste.',
      confirmText: 'Descartar y salir',
      danger: true,
      variant: 'meal',
      onConfirm: () => finishClose(fromPopstate),
    })
  }, [finishClose, hasUnsavedChanges])
  requestCloseRef.current = requestClose
  useEffect(() => {
    historyEntryRef.current = true
    window.history.pushState({ ...(window.history.state || {}), comidaCompuestaBuilder: true }, '', window.location.href)
    const onPopState = event => {
      if (event.state?.comidaCompuestaBuilder) requestCloseRef.current(true)
    }
    window.addEventListener('popstate', onPopState)
    return () => {
      window.removeEventListener('popstate', onPopState)
      if (!closingRef.current) cleanupHistory()
    }
  }, [cleanupHistory])
  const save = async () => {
    if (!nombreComida.trim() || !ingredientes.length) return
    setSaving(true)
    setError('')
    try {
      if (esEdicion) {
        await api('/api/plantillas/' + encodeURIComponent(plantillaId), { method: 'PUT', body: JSON.stringify({
          nombre: nombreComida.trim(), ingredientes,
        }) })
      } else {
        await api('/api/comidas-compuestas', { method: 'POST', body: JSON.stringify({
          nombre: nombreComida.trim(), franja: franjaSeleccionada, fecha: todayISO(), ingredientes,
        }) })
      }
      onSaved()
      finishClose()
    } catch {
      setError('No se pudo guardar la comida compuesta. Intentá nuevamente.')
      setSaving(false)
    }
  }
  return <div className="compound-builder">
    <div className="compound-builder-content">
      <div className="row between compound-builder-header">
        <h3 style={{ margin: 0 }}>{esEdicion ? 'Editar alimento compuesto' : 'Crear alimento compuesto'}</h3>
        <button type="button" className="iconbtn" onClick={() => requestClose()} aria-label="Cerrar"><Icon name="xmark" /></button>
      </div>
      <Section title="Nombre de la comida" className="compound-builder-section">
        <label><input {...NO_AUTOFILL} className="field" type="search" name="comida-compuesta-nombre" inputMode="search" value={nombreComida} onChange={event => setNombreComida(event.target.value)} /></label>
        {!esEdicion && <SelectRow title="Franja" value={franjaSeleccionada} options={FRANJAS} onChange={setFranjaSeleccionada} sheetTitle="Elegir franja" />}
      </Section>
      <Section title="Ingredientes" className="compound-builder-section">
        {ingredientes.length ? ingredientes.map((ingrediente, index) => <div className="row between compound-ingredient" key={`${ingrediente.nombre_alimento}-${index}`}>
          <div><div>{ingrediente.nombre_alimento}</div><div className="dim small">{ingrediente.cantidad_gramos} g · {Math.round(ingrediente.calorias)} kcal · {Number(ingrediente.proteina).toFixed(1)} g prot. · {Number(ingrediente.carbohidratos).toFixed(1)} g carb. · {Number(ingrediente.grasas).toFixed(1)} g grasas</div></div>
          <button type="button" className="iconbtn" onClick={() => setIngredientes(prev => prev.filter((_, itemIndex) => itemIndex !== index))} aria-label="Quitar ingrediente">×</button>
        </div>) : <div className="meal-empty">Todavía no agregaste ingredientes.</div>}
        <div className="nutri-live row between compound-total"><span>Total</span><span>{Math.round(totales.calorias)} kcal · {totales.proteina.toFixed(1)} g prot. · {totales.carbohidratos.toFixed(1)} g carb. · {totales.grasas.toFixed(1)} g grasas</span></div>
      </Section>
      <Section title="Agregar ingredientes" className="compound-builder-section">
        {!pickerOpen ? <Button variant="tinted" onClick={() => setPickerOpen(true)}>+ Agregar ingrediente</Button> : <FoodPicker franja={franjaSeleccionada} close={() => {}} onAddIngrediente={ingrediente => setIngredientes(prev => [...prev, ingrediente])} onAdded={() => setPickerOpen(false)} />}
      </Section>
      {error && <p className="small compound-builder-error" style={{ color: 'var(--acc-2)' }}>{error}</p>}
    </div>
    <div className="compound-builder-actions">
      <Button onClick={() => requestClose()}>Cancelar</Button>
      <Button variant="primary" disabled={saving || !nombreComida.trim() || !ingredientes.length} onClick={save}>{saving ? 'Guardando…' : esEdicion ? 'Guardar cambios' : 'Guardar'}</Button>
    </div>
  </div>
}

function totalesDeIngredientes(ingredientes) {
  return ingredientes.reduce((total, ingrediente) => ({
    calorias: total.calorias + Number(ingrediente.calorias || 0),
    proteina: total.proteina + Number(ingrediente.proteina || 0),
    carbohidratos: total.carbohidratos + Number(ingrediente.carbohidratos || 0),
    grasas: total.grasas + Number(ingrediente.grasas || 0),
  }), { calorias: 0, proteina: 0, carbohidratos: 0, grasas: 0 })
}

function agruparComidas(rows) {
  const items = []
  const grupos = new Map()
  rows.forEach(comida => {
    if (comida.grupo_id == null) {
      items.push(comida)
      return
    }
    let grupo = grupos.get(comida.grupo_id)
    if (!grupo) {
      grupo = {
        grupo_id: comida.grupo_id,
        grupo_nombre: comida.grupo_nombre || 'Comida compuesta',
        ingredientes: [],
        totales: { calorias: 0, proteina: 0, carbohidratos: 0, grasas: 0 },
      }
      grupos.set(comida.grupo_id, grupo)
      items.push(grupo)
    }
    grupo.ingredientes.push(comida)
    grupo.totales = grupo.ingredientes.reduce((total, ingrediente) => ({
      calorias: total.calorias + Number(ingrediente.calorias || 0),
      proteina: total.proteina + Number(ingrediente.proteina || 0),
      carbohidratos: total.carbohidratos + Number(ingrediente.carbohidratos || 0),
      grasas: total.grasas + Number(ingrediente.grasas || 0),
    }), { calorias: 0, proteina: 0, carbohidratos: 0, grasas: 0 })
  })
  return items
}

function GrupoComidaRow({ grupo, onRemove, actions }) {
  const [expandido, setExpandido] = useState(false)
  const totales = grupo.totales || totalesDeIngredientes(grupo.ingredientes || [])
  const subtitle = `${Math.round(totales.calorias)} kcal · ${totales.proteina.toFixed(1)} g prot. · ${totales.carbohidratos.toFixed(1)} g carb. · ${totales.grasas.toFixed(1)} g grasas`
  const defaultActions = onRemove ? [<button key="remove" type="button" className="iconbtn meal-delete" aria-label="Eliminar comida compuesta" onClick={event => { event.stopPropagation(); onRemove(grupo.grupo_id) }}>×</button>] : []
  return <div className="grupo-comida-row">
    <Row title={grupo.grupo_nombre} subtitle={subtitle} onClick={() => setExpandido(value => !value)}>
      {actions || defaultActions}
    </Row>
    {expandido && <div className="grupo-comida-ingredientes">
      {grupo.ingredientes.map(ingrediente => <Row key={ingrediente.id} title={ingrediente.nombre_alimento} subtitle={`${ingrediente.cantidad_gramos} g · ${Math.round(ingrediente.calorias)} kcal`} className="grupo-comida-ingrediente" />)}
    </div>}
  </div>
}

function MisComidasCompuestas({ close }) {
  const [plantillas, setPlantillas] = useState([])
  const [loading, setLoading] = useState(true)

  const loadPlantillas = useCallback(() => {
    setLoading(true)
    api('/api/plantillas?scope=mine').then(setPlantillas).catch(() => setPlantillas([])).finally(() => setLoading(false))
  }, [])

  useEffect(() => { loadPlantillas() }, [loadPlantillas])

  const editar = plantilla => useUI.getState().openSheet(builderClose => (
    <ComidaCompuestaBuilder
      close={builderClose}
      onSaved={loadPlantillas}
      plantillaId={plantilla.id}
      initialNombre={plantilla.nombre}
      initialIngredientes={plantilla.ingredientes}
    />
  ), { locked: true, fullScreen: true })

  const borrar = plantilla => confirmSheet({
    title: '¿Eliminar plantilla?',
    message: `Se eliminará “${plantilla.nombre}” de tus comidas compuestas.`,
    confirmText: 'Eliminar',
    danger: true,
    onConfirm: async () => {
      try {
        await api('/api/plantillas/' + encodeURIComponent(plantilla.id), { method: 'DELETE' })
        loadPlantillas()
      } catch { /* keep the current list when deletion fails */ }
    },
  })

  return <>
    <div className="row between">
      <div><h3 style={{ margin: 0 }}>Mis comidas compuestas</h3><div className="dim small">Plantillas reutilizables</div></div>
      <button type="button" className="iconbtn" onClick={close} aria-label="Cerrar"><Icon name="xmark" /></button>
    </div>
    {loading ? <div className="meal-empty">Cargando comidas compuestas…</div> : plantillas.length ? <div className="list">
      {plantillas.map(plantilla => {
        const grupo = {
          grupo_nombre: plantilla.nombre,
          ingredientes: plantilla.ingredientes,
          totales: totalesDeIngredientes(plantilla.ingredientes),
        }
        return <GrupoComidaRow key={plantilla.id} grupo={grupo} actions={[
          <button key="edit" type="button" className="iconbtn" aria-label="Editar comida compuesta" onClick={event => { event.stopPropagation(); editar(plantilla) }}><Icon name="pencil" /></button>,
          <button key="delete" type="button" className="iconbtn meal-delete" aria-label="Eliminar comida compuesta" onClick={event => { event.stopPropagation(); borrar(plantilla) }}><Icon name="xmark" /></button>,
        ]} />
      })}
    </div> : <div className="empty"><div className="ico"><Icon name="clipboard" /></div>No tenés comidas compuestas guardadas.</div>}
  </>
}

function SugerenciaComida({ close, onSaved }) {
  const [paso, setPaso] = useState(1)
  const [franja, setFranja] = useState(FRANJAS[0].value)
  const [plantillas, setPlantillas] = useState([])
  const [loading, setLoading] = useState(false)
  const [agregando, setAgregando] = useState(null)
  const [error, setError] = useState('')
  const historyEntryRef = useRef(false)
  const closingRef = useRef(false)
  const pasoRef = useRef(paso)
  pasoRef.current = paso

  const cargarSugerencias = useCallback(() => {
    setLoading(true)
    setError('')
    api('/api/plantillas?categoria=fitness').then(setPlantillas).catch(() => {
      setPlantillas([])
      setError('No se pudieron cargar las sugerencias.')
    }).finally(() => setLoading(false))
  }, [])

  const irALista = useCallback(value => {
    setFranja(value)
    setPaso(2)
    cargarSugerencias()
  }, [cargarSugerencias])

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
    window.history.pushState({ ...(window.history.state || {}), sugerenciaComida: true }, '', window.location.href)
    const onPopState = event => {
      if (!event.state?.sugerenciaComida) return
      if (pasoRef.current === 2) {
        setPaso(1)
        window.history.pushState({ ...(window.history.state || {}), sugerenciaComida: true }, '', window.location.href)
      } else {
        cerrar(true)
      }
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

  const agregar = async plantilla => {
    setAgregando(plantilla.id)
    setError('')
    try {
      await api('/api/comidas/grupo', { method: 'POST', body: JSON.stringify({
        grupo_nombre: plantilla.nombre, franja, fecha: todayISO(), ingredientes: plantilla.ingredientes,
      }) })
      onSaved()
    } catch {
      setError('No se pudo agregar la sugerencia. Intentá nuevamente.')
    } finally {
      setAgregando(null)
    }
  }

  const franjaActual = FRANJAS.find(item => item.value === franja)
  return <div className="compound-builder">
    <div className="compound-builder-content">
      <div className="row between compound-builder-header">
        <div><h3 style={{ margin: 0 }}>Sugerencia de comida</h3><div className="dim small">{paso === 1 ? 'Elegí una franja' : franjaActual?.label}</div></div>
        <button type="button" className="iconbtn" onClick={() => cerrar()} aria-label="Cerrar"><Icon name="xmark" /></button>
      </div>
      {paso === 1 ? <Section title="¿Para qué momento del día?" className="compound-builder-section">
        <SelectRow title="Franja" value={franja} options={FRANJAS} onChange={irALista} sheetTitle="Elegir franja" />
      </Section> : <Section title={`Sugerencias para ${franjaActual?.label.toLowerCase()}`} className="compound-builder-section">
        {loading ? <div className="meal-empty">Cargando sugerencias…</div> : plantillas.length ? <div className="list">
          {plantillas.map(plantilla => <GrupoComidaRow key={plantilla.id} grupo={{ grupo_nombre: plantilla.nombre, ingredientes: plantilla.ingredientes, totales: totalesDeIngredientes(plantilla.ingredientes) }} actions={[
            <Button key="add" size="sm" variant="tinted" disabled={agregando === plantilla.id} onClick={event => { event.stopPropagation(); agregar(plantilla) }}>{agregando === plantilla.id ? 'Agregando…' : 'Agregar'}</Button>,
          ]} />)}
        </div> : <div className="empty"><div className="ico"><Icon name="plate" /></div>No hay sugerencias disponibles.</div>}
      </Section>}
      {error && <p className="small compound-builder-error" style={{ color: 'var(--acc-2)' }}>{error}</p>}
    </div>
  </div>
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
  const loadComidas = (showLoading = false) => { if (showLoading) setLoadingComidas(true); api('/api/comidas?fecha=' + todayISO()).then(setComidas).catch(() => setComidas([])).finally(() => setLoadingComidas(false)) }
  useEffect(() => { loadComidas(true) }, [])
  const totals = useMemo(() => comidas.reduce((a, c) => ({ calorias: a.calorias + Number(c.calorias || 0), proteina: a.proteina + Number(c.proteina || 0), carbos: a.carbos + Number(c.carbohidratos || 0), grasas: a.grasas + Number(c.grasas || 0) }), { calorias: 0, proteina: 0, carbos: 0, grasas: 0 }), [comidas])
  const addMeal = franja => useUI.getState().openSheet(close => <FoodPicker franja={franja} close={close} onSaved={loadComidas} />)
  const addComidaCompuesta = () => useUI.getState().openSheet(close => <ComidaCompuestaBuilder close={close} onSaved={loadComidas} />, { locked: true, fullScreen: true })
  const openMisComidasCompuestas = () => useUI.getState().openSheet(close => <MisComidasCompuestas close={close} />, { fullScreen: true })
  const openSugerenciaComida = () => useUI.getState().openSheet(close => <SugerenciaComida close={close} onSaved={loadComidas} />, { locked: true, fullScreen: true })
  const removeMeal = async id => { await api('/api/comidas/' + id, { method: 'DELETE' }); loadComidas() }
  const removeGrupo = async grupoId => { await api('/api/comidas/grupo/' + encodeURIComponent(grupoId), { method: 'DELETE' }); loadComidas() }

  return <>
    <div className="hdr">
      <div><h1>{t('Nutrición')}</h1><div className="sub">{t('Tus metas diarias')}</div></div>
      <button className="iconbtn" onClick={openMisComidasCompuestas} aria-label="Mis comidas compuestas" title="Mis comidas compuestas"><Icon name="plate" /></button>
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
      <Button variant="primary" icon="sparkles" onClick={openSugerenciaComida} style={{ width: '100%', marginTop: 14, color: '#fff' }}>Sugerencia de comida</Button>
    </div>
    {loadingComidas ? <div className="card muted small">Cargando comidas…</div> : <>
      {FRANJAS.map(franja => {
      const rows = comidas.filter(c => c.franja === franja.value)
      const items = agruparComidas(rows)
      return <Section key={franja.value} title={franja.label} footer={<Button size="sm" icon="plus" onClick={() => addMeal(franja.value)}>Agregar</Button>}>
        {items.length ? items.map(item => item.grupo_id != null
          ? <GrupoComidaRow key={item.grupo_id} grupo={item} onRemove={removeGrupo} />
          : <Row key={item.id} title={item.nombre_alimento} subtitle={`${item.cantidad_gramos} g · ${Math.round(item.calorias)} kcal`}><button className="iconbtn meal-delete" aria-label="Eliminar comida" onClick={() => removeMeal(item.id)}>×</button></Row>) : <div className="meal-empty">Sin comidas registradas</div>}
      </Section>
      })}
      <Button variant="primary" onClick={addComidaCompuesta}>Crear alimento compuesto</Button>
    </>}
  </>
}
