// Después de la clase, sobre server.js de verdad: "¿Fuiste?" y su respuesta con estrellas, el
// entrenamiento para el historial una sola vez, tomar lista, estadísticas y penalización.
// Puertos 52000–52900.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gymToday, gymClock } from './billing.js';
import { addDays, addMinutes, weekdayOf } from './classes.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-classes-after-'));
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);
process.env.DATA_DIR = dataDir;

const today = gymToday(Date.now(), 'America/Argentina/Buenos_Aires');
const yesterday = addDays(today, -1);
const db = await import('./database.js');
const cdb = await import('./classes-db.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña', created: Date.now() });
for (const id of ['profe', 'ana', 'beto', 'caro']) db.createUser({ id, name: id, created: Date.now() });
db.setUserRole('profe', 'coach');
const spinning = cdb.saveClassType({ name: 'Spinning', color: '#ff9f0a', icon: 'bike', description: '', durationMin: 45, capacity: 10, teacherUserId: 'profe', teacherName: '', room: 'Sala 2', logMode: 'muscles', log: { muscles: ['quadriceps'], intensity: 'high' } });
const slot = cdb.saveClassSlot({ classId: spinning.id, weekday: weekdayOf(yesterday), start: '10:00' });
const session = cdb.ensureClassSession({ classId: spinning.id, slotId: slot.id, date: yesterday, start: '10:00' });
const ids = {};
for (const u of ['ana', 'beto', 'caro']) ids[u] = cdb.bookOrWaitlist({ sessionId: session.id, userId: u, capacity: 10 }).booking.id;
// La profe quedó anotada a su propia clase (antes se podía): no cuenta para cupo, lista ni estadísticas.
ids.profe = cdb.bookOrWaitlist({ sessionId: session.id, userId: 'profe', capacity: 10 }).booking.id;
cdb.updateBooking(ids.profe, { status: 'attended', attendanceSource: 'member', rating: 1 });
// Caro faltó tres veces en la última semana (para la penalización).
for (let i = 2; i <= 4; i++) {
  const s = cdb.ensureClassSession({ classId: spinning.id, slotId: null, date: addDays(today, -i), start: '08:00' });
  const { booking } = cdb.bookOrWaitlist({ sessionId: s.id, userId: 'caro', capacity: 10 });
  cdb.updateBooking(booking.id, { status: 'absent', attendanceSource: 'timeout' });
}
// Una clase en curso (empezó hace 10 minutos), con Ana anotada.
const clockNow = gymClock(Date.now(), 'America/Argentina/Buenos_Aires');
const liveOk = clockNow.time >= '00:20';   // pasada la medianoche no hay "hace 10 minutos" el mismo día
const live = liveOk ? cdb.ensureClassSession({ classId: spinning.id, slotId: null, date: today, start: addMinutes(clockNow.time, -10) }) : null;
if (live) ids.live = cdb.bookOrWaitlist({ sessionId: live.id, userId: 'ana', capacity: 10 }).booking.id;
// Una clase de mañana para intentar reservar.
const tomorrowSlot = cdb.saveClassSlot({ classId: spinning.id, weekday: weekdayOf(addDays(today, 1)), start: '10:00' });
db.closeDatabase();

const PORT = 52000 + Math.floor(Math.random() * 900);
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

test('"¿Fuiste?": se pregunta, sí con estrellas devuelve el entrenamiento, y se marca en el historial', async () => {
  const pending = (await call('ana', 'GET', '/api/classes/pending')).body;
  assert.deepEqual(pending.ask.map(a => [a.bookingId, a.name, a.date]), [[ids.ana, 'Spinning', yesterday]]);
  const r = await call('ana', 'POST', '/api/classes/attendance', { bookingId: ids.ana, attended: true, rating: 5 });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual({ kind: r.body.workout.kind, name: r.body.workout.name, load: r.body.workout.muscleLoad, d: r.body.workout.d }, { kind: 'class', name: 'Spinning', load: { muscles: ['quadriceps'], intensity: 'high' }, d: yesterday });
  // Ya contestó: no se pregunta más, queda para sumar al historial hasta que la app avise.
  const again = (await call('ana', 'GET', '/api/classes/pending')).body;
  assert.deepEqual([again.ask.length, again.log.map(l => l.bookingId)], [0, [ids.ana]]);
  assert.equal((await call('ana', 'POST', '/api/classes/logged', { bookingId: ids.ana })).status, 200);
  assert.equal((await call('ana', 'GET', '/api/classes/pending')).body.log.length, 0);
  assert.equal((await call('beto', 'POST', '/api/classes/attendance', { bookingId: ids.ana, attended: true })).status, 404);
});

test('tomar lista: la profe marca presente y ausente; el presente queda para el historial sin preguntar', async () => {
  assert.equal((await call('ana', 'POST', '/api/admin/classes/sessions/attendance', { sessionId: session.id, present: ['beto'] })).status, 403);
  const r = await call('profe', 'POST', '/api/admin/classes/sessions/attendance', { sessionId: session.id, present: ['beto'], absent: ['caro'] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const beto = (await call('beto', 'GET', '/api/classes/pending')).body;
  assert.deepEqual([beto.ask.length, beto.log.map(l => [l.bookingId, l.source, l.rated])], [0, [[ids.beto, 'teacher', false]]]);
  assert.equal((await call('beto', 'POST', '/api/classes/rating', { bookingId: ids.beto, rating: 3 })).status, 200);
  assert.equal((await call('caro', 'POST', '/api/classes/attendance', { bookingId: ids.caro, attended: true })).status, 409);
  const detail = (await call('profe', 'GET', `/api/admin/classes/session?sessionId=${session.id}`)).body;
  assert.equal(detail.canTakeAttendance, true);
  assert.deepEqual(detail.booked.map(p => [p.userId, p.status]).sort(), [['ana', 'attended'], ['beto', 'attended'], ['caro', 'absent']]);
});

test('estadísticas: promedio solo de quienes calificaron', async () => {
  const stats = (await call('owner', 'GET', '/api/admin/classes/stats')).body;
  const spin = stats.classes.find(c => c.name === 'Spinning');
  assert.deepEqual({ present: spin.present, rating: spin.rating, ratings: spin.ratings }, { present: 2, rating: 4, ratings: 2 });
  assert.deepEqual(stats.teachers.map(t => [t.name, t.rating]), [['profe', 4]]);
  assert.equal((await call('ana', 'GET', '/api/admin/classes/stats')).status, 403);
});

test('penalización: prendida, quien faltó de más no reserva y ve hasta cuándo', async () => {
  const s = (await call('owner', 'GET', '/api/owner/classes/settings')).body.settings;
  assert.equal((await call('owner', 'PUT', '/api/owner/classes/settings', { ...s, penalty: { on: true, absences: 3, windowDays: 30, blockDays: 7 } })).status, 200);
  const r = await call('caro', 'POST', '/api/classes/book', { slotId: tomorrowSlot.id, date: addDays(today, 1) });
  assert.deepEqual([r.status, r.body.error, r.body.count], [403, 'booking_penalty', 4]);
  assert.equal((await call('caro', 'GET', '/api/classes')).body.penalty.until, addDays(yesterday, 7));
  assert.equal((await call('ana', 'POST', '/api/classes/book', { slotId: tomorrowSlot.id, date: addDays(today, 1) })).status, 200);
});

test('después de tomar lista el cupo sigue contando a presentes y ausentes', async () => {
  const cal = (await call('owner', 'GET', `/api/admin/classes/calendar?from=${yesterday}&days=1`)).body;
  assert.equal(cal.occurrences.find(o => o.sessionId === session.id).booked, 3);
});

test('la profe no se anota a la clase que da y no cuenta en la asistencia', async () => {
  const tomorrow = addDays(today, 1);
  const r = await call('profe', 'POST', '/api/classes/book', { slotId: tomorrowSlot.id, date: tomorrow });
  assert.deepEqual([r.status, r.body.error], [409, 'own_class']);
  const mine = (await call('profe', 'GET', `/api/classes?from=${tomorrow}&days=1`)).body.occurrences.find(o => o.slotId === tomorrowSlot.id);
  assert.equal(mine.teaching, true);
  // Su reserva vieja no le aparece como propia (Inicio no la muestra como "Tu próxima clase").
  const old = (await call('profe', 'GET', `/api/classes?from=${yesterday}&days=1`)).body.occurrences.find(o => o.sessionId === session.id);
  assert.deepEqual([old.teaching, old.myBooking, old.booked], [true, null, 3]);
  assert.deepEqual((await call('profe', 'POST', '/api/classes/book-week', { classId: spinning.id })).body, { booked: 0, waitlist: 0 });
  const add = await call('owner', 'POST', '/api/admin/classes/sessions/add', { slotId: tomorrowSlot.id, date: tomorrow, userId: 'profe' });
  assert.deepEqual([add.status, add.body.error], [409, 'own_class']);
  // Su reserva vieja de ayer: ni en la lista, ni en "¿Fuiste?".
  const detail = (await call('profe', 'GET', `/api/admin/classes/session?sessionId=${session.id}`)).body;
  assert.ok(!detail.booked.some(p => p.userId === 'profe'));
  assert.equal((await call('profe', 'GET', '/api/classes/pending')).body.log.length, 0);
});

test('mensaje de la profe: a los anotados (y a la lista de espera si quiere), con límite por fecha', async () => {
  const tomorrow = addDays(today, 1);
  const occ = (await call('owner', 'GET', `/api/admin/classes/calendar?from=${tomorrow}&days=1`)).body.occurrences.find(o => o.slotId === tomorrowSlot.id);
  const body = extra => ({ sessionId: occ.sessionId, text: 'Traigan toalla', ...extra });
  assert.equal((await call('ana', 'POST', '/api/admin/classes/sessions/message', body())).status, 403);
  assert.equal((await call('profe', 'POST', '/api/admin/classes/sessions/message', body({ text: '   ' }))).status, 400);
  assert.equal((await call('profe', 'POST', '/api/admin/classes/sessions/message', body({ text: 'x'.repeat(201) }))).status, 400);
  const detail = (await call('profe', 'GET', `/api/admin/classes/session?sessionId=${occ.sessionId}`)).body;
  assert.equal(detail.canMessage, true);
  for (let i = 0; i < 3; i++) {
    const r = await call('profe', 'POST', '/api/admin/classes/sessions/message', body({ waitlist: true }));
    assert.deepEqual([r.status, r.body.sent], [200, 1], JSON.stringify(r.body));   // ana (la única anotada)
  }
  const limit = await call('profe', 'POST', '/api/admin/classes/sessions/message', body());
  assert.deepEqual([limit.status, limit.body.error], [429, 'message_limit']);
  // Una clase que ya pasó: no.
  const old = await call('profe', 'POST', '/api/admin/classes/sessions/message', { sessionId: session.id, text: 'Gracias' });
  assert.deepEqual([old.status, old.body.error], [409, 'class_over']);
});

test('ficha del socio: el último mes, la penalización (que se levanta) y cancelar una reserva', async () => {
  assert.equal((await call('ana', 'GET', '/api/admin/classes/member?userId=caro')).status, 403);
  const before = (await call('owner', 'GET', '/api/admin/classes/member?userId=caro')).body;
  assert.deepEqual({ absent: before.month.absent, present: before.month.present, rate: before.month.rate }, { absent: 4, present: 0, rate: 0 });
  assert.deepEqual([before.penalty?.count, before.canReset, before.canCancel], [4, true, true]);
  assert.equal((await call('ana', 'POST', '/api/admin/classes/member/penalty-reset', { userId: 'caro' })).status, 403);
  assert.equal((await call('owner', 'POST', '/api/admin/classes/member/penalty-reset', { userId: 'caro' })).status, 200);
  assert.equal((await call('owner', 'GET', '/api/admin/classes/member?userId=caro')).body.penalty, null);
  // Ya puede reservar; el staff le cancela el lugar desde la ficha.
  const tomorrow = addDays(today, 1);
  const booked = await call('caro', 'POST', '/api/classes/book', { slotId: tomorrowSlot.id, date: tomorrow });
  assert.equal(booked.status, 200, JSON.stringify(booked.body));
  const card = (await call('owner', 'GET', '/api/admin/classes/member?userId=caro')).body;
  assert.deepEqual(card.upcoming.map(u => [u.name, u.date, u.status]), [['Spinning', tomorrow, 'booked']]);
  const cancel = await call('owner', 'POST', '/api/admin/classes/member/cancel', { bookingId: card.upcoming[0].bookingId });
  assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
  assert.deepEqual((await call('owner', 'GET', '/api/admin/classes/member?userId=caro')).body.upcoming, []);
  assert.equal((await call('owner', 'POST', '/api/admin/classes/member/cancel', { bookingId: 'nada' })).status, 404);
});

test('clase en curso: aunque la profe ya tomó lista, no se suma al historial hasta que termina', async (t) => {
  if (!live) return t.skip('pasada la medianoche');
  assert.equal((await call('profe', 'POST', '/api/admin/classes/sessions/attendance', { sessionId: live.id, present: ['ana'] })).status, 200);
  const pending = (await call('ana', 'GET', '/api/classes/pending')).body;
  assert.ok(!pending.log.some(l => l.bookingId === ids.live));
});

test('corregir la lista: presente a ausente saca la clase del historial y borra la calificación; vuelve si la marcan presente', async () => {
  // Ana fue a la de ayer, calificó con 5 y ya la tiene en el historial (logged).
  const absent = await call('profe', 'POST', '/api/admin/classes/sessions/attendance', { sessionId: session.id, absent: ['ana'] });
  assert.equal(absent.status, 200);
  const pending = (await call('ana', 'GET', '/api/classes/pending')).body;
  assert.deepEqual(pending.unlog, [ids.ana]);
  assert.equal((await call('ana', 'GET', `/api/classes/booking?id=${ids.ana}`)).body.booking.rating, null);
  assert.equal((await call('ana', 'POST', '/api/classes/logged', { bookingId: ids.ana, logged: false })).status, 200);
  assert.deepEqual((await call('ana', 'GET', '/api/classes/pending')).body.unlog, []);
  await call('profe', 'POST', '/api/admin/classes/sessions/attendance', { sessionId: session.id, present: ['ana'] });
  assert.ok((await call('ana', 'GET', '/api/classes/pending')).body.log.some(l => l.bookingId === ids.ana));
});
