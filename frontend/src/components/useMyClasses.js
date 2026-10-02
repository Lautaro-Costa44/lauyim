// Las clases del socio para la semana de Inicio, el calendario y la hoja del día: el listado de
// clases (reservas de la ventana) con una caché corta, para no pedirlo en cada vista.
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { classesApi } from '../lib/classes.js'

const FRESH_MS = 30000
let cache = { at: 0, promise: null }

export function myClassesList({ force = false } = {}) {
  if (force || !cache.promise || Date.now() - cache.at > FRESH_MS) cache = { at: Date.now(), promise: classesApi.list().catch(() => null) }
  return cache.promise
}

// El listado (o null mientras carga, sin clases en el gimnasio o sin conexión).
export function useMyClasses() {
  const on = useStore(s => !!s.config?.classes_available)
  const [data, setData] = useState(null)
  useEffect(() => {
    if (!on) return
    let alive = true
    myClassesList().then(d => { if (alive) setData(d) })
    return () => { alive = false }
  }, [on])
  return on ? data : null
}
