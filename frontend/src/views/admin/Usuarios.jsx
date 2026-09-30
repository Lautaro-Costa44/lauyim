import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useAdmin } from './context.js'
import { useDesktop } from './useDesktop.js'
import { useUI } from '../../store/useUI.js'
import { useStore } from '../../store/useStore.js'
import { t } from '../../lib/i18n.js'
import Icon from '../../components/Icon.jsx'
import { Button, Row, TextField } from '../../components/ui.jsx'
import { rel, UserDetail } from './shared.jsx'
import { IncompleteBadge, NoAppBadge, PendingBadge, exportMembersCsv, looksLikeDni, lookupDni, openImportSheet, openMemberSheet } from './members/common.jsx'
import { errorText } from '../../lib/errors.js'
import { nickSuffix, memberName } from '../../lib/member-name.js'
import { StatusBadge } from './billing/common.jsx'

// Filtro por acceso a la app: las fichas (sin passkey) las carga el gimnasio. "Pendientes":
// cuentas que esperan la aprobación del staff (solo aparece si hay alguna).
const APP_FILTERS = [['all', 'Todos'], ['app', 'Con app'], ['noapp', 'Sin app']]
const isPending = u => !!u.pending && !u.disabled
const matchesAppFilter = (u, f) => f === 'all' || (f === 'pending' ? isPending(u) : f === 'app' ? u.hasApp !== false : u.hasApp === false)

// Tabla de escritorio: 25 por página; en el celular la lista de tarjetas, 10 por página.
const PAGE_DESKTOP = 25
const PAGE_PHONE = 10
// Orden por cuota: lo que hay que atender primero arriba.
const BILLING_URGENCY = ['bloqueado', 'vencido', 'por_vencer', 'prueba', 'al_dia', 'sin_plan']
const staffOf = u => u.owner || u.admin
const displayName = u => memberName({ fullName: u.fullName, nick: u.name })

// Días entre dos fechas YYYY-MM-DD (calendario, sin husos).
const dayDiff = (from, to) => Math.round((Date.parse(to + 'T12:00:00Z') - Date.parse(from + 'T12:00:00Z')) / 86400000)
const localToday = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
// "hoy", "ayer", "hace 3 d", "hace 2 sem", "hace 4 meses", "—".
export function seenLabel(date, today = localToday()) {
  if (!date) return '—'
  const n = dayDiff(date, today)
  if (n <= 0) return t('hoy')
  if (n === 1) return t('ayer')
  if (n < 14) return t('hace {0} d', n)
  if (n < 60) return t('hace {0} sem', Math.floor(n / 7))
  if (n < 365) return t('hace {0} meses', Math.floor(n / 30))
  return t('hace más de un año')
}

// Dueño / admin junto al nombre: pastilla chica de acento con su ícono (distinta de los estados
// en gris: sin app, pendiente, off).
export function RoleBadge({ user }) {
  if (!staffOf(user)) return null
  return <span className={'role-badge' + (user.owner ? ' owner' : '')}>
    <Icon name={user.owner ? 'crown' : 'shield'} />{user.owner ? t('Dueño') : t('Admin')}
  </span>
}

// Nombre + usuario en gris + rol + estados: lo mismo en la tabla y en las tarjetas.
function NameCell({ u }) {
  const nick = nickSuffix({ fullName: u.fullName, nick: u.name })
  return <div className="tt">
    {u.live && <Icon name="dot" className="ulive" title={t('training now')} />}
    <span className="uname">{u.fullName || u.name}</span>{nick && <span className="unick"> [{nick}]</span>}
    <RoleBadge user={u} />
    {u.disabled && <span className="tag nocap uoff">{t('off')}</span>}
    {u.hasApp === false && <NoAppBadge />}
    {isPending(u) && <PendingBadge />}
    {u.profileIncomplete && <IncompleteBadge />}
  </div>
}

function SortHead({ id, label, sort, setSort, className = '' }) {
  const on = sort.key === id
  return <button type="button" role="columnheader" aria-sort={on ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none'}
    className={'uhead' + (on ? ' on' : '') + (className ? ' ' + className : '')}
    onClick={() => setSort(s => s.key === id ? { key: id, dir: -s.dir } : { key: id, dir: id === 'seen' ? -1 : 1 })}>
    {label}{on && <Icon name={sort.dir > 0 ? 'chevronUp' : 'chevronDown'} />}
  </button>
}

// "‹ 1–25 de 148 ›" en lugar de cinco botones.
function Pager({ page, pageCount, pageSize, total, setPage }) {
  if (pageCount <= 1) return null
  const from = (page - 1) * pageSize + 1, to = Math.min(total, page * pageSize)
  return <div className="upager">
    <button className="iconbtn" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))} aria-label={t('Previous')}><Icon name="chevronLeft" /></button>
    <span className="muted small">{t('{0}–{1} de {2}', from, to, total)}</span>
    <button className="iconbtn" disabled={page === pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))} aria-label={t('Next')}><Icon name="chevronRight" /></button>
  </div>
}

export default function Usuarios() {
  const openSheet = useUI(s => s.openSheet)
  const toast = useUI(s => s.toast)
  const { users, loadUsers, billingEnabled } = useAdmin()
  const isOwner = !!useStore(s => s.user)?.owner
  const [userSearch, setUserSearch] = useState('')
  const [userPage, setUserPage] = useState(1)
  const desktop = useDesktop()
  const [selectedId, setSelectedId] = useState(null)   // desktop only: whose UserDetail sits in the side panel
  // /admin/usuarios?filtro=pendientes (desde Resumen) abre la lista ya filtrada.
  const loc = useLocation()
  const [appFilter, setAppFilter] = useState(() => new URLSearchParams(loc.search).get('filtro') === 'pendientes' ? 'pending' : 'all')
  const [dniMatch, setDniMatch] = useState(null)       // { userId, name, hasApp } when the search is a DNI
  const [sort, setSort] = useState({ key: 'name', dir: 1 })

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
  const [exporting, setExporting] = useState(false)
  const exportMembers = () => {
    setExporting(true)
    exportMembersCsv().then(() => toast(t('Socios exportados'))).catch(e => toast(errorText(e, t('No se pudo exportar'))))
      .finally(() => setExporting(false))
  }
  const disabledCount = (users || []).filter(u => u.disabled).length
  const pendingCount = (users || []).filter(isPending).length
  const filters = pendingCount || appFilter === 'pending' ? [...APP_FILTERS, ['pending', t('Pendientes ({0})', pendingCount)]] : APP_FILTERS
  const showBilling = billingEnabled !== false
  const query = userSearch.trim().toLocaleLowerCase()
  const filteredUsers = (users || []).filter(u => matchesAppFilter(u, appFilter)
    && (u.name.toLocaleLowerCase().includes(query) || (u.fullName || '').toLocaleLowerCase().includes(query)))
  const billingRank = u => staffOf(u) ? BILLING_URGENCY.length : Math.max(0, BILLING_URGENCY.indexOf(u.billing?.status))
  const compare = {
    name: (a, b) => displayName(a).localeCompare(displayName(b), 'es', { sensitivity: 'base' }),
    billing: (a, b) => billingRank(a) - billingRank(b) || compare.name(a, b),
    seen: (a, b) => (a.lastSeen || '').localeCompare(b.lastSeen || '') || compare.name(a, b),
  }
  const sortedUsers = [...filteredUsers].sort((a, b) => sort.dir * (compare[sort.key] || compare.name)(a, b))
  const pageSize = desktop ? PAGE_DESKTOP : PAGE_PHONE
  const userPageCount = Math.max(1, Math.ceil(sortedUsers.length / pageSize))
  const visibleUsers = sortedUsers.slice((userPage - 1) * pageSize, userPage * pageSize)
  useEffect(() => { setUserPage(1) }, [sort.key, sort.dir, desktop])
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
      {isOwner && <Button variant="tinted" icon="download" className="member-export" disabled={exporting} onClick={exportMembers}>{exporting ? t('Exportando…') : t('Exportar socios')}</Button>}
    </div>
    <h4 className="sec">{t('Usuarios: {0} ({1} Desactivados)', users ? users.length : 0, disabledCount)}</h4>
    <div style={{ marginBottom: 10 }}>
      <TextField name="admin-user-search" value={userSearch} onChange={e => changeUserSearch(e.target.value)}
        placeholder={t('Buscar por nombre o DNI')} aria-label={t('Buscar por nombre o DNI')} />
    </div>
    <div className="chips member-filter" role="group" aria-label={t('Acceso a la app')}>
      {filters.map(([value, label]) => <button key={value} type="button" className={'chip nocap' + (appFilter === value ? ' on' : '')}
        aria-pressed={appFilter === value} onClick={() => { setAppFilter(value); setUserPage(1) }}>{t(label)}</button>)}
    </div>
    {dniMatch && <div className="sect-b member-dni-match">
      <Row title={dniMatch.name} subtitle={t('Coincide DNI')} onClick={() => openUser(dniMatch.userId)} accessory="chevron">
        {!dniMatch.hasApp && <NoAppBadge />}
      </Row>
    </div>}
    {desktop ? <div className={'utable' + (showBilling ? '' : ' nobilling')} role="table" aria-label={t('Usuarios')}>
      <div className="urow uheader" role="row">
        <SortHead id="name" label={t('Nombre')} sort={sort} setSort={setSort} />
        {showBilling && <SortHead id="billing" label={t('Cuota')} sort={sort} setSort={setSort} />}
        <SortHead id="seen" label={t('Último ingreso')} sort={sort} setSort={setSort} />
        <span />
      </div>
      {visibleUsers.map(u => <div key={u.id} role="row" tabIndex={0}
        className={'item urow' + (selectedId === u.id ? ' on' : '') + (u.disabled ? ' off' : '')}
        onClick={() => openUser(u.id)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openUser(u.id) } }}>
        <div className="ucell grow" role="cell"><NameCell u={u} /></div>
        {showBilling && <div className="ucell" role="cell">{!staffOf(u) && u.billing?.status ? <StatusBadge status={u.billing.status} /> : <span className="dim">—</span>}</div>}
        <div className="ucell dim small" role="cell" title={u.lastSeen || ''}>{u.live ? <span className="accent">{t('ahora')}</span> : seenLabel(u.lastSeen)}</div>
        <div className="ucell uicons" role="cell">{u.hasPush && <Icon name="bell" title="push enabled" />}</div>
      </div>)}
    </div> : <div className="list">
      {visibleUsers.map(u => <div key={u.id} className={'item' + (u.disabled ? ' off' : '')} onClick={() => openUser(u.id)}>
        <div className="grow"><NameCell u={u} />
          <div className="ss">{u.hasApp === false ? t('Ficha cargada por el gimnasio') : u.live ? t('training now') + ' · ' + u.live.name : t('Último ingreso: {0}', seenLabel(u.lastSeen)) + ' · ' + t('synced') + ' ' + rel(u.lastSync)}</div></div>
        {showBilling && !staffOf(u) && u.billing?.status && <StatusBadge status={u.billing.status} />}
        {u.hasPush && <Icon name="bell" title="push enabled" style={{ fontSize: 15, color: 'var(--label-3)' }} />}<Icon name="chevronRight" className="chev" />
      </div>)}
    </div>}
    {users && !filteredUsers.length && !dniMatch && <div className="empty">{userSearch || appFilter !== 'all' ? t('No users match that name.') : t('No users yet.')}</div>}
    {users && filteredUsers.length > 0 && <Pager page={userPage} pageCount={userPageCount} pageSize={pageSize} total={sortedUsers.length} setPage={setUserPage} />}
    </div>
    {desktop && <div className="card admin-user-panel">
      {/* keyed: a different member starts from "Loading…", never from the previous one's data */}
      {selectedId ? <UserDetail key={selectedId} id={selectedId} billingEnabled={billingEnabled} users={users} openUser={openUser} onChanged={loadUsers} close={() => setSelectedId(null)} />
        : <div className="empty">{t('Seleccioná un socio')}</div>}
    </div>}
  </div>
}
