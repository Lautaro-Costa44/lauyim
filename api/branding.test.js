import test from 'node:test';
import assert from 'node:assert/strict';
import { brandingOf, validateBranding, validateAssets, pngSize, buildManifest, brandPush, BRANDING_ASSETS } from './branding.js';
import { fakePng } from './fake-png.js';

const allAssets = (opts) => Object.fromEntries(Object.entries(BRANDING_ASSETS).map(([name, side]) => [name, 'data:image/png;base64,' + fakePng(side, opts).toString('base64')]));

test('brandingOf: valores por defecto y lo guardado', () => {
  // De entrada, el tema está bloqueado en oscuro para todos.
  assert.deepEqual(brandingOf(null), { appName: 'lauyim', shortName: '', tagline: '', color: null, lockColor: false, theme: 'dark', lockTheme: true, logo: null });
  assert.deepEqual(brandingOf(JSON.stringify({ theme: 'light', lockTheme: false })), { ...brandingOf(null), theme: 'light', lockTheme: false });
  assert.equal(brandingOf(JSON.stringify({ theme: 'rosa' })).theme, 'dark');
  assert.equal(brandingOf('roto').appName, 'lauyim');
  // Sin color no hay "solo el color del gym".
  assert.equal(brandingOf(JSON.stringify({ lockColor: true })).lockColor, false);
});

test('validateBranding: limpia, pone límites y exige un nombre', () => {
  assert.deepEqual(validateBranding({ appName: '  Gym  <Centro> ', shortName: 'Centro', tagline: 'Entrená mejor', color: '#FF8800', lockColor: true }).value,
    { appName: 'Gym Centro', shortName: 'Centro', tagline: 'Entrená mejor', color: '#ff8800', lockColor: true, theme: 'dark', lockTheme: true });
  assert.equal(validateBranding({ appName: '' }).field, 'appName');
  assert.equal(validateBranding({ appName: 'x'.repeat(31) }).field, 'appName');
  assert.equal(validateBranding({ appName: 'Gym', shortName: 'x'.repeat(13) }).field, 'shortName');
  assert.equal(validateBranding({ appName: 'Gym', tagline: 'x'.repeat(81) }).field, 'tagline');
  assert.equal(validateBranding({ appName: 'Gym', color: 'rojo' }).field, 'color');
  assert.equal(validateBranding({ appName: 'Gym', lockColor: true }).value.lockColor, false);
});

test('validateBranding: tema oscuro, claro o sistema; bloqueado salvo que se apague', () => {
  assert.deepEqual(validateBranding({ appName: 'Gym', theme: 'system', lockTheme: false }).value, { appName: 'Gym', shortName: '', tagline: '', color: null, lockColor: false, theme: 'system', lockTheme: false });
  assert.equal(validateBranding({ appName: 'Gym', theme: 'light' }).value.lockTheme, true);
  assert.equal(validateBranding({ appName: 'Gym', theme: 'rosa' }).field, 'theme');
});

test('validateAssets: todos los íconos, PNG y del tamaño justo', () => {
  const ok = validateAssets(allAssets());
  assert.ok(ok.value);
  assert.deepEqual(pngSize(ok.value['icon-192.png']), { width: 192, height: 192 });
  const missing = allAssets(); delete missing['apple-touch-icon.png'];
  assert.match(validateAssets(missing).error, /apple-touch-icon/);
  const wrong = allAssets(); wrong['icon-192.png'] = fakePng(180).toString('base64');
  assert.match(validateAssets(wrong).error, /192×192/);
  const notPng = allAssets(); notPng['logo.png'] = Buffer.from('<svg/>').toString('base64');
  assert.match(validateAssets(notPng).error, /no es un PNG/);
  assert.match(validateAssets({ ...allAssets(), 'otro.png': 'x' }).error, /desconocida/);
});

test('validateAssets: un logo tipo foto (el PNG más pesado posible de cada lado) entra', () => {
  // Un 512 con degradado o foto pesa 500 a 800 KB; el límite viejo de 700 KB lo rechazaba.
  const heavy = allAssets({ noise: true });
  assert.ok(Buffer.from(heavy['logo.png'].split(',')[1], 'base64').length > 1024 * 1024);
  assert.equal(validateAssets(heavy).error, undefined);
});

test('buildManifest: nombre, nombre corto e íconos propios o los de lauyim', () => {
  const plain = buildManifest(brandingOf(null));
  assert.equal(plain.name, 'lauyim');
  assert.equal(plain.icons[0].src, '/icon-192.png');
  const gym = buildManifest(brandingOf(JSON.stringify({ appName: 'Gimnasio Centro Norte', logo: 7 })));
  assert.equal(gym.short_name, 'Gimnasio Cen');
  assert.equal(gym.icons[2].purpose, 'maskable');
  assert.equal(gym.icons[2].src, '/api/branding/icon-maskable-512.png?v=7');
  // La pantalla de carga de Android usa background_color: clara solo con el tema claro bloqueado.
  assert.equal(plain.background_color, '#0c0e12');
  assert.equal(buildManifest(brandingOf(JSON.stringify({ theme: 'light' }))).background_color, '#f2f2f7');
  assert.equal(buildManifest(brandingOf(JSON.stringify({ theme: 'light', lockTheme: false }))).background_color, '#0c0e12');
});

test('brandPush: foto del gym con logo propio, nada sin logo; nombre del gym si falta el título', () => {
  const plain = brandPush({ title: 'Hoy toca', body: 'x', tag: 't' }, brandingOf(null));
  assert.deepEqual(plain, { title: 'Hoy toca', body: 'x', tag: 't' });
  const gym = brandingOf(JSON.stringify({ appName: 'Gimnasio Centro Norte', logo: 7 }));
  assert.equal(brandPush({ title: 'Hoy toca' }, gym).icon, '/api/branding/icon-192.png?v=7');
  assert.equal(brandPush({ title: 'Hoy toca' }, gym).badge, '/api/branding/badge-96.png?v=7');
  assert.equal(brandPush({ body: 'x' }, gym).title, 'Gimnasio Centro Norte');
  assert.equal(brandPush({ body: 'x' }, brandingOf(null)).title, 'lauyim');
});

test('validateAssets: la silueta de las notificaciones puede faltar (logos de antes); si viene, se valida', () => {
  const { ['badge-96.png']: badge, ...rest } = allAssets();
  assert.ok(badge);
  assert.equal(validateAssets(rest).error, undefined);
  assert.equal(validateAssets(rest).value['badge-96.png'], undefined);
  assert.equal(validateAssets({ ...rest, 'badge-96.png': 'data:image/png;base64,' + fakePng(64).toString('base64') }).error, 'badge-96.png tiene que medir 96×96');
  const { ['icon-192.png']: _, ...noIcon } = allAssets();
  assert.equal(validateAssets(noIcon).error, 'Falta icon-192.png');
});
