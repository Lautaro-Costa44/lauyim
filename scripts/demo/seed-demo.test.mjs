// Prueba del gimnasio de la demo: arma la base con seed-demo.mjs en una carpeta temporal (la
// verificación de check.mjs corre adentro), levanta server.js de verdad sobre esa base y recorre
// las pantallas como cada persona: nada responde con error y lo importante aparece.
// Uso: node --test scripts/demo/
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PEOPLE } from './demo-data.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-demo-'));
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);
let server, BASE, seedOutput, today;
const ids = {};
// Id de una persona principal por su clave (juan, lucia, …).
const idOf = key => ids[PEOPLE.find(p => p.key === key).username];

const cookie = uid => {
  const payload = `${uid}:${Date.now() + 3600000}:0`;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
async function get(uid, url) {
  const res = await fetch(BASE + url, { headers: uid ? { Cookie: cookie(uid), 'X-Lauyim-Client': 'v2' } : {} });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
}

before(async () => {
  seedOutput = execFileSync(process.execPath, [path.join(root, 'scripts/demo/seed-demo.mjs'), '--data', dataDir, '--origin', 'https://demo.lauyim.online'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  today = /Hoy en la demo es (\d{4}-\d{2}-\d{2})/.exec(seedOutput)[1];
  // Los ids, leyendo la base ya armada.
  const { DatabaseSync } = await import('node:sqlite');
  const sql = new DatabaseSync(path.join(dataDir, 'gym.db'), { readOnly: true });
  for (const row of sql.prepare('SELECT id, name FROM users').all()) ids[row.name] = row.id;
  sql.close();
  const port = 47000 + Math.floor(Math.random() * 900);
  server = spawn(process.execPath, [path.join(root, 'api/server.js')], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), ORIGIN: 'https://demo.lauyim.online', RP_ID: 'demo.lauyim.online', LICENSE_EXPIRES_AT: '', LICENSE_PAID_UNTIL: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  server.stderr.on('data', d => { log += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('el server no arrancó:\n' + log)), 20000);
    server.stdout.on('data', d => { if (String(d).includes('gym-api on')) { clearTimeout(timer); resolve(); } });
    server.on('exit', code => reject(new Error(`el server terminó (${code}):\n${log}`)));
  });
  BASE = `http://127.0.0.1:${port}`;
  server.stderrLog = () => log;
});
after(async () => {
  if (server && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('el script deja la base en su lugar, con el código de vinculación del dueño', () => {
  assert.ok(fs.existsSync(path.join(dataDir, 'gym.db')));
  assert.ok(fs.existsSync(path.join(dataDir, 'audit.log')));
  assert.equal(fs.readdirSync(dataDir).filter(f => f.startsWith('.demo-')).length, 0);
  assert.equal((seedOutput.match(/\/\?link=[23456789A-Z]{4}-[23456789A-Z]{4}/g) || []).length, 1);
});

test('público: config con el nombre del gimnasio, privacidad con clases e ingreso físico', async () => {
  const config = await get(null, '/api/config');
  assert.equal(config.status, 200);
  assert.equal(config.body.branding.appName, 'Gimnasio Demo');
  assert.equal(config.body.classes_available, true);
  const privacy = await get(null, '/api/privacy');
  assert.equal(privacy.body.gymName, 'Gimnasio Demo');
  assert.equal(privacy.body.checkinEnabled, true);
  assert.equal(privacy.body.classes.planLimits, true);
});

test('cada perfil de la demo ve su app sin errores', async () => {
  for (const name of ['juan', 'carolina', 'martin', 'lucia', 'sofia', 'diego']) {
    const me = await get(idOf(name), '/api/me');
    assert.equal(me.status, 200, name);
    assert.equal(me.body.legal_required ?? false, false, `${name} no tendría que volver a aceptar los términos`);
    const data = await get(idOf(name), '/api/data');
    // Diego tiene la cuota vencida: la app le corta el entrenamiento (403) y le muestra el aviso.
    if (name === 'diego') { assert.equal(data.status, 403, name); continue; }
    assert.equal(data.status, 200, name);
    const classes = await get(idOf(name), `/api/classes?from=${today}&days=7`);
    assert.equal(classes.status, 200, name);
    assert.ok(classes.body.occurrences.length > 10, name);
  }
});

test('Lucía: historial largo, racha y su Pilates fijo; Sofía: en lista de espera', async () => {
  const lucia = (await get(idOf('lucia'), '/api/data')).body;
  const workouts = lucia.state?.workouts || lucia.workouts;
  assert.ok(workouts.length > 60);
  const sofia = (await get(idOf('sofia'), `/api/classes?from=${today}&days=7`)).body;
  assert.ok(sofia.occurrences.some(o => o.myBooking?.status === 'waitlist'));
});

test('el panel del dueño, la recepción y la profe responde sin errores', async () => {
  const juan = idOf('juan');
  const urls = [
    '/api/admin/users', `/api/admin/user?id=${idOf('lucia')}`, '/api/admin/billing', '/api/admin/billing/plans', '/api/admin/billing/settings',
    '/api/admin/approval', '/api/admin/checkin', '/api/admin/attendance-heatmap', '/api/admin/audit', '/api/admin/roles', '/api/admin/members/settings',
    '/api/admin/presets', '/api/admin/programs/usage', '/api/admin/classes/types', `/api/admin/classes/calendar?from=${today}&days=7`,
    '/api/admin/classes/stats?weeks=4', '/api/admin/classes/closures', `/api/admin/classes/member?userId=${idOf('sofia')}`,
    '/api/owner/branding', '/api/owner/privacy', '/api/owner/classes/settings'
  ];
  for (const url of urls) {
    const r = await get(juan, url);
    assert.equal(r.status, 200, `${url}: ${JSON.stringify(r.body).slice(0, 200)}`);
  }
  const billing = (await get(juan, '/api/admin/billing')).body;
  assert.ok(JSON.stringify(billing).includes('bloqueado'));
  const approval = (await get(juan, '/api/admin/approval')).body;
  assert.equal(approval.pendingCount, 2);
  assert.equal((await get(idOf('martin'), '/api/admin/billing')).status, 200);
  const calendar = await get(idOf('carolina'), `/api/admin/classes/calendar?from=${today}&days=7`);
  assert.equal(calendar.status, 200);
  assert.ok(JSON.stringify(calendar.body).includes('Spinning'));
  assert.equal(server.stderrLog().includes('Error'), false, server.stderrLog());
});

test('con la API andando no toca nada (sale con 2)', () => {
  const before = fs.statSync(path.join(dataDir, 'gym.db')).mtimeMs;
  let status = 0, stderr = '';
  try {
    execFileSync(process.execPath, [path.join(root, 'scripts/demo/seed-demo.mjs'), '--data', dataDir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (error) { status = error.status; stderr = String(error.stderr); }
  assert.equal(status, 2, stderr);
  assert.match(stderr, /frená la API/);
  assert.equal(fs.statSync(path.join(dataDir, 'gym.db')).mtimeMs, before);
  assert.equal(fs.readdirSync(dataDir).filter(f => f.startsWith('.demo-') || f.includes('antes-demo')).length, 0);
});

test('se puede armar cualquier día (domingo, temprano, fin de mes, 29 de febrero) y con códigos para los perfiles', () => {
  // La última, con --codigos-perfiles: los 5 perfiles quedan sin passkey y con su código.
  const runs = ['2026-10-04T23:00:00-03:00', '2026-10-05T07:10:00-03:00', '2026-10-31T23:30:00-03:00', '2028-02-29T18:00:00-03:00'];
  for (const [i, now] of runs.entries()) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-demo-dia-'));
    const codes = i === runs.length - 1;
    try {
      const out = execFileSync(process.execPath, [path.join(root, 'scripts/demo/seed-demo.mjs'), '--data', dir, '--now', now, ...(codes ? ['--codigos-perfiles'] : [])], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      assert.match(out, /Listo: \d+ personas/, now);
      assert.equal((out.match(/\?link=/g) || []).length, codes ? 6 : 1, now);
    } finally { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); }
  }
});
