// Cuenta dada de baja: sin avisos push (desactivar / rechazar / borrar borra sus suscripciones y
// su alarma de descanso; sendPush no manda a cuentas no activas) y /api/me dice el motivo para que
// el cliente distinga una sesión vencida (conserva la cola offline) de una baja (borra lo local).
// Los endpoints de push son de un host fuera de la allowlist: fallan sin salir a la red y cada
// intento queda en el log del servidor ("push send failed <uid>").
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-account-end-'));
process.env.DATA_DIR = dataDir;
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);
const db = await import('./database.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña' });
db.createUser({ id: 'adm', name: 'Admin', admin: true });
for (const id of ['act', 'off', 'gone', 'pend', 'rej', 'rest']) db.createUser({ id, name: id, pending: id === 'pend' || id === 'rej' });
const keys = { p256dh: 'x', auth: 'y' };
for (const id of ['act', 'off', 'gone', 'pend', 'rej', 'rest']) {
  db.createSubscription({ endpoint: `https://push.no-permitido.example/${id}`, userId: id, keys });
}
db.createSubscription({ endpoint: 'https://push.no-permitido.example/act-2', userId: 'act', keys });
db.closeDatabase();

const PORT = 47000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}`;
let server, serverLog = '';
const cookie = (uid, sv = 0) => {
  const payload = `${uid}:${Date.now() + 3600000}:${sv}`;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
async function call(who, method, url, body) {
  const res = await fetch(BASE + url, {
    method, headers: { 'Content-Type': 'application/json', ...(who ? { Cookie: who.startsWith('gymsid=') ? who : cookie(who) } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
const subsOf = uid => { db.initDatabase(); try { return db.getSubscriptionsByUserId(uid).map(s => s.endpoint); } finally { db.closeDatabase(); } };
const attempts = uid => (serverLog.match(new RegExp(`push send failed ${uid} `, 'g')) || []).length;
const wait = ms => new Promise(r => setTimeout(r, ms));

before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL('./server.js', import.meta.url))], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), LICENSE_EXPIRES_AT: '' }, stdio: ['ignore', 'pipe', 'pipe']
  });
  server.stderr.on('data', d => { serverLog += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('el server no arrancó:\n' + serverLog)), 15000);
    server.stdout.on('data', d => { if (String(d).includes('gym-api on')) { clearTimeout(timer); resolve(); } });
    server.on('exit', code => reject(new Error(`el server terminó (${code}):\n${serverLog}`)));
  });
});
after(async () => {
  if (server && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('sendPush: a una cuenta activa se intenta; a una pendiente (con sesión) no', async () => {
  await call('act', 'POST', '/api/push/test', {});
  await call('pend', 'POST', '/api/push/test', {});
  await wait(50);
  assert.equal(attempts('act'), 2);   // sus dos dispositivos
  assert.equal(attempts('pend'), 0);
  assert.equal(subsOf('pend').length, 1);   // la pendiente conserva la suscripción: al habilitarla vuelve a recibir
});

test('desactivar: borra sus suscripciones y la alarma de descanso agendada; /api/me dice account_disabled', async () => {
  assert.equal((await call('rest', 'POST', '/api/push/rest-timer', { seconds: 1 })).status, 200);
  assert.equal((await call('adm', 'POST', '/api/admin/user/disable', { id: 'rest', disabled: true })).status, 200);
  assert.equal((await call('adm', 'POST', '/api/admin/user/disable', { id: 'off', disabled: true })).status, 200);
  await wait(1400);
  assert.equal(attempts('rest'), 0);
  assert.deepEqual(subsOf('off'), []);
  assert.deepEqual(subsOf('rest'), []);
  const me = await call('off', 'GET', '/api/me');
  assert.deepEqual([me.status, me.body.reason], [401, 'account_disabled']);
  // Reactivada: vuelve a tener sesión (las notificaciones las activa de nuevo desde Ajustes).
  await call('adm', 'POST', '/api/admin/user/disable', { id: 'off', disabled: false });
  assert.equal((await call('off', 'GET', '/api/me')).status, 200);
});

test('rechazar: borra sus suscripciones; /api/me dice account_rejected', async () => {
  assert.equal((await call('adm', 'POST', '/api/admin/users/rej/reject', { reason: 'No es socio' })).status, 200);
  assert.deepEqual(subsOf('rej'), []);
  assert.equal((await call('rej', 'GET', '/api/me')).body.reason, 'account_rejected');
});

test('eliminar: sin suscripciones; /api/me dice account_deleted', async () => {
  await call('adm', 'POST', '/api/admin/user/disable', { id: 'gone', disabled: true });
  assert.equal((await call('owner', 'POST', '/api/owner/user/delete', { id: 'gone' })).status, 200);
  assert.deepEqual(subsOf('gone'), []);
  assert.equal((await call('gone', 'GET', '/api/me')).body.reason, 'account_deleted');
});

test('sesión vencida o ausente: session_expired (no es una baja)', async () => {
  assert.equal((await call(null, 'GET', '/api/me')).body.reason, 'session_expired');
  assert.equal((await call('gymsid=basura.firma', 'GET', '/api/me')).body.reason, 'session_expired');
  assert.equal((await call(cookie('act', 7), 'GET', '/api/me')).body.reason, 'session_expired');   // sv viejo (cerró todas)
});

test('logout con el endpoint del dispositivo: borra esa suscripción de la cuenta, no las otras ni las ajenas', async () => {
  await call('act', 'POST', '/api/logout', { endpoint: 'https://push.no-permitido.example/pend' });   // ajena: no se toca
  assert.equal(subsOf('pend').length, 1);
  await call('act', 'POST', '/api/logout', { endpoint: 'https://push.no-permitido.example/act' });
  assert.deepEqual(subsOf('act'), ['https://push.no-permitido.example/act-2']);
});
