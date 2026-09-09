import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { webauthnOK, passkeyLogin, passkeyRegister, BIO, api } from '../lib/api.js'
import { hasData } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { DEMO, REPO } from '../lib/demo.js'
import { useState, useRef, useEffect } from 'react'
import { Button } from '../components/ui.jsx'
import { NO_AUTOFILL } from '../lib/input-safety.js'

function RegisterSheet({ close }) {
  const { setUser, pushState, pullState, loadConfig } = useStore()
  const config = useStore(s => s.config)
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const inviteOnly = !!config?.invite_only
  const ref = useRef(null)
  useEffect(() => { /* no autofocus */ }, [])
  // Boot already fetched this; retry here only if that attempt failed, so the invite field still
  // appears on an instance whose config arrived late rather than never.
  useEffect(() => { loadConfig() }, [loadConfig])
  const go = async () => {
    const n = name.trim()
    if (!n) { useUI.getState().toast(t('Enter a name')); return }
    if (inviteOnly && !code.trim()) { useUI.getState().toast(t('An invite code is required')); return }
    try {
      const u = await passkeyRegister(n, code.trim())
      setUser(u); close()
      if (hasData(useStore.getState().S)) { await pushState(); useUI.getState().toast(t('Profile created — data from this device moved into it')) }
      else { await pullState(); useUI.getState().toast(t('Welcome, {0}', u.name)) }
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(e.message || t('Registration failed')) }
  }
  return <>
    <h3>{t('Create your profile')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name, then confirm with {0}. The passkey is saved in your device — no password needed.', BIO)}</div>
    <input {...NO_AUTOFILL} name="app-profile-name" ref={ref} className="input" placeholder={t('Your name')} maxLength={40} value={name} onChange={e => setName(e.target.value)} />
    {inviteOnly && <>
      <div style={{ height: 10 }} />
      <input {...NO_AUTOFILL} name="app-invite-code" className="input" placeholder={t('Invite code')} maxLength={40} value={code}
        onChange={e => setCode(e.target.value.toUpperCase())} style={{ letterSpacing: '.14em', fontWeight: 600, textAlign: 'center' }} />
      <div className="dim small" style={{ marginTop: 6 }}>{t('This app is invite-only — enter the code you were given.')}</div>
    </>}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={go}>{t('Create passkey')}</Button>
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

export default function Login() {
  const { setUser, pullState, setGuest } = useStore()
  const signIn = async () => {
    try { const u = await passkeyLogin(); setUser(u); await pullState(); useUI.getState().toast(t('Welcome back, {0}', u.name)) }
    catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') useUI.getState().toast(e.message || t('Sign-in failed')) }
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
        <Button icon="sparkles" onClick={() => useUI.getState().openSheet(close => <RegisterSheet close={close} />)}>{t('Crear nuevo perfil')}</Button>
      </> : <div className="card small muted" style={{ textAlign: 'left' }}>
        {t("This browser doesn't support passkeys, and this instance requires an account. Try a browser or device with passkey support.")}
      </div>}
      <div className="dim small" style={{ marginTop: 26, lineHeight: 1.5 }}>{t('Passkeys use {0} — no passwords.', BIO)}<br />{t('Each profile keeps its own plan, workouts & body weight.')}</div>
    </div>
  )
}
