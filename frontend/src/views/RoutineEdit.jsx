import { useNavigate, useParams } from 'react-router-dom'
import { useEffect, Fragment } from 'react'
import { useStore } from '../store/useStore.js'
import { exOr, isCardio } from '../lib/exercises.js'
import { activeProfile, exAvailable } from '../lib/equipment.js'
import { uid } from '../lib/format.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import { supersetUnits, cleanupSg, exLine } from '../lib/history.js'
import { Thumb } from '../components/Media.jsx'
import { glyphPicker, exercisePicker, exConfigSheet, confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { glyphOf } from '../lib/glyphs.js'
import { Button, SelectRow } from '../components/ui.jsx'
import { POLICIES_FOR, POLICY_NAME, POLICY_DESC } from '../lib/progression.js'
import BodyMap from '../components/BodyMap.jsx'
import { loadOfRoutine, rankOf, MUSCLE_NAME } from '../lib/muscles.js'

export default function RoutineEdit() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const r = (S.routines || []).find(x => x.id === id)

  useEffect(() => {
    if (!r) nav('/plan')
  }, [r, nav])

  useEffect(() => () => {
    try { useStore.getState().autoBackupNow() } catch (e) { /* fallback */ }
  }, [])

  if (!r) return null

  const edit = fn => update(s => {
    const target = (s.routines || []).find(x => x.id === id)
    if (target) {
      if (!Array.isArray(target.ex)) target.ex = []
      fn(target.ex)
    }
  })

  const move = (i, dir) => edit(ex => {
    const j = i + dir
    if (j < 0 || j >= ex.length) return
    [ex[i], ex[j]] = [ex[j], ex[i]]
    cleanupSg(ex)
  })

  const toggleLink = i => edit(ex => {
    if (i < 1) return
    const cur = ex[i]
    const prev = ex[i - 1]
    if (cur && prev) {
      if (cur.sg && prev.sg && cur.sg === prev.sg) delete cur.sg
      else {
        const gid = prev.sg || ('sg' + uid())
        prev.sg = gid
        cur.sg = gid
      }
    }
    cleanupSg(ex)
  })

  const rawExercises = Array.isArray(r.ex) ? r.ex : []
  // Normalizar ejercicios asegurando fallback si no existe el ID en la base de datos
  const exercises = rawExercises.map(e => {
    if (!e) return { id: '0001', sets: 3, reps: 10 }
    const realId = e.id || e.exerciseId || '0001'
    return { ...e, id: realId }
  })

  const units = supersetUnits(exercises)
  const unitFirst = new Set(units.filter(u => u.length > 1).map(u => u[0]))
  const inSS = new Set(units.filter(u => u.length > 1).flat())
  const profile = activeProfile(S)

  // Clasificación por bloques
  const isCardioItem = e => Boolean(e && (e.isCardio || e.mode === 'cardio' || (typeof e.id === 'string' && e.id.startsWith('cardio_')) || isCardio(e?.id)))
  const isStretchItem = e => Boolean(e && (e.isStretch || (e.mode === 'time' && !isCardioItem(e))))

  const firstCardioIdx = exercises.findIndex(isCardioItem)
  const firstStretchIdx = exercises.findIndex(isStretchItem)

  const missingCount = profile
    ? exercises.filter(e => {
        const ex = exOr(e.id)
        return ex ? !exAvailable(S, ex) : false
      }).length
    : 0

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/plan')} aria-label={t('Plan')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, margin: '0 12px' }}>
        <input
          className="input"
          defaultValue={r.name || t('Routine')}
          style={{ fontWeight: 600, fontSize: 20, letterSpacing: '-.021em' }}
          onChange={e => update(s => {
            const rt = (s.routines || []).find(x => x.id === id)
            if (rt) rt.name = e.target.value.trim() || t('Routine')
          })}
        />
      </div>
      <button
        className="iconbtn"
        aria-label={t('Pick an icon')}
        onClick={() => glyphPicker(r.emoji, g => update(s => {
          const rt = (s.routines || []).find(x => x.id === id)
          if (rt) rt.emoji = g
        }))}
      >
        <Icon name={glyphOf(r.emoji)} />
      </button>
    </div>

    <div className="sect-b" style={{ marginBottom: 16 }}>
      <SelectRow
        icon="chartLine"
        title={t('Progression')}
        sheetTitle={t('Progression')}
        value={r.prog || 'linear'}
        onChange={v => update(s => {
          const rt = (s.routines || []).find(x => x.id === id)
          if (rt) rt.prog = v
        })}
        options={POLICIES_FOR.reps.map(p => ({ value: p, label: t(POLICY_NAME[p]), subtitle: t(POLICY_DESC[p]) }))}
      />
    </div>

    {missingCount > 0 && <div className="card" style={{ marginBottom: 16, borderColor: 'var(--orange)' }}>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <Icon name="warning" style={{ color: 'var(--orange)' }} />
        <div className="small">{t('{0} of {1} exercises need equipment outside "{2}"', missingCount, exercises.length, profile.name)}</div>
      </div>
    </div>}

    {exercises.length ? <div className="list">
      {exercises.map((e, i) => {
        // Fallback seguro si el ejercicio es de cardio o no existe en EXDB
        const exFallback = { id: e.id, n: e.id, eq: 'none', tg: 'abs', bp: 'waist' }
        const ex = exOr(e.id) || exFallback
        const linkedPrev = i > 0 && e.sg && exercises[i - 1]?.sg === e.sg
        const noEquip = profile && typeof exAvailable === 'function' && !exAvailable(S, ex)
        const isCardioBlock = isCardioItem(e)
        const isStretchBlock = isStretchItem(e)

        const showDividerBeforeCardio = i === firstCardioIdx && firstCardioIdx > 0
        const showDividerBeforeStretch = i === firstStretchIdx && firstStretchIdx > 0 && (firstCardioIdx < 0 || i < firstCardioIdx || firstCardioIdx !== i)

        return <Fragment key={(e.id || 'ex') + '_' + i}>
          {(showDividerBeforeCardio || showDividerBeforeStretch) && (
            <div style={{ gridColumn: '1 / -1', margin: '24px 0 14px', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <div style={{ width: '100%', height: 3, background: 'var(--acc)', borderRadius: 2, boxShadow: '0 0 8px var(--acc-soft)' }} />
              <span className="small dim" style={{ marginTop: 6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--acc)' }}>
                {showDividerBeforeCardio ? 'Bloque de Cardio' : 'Bloque de Estiramientos / Movilidad'}
              </span>
            </div>
          )}

          {unitFirst.has(i) && <div style={{ gridColumn: '1 / -1' }} className="ss-label"><Icon name="link" />{t('Superset')}</div>}

          <div
            className={'item' + (inSS.has(i) ? ' in-ss' : '')}
            draggable
            onDragStart={ev => ev.dataTransfer.setData('text/plain', i)}
            onDragOver={ev => ev.preventDefault()}
            onDrop={ev => {
              ev.preventDefault()
              const from = parseInt(ev.dataTransfer.getData('text/plain'), 10)
              if (!isNaN(from) && from !== i) {
                edit(ex => {
                  const [item] = ex.splice(from, 1)
                  ex.splice(i, 0, item)
                  cleanupSg(ex)
                })
              }
            }}
            style={
              isCardioBlock
                ? { gridColumn: '1 / -1', borderLeft: '4px solid var(--acc)', background: 'var(--surface-2)', cursor: 'grab' }
                : isStretchBlock
                ? { borderLeft: '4px solid var(--label-3)', cursor: 'grab' }
                : { cursor: 'grab' }
            }
            onClick={() => {
              exConfigSheet(ex, e, cfg => edit(x => { if (x[i]) x[i] = { id: x[i]?.id || e.id, sg: x[i]?.sg, ...cfg } }), () => edit(x => { x.splice(i, 1); cleanupSg(x) }), r)
            }}
          >
            <Thumb ex={ex} />
            <div className="grow">
              <div className="tt capitalize">{exerciseNameFor(ex) || ex.n || ex.id}</div>
              <div className="ss">{exLine(e, S.unit)}</div>
              {e.note && <div className="small dim" style={{ marginTop: 2, color: 'var(--acc)', fontWeight: 500 }}>{e.note}</div>}
            </div>

            {noEquip && <span className="tag" style={{ color: 'var(--orange)', borderColor: 'var(--orange)' }} title={t('Needs {0} — not in your active profile', t(ex.eq))}><Icon name="warning" /></span>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 'none', alignItems: 'center' }}>
              {i > 0 && <button className={'iconbtn' + (linkedPrev ? ' on-ss' : '')} title={t('Superset with exercise above')} style={{ width: 32, height: 28, borderRadius: 8, fontSize: 15 }} onClick={ev => { ev.stopPropagation(); toggleLink(i) }}><Icon name="link" /></button>}
              <div style={{ display: 'flex', gap: 2 }}>
                <button className="iconbtn" aria-label="Move up" style={{ width: 28, height: 24, borderRadius: 7, fontSize: 12 }} onClick={ev => { ev.stopPropagation(); move(i, -1) }}><Icon name="chevronUp" /></button>
                <button className="iconbtn" aria-label="Move down" style={{ width: 28, height: 24, borderRadius: 7, fontSize: 12 }} onClick={ev => { ev.stopPropagation(); move(i, 1) }}><Icon name="chevronDown" /></button>
              </div>
            </div>
          </div>
        </Fragment>
      })}
    </div> : <div className="empty"><div className="ico"><Icon name="dumbbell" /></div>{t('No exercises yet — add your first one.')}</div>}

    {/* Previsualización del mapa muscular de la sesión */}
    {exercises.length > 0 && (() => {
      try {
        const validEx = exercises.filter(e => e && e.id && !isCardioItem(e))
        const load = loadOfRoutine({ ...r, ex: validEx })
        const { worked } = rankOf(load)
        if (!worked || worked.length === 0) return null
        return <div className="card" style={{ marginTop: 18 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, marginBottom: 8 }}>{t('What this session hits')}</h2>
          <BodyMap load={load} body={S.body} />
          <div className="mchips" style={{ marginTop: 10 }}>
            {(worked || []).slice(0, 6).map(m => <span key={m} className="mchip">{t(MUSCLE_NAME[m] || m)}</span>)}
          </div>
        </div>
      } catch (err) {
        return null
      }
    })()}

    <div className="small dim row" style={{ margin: '12px 2px', gap: 5 }}><Icon name="link" style={{ fontSize: 13 }} />{t('Tap the link button on an exercise to superset it with the one above — you’ll do them back-to-back.')}</div>
    <Button variant="primary" onClick={() => exercisePicker(ex => exConfigSheet(ex, null, cfg => edit(x => { x.push({ id: ex.id, ...cfg }) }), null, r))} icon="plus">{t('Add exercise')}</Button>
    <div style={{ height: 10 }} />
    <Button variant="danger" onClick={() => confirmSheet({
      title: t('Delete routine?'),
      message: t('“{0}” and its exercises will be removed.', r.name),
      confirmText: t('Delete'),
      danger: true,
      onConfirm: () => {
        update(s => {
          s.routines = (s.routines || []).filter(x => x.id !== id)
          Object.keys(s.week || {}).forEach(k => { if (s.week[k] === id) delete s.week[k] })
          Object.keys(s.dayPlan || {}).forEach(k => { if (s.dayPlan[k] === id) delete s.dayPlan[k] })
        })
        nav('/plan')
      }
    })}>{t('Delete routine')}</Button>
  </div>
}