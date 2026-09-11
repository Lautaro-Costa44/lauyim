/* lauyim service worker — release-atomic precache with separate navigation,
   asset, and API strategies. The release is supplied by Vite's precache manifest. */
const CACHE_PREFIX = 'opengym-release-'
const PRECACHE_MANIFEST = './precache.json'
const NAVIGATION_FALLBACK = './index.html'

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
      './logo-perf.svg',
      './icon-512.png',
      './icon-180.png',
      ...manifest.files.map(file => './' + file).filter(file => file !== './sw.js')
    ]

    try {
      await cache.addAll([...new Set(files)])
    } catch (error) {
      // addAll may have populated part of the cache before failing. Remove only
      // this unconfirmed release; the previous confirmed cache remains intact.
      await caches.delete(cacheName)
      throw error
    }

    await self.skipWaiting()
  })())
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    const confirmedReleases = keys.filter(key => key.startsWith(CACHE_PREFIX))
    // Activation is reached only after install completed atomically, so it is
    // safe to retire older releases now while preserving the confirmed new one.
    const keep = confirmedReleases.sort().at(-1)
    await Promise.all(confirmedReleases.filter(key => key !== keep).map(key => caches.delete(key)))
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

  if (e.request.mode === 'navigate') {
    // Navigation gets the only HTML fallback. JS/CSS/image requests can never
    // receive index.html, avoiding MIME errors after a partial/old deployment.
    e.respondWith(fetch(e.request).catch(() => caches.match(NAVIGATION_FALLBACK)))
    return
  }

  if (isAssetRequest(e.request, url)) {
    e.respondWith(caches.match(e.request).then(hit =>
      hit || fetch(e.request).then(response => response)
    ))
  }
})
