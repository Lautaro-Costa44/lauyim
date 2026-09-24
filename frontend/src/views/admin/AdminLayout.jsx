import { Suspense, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { api } from '../../lib/api.js'
import { t } from '../../lib/i18n.js'
import Resumen from './Resumen.jsx'

// Admin-only operator dashboard (owner passkey + admin flag; guarded again server-side).
// The layout owns every admin fetch — including the 15 s poll — and hands the data to the
// sections through the outlet context, so switching sections never re-requests or re-polls.

export default function AdminLayout() {
  const loc = useLocation()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const navRef = useRef(null)
  const [users, setUsers] = useState(null)
  const [invites, setInvites] = useState(null)
  const [presets, setPresets] = useState(null)
  const [inviteOnly, setInviteOnly] = useState(false)
  const [attendance, setAttendance] = useState(null)
  const [qrAccess, setQrAccess] = useState(null)
  const [tick, setTick] = useState(0)          // the ↻ button; the activity log listens to it
  const [auditEnabled, setAuditEnabled] = useState(null)   // null until the server says; false = AUDIT_LOG=0

  // audit_enabled rides along with the users poll: it decides whether the Logs tab exists.
  const loadUsers = () => api('/api/admin/users').then(d => { setUsers(d.users); setInviteOnly(d.invite_only); setAuditEnabled(d.audit_enabled !== false) }).catch(e => toast(e.message || t('Failed to load')))
  const loadInvites = () => api('/api/admin/invites').then(d => setInvites(d.invites)).catch(() => {})
  const loadPresets = () => api('/api/presets').then(d => setPresets(d.presets)).catch(e => toast(e.message || t('Failed to load presets')))
  const loadAttendance = () => api('/api/admin/attendance-heatmap').then(setAttendance).catch(e => toast(e.message || t('Failed to load attendance')))
  const loadQrAccess = () => { if (user?.owner) api('/api/owner/qr').then(setQrAccess).catch(e => toast(e.message || t('Failed to load QR access'))) }
  const refresh = () => { loadUsers(); loadInvites(); loadPresets(); loadAttendance(); loadQrAccess(); setTick(n => n + 1) }
  // poll every 15s so the "training now" section stays live without a manual refresh
  useEffect(() => { if (!user?.admin) return; loadUsers(); loadInvites(); loadPresets(); loadAttendance(); loadQrAccess(); const iv = setInterval(() => { loadUsers(); loadAttendance() }, 15000); return () => clearInterval(iv) }, [user?.owner])

  // Phone tabs scroll sideways inside their own strip: keep the active one in view, also when
  // the page is opened from a direct link to a section further right.
  useEffect(() => {
    const nav = navRef.current
    const on = nav?.querySelector('.on')
    if (!on || nav.scrollWidth <= nav.clientWidth) return
    const n = nav.getBoundingClientRect(), a = on.getBoundingClientRect()
    nav.scrollLeft += (a.left - n.left) - (n.width - a.width) / 2
  }, [loc.pathname, user?.owner, auditEnabled])

  if (!user?.admin) return null

  const sections = [
    ['resumen', t('Resumen')],
    ['usuarios', t('Usuarios')],
    ['cuotas', t('Cuotas')],
    ['rutinas', t('Rutinas')],
    ['notificaciones', t('Notificaciones')],
    user.owner && ['qr', t('QR')],
    auditEnabled !== false && ['logs', t('Logs')],
  ].filter(Boolean)
  // Resumen travels in the context: App.jsx renders it from here, without a lazy chunk of its own.
  const ctx = { Resumen, users, inviteOnly, invites, presets, attendance, qrAccess, setQrAccess, tick, auditEnabled, loadUsers, loadInvites, loadPresets, loadAttendance, refresh }

  return <div className="admin-shell">
    <nav className="admin-nav chips" ref={navRef} aria-label={t('Admin')}>
      {sections.map(([path, label]) => <NavLink key={path} to={'/admin/' + path} className={({ isActive }) => 'chip nocap' + (isActive ? ' on' : '')}>{label}</NavLink>)}
      <NavLink to="/home" className="chip nocap admin-nav-back">{t('Volver a la app')}</NavLink>
    </nav>
    <div className="admin-main">
      <Suspense fallback={<div className="page-loading" aria-busy="true" />}>
        <Outlet context={ctx} />
      </Suspense>
    </div>
  </div>
}
