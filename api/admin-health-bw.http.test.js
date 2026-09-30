// Datos de salud en el detalle de un socio para el admin (GET /api/admin/user): sin consentimiento
// no se manda el peso corporal, ni la serie de pesajes ni el que se anota en cada entreno (bw).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-admin-bw-'));
process.env.DATA_DIR = dataDir;
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);

const db = await import('./database.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña' });
db.createUser({ id: 'adm', name: 'Admin', admin: true });
const workout = (id, d, bw) => ({ id, d, start: 1, end: 2, name: 'Push', bw, entries: [] });
for (const id of ['si', 'no']) {
  db.createUser({ id, name: id });
  db.saveUserState(id, { unit: 'kg', routines: [], bodyweight: [{ d: '2026-09-01', w: 80, t: 1 }], workouts: [workout(id + '-1', '2026-09-01', 80), workout(id + '-2', '2026-09-02', 81)] });
}
db.setHealthConsent('si', true);
db.setHealthConsent('no', false);
db.closeDatabase();

const PORT = 49000 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
const cookie = uid => {
  const payload = `${uid}:${Date.now() + 3600000}:0`;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
const get = async (who, url) => { const r = await fetch(BASE + url, { headers: { Cookie: cookie(who) } }); return { status: r.status, body: await r.json() }; };

before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL('./server.js', import.meta.url))], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), LICENSE_EXPIRES_AT: '' }, stdio: ['ignore', 'pipe', 'pipe']
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

test('sin consentimiento de salud: ni pesajes ni el bw de cada entreno', async () => {
  const r = await get('adm', '/api/admin/user?id=no');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.bodyweight, []);
  assert.equal(r.body.workouts.length, 2);
  assert.ok(r.body.workouts.every(w => !('bw' in w)), JSON.stringify(r.body.workouts));
  assert.equal(r.body.workouts[0].name, 'Push');                   // el resto del entreno sigue
});

test('con consentimiento: el admin ve los pesajes y el bw de cada entreno', async () => {
  const r = await get('adm', '/api/admin/user?id=si');
  assert.equal(r.body.bodyweight.length, 1);
  assert.deepEqual(r.body.workouts.map(w => w.bw), [81, 80]);
});
