// Clases para el socio, sobre server.js de verdad: ver las fechas sin nombres ajenos, reservar con
// cupo y lista de espera, cuota vencida, cancelar a tiempo y sube el primero, recordatorios,
// reserva fija y .ics. Puertos 51000–51900.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gymToday } from './billing.js';
import { addDays, weekdayOf } from './classes.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-classes-member-'));
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);
process.env.DATA_DIR = dataDir;

const today = gymToday(Date.now(), 'America/Argentina/Buenos_Aires');
const day = addDays(today, 2);        // una fecha dentro de la ventana de 7 días
const farDay = addDays(today, 9);     // fuera de la ventana
const db = await import('./database.js');
const cdb = await import('./classes-db.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña', created: Date.now() });
for (const id of ['ana', 'beto', 'caro', 'eva', 'lim', 'moroso']) db.createUser({ id, name: id === 'ana' ? 'Ana Pérez' : id, created: Date.now() });
const plan = db.createPlan({ name: 'Mensual', price: 20000, durationDays: 30 });
const onePerWeek = db.createPlan({ name: '1 por semana', price: 10000, durationDays: 30, classLimit: 1, classPeriod: 'week' });
for (const [id, due] of [['ana', 20], ['beto', 20], ['caro', 20], ['eva', 20], ['moroso', -10]]) db.setMemberBilling(id, { planId: plan.id, dueDate: addDays(today, due) });
db.setMemberBilling('lim', { planId: onePerWeek.id, dueDate: addDays(today, 20) });
const spinning = cdb.saveClassType({ name: 'Spinning', color: '#ff9f0a', icon: 'bike', description: 'Pedaleo', durationMin: 45, capacity: 1, teacherUserId: null, teacherName: 'Caro', room: 'Sala 2', logMode: 'muscles', log: { muscles: ['quadriceps'], intensity: 'high' } });
const slot = cdb.saveClassSlot({ classId: spinning.id, weekday: weekdayOf(day), start: '19:00' });
const otherSlot = cdb.saveClassSlot({ classId: spinning.id, weekday: weekdayOf(addDays(today, 3)), start: '08:00' });
// Sin cupo: se anota quien quiera.
const yoga = cdb.saveClassType({ name: 'Yoga', color: '#30d158', icon: 'yoga', description: '', durationMin: 60, capacity: null, teacherUserId: null, teacherName: 'Lu', room: 'Sala 3', logMode: 'muscles', log: { muscles: ['abs'], intensity: 'low' } });
const yogaSlot = cdb.saveClassSlot({ classId: yoga.id, weekday: weekdayOf(day), start: '07:00' });
db.closeDatabase();

const PORT = 51000 + Math.floor(Math.random() * 900);
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
  const type = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, body: type.includes('json') ? await res.json() : await res.text() };
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

const list = async (uid, from = today, days = 7) => (await call(uid, 'GET', `/api/classes?from=${from}&days=${days}`)).body;
const occOn = async (uid, date) => (await list(uid, date, 1)).occurrences.find(o => o.slotId === slot.id);

test('ver clases: fechas de la ventana, cupo y sin nombres de otros; /api/config la ofrece', async () => {
  assert.equal((await call(null, 'GET', '/api/classes')).status, 401);
  const cfg = (await call(null, 'GET', '/api/config')).body;
  assert.deepEqual([cfg.classes_enabled, cfg.classes_available], [true, true]);
  const data = await list('ana');
  assert.equal(data.today, today);
  const occ = data.occurrences.find(o => o.date === day && o.slotId === slot.id);
  assert.deepEqual({ name: occ.name, start: occ.start, end: occ.end, teacher: occ.teacherName, room: occ.room, capacity: occ.capacity, booked: occ.booked, state: occ.state, myBooking: occ.myBooking },
    { name: 'Spinning', start: '19:00', end: '19:45', teacher: 'Caro', room: 'Sala 2', capacity: 1, booked: 0, state: 'open', myBooking: null });
  assert.deepEqual(occ.log, { muscles: ['quadriceps'], intensity: 'high' });
  assert.equal((await occOn('ana', farDay)).state, 'not_yet');
});

test('reservar: con lugar, lleno a la lista de espera, repetida y fuera de la ventana', async () => {
  const a = await call('ana', 'POST', '/api/classes/book', { slotId: slot.id, date: day });
  assert.equal(a.status, 200, JSON.stringify(a.body));
  assert.deepEqual([a.body.booking.status, a.body.booking.reminders], ['booked', [60]]);
  const b = await call('beto', 'POST', '/api/classes/book', { slotId: slot.id, date: day });
  assert.deepEqual([b.body.booking.status, b.body.booking.waitlistPos], ['waitlist', 1]);
  assert.equal((await call('ana', 'POST', '/api/classes/book', { slotId: slot.id, date: day })).body.booking.id, a.body.booking.id);
  const far = await call('ana', 'POST', '/api/classes/book', { slotId: slot.id, date: farDay });
  assert.deepEqual([far.status, far.body.error], [409, 'booking_not_yet']);
  const seen = await occOn('caro', day);
  assert.deepEqual({ booked: seen.booked, waitlist: seen.waitlist, mine: seen.myBooking }, { booked: 1, waitlist: 1, mine: null });
  assert.ok(!JSON.stringify(await list('caro')).includes('Ana Pérez'));
  assert.equal((await occOn('beto', day)).myBooking.waitlistPos, 1);
});

test('cuota vencida no reserva', async () => {
  const r = await call('moroso', 'POST', '/api/classes/book', { slotId: slot.id, date: day });
  assert.deepEqual([r.status, r.body.error], [403, 'membership_blocked']);
});

test('recordatorios: solo los valores posibles y solo de la propia reserva', async () => {
  const mine = (await occOn('ana', day)).myBooking;
  const ok = await call('ana', 'PUT', '/api/classes/reminders', { bookingId: mine.id, reminders: [15, 300, 15] });
  assert.deepEqual(ok.body.booking.reminders, [300, 15]);
  assert.equal((await call('ana', 'PUT', '/api/classes/reminders', { bookingId: mine.id, reminders: [45] })).status, 400);
  assert.equal((await call('beto', 'PUT', '/api/classes/reminders', { bookingId: mine.id, reminders: [60] })).status, 404);
});

test('.ics de la propia reserva', async () => {
  const mine = (await occOn('ana', day)).myBooking;
  const ics = await call('ana', 'GET', `/api/classes/ics?booking=${mine.id}`);
  assert.equal(ics.status, 200);
  assert.match(ics.headers.get('content-type'), /text\/calendar/);
  assert.match(ics.headers.get('content-disposition'), /^inline/);
  assert.match(ics.body, /SUMMARY:Spinning/);
  assert.match(ics.body, new RegExp(`DTSTART;TZID=America/Argentina/Buenos_Aires:${day.replace(/-/g, '')}T190000`));
  assert.equal((await call('beto', 'GET', `/api/classes/ics?booking=${mine.id}`)).status, 404);
});

test('cancelar a tiempo libera el lugar y sube la primera de la lista', async () => {
  const mine = (await occOn('ana', day)).myBooking;
  assert.equal((await call('beto', 'POST', '/api/classes/cancel', { bookingId: mine.id })).status, 404);
  const out = await call('ana', 'POST', '/api/classes/cancel', { bookingId: mine.id });
  assert.deepEqual([out.status, out.body.kind], [200, 'cancelled']);
  const beto = (await occOn('beto', day)).myBooking;
  assert.deepEqual([beto.status, beto.waitlistPos], ['booked', null]);
  // Vuelve a reservar: ahora a la lista.
  assert.equal((await call('ana', 'POST', '/api/classes/book', { slotId: slot.id, date: day })).body.booking.status, 'waitlist');
});

test('reserva fija: reserva las fechas abiertas del bloque y no vuelve a reservar una cancelada', async () => {
  const r = await call('caro', 'POST', '/api/classes/recurring', { slotId: otherSlot.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.ok(r.body.booked >= 1);
  const data = await list('caro');
  const fixed = data.occurrences.filter(o => o.slotId === otherSlot.id && o.state === 'open');
  assert.ok(fixed.every(o => o.recurring && o.myBooking?.status === 'booked'));
  // Cancela una fecha suelta: el fijo sigue y no la vuelve a reservar.
  const first = fixed[0];
  await call('caro', 'POST', '/api/classes/cancel', { bookingId: first.myBooking.id });
  await call('caro', 'POST', '/api/classes/recurring', { slotId: otherSlot.id });
  assert.equal((await occOn('caro', first.date)) ?? null, null);   // otro bloque: occOn mira el primero
  const again = (await list('caro', first.date, 1)).occurrences.find(o => o.slotId === otherSlot.id);
  assert.equal(again.myBooking.status, 'cancelled');
  assert.equal(again.recurring, true);
  assert.equal((await call('caro', 'POST', '/api/classes/recurring/delete', { slotId: otherSlot.id })).status, 200);
  assert.equal((await list('caro', first.date, 1)).occurrences.find(o => o.slotId === otherSlot.id).recurring, false);
});

test('recordatorios de entrada: se guardan y las reservas nuevas los usan', async () => {
  assert.equal((await call('caro', 'PUT', '/api/classes/reminder-defaults', { reminders: [7] })).status, 400);
  const saved = await call('caro', 'PUT', '/api/classes/reminder-defaults', { reminders: [15, 120] });
  assert.deepEqual(saved.body.reminderDefaults, [120, 15]);
  assert.deepEqual((await list('caro')).reminderDefaults, [120, 15]);
  const r = await call('caro', 'POST', '/api/classes/book', { slotId: slot.id, date: day });
  assert.deepEqual(r.body.booking.reminders, [120, 15]);
});

test('los días de cada clase vienen con la lista, marcados si son fijos', async () => {
  await call('eva', 'POST', '/api/classes/recurring', { slotId: otherSlot.id });
  const slots = (await list('eva')).slots.filter(s => s.classId === spinning.id);
  assert.deepEqual(slots.map(s => [s.id, s.start, s.recurring]).sort(), [[otherSlot.id, '08:00', true], [slot.id, '19:00', false]].sort());
  assert.equal(slots.find(s => s.id === slot.id).weekday, weekdayOf(day));
  await call('eva', 'POST', '/api/classes/recurring/delete', { slotId: otherSlot.id });
});

test('anotarme a todas esta semana: cada fecha abierta de la clase, las llenas a la lista de espera', async () => {
  assert.equal((await call('eva', 'POST', '/api/classes/book-week', { classId: 'nada' })).status, 404);
  assert.equal((await call('moroso', 'POST', '/api/classes/book-week', { classId: spinning.id })).status, 403);
  const r = await call('eva', 'POST', '/api/classes/book-week', { classId: spinning.id });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  // Los dos bloques caen una vez en los próximos 7 días; la otra fecha ya la tenía (fija).
  const mine = (await list('eva')).occurrences.filter(o => o.classId === spinning.id && ['booked', 'waitlist'].includes(o.myBooking?.status));
  assert.deepEqual(mine.map(o => o.slotId).sort(), [otherSlot.id, slot.id].sort());
  assert.equal(r.body.booked + r.body.waitlist, mine.filter(o => o.slotId === slot.id).length);
  assert.equal(mine.find(o => o.slotId === slot.id).myBooking.status, 'waitlist');   // cupo 1, lleno
  // Repetirlo no duplica nada.
  assert.deepEqual((await call('eva', 'POST', '/api/classes/book-week', { classId: spinning.id })).body, { booked: 0, waitlist: 0 });
});

test('clase sin cupo: todos reservan, nadie queda en lista de espera', async () => {
  for (const uid of ['ana', 'beto', 'caro', 'eva']) {
    const r = await call(uid, 'POST', '/api/classes/book', { slotId: yogaSlot.id, date: day });
    assert.deepEqual([r.status, r.body.booking?.status], [200, 'booked'], JSON.stringify(r.body));
  }
  const occ = (await list('ana', day, 1)).occurrences.find(o => o.slotId === yogaSlot.id);
  assert.deepEqual([occ.capacity, occ.booked, occ.waitlist], [null, 4, 0]);
});

test('aviso a la profe: el ajuste se guarda solo con valores posibles', async () => {
  assert.equal((await list('caro')).teacherReminder, 60);
  assert.equal((await call('caro', 'PUT', '/api/classes/teacher-reminder', { minutes: 45 })).status, 400);
  assert.equal((await call('caro', 'PUT', '/api/classes/teacher-reminder', { minutes: 0 })).status, 200);
  assert.equal((await list('caro')).teacherReminder, 0);
});

test('la reserva propia para el historial: fuente, calificación y si se puede calificar', async () => {
  const mine = (await list('eva')).occurrences.find(o => o.slotId === yogaSlot.id && o.myBooking);
  const r = await call('eva', 'GET', `/api/classes/booking?id=${mine.myBooking.id}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual({ status: r.body.booking.status, rating: r.body.booking.rating, canRate: r.body.booking.canRate, name: r.body.occurrence.name, room: r.body.occurrence.room, color: r.body.occurrence.color },
    { status: 'booked', rating: null, canRate: false, name: 'Yoga', room: 'Sala 3', color: '#30d158' });
  assert.equal((await call('ana', 'GET', `/api/classes/booking?id=${mine.myBooking.id}`)).status, 404);
});

test('día cerrado: no se reserva y la lista trae el cierre', async () => {
  const closed = addDays(today, 3);   // el día de otherSlot
  const made = await call('owner', 'POST', '/api/admin/classes/closures', { from: closed, to: closed, reason: 'Feriado' });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const data = await list('ana', closed, 1);
  assert.deepEqual(data.closures.map(c => [c.from, c.reason]), [[closed, 'Feriado']]);
  const occ = data.occurrences.find(o => o.slotId === otherSlot.id);
  assert.deepEqual([occ.cancelled, occ.closed, occ.state], [true, 'Feriado', 'cancelled']);
  const r = await call('ana', 'POST', '/api/classes/book', { slotId: otherSlot.id, date: closed });
  assert.deepEqual([r.status, r.body.error], [409, 'booking_cancelled']);
});

test('límite del plan: bloquea al llegar, la cancelación a tiempo devuelve la clase y el staff puede pasarlo', async () => {
  const yogaOcc = async uid => (await list(uid, day, 1)).occurrences.find(o => o.slotId === yogaSlot.id);
  const first = await call('lim', 'POST', '/api/classes/book', { slotId: slot.id, date: day });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const blocked = await call('lim', 'POST', '/api/classes/book', { slotId: yogaSlot.id, date: day });
  assert.deepEqual([blocked.status, blocked.body.error, blocked.body.limit, blocked.body.period, blocked.body.used], [403, 'plan_limit', 1, 'week', 1]);
  // Repetir la que ya tiene no choca con el límite.
  assert.equal((await call('lim', 'POST', '/api/classes/book', { slotId: slot.id, date: day })).status, 200);
  const data = await list('lim', day, 1);
  assert.deepEqual([data.planLimit.limit, data.planLimit.period, Object.values(data.planLimit.used)], [1, 'week', [1]]);
  // Cancela a tiempo: le vuelve la clase.
  await call('lim', 'POST', '/api/classes/cancel', { bookingId: first.body.booking.id });
  assert.equal((await call('lim', 'POST', '/api/classes/book', { slotId: yogaSlot.id, date: day })).status, 200);
  assert.equal((await yogaOcc('lim')).myBooking.status, 'booked');
  // El staff lo anota igual y el panel se entera.
  const add = await call('owner', 'POST', '/api/admin/classes/sessions/add', { slotId: slot.id, date: day, userId: 'lim' });
  assert.equal(add.status, 200, JSON.stringify(add.body));
  assert.deepEqual([add.body.overLimit, add.body.planLimit?.limit], [true, 1]);
  // Sin límite en el plan, nada cambia.
  assert.equal((await list('ana', day, 1)).planLimit, null);
});

test('suspensión: el aviso en la app es solo para quien estaba anotado (no para quien ya había cancelado)', async () => {
  const yogaOf = async uid => (await list(uid, day, 1)).occurrences.find(o => o.slotId === yogaSlot.id)
  const anaBooking = (await yogaOf('ana')).myBooking
  assert.equal((await call('ana', 'POST', '/api/classes/cancel', { bookingId: anaBooking.id })).status, 200)
  const r = await call('owner', 'POST', '/api/admin/classes/sessions/change', { slotId: yogaSlot.id, date: day, cancelled: true })
  assert.equal(r.status, 200, JSON.stringify(r.body))
  assert.deepEqual([(await yogaOf('ana')).myBooking.status, (await yogaOf('ana')).myBooking.suspended], ['cancelled', false])
  assert.deepEqual([(await yogaOf('beto')).myBooking.status, (await yogaOf('beto')).myBooking.suspended], ['cancelled', true])
});
