import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bindUI } from './components/ui.jsx'
import { ACCENTS } from './lib/format.js'
import { setLang, useLang } from './lib/i18n.js'
import { setNav } from './lib/nav.js'
import { useWakeLock } from './lib/wakelock.js'
import { guestAllowed } from './lib/guest.js'
import Icon from './components/Icon.jsx'
import TabBar from './components/TabBar.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Modals from './components/Modals.jsx'
import Toast from './components/Toast.jsx'
import RestTimer from './components/RestTimer.jsx'
import { installKeyboardViewport } from './lib/keyboard.js'
import { disableKeyboardAutofill } from './lib/input-safety.js'
import Login from './views/Login.jsx'
import LicenseExpired from './views/LicenseExpired.jsx'
import MembershipBlocked from './views/MembershipBlocked.jsx'
import { markNotifStepDone, notifStepDone, notifStepKind } from './lib/notif-step.js'
// Keep every authenticated screen out of the initial payload. The service worker
// caches each chunk after first use, so repeat visits remain instant without
// forcing a large first download on mobile connections.
const Home = lazy(() => import('./views/Home.jsx'))
const Plan = lazy(() => import('./views/Plan.jsx'))
const RoutineEdit = lazy(() => import('./views/RoutineEdit.jsx'))
const Workout = lazy(() => import('./views/Workout.jsx'))
const Stats = lazy(() => import('./views/Stats.jsx'))
const Nutricion = lazy(() => import('./views/Nutricion.jsx'))
const History = lazy(() => import('./views/History.jsx'))
const Settings = lazy(() => import('./views/Settings.jsx'))
const AdminLayout = lazy(() => import('./views/admin/AdminLayout.jsx'))
const SurveyWizard = lazy(() => import('./views/SurveyWizard.jsx'))
const ImportPlan = lazy(() => import('./views/ImportPlan.jsx'))
const Privacy = lazy(() => import('./views/Privacy.jsx'))
const ProfileOnce = lazy(() => import('./views/ProfileOnce.jsx'))
const NotificationsStep = lazy(() => import('./views/NotificationsStep.jsx'))

bindUI(useUI)   // lets the shared controls open sheets without importing the store at module scope

// Keep the large sheet/workout toolset out of the entry chunk. It is fetched only when
// the user starts a workout flow, then stays in the service-worker cache.
const startFlow = (...args) => import('./sheets.jsx').then(module => module.startFlow(...args))

// theme === 'system' follows the OS/browser preference instead of a fixed choice.
const resolveTheme = theme => theme === 'light' || theme === 'dark'
  ? theme
  : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

function applyPrefs(theme, accent) {
  const de = document.documentElement
  de.dataset.theme = resolveTheme(theme)
  de.dataset.accent = ACCENTS[accent] ? accent : 'lime'
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.content = de.dataset.theme === 'light' ? '#f2f2f7' : '#000000'
}

function Shell() {
  const navigate = useNavigate()
  const loc = useLocation()
  const { S, user, ready } = useStore()
  const config = useStore(s => s.config)
  const licenseExpired = useStore(s => s.licenseExpired)
  const membershipBlocked = useStore(s => s.membershipBlocked)
  const accountPending = useStore(s => s.accountPending)
  const profilePrompt = useStore(s => s.profilePrompt)
  const isGuest = useStore(s => s.isGuest())
  const langV = useLang()   // re-renders the whole shell when the language (pack) changes
  useLayoutEffect(() => {
    disableKeyboardAutofill(document)
    const observer = new MutationObserver(() => disableKeyboardAutofill(document))
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
  useEffect(() => installKeyboardViewport(), [])
  useEffect(() => { setNav(navigate) }, [navigate])
  useEffect(() => { applyPrefs(S.theme, S.accent) }, [S.theme, S.accent])
  // 'system' needs to react live if the OS theme flips while the app is open, not just on
  // the next mount — a fixed 'dark'/'light' choice never re-fires this since matchMedia
  // isn't consulted for those.
  useEffect(() => {
    if (S.theme !== 'system' || !window.matchMedia) return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyPrefs(S.theme, S.accent)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [S.theme, S.accent])
  useEffect(() => { setLang(S.lang || 'es') }, [S.lang])
  useEffect(() => { document.documentElement.lang = S.lang === 'en' ? 'en' : 'es' }, [langV, S.lang])
  // every tab/route change starts at the top of the page
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])
  // bound to the workout, not to the route — checking Stats mid-session keeps the screen on
  useWakeLock(!!S.active && S.keepAwake !== false)

  // La configuración del backend es la única fuente de verdad para invitados.
  const allowGuest = guestAllowed(config)
  
  // Si no se permiten invitados, estar en modo invitado NO cuenta como estar autenticado
  const authed = !!user || (allowGuest && isGuest)
  // Bloqueo por cuota: pantalla completa, sin TabBar ni RestTimer. Nunca para staff.
  // Cuenta pendiente de aprobación: misma pantalla, otro motivo.
  const blocked = !licenseExpired && (membershipBlocked || accountPending) && !!user && !user.admin
  // Socios que ya existían sin datos: el formulario, una sola vez, antes de todo lo demás.
  const askProfile = !licenseExpired && !blocked && !!user && !user.admin && !!profilePrompt
  const isAdminPath = loc.pathname === '/admin' || loc.pathname.startsWith('/admin/')
  // El aviso de privacidad es público: se ve sin sesión, con la licencia vencida o bloqueado.
  const isPrivacy = loc.pathname === '/privacidad'
  // Primer ingreso (antes del tour y la encuesta, después del formulario de datos): ofrecer
  // notificaciones una vez por dispositivo.
  const [notifShown, setNotifShown] = useState(0)
  const notifKind = user && !S.onboardingCompletado && !notifStepDone(user.id) ? notifStepKind() : null
  const askNotif = !licenseExpired && !blocked && !askProfile && !!notifKind
  void notifShown   // re-render al cerrar el paso (la marca vive en localStorage)
  if (!ready) return (
    <div id="app">
      <div style={{ paddingTop: '44vh', display: 'flex', justifyContent: 'center' }}>
        <img src="logo-perf.svg" alt="lauyim" style={{ width: 72, height: 72 }} />
      </div>
    </div>
  )

  return (
    <>
      {/* keyed on the route: a view that throws is contained, and switching tabs
          re-mounts the boundary, so the tab bar is always a way out. Every /admin/* section
          shares one key: switching sections must not re-mount the admin layout (and its poll). */}
      <div id="app" className={'vfade' + (isAdminPath ? ' admin-app' : '')} key={isAdminPath ? '/admin' : loc.pathname}>
        <ErrorBoundary>
          {isPrivacy ? <Suspense fallback={<div className="page-loading" aria-busy="true" />}><Privacy /></Suspense>
            : licenseExpired ? <LicenseExpired /> : !authed ? <Login /> : blocked ? <MembershipBlocked />
            : askProfile ? <Suspense fallback={<div className="page-loading" aria-busy="true" />}><ProfileOnce /></Suspense>
            : askNotif ? <Suspense fallback={<div className="page-loading" aria-busy="true" />}>
              <NotificationsStep kind={notifKind} onDone={() => { markNotifStepDone(user.id); setNotifShown(n => n + 1) }} /></Suspense> : (
            <Suspense fallback={<div className="page-loading" aria-busy="true" />}> 
            <Routes>
              <Route path="/home" element={<Home />} />
              <Route path="/plan" element={<Plan />} />
              <Route path="/plan/ejercicios" element={<Plan />} />
              <Route path="/plan/r/:id" element={<RoutineEdit />} />
              <Route path="/workout" element={<Workout />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/nutricion" element={<Nutricion />} />
              <Route path="/history" element={<History />} />
              <Route path="/library" element={<Navigate to="/plan/ejercicios" replace />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/import" element={<ImportPlan />} />
              <Route path="/onboarding/encuesta" element={<SurveyWizard />} />
              {/* The admin sections are routed inside AdminLayout (views/admin/AdminLayout.jsx). */}
              <Route path="/admin/*" element={user?.admin ? <AdminLayout /> : <Navigate to="/home" replace />} />
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes>
            </Suspense>
          )}
        </ErrorBoundary>
      </div>
      {!licenseExpired && !blocked && !askProfile && !askNotif && !isPrivacy && loc.pathname !== '/onboarding/encuesta' && <TabBar onStart={startFlow} />}
      {!licenseExpired && !blocked && <RestTimer />}
      {/* Boundary propio: Modals vive fuera de #app, así que un throw acá subía hasta la raíz y
          desmontaba la app entera — pantalla negra sin salida. NO va keyed en la ruta: Modals
          debe sobrevivir a la navegación (re-montarlo volvería a apilar entradas de historial
          por cada sheet abierto). El fallback deja el botón de recarga. */}
      <ErrorBoundary><Modals /></ErrorBoundary>
      <Toast />
    </>
  )
}

export default function App() {
  const boot = useStore(s => s.boot)
  useEffect(() => { boot() }, [boot])
  return <HashRouter><Shell /></HashRouter>
}
