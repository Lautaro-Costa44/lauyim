import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { api } from '../../lib/api.js'
import { t } from '../../lib/i18n.js'
import { AdminContext } from './context.js'
// Resumen is the landing section: static, in this chunk, so /admin -> /admin/resumen renders at
// once instead of keeping the previous screen while another chunk loads. The rest are lazy.
import Resumen from './Resumen.jsx'
const Usuarios = lazy(() => import('./Usuarios.jsx'))
const Cuotas = lazy(() => import('./Cuotas.jsx'))
const Rutinas = lazy(() => import('./Rutinas.jsx'))
const Notificaciones = lazy(() => import('./Notificaciones.jsx'))
const Acceso = lazy(() => import('./Acceso.jsx'))
const Logs = lazy(() => import('./Logs.jsx'))

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
  const [billingEnabled, setBillingEnabled] = useState(null)   // null until the server says; false = cuotas off (owner switch in Acceso)

  // audit_enabled and billing_enabled ride along with the users poll: they decide whether the
  // Logs and Cuotas tabs exist.
  const loadUsers = () => api('/api/admin/users').then(d => { setUsers(d.users); setInviteOnly(d.invite_only); setAuditEnabled(d.audit_enabled !== false); setBillingEnabled(d.billing_enabled !== false) }).catch(e => toast(e.message || t('Failed to load')))
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
  }, [loc.pathname, user?.owner, auditEnabled, billingEnabled])

  if (!user?.admin) return null

  const sections = [
    ['resumen', t('Resumen')],
    ['usuarios', t('Usuarios')],
    billingEnabled !== false && ['cuotas', t('Cuotas')],
    ['rutinas', t('Rutinas')],
    ['notificaciones', t('Notificaciones')],
    ['acceso', t('Acceso')],
    auditEnabled !== false && ['logs', t('Logs')],
  ].filter(Boolean)
  const ctx = { users, inviteOnly, invites, presets, attendance, qrAccess, setQrAccess, tick, auditEnabled, billingEnabled, setBillingEnabled, loadUsers, loadInvites, loadPresets, loadAttendance, refresh }

  return <div className="admin-shell">
    <nav className="admin-nav chips" ref={navRef} aria-label={t('Admin')}>
      {sections.map(([path, label]) => <NavLink key={path} to={'/admin/' + path} className={({ isActive }) => 'chip nocap' + (isActive ? ' on' : '')}>{label}</NavLink>)}
      <NavLink to="/home" className="chip nocap admin-nav-back">{t('Volver a la app')}</NavLink>
    </nav>
    <div className="admin-main">
      <AdminContext.Provider value={ctx}>
        <Suspense fallback={<div className="page-loading" aria-busy="true" />}>
          <Routes>
            <Route index element={<Navigate to="/admin/resumen" replace />} />
            <Route path="resumen" element={<Resumen />} />
            <Route path="usuarios" element={<Usuarios />} />
            {/* Cuotas off: straight to Resumen, without loading the Cuotas chunk. Until the first
                users poll answers, a placeholder (not the chunk) holds the spot. */}
            <Route path="cuotas" element={billingEnabled === false ? <Navigate to="/admin/resumen" replace />
              : billingEnabled == null ? <div className="page-loading" aria-busy="true" /> : <Cuotas />} />
            <Route path="rutinas" element={<Rutinas />} />
            <Route path="notificaciones" element={<Notificaciones />} />
            <Route path="acceso" element={<Acceso />} />
            <Route path="qr" element={<Navigate to="/admin/acceso" replace />} />
            <Route path="logs" element={<Logs />} />
            <Route path="*" element={<Navigate to="/admin/resumen" replace />} />
          </Routes>
        </Suspense>
      </AdminContext.Provider>
    </div>
  </div>
}
