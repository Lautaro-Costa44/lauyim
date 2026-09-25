import { useCallback, useEffect, useState, useRef } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { api } from '../../lib/api.js'
import { fmtDate, fmtVol, fmtDur, uid } from '../../lib/format.js'
import { workoutVolume, setsDone } from '../../lib/history.js'
import { confirmSheet, inputSheet } from '../../sheets.jsx'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Button, TextField, SelectRow, Segmented, Section, Row, Switch, NumberField } from '../../components/ui.jsx'
import { FoodPicker, GrupoComidaRow, totalesDeIngredientes, FRANJAS } from '../Nutricion.jsx'
import RoutineEditor from '../RoutineEditor.jsx'
import { LESIONES_OPTIONS, OBJETIVO_OPTIONS, CheckPill } from '../SurveyWizard.jsx'
import { BillingSummaryCard } from './billing/common.jsx'
import { FichaCard, NoAppBadge, openMemberSheet } from './members/common.jsx'
import { MAX_ROUTINE_GROUPS, canAddGroup, validateGroupName, syncActiveGroupInState, switchActiveGroup, addGroupToState, removeGroupFromState } from '../../lib/routineGroups.js'

// Shared by more than one admin section: UserDetail opens from Resumen ("Training now") and
// from Usuarios (the list), and carries the whole "Administrar Nutrición/Rutina" sheet with it.

export const rel = ts => {
  if (!ts) return t('never')
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return t('just now')
  if (s < 3600) return t('{0}m ago', Math.floor(s / 60))
  if (s < 86400) return t('{0}h ago', Math.floor(s / 3600))
  return t('{0}d ago', Math.floor(s / 86400))
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
  // `useEffect(load, [])` pasaba la promesa de load() como función de limpieza: al desmontar
  // el catálogo React llamaba destroy() sobre una promesa y tiraba "destroy is not a function",
  // matando el árbol entero — el admin quedaba fuera del sheet del socio.
  useEffect(() => { load() }, [])
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
      .then(({ template }) => { toast(t('Comida global creada')); onCreated(template) })
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
// El wizard NO registra su propio onBack en el sheet: el dueño del handler es siempre
// AdminManageSheet (un solo registrante por sheet, sin carreras de orden de efectos entre
// padre e hijo). Publica su paso-atrás en `backRef` y el padre delega ahí mientras exista.
function AdminSuggestionWizard({ userId, suggestions, onSaved, close, backRef, initialStep = { name: 'chooser' } }) {
  const [step, setStep] = useState(initialStep)
  const stepRef = useRef(step)
  stepRef.current = step
  useEffect(() => {
    backRef.current = () => {
      const cur = stepRef.current
      if (cur.name === 'franja') return setStep({ name: 'detail', plantilla: cur.plantilla })
      if (cur.name === 'detail') return setStep({ name: 'picker' })
      if (cur.name === 'picker') return setStep({ name: 'chooser' })
      if (cur.name === 'global') return setStep({ name: 'picker' })
      close()
    }
    return () => { backRef.current = null }
  }, [close, backRef])

  if (step.name === 'editor') return <AdminSuggestionEditor userId={userId} existing={step.existing} close={close} onFinish={close} onSaved={onSaved} />
  // Cancelar o crear una comida global vuelve al catálogo, no cierra el wizard entero: se
  // entró acá para asignarle algo al socio y esa asignación todavía no pasó.
  if (step.name === 'global') return <AdminGlobalTemplateEditor categorias={step.categorias || []}
    close={() => setStep({ name: 'picker' })} onCreated={() => setStep({ name: 'picker' })} />
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

const NUTRITION_GOAL_LIMITS = { macros: 2000, calories: 20000 }

function AdminNutritionCard({ userId, openSuggestion, editSuggestion }) {
  const toast = useUI(s => s.toast)
  const automaticoHabilitado = useStore(s => s.config?.nutricion_automatico) !== false
  const [data, setData] = useState(null)
  const [saving, setSaving] = useState(false)
  const [manualDraft, setManualDraft] = useState(null)
  const [manualError, setManualError] = useState(null)
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
  const setDraft = patch => { setManualError(null); setManualDraft({ ...draft, ...patch }) }
  const toggleMode = manual => {
    if (manual) return setManualDraft(draft)
    setSaving(true)
    api(base + '/goals', { method: 'PUT', body: JSON.stringify({ mode: 'automatic' }) })
      .then(() => { toast(t('Metas vueltas a automático')); load() }).catch(e => toast(e.message)).finally(() => setSaving(false))
  }
  const saveManual = () => {
    const fields = [
      ['caloriesBurn', draft.caloriesBurn, 'Kcalorías a quemar', NUTRITION_GOAL_LIMITS.calories, false],
      ['calories', draft.calories, 'Kcalorías a consumir', NUTRITION_GOAL_LIMITS.calories, false],
      ['protein', draft.protein, 'Proteínas', NUTRITION_GOAL_LIMITS.macros, true],
      ['carbs', draft.carbs, 'Carbohidratos', NUTRITION_GOAL_LIMITS.macros, true],
      ['fat', draft.fat, 'Grasas', NUTRITION_GOAL_LIMITS.macros, true],
    ]
    const invalid = fields.find(([, value, , max, decimal]) => value !== null && value !== undefined &&
      (!Number.isFinite(value) || value < 0 || value > max || (!decimal && !Number.isInteger(value))))
    if (invalid) {
      const [, value, label, max, decimal] = invalid
      setManualError(value > max ? `${label}: máximo ${max}${decimal ? ' g' : ''}` :
        !decimal && !Number.isInteger(value) ? `${label}: debe ser un número entero` : `${label}: debe ser mayor o igual que 0`)
      return
    }
    setManualError(null)
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
          <Row title={t('Kcalorías a quemar')}><NumberField className="admin-goal-num" value={draft.caloriesBurn} onChange={v => setDraft({ caloriesBurn: v })} decimal={false} max={NUTRITION_GOAL_LIMITS.calories} nullable /></Row>
          <Row title={t('Kcalorías a consumir')}><NumberField className="admin-goal-num" value={draft.calories} onChange={v => setDraft({ calories: v })} decimal={false} max={NUTRITION_GOAL_LIMITS.calories} nullable /></Row>
          <Row title={t('Proteínas (g)')}><NumberField className="admin-goal-num" value={draft.protein} onChange={v => setDraft({ protein: v })} max={NUTRITION_GOAL_LIMITS.macros} nullable /></Row>
          <Row title={t('Carbohidratos (g)')}><NumberField className="admin-goal-num" value={draft.carbs} onChange={v => setDraft({ carbs: v })} max={NUTRITION_GOAL_LIMITS.macros} nullable /></Row>
          <Row title={t('Grasas (g)')}><NumberField className="admin-goal-num" value={draft.fat} onChange={v => setDraft({ fat: v })} max={NUTRITION_GOAL_LIMITS.macros} nullable /></Row>
        </div>
        {manualError && <div role="alert" className="error small" style={{ marginTop: 8 }}>{manualError}</div>}
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

// Punto de entrada desde UserDetail. Exportado para poder testear el flujo completo de
// administración de un socio (metas, sugerencias, comidas globales) sin montar todo el panel.
export function AdminManageSheet({ userId, userName, close, setOnBack }) {
  const [tab, setTab] = useState('nutrition')
  const [suggestionFlow, setSuggestionFlow] = useState(null)
  const suggestionFlowRef = useRef(suggestionFlow)
  suggestionFlowRef.current = suggestionFlow
  // Paso-atrás publicado por el wizard mientras está montado (ver AdminSuggestionWizard).
  const wizardBack = useRef(null)

  // This is already a real sheet. Keep the suggestion wizard inside it; opening another
  // fullscreen sheet here was the remaining nested-sheet path to the PWA black screen.
  // Único registro de onBack de este sheet, y se hace una sola vez: todo lo variable se lee
  // por ref. Volver a registrar en cada cambio de paso realimentaba el render de Modals.
  useEffect(() => {
    setOnBack(() => {
      if (wizardBack.current) return wizardBack.current()
      if (suggestionFlowRef.current) return setSuggestionFlow(null)
      return close()
    })
    return () => setOnBack(null)
  }, [close, setOnBack])

  // Estable: es dependencia del efecto que publica el paso-atrás del wizard.
  const closeSuggestionFlow = useCallback(() => setSuggestionFlow(null), [])

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
        close={closeSuggestionFlow}
        backRef={wizardBack}
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

// billingEnabled comes from the admin users poll; false hides the membership card (cuotas off).
// users (the same poll) feeds the account picker of "Vincular". openUser shows another member
// (Usuarios: the desktop panel or a sheet); without it, a sheet on top.
export function UserDetail({ id, billingEnabled = true, users, openUser, onChanged, close }) {
  const [d, setD] = useState(null)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const showUser = openUser || (otherId => openSheet(c => <UserDetail id={otherId} billingEnabled={billingEnabled} users={users} onChanged={onChanged} close={c} />))
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
  // Ficha without a passkey: nothing to train or sync, so the training parts stay out.
  const hasApp = u.hasApp !== false
  // The ficha is gone after a merge: close its detail and show the account it joined.
  const merge = ({ fichaId, fichaName, targetId }) => openMemberSheet(openSheet, 'MergeSheet', {
    ficha: { id: fichaId, name: fichaName }, users, targetId,
    onMerged: destId => { onChanged(); close(); showUser(destId) }
  })
  return <>
    <h3 className="capitalize">{u.name}</h3>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0 12px' }}>
      {!hasApp && <NoAppBadge style={{ marginLeft: 0 }} />}
      {(u.owner || u.admin) && <span className="tag acc">{u.owner ? t('owner') : t('admin')}</span>}
      {u.disabled && <span className="tag" style={{ color: 'var(--red)' }}>{t('disabled')}</span>}
      {u.invitedBy && <span className="tag">{t('invite')} {u.invitedBy}</span>}
      <span className="tag">{t('joined')} {typeof u.created === 'string' && u.created ? fmtDate(u.created.slice(0, 10)) : '—'}</span>
    </div>
    {hasApp && <div className="tiles" style={{ textAlign: 'left' }}>
      <div className="tile"><div className="l">{t('Workouts')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.workouts.length}</div></div>
      <div className="tile"><div className="l">{t('Weigh-ins')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.bodyweight.length}</div></div>
      <div className="tile"><div className="l">{t('Routines')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.routines.length}</div></div>
      <div className="tile"><div className="l">{t('Last sync')}</div><div className="v" style={{ fontSize: '.95rem' }}>{rel(d.lastSync)}</div></div>
    </div>}
    {!hasApp && <div className="member-noapp">
      <div className="small muted">{t('Este socio todavía no usa la app. Dale un código para que cree su acceso, o unilo a su cuenta si ya tiene una.')}</div>
      <Button variant="primary" onClick={() => openMemberSheet(openSheet, 'LinkCodeSheet', { user: u })}>{t('Generar código de vinculación')}</Button>
      <Button variant="tinted" onClick={() => merge({ fichaId: u.id, fichaName: u.name })}>{t('Vincular con cuenta existente')}</Button>
    </div>}
    <FichaCard user={{ ...u, hasApp }} users={users} openSheet={openSheet} openUser={showUser} onLink={merge} />
    {billingEnabled !== false && <BillingSummaryCard userId={u.id} userName={u.name} openSheet={openSheet} onChanged={onChanged} />}
    {hasApp && <Button variant="tinted" style={{ width: '100%', margin: '4px 0 4px' }}
      onClick={() => openSheet((c, { setOnBack }) => <AdminManageSheet userId={u.id} userName={u.name} close={c} setOnBack={setOnBack} />, { locked: true, fullScreen: true, backGesture: true })}>
      {t('Administrar Nutrición/Rutina')}
    </Button>}
    {hasApp && currentUser?.owner && !u.owner && <button className="btn primary" style={{ margin: '12px 0 4px' }}
      onClick={() => confirmSheet({ title: u.admin ? t('Remove admin from {0}?', u.name) : t('Make {0} an admin?', u.name), message: u.admin ? t('They will keep access to normal administrative tools only if promoted again.') : t('This gives the user access to the admin dashboard and administrative tools.'), confirmText: u.admin ? t('Remove admin') : t('Make admin'), danger: false, onConfirm: () => setAdmin(!u.admin) })}>
      {u.admin ? t('Remove admin role') : t('Make admin')}</button>}
    {!u.admin && !u.owner && <button className={'btn ' + (u.disabled ? 'primary' : 'danger')} style={{ margin: '8px 0 4px' }}
      onClick={() => u.disabled ? setDisabled(false)
        : confirmSheet({ title: t('Disable {0}?', u.name), message: t('They are signed out everywhere and can no longer sync or log in until re-enabled.'), confirmText: t('Disable'), danger: true, onConfirm: () => setDisabled(true) })}>
      {u.disabled ? t('Enable account') : t('Disable account')}</button>}
    {currentUser?.owner && u.disabled && !u.owner && <button className="btn danger" style={{ margin: '8px 0 4px' }}
      onClick={() => confirmSheet({ title: t('Delete {0} permanently?', u.name), message: t('This permanently deletes the disabled account and all of its stored training data. This cannot be undone.'), confirmText: t('Delete permanently'), danger: true, onConfirm: deleteAccount })}>
      {t('Delete account permanently')}</button>}
    {hasApp && <h4 className="sec">{t('Workout history')}</h4>}
    {!hasApp ? null : d.workouts.length ? <div className="list" style={{ gap: 0 }}>
      {d.workouts.slice(0, 60).map(w => <div key={w.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{w.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {setsDone(w)} {t('sets')}{w.prs?.length ? ' · ' + w.prs.length + ' PR' : ''}</div></div>
        <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
      </div>)}
    </div> : <div className="empty small">{t('No workouts logged.')}</div>}
  </>
}
