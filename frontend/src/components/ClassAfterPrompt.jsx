// Después de una clase: "¿Fuiste a Spinning?" (con estrellas si fue) y las clases en las que
// estuvo (lista de la profe o ingreso físico) se suman solas al historial. Corre al abrir la app y
// al volver a primer plano, con el módulo de clases prendido.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { errorText } from '../lib/errors.js'
import { classesApi, shortDay } from '../lib/classes.js'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'

const ui = () => useUI.getState()

// Suma el entrenamiento de una clase al historial (una sola vez) y avisa al servidor.
export async function logClassWorkout(bookingId, workout) {
  if (!workout) return
  useStore.getState().update(s => {
    if (!(s.workouts || []).some(w => w.classBookingId === bookingId)) s.workouts.push(workout)
  })
  try { await classesApi.logged(bookingId) } catch { /* se reintenta en la próxima apertura */ }
}

export function Stars({ value, onChange }) {
  return <div className="class-stars" role="radiogroup" aria-label={t('Calificación')}>
    {[1, 2, 3, 4, 5].map(n => <button key={n} type="button" role="radio" aria-checked={value === n} aria-label={t('{0} estrellas', n)}
      className={'class-star' + (value >= n ? ' on' : '')} onClick={() => onChange(n)}><Icon name={value >= n ? 'starFill' : 'star'} /></button>)}
  </div>
}

const when = item => `${shortDay(item.date)} ${item.start}${item.teacherName ? ' · ' + t('con {0}', item.teacherName) : ''}`

function AskDialog({ item, close, done }) {
  const [step, setStep] = useState('ask')
  const [stars, setStars] = useState(0)
  const send = async (attended, rating) => {
    try {
      const r = await classesApi.answer(item.bookingId, attended, rating || undefined)
      if (attended) { await logClassWorkout(item.bookingId, r.workout); ui().toast(t('Sumamos {0} a tu historial', item.name)) }
    } catch (e) { ui().toast(errorText(e, t('No se pudo guardar'))) }
    close(); done()
  }
  return <div className="class-after">
    <span className="class-dot" style={{ background: item.color }} aria-hidden="true" />
    {step === 'ask' ? <>
      <h3>{t('¿Fuiste a {0}?', item.name)}</h3>
      <p className="muted small">{when(item)}</p>
      <div className="class-after-buttons">
        <Button variant="tinted" onClick={() => send(false)}>{t('No fui')}</Button>
        <Button variant="primary" onClick={() => setStep('rate')}>{t('Sí, fui')}</Button>
      </div>
    </> : <>
      <h3>{t('¿Qué te pareció la clase?')}</h3>
      <Stars value={stars} onChange={setStars} />
      <div className="class-after-buttons">
        <Button variant="plain" onClick={() => send(true)}>{t('Saltear')}</Button>
        <Button variant="primary" disabled={!stars} onClick={() => send(true, stars)}>{t('Listo')}</Button>
      </div>
    </>}
  </div>
}

function RateDialog({ item, close, done }) {
  const [stars, setStars] = useState(0)
  const send = async () => {
    try { await classesApi.rate(item.bookingId, stars); ui().toast(t('¡Gracias!')) } catch (e) { ui().toast(errorText(e, t('No se pudo guardar'))) }
    close(); done()
  }
  return <div className="class-after">
    <span className="class-dot" style={{ background: item.color }} aria-hidden="true" />
    <h3>{t('Estuviste en {0}: ¿qué te pareció?', item.name)}</h3>
    <p className="muted small">{when(item)} · {t('ya está en tu historial')}</p>
    <Stars value={stars} onChange={setStars} />
    <div className="class-after-buttons">
      <Button variant="plain" onClick={() => { close(); done() }}>{t('Saltear')}</Button>
      <Button variant="primary" disabled={!stars} onClick={send}>{t('Listo')}</Button>
    </div>
  </div>
}

// Una hoja por vez: primero las preguntas, después las calificaciones.
function showQueue(queue) {
  const next = queue.shift()
  if (!next) return
  const Dialog = next.kind === 'ask' ? AskDialog : RateDialog
  ui().openSheet(close => <Dialog item={next.item} close={close} done={() => showQueue(queue)} />, { kind: 'center' })
}

export async function checkClassesAfter() {
  const { ask, log } = await classesApi.pending()
  for (const item of log) await logClassWorkout(item.bookingId, item.workout)
  const queue = [
    ...ask.map(item => ({ kind: 'ask', item })),
    ...log.filter(item => !item.rated && item.canRate).map(item => ({ kind: 'rate', item }))
  ]
  if (queue.length && !ui().sheets.length) showQueue(queue)
}

export default function ClassAfterPrompt() {
  const on = useStore(s => !!s.config?.classes_enabled && !!s.user)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') setTick(n => n + 1) }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])
  useEffect(() => { if (on) checkClassesAfter().catch(() => {}) }, [on, tick])
  return null
}
