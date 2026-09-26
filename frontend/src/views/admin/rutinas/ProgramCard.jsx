import { useEffect, useState } from 'react'
import { DAYN, DAYS } from '../../../lib/format.js'
import { glyphOf } from '../../../lib/glyphs.js'
import { MUSCLE_NAME } from '../../../lib/muscles.js'
import { presetStats, programStats, COVERAGE_LEVELS } from '../../../lib/presetStats.js'
import { t } from '../../../lib/i18n.js'
import Icon from '../../../components/Icon.jsx'
import BodyMap from '../../../components/BodyMap.jsx'
import { useDragReorder } from '../../../components/useDragReorder.js'

const muscleName = m => t(MUSCLE_NAME[m] || m)

function usageLabel(usage) {
  if (!usage?.users) return t('Ningún socio')
  return usage.users === 1 ? t('1 socio') : t('{0} socios', usage.users)
}

// Un programa (PPL, Torso/Pierna…) con sus días adentro: qué trabaja en la semana (mapa chico
// con series efectivas por músculo en escala fija, así dos programas se comparan de un
// vistazo), cuántos socios lo tienen cargado y sus días, que se reordenan arrastrando.
export default function ProgramCard({ program, days, usage, body, editingId, onEdit, onAddDay, onDuplicateDay, onDeleteDay, onRename, onDuplicate, onAssign, onReorder }) {
  const stats = programStats(days)
  const ids = days.map(d => d.id)
  const idsKey = ids.join('|')
  // Orden optimista mientras el servidor guarda; vuelve al del servidor cuando llega la recarga.
  const [pending, setPending] = useState(null)
  useEffect(() => { setPending(null) }, [idsKey])
  const shown = pending && pending.length === ids.length ? pending : ids
  const drag = useDragReorder(shown, next => {
    setPending(next)
    Promise.resolve(onReorder(next)).catch(() => setPending(null))
  })
  const canManage = !!program.id

  return <div className="card program-card">
    <div className="row between program-head">
      <div className="grow" style={{ minWidth: 0 }}>
        <h3 className="program-name">{program.name}</h3>
        <div className="small muted">
          {t('{0} días', stats.days)} · {t('{0} series/semana', stats.sets)}
        </div>
      </div>
      <div className="row program-actions">
        <button type="button" className="iconbtn" aria-label={t('Agregar día a {0}', program.name)} title={t('Agregar día')} onClick={() => onAddDay(program)}><Icon name="plus" /></button>
        {canManage && <>
          <button type="button" className="iconbtn" aria-label={t('Asignar {0} a un socio', program.name)} title={t('Asignar a socio')} onClick={() => onAssign(program)}><Icon name="person" /></button>
          <button type="button" className="iconbtn" aria-label={t('Duplicar {0}', program.name)} title={t('Duplicar programa')} onClick={() => onDuplicate(program)}><Icon name="copy" /></button>
          <button type="button" className="iconbtn" aria-label={t('Renombrar {0}', program.name)} title={t('Renombrar programa')} onClick={() => onRename(program)}><Icon name="pencil" /></button>
        </>}
      </div>
    </div>

    <div className="program-summary">
      <BodyMap className="mini" load={stats.load} thresholds={COVERAGE_LEVELS} body={body} />
      <div style={{ minWidth: 0 }}>
        {stats.top.length ? <div className="mchips" aria-label={t('Músculos principales')}>
          {stats.top.slice(0, 5).map(m => <span key={m} className="mchip">{muscleName(m)} · {Math.round(stats.load[m])}</span>)}
        </div> : <div className="dim small">{t('Sin ejercicios de fuerza todavía.')}</div>}
        {canManage && <div className="small muted program-usage" title={t('Socios activos que tienen este programa cargado. Cuenta desde que se registra el origen del plan; los cargados antes no aparecen.')}>
          <Icon name="person" /> {usageLabel(usage)}{usage?.active ? ' · ' + t('{0} lo usan ahora', usage.active) : ''}
        </div>}
      </div>
    </div>

    <div className="program-days">
      {drag.order.map(id => {
        const day = days.find(d => d.id === id)
        if (!day) return null
        const s = presetStats(day)
        const planned = Number.isInteger(day.planned_day)
        return <div key={id} ref={drag.rowRef(id)}
          className={'preset-day' + (drag.draggingId === id ? ' dragging' : '') + (editingId === id ? ' on' : '')}>
          {canManage && days.length > 1 && <span className="drag-handle" role="button" tabIndex={0}
            aria-label={t('Mover {0} (flechas arriba y abajo)', day.name)} {...drag.handleProps(id)}><Icon name="grip" /></span>}
          <span className={'preset-day-badge' + (planned ? ' planned' : '')} title={planned ? t(DAYN[day.planned_day]) : t('Sin día asignado')}>
            {planned ? t(DAYS[day.planned_day]) : <Icon name={glyphOf(day.emoji)} />}
          </span>
          <button type="button" className="grow preset-day-main" onClick={() => onEdit(day)}>
            <div className="tt">{day.name}</div>
            <div className="ss">
              {t('{0} ej · {1} series', s.exercises, s.sets)}
              {!!s.top.length && ' · ' + s.top.slice(0, 3).map(muscleName).join(', ')}
            </div>
          </button>
          <button type="button" className="iconbtn" aria-label={t('Duplicar {0}', day.name)} title={t('Duplicar día')} onClick={() => onDuplicateDay(day)}><Icon name="copy" /></button>
          <button type="button" className="iconbtn danger" aria-label={t('Eliminar {0}', day.name)} title={t('Delete')} onClick={() => onDeleteDay(day)}><Icon name="trash" /></button>
        </div>
      })}
    </div>
  </div>
}
