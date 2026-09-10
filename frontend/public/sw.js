/* lauyim service worker — runtime caching (works with Vite's hashed asset names).
   Media (img/gif) cache-first; everything else network-first with offline fallback. */
// Bump this whenever shell/icon assets change so installed PWAs do not keep
// serving the previous icon from the old runtime cache.
const CACHE = 'opengym-rt-v4'
const SHELL = ['./', './index.html', './logo-perf.svg', './icon-512.png', './icon-180.png']

self.addEventListener('install', e => {
  // Cache the stable shell immediately. Hashed JS chunks are cached by the fetch
  // handler as they are requested, so a release can still change them safely.
  e.waitUntil(caches.open(CACHE).then(async c => {
    await c.addAll(SHELL).catch(() => {})
    try {
      const response = await fetch('./precache.json')
      const files = await response.json()
      await c.addAll(files.map(file => './' + file).filter(file => !file.includes('sw.js')))
    } catch { /* runtime caching still provides a safe fallback */ }
  }).then(() => self.skipWaiting()))
})
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys =>
    Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
  ).then(() => self.clients.claim()))
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
  if (url.pathname.startsWith('/api/')) return    // never cache auth/data

  const isMedia = url.pathname.includes('/img/') || url.pathname.includes('/gif/')
  if (isMedia) {
    e.respondWith(caches.open(CACHE).then(c => c.match(e.request).then(hit =>
      hit || fetch(e.request).then(res => { if (res.ok) c.put(e.request, res.clone()); return res })
    )))
  } else {
    e.respondWith(fetch(e.request).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put(e.request, res.clone()))
      return res
    }).catch(() => caches.match(e.request).then(hit => hit || caches.match('index.html'))))
  }
})
