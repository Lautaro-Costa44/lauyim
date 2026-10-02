// Clases desde el panel, sobre server.js de verdad: permisos (todas, las suyas, ver, anotar,
// tomar lista), superposición (bloquea o avisa), cambios de una fecha, quitar una suspendida de
// la vista, anotar a mano y ajustes del owner.
// Puertos 50000–50900.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-classes-admin-'));
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);
process.env.DATA_DIR = dataDir;

const db = await import('./database.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña', created: Date.now() });
db.createUser({ id: 'admin', name: 'Admin', admin: true, created: Date.now() });
for (const id of ['recep', 'profe', 'coach', 'socio1', 'socio2']) db.createUser({ id, name: { profe: 'Caro', coach: 'Lu' }[id] || id, created: Date.now() });
db.setUserRole('recep', 'reception');
db.setUserRole('coach', 'coach');
const lista = db.saveRole({ name: 'Solo lista', color: '#123456', permissions: ['classes.attendance'] });
db.setUserRole('profe', lista.id);
db.closeDatabase();

const PORT = 50000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
const cookie = uid => {
  const payload = `${uid}:${Date.now() + 3600000}:0`;
  return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
};
async function call(uid, method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Cookie = cookie(uid);
  const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
}

before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL('./server.js', import.meta.url))], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), LICENSE_EXPIRES_AT: '', LICENSE_PAID_UNTIL: '', ADMIN_UIDS: '' },
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

const typeBody = extra => ({ color: '#ff9f0a', durationMin: 60, capacity: 1, room: 'Sala 1', logMode: 'muscles', log: { muscles: ['quadriceps'], intensity: 'high' }, ...extra });
let today, day, weekday, spinning;
const dayAfter = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);

test('permisos: recepción ve pero no crea; con permiso se crean clases; la profe tiene que tener rol', async () => {
  assert.equal((await call('recep', 'GET', '/api/admin/classes/types')).status, 200);
  assert.equal((await call('recep', 'POST', '/api/admin/classes/types/save', typeBody({ name: 'X' }))).status, 403);
  assert.equal((await call('socio1', 'GET', '/api/admin/classes/types')).status, 403);
  const bad = await call('owner', 'POST', '/api/admin/classes/types/save', typeBody({ name: 'Spinning', teacherUserId: 'socio1' }));
  assert.deepEqual([bad.status, bad.body.field], [400, 'teacherUserId']);
  const ok = await call('admin', 'POST', '/api/admin/classes/types/save', typeBody({ name: 'Spinning', teacherUserId: 'profe' }));
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  spinning = ok.body.type;
  assert.equal((await call('profe', 'POST', '/api/admin/classes/types/save', typeBody({ name: 'Otra' }))).status, 403);
  // Sin cupo: capacity null; el cupo, si viene, de 1 a 200.
  const free = await call('owner', 'POST', '/api/admin/classes/types/save', typeBody({ name: 'Libre', room: 'Sala 9', capacity: null }));
  assert.deepEqual([free.status, free.body.type?.capacity], [200, null], JSON.stringify(free.body));
  assert.equal((await call('owner', 'POST', '/api/admin/classes/types/save', typeBody({ name: 'Mal', capacity: 0 }))).body.field, 'capacity');
  const list = await call('profe', 'GET', '/api/admin/classes/types');
  assert.deepEqual(list.body.types.map(t => t.name), ['Spinning']);
  const teachers = (await call('owner', 'GET', '/api/admin/classes/types')).body.teachers;
  assert.ok(teachers.some(t => t.id === 'profe' && t.name === 'Caro'));
  assert.ok(!teachers.some(t => t.id === 'socio1'));
});

test('horario y superposición: bloquea en la misma sala, avisa si se permite y con la misma profe', async () => {
  const cal = await call('owner', 'GET', '/api/admin/classes/calendar');
  today = cal.body.today;
  day = dayAfter(today, 2);
  weekday = new Date(day + 'T12:00:00Z').getUTCDay();
  const slot = await call('owner', 'POST', '/api/admin/classes/slots/save', { classId: spinning.id, weekday, start: '19:00' });
  assert.equal(slot.status, 200, JSON.stringify(slot.body));
  const pilates = (await call('owner', 'POST', '/api/admin/classes/types/save', typeBody({ name: 'Pilates', teacherName: 'Ana' }))).body.type;
  const clash = await call('owner', 'POST', '/api/admin/classes/slots/save', { classId: pilates.id, weekday, start: '19:30' });
  assert.equal(clash.status, 409);
  assert.equal(clash.body.error, 'class_overlap');
  assert.match(clash.body.conflicts[0].text, /^Ya hay Spinning el \S+ de 19:00 a 20:00 en Sala 1, con Caro\.$/);
  // overlap-check avisa lo mismo sin guardar.
  const check = await call('owner', 'POST', '/api/admin/classes/overlap-check', { classId: pilates.id, weekday, start: '19:30', durationMin: 60, room: 'Sala 1', teacherName: 'Ana' });
  assert.equal(check.body.blocking.length, 1);
  // Permitida: guarda y avisa.
  assert.equal((await call('admin', 'PUT', '/api/owner/classes/settings', { allowOverlap: true })).status, 403);
  assert.equal((await call('owner', 'PUT', '/api/owner/classes/settings', { allowOverlap: true })).status, 200);
  const allowed = await call('owner', 'POST', '/api/admin/classes/slots/save', { classId: pilates.id, weekday, start: '19:30' });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.warnings.length, 1);
  // Misma profe en otra sala: aviso aunque no se permita.
  await call('owner', 'PUT', '/api/owner/classes/settings', { allowOverlap: false });
  const yoga = (await call('owner', 'POST', '/api/admin/classes/types/save', typeBody({ name: 'Yoga', room: 'Sala 3', teacherUserId: 'profe' }))).body.type;
  const same = await call('owner', 'POST', '/api/admin/classes/slots/save', { classId: yoga.id, weekday, start: '19:15' });
  assert.equal(same.status, 200);
  assert.ok(same.body.warnings.some(w => w.reason === 'teacher' && /^Caro ya da Spinning/.test(w.text)));
});

test('calendario: la profe solo con tomar lista ve solo sus clases; con permiso, todas', async () => {
  const all = await call('owner', 'GET', `/api/admin/classes/calendar?from=${day}&days=1`);
  assert.deepEqual(all.body.occurrences.map(o => o.name).sort(), ['Pilates', 'Spinning', 'Yoga']);
  const recep = await call('recep', 'GET', `/api/admin/classes/calendar?from=${day}&days=1`);
  assert.deepEqual(recep.body.occurrences.map(o => [o.name, o.editable, o.canBook]).sort(), [['Pilates', false, true], ['Spinning', false, true], ['Yoga', false, true]]);
  const mine = await call('profe', 'GET', `/api/admin/classes/calendar?from=${day}&days=1`);
  assert.deepEqual(mine.body.occurrences.map(o => o.name).sort(), ['Spinning', 'Yoga']);
  assert.equal(mine.body.canManage, false);
  const spin = all.body.occurrences.find(o => o.name === 'Spinning');
  assert.deepEqual({ start: spin.start, end: spin.end, teacher: spin.teacherName, capacity: spin.capacity, booked: spin.booked }, { start: '19:00', end: '20:00', teacher: 'Caro', capacity: 1, booked: 0 });
});

test('anotar a mano aunque esté lleno y ver la lista', async () => {
  const cal = await call('owner', 'GET', `/api/admin/classes/calendar?from=${day}&days=1`);
  const spin = cal.body.occurrences.find(o => o.name === 'Spinning');
  for (const userId of ['socio1', 'socio2']) {
    const r = await call('profe', 'POST', '/api/admin/classes/sessions/add', { slotId: spin.slotId, date: day, userId });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }
  const after = (await call('owner', 'GET', `/api/admin/classes/calendar?from=${day}&days=1`)).body.occurrences.find(o => o.name === 'Spinning');
  assert.equal(after.booked, 2);
  const detail = await call('profe', 'GET', `/api/admin/classes/session?sessionId=${after.sessionId}`);
  assert.deepEqual(detail.body.booked.map(b => b.name).sort(), ['socio1', 'socio2']);
  // La de Pilates no es suya; recepción anota en cualquiera.
  const pil = cal.body.occurrences.find(o => o.name === 'Pilates');
  assert.equal((await call('profe', 'POST', '/api/admin/classes/sessions/add', { slotId: pil.slotId, date: day, userId: 'socio1' })).status, 403);
  assert.equal((await call('recep', 'POST', '/api/admin/classes/sessions/add', { slotId: pil.slotId, date: day, userId: 'socio1' })).status, 200);
});

test('profe con "sus clases": crea siendo la profe, edita solo las suyas y no cambia profes', async () => {
  // Aunque mande otra profe, la clase queda a su nombre.
  const own = await call('coach', 'POST', '/api/admin/classes/types/save', typeBody({ name: 'Funcional', room: 'Sala 4', teacherUserId: 'profe' }));
  assert.equal(own.status, 200, JSON.stringify(own.body));
  assert.equal(own.body.type.teacherUserId, 'coach');
  const slot = await call('coach', 'POST', '/api/admin/classes/slots/save', { classId: own.body.type.id, weekday, start: '07:00' });
  assert.equal(slot.status, 200, JSON.stringify(slot.body));
  // Lo de otros: ni la clase, ni el horario, ni una fecha.
  assert.equal((await call('coach', 'POST', '/api/admin/classes/types/save', typeBody({ id: spinning.id, name: 'Spinning 2' }))).status, 403);
  assert.equal((await call('coach', 'POST', '/api/admin/classes/slots/save', { classId: spinning.id, weekday, start: '06:00' })).status, 403);
  const spin = (await call('owner', 'GET', `/api/admin/classes/calendar?from=${day}&days=1`)).body.occurrences.find(o => o.name === 'Spinning');
  assert.equal((await call('coach', 'POST', '/api/admin/classes/sessions/change', { slotId: spin.slotId, date: day, start: '22:00' })).status, 403);
  // Una fecha suya: la hora sí, la profe no.
  const mine = (await call('coach', 'GET', `/api/admin/classes/calendar?from=${day}&days=1`)).body;
  assert.equal(mine.canManage, false);
  assert.deepEqual(mine.occurrences.map(o => [o.name, o.editable]), [['Funcional', true]]);
  const f = mine.occurrences[0];
  assert.equal((await call('coach', 'POST', '/api/admin/classes/sessions/change', { slotId: f.slotId, date: day, start: '07:30' })).status, 200);
  assert.equal((await call('coach', 'POST', '/api/admin/classes/sessions/change', { slotId: f.slotId, date: day, teacherName: 'Otra' })).status, 403);
  const types = (await call('coach', 'GET', '/api/admin/classes/types')).body;
  assert.deepEqual([types.types.map(tp => tp.name), types.teachers, types.canManage, types.canOwn], [['Funcional'], [], false, true]);
});

test('cambios de una fecha: hora, profe y cancelar', async () => {
  const spin = (await call('owner', 'GET', `/api/admin/classes/calendar?from=${day}&days=1`)).body.occurrences.find(o => o.name === 'Spinning');
  assert.equal((await call('profe', 'POST', '/api/admin/classes/sessions/change', { slotId: spin.slotId, date: day, start: '21:00' })).status, 403);
  const moved = await call('owner', 'POST', '/api/admin/classes/sessions/change', { slotId: spin.slotId, date: day, start: '21:00' });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  assert.deepEqual([moved.body.occurrence.start, moved.body.occurrence.movedFrom], ['21:00', '19:00']);
  const teacher = await call('owner', 'POST', '/api/admin/classes/sessions/change', { slotId: spin.slotId, date: day, teacherUserId: null, teacherName: 'Juli' });
  assert.equal(teacher.body.occurrence.teacherName, 'Juli');
  const cancelled = await call('owner', 'POST', '/api/admin/classes/sessions/change', { slotId: spin.slotId, date: day, cancelled: true });
  assert.equal(cancelled.body.occurrence.cancelled, true);
  const detail = await call('owner', 'GET', `/api/admin/classes/session?sessionId=${spin.sessionId}`);
  assert.deepEqual(detail.body.booked, []);
  // Suspendida: se puede sacar del calendario (una activa, no).
  const pil = (await call('owner', 'GET', `/api/admin/classes/calendar?from=${day}&days=1`)).body.occurrences.find(o => o.name === 'Pilates');
  assert.equal((await call('owner', 'POST', '/api/admin/classes/sessions/hide', { sessionId: pil.sessionId })).status, 409);
  assert.equal((await call('owner', 'POST', '/api/admin/classes/sessions/hide', { sessionId: spin.sessionId })).status, 200);
  const after = (await call('owner', 'GET', `/api/admin/classes/calendar?from=${day}&days=1`)).body.occurrences.map(o => o.name);
  assert.ok(!after.includes('Spinning'));
  // Clase suelta: otra fecha, otra hora.
  const loose = await call('owner', 'POST', '/api/admin/classes/sessions/change', { classId: spinning.id, date: dayAfter(day, 1), start: '10:00' });
  assert.equal(loose.status, 200, JSON.stringify(loose.body));
  assert.equal(loose.body.occurrence.slotId, null);
});

test('ajustes de clases: solo el owner, con validación; /api/config dice si está prendido', async () => {
  assert.equal((await call('admin', 'GET', '/api/owner/classes/settings')).status, 403);
  const bad = await call('owner', 'PUT', '/api/owner/classes/settings', { bookAheadDays: 0 });
  assert.deepEqual([bad.status, bad.body.field], [400, 'bookAheadDays']);
  const off = await call('owner', 'PUT', '/api/owner/classes/settings', { enabled: false });
  assert.equal(off.body.settings.enabled, false);
  assert.equal((await call(null, 'GET', '/api/config')).body.classes_enabled, false);
  await call('owner', 'PUT', '/api/owner/classes/settings', { enabled: true });
  assert.equal((await call(null, 'GET', '/api/config')).body.classes_enabled, true);
  // Archivar: deja de aparecer en la lista.
  const yoga = (await call('owner', 'GET', '/api/admin/classes/types')).body.types.find(t => t.name === 'Yoga');
  assert.equal((await call('owner', 'POST', '/api/admin/classes/types/archive', { id: yoga.id })).status, 200);
  assert.ok(!(await call('owner', 'GET', '/api/admin/classes/types')).body.types.some(t => t.name === 'Yoga'));
});
