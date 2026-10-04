// Las clases del socio para la semana de Inicio, el calendario y la hoja del día: el listado de
// clases (reservas de la ventana), compartido entre vistas. Se guarda en el dispositivo para que la
// semana muestre las clases apenas abre (sin esperar la red) y se refresca solo: cada vista que
// recarga el listado (Inicio, Plan → Clases) avisa a las demás.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { classesApi } from '../lib/classes.js'

const FRESH_MS = 30000
const KEY = 'lauyim_my_classes'
const EVENT = 'lauyim:my-classes'
let cache = { at: 0, promise: null }

const userId = () => useStore.getState().user?.id || null
function readSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null')
    return saved && saved.userId === userId() ? saved.data : null
  } catch { return null }
}
function save(data) {
  try { localStorage.setItem(KEY, JSON.stringify({ userId: userId(), data })) } catch { /* sin storage */ }
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(EVENT, { detail: data }))
}

// El listado de clases (desde hoy). force: pedirlo de nuevo aunque haya uno reciente.
export function myClassesList({ force = false } = {}) {
  if (force || !cache.promise || Date.now() - cache.at > FRESH_MS) {
    cache = { at: Date.now(), promise: classesApi.list().then(d => { if (d) save(d); return d }).catch(() => null) }
  }
  return cache.promise
}

// Una vista que acaba de cargar el listado lo comparte con las demás (semana, calendario).
export function shareMyClasses(data) {
  if (!data) return
  cache = { at: Date.now(), promise: Promise.resolve(data) }
  save(data)
}

// El listado (el guardado mientras llega el nuevo; null sin clases en el gimnasio).
export function useMyClasses() {
  const on = useStore(s => !!s.config?.classes_available)
  const [data, setData] = useState(readSaved)
  useEffect(() => {
    if (!on) return
    let alive = true
    const onFresh = e => { if (alive && e.detail) setData(e.detail) }
    window.addEventListener(EVENT, onFresh)
    myClassesList().then(d => { if (alive && d) setData(d) })
    return () => { alive = false; window.removeEventListener(EVENT, onFresh) }
  }, [on])
  return on ? data : null
}
