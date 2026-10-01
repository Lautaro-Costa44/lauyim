/* lauyim service worker — release-atomic precache with separate navigation,
   asset, and API strategies. The release is supplied by Vite's precache manifest.
   There is NO runtime cache: every cached byte belongs to one release, so navigation and its
   chunks always come from the same build. */
const CACHE_PREFIX = 'lauyim-release-'
const PRECACHE_MANIFEST = './precache.json'
const NAVIGATION_FALLBACK = './index.html'
// Written last into each release cache: says which cache is the newest confirmed one, so a
// restarted worker (module state lost) still finds it without the network.
const RELEASE_MARKER = './__release'

// Exercise images/GIFs: immutable files the app mounts at /img and /gif. They are not part of a
// release, so they live in their own cache, cache-first, and survive release changes. Capped so a
// long-lived install cannot grow without bound.
const MEDIA_CACHE = 'lauyim-media-v1'
// Logo e íconos del gym (Personalización): con ?v= no cambian nunca, así que se guardan para que el
// login y la pantalla de carga los muestren también sin conexión.
const BRANDING_CACHE = 'lauyim-branding-v1'
const MEDIA_MAX_ENTRIES = 400

let currentName = null

// The build appends `self.SW_RELEASE = '<release>'` to this file (vite.config.js), so every worker
// knows which release it belongs to without the network: a waiting worker never serves, and an
// older active one keeps serving its own release until the page reloads. Without it (dev server,
// tests) the newest confirmed cache is used.
const ownCacheName = () => self.SW_RELEASE ? CACHE_PREFIX + self.SW_RELEASE : null

async function releaseCacheName() {
  if (currentName) return currentName
  const own = ownCacheName()
  if (own && (await caches.keys()).includes(own)) return (currentName = own)
  const keys = (await caches.keys()).filter(key => key.startsWith(CACHE_PREFIX))
  let best = null, bestAt = -1
  for (const key of keys) {
    const hit = await (await caches.open(key)).match(RELEASE_MARKER)
    const at = hit ? Number((await hit.json()).installedAt) || 0 : 0
    if (at > bestAt) { best = key; bestAt = at }
  }
  return (currentName = best)
}

// Only the current release cache is ever consulted: caches.match() without a cacheName would
// search every cache, in creation order, and serve an older release first.
async function fromRelease(request) {
  const name = await releaseCacheName()
  if (!name) return undefined
  return (await caches.open(name)).match(request, { ignoreSearch: true })
}

// Hashed assets only (never navigations): after an update the page that is still open runs the
// previous release until it reloads, and its lazy chunks live in the previous release cache,
// which activate keeps for exactly that. Names carry a content hash, so no file can be confused
// with another release's.
async function fromAnyRelease(request) {
  const hit = await fromRelease(request)
  if (hit) return hit
  const own = await releaseCacheName()
  for (const key of (await caches.keys()).filter(k => k.startsWith(CACHE_PREFIX) && k !== own)) {
    const other = await (await caches.open(key)).match(request, { ignoreSearch: true })
    if (other) return other
  }
  return undefined
}

async function installedAt(key) {
  const hit = await (await caches.open(key)).match(RELEASE_MARKER)
  return hit ? Number((await hit.json()).installedAt) || 0 : 0
}

function isMediaRequest(url) {
  return url.origin === location.origin && /^\/(?:img|gif)\//.test(url.pathname)
}

async function fromMedia(request) {
  const cache = await caches.open(MEDIA_CACHE)
  const hit = await cache.match(request)
  if (hit) return hit
  const response = await fetch(request)
  if (response.ok && response.status === 200) {
    await cache.put(request, response.clone())
    const keys = await cache.keys()
    // Oldest first (insertion order).
    for (const key of keys.slice(0, Math.max(0, keys.length - MEDIA_MAX_ENTRIES))) await cache.delete(key)
  }
  return response
}

function isApiRequest(url) {
  return url.origin === location.origin && url.pathname.startsWith('/api/')
}

function isAssetRequest(request, url) {
  if (url.origin !== location.origin) return false
  if (request.destination && ['script', 'style', 'image', 'font', 'manifest'].includes(request.destination)) return true
  // precache.json también: Ajustes lee de ahí el hash de la build que corre, con o sin red.
  return /\/assets\/|\.(?:js|css|png|jpe?g|gif|svg|webp|woff2?|ico)$|\/precache\.json$/i.test(url.pathname)
}

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    // Build the new cache under a release-specific name. Nothing in the current
    // release cache is touched until every new resource has been fetched.
    const manifestResponse = await fetch(PRECACHE_MANIFEST, { cache: 'no-store' })
    if (!manifestResponse.ok) throw new Error(`precache manifest: ${manifestResponse.status}`)
    const manifest = await manifestResponse.json()
    if (!manifest || !manifest.release || !Array.isArray(manifest.files)) {
      throw new Error('invalid precache manifest')
    }

    // The server already has a newer build than this worker: fail, the browser retries with it.
    if (self.SW_RELEASE && manifest.release !== self.SW_RELEASE) throw new Error(`precache manifest is ${manifest.release}, worker is ${self.SW_RELEASE}`)
    const cacheName = CACHE_PREFIX + manifest.release
    const cache = await caches.open(cacheName)
    const files = [
      PRECACHE_MANIFEST,
      './',
      NAVIGATION_FALLBACK,
      './logo-perf.svg',
      './icon-512.png',
      './icon-180.png',
      ...manifest.files.map(file => './' + file).filter(file => file !== './sw.js')
    ]

    try {
      await cache.addAll([...new Set(files)])
      await cache.put(RELEASE_MARKER, new Response(JSON.stringify({ installedAt: Date.now() })))
    } catch (error) {
      // addAll may have populated part of the cache before failing. Remove only
      // this unconfirmed release; the previous confirmed cache remains intact.
      await caches.delete(cacheName)
      throw error
    }

    // No skipWaiting here: the new worker waits until the page says it is a safe moment
    // (lib/update.js → postMessage SKIP_WAITING), so a workout or an unsynced change is never cut.
  })())
})

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Activation is reached only after install completed atomically. Keep the current release
    // cache and delete every other cache — older releases, the legacy opengym-* names
    // (opengym-release-*, opengym-rt-v4) and anything else this origin left behind, except the media cache.
    // Also keeps the previous release: the page still open on it reloads right after this, but
    // until then its lazy chunks come from there (fromAnyRelease). It goes on the next activate.
    currentName = null
    const keep = await releaseCacheName()
    if (keep) {
      const keys = await caches.keys()
      const others = keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== keep)
      let previous = null, previousAt = -1
      for (const key of others) { const at = await installedAt(key); if (at > previousAt) { previous = key; previousAt = at } }
      await Promise.all(keys.filter(key => key !== keep && key !== previous && key !== MEDIA_CACHE && key !== BRANDING_CACHE).map(key => caches.delete(key)))
    }
    await self.clients.claim()
  })())
})
self.addEventListener('push', e => {
  const data = e.data ? e.data.json() : {}
  e.waitUntil(self.registration.showNotification(data.title || 'lauyim', {
    body: data.body || '',
    // Notifications are more consistently rendered from PNGs on Android.
    icon: 'icon-512.png?v=3',
    badge: 'icon-180.png?v=3',
    tag: data.tag || 'lauyim',
    renotify: true,
    data: data.data || {}
  }))
})
self.addEventListener('notificationclick', e => {
  e.notification.close()
  const redirectUrl = e.notification.data && e.notification.data.redirectUrl
  e.waitUntil(
    redirectUrl
      ? self.clients.openWindow(redirectUrl)
      : self.clients.matchAll({ type: 'window' }).then(clients => {
          const c = clients.find(c => 'focus' in c)
          return c ? c.focus() : self.clients.openWindow('./')
        })
  )
})

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== location.origin) return

  // Los íconos versionados del gym: del caché, o de la red y se guardan (el último logo).
  if (url.pathname.startsWith('/api/branding/') && url.searchParams.has('v') && url.pathname.endsWith('.png')) {
    e.respondWith(caches.open(BRANDING_CACHE).then(async cache => {
      const hit = await cache.match(e.request)
      if (hit) return hit
      const response = await fetch(e.request)
      if (response.ok && response.status === 200) {
        for (const old of await cache.keys()) if (new URL(old.url).pathname === url.pathname) await cache.delete(old)
        await cache.put(e.request, response.clone())
      }
      return response
    }))
    return
  }

  // API is deliberately network-only: auth, sync, and server state must never
  // be served from a stale service-worker cache.
  if (isApiRequest(url)) return

  // Aviso de privacidad y términos por su URL pública (/privacidad, /terminos, con o sin barra):
  // a la ruta hash, también offline. Con /privacidad/ el index.html de respaldo buscaría los
  // assets en /privacidad/assets.
  const legalPath = e.request.mode === 'navigate' && url.pathname.match(/\/(privacidad|terminos)\/?$/)
  if (legalPath) {
    e.respondWith(Response.redirect(new URL('./#/' + legalPath[1], self.registration.scope).href, 302))
    return
  }

  if (e.request.mode === 'navigate') {
    // Navigation gets the only HTML fallback, and only the current release's. Responses are
    // never written to a cache here. JS/CSS/image requests can never receive index.html.
    e.respondWith(fetch(e.request).catch(async () => (await fromRelease(NAVIGATION_FALLBACK)) || (await fromRelease('./')) || Response.error()))
    return
  }

  if (isMediaRequest(url)) {
    e.respondWith(fromMedia(e.request))
    return
  }

  if (isAssetRequest(e.request, url)) {
    e.respondWith(fromAnyRelease(e.request).then(hit => hit || fetch(e.request)))
  }
})
