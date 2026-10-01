import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { webauthnOK, passkeyLogin, passkeyRegister, linkOptions, linkPasskey, BIO, api } from '../lib/api.js'
import { formatLinkCodeInput, isCompleteLinkCode } from '../lib/link-code.js'
import { hasData } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { useState, useRef, useEffect } from 'react'
import { useOnline } from '../lib/useOnline.js'
import Icon from '../components/Icon.jsx'
import { Button, useSheetBack } from '../components/ui.jsx'
import { ConsentChecks, usePrivacyStep } from '../components/PrivacyNotice.jsx'
import { ProfileFields, askedFields, profileBody } from '../components/ProfileFields.jsx'
import { NO_AUTOFILL } from '../lib/input-safety.js'
import { errorText, fieldErrors } from '../lib/errors.js'
import { profileErrors } from '../lib/member-rules.js'
import { focusFirstInvalid } from '../lib/focus-error.js'

// Registro (login y Settings). Con la aprobación del staff encendida pide solo el nombre de
// usuario y la cuenta queda pendiente; si no, pide también los datos que configuró el gym y
// aceptar el aviso de privacidad (spec 12.3 / 12.6).
export function RegisterSheet({ close, setOnBack }) {
  const { setUser, pushState, pullState, loadConfig } = useStore()
  const config = useStore(s => s.config)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [qrToken, setQrToken] = useState(null)
  const [qrChecked, setQrChecked] = useState(false)
  const [values, setValues] = useState({})
  const [legalOk, setLegalOk] = useState(false)
  const [healthOk, setHealthOk] = useState(false)
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const inviteOnly = !!config?.invite_only
  const registration = config?.registration
  const fields = registration?.fields || {}
  const needsData = !!registration && !registration.approval && askedFields(fields).length > 0
  const ref = useRef(null)
  const privacy = usePrivacyStep()
  useSheetBack(setOnBack, () => privacy.isOpen ? privacy.close() : close())
  useEffect(() => { /* no autofocus */ }, [])
  // Boot already fetched this; retry here only if that attempt failed, so the invite field still
  // appears on an instance whose config arrived late rather than never.
  useEffect(() => {
    loadConfig()
    const token = new URLSearchParams(window.location.search).get('qr') || ''
    if (!token) { setQrChecked(true); return }
    api('/api/access/qr', { method: 'POST', body: JSON.stringify({ token }) })
      .then(({ valid }) => { setQrToken(valid ? token : null); setQrChecked(true) })
      .catch(() => setQrChecked(true))
  }, [loadConfig])
  const formRef = useRef(null)
  const showErrors = errs => { setErrors(errs); focusFirstInvalid(formRef.current) }
  const go = async () => {
    const n = name.trim()
    // Mismas reglas que el servidor (lib/member-rules.js): todos los campos con error a la vez.
    const local = profileErrors({ ...values, name }, needsData ? fields : {}, { withUsername: true })
    if (Object.keys(local).length) { showErrors(local); return }
    if (inviteOnly && !qrToken && !code.trim()) { useUI.getState().toast(t('An invite code is required')); return }
    setBusy(true); setErrors({})
    try {
      const { pending, ...u } = await passkeyRegister(n, code.trim(), qrToken,
        { legalAccepted: legalOk, healthConsent: healthOk, ...(needsData ? { profile: profileBody(fields, values), privacyAccepted: legalOk } : {}) })
      setUser(u); useStore.getState().setHealthConsent(healthOk ? 'granted' : 'declined'); useStore.getState().setLegalAccepted(); close()
      // Con la aprobación del staff: pantalla de pendiente; los datos locales quedan en el
      // dispositivo y se sincronizan cuando la habiliten.
      if (pending) {
        // Datos de invitado en este dispositivo: se suben a la cuenta cuando la habiliten.
        if (hasData(useStore.getState().S)) localStorage.setItem('gym_push_on_approval', '1')
        window.dispatchEvent(new CustomEvent('gym:account_pending'))
        return
      }
      if (hasData(useStore.getState().S)) { await pushState(); useUI.getState().toast(t('Profile created — data from this device moved into it')) }
      else { await pullState(); useUI.getState().toast(t('Welcome, {0}', u.name)) }
    } catch (e) {
      setBusy(false)
      if (e.name === 'NotAllowedError' || e.name === 'AbortError') return
      const byField = fieldErrors(e)
      if (e?.data?.error === 'dni_exists') showErrors({ dni: e.data.message })
      else if (Object.keys(byField).length) showErrors(byField)
      else useUI.getState().toast(errorText(e, t('Registration failed')))
    }
  }
  // Los términos y el aviso van siempre, con o sin aprobación del staff; los datos de salud son
  // opcionales. Los datos se revisan al tocar el botón (errores en cada campo).
  const incomplete = !legalOk
  return <>
    {privacy.view}
    <div hidden={privacy.isOpen} ref={formRef}>
    <h3>{t('Create your profile')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{registration?.approval
      ? t('Elegí un nombre de usuario y confirmá con {0}. Después, acercate a recepción para que habiliten tu cuenta.', t(BIO))
      : t('Pick a name, then confirm with {0}. The passkey is saved in your device — no password needed.', t(BIO))}</div>
    <input {...NO_AUTOFILL} name="app-profile-name" ref={ref} className="input" placeholder={t('Your name')} aria-label={t('Nombre de usuario')} maxLength={40} value={name}
      aria-invalid={!!errors.username} onChange={e => { setName(e.target.value); setErrors(er => ({ ...er, username: null })) }} />
    {errors.username && <div className="form-error" role="alert" style={{ textAlign: 'left', marginTop: 6 }}>{errors.username}</div>}
    {needsData && <div className="dim small" style={{ margin: '6px 2px 0', textAlign: 'left' }}>{t('Tu nombre de usuario en la app (no tiene que ser tu nombre real).')}</div>}
    {inviteOnly && qrChecked && !qrToken && <>
      <div style={{ height: 10 }} />
      <input {...NO_AUTOFILL} name="app-invite-code" className="input" placeholder={t('Invite code')} maxLength={40} value={code}
        onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
      <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only — enter the code you were given.')}</div>
    </>}
    {needsData && <>
      <div style={{ height: 14 }} />
      <ProfileFields fields={fields} values={values} errors={errors} accept={false} step={privacy}
        onChange={(prop, value) => { setValues(v => ({ ...v, [prop]: value })); setErrors(er => ({ ...er, [prop === 'fullName' ? 'full_name' : prop]: null })) }} />
    </>}
    <div style={{ height: 14 }} />
    <ConsentChecks legal={legalOk} onLegal={setLegalOk} health={healthOk} onHealth={setHealthOk} step={privacy} />
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={busy || incomplete} onClick={go}>{t('Create passkey')}</Button>
    </div>
  </>
}

// "Usar mi cuenta de otro dispositivo": este dispositivo muestra un código y el socio lo aprueba
// desde cualquier otro donde ya tenga sesión (celular, tablet o computadora), en Ajustes →
// "Vincular otro dispositivo". Mientras tanto se pregunta cada 2 s si ya lo aprobó.
const pad2 = n => String(n).padStart(2, '0')
function DevicePairingSheet({ close }) {
  const { setUser, pullState } = useStore()
  const [pairing, setPairing] = useState(null)
  const [error, setError] = useState(null)
  const [expired, setExpired] = useState(false)
  const [attempt, setAttempt] = useState(0)          // "Generar otro código" vuelve a empezar
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    let timer = null
    let active = true
    setPairing(null); setError(null); setExpired(false)
    const start = async () => {
      try {
        const res = await api('/api/auth/device/start', { method: 'POST', body: '{}' })
        if (!active) return
        setPairing(res)
        const poll = async () => {
          try {
            const p = await api(`/api/auth/device/poll?pairingId=${res.pairingId}`)
            if (p.status === 'approved' && p.user) {
              setUser(p.user)
              await pullState()
              useUI.getState().toast(t('Welcome back, {0}', p.user.name))
              close()
              return
            }
          } catch (e) {
            if (e?.data?.status === 'expired' || e?.data?.error === 'expired') { if (active) setExpired(true); return }
            // Sin red o un error pasajero: se reintenta.
          }
          if (active) timer = setTimeout(poll, 2000)
        }
        timer = setTimeout(poll, 2000)
      } catch (e) {
        if (active) setError(errorText(e, t('Error al iniciar vinculación')))
      }
    }
    start()
    return () => { active = false; if (timer) clearTimeout(timer) }
  }, [setUser, pullState, close, attempt])

  // Cuenta regresiva hasta que vence el código.
  useEffect(() => {
    if (!pairing || expired) return
    const iv = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(iv)
  }, [pairing, expired])
  const left = pairing ? Math.max(0, Math.round((pairing.expiresAt - now) / 1000)) : 0
  useEffect(() => { if (pairing && left === 0) setExpired(true) }, [pairing, left])

  const [first, second] = String(pairing?.manualCode || '').split('-')
  return <div className="pairing">
    <h3>{t('Usar tu cuenta de otro dispositivo')}</h3>
    <p className="muted small">{t('En el celular, la tablet o la computadora donde ya usás lauyim:')}</p>
    <ol className="pairing-steps">
      <li>{t('Abrí Ajustes.')}</li>
      <li>{t('Tocá "Vincular otro dispositivo".')}</li>
      <li>{t('Ingresá este código.')}</li>
    </ol>
    <div className={'pairing-code' + (expired ? ' expired' : '')} aria-live="polite">
      {error ? <div className="form-error" role="alert">{error}</div>
        : !pairing ? <div className="muted">{t('Generando código…')}</div>
        : <>
          <div className="pairing-code-v" aria-label={t('Código de vinculación')}>{first}<span className="pairing-dash">-</span>{second}</div>
          {expired
            ? <div className="small muted">{t('El código venció.')}</div>
            : <div className="pairing-wait small muted"><span className="pairing-dot" aria-hidden="true" />{t('Esperando que lo apruebes · vence en {0}:{1}', Math.floor(left / 60), pad2(left % 60))}</div>}
        </>}
    </div>
    {(expired || error) && <Button variant="primary" icon="reset" onClick={() => setAttempt(n => n + 1)}>{t('Generar otro código')}</Button>}
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancelar')}</Button>
  </div>
}

// Opción del login: tarjeta con borde, ícono, título, una línea que explica y chevron.
function LoginOption({ icon, title, subtitle, onClick, primary }) {
  return <button type="button" className={'login-option' + (primary ? ' primary' : '')} onClick={onClick}>
    <span className="login-option-i"><Icon name={icon} /></span>
    <span className="login-option-m">
      <span className="login-option-t">{title}</span>
      <span className="login-option-s">{subtitle}</span>
    </span>
    <Icon name="chevronRight" className="login-option-chev" />
  </button>
}

// Errores del código del gym en palabras del socio. Lo demás (red, verificación) va tal cual.
export function linkErrorMessage(e) {
  if (e?.status === 429) return t('Demasiados intentos, probá en unos minutos.')
  if (e?.data?.error === 'link_invalid') return t('El código no es válido o venció. Pedí uno nuevo en recepción.')
  if (e?.data?.error === 'link_unavailable') return t('Este socio ya tiene acceso. Iniciá sesión.')
  return errorText(e, t('No se pudo vincular. Probá de nuevo.'))
}
const passkeyCancelled = e => e?.name === 'NotAllowedError' || e?.name === 'AbortError'

// Ficha cargada por el gym → passkey del socio. Paso 1: el código (a mano o desde ?link=).
// Paso 2: a quién se vincula, y recién ahí la passkey. Cancelar la passkey vuelve al paso 2
// sin error. Al terminar sigue el boot normal: /api/me (cuota) y los datos del socio.
function LinkSheet({ close, setOnBack, initialCode = '' }) {
  const [code, setCode] = useState(() => formatLinkCodeInput(initialCode))
  const [legalOk, setLegalOk] = useState(false)
  const [healthOk, setHealthOk] = useState(false)
  const privacy = usePrivacyStep()
  useSheetBack(setOnBack, () => privacy.isOpen ? privacy.close() : close())
  const [found, setFound] = useState(null)         // respuesta de /api/link/options
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const check = async () => {
    setBusy(true); setError(null)
    try { setFound(await linkOptions(code)) }
    catch (e) { setError(linkErrorMessage(e)) }
    setBusy(false)
  }
  const confirm = async () => {
    setBusy(true); setError(null)
    try {
      const u = await linkPasskey(found, { legalAccepted: legalOk, healthConsent: healthOk })
      const store = useStore.getState()
      store.setUser(u)
      store.setHealthConsent(healthOk ? 'granted' : 'declined')
      store.setLegalAccepted()
      close()
      useUI.getState().toast(t('Welcome, {0}', u.name))
      // Igual que al abrir la app: estado de cuota (y el cartel si está bloqueado) y sus datos.
      await store.retryMembership().catch(() => store.pullState())
    } catch (e) {
      if (!passkeyCancelled(e)) setError(linkErrorMessage(e))
      setBusy(false)
    }
  }
  if (found) return <>
    {privacy.view}
    <div hidden={privacy.isOpen}>
    <h3>{t('Tu acceso a la app')}</h3>
    <div className="muted" style={{ margin: '4px 0 16px', lineHeight: 1.5 }}>{t('Vas a crear tu acceso como {0}', found.fullName || found.name)}</div>
    <div className="muted small" style={{ marginBottom: 16 }}>{t('Confirmá con {0}. La passkey queda guardada en tu dispositivo, sin contraseña.', t(BIO))}</div>
    <ConsentChecks legal={legalOk} onLegal={setLegalOk} health={healthOk} onHealth={setHealthOk} step={privacy} />
    <div style={{ height: 12 }} />
    {error && <div className="form-error" role="alert" style={{ marginBottom: 10 }}>{error}</div>}
    <Button variant="primary" disabled={busy || !legalOk} onClick={confirm}>{t('Confirmar')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancelar')}</Button>
    </div>
  </>
  return <>
    <h3>{t('Tengo un código del gym')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Ingresá el código que te dieron en recepción para entrar con tus datos del gimnasio.')}</div>
    <input {...NO_AUTOFILL} name="app-link-code" className="input" placeholder="XXXX-XXXX" aria-label={t('Código del gym')}
      autoCapitalize="characters" spellCheck={false} maxLength={9} value={code}
      onChange={e => { setCode(formatLinkCodeInput(e.target.value)); setError(null) }}
      onKeyDown={e => { if (e.key === 'Enter' && isCompleteLinkCode(code) && !busy) check() }}
      style={{ letterSpacing: '.18em', fontWeight: 600, textAlign: 'center', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace' }} />
    {error && <div className="form-error" role="alert">{error}</div>}
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={busy || !isCompleteLinkCode(code)} onClick={check}>{busy ? t('Verificando…') : t('Continuar')}</Button>
    <div style={{ height: 8 }} />
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancelar')}</Button>
  </>
}
const openLinkSheet = code => useUI.getState().openSheet((close, { setOnBack } = {}) => <LinkSheet close={close} setOnBack={setOnBack} initialCode={code} />)

export default function Login() {
  const { setUser, pullState } = useStore()
  const online = useOnline()
  const loginNotice = useStore(s => s.loginNotice)
  // ?link=CODE (fuera del hash, como ?qr=): abre el flujo con el código cargado y lo saca de la
  // URL en el acto, para que no quede en el historial ni se reabra al recargar.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const code = params.get('link')
    if (!code) return
    params.delete('link')
    const qs = params.toString()
    window.history.replaceState(window.history.state, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash)
    openLinkSheet(code)
  }, [])
  const signIn = async () => {
    try {
      const u = await passkeyLogin(); setUser(u)
      useUI.getState().toast(t('Welcome back, {0}', u.name))
      // Como al abrir la app: cuota, cuenta pendiente y formulario de datos, y después sus datos.
      await useStore.getState().retryMembership().catch(() => pullState())
    }
    catch (e) {
      if (e.name === 'NotAllowedError' || e.name === 'AbortError') return
      // Sin respuesta del servidor (fetch tira sin status): no mostrar "Failed to fetch" en inglés.
      useUI.getState().toast(!e.status ? t('Necesitás conexión para el primer ingreso.') : errorText(e, t('SIGN_IN_FAILED_LOGIN')))
    }
  }
  const head = <>
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 32 }}>
      <img src="logo-perf.svg?v=3" alt="lauyim" style={{ width: 96, height: 96, objectFit: 'contain' }} />
    </div>
    <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.028em', margin: '-5px 0 4px' }}>lauyim</h1>
  </>
  // El aviso de passkeys y el link de privacidad quedan fijos al fondo de la pantalla.
  const footer = <div className="login-footer">
    <div className="dim small" style={{ lineHeight: 1.5 }}>{t('Passkeys use {0} — no passwords.', t(BIO))}<br />{t('Each profile keeps its own plan, workouts & body weight.')}</div>
    <div className="dim small privacy-footer"><a className="privacy-link" href="#/terminos">{t('Términos y condiciones')}</a> · <a className="privacy-link" href="#/privacidad">{t('Aviso de privacidad')}</a></div>
  </div>

  return (
    <div className="narrow login-page">
      <div className="login-main">
        {head}
        <div className="muted" style={{ marginBottom: 26 }}>{t('Tus entrenamientos. Tus pesos. Tus perfiles.')}</div>
        {loginNotice === 'relogin' && <div className="card" role="status" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: '14px 16px', textAlign: 'left' }}>
          <div style={{ color: 'var(--yellow)', display: 'flex', flex: '0 0 auto' }}><Icon name="lock" /></div>
          <div className="small" style={{ lineHeight: 1.45 }}>{t('No pudimos verificar tu cuenta con esta sesión. Iniciá sesión de nuevo.')}</div>
        </div>}
        {!online && <div className="card" role="status" style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: '14px 16px', textAlign: 'left' }}>
          <div style={{ color: 'var(--yellow)', display: 'flex', flex: '0 0 auto' }}><Icon name="wifiOff" /></div>
          <div className="small" style={{ lineHeight: 1.45 }}>{t('Necesitás conexión para el primer ingreso.')}</div>
        </div>}
        {webauthnOK() ? <div className="login-options">
          <LoginOption primary icon="key" title={t('Ingresar con passkey')} subtitle={t('Con {0}', t(BIO))} onClick={signIn} />
          <LoginOption icon="link" title={t('Usar mi cuenta de otro dispositivo')} subtitle={t('Te mostramos un código para aprobar desde donde ya usás lauyim.')}
            onClick={() => useUI.getState().openSheet(c => <DevicePairingSheet close={c} />)} />
          <LoginOption icon="sparkles" title={t('Crear nuevo perfil')} subtitle={t('Primera vez en la app.')}
            onClick={() => useUI.getState().openSheet((close, { setOnBack } = {}) => <RegisterSheet close={close} setOnBack={setOnBack} />)} />
          <LoginOption icon="clipboard" title={t('Tengo un código del gym')} subtitle={t('Te lo dio recepción para activar tu ficha.')} onClick={() => openLinkSheet('')} />
        </div> : <div className="card small muted" style={{ textAlign: 'left' }}>
          {t("This browser doesn't support passkeys, and this instance requires an account. Try a browser or device with passkey support.")}
        </div>}
      </div>
      {footer}
    </div>
  )
}
