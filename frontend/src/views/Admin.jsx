import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { fmtDate, fmtNum, fmtVol, fmtDur } from '../lib/format.js'
import { auditCat, auditLine, fmtWhen } from '../lib/audit.js'
import { workoutVolume, setsDone } from '../lib/history.js'
import { confirmSheet, exercisePicker, exConfigSheet, glyphPicker } from '../sheets.jsx'
import { exOr } from '../lib/exercises.js'
import { exLine } from '../lib/history.js'
import { glyphOf } from '../lib/glyphs.js'
import { t, exerciseNameFor } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button, TextField } from '../components/ui.jsx'
import { NO_AUTOFILL } from '../lib/input-safety.js'

// Admin-only operator dashboard (owner passkey + admin flag; guarded again server-side).

const rel = ts => {
  if (!ts) return t('never')
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return t('just now')
  if (s < 3600) return t('{0}m ago', Math.floor(s / 60))
  if (s < 86400) return t('{0}h ago', Math.floor(s / 3600))
  return t('{0}d ago', Math.floor(s / 86400))
}
const dur = ms => { const m = Math.max(0, Math.floor(ms / 60000)); return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + (m % 60) + 'm' }

function UserDetail({ id, onChanged, close }) {
  const [d, setD] = useState(null)
  const toast = useUI(s => s.toast)
  useEffect(() => { api('/api/admin/user?id=' + encodeURIComponent(id)).then(setD).catch(e => toast(e.message)) }, [id])
  if (!d) return <div className="muted small">{t('Loading…')}</div>
  const u = d.user
  const setDisabled = disabled => {
    api('/api/admin/user/disable', { method: 'POST', body: JSON.stringify({ id: u.id, disabled }) })
      .then(() => { toast(disabled ? t('User disabled') : t('User enabled')); onChanged(); close() })
      .catch(e => toast(e.message))
  }
  return <>
    <h3 className="capitalize">{u.name}</h3>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0 12px' }}>
      {u.admin && <span className="tag acc">{t('admin')}</span>}
      {u.disabled && <span className="tag" style={{ color: 'var(--red)' }}>{t('disabled')}</span>}
      {u.invitedBy && <span className="tag">{t('invite')} {u.invitedBy}</span>}
      <span className="tag">{t('joined')} {u.created ? fmtDate(u.created.slice(0, 10)) : '—'}</span>
    </div>
    <div className="tiles" style={{ textAlign: 'left' }}>
      <div className="tile"><div className="l">{t('Workouts')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.workouts.length}</div></div>
      <div className="tile"><div className="l">{t('Weigh-ins')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.bodyweight.length}</div></div>
      <div className="tile"><div className="l">{t('Routines')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.routines.length}</div></div>
      <div className="tile"><div className="l">{t('Last sync')}</div><div className="v" style={{ fontSize: '.95rem' }}>{rel(d.lastSync)}</div></div>
    </div>
    {!u.admin && <button className={'btn ' + (u.disabled ? 'primary' : 'danger')} style={{ margin: '12px 0 4px' }}
      onClick={() => u.disabled ? setDisabled(false)
        : confirmSheet({ title: t('Disable {0}?', u.name), message: t('They are signed out everywhere and can no longer sync or log in until re-enabled.'), confirmText: t('Disable'), danger: true, onConfirm: () => setDisabled(true) })}>
      {u.disabled ? t('Enable account') : t('Disable account')}</button>}
    <h4 className="sec">{t('Workout history')}</h4>
    {d.workouts.length ? <div className="list" style={{ gap: 0 }}>
      {d.workouts.slice(0, 60).map(w => <div key={w.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{w.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {setsDone(w)} {t('sets')}{w.prs?.length ? ' · ' + w.prs.length + ' PR' : ''}</div></div>
        <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
      </div>)}
    </div> : <div className="empty small">{t('No workouts logged.')}</div>}
  </>
}

function InvitesCard({ invites, reload }) {
  const toast = useUI(s => s.toast)
  const gen = () => api('/api/admin/invites/new', { method: 'POST', body: '{}' })
    .then(({ invite }) => { navigator.clipboard?.writeText(invite.code).catch(() => {}); toast(t('Code {0} created & copied', invite.code)); reload() })
    .catch(e => toast(e.message))
  const revoke = code => api('/api/admin/invites/revoke', { method: 'POST', body: JSON.stringify({ code }) })
    .then(() => { toast(t('Code revoked')); reload() }).catch(e => toast(e.message))
  const open = (invites || []).filter(i => !i.usedBy)
  const used = (invites || []).filter(i => i.usedBy)
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>{t('Invite codes')}</h2>
      <Button variant="primary" size="sm" onClick={gen} icon="plus">{t('Generate')}</Button></div>
    <div className="small muted" style={{ margin: '6px 0 10px' }}>{open.length} {t('unused')} · {used.length} {t('redeemed')}</div>
    {open.map(i => <div key={i.code} className="row between" style={{ padding: '7px 2px', borderBottom: '1px solid var(--sep)' }}>
      <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontWeight: 500, letterSpacing: '.06em' }}
        onClick={() => { navigator.clipboard?.writeText(i.code).catch(() => {}); toast(t('Copied {0}', i.code)) }}>{i.code}</span>
      <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)' }} onClick={() => revoke(i.code)} aria-label="revoke"><Icon name="trash" /></button>
    </div>)}
    {used.map(i => <div key={i.code} className="row between dim" style={{ padding: '7px 2px', fontSize: '.8rem' }}>
      <span style={{ fontFamily: 'monospace' }}>{i.code}</span><span>→ {i.usedByName || t('used')}</span>
    </div>)}
    {!open.length && !used.length && <div className="dim small">{t('No codes yet — generate one to invite someone.')}</div>}
  </div>
}

function PresetEditor({ existing, close, reload }) {
  const [name, setName] = useState(existing?.name || '')
  const [groupName, setGroupName] = useState(existing?.group_name || existing?.groupName || 'General')
  const [emoji, setEmoji] = useState(existing?.emoji || 'dumbbell')
  const [ex, setEx] = useState(() => (existing?.ex || []).map(item => ({ ...item })))
  const toast = useUI(s => s.toast)
  const add = exercise => exConfigSheet(exercise, null, cfg => setEx(current => [...current, { id: exercise.id, ...cfg }]), null, { ex })
  const save = () => {
    if (!name.trim()) return toast(t('Give the routine a name'))
    const body = JSON.stringify({ id: existing?.id, name: name.trim(), groupName: groupName.trim() || 'General', emoji: emoji.trim() || 'dumbbell', ex })
    api(existing ? '/api/admin/presets' : '/api/admin/presets', { method: existing ? 'PUT' : 'POST', body })
      .then(() => { toast(existing ? t('Preset updated') : t('Preset created')); close(); reload() })
      .catch(e => toast(e.message))
  }
  return <>
    <h3>{existing ? t('Edit preset') : t('New preset')}</h3>
    <TextField value={name} onChange={e => setName(e.target.value)} placeholder={t('Routine name')} maxLength={80} />
    <div style={{ height: 8 }} />
    <TextField value={groupName} onChange={e => setGroupName(e.target.value)} placeholder={t('Grupo de rutinas')} maxLength={80} />
    <div style={{ height: 8 }} />
    <button className="glyph-cell on" style={{ marginBottom: 10 }} title={t('Pick an icon')}
      onClick={() => glyphPicker(emoji, setEmoji)} aria-label={t('Pick an icon')}>
      <Icon name={glyphOf(emoji)} />
    </button>
    <div className="list" style={{ margin: '12px 0' }}>
      {ex.map((item, index) => <div className="item" key={index}>
        <div className="grow"><div className="tt">{exerciseNameFor(exOr(item.id))}</div><div className="ss">{exLine(item, 'kg')}</div></div>
        <button className="iconbtn" aria-label={t('Remove exercise')} onClick={() => setEx(current => current.filter((_, i) => i !== index))}><Icon name="trash" /></button>
      </div>)}
    </div>
    <Button icon="plus" onClick={() => exercisePicker(add)}>{t('Add exercise')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="primary" onClick={save}>{t('Save preset')}</Button>
  </>
}

function PresetsCard({ presets, openSheet, reload }) {
  const toast = useUI(s => s.toast)
  const remove = preset => confirmSheet({
    title: t('Delete {0}?', preset.name), message: t('This removes it from the preset catalog. Existing user routines are unchanged.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => api('/api/admin/presets/delete', { method: 'POST', body: JSON.stringify({ id: preset.id }) })
      .then(() => { toast(t('Preset deleted')); reload() }).catch(e => toast(e.message))
  })
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>{t('Preset routines')}</h2>
      <Button variant="primary" size="sm" icon="plus" onClick={() => openSheet(close => <PresetEditor close={close} reload={reload} />)}>{t('New')}</Button></div>
    <div className="small muted" style={{ margin: '6px 0 10px' }}>{t('Templates available from the starter plan action.')}</div>
    {(presets || []).map(preset => <div key={preset.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }}>
      <div><div className="small" style={{ fontWeight: 600 }}>{preset.name}</div><div className="dim" style={{ fontSize: '.72rem' }}>{preset.ex.length} {t('exercises')}</div></div>
      <div className="row" style={{ gap: 4 }}>
        <button className="iconbtn" aria-label={t('Edit preset')} onClick={() => openSheet(close => <PresetEditor existing={preset} close={close} reload={reload} />)}><Icon name="pencil" /></button>
        <button className="iconbtn" aria-label={t('Delete')} style={{ color: 'var(--red)' }} onClick={() => remove(preset)}><Icon name="trash" /></button>
      </div>
    </div>)}
    {!presets?.length && <div className="dim small">{t('No presets yet.')}</div>}
  </div>
}

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

  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>{t('Activity log')}</h2>
      <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)' }}
        onClick={clear} aria-label="clear log"><Icon name="trash" /></button></div>
    <div className="small muted" style={{ margin: '6px 0 10px' }}>
      {meta ? fmtNum(meta.total) + ' ' + t('events')
        + (meta.retention.days ? ' · ' + t('last {0} days', meta.retention.days) : '')
        + (meta.ip_mode === 'off' ? ' · ' + t('no IP addresses') : '') : t('Loading…')}</div>
    <div className="chips" style={{ marginBottom: 10 }}>
      {[['', 'All'], ['auth', 'Sign-ins'], ['admin', 'Admin'], ['fail', 'Failed']].map(([v, l]) =>
        <button key={v} className={'chip' + (cat === v ? ' on' : '')} onClick={() => pick(v)}>{t(l)}</button>)}
    </div>
    {rows.map(e => {
      const line = auditLine(e)
      return <div key={e.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div className="grow">
          <div className="small" style={{ fontWeight: 600 }}>{line.title}
            {/* a red pill, not a red row: twenty fumbled Face IDs in a row shouldn't read as an incident */}
            {!e.ok && <span className="tag" style={{ marginLeft: 6, color: 'var(--red)' }}>{t('failed')}</span>}
            {auditCat(e.ev) === 'admin' && <span className="tag acc" style={{ marginLeft: 6 }}>{t('admin')}</span>}</div>
          {line.sub && <div className="dim" style={{ fontSize: '.72rem' }}>{line.sub}</div>}
        </div>
        <span className="small muted" style={{ flex: 'none', marginLeft: 8 }}>{fmtWhen(e.ts, meta?.now)}</span>
      </div>
    })}
    {meta && !rows.length && <div className="dim small">{t('Nothing logged yet.')}</div>}
    {meta?.nextBefore && <div style={{ marginTop: 10 }}>
      <Button size="sm" onClick={() => load(cat, meta.nextBefore)}>{t('Show more')}</Button></div>}
  </div>
}

function PushNotificationCard() {
  const [titulo, setTitulo] = useState('')
  const [texto, setTexto] = useState('')
  const [redirectUrl, setRedirectUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const toast = useUI(s => s.toast)

  const sendPush = () => {
    const cleanTitle = titulo.trim()
    const cleanText = texto.trim()
    const cleanUrl = redirectUrl.trim()

    if (!cleanTitle || !cleanText) {
      toast(t('Title and text are required'))
      return
    }

    if (cleanUrl) {
      try {
        const u = new URL(cleanUrl)
        if (!['http:', 'https:'].includes(u.protocol)) {
          toast(t('URL must start with http:// or https://'))
          return
        }
      } catch {
        toast(t('Invalid URL'))
        return
      }
    }

    setLoading(true)
    api('/api/admin/push', {
      method: 'POST',
      body: JSON.stringify({
        titulo: cleanTitle,
        texto: cleanText,
        redirectUrl: cleanUrl || null
      })
    })
      .then(res => {
        setLoading(false)
        toast(t('Notification sent to {0} subscriptions', res.sent ?? 0))
        setTitulo('')
        setTexto('')
        setRedirectUrl('')
      })
      .catch(e => {
        setLoading(false)
        toast(e.message || t('Failed to send push'))
      })
  }

  return (
    <div className="card">
      <h3 style={{ margin: '0 0 12px' }}>{t('Enviar notificación')}</h3>
      
      <div style={{ marginBottom: 10 }}>
        <div className="row between small dim" style={{ marginBottom: 4 }}>
          <span>{t('Título')}</span>
          <span>{titulo.length}/50</span>
        </div>
        <input {...NO_AUTOFILL} name="app-admin-notification-title"
          className="input"
          type="text"
          maxLength={50}
          placeholder={t('Título de la notificación')}
          value={titulo}
          onChange={e => setTitulo(e.target.value)}
        />
      </div>

      <div style={{ marginBottom: 10 }}>
        <div className="row between small dim" style={{ marginBottom: 4 }}>
          <span>{t('Texto / cuerpo')}</span>
          <span>{texto.length}/120</span>
        </div>
        <textarea {...NO_AUTOFILL} name="app-admin-notification-body"
          className="input"
          rows={3}
          maxLength={120}
          placeholder={t('Escribí el mensaje de la notificación...')}
          value={texto}
          onChange={e => setTexto(e.target.value)}
          style={{ resize: 'vertical', fontFamily: 'inherit' }}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <div className="small dim" style={{ marginBottom: 4 }}>{t('Redirect (opcional)')}</div>
        <input {...NO_AUTOFILL} name="app-admin-redirect"
          className="input"
          type="url"
          placeholder="https://instagram.com/..."
          value={redirectUrl}
          onChange={e => setRedirectUrl(e.target.value)}
        />
      </div>

      <Button variant="primary" disabled={loading || !titulo.trim() || !texto.trim()} onClick={sendPush}>
        {loading ? t('Enviando…') : t('Enviar')}
      </Button>
    </div>
  )
}

export default function Admin() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [users, setUsers] = useState(null)
  const [invites, setInvites] = useState(null)
  const [presets, setPresets] = useState(null)
  const [inviteOnly, setInviteOnly] = useState(false)
  const [tick, setTick] = useState(0)          // the ↻ button; the activity log listens to it

  const loadUsers = () => api('/api/admin/users').then(d => { setUsers(d.users); setInviteOnly(d.invite_only) }).catch(e => toast(e.message || t('Failed to load')))
  const loadInvites = () => api('/api/admin/invites').then(d => setInvites(d.invites)).catch(() => {})
  const loadPresets = () => api('/api/presets').then(d => setPresets(d.presets)).catch(e => toast(e.message || t('Failed to load presets')))
  // poll every 15s so the "training now" section stays live without a manual refresh
  useEffect(() => { if (!user?.admin) return; loadUsers(); loadInvites(); loadPresets(); const iv = setInterval(loadUsers, 15000); return () => clearInterval(iv) }, [])
  if (!user?.admin) return null

  const openUser = id => openSheet(close => <UserDetail id={id} onChanged={loadUsers} close={close} />)
  const liveUsers = (users || []).filter(u => u.live)
  const activeCount = (users || []).filter(u => u.lastSync && Date.now() - u.lastSync < 7 * 86400000).length
  const disabledCount = (users || []).filter(u => u.disabled).length

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Admin')}</h1>
        <div className="sub">{users ? users.length + ' ' + t('users') + ' · ' + activeCount + ' ' + t('active this week') : t('Loading…')}</div></div>
      <button className="iconbtn" onClick={() => { loadUsers(); loadInvites(); loadPresets(); setTick(n => n + 1) }} aria-label={t('Refresh')}>↻</button>
    </div>

    <div className="tiles" style={{ marginBottom: 12 }}>
      <div className="tile"><div className="l">{t('Users')}</div><div className="v">{users ? users.length : '—'}</div></div>
      <div className="tile"><div className="l">{t('Training now')}</div><div className="v" style={{ color: liveUsers.length ? 'var(--acc)' : undefined }}>{users ? liveUsers.length : '—'}</div></div>
      <div className="tile"><div className="l">{t('Active 7d')}</div><div className="v">{users ? activeCount : '—'}</div></div>
      <div className="tile"><div className="l">{t('Disabled')}</div><div className="v">{users ? disabledCount : '—'}</div></div>
    </div>

    {liveUsers.length > 0 && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <h2 className="row" style={{ margin: '0 0 8px', gap: 6 }}><Icon name="dot" style={{ fontSize: 10, color: 'var(--green)' }} />{t('Training now')}</h2>
      {liveUsers.map(u => <div key={u.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }} onClick={() => openUser(u.id)}>
        <div><div className="small" style={{ fontWeight: 600 }}>{u.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{u.live.name} · ex {u.live.exIdx}/{u.live.exTotal} · {u.live.setsDone}/{u.live.setsTotal} {t('sets')}</div></div>
        <span className="tag acc">{dur(Date.now() - u.live.startedAt)}</span>
      </div>)}
    </div>}

    <InvitesCard invites={invites} reload={loadInvites} />
    <PresetsCard presets={presets} openSheet={openSheet} reload={loadPresets} />
    <PushNotificationCard />

    <h4 className="sec">{t('Users')}</h4>
    <div className="list">
      {(users || []).map(u => <div key={u.id} className="item" onClick={() => openUser(u.id)} style={u.disabled ? { opacity: .55 } : null}>
        <div className="grow"><div className="tt">{u.live && <Icon name="dot" style={{ fontSize: 9, color: 'var(--green)', display: 'inline-block', marginRight: 5 }} />}{u.name} {u.admin && <span className="tag acc" style={{ marginLeft: 4 }}>{t('admin')}</span>}{u.disabled && <span className="tag" style={{ marginLeft: 4, color: 'var(--red)' }}>{t('off')}</span>}</div>
          <div className="ss">{u.live ? t('training now') + ' · ' + u.live.name : u.workouts + ' ' + t('workouts') + (u.lastWorkout ? ' · ' + t('last') + ' ' + fmtDate(u.lastWorkout) : '') + ' · ' + t('synced') + ' ' + rel(u.lastSync)}</div></div>
        {u.hasPush && <Icon name="bell" title="push enabled" style={{ fontSize: 15, color: 'var(--label-3)' }} />}<Icon name="chevronRight" className="chev" />
      </div>)}
      {users && !users.length && <div className="empty">{t('No users yet.')}</div>}
    </div>

    <div style={{ marginTop: 14 }}><AuditCard tick={tick} /></div>
  </div>
}
