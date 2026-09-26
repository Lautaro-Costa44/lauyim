import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { DAYN, uid, exCount } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { dayAssignSheet, programPickerSheet, planToolsSheet, confirmSheet, inputSheet } from '../sheets.jsx'
import { api } from '../lib/api.js'
import { programsOf } from '../components/ProgramPicker.jsx'
import { MAX_ROUTINE_GROUPS } from '../lib/routineGroups.js'
import Icon from '../components/Icon.jsx'
import { Button, Segmented } from '../components/ui.jsx'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'
import Library from './Library.jsx'

export default function Plan() {
  const nav = useNavigate()
  const loc = useLocation()
  const exercisesTab = loc.pathname === '/plan/ejercicios'
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const getRoutineGroups = useStore(s => s.getRoutineGroups)
  const setActiveGroupId = useStore(s => s.setActiveGroupId)
  const addGroup = useStore(s => s.addGroup)
  const removeGroup = useStore(s => s.removeGroup)

  const renameGroup = useStore(s => s.renameGroup)
  // Programas del gym visibles para socios, para "Cargar un plan" (solo sin rutinas). Sin
  // ninguno el botón no aparece: la app no trae un plan propio.
  const [presetData, setPresetData] = useState(null)
  const empty = S.routines.length === 0
  useEffect(() => {
    if (!empty) return
    let alive = true
    api('/api/presets').then(d => { if (alive) setPresetData(d) }).catch(() => {})
    return () => { alive = false }
  }, [empty])
  const canLoadPlan = programsOf(presetData).length > 0

  const addRoutine = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => { s.routines.push(r) })
    nav('/plan/r/' + r.id)
  }

  // Add group button
  const addGroupBtn = () => {
    const groups = getRoutineGroups()
    if (groups.length >= MAX_ROUTINE_GROUPS) {
      toast(t('Límite de {0} grupos alcanzado.', MAX_ROUTINE_GROUPS))
      return
    }
    inputSheet({
      title: t('Nuevo grupo'),
      placeholder: t('Nombre del grupo'),
      defaultValue: t('Nuevo Grupo'),
      confirmText: t('Crear'),
      onConfirm: (groupName) => {
        addGroup(groupName, [], {}, true)
        toast(t('Grupo "{0}" creado', groupName))
      }
    })
  }

  const renameGroupPrompt = (g) => {
    inputSheet({
      title: t('Renombrar grupo'),
      placeholder: t('Nuevo nombre del grupo'),
      defaultValue: g.name,
      confirmText: t('Guardar'),
      onConfirm: (newName) => {
        try {
          renameGroup(g.id, newName)
          toast(t('Grupo renombrado'))
        } catch (e) {
          toast(e.message || t('Error al renombrar grupo'))
        }
      }
    })
  }

  const deleteGroupPrompt = (g) => {
    confirmSheet({
      title: t('Eliminar grupo'),
      message: t('¿Estás seguro de eliminar el grupo {0}?', g.name),
      confirmText: t('Eliminar'),
      onConfirm: () => {
        removeGroup(g.id)
        toast(t('Grupo eliminado'))
      },
    })
  }

  return <>
    <div className="hdr">
      <div><h1>{t('Plan')}</h1><div className="sub">{t('Your weekly routine')}</div></div>
      <button className="iconbtn" onClick={planToolsSheet} aria-label={t('Share your plan')} title={t('Share your plan')}><Icon name="upload" /></button>
    </div>
    <Segmented
      className="plan-tabs"
      value={exercisesTab ? 'exercises' : 'routine'}
      onChange={tab => nav(tab === 'exercises' ? '/plan/ejercicios' : '/plan')}
      options={[{ value: 'routine', label: t('Routine') }, { value: 'exercises', label: t('Exercises') }]}
    />
    {exercisesTab ? <div className="plan-exercises"><Library /></div> : <div className="cols"><div>
      <h4 className="sec">{t('Week schedule')}</h4>
      <div className="list" style={{ display: 'flex', flexDirection: 'column' }}>
        {[1, 2, 3, 4, 5, 6, 0].map(d => {
          const r = S.routines.find(x => x.id === S.week[d])
          return <div key={d} className="item" onClick={() => dayAssignSheet(d)}>
            <div className="grow"><div className="tt">{t(DAYN[d])}</div></div>
            {r ? <span className="tag acc"><Icon name={glyphOf(r.emoji)} />{r.name}</span> : <span className="tag">{t('Rest')}</span>}
            <Icon name="chevronRight" className="chev" /></div>
        })}
      </div>
    </div><div>
      <div className="row between" style={{ marginTop: 22, marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Routines')}</h4>
        <div className="row" style={{ gap: 6 }}>
          <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New')}</Button>
        </div>
      </div>
      {S.routines.length ? <div className="list">{S.routines.map(r => <div key={r.id} className="item" onClick={() => nav('/plan/r/' + r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        <Icon name="chevronRight" className="chev" /></div>)}</div> : <>
        <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}
          {canLoadPlan && <><br />{t('Create one or load the starter plan.')}
            <div style={{ marginTop: 14 }}><Button variant="tinted" icon="list" onClick={() => programPickerSheet(presetData)}>{t('Cargar un plan')}</Button></div>
          </>}
        </div>
      </>}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: 'var(--sep) solid' }}>
        <div className="row between" style={{ marginBottom: 6 }}>
          <div className="muted small" style={{ fontWeight: 500 }}>{t('Grupos de rutinas')}</div>
          <Button size="sm" variant="tinted" icon="folder" onClick={addGroupBtn}>{t('Nuevo grupo')}</Button>
        </div>
        {S.routineGroups && S.routineGroups.length > 0 ? (
          <div className="list" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {S.routineGroups.map((g) => {
              const isActive = S.activeGroupId === g.id
              return (
                <div
                  key={g.id}
                  className="item"
                  style={{
                    background: isActive ? 'color-mix(in srgb, var(--acc) 10%, var(--surface))' : undefined,
                    borderColor: isActive ? 'var(--acc)' : undefined,
                    cursor: 'pointer',
                  }}
                  onClick={() => setActiveGroupId(g.id)}
                >
                  <span className="lrow-i" style={{ background: isActive ? 'var(--acc)' : 'var(--surface-3)', color: isActive ? '#fff' : 'var(--text)' }}>
                    <Icon name="folder" />
                  </span>
                  <div className="grow">
                    <div className="tt">
                      {g.name}
                      {isActive && <span className="tag acc" style={{ marginLeft: 8, fontSize: '0.7rem', padding: '1px 6px' }}>{t('Activo')}</span>}
                    </div>
                    <div className="ss">{t('{0} rutinas', (g.routines || []).length)}</div>
                  </div>
                  <div className="row" style={{ gap: 4 }} onClick={e => e.stopPropagation()}>
                    <button
                      className="iconbtn"
                      style={{ width: 30, height: 30, fontSize: 14 }}
                      onClick={() => renameGroupPrompt(g)}
                      title={t('Renombrar')}
                      aria-label={t('Renombrar')}
                    >
                      <Icon name="edit" />
                    </button>
                    {S.routineGroups.length > 1 && (
                      <button
                        className="iconbtn"
                        style={{ width: 30, height: 30, fontSize: 14, color: 'var(--orange)' }}
                        onClick={() => deleteGroupPrompt(g)}
                        title={t('Eliminar')}
                        aria-label={t('Eliminar')}
                      >
                        <Icon name="trash" />
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="empty" style={{ padding: '12px 0', fontSize: '0.85rem' }}>
            {t('No hay grupos de rutinas creados.')}
          </div>
        )}
      </div>
    </div></div>}
  </>
}
