import { useEffect, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { api } from '../../lib/api.js'
import { fmtDate } from '../../lib/format.js'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Button, TextField } from '../../components/ui.jsx'
import { rel, UserDetail } from './shared.jsx'

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

// Same breakpoint as the desktop block of index.css.
const DESKTOP = '(min-width: 1000px)'
function useDesktop() {
  const [desktop, setDesktop] = useState(() => !!window.matchMedia?.(DESKTOP).matches)
  useEffect(() => {
    const mql = window.matchMedia?.(DESKTOP)
    if (!mql) return
    const onChange = () => setDesktop(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return desktop
}

export default function Usuarios() {
  const openSheet = useUI(s => s.openSheet)
  const { users, invites, loadUsers, loadInvites } = useOutletContext()
  const [userSearch, setUserSearch] = useState('')
  const [userPage, setUserPage] = useState(1)
  const desktop = useDesktop()
  const [selectedId, setSelectedId] = useState(null)   // desktop only: whose UserDetail sits in the side panel

  // Desktop shows UserDetail in the side panel; phones keep the sheet. Inside the panel, the
  // `close` UserDetail calls after disabling / deleting / changing the role clears the selection,
  // the same way it closes the sheet.
  const openUser = id => desktop ? setSelectedId(id)
    : openSheet(close => <UserDetail id={id} onChanged={loadUsers} close={close} />)
  const disabledCount = (users || []).filter(u => u.disabled).length
  const filteredUsers = (users || []).filter(u => u.name.toLocaleLowerCase().includes(userSearch.trim().toLocaleLowerCase()))
  const userPageCount = Math.max(1, Math.ceil(filteredUsers.length / 6))
  const visibleUsers = filteredUsers.slice((userPage - 1) * 6, userPage * 6)
  const changeUserSearch = value => { setUserSearch(value); setUserPage(1) }
  // Before any early return: this used to sit after one in Admin.jsx (rules of hooks).
  useEffect(() => { setUserPage(page => Math.min(page, userPageCount)) }, [userPageCount])

  return <div className="admin-users">
    <div className="admin-users-list">
    <InvitesCard invites={invites} reload={loadInvites} />

    <h4 className="sec">{t('Usuarios: {0} ({1} Desactivados)', users ? users.length : 0, disabledCount)}</h4>
    <div style={{ marginBottom: 10 }}>
      <TextField name="admin-user-search" value={userSearch} onChange={e => changeUserSearch(e.target.value)}
        placeholder={t('Search users by name')} aria-label={t('Search users by name')} />
    </div>
    <div className="list">
      {visibleUsers.map(u => <div key={u.id} className={'item' + (desktop && selectedId === u.id ? ' on' : '')} onClick={() => openUser(u.id)} style={u.disabled ? { opacity: .55 } : null}>
        <div className="grow"><div className="tt">{u.live && <Icon name="dot" style={{ fontSize: 9, color: 'var(--green)', display: 'inline-block', marginRight: 5 }} />}{u.name} {(u.owner || u.admin) && <span className="tag acc" style={{ marginLeft: 4 }}>{u.owner ? t('owner') : t('admin')}</span>}{u.disabled && <span className="tag" style={{ marginLeft: 4, color: 'var(--red)' }}>{t('off')}</span>}</div>
          <div className="ss">{u.live ? t('training now') + ' · ' + u.live.name : u.workouts + ' ' + t('workouts') + (u.lastWorkout ? ' · ' + t('last') + ' ' + fmtDate(u.lastWorkout) : '') + ' · ' + t('synced') + ' ' + rel(u.lastSync)}</div></div>
        {u.hasPush && <Icon name="bell" title="push enabled" style={{ fontSize: 15, color: 'var(--label-3)' }} />}<Icon name="chevronRight" className="chev" />
      </div>)}
      {users && !filteredUsers.length && <div className="empty">{userSearch ? t('No users match that name.') : t('No users yet.')}</div>}
    </div>
    {users && filteredUsers.length > 0 && <div className="row between" style={{ marginTop: 10, gap: 6 }}>
      <button className="btn" style={{ padding: '11px 14px', fontSize: '13.6px', borderRadius: 'calc(var(--r) * .8)' }} disabled={userPage === 1} onClick={() => setUserPage(1)}>{t('First')}</button>
      <button className="btn" style={{ padding: '11px 14px', fontSize: '13.6px', borderRadius: 'calc(var(--r) * .8)' }} disabled={userPage === 1} onClick={() => setUserPage(p => Math.max(1, p - 1))}>{t('Previous')}</button>
      <span className="muted" style={{ fontSize: '1.08rem', fontWeight: 600, whiteSpace: 'nowrap' }}>{userPage} / {userPageCount}</span>
      <button className="btn" style={{ padding: '11px 14px', fontSize: '13.6px', borderRadius: 'calc(var(--r) * .8)' }} disabled={userPage === userPageCount} onClick={() => setUserPage(p => Math.min(userPageCount, p + 1))}>{t('Next')}</button>
      <button className="btn" style={{ padding: '11px 14px', fontSize: '13.6px', borderRadius: 'calc(var(--r) * .8)' }} disabled={userPage === userPageCount} onClick={() => setUserPage(userPageCount)}>{t('Last')}</button>
    </div>}
    </div>
    {desktop && <div className="card admin-user-panel">
      {/* keyed: a different member starts from "Loading…", never from the previous one's data */}
      {selectedId ? <UserDetail key={selectedId} id={selectedId} onChanged={loadUsers} close={() => setSelectedId(null)} />
        : <div className="empty">{t('Seleccioná un socio')}</div>}
    </div>}
  </div>
}
