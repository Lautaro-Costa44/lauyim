import { useNavigate } from 'react-router-dom'
import { useAdmin } from './context.js'
import { useUI } from '../../store/useUI.js'
import { api } from '../../lib/api.js'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { UserDetail } from './shared.jsx'

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

export default function Resumen() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const { users, attendance, loadUsers, loadAttendance, refresh } = useAdmin()

  const openUser = id => openSheet(close => <UserDetail id={id} onChanged={loadUsers} close={close} />)
  const liveUsers = (users || []).filter(u => u.live)
  const activeCount = (users || []).filter(u => u.lastSync && Date.now() - u.lastSync < 7 * 86400000).length
  const disabledCount = (users || []).filter(u => u.disabled).length

  return <>
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Admin')}</h1>
        <div className="sub">{users ? users.length + ' ' + t('users') + ' · ' + activeCount + ' ' + t('active this week') : t('Loading…')}</div></div>
      <button className="iconbtn" onClick={refresh} aria-label={t('Refresh')}>↻</button>
    </div>

    <div className="tiles" style={{ marginBottom: 12 }}>
      <div className="tile"><div className="l">{t('Users')}</div><div className="v">{users ? users.length : '—'}</div></div>
      <div className="tile"><div className="l">{t('Training now')}</div><div className="v" style={{ color: liveUsers.length ? 'var(--acc)' : undefined }}>{users ? liveUsers.length : '—'}</div></div>
      <div className="tile"><div className="l">{t('Active 7d')}</div><div className="v">{users ? activeCount : '—'}</div></div>
      <div className="tile"><div className="l">{t('Disabled')}</div><div className="v">{users ? disabledCount : '—'}</div></div>
    </div>

    <div className="admin-split">
    {liveUsers.length > 0 && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <h2 className="row" style={{ margin: '0 0 8px', gap: 6 }}><Icon name="dot" style={{ fontSize: 10, color: 'var(--green)' }} />{t('Training now')}</h2>
      {liveUsers.map(u => <div key={u.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }} onClick={() => openUser(u.id)}>
        <div><div className="small" style={{ fontWeight: 600 }}>{u.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{u.live.name} · ex {u.live.exIdx}/{u.live.exTotal} · {u.live.setsDone}/{u.live.setsTotal} {t('sets')}</div></div>
        <span className="tag acc">{dur(Date.now() - u.live.startedAt)}</span>
      </div>)}
    </div>}

    <AttendanceHeatmap data={attendance} onStartChange={start => api('/api/admin/attendance-week-start', { method: 'POST', body: JSON.stringify({ start }) }).then(loadAttendance).catch(e => toast(e.message || t('Failed to save setting')))} />
    </div>
  </>
}
