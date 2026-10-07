// Whether this connection can afford media nobody asked for yet. Offline, data saver or a slow
// mobile link: no. Browsers without the Network Information API (iOS Safari) are assumed fine,
// since the alternative is never prefetching on any iPhone.
export function canPrefetch(nav = globalThis.navigator) {
  if (!nav) return false
  if (nav.onLine === false) return false
  const c = nav.connection
  if (!c) return true
  if (c.saveData) return false
  return !['slow-2g', '2g', '3g'].includes(c.effectiveType)
}

// Warms the HTTP / service-worker cache (MEDIA_CACHE in sw.js) without putting anything on screen.
// Each URL once per page load.
const fetched = new Set()
export function prefetchImages(urls) {
  if (typeof Image === 'undefined') return
  for (const url of urls) {
    if (fetched.has(url)) continue
    fetched.add(url)
    const img = new Image()
    img.decoding = 'async'
    img.src = url
  }
}

export const whenIdle = fn => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 3000 }) : setTimeout(fn, 300))
