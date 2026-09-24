// Levanta server.js de verdad y prueba la validación de /api/push/subscribe:
// solo se guardan endpoints https de servicios de push conocidos.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-push-sub-http-'));
process.env.DATA_DIR = dataDir;
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);

const db = await import('./database.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña', created: Date.now() });
db.createUser({ id: 'm1', name: 'Socio Uno', created: Date.now() });
db.closeDatabase();

const PORT = 44000 + Math.floor(Math.random() * 2000);
let server;

// Misma cookie que makeSession() en server.js: uid:exp:sv firmado con el secret de DATA_DIR.
function cookie(uid) {
  const payload = `${uid}:${Date.now() + 3600000}:0`;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
const keys = {
  p256dh: crypto.createECDH('prime256v1').generateKeys().toString('base64url'),
  auth: crypto.randomBytes(16).toString('base64url')
};
async function subscribe(endpoint, k = keys) {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/push/subscribe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie('m1') },
    body: JSON.stringify({ subscription: { endpoint, keys: k } })
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL('./server.js', import.meta.url))], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), LICENSE_EXPIRES_AT: '', PUSH_HOST_ALLOWLIST: '' },
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
  // Esperar a que el proceso suelte gym.db: en Windows borrar un archivo abierto falla.
  if (server && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('subscribe acepta servicios de push conocidos', async () => {
  for (const ep of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://wns2-by3p.notify.windows.com/w/?token=abc', 'https://web.push.apple.com/abc']) {
    assert.deepEqual(await subscribe(ep), { status: 200, body: { ok: true } }, ep);
  }
});

test('subscribe rechaza hosts desconocidos, IPs privadas, http, otro puerto y claves largas', async () => {
  const cases = [
    ['https://attacker.example/push', 'endpoint host is not a known push service'],
    ['https://fcm.googleapis.com.evil.com/x', 'endpoint host is not a known push service'],
    ['https://169.254.169.254/latest/meta-data', 'endpoint must not point at a private address'],
    ['https://[::ffff:127.0.0.1]/x', 'endpoint must not point at a private address'],
    ['http://fcm.googleapis.com/x', 'endpoint must be an https:// URL'],
    ['https://fcm.googleapis.com:8443/x', 'endpoint must use the default https port'],
    ['https://fcm.googleapis.com/' + 'a'.repeat(2048), 'endpoint is too long']
  ];
  for (const [ep, error] of cases) assert.deepEqual(await subscribe(ep), { status: 400, body: { error } }, ep);
  const longKey = await subscribe('https://fcm.googleapis.com/fcm/send/k', { p256dh: 'a'.repeat(129), auth: keys.auth });
  assert.deepEqual(longKey, { status: 400, body: { error: 'invalid subscription' } });
});
