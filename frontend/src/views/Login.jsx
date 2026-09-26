import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { webauthnOK, passkeyLogin, passkeyRegister, linkOptions, linkPasskey, BIO, api } from '../lib/api.js'
import { formatLinkCodeInput, isCompleteLinkCode } from '../lib/link-code.js'
import { hasData } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import { useState, useRef, useEffect } from 'react'
import { Button, useSheetBack } from '../components/ui.jsx'
import { ConsentCheck, usePrivacyStep } from '../components/PrivacyNotice.jsx'
import { ProfileFields, askedFields, missingRequired, profileBody } from '../components/ProfileFields.jsx'
import { NO_AUTOFILL } from '../lib/input-safety.js'

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
  const [accepted, setAccepted] = useState(false)
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
  const go = async () => {
    const n = name.trim()
    if (!n) { useUI.getState().toast(t('Enter a name')); return }
    if (inviteOnly && !qrToken && !code.trim()) { useUI.getState().toast(t('An invite code is required')); return }
    setBusy(true); setErrors({})
    try {
      const { pending, ...u } = await passkeyRegister(n, code.trim(), qrToken,
        { healthConsent: accepted, ...(needsData ? { profile: profileBody(fields, values), privacyAccepted: accepted } : {}) })
      setUser(u); useStore.getState().setHealthConsent('granted'); close()
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
      if (e?.data?.error === 'dni_exists') setErrors({ dni: e.data.message })
      else if (e?.data?.field) setErrors({ [e.data.field]: e.message })
      else useUI.getState().toast(e?.data?.message || e.message || t('Registration failed'))
    }
  }
  // El check (aviso + datos de salud) va siempre, con o sin aprobación del staff.
  const incomplete = !accepted || (needsData && missingRequired(fields, values).length > 0)
  return <>
    {privacy.view}
    <div hidden={privacy.isOpen}>
    <h3>{t('Create your profile')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{registration?.approval
      ? t('Elegí un nombre de usuario y confirmá con {0}. Después, acercate a recepción para que habiliten tu cuenta.', t(BIO))
      : t('Pick a name, then confirm with {0}. The passkey is saved in your device — no password needed.', t(BIO))}</div>
    <input {...NO_AUTOFILL} name="app-profile-name" ref={ref} className="input" placeholder={t('Your name')} aria-label={t('Nombre de usuario')} maxLength={40} value={name} onChange={e => setName(e.target.value)} />
    {needsData && <div className="dim small" style={{ margin: '6px 2px 0', textAlign: 'left' }}>{t('Tu nombre de usuario en la app (no tiene que ser tu nombre real).')}</div>}
    {inviteOnly && qrChecked && !qrToken && <>
      <div style={{ height: 10 }} />
      <input {...NO_AUTOFILL} name="app-invite-code" className="input" placeholder={t('Invite code')} maxLength={40} value={code}
        onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
      <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only — enter the code you were given.')}</div>
    </>}
    {needsData && <>
      <div style={{ height: 14 }} />
      <ProfileFields fields={fields} values={values} errors={errors} accept={false} onPrivacy={privacy.open}
        onChange={(prop, value) => { setValues(v => ({ ...v, [prop]: value })); setErrors(er => ({ ...er, [prop === 'fullName' ? 'full_name' : prop]: null })) }} />
    </>}
    <div style={{ height: 14 }} />
    <ConsentCheck checked={accepted} onChange={setAccepted} onPrivacy={privacy.open} />
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={busy || incomplete} onClick={go}>{t('Create passkey')}</Button>
    </div>
  </>
}

function DevicePairingSheet({ close }) {
  const { setUser, pullState } = useStore()
  const [pairing, setPairing] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let timer = null
    let active = true

    const start = async () => {
      try {
        const res = await api('/api/auth/device/start', { method: 'POST', body: '{}' })
        if (!active) return
        setPairing(res)
        setLoading(false)

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
            if (p.status === 'expired') {
              setError(t('El código ha expirado. Reintenta.'))
              return
            }
          } catch (e) { /* retry */ }
          if (active) timer = setTimeout(poll, 2000)
        }
        timer = setTimeout(poll, 2000)
      } catch (e) {
        if (active) { setError(e.message || t('Error al iniciar vinculación')); setLoading(false); }
      }
    }
    start()

    return () => {
      active = false
      if (timer) clearTimeout(timer)
    }
  }, [setUser, pullState, close])

  return <>
    <h3>{t('Iniciar sesión desde el celu')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>
      {t('Abrí la app en tu celular donde tengas sesión iniciada e ingresá este código en Configuración → Vincular dispositivo.')}
    </div>
    {loading && <div className="muted" style={{ padding: 20 }}>{t('Generando código...')}</div>}
    {error && <div style={{ color: 'var(--red)', margin: '10px 0' }}>{error}</div>}
    {pairing && !error && <>
      <div className="card" style={{ textAlign: 'center', background: 'var(--surface-2)', padding: 20, margin: '14px 0' }}>
        <div style={{ fontSize: 13, color: 'var(--label-2)', marginBottom: 6 }}>{t('Código de vinculación')}</div>
        <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: '.18em', color: 'var(--acc)', fontFamily: 'monospace' }}>
          {pairing.manualCode}
        </div>
        <div className="small muted" style={{ marginTop: 8 }}>
          {t('Expira en 5 minutos · Esperando aprobación...')}
        </div>
      </div>
    </>}
    <Button variant="ghost" className="dim" onClick={close}>{t('Cancelar')}</Button>
  </>
}

// Errores del código del gym en palabras del socio. Lo demás (red, verificación) va tal cual.
export function linkErrorMessage(e) {
  if (e?.status === 429) return t('Demasiados intentos, probá en unos minutos.')
  if (e?.data?.error === 'link_invalid') return t('El código no es válido o venció. Pedí uno nuevo en recepción.')
  if (e?.data?.error === 'link_unavailable') return t('Este socio ya tiene acceso. Iniciá sesión.')
  return e?.message || t('No se pudo vincular. Probá de nuevo.')
}
const passkeyCancelled = e => e?.name === 'NotAllowedError' || e?.name === 'AbortError'

// Ficha cargada por el gym → passkey del socio. Paso 1: el código (a mano o desde ?link=).
// Paso 2: a quién se vincula, y recién ahí la passkey. Cancelar la passkey vuelve al paso 2
// sin error. Al terminar sigue el boot normal: /api/me (cuota) y los datos del socio.
function LinkSheet({ close, setOnBack, initialCode = '' }) {
  const [code, setCode] = useState(() => formatLinkCodeInput(initialCode))
  const [accepted, setAccepted] = useState(false)
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
      const u = await linkPasskey(found, { healthConsent: accepted })
      const store = useStore.getState()
      store.setUser(u)
      store.setHealthConsent('granted')
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
    <ConsentCheck checked={accepted} onChange={setAccepted} onPrivacy={privacy.open} />
    <div style={{ height: 12 }} />
    {error && <div className="form-error" role="alert" style={{ marginBottom: 10 }}>{error}</div>}
    <Button variant="primary" disabled={busy || !accepted} onClick={confirm}>{t('Confirmar')}</Button>
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
  const { setUser, pullState, setGuest } = useStore()
  // ?link=CODE (fuera del hash, como ?qr=): abre el flujo con el código cargado y lo saca de la
  // URL en el acto, para que no quede en el historial ni se reabra al recargar.
  useEffect(() => {
    if (DEMO) return
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
    catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(e.message || t('SIGN_IN_FAILED_LOGIN')) }
  }
  const head = <>
    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 32 }}>
      <img src="logo-perf.svg?v=3" alt="lauyim" style={{ width: 96, height: 96, objectFit: 'contain' }} />
    </div>
    <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: '-.028em', margin: '-5px 0 4px' }}>lauyim</h1>
  </>
  const wrap = { display: 'flex', flexDirection: 'column', justifyContent: 'center', minHeight: '78vh', textAlign: 'center' }

  // Demo build: no backend to sign in against — the only way in is the local guest profile.
  if (DEMO) return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 30 }}>{t('Live demo — everything stays in this browser.')}</div>
      <Button variant="primary" icon="sparkles" onClick={() => setGuest(true)}>{t('Start the demo')}</Button>
      <div className="card small muted" style={{ textAlign: 'left', marginTop: 16 }}>
        {t('This demo runs entirely in your browser on example data — nothing is sent anywhere. Passkey sign-in and sync across your devices come with the lauyim server, which you get by self-hosting it.')}
      </div>
      <div className="dim small" style={{ marginTop: 22, lineHeight: 1.6 }}>
        <a href={REPO} target="_blank" rel="noopener">{t('Self-host it in a minute →')}</a>
      </div>
    </div>
  )

  return (
    <div className="narrow" style={wrap}>
      {head}
      <div className="muted" style={{ marginBottom: 34 }}>{t('Tus entrenamientos. Tus pesos. Tus perfiles.')}</div>
      {webauthnOK() ? <>
        <Button variant="primary" icon="person" onClick={signIn}>{t('Ingresar con passkey')}</Button>
        <div style={{ height: 10 }} />
        <Button variant="tinted" icon="phone" onClick={() => useUI.getState().openSheet(c => <DevicePairingSheet close={c} />)}>{t('Continuar con codigo de sincronizacion')}</Button>
        <div style={{ height: 10 }} />
        <Button icon="sparkles" onClick={() => useUI.getState().openSheet((close, { setOnBack } = {}) => <RegisterSheet close={close} setOnBack={setOnBack} />)}>{t('Crear nuevo perfil')}</Button>
        <div style={{ height: 6 }} />
        <Button variant="ghost" onClick={() => openLinkSheet('')}>{t('Tengo un código del gym')}</Button>
      </> :<div className="card small muted" style={{ textAlign: 'left' }}>
        {t("This browser doesn't support passkeys, and this instance requires an account. Try a browser or device with passkey support.")}
      </div>}
      <div className="dim small" style={{ marginTop: 26, lineHeight: 1.5 }}>{t('Passkeys use {0} — no passwords.', t(BIO))}<br />{t('Each profile keeps its own plan, workouts & body weight.')}</div>
      <div className="dim small privacy-footer"><a className="privacy-link" href="#/privacidad">{t('Aviso de privacidad')}</a></div>
    </div>
  )
}
