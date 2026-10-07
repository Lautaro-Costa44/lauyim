// Personalización de la instancia (Admin → Personalización, api/branding.js): nombre, frase del
// login, color del gym, tema y logo. Llega en /api/config (public) y se aplica antes del login; sin
// conexión se usa la última config guardada.

export const DEFAULT_APP_NAME = 'lauyim'
export const MAX_SHORT_NAME = 12
// Fondos de la app por tema (index.css): contra ellos se mide si el color del gym se lee bien.
const THEME_BG = { dark: '#000000', light: '#f2f2f7' }

const hexToRgb = hex => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const toHex = rgb => '#' + rgb.map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')

// Luminancia relativa (WCAG 2.1).
export function luminance(hex) {
  const rgb = hexToRgb(hex)
  if (!rgb) return 0
  const [r, g, b] = rgb.map(v => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export const contrastRatio = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
// Texto sobre un botón del color: el que más contraste da.
export const onAccentFor = hex => contrastRatio(hex, '#000000') >= contrastRatio(hex, '#ffffff') ? '#000' : '#fff'
// Variante más oscura (estados presionados, degradados): mismo tono, menos brillo.
export const darken = (hex, amount = 0.25) => { const rgb = hexToRgb(hex); return rgb ? toHex(rgb.map(v => v * (1 - amount))) : hex }
// Temas en los que el color queda flojo contra el fondo (menos de 3:1, el mínimo para botones).
export const contrastWarnings = hex => Object.entries(THEME_BG).filter(([, bg]) => contrastRatio(hex, bg) < 3).map(([theme]) => theme)

export const isCustomBrand = branding => !!branding?.appName && branding.appName !== DEFAULT_APP_NAME
export const shortNameFor = branding => branding?.shortName || String(branding?.appName || DEFAULT_APP_NAME).slice(0, MAX_SHORT_NAME)

// Acento que ve el usuario: { key } de la paleta, o { key: 'custom', color } del gym. Con color
// del gym, es el de entrada (reemplaza al lime de fábrica, así que lime sale de la paleta) y el
// de quien eligió "gym"; con "solo el color del gym", el de todos.
export function resolveAccent(accent, branding) {
  const color = branding?.color
  if (color && (branding.lockColor || !accent || accent === 'lime' || accent === 'gym')) return { key: 'custom', color }
  if (!accent || accent === 'gym') return { key: 'lime' }
  return { key: accent }
}

// Tema que ve el usuario: con el tema bloqueado por el gym, el del gym; si no, el suyo.
export const themeFor = (theme, branding) => branding?.lockTheme ? (branding.theme || 'dark') : (theme || 'dark')

// Variables CSS del acento del gym (las de la paleta están en index.css por data-accent).
export const customAccentVars = color => ({
  '--acc': color,
  '--acc-2': darken(color, 0.25),
  '--on-acc': onAccentFor(color),
})

// Logo para el login y la pantalla de carga.
export const logoSrc = branding => branding?.logo ? `/api/branding/logo.png?v=${branding.logo}` : 'logo-perf.svg?v=3'

// Foto (icon) y silueta de la barra de estado (badge) de las notificaciones: las del gym, o las de
// lauyim (la misma regla que los push, en api/branding.js brandPush).
export const notificationImages = branding => branding?.logo
  ? { icon: `/api/branding/icon-192.png?v=${branding.logo}`, badge: `/api/branding/badge-96.png?v=${branding.logo}` }
  : { icon: 'icon-512.png?v=3', badge: 'badge-96.png' }

// Última config guardada (sin conexión, o antes de que responda /api/config).
let cached
export function cachedBranding() {
  if (cached === undefined) {
    try { cached = JSON.parse(localStorage.getItem('gym_config') || 'null')?.branding || null } catch { cached = null }
  }
  return cached
}

// Título, nombre para iPhone, favicon e ícono de iPhone del documento.
export function applyBrandingToDocument(branding) {
  if (typeof document === 'undefined') return
  const name = branding?.appName || DEFAULT_APP_NAME
  document.title = name
  document.querySelector('meta[name="apple-mobile-web-app-title"]')?.setAttribute('content', shortNameFor(branding))
  const icon = document.querySelector('link[rel="icon"]')
  if (icon) {
    icon.setAttribute('href', logoSrc(branding))
    icon.setAttribute('type', branding?.logo ? 'image/png' : 'image/svg+xml')
  }
  document.querySelector('link[rel="apple-touch-icon"]')?.setAttribute('href', '/api/branding/apple-touch-icon.png' + (branding?.logo ? `?v=${branding.logo}` : ''))
}
