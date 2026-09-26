import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const backend = process.env.API_TARGET || 'http://127.0.0.1:3000'
// The API refuses a state-changing request that a browser sent from anywhere other than its own
// ORIGIN (the CSRF guard in api/server.js). The dev server is on a different port, so the page's
// real Origin is not ORIGIN — modern browsers get through on Sec-Fetch-Site: same-origin, and
// presenting the expected Origin here covers the ones that don't send it. Match your .env if you
// changed ORIGIN: API_ORIGIN=https://gym.example.com npm run dev
const apiOrigin = process.env.API_ORIGIN || 'http://localhost:8080'
const media = process.env.MEDIA_TARGET || 'http://127.0.0.1:8888'

// Optional web analytics (Umami). Injected only when BOTH vars are set at build time,
// so a plain `npm run build` — and every self-hosted install — stays telemetry-free.
// Set for the public instance: VITE_UMAMI_SRC=https://stats.example/script.js VITE_UMAMI_ID=<uuid>
const umamiSrc = process.env.VITE_UMAMI_SRC
const umamiId = process.env.VITE_UMAMI_ID

const umami = {
  name: 'opengym-umami',
  transformIndexHtml() {
    if (!umamiSrc || !umamiId) return
    return [{
      tag: 'script',
      attrs: { defer: true, src: umamiSrc, 'data-website-id': umamiId },
      injectTo: 'head'
    }]
  }
}

const precacheManifest = {
  name: 'lauyim-precache-manifest',
  generateBundle(_options, bundle) {
    const files = Object.keys(bundle).filter(name => /\.(js|css|html|png|svg|woff2?)$/i.test(name))
    const buildFingerprint = createHash('sha256')
      .update(pkgVersion)
      .update(readFileSync(new URL('./public/sw.js', import.meta.url)))
    for (const file of files.sort()) {
      buildFingerprint.update(file).update(String(bundle[file].source ?? bundle[file].code ?? ''))
    }
    const release = `${pkgVersion}-${buildFingerprint.digest('hex').slice(0, 12)}`
    this.emitFile({
      type: 'asset',
      fileName: 'precache.json',
      source: JSON.stringify({ release, files })
    })
  }
}

// The version people are asked for in #install-help and on every bug report. Read from
// package.json so it cannot drift from the release it was built in, and inlined at build
// time so no runtime fetch is involved.
const pkgVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(pkgVersion) },
  plugins: [react(), umami, precacheManifest],
  base: './',
  server: {
    proxy: {
      '/api': { target: backend, changeOrigin: true, headers: { Origin: apiOrigin } },
      '/img': { target: media, changeOrigin: true },
      '/gif': { target: media, changeOrigin: true }
    }
  },
  build: {
    chunkSizeWarningLimit: 1500,
    rolldownOptions: {
      output: {
        // zxing (lo usan el escáner de Nutrición y QrCanvas del admin) en un chunk propio: si no,
        // queda dentro del chunk de Nutrición y el admin lo baja entero para dibujar un QR.
        advancedChunks: { groups: [{ name: 'zxing', test: /html5-qrcode[\\/]third_party[\\/]zxing/ }] }
      }
    }
  }
})
