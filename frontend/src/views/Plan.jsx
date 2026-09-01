import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { DAYN, uid, exCount } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { dayAssignSheet, loadStarterPlan, planToolsSheet, confirmSheet } from '../sheets.jsx'
import { MAX_ROUTINE_GROUPS } from '../lib/routineGroups.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'

export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const getRoutineGroups = useStore(s => s.getRoutineGroups)
  const setActiveGroupId = useStore(s => s.setActiveGroupId)
  const addGroup = useStore(s => s.addGroup)
  const removeGroup = useStore(s => s.removeGroup)

  const renameGroup = useStore(s => s.renameGroup)

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
    const groupName = prompt(t('Nombre del grupo')) || t('Nuevo Grupo')
    if (groupName) {
      addGroup(groupName, [], {}, true)
      toast(t('Grupo "{0}" creado', groupName))
    }
  }

  const renameGroupPrompt = (g) => {
    const newName = prompt(t('Nuevo nombre del grupo'), g.name)
    if (newName && newName.trim()) {
      try {
        renameGroup(g.id, newName.trim())
        toast(t('Grupo renombrado'))
      } catch (e) {
        toast(e.message || t('Error al renombrar grupo'))
      }
    }
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
    <div className="cols"><div>
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
        <Button size="sm" variant="tinted" icon="plus" onClick={addRoutine}>{t('New')}</Button>
        {S.routineGroups && S.routineGroups.length > 0 && (
          <Button size="sm" variant="tinted" icon="folder" style={{ marginLeft: 8 }} onClick={addGroupBtn}>{t('New group')}</Button>
        )}
      </div>
      {S.routines.length ? <div className="list">{S.routines.map(r => <div key={r.id} className="item" onClick={() => nav('/plan/r/' + r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        <Icon name="chevronRight" className="chev" /></div>)}</div> : <>
        <div className="empty"><div className="ico"><Icon name="clipboard" /></div>{t('No routines yet.')}<br />{t('Create one or load the starter plan.')}</div>
        <Button icon="sparkles" onClick={loadStarterPlan}>{t('Load starter plan (Push / Pull / Legs)')}</Button>
      </>}
      {S.routineGroups && S.routineGroups.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 10, borderTop: 'var(--sep) solid' }}>
          <div className="row between" style={{ marginBottom: 6 }}>
            <div className="muted small" style={{ fontWeight: 500 }}>{t('Grupos de rutinas')}</div>
            <Button size="sm" variant="tinted" icon="folder" onClick={addGroupBtn}>{t('Nuevo grupo')}</Button>
          </div>
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
        </div>
      )}
    </div></div>
  </>
}
