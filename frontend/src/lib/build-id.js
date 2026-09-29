import { useEffect, useState } from 'react'

// Hash corto de la build que corre (el release de precache.json: "<versión>-<hash>"), para que
// un socio pueda decir exactamente qué tiene al reportar un problema. precache.json sale del
// cache del release (public/sw.js), así que también se ve sin conexión.
export function buildIdFrom(manifest) {
  const release = typeof manifest?.release === 'string' ? manifest.release : ''
  const m = /-([0-9a-f]{6,})$/.exec(release)
  return m ? m[1].slice(0, 7) : null
}

export function useBuildId() {
  const [id, setId] = useState(null)
  useEffect(() => {
    let alive = true
    fetch('./precache.json').then(r => r.ok ? r.json() : null).then(m => { if (alive) setId(buildIdFrom(m)) }).catch(() => {})
    return () => { alive = false }
  }, [])
  return id
}
