// Aviso de privacidad por HTTP: el endpoint público no pide sesión (ni con la licencia vencida)
// y solo el owner cambia el responsable y el contacto.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePrivacySettings } from './privacy.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-privacy-'));
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);
process.env.DATA_DIR = dataDir;
const db = await import('./database.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña', created: Date.now() });
db.createUser({ id: 'staff', name: 'Admin', admin: true, created: Date.now() });
db.createUser({ id: 'socio', name: 'Socio', created: Date.now() });
db.closeDatabase();

// Dos servers sobre la misma base: uno normal y otro con la licencia vencida.
const servers = [];
function startServer(env) {
  const port = 46000 + Math.floor(Math.random() * 2000) + servers.length * 2000;
  const proc = spawn(process.execPath, [fileURLToPath(new URL('./server.js', import.meta.url))], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), ...env }, stdio: ['ignore', 'pipe', 'pipe']
  });
  servers.push(proc);
  let log = '';
  proc.stderr.on('data', d => { log += d; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('el server no arrancó:\n' + log)), 15000);
    proc.stdout.on('data', d => { if (String(d).includes('gym-api on')) { clearTimeout(timer); resolve(`http://127.0.0.1:${port}`); } });
    proc.on('exit', code => reject(new Error(`el server terminó (${code}):\n${log}`)));
  });
}
let BASE, EXPIRED;
const cookie = uid => {
  const payload = `${uid}:${Date.now() + 3600000}:0`;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
async function call(uid, method, url, body, base = BASE) {
  const res = await fetch(base + url, {
    method, headers: { 'Content-Type': 'application/json', ...(uid ? { Cookie: cookie(uid) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const auditEvents = () => fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8').trim().split('\n').map(l => JSON.parse(l).ev);

before(async () => {
  BASE = await startServer({ LICENSE_EXPIRES_AT: '' });
  EXPIRED = await startServer({ LICENSE_EXPIRES_AT: '2020-01-01' });
});
after(async () => {
  for (const proc of servers) if (proc.exitCode === null) await new Promise(resolve => { proc.once('exit', resolve); proc.kill(); });
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('validatePrivacySettings: recorta, limita y rechaza lo que no es texto', () => {
  assert.deepEqual(validatePrivacySettings({ gymName: '  Gym   Norte\n', contact: '' }).value, { gymName: 'Gym Norte', contact: '' });
  assert.ok(validatePrivacySettings({ gymName: 'x'.repeat(81) }).error);
  assert.ok(validatePrivacySettings({ contact: 3 }).error);
  assert.ok(validatePrivacySettings({}).error);
  assert.ok(validatePrivacySettings(null).error);
});

test('GET /api/privacy es público, aun con la licencia vencida', async () => {
  const r = await call(null, 'GET', '/api/privacy', undefined, EXPIRED);
  assert.equal(r.status, 200);
  assert.equal(r.body.gymName, '');
  assert.ok(Array.isArray(r.body.fields));
  assert.equal(typeof r.body.billingEnabled, 'boolean');
  // El resto de la API sí queda cortado por la licencia.
  assert.equal((await call('owner', 'GET', '/api/owner/privacy', undefined, EXPIRED)).body.error, 'license_expired');
});

test('solo el owner lee y cambia el responsable y el contacto', async () => {
  for (const uid of [null, 'staff', 'socio']) {
    assert.notEqual((await call(uid, 'GET', '/api/owner/privacy')).status, 200);
    assert.notEqual((await call(uid, 'PUT', '/api/owner/privacy', { gymName: 'X' })).status, 200);
  }
  const put = await call('owner', 'PUT', '/api/owner/privacy', { gymName: ' Gym Norte ', contact: 'privacidad@gymnorte.com.ar' });
  assert.equal(put.status, 200);
  assert.deepEqual(put.body, { gymName: 'Gym Norte', contact: 'privacidad@gymnorte.com.ar' });
  assert.equal((await call('owner', 'PUT', '/api/owner/privacy', { contact: 'x'.repeat(201) })).status, 400);
  // Parcial: cambiar solo el contacto conserva el nombre.
  await call('owner', 'PUT', '/api/owner/privacy', { contact: 'Recepción, Av. Siempreviva 742' });
  const pub = await call(null, 'GET', '/api/privacy');
  assert.equal(pub.body.gymName, 'Gym Norte');
  assert.equal(pub.body.contact, 'Recepción, Av. Siempreviva 742');
  assert.ok(auditEvents().includes('owner.privacy.settings'));
});
