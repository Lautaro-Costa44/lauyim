import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { customAccentVars, shortNameFor, isCustomBrand } from '../lib/branding.js'
import { Button, Segmented } from './ui.jsx'
import Icon from './Icon.jsx'

// Vista previa de la personalización ANTES de guardar (Admin → Personalización): la app instalada
// en Android, iPhone y la PC, el login y la app con el color, en modo oscuro o claro. Son maquetas
// dibujadas con CSS (index.css → .pv-*) con los valores del borrador.
// draft: { appName, shortName, tagline, color }; icons: { 'logo.png', 'icon-maskable-512.png', ... }
const TABS = [
  { value: 'android', label: 'Android' },
  { value: 'iphone', label: 'iPhone' },
  { value: 'pc', label: 'PC' },
  { value: 'login', label: 'Login' },
  { value: 'app', label: 'App' },
]
const FACTORY_COLOR = '#30d158'
const OTHER_APPS = [['#4285f4', 'Fotos'], ['#34a853', 'Maps'], ['#ea4335', 'Gmail'], ['#fbbc05', 'Drive'], ['#5f6368', 'Ajustes'], ['#1da1f2', 'Clima'], ['#e1306c', 'Cámara'], ['#25d366', 'WhatsApp'], ['#ff6d00', 'Música'], ['#7e57c2', 'Notas'], ['#00897b', 'Reloj']]

export default function BrandingPreview({ draft, icons, onClose }) {
  const [tab, setTab] = useState('android')
  // Arranca en el tema elegido en Personalización ("sistema": el del dispositivo).
  const [theme, setTheme] = useState(() => draft.theme === 'light' || (draft.theme === 'system' && window.matchMedia?.('(prefers-color-scheme: light)').matches) ? 'light' : 'dark')
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const brand = { ...draft, appName: draft.appName.trim() || 'lauyim' }
  const accent = customAccentVars(draft.color || FACTORY_COLOR)
  const vars = { '--pv-acc': accent['--acc'], '--pv-acc-2': accent['--acc-2'], '--pv-on-acc': accent['--on-acc'] }
  const props = { brand, icons }
  return <div className="pv-overlay" role="dialog" aria-modal="true" aria-label={t('Vista previa')}>
    <div className="pv-panel">
      <div className="pv-top">
        <h3>{t('Vista previa')}</h3>
        <Button size="sm" variant="ghost" icon="xmark" onClick={onClose}>{t('Cerrar')}</Button>
      </div>
      <Segmented options={TABS} value={tab} onChange={setTab} />
      {(tab === 'login' || tab === 'app') && <div className="pv-theme">
        <Segmented options={[{ value: 'dark', label: t('Oscuro') }, { value: 'light', label: t('Claro') }]} value={theme} onChange={setTheme} />
      </div>}
      <div className={'pv-stage pv-' + theme} style={vars}>
        {tab === 'android' && <AndroidHome {...props} />}
        {tab === 'iphone' && <IphoneHome {...props} />}
        {tab === 'pc' && <Desktop {...props} />}
        {tab === 'login' && <LoginMock {...props} />}
        {tab === 'app' && <AppMock {...props} />}
      </div>
      <p className="small dim pv-foot">{t('Es una simulación: cada celular dibuja los íconos a su manera.')}</p>
    </div>
  </div>
}

function Phone({ kind, children }) {
  return <div className={'pv-phone pv-phone-' + kind}>
    <div className="pv-status"><span>9:41</span><span className="pv-status-r"><i /><i /><i /><b /></span></div>
    {children}
  </div>
}

function HomeGrid({ kind, brand, icons }) {
  const mine = kind === 'android' ? icons['icon-maskable-512.png'] : icons['apple-touch-icon.png']
  const apps = [...OTHER_APPS.slice(0, 6), null, ...OTHER_APPS.slice(6)]
  return <div className="pv-grid">
    {apps.map((app, i) => app
      ? <div key={i} className="pv-app"><span className="pv-icon pv-icon-other" style={{ background: app[0] }}>{app[1][0]}</span><span className="pv-label">{app[1]}</span></div>
      : <div key={i} className="pv-app pv-app-mine"><img className="pv-icon" src={mine} alt="" /><span className="pv-label">{shortNameFor(brand)}</span></div>)}
  </div>
}
const AndroidHome = props => <Phone kind="android"><div className="pv-wall pv-wall-android"><HomeGrid kind="android" {...props} /></div></Phone>
const IphoneHome = props => <Phone kind="iphone"><div className="pv-wall pv-wall-iphone"><HomeGrid kind="iphone" {...props} /></div></Phone>

function Desktop({ brand, icons }) {
  return <div className="pv-desktop">
    <div className="pv-browser">
      <div className="pv-tabs">
        <span className="pv-tab on"><img src={icons['logo.png']} alt="" />{brand.appName}<Icon name="xmark" /></span>
        <span className="pv-tab"><span className="pv-tab-dot" />{t('Nueva pestaña')}</span>
      </div>
      <div className="pv-url"><Icon name="lock" />{window.location.host || 'gym.lauyim.online'}</div>
      <div className="pv-browser-body"><img src={icons['logo.png']} alt="" /><b>{brand.appName}</b></div>
    </div>
    <div className="pv-window">
      <div className="pv-window-bar"><img src={icons['icon-192.png']} alt="" />{brand.appName}<span className="pv-window-btns">— ▢ ✕</span></div>
      <div className="pv-window-body small dim">{t('La app instalada en la computadora')}</div>
    </div>
    <div className="pv-taskbar"><span className="pv-task" /><span className="pv-task" /><img src={icons['icon-192.png']} alt="" /><span className="pv-task" /></div>
  </div>
}

function LoginMock({ brand, icons }) {
  return <Phone kind="screen"><div className="pv-screen pv-login">
    <img className="pv-login-logo" src={icons['logo.png']} alt="" />
    <div className="pv-login-name">{brand.appName}</div>
    <div className="pv-login-tag">{brand.tagline || t('Tus entrenamientos. Tus pesos. Tus perfiles.')}</div>
    <div className="pv-option primary"><span className="pv-option-i"><Icon name="key" /></span><div><b>{t('Ingresar con passkey')}</b><span>{t('Con tu huella o tu cara')}</span></div></div>
    <div className="pv-option"><span className="pv-option-i"><Icon name="sparkles" /></span><div><b>{t('Crear nuevo perfil')}</b><span>{t('Primera vez en la app.')}</span></div></div>
    <div className="pv-option"><span className="pv-option-i"><Icon name="clipboard" /></span><div><b>{t('Tengo un código del gym')}</b><span>{t('Te lo dio recepción.')}</span></div></div>
    <div className="pv-login-foot"><u>{t('Términos y condiciones')}</u> · <u>{t('Aviso de privacidad')}</u>{isCustomBrand(brand) && <div>{t('con lauyim')}</div>}</div>
  </div></Phone>
}

function AppMock({ brand }) {
  return <Phone kind="screen"><div className="pv-screen pv-appview">
    <div className="pv-app-h"><div><b>{t('Hola Ana')}</b><span>{brand.appName}</span></div><span className="pv-round"><Icon name="gear" /></span></div>
    <div className="pv-card">
      <span className="pv-kicker">{t('HOY')}</span>
      <b>{t('Pecho y tríceps')}</b>
      <div className="pv-bar"><i style={{ width: '62%' }} /></div>
      <div className="pv-btn">{t('Empezar entrenamiento')}</div>
    </div>
    <div className="pv-card pv-card-row"><Icon name="flame" /><div><b>{t('racha de 4 semanas')}</b><span>{t('3 esta semana')}</span></div></div>
    <div className="pv-tabbar">
      <span className="on"><Icon name="house" />{t('Inicio')}</span>
      <span><Icon name="calendar" />{t('Plan')}</span>
      <span className="pv-tab-go"><Icon name="dumbbell" /></span>
      <span><Icon name="chart" />{t('Progreso')}</span>
      <span><Icon name="apple" />{t('Nutrición')}</span>
    </div>
  </div></Phone>
}
