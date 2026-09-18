import { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { fmtDate, fmtNum, fmtVol, fmtDur, DAYN, uid } from '../lib/format.js'
import { auditCat, auditLine, fmtWhen } from '../lib/audit.js'
import { workoutVolume, setsDone } from '../lib/history.js'
import { confirmSheet, inputSheet, exercisePicker, exConfigSheet, glyphPicker } from '../sheets.jsx'
import { exOr } from '../lib/exercises.js'
import { exLine } from '../lib/history.js'
import { glyphOf } from '../lib/glyphs.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button, TextField, SelectRow, Segmented, Section, Row, Switch, NumberField } from '../components/ui.jsx'
import { NO_AUTOFILL } from '../lib/input-safety.js'
import { FoodPicker, GrupoComidaRow, totalesDeIngredientes, FRANJAS } from './Nutricion.jsx'
import RoutineEditor from './RoutineEditor.jsx'
import { LESIONES_OPTIONS, OBJETIVO_OPTIONS, CheckPill } from './SurveyWizard.jsx'
import { MAX_ROUTINE_GROUPS, canAddGroup, validateGroupName, syncActiveGroupInState, switchActiveGroup, addGroupToState, removeGroupFromState } from '../lib/routineGroups.js'
import * as ZXing from 'html5-qrcode/third_party/zxing-js.umd.js'

// Admin-only operator dashboard (owner passkey + admin flag; guarded again server-side).

const rel = ts => {
  if (!ts) return t('never')
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return t('just now')
  if (s < 3600) return t('{0}m ago', Math.floor(s / 60))
  if (s < 86400) return t('{0}h ago', Math.floor(s / 3600))
  return t('{0}d ago', Math.floor(s / 86400))
}
const dur = ms => { const m = Math.max(0, Math.floor(ms / 60000)); return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + (m % 60) + 'm' }

function AttendanceHeatmap({ data, onStartChange }) {
  if (!data) return <div className="card"><div className="dim small">{t('Loading…')}</div></div>
  const today = new Date(); today.setHours(12, 0, 0, 0)
  const offset = data.start === 'sunday' ? today.getDay() : (today.getDay() + 6) % 7
  const end = new Date(today); end.setDate(today.getDate() - offset)
  const start = new Date(end); start.setDate(end.getDate() - 21)
  const totalUsers = Math.max(1, Number(data.totalUsers) || 0)
  const max = totalUsers
  const level = n => !n ? 0 : Math.min(4, Math.ceil((n / max) * 4))
  const dayCount = data.start === 'sunday' ? 7 : 6
  const weeks = []
  for (let w = 0; w < 4; w++) {
    const cells = []
    for (let d = 0; d < dayCount; d++) {
      const day = new Date(start); day.setDate(start.getDate() + w * 7 + d)
      const key = day.toISOString().slice(0, 10)
      const n = Number(data.days[key] || 0)
      cells.push(<div key={key} className={'hm-c l' + level(n) + (key === today.toISOString().slice(0, 10) ? ' today' : '')}
        title={`${key} · ${t(n === 1 ? '{0} user' : '{0} users', n)}`} />)
    }
    weeks.push(<div key={w} className="hm-col">{cells}</div>)
  }
  const labels = data.start === 'sunday'
    ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    : ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return <div className="card admin-attendance-heatmap">
    <div className="row between" style={{ gap: 10 }}>
      <div><h2 style={{ margin: 0 }}>{t('Asistencia')}</h2><div className="small muted">{t('Miembros distintos que entrenaron cada día · últimas 4 semanas')}</div></div>
      <div className="hm-sunday-toggle seg" role="group" aria-label={t('Sunday')}>
        <button type="button" className={data.start === 'monday' ? 'on' : ''} onClick={() => onStartChange('monday')}>{t('Sin Domingo')}</button>
        <button type="button" className={data.start === 'sunday' ? 'on' : ''} onClick={() => onStartChange('sunday')}>{t('Con Domingo')}</button>
      </div>
    </div>
    <div className="hm-wrap" style={{ marginTop: 12 }}>
      <div className="hm-body"><div className="hm-days">{labels.map((x, i) => <span key={i}>{x ? t(x) : ''}</span>)}</div><div className="hm-grid">{weeks}</div></div>
    </div>
    <div className="hm-legend">{t('Fewer members')} <div className="hm-c l0" /><div className="hm-c l1" /><div className="hm-c l2" /><div className="hm-c l3" /><div className="hm-c l4" /> {t('More members')}</div>
  </div>
}

const totalesIngredientes = ingredientes => ingredientes.reduce((total, i) => ({
  calorias: total.calorias + Number(i.calorias || 0),
  proteina: total.proteina + Number(i.proteina || 0),
  carbohidratos: total.carbohidratos + Number(i.carbohidratos || 0),
  grasas: total.grasas + Number(i.grasas || 0),
}), { calorias: 0, proteina: 0, carbohidratos: 0, grasas: 0 })

// Sugerencia custom o edición de una ya asignada. Reutiliza FoodPicker de Nutricion.jsx
// (misma búsqueda/escaneo/manual que usa el socio) en vez de rearmar el catálogo de comida.
function AdminSuggestionEditor({ userId, existing, close, onFinish = close, onSaved }) {
  const toast = useUI(s => s.toast)
  const [nombre, setNombre] = useState(existing?.nombre || '')
  const [ingredientes, setIngredientes] = useState(existing?.ingredientes || [])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const totales = totalesIngredientes(ingredientes)
  const save = () => {
    if (!nombre.trim() || !ingredientes.length) return toast(t('Ingresá un nombre y al menos un ingrediente'))
    setSaving(true)
    const body = JSON.stringify({ nombre: nombre.trim(), categoria: 'fitness', ingredientes })
    const base = `/api/admin/users/${encodeURIComponent(userId)}/nutrition/suggestions`
    const url = existing ? `${base}/${existing.id}` : `${base}/custom`
    api(url, { method: existing ? 'PUT' : 'POST', body })
      .then(() => { toast(existing ? t('Sugerencia actualizada') : t('Sugerencia creada')); onSaved(); onFinish() })
      .catch(e => { setSaving(false); toast(e.message) })
  }
  return <div className="compound-builder">
    <div className="compound-builder-content">
      <div className="row between compound-builder-header">
        <h3 style={{ margin: 0 }}>{existing ? t('Editar sugerencia') : t('Nueva sugerencia')}</h3>
        <button type="button" className="iconbtn" onClick={close} aria-label={t('Close')}><Icon name="xmark" /></button>
      </div>
      <Section title={t('Nombre de la comida')}>
        <TextField value={nombre} onChange={e => setNombre(e.target.value)} maxLength={80} />
      </Section>
      <Section title={t('Ingredientes')}>
        {ingredientes.length ? ingredientes.map((ing, i) => <Row key={i} title={ing.nombre_alimento} subtitle={`${ing.cantidad_gramos} g · ${Math.round(ing.calorias)} kcal`}>
          <button className="iconbtn" aria-label={t('Remove')} onClick={() => setIngredientes(cur => cur.filter((_, idx) => idx !== i))}><Icon name="trash" /></button>
        </Row>) : <div className="dim small">{t('Sin ingredientes todavía.')}</div>}
        <div className="nutri-live row between" style={{ marginTop: 8 }}>
          <span>{t('Total')}</span>
          <span>{Math.round(totales.calorias)} kcal · {totales.proteina.toFixed(1)}g prot · {totales.carbohidratos.toFixed(1)}g carb · {totales.grasas.toFixed(1)}g grasas</span>
        </div>
      </Section>
      <Section title={t('Agregar ingredientes')}>
        {!pickerOpen ? <Button variant="tinted" icon="plus" onClick={() => setPickerOpen(true)}>{t('Agregar ingrediente')}</Button>
          : <FoodPicker franja="extra" close={() => {}} onAddIngrediente={ing => setIngredientes(cur => [...cur, ing])} onAdded={() => setPickerOpen(false)} />}
      </Section>
    </div>
    <div className="compound-builder-actions">
      <Button onClick={close}>{t('Cancel')}</Button>
      <Button variant="primary" disabled={saving || !nombre.trim() || !ingredientes.length} onClick={save}>{saving ? t('Guardando…') : t('Save')}</Button>
    </div>
  </div>
}

// Catálogo para asignar: usa el catálogo global de administración (todas las categorías
// existentes en la base, sin hardcodear ninguna). PASO 1 de 3 (ver AdminSuggestionDetail /
// AdminFranjaSelector): tocar una plantilla acá NO escribe nada, solo pasa al detalle
// (onPick, paso interno de AdminSuggestionWizard — nunca abre un sheet propio).
function AdminSuggestionPicker({ onPick, onCreateGlobal }) {
  const [items, setItems] = useState(null)
  const [categoria, setCategoria] = useState('')
  const load = () => api('/api/admin/nutrition/templates').then(r => setItems(r.templates)).catch(() => setItems([]))
  useEffect(load, [])
  const categorias = items ? [...new Set(items.map(p => p.categoria).filter(Boolean))].sort() : []
  const visibles = items && categoria ? items.filter(p => p.categoria === categoria) : items
  return <>
    <h3>{t('Elegir plantilla existente')}</h3>
      <Button variant="tinted" icon="plus" style={{ width: '100%', marginBottom: 12 }} onClick={() => onCreateGlobal(categorias)}>
      {t('Crear comida global')}
    </Button>
    {categorias.length > 1 && <div style={{ marginBottom: 12 }}>
      <Segmented options={[{ value: '', label: t('Todas') }, ...categorias.map(cat => ({ value: cat, label: cat }))]}
        value={categoria} onChange={setCategoria} />
    </div>}
    {visibles === null ? <div className="dim small">{t('Loading…')}</div> : visibles.length ? <div className="list">
      {visibles.map(p => <Row key={p.id} title={p.nombre} subtitle={t('{0} ingredientes', p.ingredientes.length)} onClick={() => onPick(p)} accessory="chevron" />)}
    </div> : <div className="dim small">{t('No hay plantillas globales todavía.')}</div>}
  </>
}

// Crea una comida compuesta scope='global' (catálogo de la instancia, no asignada a ningún
// socio). Reutiliza el mismo FoodPicker/cálculo de macros que AdminSuggestionEditor, pero
// requiere categoría (de las que ya existen en la base) y al menos una franja explícita:
// las plantillas globales sembradas dependen de inferirFranjasPlantilla() como fallback,
// pero acá la franja siempre queda explícita y tiene prioridad sobre esa inferencia.
function AdminGlobalTemplateEditor({ categorias, close, onCreated }) {
  const toast = useUI(s => s.toast)
  const [nombre, setNombre] = useState('')
  const [categoria, setCategoria] = useState(categorias[0] || '')
  const [franjas, setFranjas] = useState(new Set())
  const [ingredientes, setIngredientes] = useState([])
  const [pickerOpen, setPickerOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const totales = totalesIngredientes(ingredientes)
  const toggleFranja = value => setFranjas(cur => {
    const next = new Set(cur)
    next.has(value) ? next.delete(value) : next.add(value)
    return next
  })
  const valido = nombre.trim() && categoria.trim() && franjas.size && ingredientes.length
  const save = () => {
    if (!valido) return toast(t('Completá nombre, categoría, al menos una franja y un ingrediente'))
    setSaving(true)
    const body = JSON.stringify({ nombre: nombre.trim(), categoria: categoria.trim(), franjas: [...franjas], ingredientes })
    api('/api/admin/nutrition/templates', { method: 'POST', body })
      .then(({ template }) => { toast(t('Comida global creada')); onCreated(template); close() })
      .catch(e => { setSaving(false); toast(e.message) })
  }
  return <div className="compound-builder">
    <div className="compound-builder-content">
      <div className="row between compound-builder-header">
        <h3 style={{ margin: 0 }}>{t('Crear comida global')}</h3>
        <button type="button" className="iconbtn" onClick={close} aria-label={t('Close')}><Icon name="xmark" /></button>
      </div>
      <Section title={t('Nombre de la comida')}>
        <TextField value={nombre} onChange={e => setNombre(e.target.value)} maxLength={80} />
      </Section>
      <Section title={t('Categoría')}>
        {categorias.length ? <div className="list" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {categorias.map(cat => <CheckPill key={cat} checked={categoria === cat} onChange={() => setCategoria(cat)}>{cat}</CheckPill>)}
        </div> : <div className="dim small">{t('No hay categorías cargadas todavía. Corré la siembra de plantillas globales primero.')}</div>}
      </Section>
      <Section title={t('Franjas')}>
        <div className="list" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {FRANJAS.map(f => <CheckPill key={f.value} checked={franjas.has(f.value)} onChange={() => toggleFranja(f.value)}>{f.label}</CheckPill>)}
        </div>
      </Section>
      <Section title={t('Ingredientes')}>
        {ingredientes.length ? ingredientes.map((ing, i) => <Row key={i} title={ing.nombre_alimento} subtitle={`${ing.cantidad_gramos} g · ${Math.round(ing.calorias)} kcal`}>
          <button className="iconbtn" aria-label={t('Remove')} onClick={() => setIngredientes(cur => cur.filter((_, idx) => idx !== i))}><Icon name="trash" /></button>
        </Row>) : <div className="dim small">{t('Sin ingredientes todavía.')}</div>}
        <div className="nutri-live row between" style={{ marginTop: 8 }}>
          <span>{t('Total')}</span>
          <span>{Math.round(totales.calorias)} kcal · {totales.proteina.toFixed(1)}g prot · {totales.carbohidratos.toFixed(1)}g carb · {totales.grasas.toFixed(1)}g grasas</span>
        </div>
      </Section>
      <Section title={t('Agregar ingredientes')}>
        {!pickerOpen ? <Button variant="tinted" icon="plus" onClick={() => setPickerOpen(true)}>{t('Agregar ingrediente')}</Button>
          : <FoodPicker franja="extra" close={() => {}} onAddIngrediente={ing => setIngredientes(cur => [...cur, ing])} onAdded={() => setPickerOpen(false)} />}
      </Section>
    </div>
    <div className="compound-builder-actions">
      <Button onClick={close}>{t('Cancel')}</Button>
      <Button variant="primary" disabled={saving || !valido} onClick={save}>{saving ? t('Guardando…') : t('Save')}</Button>
    </div>
  </div>
}

// PASO 2 de 3: muestra el contenido de la plantilla antes de asignarla. [Agregar] tampoco
// escribe nada, solo pasa al selector de franja (PASO 3, onNext — paso interno).
function AdminSuggestionDetail({ plantilla, onNext, onBack }) {
  const totales = totalesDeIngredientes(plantilla.ingredientes)
  return <>
    <div className="row between" style={{ marginBottom: 8 }}>
      <Button size="sm" onClick={onBack}>{t('Volver')}</Button>
      <Button size="sm" variant="primary" onClick={onNext}>{t('Agregar')}</Button>
    </div>
    <h3 style={{ marginTop: 0 }}>{plantilla.nombre}</h3>
    <Section title={t('Ingredientes')}>
      {plantilla.ingredientes.map((ing, i) => <Row key={i} title={ing.nombre_alimento} subtitle={`${ing.cantidad_gramos} g`} />)}
    </Section>
    <div className="nutri-live row between" style={{ marginTop: 8 }}>
      <span>{t('Total')}</span>
      <span>{Math.round(totales.calorias)} kcal · {totales.proteina.toFixed(1)}g prot · {totales.carbohidratos.toFixed(1)}g carb · {totales.grasas.toFixed(1)}g grasas</span>
    </div>
  </>
}

// PASO 3 de 3: única pantalla donde se escribe. Confirmar crea una asignación independiente
// por cada franja marcada (regla A.2); las franjas donde la plantilla ya está asignada
// aparecen marcadas y bloqueadas para evitar duplicados. onDone cierra el wizard entero
// (un único sheet real, close() de un solo nivel) y vuelve a la vista de nutrición del socio.
function AdminFranjaSelector({ userId, plantilla, suggestions, onSaved, onDone, onBack }) {
  const toast = useUI(s => s.toast)
  const yaAsignadas = new Set(suggestions.filter(s => s.sourcePlantillaId === plantilla.id).flatMap(s => s.franjas))
  const [selected, setSelected] = useState(new Set(yaAsignadas))
  const [saving, setSaving] = useState(false)
  const toggle = value => {
    if (yaAsignadas.has(value)) return
    setSelected(cur => {
      const next = new Set(cur)
      next.has(value) ? next.delete(value) : next.add(value)
      return next
    })
  }
  const nuevas = [...selected].filter(v => !yaAsignadas.has(v))
  const confirmar = () => {
    setSaving(true)
    const base = `/api/admin/users/${encodeURIComponent(userId)}/nutrition/suggestions`
    Promise.all(nuevas.map(franja => api(base, { method: 'POST', body: JSON.stringify({ plantilla_id: plantilla.id, franja }) })))
      .then(() => { toast(t('Sugerencia asignada')); onSaved(); onDone() })
      .catch(e => { setSaving(false); toast(e.message) })
  }
  return <>
    <h3>{t('¿A qué franja querés agregarla?')}</h3>
    <div className="list" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
      {FRANJAS.map(f => <CheckPill key={f.value} checked={selected.has(f.value)} onChange={() => toggle(f.value)}>
        {f.label}{yaAsignadas.has(f.value) ? ` · ${t('ya asignada')}` : ''}
      </CheckPill>)}
    </div>
    <div className="row between">
      <Button onClick={onBack}>{t('Cancelar')}</Button>
      <Button variant="primary" disabled={saving || !nuevas.length} onClick={confirmar}>{saving ? t('Guardando…') : t('Confirmar')}</Button>
    </div>
  </>
}

// Wizard de "Agregar sugerencia": UN solo sheet real (una única entrada de historial) con
// navegación interna por estado — chooser/picker/detalle/franjas nunca abren un sheet propio,
// así el gesto de atrás siempre retrocede un paso via onBack (setOnBack, ver useUI.js) sin
// depender de un rewind de varios niveles de historial real (causaba pantalla negra en PWA
// standalone: un solo history.go(-N) podía exceder la profundidad real de la sesión).
// "Crear nueva", crear una comida global y editar una sugerencia también son pasos internos del
// mismo sheet raíz. Esto evita cualquier sheet anidado dentro del flujo de nutrición admin.
function AdminSuggestionWizard({ userId, suggestions, onSaved, close, setOnBack, initialStep = { name: 'chooser' } }) {
  const [step, setStep] = useState(initialStep)
  const stepRef = useRef(step)
  stepRef.current = step
  useEffect(() => {
    setOnBack(() => {
      const cur = stepRef.current
      if (cur.name === 'franja') return setStep({ name: 'detail', plantilla: cur.plantilla })
      if (cur.name === 'detail') return setStep({ name: 'picker' })
      if (cur.name === 'picker') return setStep({ name: 'chooser' })
      if (cur.name === 'global') return setStep({ name: 'picker' })
      if (cur.name === 'editor') return close()
      close()
    })
  }, [close, setOnBack])

  if (step.name === 'editor') return <AdminSuggestionEditor userId={userId} existing={step.existing} close={close} onFinish={close} onSaved={onSaved} />
  if (step.name === 'global') return <AdminGlobalTemplateEditor categorias={step.categorias || []} close={close} onCreated={() => setStep({ name: 'picker' })} />
  if (step.name === 'picker') return <AdminSuggestionPicker onPick={plantilla => setStep({ name: 'detail', plantilla })} onCreateGlobal={categorias => setStep({ name: 'global', categorias })} />
  if (step.name === 'detail') return <AdminSuggestionDetail plantilla={step.plantilla}
    onNext={() => setStep({ name: 'franja', plantilla: step.plantilla })} onBack={() => setStep({ name: 'picker' })} />
  if (step.name === 'franja') return <AdminFranjaSelector userId={userId} plantilla={step.plantilla} suggestions={suggestions}
    onSaved={onSaved} onDone={close} onBack={() => setStep({ name: 'detail', plantilla: step.plantilla })} />
  return <>
    <h3>{t('Agregar sugerencia')}</h3>
    <div className="list">
      <Button variant="tinted" icon="plate" style={{ width: '100%', marginBottom: 8 }} onClick={() => setStep({ name: 'picker' })}>
        {t('Desde plantilla existente')}
      </Button>
      <Button variant="tinted" icon="plus" style={{ width: '100%' }}
        onClick={() => setStep({ name: 'editor' })}>
        {t('Crear nueva')}
      </Button>
    </div>
  </>
}

// Metas manuales + sugerencias asignadas de un socio (Fase 4). Prioridad total del admin
// (regla 1): estos valores son la única fuente que ve el socio, sin indicarle que vienen
// de un admin (regla 3) — esta pantalla es la única parte de la app que menciona esto.
// Título de sección más grande que el default de <Section> (13px, jerarquía muy baja para
// esta pantalla — feedback visual del cliente). Reusa los mismos tokens de color de la app.
const bigSectionTitle = txt => <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--label)' }}>{txt}</span>

function AdminNutritionCard({ userId, openSuggestion, editSuggestion }) {
  const toast = useUI(s => s.toast)
  const automaticoHabilitado = useStore(s => s.config?.nutricion_automatico) !== false
  const [data, setData] = useState(null)
  const [saving, setSaving] = useState(false)
  const [manualDraft, setManualDraft] = useState(null)
  const [expandedSuggestion, setExpandedSuggestion] = useState(null)
  const base = `/api/admin/users/${encodeURIComponent(userId)}/nutrition`
  const load = () => api(base).then(d => { setData(d); setManualDraft(null) }).catch(e => toast(e.message))
  useEffect(() => { load() }, [userId])
  if (!data) return <div className="dim small">{t('Loading…')}</div>
  const goals = data.goals
  // Sin NUTRICION_AUTOMATICO, no hay toggle: el modo es siempre manual para este socio.
  // manualDraft !== null también cuenta como manual: el admin recién prendió el switch
  // localmente y todavía no guardó — sin esto el bloque de campos nunca aparecía (bug).
  const isManual = !automaticoHabilitado || goals.mode === 'manual' || manualDraft !== null
  // Arrancan vacíos por defecto — nada de valores precargados (regla A.3), salvo Objetivo:
  // ese sí se prellena con el que ya tiene el socio (data.userObjetivo) en vez de "Sin
  // definir", para no forzar al admin a repetir una elección que el socio ya hizo. Cada
  // campo numérico sigue siendo independiente: vacío se manda como null, nunca un 0.
  const draft = manualDraft || { objetivo: goals.objetivo ?? data.userObjetivo ?? null, calories: goals.calories, caloriesBurn: goals.caloriesBurn, protein: goals.protein, carbs: goals.carbs, fat: goals.fat }
  const setDraft = patch => setManualDraft({ ...draft, ...patch })
  const toggleMode = manual => {
    if (manual) return setManualDraft(draft)
    setSaving(true)
    api(base + '/goals', { method: 'PUT', body: JSON.stringify({ mode: 'automatic' }) })
      .then(() => { toast(t('Metas vueltas a automático')); load() }).catch(e => toast(e.message)).finally(() => setSaving(false))
  }
  const saveManual = () => {
    setSaving(true)
    api(base + '/goals', { method: 'PUT', body: JSON.stringify({ mode: 'manual', ...draft }) })
      .then(() => { toast(t('Metas guardadas')); load() }).catch(e => toast(e.message)).finally(() => setSaving(false))
  }
  const toggleLimitar = value => {
    setSaving(true)
    api(base + '/suggestions-limit', { method: 'PUT', body: JSON.stringify({ limitarSugeridas: value }) })
      .then(load).catch(e => toast(e.message)).finally(() => setSaving(false))
  }
  const removeSuggestion = s => confirmSheet({
    title: t('¿Quitar sugerencia?'), message: t('“{0}” deja de mostrarse al socio. No afecta plantillas globales.', s.nombre),
    confirmText: t('Quitar'), danger: true,
    onConfirm: () => api(`${base}/suggestions/${s.id}`, { method: 'DELETE' }).then(load).catch(e => toast(e.message))
  })
  const move = (s, dir) => {
    const list = data.suggestions
    const other = list[list.findIndex(x => x.id === s.id) + dir]
    if (!other) return
    Promise.all([
      api(`${base}/suggestions/${s.id}`, { method: 'PUT', body: JSON.stringify({ nombre: s.nombre, categoria: s.categoria, ingredientes: s.ingredientes, position: other.position }) }),
      api(`${base}/suggestions/${other.id}`, { method: 'PUT', body: JSON.stringify({ nombre: other.nombre, categoria: other.categoria, ingredientes: other.ingredientes, position: s.position }) }),
    ]).then(load).catch(e => toast(e.message))
  }
  return <>
    <Section title={bigSectionTitle(t('Metas nutricionales'))}>
      {automaticoHabilitado && <Row title={t('Cálculo automático')} subtitle={isManual ? t('Desactivado: el socio ve los valores manuales de abajo') : t('Se calcula automáticamente como hoy')}>
        <Switch checked={!isManual} onChange={v => toggleMode(!v)} disabled={saving} />
      </Row>}
      {isManual && <>
        <SelectRow title={t('Objetivo')} value={draft.objetivo}
          options={[{ value: null, label: t('Sin definir') }, ...OBJETIVO_OPTIONS]}
          onChange={v => setDraft({ objetivo: v })} />
        <div className="admin-goals-fields">
          <Row title={t('Kcalorías a quemar')}><NumberField className="admin-goal-num" value={draft.caloriesBurn} onChange={v => setDraft({ caloriesBurn: v })} decimal={false} nullable /></Row>
          <Row title={t('Kcalorías a consumir')}><NumberField className="admin-goal-num" value={draft.calories} onChange={v => setDraft({ calories: v })} decimal={false} nullable /></Row>
          <Row title={t('Proteínas (g)')}><NumberField className="admin-goal-num" value={draft.protein} onChange={v => setDraft({ protein: v })} nullable /></Row>
          <Row title={t('Carbohidratos (g)')}><NumberField className="admin-goal-num" value={draft.carbs} onChange={v => setDraft({ carbs: v })} nullable /></Row>
          <Row title={t('Grasas (g)')}><NumberField className="admin-goal-num" value={draft.fat} onChange={v => setDraft({ fat: v })} nullable /></Row>
        </div>
        <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
          <Button variant="primary" size="sm" disabled={saving} onClick={saveManual}>{t('Guardar metas')}</Button>
        </div>
      </>}
    </Section>
    <Section title={bigSectionTitle(t('Comidas sugeridas personalizadas'))}
      footer={data.limitarSugeridas ? <Button size="sm" icon="plus" onClick={() => openSuggestion(data.suggestions, load)}>{t('Agregar sugerencia')}</Button> : null}>
      <Row title={t('Limitar comidas sugeridas')} subtitle={data.limitarSugeridas ? t('El socio ve solo lo que le asignes acá') : t('El socio ve el comportamiento normal de sugerencias')}>
        <Switch checked={!!data.limitarSugeridas} onChange={toggleLimitar} disabled={saving} />
      </Row>
      {!data.limitarSugeridas && <div className="dim small" style={{ padding: '4px 4px 8px' }}>
        {t('Activá el toggle para asignarle sugerencias puntuales a este socio.')}
      </div>}
      {data.limitarSugeridas && (data.suggestions.length ? FRANJAS.map(franja => {
        const items = data.suggestions.filter(s => (s.franjas || []).includes(franja.value))
        if (!items.length) return null
        return <div key={franja.value} style={{ marginBottom: 8 }}>
          <div className="muted small" style={{ fontWeight: 500, padding: '8px 4px 4px' }}>{franja.label}:</div>
          {items.map(s => {
            const idx = data.suggestions.findIndex(x => x.id === s.id)
            return <GrupoComidaRow key={s.id + ':' + franja.value}
              className="admin-suggestion-row"
              expandido={expandedSuggestion === s.id}
              onToggle={() => setExpandedSuggestion(cur => cur === s.id ? null : s.id)}
              grupo={{ grupo_nombre: s.nombre, ingredientes: s.ingredientes, totales: totalesDeIngredientes(s.ingredientes) }}
              actions={[
                <button key="up" className="iconbtn admin-suggestion-iconbtn" disabled={idx === 0} aria-label={t('Subir')} onClick={e => { e.stopPropagation(); move(s, -1) }}><Icon name="chevronUp" /></button>,
                <button key="down" className="iconbtn admin-suggestion-iconbtn" disabled={idx === data.suggestions.length - 1} aria-label={t('Bajar')} onClick={e => { e.stopPropagation(); move(s, 1) }}><Icon name="chevronDown" /></button>,
                <button key="edit" className="iconbtn admin-suggestion-iconbtn" aria-label={t('Edit')} onClick={e => { e.stopPropagation(); editSuggestion(s, data.suggestions, load) }}><Icon name="pencil" /></button>,
                <button key="remove" className="iconbtn admin-suggestion-iconbtn" aria-label={t('Remove')} style={{ color: 'var(--red)' }} onClick={e => { e.stopPropagation(); removeSuggestion(s) }}><Icon name="trash" /></button>,
              ]}
            />
          })}
        </div>
      }) : <div className="empty" style={{ marginBottom: 8 }}>{t('Sin sugerencias asignadas')}</div>)}
    </Section>
  </>
}

// Editor de una rutina puntual dentro del draft cargado por AdminRoutineCard. Reutiliza
// RoutineEditor.jsx (misma UI que usa el socio en RoutineEdit.jsx) — el draft vive acá y
// solo se persiste con "Guardar cambios" (un solo PUT con todo el blob de rutinas).
function AdminRoutineEditorSheet({ userId, routineId, initial, close, onSaved }) {
  const toast = useUI(s => s.toast)
  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(initial)))
  const [saving, setSaving] = useState(false)
  const base = `/api/admin/users/${encodeURIComponent(userId)}/routines`
  const routine = draft.routines.find(r => r.id === routineId)

  const persist = next => {
    setSaving(true)
    return api(base, { method: 'PUT', body: JSON.stringify({ routines: next.routines, week: next.week, dayPlan: next.dayPlan }) })
      .finally(() => setSaving(false))
  }

  const update = fn => setDraft(d => {
    const next = JSON.parse(JSON.stringify(d))
    fn(next.routines)
    return next
  })

  const save = () => persist(draft).then(() => { toast(t('Rutina guardada')); onSaved(); close() }).catch(e => toast(e.message))

  // Eliminar rutina vive solo en la lista de AdminRoutineCard (ícono de basura por fila) —
  // el botón "Delete routine" del propio RoutineEditor queda oculto acá (no se pasa
  // onDeleted) para no duplicar la acción dentro del editor.

  // B.2: audita cuando el admin fuerza la asignación de un ejercicio sobre zona lesionada.
  // Fire-and-forget — no bloquea el flujo de armado de rutina por un fallo de auditoría.
  const onInjuryOverride = (ex, matched) => api(`/api/admin/users/${encodeURIComponent(userId)}/injuries/exercise-warning-override`, {
    method: 'POST', body: JSON.stringify({ exerciseId: ex.id, lesiones: matched })
  }).catch(() => {})

  // Aunque falle la carga, la pantalla siempre debe poder cerrarse (bug A.2) — nunca `null`.
  if (!routine) return <div className="compound-builder">
    <div className="compound-builder-content">
      <div className="row between compound-builder-header">
        <h3 style={{ margin: 0 }}>{t('Rutina')}</h3>
        <button type="button" className="iconbtn" onClick={close} aria-label={t('Close')}><Icon name="xmark" /></button>
      </div>
      <div className="dim small" style={{ padding: '16px 4px' }}>{t('No se pudo cargar la rutina.')}</div>
    </div>
  </div>
  return <div className="compound-builder">
    <div className="compound-builder-content">
      <RoutineEditor
        routine={routine}
        S={{ unit: draft.unit, body: draft.body }}
        update={update}
        onBack={close}
        lesiones={draft.lesiones}
        onInjuryOverride={onInjuryOverride}
      />
      <div className="row" style={{ padding: '0 16px 16px', gap: 8 }}>
        <Button variant="primary" disabled={saving} onClick={save}>{t('Guardar cambios')}</Button>
      </div>
    </div>
  </div>
}

// Selector de zonas lesionadas al agregar una lesión. Reusa el mismo catálogo y la misma
// pill que el paso 5 de SurveyWizard.jsx — solo ofrece zonas todavía no registradas.
function AdminLesionPicker({ current, close, onConfirm }) {
  const [selected, setSelected] = useState([])
  const available = LESIONES_OPTIONS.filter(op => !current.includes(op.value))
  const toggle = value => setSelected(s => s.includes(value) ? s.filter(v => v !== value) : [...s, value])
  return <div style={{ padding: '4px 0' }}>
    <h3 style={{ marginBottom: 12 }}>{t('Agregar lesión')}</h3>
    {available.length
      ? <div className="survey-pills">{available.map(op => <CheckPill key={op.value} checked={selected.includes(op.value)} onChange={() => toggle(op.value)}>{op.label}</CheckPill>)}</div>
      : <div className="dim small">{t('Ya están todas las zonas registradas.')}</div>}
    <div style={{ height: 16 }} />
    <Button variant="primary" disabled={!selected.length} onClick={() => { close(); onConfirm([...current, ...selected]) }}>{t('Agregar')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
  </div>
}

// Lesiones + grupos/rutinas de un socio (Fase 6 + 7). Crear/eliminar rutina persiste al
// toque (como las sugerencias de nutrición); editar contenido de una rutina abre
// AdminRoutineEditorSheet, que junta todos los cambios en un solo "Guardar cambios".
// Los "grupos" reusan el mismo modelo y las mismas funciones puras que ya usa el socio
// en Plan.jsx (frontend/src/lib/routineGroups.js) — nada de una entidad nueva.
function AdminRoutineCard({ userId }) {
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [data, setData] = useState(null)
  const base = `/api/admin/users/${encodeURIComponent(userId)}/routines`
  const injuriesBase = `/api/admin/users/${encodeURIComponent(userId)}/injuries`

  // Un socio con rutinas cargadas antes de que existieran los grupos (o cargadas por un
  // admin vía la Fase 6, previa a esta pantalla) no tiene routineGroups todavía. Lo
  // envolvemos una sola vez en un grupo por defecto, igual que hace el socio en
  // useStore.loadState() — así no aparece como "sin nada" teniendo rutinas reales.
  const putGroups = next => api(base, { method: 'PUT', body: JSON.stringify({ routines: next.routines, week: next.week, dayPlan: next.dayPlan, routineGroups: next.routineGroups, activeGroupId: next.activeGroupId }) })
  const load = () => api(base).then(d => {
    if (!(d.routineGroups || []).length && (d.routines || []).length) {
      const next = JSON.parse(JSON.stringify(d))
      syncActiveGroupInState(next)
      return putGroups(next).then(() => { setData(next); return next }).catch(() => { setData(d); return d })
    }
    setData(d)
    return d
  }).catch(e => { toast(e.message); return null })
  useEffect(() => { load() }, [userId])
  if (!data) return <div className="dim small">{t('Loading…')}</div>

  const putAll = next => api(base, { method: 'PUT', body: JSON.stringify({ routines: next.routines, week: next.week, dayPlan: next.dayPlan }) })

  // initial se pasa explícito (no via closure de `data`): tras crear una rutina, el `load()`
  // async resuelve tarde y el closure viejo de este handler todavía apunta al `data` previo,
  // sin la rutina nueva — el sheet no la encontraba y quedaba colgado sin header ni cerrar (bug A.2).
  const openEditor = (routineId, initial = data) => openSheet(
    close => <AdminRoutineEditorSheet userId={userId} routineId={routineId} initial={initial} close={close} onSaved={load} />,
    { locked: true, fullScreen: true, backGesture: true }
  )

  const createRoutine = () => {
    const routine = { id: 'r' + uid(), name: t('New routine'), emoji: 'dumbbell', ex: [] }
    putAll({ ...data, routines: [...data.routines, routine] })
      .then(() => { toast(t('Rutina creada')); return load() })
      .then(fresh => openEditor(routine.id, fresh || data))
      .catch(e => toast(e.message))
  }

  const removeRoutine = routine => confirmSheet({
    title: t('¿Eliminar rutina?'), message: t('“{0}” y sus ejercicios se eliminarán.', routine.name),
    confirmText: t('Eliminar'), danger: true,
    onConfirm: () => putAll({
      routines: data.routines.filter(r => r.id !== routine.id),
      week: Object.fromEntries(Object.entries(data.week).filter(([, v]) => v !== routine.id)),
      dayPlan: Object.fromEntries(Object.entries(data.dayPlan).filter(([, v]) => v !== routine.id))
    }).then(() => { toast(t('Rutina eliminada')); load() }).catch(e => toast(e.message))
  })

  const switchGroup = groupId => {
    if (groupId === data.activeGroupId) return
    const next = JSON.parse(JSON.stringify(data))
    switchActiveGroup(next, groupId)
    putGroups(next).then(load).catch(e => toast(e.message))
  }

  const createGroupPrompt = () => {
    if (!canAddGroup(data.routineGroups)) return toast(t('Límite de {0} grupos alcanzado.', MAX_ROUTINE_GROUPS))
    inputSheet({
      title: t('Nuevo grupo'), placeholder: t('Nombre del grupo'), defaultValue: t('Nuevo Grupo'), confirmText: t('Crear'),
      onConfirm: name => {
        const v = validateGroupName(name, data.routineGroups)
        if (!v.valid) return toast(v.error)
        const next = JSON.parse(JSON.stringify(data))
        addGroupToState(next, name, [], {}, true)
        putGroups(next).then(() => { toast(t('Grupo "{0}" creado', name)); load() }).catch(e => toast(e.message))
      }
    })
  }

  const renameGroupPrompt = g => inputSheet({
    title: t('Renombrar grupo'), placeholder: t('Nuevo nombre del grupo'), defaultValue: g.name, confirmText: t('Guardar'),
    onConfirm: name => {
      const v = validateGroupName(name, data.routineGroups, g.id)
      if (!v.valid) return toast(v.error)
      const next = JSON.parse(JSON.stringify(data))
      next.routineGroups = next.routineGroups.map(x => x.id === g.id ? { ...x, name } : x)
      putGroups(next).then(() => { toast(t('Grupo renombrado')); load() }).catch(e => toast(e.message))
    }
  })

  const deleteGroupPrompt = g => confirmSheet({
    title: t('¿Eliminar grupo?'), message: t('“{0}” y sus rutinas se eliminarán.', g.name),
    confirmText: t('Eliminar'), danger: true,
    onConfirm: () => {
      const next = JSON.parse(JSON.stringify(data))
      removeGroupFromState(next, g.id)
      putGroups(next).then(() => { toast(t('Grupo eliminado')); load() }).catch(e => toast(e.message))
    }
  })

  const saveLesionesList = lesiones => api(injuriesBase, { method: 'PUT', body: JSON.stringify({ lesiones }) }).then(load).catch(e => toast(e.message))
  const removeLesion = value => saveLesionesList((data.lesiones || []).filter(l => l !== value))
  const openAddLesion = () => openSheet(
    close => <AdminLesionPicker current={data.lesiones || []} close={close} onConfirm={saveLesionesList} />,
    { kind: 'center' }
  )

  const activeGroup = data.routineGroups.find(g => g.id === data.activeGroupId)

  return <>
    <Section title={bigSectionTitle(t('Lesiones'))} footer={<Button size="sm" icon="plus" onClick={openAddLesion}>{t('Agregar')}</Button>}>
      {(data.lesiones || []).length ? data.lesiones.map(value => <Row key={value} title={LESIONES_OPTIONS.find(o => o.value === value)?.label || value}>
        <button className="iconbtn" aria-label={t('Remove')} style={{ color: 'var(--red)' }} onClick={() => removeLesion(value)}><Icon name="trash" /></button>
      </Row>) : <div className="empty" style={{ marginBottom: 8 }}>{t('Ninguna registrada')}</div>}
    </Section>

    {!data.routineGroups.length
      ? <Section title={bigSectionTitle(t('Rutinas'))} footer={<Button size="sm" icon="plus" onClick={createGroupPrompt}>{t('Crear grupo')}</Button>}>
        <div className="empty" style={{ marginBottom: 8 }}>{t('Este usuario todavía no tiene ningún grupo ni rutina creada')}</div>
      </Section>
      : <Section title={bigSectionTitle(t('Rutinas'))} footer={<Button size="sm" icon="plus" onClick={createRoutine}>{t('Crear rutina')}</Button>}>
        <div style={{ marginBottom: 10 }}>
          <Segmented value={data.activeGroupId} onChange={switchGroup} options={data.routineGroups.map(g => ({ value: g.id, label: g.name }))} />
        </div>
        <div className="row" style={{ gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          <Button size="sm" variant="tinted" icon="pencil" onClick={() => renameGroupPrompt(activeGroup)}>{t('Renombrar grupo')}</Button>
          <Button size="sm" variant="tinted" icon="plus" disabled={!canAddGroup(data.routineGroups)} onClick={createGroupPrompt}>{t('Nuevo grupo')}</Button>
          {data.routineGroups.length > 1 && <Button size="sm" variant="tinted" icon="trash" style={{ color: 'var(--red)' }} onClick={() => deleteGroupPrompt(activeGroup)}>{t('Eliminar grupo')}</Button>}
        </div>
        {data.routines.length ? data.routines.map(r => <Row key={r.id} title={r.name} subtitle={t('{0} ejercicios', (r.ex || []).length)}>
          <div className="row" style={{ gap: 2 }}>
            <button className="iconbtn" aria-label={t('Edit')} onClick={() => openEditor(r.id)}><Icon name="pencil" /></button>
            <button className="iconbtn" aria-label={t('Remove')} style={{ color: 'var(--red)' }} onClick={() => removeRoutine(r)}><Icon name="trash" /></button>
          </div>
        </Row>) : <div className="empty" style={{ marginBottom: 8 }}>{t('Sin rutinas asignadas.')}</div>}
      </Section>}
  </>
}

// Punto de entrada desde UserDetail.
function AdminManageSheet({ userId, userName, close, setOnBack }) {
  const [tab, setTab] = useState('nutrition')
  const [suggestionFlow, setSuggestionFlow] = useState(null)
  const suggestionFlowRef = useRef(suggestionFlow)
  suggestionFlowRef.current = suggestionFlow

  // This is already a real sheet. Keep the suggestion wizard inside it; opening another
  // fullscreen sheet here was the remaining nested-sheet path to the PWA black screen.
  useEffect(() => {
    setOnBack(() => {
      if (suggestionFlowRef.current) return setSuggestionFlow(null)
      return close()
    })
  }, [close, setOnBack, suggestionFlow])

  const openSuggestion = (suggestions, onSaved) =>
    setSuggestionFlow({ initialStep: { name: 'chooser' }, suggestions, onSaved })
  const editSuggestion = (existing, suggestions, onSaved) =>
    setSuggestionFlow({ initialStep: { name: 'editor', existing }, suggestions, onSaved })

  return <div className="compound-builder">
    <div className="compound-builder-content">
      {suggestionFlow ? <AdminSuggestionWizard
        userId={userId}
        suggestions={suggestionFlow.suggestions}
        onSaved={suggestionFlow.onSaved}
        close={() => setSuggestionFlow(null)}
        setOnBack={setOnBack}
        initialStep={suggestionFlow.initialStep}
      /> : <>
        <div className="row between compound-builder-header">
          <div><h3 style={{ margin: 0 }}>{t('Administrar Nutrición/Rutina')}</h3><div className="t-sub" style={{ color: 'var(--label)', marginTop: 2 }}>{userName}</div></div>
          <button type="button" className="iconbtn" onClick={close} aria-label={t('Close')}><Icon name="xmark" /></button>
        </div>
        <Segmented options={[{ value: 'nutrition', label: t('Nutrición') }, { value: 'routine', label: t('Rutina') }]} value={tab} onChange={setTab} />
        {tab === 'nutrition' ? <AdminNutritionCard userId={userId} openSuggestion={openSuggestion} editSuggestion={editSuggestion} /> : <AdminRoutineCard userId={userId} />}
      </>}
    </div>
  </div>
}

function UserDetail({ id, onChanged, close }) {
  const [d, setD] = useState(null)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const currentUser = useStore(s => s.user)
  useEffect(() => { api('/api/admin/user?id=' + encodeURIComponent(id)).then(setD).catch(e => toast(e.message)) }, [id])
  if (!d) return <div className="muted small">{t('Loading…')}</div>
  const u = d.user
  const setDisabled = disabled => {
    api('/api/admin/user/disable', { method: 'POST', body: JSON.stringify({ id: u.id, disabled }) })
      .then(() => { toast(disabled ? t('User disabled') : t('User enabled')); onChanged(); close() })
      .catch(e => toast(e.message))
  }
  const deleteAccount = () => {
    api('/api/owner/user/delete', { method: 'POST', body: JSON.stringify({ id: u.id }) })
      .then(() => { toast(t('Account permanently deleted')); onChanged(); close() })
      .catch(e => toast(e.message))
  }
  const setAdmin = admin => {
    api('/api/owner/user/admin', { method: 'POST', body: JSON.stringify({ id: u.id, admin }) })
      .then(() => { toast(admin ? t('User promoted to admin') : t('Admin role removed')); onChanged(); close() })
      .catch(e => toast(e.message))
  }
  return <>
    <h3 className="capitalize">{u.name}</h3>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0 12px' }}>
      {(u.owner || u.admin) && <span className="tag acc">{u.owner ? t('owner') : t('admin')}</span>}
      {u.disabled && <span className="tag" style={{ color: 'var(--red)' }}>{t('disabled')}</span>}
      {u.invitedBy && <span className="tag">{t('invite')} {u.invitedBy}</span>}
      <span className="tag">{t('joined')} {u.created ? fmtDate(u.created.slice(0, 10)) : '—'}</span>
    </div>
    <div className="tiles" style={{ textAlign: 'left' }}>
      <div className="tile"><div className="l">{t('Workouts')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.workouts.length}</div></div>
      <div className="tile"><div className="l">{t('Weigh-ins')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.bodyweight.length}</div></div>
      <div className="tile"><div className="l">{t('Routines')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.routines.length}</div></div>
      <div className="tile"><div className="l">{t('Last sync')}</div><div className="v" style={{ fontSize: '.95rem' }}>{rel(d.lastSync)}</div></div>
    </div>
    <Button variant="tinted" style={{ width: '100%', margin: '4px 0 4px' }}
      onClick={() => openSheet((c, { setOnBack }) => <AdminManageSheet userId={u.id} userName={u.name} close={c} setOnBack={setOnBack} />, { locked: true, fullScreen: true, backGesture: true })}>
      {t('Administrar Nutrición/Rutina')}
    </Button>
    {currentUser?.owner && !u.owner && <button className="btn primary" style={{ margin: '12px 0 4px' }}
      onClick={() => confirmSheet({ title: u.admin ? t('Remove admin from {0}?', u.name) : t('Make {0} an admin?', u.name), message: u.admin ? t('They will keep access to normal administrative tools only if promoted again.') : t('This gives the user access to the admin dashboard and administrative tools.'), confirmText: u.admin ? t('Remove admin') : t('Make admin'), danger: false, onConfirm: () => setAdmin(!u.admin) })}>
      {u.admin ? t('Remove admin role') : t('Make admin')}</button>}
    {!u.admin && !u.owner && <button className={'btn ' + (u.disabled ? 'primary' : 'danger')} style={{ margin: '8px 0 4px' }}
      onClick={() => u.disabled ? setDisabled(false)
        : confirmSheet({ title: t('Disable {0}?', u.name), message: t('They are signed out everywhere and can no longer sync or log in until re-enabled.'), confirmText: t('Disable'), danger: true, onConfirm: () => setDisabled(true) })}>
      {u.disabled ? t('Enable account') : t('Disable account')}</button>}
    {currentUser?.owner && u.disabled && !u.owner && <button className="btn danger" style={{ margin: '8px 0 4px' }}
      onClick={() => confirmSheet({ title: t('Delete {0} permanently?', u.name), message: t('This permanently deletes the disabled account and all of its stored training data. This cannot be undone.'), confirmText: t('Delete permanently'), danger: true, onConfirm: deleteAccount })}>
      {t('Delete account permanently')}</button>}
    <h4 className="sec">{t('Workout history')}</h4>
    {d.workouts.length ? <div className="list" style={{ gap: 0 }}>
      {d.workouts.slice(0, 60).map(w => <div key={w.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{w.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {setsDone(w)} {t('sets')}{w.prs?.length ? ' · ' + w.prs.length + ' PR' : ''}</div></div>
        <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
      </div>)}
    </div> : <div className="empty small">{t('No workouts logged.')}</div>}
  </>
}

function InvitesCard({ invites, reload }) {
  const toast = useUI(s => s.toast)
  const gen = () => api('/api/admin/invites/new', { method: 'POST', body: '{}' })
    .then(({ invite }) => { navigator.clipboard?.writeText(invite.code).catch(() => {}); toast(t('Code {0} created & copied', invite.code)); reload() })
    .catch(e => toast(e.message))
  const revoke = code => api('/api/admin/invites/revoke', { method: 'POST', body: JSON.stringify({ code }) })
    .then(() => { toast(t('Code revoked')); reload() }).catch(e => toast(e.message))
  const open = (invites || []).filter(i => !i.usedBy)
  const used = (invites || []).filter(i => i.usedBy)
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>{t('Invite codes')}</h2>
      <Button variant="primary" size="sm" onClick={gen} icon="plus">{t('Generate')}</Button></div>
    <div className="small muted" style={{ margin: '6px 0 10px' }}>{open.length} {t('unused')} · {used.length} {t('redeemed')}</div>
    {open.map(i => <div key={i.code} className="row between" style={{ padding: '7px 2px', borderBottom: '1px solid var(--sep)' }}>
      <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontWeight: 500, letterSpacing: '.06em' }}
        onClick={() => { navigator.clipboard?.writeText(i.code).catch(() => {}); toast(t('Copied {0}', i.code)) }}>{i.code}</span>
      <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)' }} onClick={() => revoke(i.code)} aria-label="revoke"><Icon name="trash" /></button>
    </div>)}
    {used.map(i => <div key={i.code} className="row between dim" style={{ padding: '7px 2px', fontSize: '.8rem' }}>
      <span style={{ fontFamily: 'monospace' }}>{i.code}</span><span>→ {i.usedByName || t('used')}</span>
    </div>)}
    {!open.length && !used.length && <div className="dim small">{t('No codes yet — generate one to invite someone.')}</div>}
  </div>
}

function QrCanvas({ value, onCanvas }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!value || !ref.current) return
    const matrix = new ZXing.QRCodeWriter().encode(value, ZXing.BarcodeFormat.QR_CODE, 280, 280, new Map())
    const canvas = ref.current
    const size = matrix.getWidth()
    const scale = 4
    canvas.width = size * scale
    canvas.height = size * scale
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#000'
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      if (matrix.get(x, y)) ctx.fillRect(x * scale, y * scale, scale, scale)
    }
    onCanvas?.(canvas)
  }, [value])
  return <canvas ref={ref} aria-label={t('QR access code')} style={{ width: 280, height: 280, maxWidth: '100%', imageRendering: 'pixelated', borderRadius: 8 }} />
}

function QrAccessCard({ data, reload }) {
  const toast = useUI(s => s.toast)
  const config = useStore(s => s.config)
  const loadConfig = useStore(s => s.loadConfig)
  const [qrCanvas, setQrCanvas] = useState(null)
  useEffect(() => { loadConfig().catch(e => toast(e.message || t('Failed to load configuration'))) }, [loadConfig])
  const link = data?.token ? window.location.origin + '/?qr=' + encodeURIComponent(data.token) : ''
  const copy = () => link && navigator.clipboard?.writeText(link).then(() => toast(t('QR link copied'))).catch(() => toast(t('Could not copy the QR link')))
  const save = () => {
    if (!qrCanvas) return toast(t('Could not save the QR'))
    try {
      const name = String(config?.instance_name || 'lauyim').trim().replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').replace(/[. ]+$/g, '') || 'lauyim'
      const a = document.createElement('a')
      a.href = qrCanvas.toDataURL('image/png')
      a.download = `${name}-qr-acceso.png`
      a.click()
    } catch (e) {
      toast(e.message || t('Could not save the QR'))
    }
  }
  const regenerate = () => confirmSheet({
    title: t('Regenerate QR access?'),
    message: t('This immediately invalidates the QR currently printed or shared. A new QR link will be generated.'),
    confirmText: t('Regenerate'), danger: true,
    onConfirm: () => api('/api/owner/qr/regenerate', { method: 'POST', body: '{}' })
      .then(d => { reload(d); toast(t('QR access regenerated')) })
      .catch(e => toast(e.message || t('Failed to regenerate QR access')))
  })
  return <div className="card">
    <h2 style={{ margin: 0 }}>{t('QR access')}</h2>
    <div className="small muted" style={{ margin: '6px 0 12px' }}>{t('Anyone who opens this link can register without an invite code. The QR itself does not expire; regenerating it invalidates the previous one.')}</div>
    {data?.token ? <>
      <div className="row" style={{ alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
        <QrCanvas value={link} onCanvas={setQrCanvas} />
        <div className="grow" style={{ minWidth: 220 }}>
          <div className="small dim" style={{ marginBottom: 5 }}>{t('Current link')}</div>
          <div style={{ wordBreak: 'break-all', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontSize: '.78rem', padding: 10, background: 'var(--surface-2)', borderRadius: 8 }}>{link}</div>
          <div className="row" style={{ gap: 8, marginTop: 10 }}>
            <Button size="sm" variant="primary" onClick={save}>{t('Save QR')}</Button>
            <Button size="sm" onClick={copy}>{t('Copy link')}</Button>
            <Button size="sm" variant="danger" onClick={regenerate}>{t('Regenerate')}</Button>
          </div>
        </div>
      </div>
    </> : <div className="dim small">{t('Loading…')}</div>}
  </div>
}

function PresetEditor({ existing, close, reload }) {
  const [name, setName] = useState(existing?.name || '')
  const [groupName, setGroupName] = useState(existing ? (existing.group_name || existing.groupName || 'General') : '')
  const [plannedDay, setPlannedDay] = useState(existing?.planned_day ?? null)
  const [emoji, setEmoji] = useState(existing?.emoji || 'dumbbell')
  const [ex, setEx] = useState(() => (existing?.ex || []).map(item => ({ ...item })))
  const toast = useUI(s => s.toast)
  const add = exercise => exConfigSheet(exercise, null, cfg => setEx(current => [...current, { id: exercise.id, ...cfg }]), null, { ex })
  const save = () => {
    if (!name.trim()) return toast(t('Give the routine a name'))
    const body = JSON.stringify({ id: existing?.id, name: name.trim(), groupName: groupName.trim() || 'General', plannedDay, emoji: emoji.trim() || 'dumbbell', ex })
    api(existing ? '/api/admin/presets' : '/api/admin/presets', { method: existing ? 'PUT' : 'POST', body })
      .then(() => { toast(existing ? t('Preset updated') : t('Preset created')); close(); reload() })
      .catch(e => {
        console.error('[Presets] Failed to save preset/day', e)
        if (e.data?.error === 'ROUTINE_DAY_CONFLICT') {
          toast(t('La rutina “{0}” ya está planeada para el {1}.', e.data.routineName, t(DAYN[e.data.plannedDay])))
        } else toast(e.message)
      })
  }
  return <>
    <h3>{existing ? t('Edit preset') : t('New preset')}</h3>
    <TextField value={name} onChange={e => setName(e.target.value)} placeholder={t('Routine name')} maxLength={80} />
    <div style={{ height: 8 }} />
    <TextField value={groupName} onChange={e => setGroupName(e.target.value)} placeholder={t('Grupo de rutinas')} maxLength={80} />
    <div style={{ height: 8 }} />
    <SelectRow icon="calendar" title={t('Día planeado para hacer esta rutina')} value={plannedDay}
      options={[{ value: null, label: t('Sin día asignado') }, ...[1, 2, 3, 4, 5, 6, 0].map(day => ({ value: day, label: t(DAYN[day]) }))]}
      onChange={setPlannedDay} sheetTitle={t('Día planeado para hacer esta rutina')} />
    <div className="row" style={{ gap: 8, alignItems: 'center', margin: '10px 0' }}>
      <button className="glyph-cell on" title={t('Pick an icon')}
        onClick={() => glyphPicker(emoji, setEmoji)} aria-label={t('Pick an icon')}>
        <Icon name={glyphOf(emoji)} />
      </button>
      <span className="small muted">{t('Ícono de la rutina')}</span>
    </div>
    <div className="list" style={{ margin: '12px 0' }}>
      {ex.map((item, index) => <div className="item" key={index}>
        <div className="grow"><div className="tt">{exerciseNameFor(exOr(item.id))}</div><div className="ss">{exLine(item, 'kg')}</div></div>
        <button className="iconbtn" aria-label={t('Remove exercise')} onClick={() => setEx(current => current.filter((_, i) => i !== index))}><Icon name="trash" /></button>
      </div>)}
    </div>
    <Button icon="plus" onClick={() => exercisePicker(add)}>{t('Add exercise')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="primary" onClick={save}>{t('Save preset')}</Button>
  </>
}

function PresetsCard({ presets, openSheet, reload }) {
  const toast = useUI(s => s.toast)
  const [groupFilter, setGroupFilter] = useState('all')
  const remove = preset => confirmSheet({
    title: t('Delete {0}?', preset.name), message: t('This removes it from the preset catalog. Existing user routines are unchanged.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => api('/api/admin/presets/delete', { method: 'POST', body: JSON.stringify({ id: preset.id }) })
      .then(() => { toast(t('Preset deleted')); reload() }).catch(e => toast(e.message))
  })
  const groups = [...new Set((presets || []).map(p => String(p.group_name || 'General').trim() || 'General'))].sort((a, b) => a.localeCompare(b))
  const visiblePresets = (presets || []).filter(p => groupFilter === 'all' || (String(p.group_name || 'General').trim() || 'General') === groupFilter)
  const grouped = visiblePresets.reduce((acc, preset) => {
    const group = String(preset.group_name || 'General').trim() || 'General'
    if (!acc[group]) acc[group] = []
    acc[group].push(preset)
    return acc
  }, {})
  const groupEntries = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b))
  const groupOptions = [{ value: 'all', label: t('Todas') }, ...groups.map(group => ({ value: group, label: group }))]
  const selectGroup = value => {
    try { setGroupFilter(value) }
    catch (e) { console.error('[Presets] Failed to filter by group', e) }
  }
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>{t('Preset routines')}</h2>
      <Button variant="primary" size="sm" icon="plus" onClick={() => openSheet(close => <PresetEditor close={close} reload={reload} />)}>{t('New')}</Button></div>
    <div className="small muted" style={{ margin: '6px 0 10px' }}>{t('Templates available from the starter plan action.')}</div>
    {!!groups.length && <div style={{ overflowX: 'auto', margin: '0 -2px 10px', paddingBottom: 2 }}>
      <Segmented options={groupOptions} value={groupFilter} onChange={selectGroup} />
    </div>}
    {groupEntries.map(([group, items], groupIndex) => <div key={group} style={{ borderTop: groupIndex ? '1px solid var(--sep)' : undefined, paddingTop: groupIndex ? 12 : 0, marginTop: groupIndex ? 10 : 0 }}>
      <div className="small" style={{ fontWeight: 700, marginBottom: 4 }}>{group}:</div>
      {items.map(preset => <div key={preset.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{preset.name}</div><div className="dim" style={{ fontSize: '.72rem' }}>{preset.ex.length} {t('exercises')}</div></div>
        <div className="row" style={{ gap: 4 }}>
          <button className="iconbtn" aria-label={t('Edit preset')} onClick={() => openSheet(close => <PresetEditor existing={preset} close={close} reload={reload} />)}><Icon name="pencil" /></button>
          <button className="iconbtn" aria-label={t('Delete')} style={{ color: 'var(--red)' }} onClick={() => remove(preset)}><Icon name="trash" /></button>
        </div>
      </div>)}
    </div>)}
    {!presets?.length && <div className="dim small">{t('No presets yet.')}</div>}
    {presets?.length && !groupEntries.length && <div className="dim small">{t('No presets in this group.')}</div>}
  </div>
}

// Who signed in, who tried and failed, what an admin changed. A card rather than its own route:
// the dashboard is deliberately one page of cards, and the 95 % use of this is a glance at the
// last twenty events. Paging follows Library.jsx's house style — "Show more", not page numbers.
function AuditCard({ tick }) {
  const toast = useUI(s => s.toast)
  const [meta, setMeta] = useState(null)      // last response minus the rows: total, retention, …
  const [rows, setRows] = useState([])
  const [cat, setCat] = useState('')

  const load = (c, before) => api('/api/admin/audit?limit=50&cat=' + c + (before ? '&before=' + before : ''))
    .then(r => { setMeta(r); setRows(x => (before ? x.concat(r.events) : r.events)) })
    .catch(e => toast(e.message))
  const pick = c => { setCat(c); setRows([]); setMeta(null); load(c) }
  // Reloads on mount and whenever the header's ↻ bumps the tick. Deliberately not on the 15s
  // poll that drives "training now": this is history, not presence.
  useEffect(() => { load(cat) }, [tick])

  const clear = () => confirmSheet({
    title: t('Clear the activity log?'),
    message: t('Every recorded event is deleted. The clear itself is logged, so the gap stays visible.'),
    confirmText: t('Clear'), danger: true,
    onConfirm: () => api('/api/admin/audit/clear', { method: 'POST', body: '{}' })
      .then(() => { toast(t('Activity log cleared')); pick(cat) }).catch(e => toast(e.message))
  })

  if (meta && !meta.enabled) return null      // AUDIT_LOG=0 — the card isn't there at all

  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>{t('Activity log')}</h2>
      <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)' }}
        onClick={clear} aria-label="clear log"><Icon name="trash" /></button></div>
    <div className="small muted" style={{ margin: '6px 0 10px' }}>
      {meta ? fmtNum(meta.total) + ' ' + t('events')
        + (meta.retention.days ? ' · ' + t('last {0} days', meta.retention.days) : '') : t('Loading…')}</div>
    <div className="chips" style={{ marginBottom: 10 }}>
      {[['', 'All'], ['auth', 'Sign-ins'], ['admin', 'Admin'], ['fail', 'Failed']].map(([v, l]) =>
        <button key={v} className={'chip' + (cat === v ? ' on' : '')} onClick={() => pick(v)}>{t(l)}</button>)}
    </div>
    {rows.map(e => {
      const line = auditLine(e)
      return <div key={e.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div className="grow">
          <div className="small" style={{ fontWeight: 600 }}>{line.title}
            {/* a red pill, not a red row: twenty fumbled Face IDs in a row shouldn't read as an incident */}
            {!e.ok && <span className="tag" style={{ marginLeft: 6, color: 'var(--red)' }}>{t('failed')}</span>}
            {(auditCat(e.ev) === 'admin' || auditCat(e.ev) === 'owner') && <span className="tag acc" style={{ marginLeft: 6 }}>{t('admin')}</span>}</div>
          {line.sub && <div className="dim" style={{ fontSize: '.72rem' }}>{line.sub}</div>}
        </div>
        <span className="small muted" style={{ flex: 'none', marginLeft: 8 }}>{fmtWhen(e.ts, meta?.now)}</span>
      </div>
    })}
    {meta && !rows.length && <div className="dim small">{t('Nothing logged yet.')}</div>}
    {meta?.nextBefore && <div style={{ marginTop: 10 }}>
      <Button size="sm" onClick={() => load(cat, meta.nextBefore)}>{t('Show more')}</Button></div>}
  </div>
}

function PushNotificationCard() {
  const [titulo, setTitulo] = useState('')
  const [texto, setTexto] = useState('')
  const [redirectUrl, setRedirectUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const toast = useUI(s => s.toast)

  const sendPush = () => {
    const cleanTitle = titulo.trim()
    const cleanText = texto.trim()
    const cleanUrl = redirectUrl.trim()

    if (!cleanTitle || !cleanText) {
      toast(t('Title and text are required'))
      return
    }

    if (cleanUrl) {
      try {
        const u = new URL(cleanUrl)
        if (!['http:', 'https:'].includes(u.protocol)) {
          toast(t('URL must start with http:// or https://'))
          return
        }
      } catch {
        toast(t('Invalid URL'))
        return
      }
    }

    setLoading(true)
    api('/api/admin/push', {
      method: 'POST',
      body: JSON.stringify({
        titulo: cleanTitle,
        texto: cleanText,
        redirectUrl: cleanUrl || null
      })
    })
      .then(res => {
        setLoading(false)
        toast(t('Notification sent to {0} subscriptions', res.sent ?? 0))
        setTitulo('')
        setTexto('')
        setRedirectUrl('')
      })
      .catch(e => {
        setLoading(false)
        toast(e.message || t('Failed to send push'))
      })
  }

  return (
    <div className="card">
      <h3 style={{ margin: '0 0 12px' }}>{t('Enviar notificación')}</h3>
      
      <div style={{ marginBottom: 10 }}>
        <div className="row between small dim" style={{ marginBottom: 4 }}>
          <span>{t('Título')}</span>
          <span>{titulo.length}/50</span>
        </div>
        <input {...NO_AUTOFILL} name="app-admin-notification-title"
          className="input"
          type="text"
          maxLength={50}
          placeholder={t('Título de la notificación')}
          value={titulo}
          onChange={e => setTitulo(e.target.value)}
        />
      </div>

      <div style={{ marginBottom: 10 }}>
        <div className="row between small dim" style={{ marginBottom: 4 }}>
          <span>{t('Texto / cuerpo')}</span>
          <span>{texto.length}/120</span>
        </div>
        <textarea {...NO_AUTOFILL} name="app-admin-notification-body"
          className="input"
          rows={3}
          maxLength={120}
          placeholder={t('Escribí el mensaje de la notificación...')}
          value={texto}
          onChange={e => setTexto(e.target.value)}
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <div className="small dim" style={{ marginBottom: 4 }}>{t('Redirect (opcional)')}</div>
        <input {...NO_AUTOFILL} name="app-admin-redirect"
          className="input"
          type="url"
          placeholder="https://instagram.com/..."
          value={redirectUrl}
          onChange={e => setRedirectUrl(e.target.value)}
        />
      </div>

      <Button variant="primary" disabled={loading || !titulo.trim() || !texto.trim()} onClick={sendPush}>
        {loading ? t('Enviando…') : t('Enviar')}
      </Button>
    </div>
  )
}

export default function Admin() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [users, setUsers] = useState(null)
  const [invites, setInvites] = useState(null)
  const [presets, setPresets] = useState(null)
  const [inviteOnly, setInviteOnly] = useState(false)
  const [attendance, setAttendance] = useState(null)
  const [qrAccess, setQrAccess] = useState(null)
  const [tick, setTick] = useState(0)          // the ↻ button; the activity log listens to it
  const [userSearch, setUserSearch] = useState('')
  const [userPage, setUserPage] = useState(1)

  const loadUsers = () => api('/api/admin/users').then(d => { setUsers(d.users); setInviteOnly(d.invite_only) }).catch(e => toast(e.message || t('Failed to load')))
  const loadInvites = () => api('/api/admin/invites').then(d => setInvites(d.invites)).catch(() => {})
  const loadPresets = () => api('/api/presets').then(d => setPresets(d.presets)).catch(e => toast(e.message || t('Failed to load presets')))
  const loadAttendance = () => api('/api/admin/attendance-heatmap').then(setAttendance).catch(e => toast(e.message || t('Failed to load attendance')))
  const loadQrAccess = () => { if (user?.owner) api('/api/owner/qr').then(setQrAccess).catch(e => toast(e.message || t('Failed to load QR access'))) }
  // poll every 15s so the "training now" section stays live without a manual refresh
  useEffect(() => { if (!user?.admin) return; loadUsers(); loadInvites(); loadPresets(); loadAttendance(); loadQrAccess(); const iv = setInterval(() => { loadUsers(); loadAttendance() }, 15000); return () => clearInterval(iv) }, [user?.owner])
  if (!user?.admin) return null

  const openUser = id => openSheet(close => <UserDetail id={id} onChanged={loadUsers} close={close} />)
  const liveUsers = (users || []).filter(u => u.live)
  const activeCount = (users || []).filter(u => u.lastSync && Date.now() - u.lastSync < 7 * 86400000).length
  const disabledCount = (users || []).filter(u => u.disabled).length
  const filteredUsers = (users || []).filter(u => u.name.toLocaleLowerCase().includes(userSearch.trim().toLocaleLowerCase()))
  const userPageCount = Math.max(1, Math.ceil(filteredUsers.length / 6))
  const visibleUsers = filteredUsers.slice((userPage - 1) * 6, userPage * 6)
  const changeUserSearch = value => { setUserSearch(value); setUserPage(1) }
  useEffect(() => { setUserPage(page => Math.min(page, userPageCount)) }, [userPageCount])

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Admin')}</h1>
        <div className="sub">{users ? users.length + ' ' + t('users') + ' · ' + activeCount + ' ' + t('active this week') : t('Loading…')}</div></div>
      <button className="iconbtn" onClick={() => { loadUsers(); loadInvites(); loadPresets(); loadAttendance(); loadQrAccess(); setTick(n => n + 1) }} aria-label={t('Refresh')}>↻</button>
    </div>

    <div className="tiles" style={{ marginBottom: 12 }}>
      <div className="tile"><div className="l">{t('Users')}</div><div className="v">{users ? users.length : '—'}</div></div>
      <div className="tile"><div className="l">{t('Training now')}</div><div className="v" style={{ color: liveUsers.length ? 'var(--acc)' : undefined }}>{users ? liveUsers.length : '—'}</div></div>
      <div className="tile"><div className="l">{t('Active 7d')}</div><div className="v">{users ? activeCount : '—'}</div></div>
      <div className="tile"><div className="l">{t('Disabled')}</div><div className="v">{users ? disabledCount : '—'}</div></div>
    </div>

    {liveUsers.length > 0 && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <h2 className="row" style={{ margin: '0 0 8px', gap: 6 }}><Icon name="dot" style={{ fontSize: 10, color: 'var(--green)' }} />{t('Training now')}</h2>
      {liveUsers.map(u => <div key={u.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }} onClick={() => openUser(u.id)}>
        <div><div className="small" style={{ fontWeight: 600 }}>{u.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{u.live.name} · ex {u.live.exIdx}/{u.live.exTotal} · {u.live.setsDone}/{u.live.setsTotal} {t('sets')}</div></div>
        <span className="tag acc">{dur(Date.now() - u.live.startedAt)}</span>
      </div>)}
    </div>}

    <InvitesCard invites={invites} reload={loadInvites} />
    {user?.owner && <QrAccessCard data={qrAccess} reload={setQrAccess} />}
    <PresetsCard presets={presets} openSheet={openSheet} reload={loadPresets} />
    <PushNotificationCard />
    <AttendanceHeatmap data={attendance} onStartChange={start => api('/api/admin/attendance-week-start', { method: 'POST', body: JSON.stringify({ start }) }).then(loadAttendance).catch(e => toast(e.message || t('Failed to save setting')))} />

    <h4 className="sec">{t('Usuarios: {0} ({1} Desactivados)', users ? users.length : 0, disabledCount)}</h4>
    <div style={{ marginBottom: 10 }}>
      <TextField name="admin-user-search" value={userSearch} onChange={e => changeUserSearch(e.target.value)}
        placeholder={t('Search users by name')} aria-label={t('Search users by name')} />
    </div>
    <div className="list">
      {visibleUsers.map(u => <div key={u.id} className="item" onClick={() => openUser(u.id)} style={u.disabled ? { opacity: .55 } : null}>
        <div className="grow"><div className="tt">{u.live && <Icon name="dot" style={{ fontSize: 9, color: 'var(--green)', display: 'inline-block', marginRight: 5 }} />}{u.name} {(u.owner || u.admin) && <span className="tag acc" style={{ marginLeft: 4 }}>{u.owner ? t('owner') : t('admin')}</span>}{u.disabled && <span className="tag" style={{ marginLeft: 4, color: 'var(--red)' }}>{t('off')}</span>}</div>
          <div className="ss">{u.live ? t('training now') + ' · ' + u.live.name : u.workouts + ' ' + t('workouts') + (u.lastWorkout ? ' · ' + t('last') + ' ' + fmtDate(u.lastWorkout) : '') + ' · ' + t('synced') + ' ' + rel(u.lastSync)}</div></div>
        {u.hasPush && <Icon name="bell" title="push enabled" style={{ fontSize: 15, color: 'var(--label-3)' }} />}<Icon name="chevronRight" className="chev" />
      </div>)}
      {users && !filteredUsers.length && <div className="empty">{userSearch ? t('No users match that name.') : t('No users yet.')}</div>}
    </div>
    {users && filteredUsers.length > 0 && <div className="row between" style={{ marginTop: 10, gap: 6 }}>
      <button className="btn" style={{ padding: '11px 14px', fontSize: '13.6px', borderRadius: 'calc(var(--r) * .8)' }} disabled={userPage === 1} onClick={() => setUserPage(1)}>{t('First')}</button>
      <button className="btn" style={{ padding: '11px 14px', fontSize: '13.6px', borderRadius: 'calc(var(--r) * .8)' }} disabled={userPage === 1} onClick={() => setUserPage(p => Math.max(1, p - 1))}>{t('Previous')}</button>
      <span className="muted" style={{ fontSize: '1.08rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{userPage} / {userPageCount}</span>
      <button className="btn" style={{ padding: '11px 14px', fontSize: '13.6px', borderRadius: 'calc(var(--r) * .8)' }} disabled={userPage === userPageCount} onClick={() => setUserPage(p => Math.min(userPageCount, p + 1))}>{t('Next')}</button>
      <button className="btn" style={{ padding: '11px 14px', fontSize: '13.6px', borderRadius: 'calc(var(--r) * .8)' }} disabled={userPage === userPageCount} onClick={() => setUserPage(userPageCount)}>{t('Last')}</button>
    </div>}

    <div style={{ marginTop: 14 }}><AuditCard tick={tick} /></div>
  </div>
}
