import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
import { lazy, Suspense, useEffect, useLayoutEffect } from 'react'
import { useStore } from './store/useStore.js'
import { useUI } from './store/useUI.js'
import { bindUI } from './components/ui.jsx'
import { ACCENTS } from './lib/format.js'
import { setLang, useLang } from './lib/i18n.js'
import { setNav } from './lib/nav.js'
import { useWakeLock } from './lib/wakelock.js'
import { startFlow } from './sheets.jsx'
import { guestAllowed } from './lib/guest.js'
import Icon from './components/Icon.jsx'
import TabBar from './components/TabBar.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import Modals from './components/Modals.jsx'
import Toast from './components/Toast.jsx'
import RestTimer from './components/RestTimer.jsx'
import Login from './views/Login.jsx'
import Home from './views/Home.jsx'
import Plan from './views/Plan.jsx'
import RoutineEdit from './views/RoutineEdit.jsx'
import Workout from './views/Workout.jsx'
import Stats from './views/Stats.jsx'
import Nutricion from './views/Nutricion.jsx'
import History from './views/History.jsx'
import Settings from './views/Settings.jsx'
import LicenseExpired from './views/LicenseExpired.jsx'
// These routes are not needed to boot or navigate the main workout loop.
// Keep their larger catalogues out of the initial offline payload.
const Library = lazy(() => import('./views/Library.jsx'))
const Admin = lazy(() => import('./views/Admin.jsx'))
const SurveyWizard = lazy(() => import('./views/SurveyWizard.jsx'))
const ImportPlan = lazy(() => import('./views/ImportPlan.jsx'))

bindUI(useUI)   // lets the shared controls open sheets without importing the store at module scope

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

function disableKeyboardAutofill(root) {
  root.querySelectorAll('input:not([type="file"]), textarea').forEach(field => {
    field.setAttribute('autocomplete', 'new-password')
    field.setAttribute('autocorrect', 'off')
    field.setAttribute('autocapitalize', 'none')
    field.setAttribute('spellcheck', 'false')
    field.setAttribute('data-lpignore', 'true')
    field.setAttribute('data-1p-ignore', 'true')
    field.setAttribute('data-bwignore', 'true')
    field.setAttribute('data-form-type', 'other')
  })
}

function Shell() {
  const navigate = useNavigate()
  const loc = useLocation()
  const { S, user, ready } = useStore()
  const config = useStore(s => s.config)
  const licenseExpired = useStore(s => s.licenseExpired)
  const isGuest = useStore(s => s.isGuest())
  const langV = useLang()   // re-renders the whole shell when the language (pack) changes
  useLayoutEffect(() => {
    disableKeyboardAutofill(document)
    const observer = new MutationObserver(() => disableKeyboardAutofill(document))
    observer.observe(document.body, { childList: true, subtree: true })
    return () => observer.disconnect()
  }, [])
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
          re-mounts the boundary, so the tab bar is always a way out */}
      <div id="app" className="vfade" key={loc.pathname}>
        <ErrorBoundary>
          {licenseExpired ? <LicenseExpired /> : !authed ? <Login /> : (
            <Suspense fallback={<div className="page-loading" aria-busy="true" />}> 
            <Routes>
              <Route path="/home" element={<Home />} />
              <Route path="/plan" element={<Plan />} />
              <Route path="/plan/r/:id" element={<RoutineEdit />} />
              <Route path="/workout" element={<Workout />} />
              <Route path="/stats" element={<Stats />} />
              <Route path="/nutricion" element={<Nutricion />} />
              <Route path="/history" element={<History />} />
              <Route path="/library" element={<Library />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/import" element={<ImportPlan />} />
              <Route path="/onboarding/encuesta" element={<SurveyWizard />} />
              <Route path="/admin" element={user?.admin ? <Admin /> : <Navigate to="/home" replace />} />
              <Route path="*" element={<Navigate to="/home" replace />} />
            </Routes>
            </Suspense>
          )}
        </ErrorBoundary>
      </div>
      {!licenseExpired && loc.pathname !== '/onboarding/encuesta' && <TabBar onStart={startFlow} />}
      {!licenseExpired && <RestTimer />}
      <Modals />
      <Toast />
    </>
  )
}

export default function App() {
  const boot = useStore(s => s.boot)
  useEffect(() => { boot() }, [boot])
  return <HashRouter><Shell /></HashRouter>
}
