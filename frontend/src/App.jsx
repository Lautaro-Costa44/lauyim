import ClassAfterPrompt from './components/ClassAfterPrompt.jsx'
import ClosureNotice from './components/closures/ClosureNotice.jsx'
import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { lazy, Suspense, useEffect, useLayoutEffect, useState } from 'react'
import { useStore, billingExempt, healthOff } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bindUI } from './components/ui.jsx'
import { ACCENTS } from './lib/format.js'
import { resolveAccent, customAccentVars, cachedBranding, applyBrandingToDocument, logoSrc, themeFor } from './lib/branding.js'
import { setLang, useLang } from './lib/i18n.js'
import { setNav } from './lib/nav.js'
import { useWakeLock } from './lib/wakelock.js'
import { useWorkoutPresence } from './lib/presence.js'
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
import LicenseBanner from './components/LicenseBanner.jsx'
import MembershipBlocked from './views/MembershipBlocked.jsx'
import AccountEnded from './views/AccountEnded.jsx'
import UpdateGate from './components/UpdateGate.jsx'
import { getUpdater } from './lib/update.js'
import { CHECKIN_ROUTE, getCheckinToken } from './lib/checkin-device.js'
import { clearIosReoffer, markIosReoffer, markNotifStepDone, notifStepFor } from './lib/notif-step.js'
import { isStaffUser } from './lib/permissions.js'
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
const IngresoFisicoScreen = lazy(() => import('./views/IngresoFisico.jsx'))
const ProfileOnce = lazy(() => import('./views/ProfileOnce.jsx'))
const NotificationsStep = lazy(() => import('./views/NotificationsStep.jsx'))
const ConsentOnce = lazy(() => import('./views/ConsentOnce.jsx'))
const Terms = lazy(() => import('./views/Terms.jsx'))

bindUI(useUI)   // lets the shared controls open sheets without importing the store at module scope

// Keep the large sheet/workout toolset out of the entry chunk. It is fetched only when
// the user starts a workout flow, then stays in the service-worker cache.
const startFlow = (...args) => import('./sheets.jsx').then(module => module.startFlow(...args))

// theme === 'system' follows the OS/browser preference instead of a fixed choice.
const resolveTheme = theme => theme === 'light' || theme === 'dark'
  ? theme
  : (window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

const SESSION_CHECK_MS = 5 * 60 * 1000

// branding: la personalización del gym (lib/branding.js). Su color se aplica como variables en
// línea (data-accent="custom"); los de la paleta, por data-accent en index.css.
function applyPrefs(theme, accent, branding) {
  const de = document.documentElement
  de.dataset.theme = resolveTheme(theme)
  const resolved = resolveAccent(accent, branding)
  const vars = resolved.key === 'custom' ? customAccentVars(resolved.color) : null
  for (const name of ['--acc', '--acc-2', '--on-acc']) {
    if (vars) de.style.setProperty(name, vars[name]); else de.style.removeProperty(name)
  }
  de.dataset.accent = vars ? 'custom' : ACCENTS[resolved.key] ? resolved.key : 'lime'
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
  const accountEnded = useStore(s => s.accountEnded)
  const verifySession = useStore(s => s.verifySession)
  const profilePrompt = useStore(s => s.profilePrompt)
  const healthAsk = useStore(s => s.healthAsk)
  const legalAsk = useStore(s => s.legalAsk)
  const noHealth = useStore(healthOff)
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
  // ¿La cuenta sigue activa? Al volver a primer plano y cada 5 min mientras la app está visible
  // (en segundo plano el intervalo se pausa). Si la desactivaron o borraron, se corta en minutos
  // aunque el socio no mande nada al servidor.
  const signedIn = !!user
  const verifyAccountEnded = useStore(s => s.verifyAccountEnded)
  // En la pantalla de baja, volver a primer plano vuelve a preguntar: si reactivaron la cuenta, entra sola.
  useEffect(() => {
    if (!accountEnded) return
    const onVisible = () => { if (document.visibilityState === 'visible') verifyAccountEnded() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [accountEnded, verifyAccountEnded])
  useEffect(() => {
    if (!signedIn) return
    let timer = null
    const start = () => { clearInterval(timer); timer = setInterval(verifySession, SESSION_CHECK_MS) }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { verifySession(); start() }
      else { clearInterval(timer); timer = null }
    }
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisibility) }
  }, [signedIn, verifySession])
  const branding = useStore(s => s.config?.branding) ?? cachedBranding()
  const theme = themeFor(S.theme, branding)   // el del gym si lo bloqueó (Personalización)
  useEffect(() => { applyPrefs(theme, S.accent, branding) }, [theme, S.accent, branding])
  useEffect(() => { applyBrandingToDocument(branding) }, [branding])
  // 'system' needs to react live if the OS theme flips while the app is open, not just on
  // the next mount — a fixed 'dark'/'light' choice never re-fires this since matchMedia
  // isn't consulted for those.
  useEffect(() => {
    if (theme !== 'system' || !window.matchMedia) return
    const mql = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyPrefs(theme, S.accent, branding)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [theme, S.accent, branding])
  useEffect(() => { setLang(S.lang || 'es') }, [S.lang])
  useEffect(() => { document.documentElement.lang = S.lang === 'en' ? 'en' : 'es' }, [langV, S.lang])
  // every tab/route change starts at the top of the page
  useEffect(() => { window.scrollTo(0, 0) }, [loc.pathname])
  // bound to the workout, not to the route — checking Stats mid-session keeps the screen on
  // …y siempre en la pantalla de Ingreso Físico: es una tablet o notebook de recepción que tiene
  // que quedar prendida (el mismo Wake Lock que Ajustes → "Mantener la pantalla encendida").
  useWakeLock((!!S.active && S.keepAwake !== false) || loc.pathname === CHECKIN_ROUTE)
  useWorkoutPresence(signedIn, S.active?.id)

  // La configuración del backend es la única fuente de verdad para invitados.
  const allowGuest = guestAllowed(config)
  
  // Si no se permiten invitados, estar en modo invitado NO cuenta como estar autenticado
  const authed = !!user || (allowGuest && isGuest)
  // Bloqueo por cuota: pantalla completa, sin TabBar ni RestTimer. Nunca para staff.
  // Cuenta pendiente de aprobación: misma pantalla, otro motivo.
  const blocked = !licenseExpired && (membershipBlocked || accountPending) && !!user && !billingExempt(user)
  // Socios que ya existían sin datos: el formulario, una sola vez, antes de todo lo demás.
  const askProfile = !licenseExpired && !blocked && !!user && !user.admin && !!profilePrompt
  // Una pantalla, una vez: los términos y el aviso (versión vigente sin aceptar) y el consentimiento
  // de datos de salud (cuentas sin respuesta). También staff: también usa la app.
  const askHealth = !licenseExpired && !blocked && !askProfile && !!user && (healthAsk || legalAsk)
  const isAdminPath = loc.pathname === '/admin' || loc.pathname.startsWith('/admin/')
  // El aviso de privacidad y los términos son públicos: se ven sin sesión, con la licencia vencida
  // o bloqueado.
  const isTerms = loc.pathname === '/terminos'
  const isPrivacy = loc.pathname === '/privacidad' || isTerms
  // Pantalla de Ingreso Físico: por su ruta, o siempre que este navegador sea un dispositivo de
  // recepción sin sesión. Va antes que todo lo demás y no depende de ningún usuario.
  const isCheckin = loc.pathname === CHECKIN_ROUTE || (!user && !!getCheckinToken())
  // Primer ingreso (antes del tour y la encuesta, después del formulario de datos): ofrecer
  // notificaciones una vez por dispositivo.
  const [notifShown, setNotifShown] = useState(0)
  const notif = user ? notifStepFor(user.id, { firstEntry: !S.onboardingCompletado }) : null
  const askNotif = !licenseExpired && !blocked && !askProfile && !askHealth && !!notif
  const notifDone = () => {
    if (notif.reoffer) clearIosReoffer(user.id)
    else {
      markNotifStepDone(user.id)
      if (notif.kind === 'ios-install') markIosReoffer(user.id)
    }
    setNotifShown(n => n + 1)
  }
  void notifShown   // re-render al cerrar el paso (la marca vive en localStorage)
  if (!ready) return (
    <div id="app">
      <div style={{ paddingTop: '44vh', display: 'flex', justifyContent: 'center' }}>
        <img src={logoSrc(branding)} alt={branding?.appName || 'lauyim'} style={{ width: 72, height: 72, objectFit: 'contain' }} />
      </div>
    </div>
  )

  return (
    <>
      {/* keyed on the route: a view that throws is contained, and switching tabs
          re-mounts the boundary, so the tab bar is always a way out. Every /admin/* section
          shares one key: switching sections must not re-mount the admin layout (and its poll). */}
      <div id="app" className={'vfade' + (isAdminPath ? ' admin-app' : '') + (isPrivacy ? ' privacy-app' : '') + (isCheckin ? ' checkin-app' : '')} key={isAdminPath ? '/admin' : loc.pathname}>
        {/* Abono de lauyim por vencer o vencido: arriba de todo, solo staff (el servidor no se lo
            manda a los socios), con la app normal. */}
        {authed && !isCheckin && !isPrivacy && !accountEnded && !licenseExpired && !blocked && !askProfile && !askHealth && !askNotif && <LicenseBanner />}
        <ErrorBoundary>
          {isCheckin ? (loc.pathname === CHECKIN_ROUTE
              ? <Suspense fallback={<div className="page-loading" aria-busy="true" />}><IngresoFisicoScreen /></Suspense>
              : <Navigate to={CHECKIN_ROUTE} replace />)
            : isPrivacy ? <Suspense fallback={<div className="page-loading" aria-busy="true" />}>{isTerms ? <Terms /> : <Privacy />}</Suspense>
            : accountEnded ? <AccountEnded />
            : licenseExpired ? <LicenseExpired /> : !authed ? <Login /> : blocked ? <MembershipBlocked />
            : askProfile ? <Suspense fallback={<div className="page-loading" aria-busy="true" />}><ProfileOnce /></Suspense>
            : askHealth ? <Suspense fallback={<div className="page-loading" aria-busy="true" />}><ConsentOnce /></Suspense>
            : askNotif ? <Suspense fallback={<div className="page-loading" aria-busy="true" />}>
              <NotificationsStep kind={notif.kind} onDone={notifDone} /></Suspense> : (
            <Suspense fallback={<div className="page-loading" aria-busy="true" />}> 
            <Routes>
              <Route path="/home" element={<Home />} />
              <Route path="/plan" element={<Plan />} />
              <Route path="/plan/ejercicios" element={<Plan />} />
              <Route path="/plan/clases" element={<Plan />} />
              <Route path="/plan/r/:id" element={<RoutineEdit />} />
              <Route path="/workout" element={<Workout />} />
              <Route path="/stats" element={<Stats />} />
              {/* Sin consentimiento de datos de salud, Nutrición no existe. */}
              <Route path="/nutricion" element={noHealth ? <Navigate to="/home" replace /> : <Nutricion />} />
              <Route path="/history" element={<History />} />
              <Route path="/library" element={<Navigate to="/plan/ejercicios" replace />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/import" element={<ImportPlan />} />
              <Route path="/onboarding/encuesta" element={<SurveyWizard />} />
              {/* The admin sections are routed inside AdminLayout (views/admin/AdminLayout.jsx). */}
              <Route path="/admin/*" element={isStaffUser(user) ? <AdminLayout /> : <Navigate to="/home" replace />} />
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes>
            </Suspense>
          )}
        </ErrorBoundary>
      </div>
      {!isCheckin && !accountEnded && !licenseExpired && !blocked && !askProfile && !askHealth && !askNotif && !isPrivacy && loc.pathname !== '/onboarding/encuesta' && <TabBar onStart={startFlow} />}
      {!isCheckin && !accountEnded && !licenseExpired && !blocked && <RestTimer />}
      {/* Boundary propio: Modals vive fuera de #app, así que un throw acá subía hasta la raíz y
          desmontaba la app entera — pantalla negra sin salida. NO va keyed en la ruta: Modals
          debe sobrevivir a la navegación (re-montarlo volvería a apilar entradas de historial
          por cada sheet abierto). El fallback deja el botón de recarga. */}
      <ErrorBoundary><Modals /></ErrorBoundary>
      <Toast />
      {!isCheckin && !accountEnded && !licenseExpired && !blocked && <ClassAfterPrompt />}
      {!isCheckin && !accountEnded && !licenseExpired && !blocked && <ClosureNotice />}
      <UpdateGate />
    </>
  )
}

export default function App() {
  const boot = useStore(s => s.boot)
  // Al abrir la app (terminado el boot): chequeo de versión y, si hay una esperando, aplicarla.
  useEffect(() => { Promise.resolve(boot()).then(() => getUpdater()?.opened()) }, [boot])
  return <HashRouter><Shell /></HashRouter>
}
