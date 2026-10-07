// Personalización por HTTP sobre server.js de verdad: solo el owner la cambia; /api/config la
// publica; el manifest y los íconos se sirven (o redirigen a los de lauyim); la passkey usa el nombre.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakePng } from './fake-png.js';
import { BRANDING_ASSETS } from './branding.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-branding-'));
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);
process.env.DATA_DIR = dataDir;

const db = await import('./database.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña', created: Date.now() });
db.createUser({ id: 'staff', name: 'Admin', admin: true, created: Date.now() });
db.closeDatabase();

const PORT = 45500 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
const cookie = uid => {
  const payload = `${uid}:${Date.now() + 3600000}:0`;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
async function call(uid, method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Cookie = cookie(uid);
  const res = await fetch(BASE + url, { method, headers, redirect: 'manual', body: body === undefined ? undefined : JSON.stringify(body) });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}
const assets = (opts) => Object.fromEntries(Object.entries(BRANDING_ASSETS).map(([name, side]) => [name, 'data:image/png;base64,' + fakePng(side, opts).toString('base64')]));

before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL('./server.js', import.meta.url))], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), LICENSE_EXPIRES_AT: '', LICENSE_PAID_UNTIL: '', RP_NAME: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  server.stderr.on('data', d => { log += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('el server no arrancó:\n' + log)), 15000);
    server.stdout.on('data', d => { if (String(d).includes('gym-api on')) { clearTimeout(timer); resolve(); } });
    server.on('exit', code => reject(new Error(`el server terminó (${code}):\n${log}`)));
  });
});
after(async () => {
  if (server && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('sin personalizar: lauyim, y los íconos redirigen a los de fábrica', async () => {
  assert.equal((await call(null, 'GET', '/api/config')).body.branding.appName, 'lauyim');
  const icon = await call(null, 'GET', '/api/branding/apple-touch-icon.png');
  assert.equal(icon.status, 302);
  assert.equal(icon.headers.get('location'), '/icon-180.png');
  const manifest = await call(null, 'GET', '/api/branding/manifest.webmanifest');
  assert.equal(manifest.headers.get('content-type'), 'application/manifest+json');
  assert.equal(manifest.body.name, 'lauyim');
  assert.equal((await call(null, 'GET', '/api/branding/otra-cosa.png')).status, 404);
});

test('solo el owner la cambia; con datos inválidos responde qué campo', async () => {
  assert.equal((await call('staff', 'PUT', '/api/owner/branding', { appName: 'Gym' })).status, 403);
  const bad = await call('owner', 'PUT', '/api/owner/branding', { appName: 'Gym', color: 'rojo' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, 'color');
  const badLogo = await call('owner', 'PUT', '/api/owner/branding', { appName: 'Gym', assets: { 'logo.png': 'x' } });
  assert.equal(badLogo.body.field, 'logo');
});

test('con logo: config, manifest, íconos con caché larga y la passkey con el nombre', async () => {
  const put = await call('owner', 'PUT', '/api/owner/branding', { appName: 'Gym Centro', shortName: 'Centro', tagline: 'Entrená mejor', color: '#FF8800', lockColor: true, assets: assets() });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const { branding } = (await call(null, 'GET', '/api/config')).body;
  assert.deepEqual({ ...branding, logo: !!branding.logo }, { appName: 'Gym Centro', shortName: 'Centro', tagline: 'Entrená mejor', color: '#ff8800', lockColor: true, theme: 'dark', lockTheme: true, logo: true });
  const manifest = (await call(null, 'GET', '/api/branding/manifest.webmanifest')).body;
  assert.equal(manifest.short_name, 'Centro');
  assert.equal(manifest.icons[0].src, `/api/branding/icon-192.png?v=${branding.logo}`);
  const icon = await call(null, 'GET', `/api/branding/icon-192.png?v=${branding.logo}`);
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get('content-type'), 'image/png');
  assert.match(icon.headers.get('cache-control'), /immutable/);
  const opts = await call(null, 'POST', '/api/register/options', { name: 'nueva', legalAccepted: true, profile: { fullName: 'Ana Nueva', dni: '40123456', phone: '11 2345-6789' } });
  assert.equal(opts.status, 200, JSON.stringify(opts.body));
  assert.equal(opts.body.options.rp.name, 'Gym Centro');
  // Cambiar el texto sin mandar el logo lo conserva; removeLogo lo saca.
  const keep = await call('owner', 'PUT', '/api/owner/branding', { appName: 'Gym Centro 2' });
  assert.equal(keep.body.branding.logo, branding.logo);
  const removed = await call('owner', 'PUT', '/api/owner/branding', { appName: 'Gym Centro 2', removeLogo: true });
  assert.equal(removed.body.branding.logo, null);
  assert.equal((await call(null, 'GET', '/api/branding/icon-192.png')).status, 302);
});

test('un logo sin silueta de notificaciones (app vieja): se guarda y la silueta redirige a la de lauyim', async () => {
  const { ['badge-96.png']: _, ...old } = assets();
  const put = await call('owner', 'PUT', '/api/owner/branding', { appName: 'Gym Viejo', assets: old });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const badge = await call(null, 'GET', `/api/branding/badge-96.png?v=${put.body.branding.logo}`);
  assert.equal(badge.status, 302);
  assert.equal(badge.headers.get('location'), '/badge-96.png');
  const full = await call('owner', 'PUT', '/api/owner/branding', { appName: 'Gym Viejo', assets: assets() });
  assert.equal((await call(null, 'GET', `/api/branding/badge-96.png?v=${full.body.branding.logo}`)).status, 200);
  await call('owner', 'PUT', '/api/owner/branding', { appName: 'Gym Viejo', removeLogo: true });
});

test('un logo tipo foto se guarda (todos los íconos en el peor caso)', async () => {
  const body = { appName: 'Gym Foto', assets: assets({ noise: true }) };
  assert.ok(JSON.stringify(body).length > 4 * 1024 * 1024);
  const put = await call('owner', 'PUT', '/api/owner/branding', body);
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.ok(put.body.branding.logo);
  const logo = await call(null, 'GET', `/api/branding/logo.png?v=${put.body.branding.logo}`);
  assert.equal(logo.body.length, Buffer.from(body.assets['logo.png'].split(',')[1], 'base64').length);
});

test('volver a lauyim', async () => {
  await call('owner', 'PUT', '/api/owner/branding', { appName: 'Otro', assets: assets() });
  const reset = await call('owner', 'POST', '/api/owner/branding/reset', {});
  assert.equal(reset.body.branding.appName, 'lauyim');
  assert.equal(reset.body.branding.logo, null);
  assert.equal((await call(null, 'GET', '/api/branding/logo.png')).status, 302);
});
