import { useState } from 'react'
import { t, exerciseNameFor } from '../../lib/i18n.js'
import { EXIDX } from '../../lib/exercises.js'
import { fmtDate, fmtNum, fmtDur } from '../../lib/format.js'
import { modeOf, isBw, setsDone } from '../../lib/history.js'
import { compareWithPrevious, entryVolume, exerciseSeries, setRows, workoutDuration } from '../../lib/workout-history.js'
import LineChart from '../LineChart.jsx'
import Icon from '../Icon.jsx'
import { Thumb } from '../Media.jsx'

// Detalle de un entreno: fichas de resumen, cada ejercicio con su tabla de series, la
// comparación con la vez anterior y su evolución (al tocar el nombre). Lo usan el socio (con
// nota editable y acciones) y el staff (readOnly, con los datos del socio).
//
// data: { workouts, unit, names? } — los entrenos del dueño de este entreno y su unidad; `names`
// traduce ids de ejercicios propios del socio que esta app no conoce (vista del staff).

export const exerciseName = (entry, names = {}) => {
  const ex = EXIDX[entry.id]
  return ex ? exerciseNameFor(ex) : names[entry.id] || entry.n || entry.id
}

const signed = (n, suffix = '') => (n > 0 ? '+' : n < 0 ? '−' : '±') + fmtNum(Math.abs(n)) + suffix

// "↑ +2.5 kg · −2 reps vs. 05/09": el signo y la unidad se leen sin color; el color acompaña.
function CompareLine({ cmp, unit }) {
  if (!cmp) return <div className="wd-cmp none">{t('Primera vez que lo hacés en el historial')}</div>
  const parts = []
  if (cmp.weight) parts.push(signed(cmp.weight, ' ' + unit))
  if (cmp.reps) parts.push(signed(cmp.reps, ' reps'))
  const trend = cmp.weight > 0 || (cmp.weight === 0 && cmp.reps > 0) ? 'up' : cmp.weight < 0 || (cmp.weight === 0 && cmp.reps < 0) ? 'down' : 'same'
  return <div className={'wd-cmp ' + trend}>
    <Icon name={trend === 'up' ? 'arrowUp' : trend === 'down' ? 'arrowDown' : 'minus'} />
    <span>{parts.length ? parts.join(' · ') : t('Igual')} {t('vs. {0}', fmtDate(cmp.date))}</span>
  </div>
}

function SetTable({ entry, unit }) {
  const cfg = entry.target || { id: entry.id }
  const mode = modeOf(cfg)
  const bw = isBw(cfg)
  const rows = setRows(entry)
  if (!rows.length) return <div className="small dim">{t('no sets')}</div>
  const effort = rows.some(r => r.effort) ? rows.find(r => r.effort).effort.kind : null
  const head = mode === 'cardio' ? ['#', 'min', 'km/h'] : mode === 'time' ? ['#', t('Tiempo'), unit] : ['#', bw ? '+' + unit : unit, 'reps']
  if (effort && mode === 'reps') head.push(effort)
  return <div className={'wd-sets cols-' + head.length} role="table">
    <div className="wd-row wd-head" role="row">{head.map((h, i) => <span key={i} role="columnheader">{h}</span>)}</div>
    {rows.map((r, i) => <div key={i} className={'wd-row' + (r.warm ? ' warm' : '')} role="row">
      <span role="cell" className="wd-n">{r.label}</span>
      {mode === 'cardio' ? <><span role="cell">{fmtNum(r.min)}</span><span role="cell">{fmtNum(r.speed)}</span></>
        : mode === 'time' ? <><span role="cell">{fmtDur(r.sec * 1000) || r.sec + ' s'}</span><span role="cell">{r.w ? fmtNum(r.w) : '—'}</span></>
        : <>
          <span role="cell">{bw && !r.w ? '—' : fmtNum(r.w)}</span>
          <span role="cell">{r.type === 'restpause' && r.clusters.length ? r.clusters.map(c => c.r ?? c).join(' + ') : fmtNum(r.r)}
            {r.type === 'dropset' && r.drops.length > 0 && <span className="wd-drops">{r.drops.map(d => ` → ${fmtNum(d.w)}×${fmtNum(d.r)}`).join('')}</span>}
          </span>
        </>}
      {effort && mode === 'reps' && <span role="cell" className="dim">{r.effort ? fmtNum(r.effort.v) : '—'}</span>}
      {r.type && <span className="wd-tag">{r.type === 'dropset' ? t('Drop set') : t('Rest-pause')}</span>}
    </div>)}
  </div>
}

function ExerciseTrend({ workouts, entry, unit }) {
  const cfg = entry.target || { id: entry.id }
  const { kind, points } = exerciseSeries(workouts, entry.id, cfg)
  if (points.length < 2) return <div className="wd-trend empty small">{t('Todavía no hay suficientes datos')}</div>
  const label = kind === 'e1rm' ? t('1RM estimado') : kind === 'reps' ? t('Máximo de reps') : kind === 'sec' ? t('Mejor tiempo (s)') : t('Más minutos')
  return <div className="wd-trend">
    <div className="small muted">{label}</div>
    <LineChart points={points} h={130} unit={kind === 'e1rm' ? unit : ''} color="var(--acc)" />
  </div>
}

function ExerciseBlock({ w, entry, data, isPr }) {
  const [trend, setTrend] = useState(false)
  const unit = data.unit || 'kg'
  const cfg = entry.target || { id: entry.id }
  const vol = modeOf(cfg) === 'reps' ? entryVolume(entry) : 0
  const ex = EXIDX[entry.id]
  return <section className="wd-ex">
    <button type="button" className="wd-ex-h" onClick={() => setTrend(v => !v)} aria-expanded={trend}>
      {ex ? <Thumb ex={ex} /> : <span className="thumb thumb-x"><Icon name="dumbbell" /></span>}
      <span className="wd-ex-m">
        <span className="wd-ex-t capitalize">{exerciseName(entry, data.names)}{isPr && <span className="pr"><Icon name="trophy" />PR</span>}</span>
        <CompareLine cmp={compareWithPrevious(data.workouts, w, entry)} unit={unit} />
      </span>
      <Icon name={trend ? 'chevronUp' : 'chartLine'} className="wd-ex-k" />
    </button>
    {trend && <ExerciseTrend workouts={data.workouts} entry={entry} unit={unit} />}
    <SetTable entry={entry} unit={unit} />
    {(vol > 0 || entry.note) && <div className="wd-ex-f">
      {entry.note && <span className="small dim">{entry.notePin && <Icon name="flag" className="wd-pin" />}{entry.note}</span>}
      {vol > 0 && <span className="small muted wd-vol">{t('Volumen {0}', fmtNum(vol) + ' ' + unit)}</span>}
    </div>}
  </section>
}

/**
 * @param {object} props
 * @param {object} props.w       el entreno
 * @param {object} props.data    { workouts, unit, names? }
 * @param {boolean} [props.showBw]  mostrar el peso corporal del día (consentimiento de salud)
 * @param {import('react').ReactNode} [props.footer]  nota editable y acciones (solo el socio)
 * @param {string} [props.note]  nota de la sesión, en solo lectura (staff)
 */
export default function WorkoutDetailView({ w, data, showBw = true, footer = null, note = null }) {
  const unit = data.unit || 'kg'
  const ms = workoutDuration(w)
  const tiles = [
    ms >= 60000 && [t('Duración'), fmtDur(ms), 'clock'],
    [t('Series'), fmtNum(setsDone(w)), 'list'],
    [t('Volumen'), fmtNum(w.vol || 0) + ' ' + unit, 'barbell'],
    w.prs?.length > 0 && [t('PRs'), String(w.prs.length), 'trophy'],
    showBw && w.bw > 0 && [t('Peso corporal'), fmtNum(w.bw) + ' ' + unit, 'scale'],
  ].filter(Boolean)
  return <div className="wd">
    <h3 style={{ marginBottom: 2 }}>{w.name}</h3>
    <div className="muted small wd-date">{fmtDate(w.d, true)}</div>
    <div className="wd-tiles">{tiles.map(([l, v, icon]) => <div key={l} className="tile wd-tile">
      <div className="l"><Icon name={icon} />{l}</div><div className="v">{v}</div>
    </div>)}</div>
    {(w.entries || []).map((e, i) => <ExerciseBlock key={e.id + i} w={w} entry={e} data={data} isPr={!!w.prs?.includes(e.id)} />)}
    {note && <div className="wd-note"><div className="small muted">{t('Session note')}</div><div>{note}</div></div>}
    {footer}
  </div>
}
