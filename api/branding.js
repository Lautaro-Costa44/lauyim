// Personalización de la instancia (Admin → Personalización, solo el owner): nombre de la app, nombre
// bajo el ícono, frase del login, color del gym (y si es el único) y el logo con sus íconos. Los
// íconos los genera el navegador del owner (frontend/src/lib/branding-image.js) y el servidor solo
// valida que sean PNG del tamaño justo. Todo vive en la base, así entra en el backup.

export const BRANDING_SETTING = 'branding';
export const DEFAULT_APP_NAME = 'lauyim';
export const MAX_APP_NAME = 30;
export const MAX_SHORT_NAME = 12;
export const MAX_TAGLINE = 80;
export const MAX_ASSET_BYTES = 700 * 1024;

// Archivos que se generan a partir del logo, con su lado exacto en píxeles.
export const BRANDING_ASSETS = Object.freeze({
  'logo.png': 512,              // login, splash y favicon (con su transparencia)
  'icon-192.png': 192,          // Android
  'icon-512.png': 512,          // Android y pantalla de carga
  'icon-maskable-512.png': 512, // Android: lo recorta en círculo o gota (logo dentro de la zona segura)
  'apple-touch-icon.png': 180   // iPhone (sin transparencia)
});

// Los de lauyim, en frontend/public: si la instancia no tiene logo propio.
export const DEFAULT_ASSETS = Object.freeze({
  'logo.png': '/logo-perf.svg',
  'icon-192.png': '/icon-192.png',
  'icon-512.png': '/icon-512.png',
  'icon-maskable-512.png': '/icon-512.png',
  'apple-touch-icon.png': '/icon-180.png'
});

const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim() : null;

// Lo guardado (o nada) → la personalización completa, con los valores por defecto.
export function brandingOf(stored) {
  let saved = {};
  try { saved = stored ? JSON.parse(stored) : {}; } catch { saved = {}; }
  return {
    appName: saved.appName || DEFAULT_APP_NAME,
    shortName: saved.shortName || '',
    tagline: saved.tagline || '',
    color: saved.color || null,
    lockColor: !!(saved.color && saved.lockColor),
    logo: saved.logo || null            // versión de los íconos (para ?v=), o null sin logo propio
  };
}

// body → { value } con los campos de texto y color, o { error, field }.
export function validateBranding(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Datos inválidos' };
  const appName = clean(body.appName ?? '') ?? '';
  if (!appName) return { error: 'Poné un nombre para la app', field: 'appName' };
  if (appName.length > MAX_APP_NAME) return { error: `El nombre admite hasta ${MAX_APP_NAME} caracteres`, field: 'appName' };
  const shortName = clean(body.shortName ?? '') ?? '';
  if (shortName.length > MAX_SHORT_NAME) return { error: `El nombre bajo el ícono admite hasta ${MAX_SHORT_NAME} caracteres`, field: 'shortName' };
  const tagline = clean(body.tagline ?? '') ?? '';
  if (tagline.length > MAX_TAGLINE) return { error: `La frase admite hasta ${MAX_TAGLINE} caracteres`, field: 'tagline' };
  let color = null;
  if (body.color !== null && body.color !== undefined && body.color !== '') {
    if (typeof body.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(body.color)) return { error: 'El color tiene que ser un código #RRGGBB', field: 'color' };
    color = body.color.toLowerCase();
  }
  return { value: { appName, shortName, tagline, color, lockColor: !!(color && body.lockColor === true) } };
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Lado de un PNG (IHDR), o null si no es un PNG.
export function pngSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buffer.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

// { 'logo.png': 'data:image/png;base64,...' | base64, ... } → { value: { name: Buffer } } o { error }.
// Tienen que venir todos juntos: un logo nuevo cambia todos los íconos.
export function validateAssets(assets) {
  if (!assets || typeof assets !== 'object' || Array.isArray(assets)) return { error: 'Faltan las imágenes del logo' };
  const value = {};
  for (const [name, side] of Object.entries(BRANDING_ASSETS)) {
    const raw = assets[name];
    if (typeof raw !== 'string' || !raw) return { error: `Falta ${name}` };
    const buffer = Buffer.from(raw.replace(/^data:image\/png;base64,/, ''), 'base64');
    if (buffer.length > MAX_ASSET_BYTES) return { error: `${name} pesa demasiado` };
    const size = pngSize(buffer);
    if (!size) return { error: `${name} no es un PNG` };
    if (size.width !== side || size.height !== side) return { error: `${name} tiene que medir ${side}×${side}` };
    value[name] = buffer;
  }
  const extra = Object.keys(assets).filter(name => !(name in BRANDING_ASSETS));
  if (extra.length) return { error: `Imagen desconocida: ${extra[0]}` };
  return { value };
}

const assetUrl = (branding, name) => branding.logo ? `/api/branding/${name}?v=${branding.logo}` : DEFAULT_ASSETS[name];

// Manifest de la PWA: nombre, nombre corto, color e íconos de la instancia.
export function buildManifest(branding) {
  const short = branding.shortName || branding.appName.slice(0, MAX_SHORT_NAME);
  return {
    // id y start_url fijos ("/"): la misma app instalada aunque cambien el nombre o los íconos.
    id: '/',
    name: branding.appName,
    short_name: short,
    description: branding.tagline || 'Tu gimnasio y seguimiento de peso',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0c0e12',
    theme_color: '#0c0e12',
    icons: [
      { src: assetUrl(branding, 'icon-192.png'), sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: assetUrl(branding, 'icon-512.png'), sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: assetUrl(branding, 'icon-maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' }
    ],
    shortcuts: [{ name: 'Panel admin', short_name: 'Admin', url: '/#/admin', icons: [{ src: assetUrl(branding, 'icon-192.png'), sizes: '192x192', type: 'image/png' }] }]
  };
}
