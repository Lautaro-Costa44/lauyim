// Logo del gym → los íconos de la app, en el navegador del owner (canvas, sin librerías). Un solo
// archivo PNG o JPG alcanza para todo (api/branding.js valida los tamaños):
//   logo.png              512  logo encajado, conserva la transparencia (login, splash, favicon)
//   icon-192 / icon-512   fondo lleno + logo con margen (Android)
//   icon-maskable-512     fondo lleno + logo dentro de la zona segura: Android lo recorta en
//                         círculo o gota y solo garantiza el círculo central del 80 %
//   apple-touch-icon      180, fondo lleno (iPhone pinta de negro lo transparente)
// Fondo: con transparencia, el que elige el owner (por defecto, blanco o negro según el logo); sin
// transparencia (JPG), el color de los bordes de la imagen, así el fondo del logo llena el ícono.
// Una imagen que no es cuadrada se encaja centrada y nunca se recorta. Lo único que se saca son los
// márgenes transparentes alrededor del logo (muchos PNG los traen), para que no quede chico.

export const MAX_LOGO_BYTES = 5 * 1024 * 1024
export const MIN_LOGO_SIDE = 192
export const SHARP_LOGO_SIDE = 512
export const LOGO_TYPES = ['image/png', 'image/jpeg']

// Tamaño y margen (fracción del lado a cada lado) de cada ícono. fill: con fondo lleno.
export const ICON_SPECS = {
  'logo.png': { side: 512, pad: 0, fill: false },
  'icon-192.png': { side: 192, pad: 0.12, fill: true },
  'icon-512.png': { side: 512, pad: 0.12, fill: true },
  'icon-maskable-512.png': { side: 512, pad: 0.2, fill: true },
  'apple-touch-icon.png': { side: 180, pad: 0.12, fill: true },
}

const hex = (r, g, b) => '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')

// Píxeles RGBA (ImageData.data) de w×h → { transparent, edgeColor, luminance, box }:
// - transparent: algún píxel con alfa menor a 250;
// - edgeColor: promedio de los píxeles opacos del borde (null si el borde es transparente);
// - luminance: brillo promedio (0..1) de los píxeles opacos, para elegir un fondo que contraste;
// - box: { x, y, w, h } de lo visible (alfa ≥ 16), en píxeles de esta imagen.
export function analyzePixels(data, w, h) {
  let transparent = false
  let minX = w, minY = h, maxX = -1, maxY = -1
  let lumSum = 0, lumCount = 0
  const edge = [0, 0, 0]; let edgeCount = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const a = data[i + 3]
      if (a < 250) transparent = true
      if (a >= 16) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y }
      if (a < 128) continue
      const r = data[i], g = data[i + 1], b = data[i + 2]
      lumSum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; lumCount++
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) { edge[0] += r; edge[1] += g; edge[2] += b; edgeCount++ }
    }
  }
  return {
    transparent,
    edgeColor: edgeCount ? hex(edge[0] / edgeCount, edge[1] / edgeCount, edge[2] / edgeCount) : null,
    luminance: lumCount ? lumSum / lumCount : 0,
    box: maxX < 0 ? { x: 0, y: 0, w, h } : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
  }
}

// Fondo de los íconos por defecto: con transparencia, el que contraste con el logo; sin ella, el
// de los bordes de la imagen.
export function defaultIconBackground({ transparent, edgeColor, luminance }) {
  if (!transparent && edgeColor) return edgeColor
  return luminance > 0.6 ? '#000000' : '#ffffff'
}

// Rectángulo donde dibujar una imagen de srcW×srcH dentro de un cuadrado de `side` con `pad` de
// margen a cada lado, sin deformar ni recortar.
export function containRect(srcW, srcH, side, pad = 0) {
  const box = side * (1 - 2 * pad)
  const scale = Math.min(box / srcW, box / srcH)
  const w = srcW * scale, h = srcH * scale
  return { x: (side - w) / 2, y: (side - h) / 2, w, h }
}

// Archivo elegido → { error } o null si sirve (tipo y peso; el tamaño se ve al cargarlo).
export function checkLogoFile(file) {
  if (!file) return { error: 'Elegí una imagen' }
  if (!LOGO_TYPES.includes(file.type)) return { error: 'El logo tiene que ser PNG o JPG' }
  if (file.size > MAX_LOGO_BYTES) return { error: 'La imagen pesa más de 5 MB' }
  return null
}

// ---- navegador (canvas) ----

export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')) }
    img.src = url
  })
}

const canvasOf = side => { const c = document.createElement('canvas'); c.width = side; c.height = side; return c }

// Imagen cargada → { analysis, warning? } (analiza una copia de hasta 256 px: alcanza y es rápido).
export function analyzeImage(img) {
  const w = img.naturalWidth, h = img.naturalHeight
  const scale = Math.min(1, 256 / Math.max(w, h))
  const cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale))
  const c = document.createElement('canvas'); c.width = cw; c.height = ch
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(img, 0, 0, cw, ch)
  const analysis = analyzePixels(ctx.getImageData(0, 0, cw, ch).data, cw, ch)
  // Recorte de los márgenes transparentes, en píxeles de la imagen original (con 1 px de aire).
  const b = analysis.box
  const crop = analysis.transparent ? {
    x: Math.max(0, Math.floor((b.x - 1) / scale)), y: Math.max(0, Math.floor((b.y - 1) / scale)),
    w: Math.min(w, Math.ceil((b.w + 2) / scale)), h: Math.min(h, Math.ceil((b.h + 2) / scale)),
  } : { x: 0, y: 0, w, h }
  crop.w = Math.min(crop.w, w - crop.x); crop.h = Math.min(crop.h, h - crop.y)
  const side = Math.min(crop.w, crop.h)
  return { analysis, crop, small: Math.max(crop.w, crop.h) < MIN_LOGO_SIDE, blurry: Math.max(crop.w, crop.h) < SHARP_LOGO_SIDE, side }
}

// Imagen + fondo (+ recorte de analyzeImage) → { name: dataURL PNG } con todos los íconos.
export function renderIcons(img, background, crop = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight }) {
  const out = {}
  for (const [name, { side, pad, fill }] of Object.entries(ICON_SPECS)) {
    const c = canvasOf(side)
    const ctx = c.getContext('2d')
    if (fill) { ctx.fillStyle = background; ctx.fillRect(0, 0, side, side) }
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    const r = containRect(crop.w, crop.h, side, pad)
    ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, r.x, r.y, r.w, r.h)
    out[name] = c.toDataURL('image/png')
  }
  return out
}
