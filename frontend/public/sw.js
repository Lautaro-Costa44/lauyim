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

let currentName = null

async function releaseCacheName() {
  if (currentName) return currentName
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

function isApiRequest(url) {
  return url.origin === location.origin && url.pathname.startsWith('/api/')
}

function isAssetRequest(request, url) {
  if (url.origin !== location.origin) return false
  if (request.destination && ['script', 'style', 'image', 'font', 'manifest'].includes(request.destination)) return true
  return /\/assets\/|\.(?:js|css|png|jpe?g|gif|svg|webp|woff2?|ico)$/i.test(url.pathname)
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

    currentName = cacheName
    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    // Activation is reached only after install completed atomically. Keep the current release
    // cache and delete every other cache — older releases, the legacy opengym-* names
    // (opengym-release-*, opengym-rt-v4) and anything else this origin left behind.
    currentName = null
    const keep = await releaseCacheName()
    if (keep) {
      const keys = await caches.keys()
      await Promise.all(keys.filter(key => key !== keep).map(key => caches.delete(key)))
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

  // API is deliberately network-only: auth, sync, and server state must never
  // be served from a stale service-worker cache.
  if (isApiRequest(url)) return

  // Aviso de privacidad por su URL pública (/privacidad o /privacidad/): a la ruta hash, también
  // offline. Con /privacidad/ el index.html de respaldo buscaría los assets en /privacidad/assets.
  if (e.request.mode === 'navigate' && /\/privacidad\/?$/.test(url.pathname)) {
    e.respondWith(Response.redirect(new URL('./#/privacidad', self.registration.scope).href, 302))
    return
  }

  if (e.request.mode === 'navigate') {
    // Navigation gets the only HTML fallback, and only the current release's. Responses are
    // never written to a cache here. JS/CSS/image requests can never receive index.html.
    e.respondWith(fetch(e.request).catch(async () => (await fromRelease(NAVIGATION_FALLBACK)) || (await fromRelease('./')) || Response.error()))
    return
  }

  if (isAssetRequest(e.request, url)) {
    e.respondWith(fromRelease(e.request).then(hit => hit || fetch(e.request)))
  }
})
