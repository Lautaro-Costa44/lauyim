import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { api } from '../../lib/api.js'
import { t } from '../../lib/i18n.js'
import { useOnline } from '../../lib/useOnline.js'
import Icon from '../../components/Icon.jsx'
import { AdminContext } from './context.js'
// Resumen is the landing section: static, in this chunk, so /admin -> /admin/resumen renders at
// once instead of keeping the previous screen while another chunk loads. The rest are lazy.
import Resumen from './Resumen.jsx'
import { errorText } from '../../lib/errors.js'
import { can, isStaffUser, visibleSections } from '../../lib/permissions.js'
const Usuarios = lazy(() => import('./Usuarios.jsx'))
const Cuotas = lazy(() => import('./Cuotas.jsx'))
const Rutinas = lazy(() => import('./Rutinas.jsx'))
const Notificaciones = lazy(() => import('./Notificaciones.jsx'))
const Acceso = lazy(() => import('./Acceso.jsx'))
const Personalizacion = lazy(() => import('./Personalizacion.jsx'))
const Logs = lazy(() => import('./Logs.jsx'))
const IngresoFisico = lazy(() => import('./IngresoFisico.jsx'))
const Roles = lazy(() => import('./Roles.jsx'))
const AdminClases = lazy(() => import('./Clases.jsx'))

// Panel del staff: cada sección y cada carga según los permisos del rol (lib/permissions.js; el
// servidor vuelve a controlar cada pedido).
// The layout owns every admin fetch — including the 15 s poll — and hands the data to the
// sections through the outlet context, so switching sections never re-requests or re-polls.

export default function AdminLayout() {
  const loc = useLocation()
  const user = useStore(s => s.user)
  const setUser = useStore(s => s.setUser)
  const toast = useUI(s => s.toast)
  const online = useOnline()
  // navigator.onLine puede decir "conectado" sin salida real (modo avión en algunos iOS/Android):
  // un pedido que falla sin respuesta del servidor cuenta igual como sin conexión.
  const [unreachable, setUnreachable] = useState(false)
  const navRef = useRef(null)
  const [users, setUsers] = useState(null)
  const [invites, setInvites] = useState(null)
  const [presets, setPresets] = useState(null)
  const [programs, setPrograms] = useState(null)
  const [inviteOnly, setInviteOnly] = useState(false)
  const [attendance, setAttendance] = useState(null)
  const [qrAccess, setQrAccess] = useState(null)
  const [tick, setTick] = useState(0)          // the ↻ button; the activity log listens to it
  const [auditEnabled, setAuditEnabled] = useState(null)   // null until the server says; false = AUDIT_LOG=0
  const [billingEnabled, setBillingEnabled] = useState(null)   // null until the server says; false = cuotas off (owner switch in Acceso)
  const [checkinEnabled, setCheckinEnabled] = useState(null)   // Ingreso Físico: el owner siempre ve la sección; los demás, solo encendido
  const [classesEnabled, setClassesEnabled] = useState(null)   // Clases: igual que Ingreso Físico (el owner la prende desde la sección)

  // audit_enabled and billing_enabled ride along with the users poll: they decide whether the
  // Logs and Cuotas tabs exist.
  // Sin respuesta del servidor no es un error de la sección: es la falta de conexión (un aviso,
  // no un toast por cada pedido y cada vuelta del poll).
  const loadFailed = (e, fallback) => { if (!e?.status) setUnreachable(true); else toast(errorText(e, fallback)) }
  const loadUsers = () => !can(user, 'members.view') ? Promise.resolve() : api('/api/admin/users').then(d => { setUnreachable(false); setUsers(d.users); setInviteOnly(d.invite_only); setAuditEnabled(d.audit_enabled !== false); setBillingEnabled(d.billing_enabled !== false); setCheckinEnabled(d.checkin_enabled === true) }).catch(e => loadFailed(e, t('Failed to load')))
  const loadInvites = () => !can(user, 'members.edit') ? Promise.resolve() : api('/api/admin/invites').then(d => setInvites(d.invites)).catch(() => {})
  const loadPresets = () => !can(user, 'training.manage') ? Promise.resolve() : api('/api/admin/presets').then(d => { setPresets(d.presets); setPrograms(d.programs || []) }).catch(e => loadFailed(e, t('Failed to load presets')))
  const loadAttendance = () => !can(user, 'stats.view') ? Promise.resolve() : api('/api/admin/attendance-heatmap').then(setAttendance).catch(e => loadFailed(e, t('Failed to load attendance')))
  const loadQrAccess = () => { if (user?.owner) api('/api/owner/qr').then(setQrAccess).catch(e => loadFailed(e, t('Failed to load QR access'))) }
  const refresh = () => { loadUsers(); loadInvites(); loadPresets(); loadAttendance(); loadQrAccess(); setTick(n => n + 1) }
  // Al entrar: el rol y los permisos al día (el owner pudo cambiarlos) y qué funciones del gym
  // están encendidas (también para quien no lista socios, que es donde venían).
  useEffect(() => {
    api('/api/me').then(me => {
      if (me?.user && JSON.stringify(me.user) !== JSON.stringify(user)) setUser(me.user)
      if (me?.panel) { setBillingEnabled(me.panel.billingEnabled !== false); setCheckinEnabled(me.panel.checkinEnabled === true); setAuditEnabled(me.panel.auditEnabled !== false); setClassesEnabled(me.panel.classesEnabled !== false) }
    }).catch(() => {})
  }, [])
  // poll every 15s so the "training now" section stays live without a manual refresh
  const permKey = (user?.permissions || []).join(',')
  useEffect(() => { if (!isStaffUser(user)) return; loadUsers(); loadInvites(); loadPresets(); loadAttendance(); loadQrAccess(); const iv = setInterval(() => { loadUsers(); loadAttendance() }, 15000); return () => clearInterval(iv) }, [user?.owner, permKey])

  // Phone tabs scroll sideways inside their own strip: center the active one, also when the
  // page is opened from a direct link to a section further right. Only the strip scrolls
  // (scrollIntoView would also move the page vertically); the first centering jumps, later
  // ones glide. From 1000px the tabs are a side menu and nothing scrolls.
  const firstCenter = useRef(true)
  const centerActiveTab = smooth => {
    const nav = navRef.current
    const on = nav?.querySelector('a.on')
    if (!on || window.matchMedia('(min-width: 1000px)').matches) return false
    const left = on.offsetLeft - (nav.clientWidth - on.offsetWidth) / 2
    nav.scrollTo({ left: Math.max(0, left), behavior: smooth ? 'smooth' : 'auto' })
    return true
  }
  useEffect(() => {
    const frame = requestAnimationFrame(() => { if (centerActiveTab(!firstCenter.current)) firstCenter.current = false })
    return () => cancelAnimationFrame(frame)
  }, [loc.pathname, user?.owner, auditEnabled, billingEnabled, checkinEnabled])
  // Chip widths change once the web font lands: center again, without animation.
  useEffect(() => {
    let alive = true
    document.fonts?.ready.then(() => { if (alive) centerActiveTab(false) })
    return () => { alive = false }
  }, [])

  if (!isStaffUser(user)) return null

  const sections = visibleSections(user, { billingEnabled, checkinEnabled, auditEnabled, classesEnabled }).map(s => [s.path, t(s.label)])
  const visible = new Set(sections.map(([path]) => path))
  const home = sections[0]?.[0] || 'resumen'
  // Una sección que esta persona no ve: a la primera que sí (sin cargar el chunk).
  const only = (path, element) => visible.has(path) ? element : <Navigate to={'/admin/' + home} replace />
  const ctx = { users, inviteOnly, invites, presets, programs, attendance, qrAccess, setQrAccess, tick, auditEnabled, billingEnabled, setBillingEnabled, checkinEnabled, setCheckinEnabled, loadUsers, loadInvites, loadPresets, loadAttendance, refresh }

  return <div className="admin-shell">
    <nav className="admin-nav chips" ref={navRef} aria-label={t('Admin')}>
      {sections.map(([path, label]) => <NavLink key={path} to={'/admin/' + path} className={({ isActive }) => 'chip nocap' + (isActive ? ' on' : '')}>{label}</NavLink>)}
      <NavLink to="/home" className="chip nocap admin-nav-back">{t('Volver a la app')}</NavLink>
    </nav>
    <div className="admin-main">
      {/* Todas las secciones leen del servidor: sin conexión, un aviso en lugar de un spinner eterno. */}
      {!online || unreachable ? <div className="empty" role="status">
        <div className="ico"><Icon name="wifiOff" /></div>
        {t('Esta sección requiere conexión a internet')}
        <br /><span className="dim small">{t('Se actualiza cuando vuelva la conexión.')}</span>
      </div> : <AdminContext.Provider value={ctx}>
        <Suspense fallback={<div className="page-loading" aria-busy="true" />}>
          <Routes>
            <Route index element={<Navigate to={'/admin/' + home} replace />} />
            <Route path="resumen" element={only('resumen', <Resumen />)} />
            <Route path="usuarios" element={only('usuarios', <Usuarios />)} />
            {/* Cuotas off: straight to Resumen, without loading the Cuotas chunk. Until the first
                users poll answers, a placeholder (not the chunk) holds the spot. */}
            <Route path="cuotas" element={only('cuotas', billingEnabled == null ? <div className="page-loading" aria-busy="true" /> : <Cuotas />)} />
            <Route path="rutinas" element={only('rutinas', <Rutinas />)} />
            <Route path="clases" element={only('clases', <AdminClases />)} />
            <Route path="notificaciones" element={only('notificaciones', <Notificaciones />)} />
            <Route path="acceso" element={only('acceso', <Acceso />)} />
            <Route path="roles" element={only('roles', <Roles />)} />
            <Route path="personalizacion" element={only('personalizacion', <Personalizacion />)} />
            <Route path="qr" element={<Navigate to="/admin/acceso" replace />} />
            <Route path="logs" element={only('logs', <Logs />)} />
            {/* Apagado: solo el owner (para encenderlo). */}
            <Route path="ingreso-fisico" element={only('ingreso-fisico', !user?.owner && checkinEnabled == null ? <div className="page-loading" aria-busy="true" /> : <IngresoFisico />)} />
            <Route path="*" element={<Navigate to={'/admin/' + home} replace />} />
          </Routes>
        </Suspense>
      </AdminContext.Provider>}
    </div>
  </div>
}
