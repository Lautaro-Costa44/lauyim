// Licencia mensual por HTTP sobre server.js de verdad: suspendida corta todo salvo health, soporte
// y privacidad, con el motivo; por vencer y en mora, solo el staff lo ve en /api/me.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gymToday } from './billing.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-license-'));
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);
process.env.DATA_DIR = dataDir;

const db = await import('./database.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña', created: Date.now() });   // la primera cuenta es owner
db.createUser({ id: 'socio', name: 'Socio', created: Date.now() });
db.closeDatabase();

// Mes AAAA-MM a `back` meses de hoy (en la zona del gym).
function monthsAgo(back) {
  const [y, m] = gymToday().split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 - back, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
const cookie = uid => {
  const payload = `${uid}:${Date.now() + 3600000}:0`;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};

async function withServer(env, fn) {
  const port = 47000 + Math.floor(Math.random() * 900);
  const server = spawn(process.execPath, [fileURLToPath(new URL('./server.js', import.meta.url))], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), LICENSE_EXPIRES_AT: '', LICENSE_PAID_UNTIL: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  server.stderr.on('data', d => { log += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('el server no arrancó:\n' + log)), 15000);
    server.stdout.on('data', d => { if (String(d).includes('gym-api on')) { clearTimeout(timer); resolve(); } });
    server.on('exit', code => reject(new Error(`el server terminó (${code}):\n${log}`)));
  });
  const call = async (uid, url) => {
    const res = await fetch(`http://127.0.0.1:${port}${url}`, { headers: uid ? { Cookie: cookie(uid) } : {} });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  try { await fn(call, () => log); }
  finally { if (server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); }); }
}

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

test('abono impago hace meses: suspendida, salvo health, soporte y privacidad', async () => {
  await withServer({ LICENSE_PAID_UNTIL: '2020-01' }, async call => {
    const data = await call('socio', '/api/data');
    assert.equal(data.status, 403);
    assert.deepEqual(data.body, { error: 'license_expired', reason: 'unpaid' });
    assert.equal((await call('owner', '/api/me')).body.error, 'license_expired');
    assert.equal((await call(null, '/api/health')).status, 200);
    assert.equal((await call(null, '/api/privacy')).status, 200);
  });
});

test('en mora: el staff ve el aviso en /api/me; el socio no, y usa la app normal', async () => {
  await withServer({ LICENSE_PAID_UNTIL: monthsAgo(2), LICENSE_DUE_DAY: '1', LICENSE_SUSPEND_AFTER_DAYS: '120' }, async call => {
    const owner = (await call('owner', '/api/me')).body.license;
    assert.equal(owner.status, 'overdue');
    assert.equal(owner.reason, 'unpaid');
    assert.equal(owner.month, monthsAgo(1));
    assert.ok(owner.suspendDate > gymToday());
    const socio = await call('socio', '/api/me');
    assert.equal(socio.status, 200);
    assert.equal(socio.body.license, null);
    assert.equal((await call('socio', '/api/data')).status, 200);
  });
});

test('por vencer, y LICENSE_PAID_UNTIL mal escrito no corta nada y queda en el log', async () => {
  await withServer({ LICENSE_PAID_UNTIL: monthsAgo(1), LICENSE_DUE_DAY: '31' }, async call => {
    assert.equal((await call('owner', '/api/me')).body.license.status, 'due');
  });
  await withServer({ LICENSE_PAID_UNTIL: 'octubre' }, async (call, log) => {
    assert.deepEqual((await call('owner', '/api/me')).body.license, { status: 'ok' });
    assert.match(log(), /LICENSE_PAID_UNTIL='octubre'/);
  });
});
