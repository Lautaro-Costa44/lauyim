// DEMO_ADMIN_ALL_USERS=1 (demo: todos entran al panel admin): el bloqueo por cuota y el resumen de
// Cuotas igual tratan como socio a quien no es staff de verdad.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { addDays, gymToday } from './billing.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-demo-billing-'));
process.env.DATA_DIR = dataDir;
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);

const today = gymToday(Date.now(), 'America/Argentina/Buenos_Aires');
const db = await import('./database.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña', created: Date.now() });
db.createUser({ id: 'staff', name: 'Admin', admin: true, created: Date.now() });
db.createUser({ id: 'socio', name: 'Socio', created: Date.now() });
const plan = db.createPlan({ name: 'Mensual', price: 20000, durationDays: 30 });
for (const id of ['owner', 'staff', 'socio']) db.setMemberBilling(id, { planId: plan.id, dueDate: addDays(today, -10) });
db.closeDatabase();

const PORT = 48000 + Math.floor(Math.random() * 1500);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
const cookie = uid => {
  const payload = `${uid}:${Date.now() + 3600000}:0`;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
async function call(uid, method, url) {
  const res = await fetch(BASE + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie(uid) } });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL('./server.js', import.meta.url))], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), LICENSE_EXPIRES_AT: '', DEMO_ADMIN_ALL_USERS: '1' },
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

test('demo: el socio ve el panel admin pero queda bloqueado por cuota', async () => {
  const me = await call('socio', 'GET', '/api/me');
  assert.equal(me.body.user.admin, true);
  assert.equal(me.body.user.staff, false);
  assert.equal(me.body.billing.blocked, true);
  assert.equal((await call('socio', 'GET', '/api/data')).body.error, 'membership_blocked');
  assert.equal((await call('socio', 'GET', '/api/admin/billing')).status, 200);
});

test('demo: el staff de verdad sigue exento', async () => {
  for (const uid of ['owner', 'staff']) {
    const me = await call(uid, 'GET', '/api/me');
    assert.equal(me.body.user.staff, true);
    assert.equal(me.body.billing.blocked, false);
    assert.equal((await call(uid, 'GET', '/api/data')).status, 200);
  }
});

test('demo: el resumen de Cuotas cuenta al socio y deja afuera al staff', async () => {
  const r = await call('owner', 'GET', '/api/admin/billing');
  assert.equal(r.body.summary.bloqueado, 1);
  assert.equal(r.body.summary.deuda_total, 20000);
  assert.deepEqual(r.body.members.filter(m => m.admin).map(m => m.id).sort(), ['owner', 'staff']);
  const preview = await call('owner', 'GET', '/api/owner/billing/enable-preview');
  assert.equal(preview.body.bloqueado, 1);
});
