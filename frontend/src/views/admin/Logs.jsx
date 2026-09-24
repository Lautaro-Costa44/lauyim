import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useAdmin } from './context.js'
import { useUI } from '../../store/useUI.js'
import { api } from '../../lib/api.js'
import { fmtNum } from '../../lib/format.js'
import { auditCat, auditLine, fmtWhen } from '../../lib/audit.js'
import { confirmSheet } from '../../sheets.jsx'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Button } from '../../components/ui.jsx'

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

  return <div className="card audit-log">
    <div className="row between"><h2 style={{ margin: 0 }}>{t('Activity log')}</h2>
      <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)' }}
        onClick={clear} aria-label="clear log"><Icon name="trash" /></button></div>
    <div className="small muted" style={{ margin: '6px 0 10px' }}>
      {meta ? fmtNum(meta.total) + ' ' + t('events')
        + (meta.retention.days ? ' · ' + t('last {0} days', meta.retention.days) : '') : t('Loading…')}</div>
    <div className="chips" style={{ marginBottom: 10 }}>
      {[['', 'All'], ['auth', 'Sign-ins'], ['admin', 'Admin'], ['fail', 'Failed']].map(([v, l]) =>
        <button key={v} className={'chip nocap' + (cat === v ? ' on' : '')} onClick={() => pick(v)}>{t(l)}</button>)}
    </div>
    <div className="audit-rows">
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
    </div>
    {meta && !rows.length && <div className="dim small">{t('Nothing logged yet.')}</div>}
    {meta?.nextBefore && <div style={{ marginTop: 10 }}>
      <Button size="sm" onClick={() => load(cat, meta.nextBefore)}>{t('Show more')}</Button></div>}
  </div>
}

// AUDIT_LOG=0: AdminLayout hides the tab and the route falls back to Resumen.
export default function Logs() {
  const { tick, auditEnabled } = useAdmin()
  if (auditEnabled === false) return <Navigate to="/admin/resumen" replace />
  return <div style={{ marginTop: 14 }}><AuditCard tick={tick} /></div>
}
