import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { DAYN, uid, exCount } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { dayAssignSheet, loadStarterPlan, planToolsSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'

export default function Plan() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const { getRoutineGroups, setActiveGroupId, addGroup, removeGroup } = useStore()

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
        <div style={{ marginTop: 8, paddingTop: 4, borderTop: 'var(--sep) solid' }}>
          <div className="muted small" style={{ fontWeight: 500, marginBottom: 4 }}>{t('Grupos de rutinas')}</div>
          <div className="row" style={{ gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
            {S.routineGroups.map((g) => (
              <Button
                key={g.id}
                style={{
                  flex: 1,
                  minWidth: '120px',
                  background: S.activeGroupId === g.id ? 'var(--acc)' : 'none',
                  color: S.activeGroupId === g.id ? 'white' : 'var(--acc)',
                  border: S.activeGroupId === g.id ? 'none' : '1px solid var(--acc)',
                  borderRadius: 4,
                  padding: '4px 8px',
                  fontSize: '0.81rem',
                  textAlign: 'left',
                }}
                onClick={() => setActiveGroupId(g.id)}
              >
                {g.name}
                {S.activeGroupId === g.id && <span className="muted" style={{ fontSize: '0.7rem', marginLeft: 4 }}>• activo</span>}
              </Button>
            ))}
            <Button
              style={{
                flex: 1,
                minWidth: '120px',
                background: 'none',
                color: 'var(--orange)',
                border: '1px solid var(--orange)',
                borderRadius: 4,
                padding: '4px 8px',
                fontSize: '0.81rem',
                textAlign: 'left',
              }}
              onClick={() => confirmSheet({
                title: t('Eliminar grupo'),
                message: t('¿Estás seguro de eliminar el grupo {0}? Esto moverá sus rutinas al grupo activo.'),
                confirmText: t('Eliminar'),
                onConfirm: () => {
                  const activeId = get().S.activeGroupId
                  removeGroup(activeId)
                },
              })}
            >
              {t('Eliminar grupo')}
            </Button>
          </div>
        </div>
      )}
    </div></div>
  </>
}
