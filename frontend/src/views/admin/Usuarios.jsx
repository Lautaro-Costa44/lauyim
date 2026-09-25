import { useEffect, useState } from 'react'
import { useAdmin } from './context.js'
import { useDesktop } from './useDesktop.js'
import { useUI } from '../../store/useUI.js'
import { useStore } from '../../store/useStore.js'
import { fmtDate } from '../../lib/format.js'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Button, Row, TextField } from '../../components/ui.jsx'
import { rel, UserDetail } from './shared.jsx'
import { IncompleteBadge, NoAppBadge, looksLikeDni, lookupDni, openImportSheet, openMemberSheet } from './members/common.jsx'

// Filtro por acceso a la app: las fichas (sin passkey) las carga el gimnasio.
const APP_FILTERS = [['all', 'Todos'], ['app', 'Con app'], ['noapp', 'Sin app']]
const matchesAppFilter = (u, f) => f === 'all' || (f === 'app' ? u.hasApp !== false : u.hasApp === false)

export default function Usuarios() {
  const openSheet = useUI(s => s.openSheet)
  const { users, loadUsers, billingEnabled } = useAdmin()
  const isOwner = !!useStore(s => s.user)?.owner
  const [userSearch, setUserSearch] = useState('')
  const [userPage, setUserPage] = useState(1)
  const desktop = useDesktop()
  const [selectedId, setSelectedId] = useState(null)   // desktop only: whose UserDetail sits in the side panel
  const [appFilter, setAppFilter] = useState('all')
  const [dniMatch, setDniMatch] = useState(null)       // { userId, name, hasApp } when the search is a DNI

  // Desktop shows UserDetail in the side panel; phones keep the sheet. Inside the panel, the
  // `close` UserDetail calls after disabling / deleting / changing the role clears the selection,
  // the same way it closes the sheet.
  const openUser = id => desktop ? setSelectedId(id)
    : openSheet(close => <UserDetail id={id} billingEnabled={billingEnabled} users={users} openUser={openUser} onChanged={loadUsers} close={close} />)
  const newMember = () => openMemberSheet(openSheet, 'MemberCreateSheet', {
    billingEnabled: billingEnabled !== false,
    onCreated: id => { loadUsers(); openUser(id) },
    onOpenExisting: openUser
  })
  // Importar socios: solo el owner (el servidor lo exige igual). "Ver socios" deja la lista en
  // "Sin app", donde quedan las fichas importadas.
  const importMembers = () => openImportSheet(openSheet, {
    billingEnabled: billingEnabled !== false,
    onImported: loadUsers,
    onShowMembers: () => { setUserSearch(''); setAppFilter('noapp'); setUserPage(1) }
  })
  const disabledCount = (users || []).filter(u => u.disabled).length
  const filteredUsers = (users || []).filter(u => matchesAppFilter(u, appFilter) && u.name.toLocaleLowerCase().includes(userSearch.trim().toLocaleLowerCase()))
  const userPageCount = Math.max(1, Math.ceil(filteredUsers.length / 6))
  const visibleUsers = filteredUsers.slice((userPage - 1) * 6, userPage * 6)
  const changeUserSearch = value => { setUserSearch(value); setUserPage(1) }
  // Before any early return: this used to sit after one in Admin.jsx (rules of hooks).
  useEffect(() => { setUserPage(page => Math.min(page, userPageCount)) }, [userPageCount])
  // A search of 6-9 digits is also a DNI: ask the server (names never contain one).
  useEffect(() => {
    setDniMatch(null)
    if (!looksLikeDni(userSearch)) return
    let alive = true
    const timer = setTimeout(() => lookupDni(userSearch.replace(/[.\s]/g, '')).then(found => { if (alive) setDniMatch(found) }), 300)
    return () => { alive = false; clearTimeout(timer) }
  }, [userSearch])

  return <div className="admin-users">
    <div className="admin-users-list">
    <div className="member-actions">
      <Button variant="tinted" icon="plus" className="member-new" onClick={newMember}>{t('Nuevo socio (sin app)')}</Button>
      {isOwner && <Button variant="tinted" icon="upload" className="member-import" onClick={importMembers}>{t('Importar socios')}</Button>}
    </div>
    <h4 className="sec">{t('Usuarios: {0} ({1} Desactivados)', users ? users.length : 0, disabledCount)}</h4>
    <div style={{ marginBottom: 10 }}>
      <TextField name="admin-user-search" value={userSearch} onChange={e => changeUserSearch(e.target.value)}
        placeholder={t('Buscar por nombre o DNI')} aria-label={t('Buscar por nombre o DNI')} />
    </div>
    <div className="chips member-filter" role="group" aria-label={t('Acceso a la app')}>
      {APP_FILTERS.map(([value, label]) => <button key={value} type="button" className={'chip nocap' + (appFilter === value ? ' on' : '')}
        aria-pressed={appFilter === value} onClick={() => { setAppFilter(value); setUserPage(1) }}>{t(label)}</button>)}
    </div>
    {dniMatch && <div className="sect-b member-dni-match">
      <Row title={dniMatch.name} subtitle={t('Coincide DNI')} onClick={() => openUser(dniMatch.userId)} accessory="chevron">
        {!dniMatch.hasApp && <NoAppBadge />}
      </Row>
    </div>}
    <div className="list">
      {visibleUsers.map(u => <div key={u.id} className={'item' + (desktop && selectedId === u.id ? ' on' : '')} onClick={() => openUser(u.id)} style={u.disabled ? { opacity: .55 } : null}>
        <div className="grow"><div className="tt">{u.live && <Icon name="dot" style={{ fontSize: 9, color: 'var(--green)', display: 'inline-block', marginRight: 5 }} />}{u.name} {(u.owner || u.admin) && <span className="tag acc" style={{ marginLeft: 4 }}>{u.owner ? t('owner') : t('admin')}</span>}{u.disabled && <span className="tag" style={{ marginLeft: 4, color: 'var(--red)' }}>{t('off')}</span>}{u.hasApp === false && <NoAppBadge style={{ marginLeft: 4 }} />}{u.profileIncomplete && <IncompleteBadge style={{ marginLeft: 4 }} />}</div>
          <div className="ss">{u.hasApp === false ? t('Ficha cargada por el gimnasio') : u.live ? t('training now') + ' · ' + u.live.name : u.workouts + ' ' + t('workouts') + (u.lastWorkout ? ' · ' + t('last') + ' ' + fmtDate(u.lastWorkout) : '') + ' · ' + t('synced') + ' ' + rel(u.lastSync)}</div></div>
        {u.hasPush && <Icon name="bell" title="push enabled" style={{ fontSize: 15, color: 'var(--label-3)' }} />}<Icon name="chevronRight" className="chev" />
      </div>)}
      {users && !filteredUsers.length && !dniMatch && <div className="empty">{userSearch || appFilter !== 'all' ? t('No users match that name.') : t('No users yet.')}</div>}
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
      {selectedId ? <UserDetail key={selectedId} id={selectedId} billingEnabled={billingEnabled} users={users} openUser={openUser} onChanged={loadUsers} close={() => setSelectedId(null)} />
        : <div className="empty">{t('Seleccioná un socio')}</div>}
    </div>}
  </div>
}
