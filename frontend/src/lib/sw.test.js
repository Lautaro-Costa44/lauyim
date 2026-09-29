import { describe, it, expect, beforeEach } from 'vitest'
import vm from 'node:vm'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'

// Runs public/sw.js in a fake ServiceWorkerGlobalScope with an in-memory Cache API, so the cache
// rules (one release at a time, no runtime cache, legacy caches purged) are checked on the real file.
const SOURCE = readFileSync(resolve(process.cwd(), 'public/sw.js'), 'utf8')

function fakeCaches(initial = {}) {
  const store = new Map(Object.entries(initial).map(([name, files]) => [name, new Map(Object.entries(files))]))
  const key = req => {
    const u = typeof req === 'string' ? req : req.url
    return u.replace(/^https:\/\/gym\.test\//, './').replace(/[?#].*$/, '')
  }
  const cacheOf = name => ({
    match: async req => store.get(name).get(key(req)),
    put: async (req, res) => { store.get(name).set(key(req), res) },
    keys: async () => [...store.get(name).keys()],
    delete: async req => store.get(name).delete(typeof req === 'string' ? key(req) : req),
    addAll: async urls => { for (const u of urls) store.get(name).set(key(u), new Response('body:' + u)) }
  })
  return {
    store,
    keys: async () => [...store.keys()],
    open: async name => { if (!store.has(name)) store.set(name, new Map()); return cacheOf(name) },
    delete: async name => store.delete(name),
    // Like the real API without cacheName: every cache, in creation order.
    match: async req => { for (const name of store.keys()) { const hit = store.get(name).get(key(req)); if (hit) return hit } }
  }
}

function boot(initialCaches, { online = true, release = 'r2' } = {}) {
  const caches = fakeCaches(initialCaches)
  const listeners = {}
  const netCalls = []
  const scope = {
    caches, Response, URL,
    location: { origin: 'https://gym.test' },
    self: null,
    fetch: async (req, opts) => {
      const url = typeof req === 'string' ? req : req.url
      netCalls.push(url)
      if (!online) throw new TypeError('offline')
      // real build: index.html is not listed in the manifest
      if (url.endsWith('precache.json')) return new Response(JSON.stringify({ release, files: ['assets/app-2.js', 'sw.js'] }))
      return new Response('net:' + url)
    }
  }
  scope.self = Object.assign(scope, {
    registration: { scope: 'https://gym.test/' },
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener: (type, fn) => { listeners[type] = fn }
  })
  vm.runInNewContext(SOURCE, scope)
  const run = async type => { let p; listeners[type]({ waitUntil: x => { p = x } }); await p }
  const fetchEvent = (url, mode = 'cors', destination = '') => {
    let p
    listeners.fetch({ request: { url, method: 'GET', mode, destination }, respondWith: x => { p = x } })
    return p === undefined ? undefined : Promise.resolve(p).then(r => r.text())
  }
  return { caches, netCalls, run, fetchEvent }
}

const releaseCache = (release, at, extra = {}) => ({
  ['lauyim-release-' + release]: {
    './': new Response(release + ':root'),
    './index.html': new Response(release + ':index'),
    './__release': new Response(JSON.stringify({ installedAt: at })),
    ...extra
  }
})

describe('service worker caches', () => {
  let sw
  beforeEach(() => { sw = null })

  it('install builds lauyim-release-<release> and stamps it', async () => {
    sw = boot({})
    await sw.run('install')
    expect(await sw.caches.keys()).toEqual(['lauyim-release-r2'])
    expect(sw.caches.store.get('lauyim-release-r2').has('./__release')).toBe(true)
  })

  it('install precaches index.html even though the build manifest does not list it', async () => {
    sw = boot({})
    await sw.run('install')
    const cache = sw.caches.store.get('lauyim-release-r2')
    expect(cache.has('./index.html')).toBe(true)
    expect(cache.has('./')).toBe(true)
  })

  it('offline navigation falls back to the cached root when index.html is missing', async () => {
    sw = boot({ 'lauyim-release-r2': { './': new Response('r2:root'), './__release': new Response(JSON.stringify({ installedAt: 1 })) } }, { online: false })
    expect(await sw.fetchEvent('https://gym.test/', 'navigate')).toBe('r2:root')
  })

  it('activate deletes legacy opengym-* caches and older releases, keeps only the newest', async () => {
    sw = boot({
      'opengym-rt-v4': { './': new Response('old-html') },
      'opengym-release-old': { './index.html': new Response('older') },
      ...releaseCache('r1', 100),
      ...releaseCache('r2', 200)
    })
    await sw.run('activate')
    expect(await sw.caches.keys()).toEqual(['lauyim-release-r2'])
  })

  it('activate never wipes everything when no release cache exists', async () => {
    sw = boot({ 'opengym-rt-v4': { './': new Response('x') } })
    await sw.run('activate')
    expect(await sw.caches.keys()).toEqual(['opengym-rt-v4'])
  })

  it('offline navigation serves index.html of the current release, not a legacy cache', async () => {
    // rt-v4 is created first, so a global caches.match() would return its stale index.html.
    sw = boot({ 'opengym-rt-v4': { './index.html': new Response('rt-v4:index') }, ...releaseCache('r2', 200) }, { online: false })
    expect(await sw.fetchEvent('https://gym.test/', 'navigate')).toBe('r2:index')
  })

  it('never writes navigations, HTML or assets fetched from the network into any cache', async () => {
    sw = boot(releaseCache('r2', 200))
    const before = JSON.stringify([...sw.caches.store.get('lauyim-release-r2').keys()])
    await sw.fetchEvent('https://gym.test/', 'navigate')
    await sw.fetchEvent('https://gym.test/assets/unknown-9.js', 'cors', 'script')
    expect(JSON.stringify([...sw.caches.store.get('lauyim-release-r2').keys()])).toBe(before)
    expect(await sw.caches.keys()).toEqual(['lauyim-release-r2'])
  })

  it('an asset missing from the release goes to the network, never to index.html', async () => {
    sw = boot(releaseCache('r2', 200), { online: false })
    await expect(sw.fetchEvent('https://gym.test/assets/gone-1.js', 'cors', 'script')).rejects.toThrow()
  })

  it('assets come from the current release cache only', async () => {
    sw = boot({ 'opengym-rt-v4': { './assets/a.js': new Response('rt-v4:a') }, ...releaseCache('r2', 200, { './assets/a.js': new Response('r2:a') }) })
    expect(await sw.fetchEvent('https://gym.test/assets/a.js', 'cors', 'script')).toBe('r2:a')
  })

  it('gifs/images are cached cache-first in lauyim-media-v1 and survive activate', async () => {
    sw = boot(releaseCache('r2', 200))
    expect(await sw.fetchEvent('https://gym.test/gif/squat.gif', 'cors', 'image')).toBe('net:https://gym.test/gif/squat.gif')
    expect(sw.caches.store.get('lauyim-media-v1').has('./gif/squat.gif')).toBe(true)
    await sw.run('activate')
    expect(await sw.caches.keys()).toContain('lauyim-media-v1')
  })

  it('a cached gif is served offline', async () => {
    sw = boot({ ...releaseCache('r2', 200), 'lauyim-media-v1': { './gif/squat.gif': new Response('cached-gif') } }, { online: false })
    expect(await sw.fetchEvent('https://gym.test/gif/squat.gif', 'cors', 'image')).toBe('cached-gif')
  })

  it('API requests are left to the network', () => {
    sw = boot(releaseCache('r2', 200))
    expect(sw.fetchEvent('https://gym.test/api/me')).toBeUndefined()
  })
})
