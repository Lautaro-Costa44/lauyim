import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { errorText } from '../lib/errors.js'
import { passkeyAssertion } from '../lib/api.js'
import { checkinApi, clearCheckinToken, getCheckinToken } from '../lib/checkin-device.js'
import { getUpdater } from '../lib/update.js'
import { StatusBadge } from './admin/billing/common.jsx'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

// Pantalla de Ingreso Físico (recepción): numpad para el DNI, lista si hay varias coincidencias
// y el resultado. Funciona SOLO con el token del dispositivo (lib/checkin-device.js): no lee la
// sesión ni los datos de nadie. Sin conexión no registra nada ni lo encola.
export const RESULT_MS = 5000
const IDLE_UPDATE_MS = 60 * 1000
const MAX_DIGITS = 8

const plural = (n, one, many) => t(n === 1 ? one : many, n)
// Texto de días según el estado, calculado por el servidor en la zona del gym.
function daysText({ status, days }) {
  if (days == null) return status === 'sin_plan' ? t('Todavía no tenés un plan asignado.') : ''
  if (status === 'prueba') return days === 0 ? t('Tu prueba termina hoy.') : plural(days, 'Tu prueba termina en {0} día.', 'Tu prueba termina en {0} días.')
  if (days > 0) return plural(days, 'Tu cuota vence en {0} día.', 'Tu cuota vence en {0} días.')
  if (days === 0) return t('Tu cuota vence hoy.')
  return plural(-days, 'Tu cuota venció hace {0} día.', 'Tu cuota venció hace {0} días.')
}

const MESSAGES = {
  not_found: 'No encontramos ese DNI, consultá en recepción.',
  offline: 'Sin conexión, consultá en recepción.',
  too_many: 'Hay varios socios con esos números. Ingresá más dígitos.',
}

export default function IngresoFisico() {
  const nav = useNavigate()
  const [info, setInfo] = useState(null)            // { name, mode, digits }
  const [ended, setEnded] = useState(!getCheckinToken())
  const [digits, setDigits] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState(null)        // texto bajo el numpad
  const [candidates, setCandidates] = useState(null)
  const [result, setResult] = useState(null)        // respuesta de confirm
  const timer = useRef(null)
  const resultRef = useRef(null)
  resultRef.current = result

  const fail = useCallback(e => {
    if (e?.ended) return setEnded(true)
    if (!e?.status) return setNotice(t(MESSAGES.offline))
    setNotice(errorText(e))
  }, [])
  useEffect(() => {
    if (ended) return
    checkinApi('/api/checkin/info').then(setInfo).catch(fail)
  }, [ended, fail])

  const reset = useCallback(() => {
    clearTimeout(timer.current)
    setResult(null); setCandidates(null); setDigits(''); setNotice(null)
  }, [])
  // El resultado vuelve solo al numpad (o al tocarlo).
  useEffect(() => {
    if (!result) return
    timer.current = setTimeout(reset, RESULT_MS)
    return () => clearTimeout(timer.current)
  }, [result, reset])

  // La pantalla de recepción queda abierta días enteros: nunca pasa por "abrir la app" ni por
  // segundo plano. Cuando nadie la está usando (numpad vacío), busca y aplica actualizaciones.
  const idle = !digits && !result && !candidates && !busy
  const idleRef = useRef(idle)
  idleRef.current = idle
  useEffect(() => {
    const iv = setInterval(async () => {
      if (!idleRef.current) return
      const updater = getUpdater()
      await updater?.check()
      if (idleRef.current) updater?.trySafeApply()
    }, IDLE_UPDATE_MS)
    return () => clearInterval(iv)
  }, [])

  const minDigits = info?.mode === 'last' ? info.digits : 6
  const submitDigits = async () => {
    if (busy || digits.length < minDigits) return setNotice(info?.mode === 'last'
      ? t('Ingresá al menos los últimos {0} dígitos de tu DNI.', minDigits) : t('Ingresá tu DNI completo.'))
    setBusy(true); setNotice(null)
    try {
      const r = await checkinApi('/api/checkin/lookup', { dni: digits })
      if (r.status === 'not_found') { setDigits(''); setNotice(t(MESSAGES.not_found)) }
      else if (r.status === 'too_many') setNotice(t(MESSAGES.too_many))
      else if (r.candidates.length === 1) await choose(r.candidates[0])
      else setCandidates(r.candidates)
    } catch (e) { fail(e) } finally { setBusy(false) }
  }
  const choose = async candidate => {
    setBusy(true)
    try {
      const r = await checkinApi('/api/checkin/confirm', { ticket: candidate.ticket })
      if (r.status === 'not_found') { reset(); setNotice(t(MESSAGES.not_found)) }
      else { setCandidates(null); setResult(r) }
    } catch (e) { setCandidates(null); setDigits(''); fail(e) } finally { setBusy(false) }
  }

  const press = key => {
    if (busy || result || candidates) return
    setNotice(null)
    if (key === 'del') setDigits(d => d.slice(0, -1))
    else if (key === 'ok') submitDigits()
    else setDigits(d => (d.length < MAX_DIGITS ? d + key : d))
  }
  // Teclado físico (notebook): dígitos, Backspace/Delete y Enter.
  const pressRef = useRef(press)
  pressRef.current = press
  useEffect(() => {
    const onKey = e => {
      if (e.target?.closest?.('#modal-root')) return
      // Con el resultado en pantalla, cualquier tecla sigue con el próximo socio; si es un dígito,
      // ya cuenta como el primero de su DNI (sin tener que apretar Enter antes).
      if (resultRef.current) {
        if (e.key.length !== 1 && !['Enter', 'Escape', 'Backspace', 'Delete'].includes(e.key)) return
        e.preventDefault()
        reset()
        if (/^\d$/.test(e.key)) setDigits(e.key)
        return
      }
      if (/^\d$/.test(e.key)) pressRef.current(e.key)
      else if (e.key === 'Backspace' || e.key === 'Delete') pressRef.current('del')
      else if (e.key === 'Enter') { e.preventDefault(); pressRef.current('ok') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reset])

  const exit = () => confirmSheet({
    title: t('¿Salir de Ingreso Físico?'),
    message: t('Hace falta la passkey de un admin. Para volver a usar este dispositivo, un admin tiene que activarlo de nuevo.'),
    confirmText: t('Salir con passkey'),
    onConfirm: async () => {
      try {
        const { cid, options } = await checkinApi('/api/checkin/exit/options')
        const credential = await passkeyAssertion(options)
        await checkinApi('/api/checkin/exit/verify', { cid, credential })
        clearCheckinToken()
        nav('/home', { replace: true })
      } catch (e) {
        if (e?.name === 'NotAllowedError' || e?.name === 'AbortError') return
        if (e?.data?.error === 'forbidden') return setNotice(t('Esa passkey no es de un admin.'))
        fail(e)
      }
    },
  })

  if (ended) return <div className="checkin checkin-ended">
    <div className="checkin-icon"><Icon name="lock" size={32} /></div>
    <h1>{t('Este dispositivo no está activado para Ingreso Físico')}</h1>
    <p className="muted">{t('Pedile a un admin que lo active desde el panel, en la sección Ingreso Físico.')}</p>
    <Button variant="primary" onClick={() => nav('/home', { replace: true })}>{t('Ir al inicio')}</Button>
  </div>

  if (result) {
    const late = result.billing && ['vencido', 'bloqueado'].includes(result.billing.status)
    return <div className="checkin checkin-result" role="status" onClick={reset}>
      <div className={'checkin-icon' + (late ? ' warn' : '')}><Icon name={late ? 'warning' : 'checkCircle'} size={40} /></div>
      <h1 className="checkin-hello">{t('¡Hola, {0}', result.fullName || result.nick)}
        {result.fullName && result.nick && result.nick.trim().toLowerCase() !== result.fullName.trim().toLowerCase() && <span className="checkin-hello-nick"> [{result.nick}]</span>}!</h1>
      <p className="checkin-sub">{result.status === 'already' ? t('Ya registraste tu ingreso hoy.') : t('Tu ingreso quedó registrado.')}</p>
      {result.billing && <div className="checkin-billing">
        <StatusBadge status={result.billing.status} />
        <div>{daysText(result.billing)}</div>
      </div>}
      {late && <p className="checkin-warn">{t('Pasá por recepción.')}</p>}
      <p className="dim small">{t('Tocá la pantalla para seguir.')}</p>
    </div>
  }

  return <div className="checkin">
    <button className="checkin-exit" onClick={exit} aria-label={t('Salir de Ingreso Físico')}><Icon name="signOut" /></button>
    <img src="logo-perf.svg?v=3" alt="" className="checkin-logo" />
    <h1>{t('Ingreso Físico')}</h1>
    {candidates ? <>
      <p className="muted">{t('¿Quién sos?')}</p>
      <div className="list checkin-candidates">
        {candidates.map(c => <button key={c.ticket} className="item" disabled={busy} onClick={() => choose(c)}>
          <div className="grow tt">{c.name}</div><Icon name="chevronRight" className="chev" />
        </button>)}
      </div>
      <Button variant="ghost" onClick={reset}>{t('Ninguno de estos')}</Button>
    </> : <>
      <p className="muted">{info?.mode === 'last' ? t('Ingresá los últimos {0} dígitos de tu DNI', info.digits) : t('Ingresá tu DNI')}</p>
      <div className="checkin-display" aria-live="polite" aria-label={t('DNI')}>{digits || <span className="dim">—</span>}</div>
      <div className="checkin-notice" role="alert">{notice}</div>
      <div className="checkin-pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(k => <button key={k} onClick={() => press(k)} disabled={busy}>{k}</button>)}
        <button className="alt" onClick={() => press('del')} disabled={busy} aria-label={t('Borrar')}><Icon name="chevronLeft" /></button>
        <button onClick={() => press('0')} disabled={busy}>0</button>
        <button className="ok" onClick={() => press('ok')} disabled={busy || !digits} aria-label={t('Confirmar')}><Icon name="check" /></button>
      </div>
    </>}
  </div>
}
