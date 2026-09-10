import { useEffect, useRef } from 'react'
import { fmtVol, isoOf, todayISO, MONTHS } from '../lib/format.js'
import { t } from '../lib/i18n.js'

// GitHub-style activity heatmap, shaded by time trained per day.
export default function Heatmap({ S, onDay, includeSunday = false }) {
  const wrapRef = useRef(null)
  useEffect(() => { if (wrapRef.current) wrapRef.current.scrollLeft = wrapRef.current.scrollWidth }, [])

  const agg = {}
  S.workouts.forEach(w => {
    const a = agg[w.d] = agg[w.d] || { n: 0, vol: 0, min: 0 }
    a.n++; a.vol += w.vol || 0
    a.min += Math.max(0, Math.round(((w.end || w.start) - w.start) / 60000))
  })
  const mins = Object.values(agg).map(a => a.min).filter(v => v > 0).sort((a, b) => a - b)
  const q = p => (mins.length ? mins[Math.min(mins.length - 1, Math.floor(p * mins.length))] : 0)
  const t1 = q(0.25), t2 = q(0.5), t3 = q(0.75)
  // Keep the visual scale proportional to the actual range: a day at 25% of the
  // busiest day should look like ~25% of the intensity, rather than depending on
  // how many days happen to be populated.
  const maxMin = mins.length ? Math.max(...mins) : 0
  const level = a => !a ? 0 : !a.min ? 1 : maxMin ? Math.min(4, Math.max(1, Math.ceil(a.min / maxMin * 4))) : 1

  const today = new Date(); today.setHours(12, 0, 0, 0)
  const end = new Date(today); end.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  const start = new Date(end); start.setDate(end.getDate() - 52 * 7)

  const months = [], cols = []
  let lastMonth = -1
  for (let wk = 0; wk <= 52; wk++) {
    const colStart = new Date(start); colStart.setDate(start.getDate() + wk * 7)
    const mo = colStart.getMonth()
    const showM = mo !== lastMonth && colStart.getDate() <= 7 && wk < 51
    months.push(<span key={wk}>{showM ? t(MONTHS[mo]) : ''}</span>)
    if (colStart.getDate() <= 7) lastMonth = mo
    const cells = []
    for (let d = 0; d < (includeSunday ? 7 : 6); d++) {
      const day = new Date(colStart); day.setDate(colStart.getDate() + d)
      const key = isoOf(day)
      const a = agg[key]
      const cls = 'hm-c l' + level(a) + (key === todayISO() ? ' today' : '') + (day > today ? ' future' : '')
      cells.push(<div key={d} className={cls}
        title={key + (a ? ` · ${t(a.n === 1 ? '{0} workout' : '{0} workouts', a.n)} · ${a.min} min · ${fmtVol(a.vol, S.unit)}` : '')}
        onClick={a ? () => onDay(key) : undefined} />)
    }
    cols.push(<div key={wk} className="hm-col">{cells}</div>)
  }

  return <>
    <div className="hm-wrap" ref={wrapRef}>
      <div className="hm-months" style={{ marginLeft: 30 }}>{months}</div>
      <div className="hm-body">
        <div className="hm-days">{[t('Mon'), t('Tue'), t('Wed'), t('Thu'), t('Fri'), t('Sat'), ...(includeSunday ? [t('Sun')] : [])].map(day => <span key={day}>{day}</span>)}</div>
        <div className="hm-grid">{cols}</div>
      </div>
    </div>
    <div className="hm-legend">{t('Less time')} <div className="hm-c l0" /><div className="hm-c l1" /><div className="hm-c l2" /><div className="hm-c l3" /><div className="hm-c l4" /> {t('More time')}</div>
  </>
}
