// Verifica la base de la demo que acaba de armar build.mjs: relee todo por los mismos caminos que
// la app (getUserState, getMemberBilling, classes-db…) y controla tipos, rangos y que los datos
// cuenten una historia posible. Devuelve la lista de problemas (vacía si está todo bien).
// DATA_DIR ya tiene que estar puesto (lo importa build.mjs antes).

import fs from 'node:fs';
import path from 'node:path';

import * as db from '../../api/database.js';
import * as cdb from '../../api/classes-db.js';
import { INTENSITIES, PLAN_COUNTED, capOf, zonedToEpoch } from '../../api/classes.js';
import { gymClock, billingStatus, getBillingSettings, isIsoDate } from '../../api/billing.js';
import { LEGAL_VERSION } from '../../api/legal.js';
import { auditCategory } from '../../api/audit-categories.js';
import { ALIMENTOS_BASE } from '../../api/alimentos-base.js';
import { EXIDX } from '../../frontend/src/lib/exercises.js';
import { workoutVolume, streakSummary } from '../../frontend/src/lib/history.js';
import { isWarmupRow } from '../../frontend/src/lib/workout-model.js';
import { calcularNutrientesPorCantidad } from '../../frontend/src/lib/nutricion.js';

import { GYM, PLANS, LOAD_STEPS, PEOPLE, EXTRAS } from './demo-data.mjs';

const MIN = 60000;
const isInt = v => Number.isInteger(v);
const oneDecimal = v => typeof v === 'number' && Number.isFinite(v) && Math.abs(v * 10 - Math.round(v * 10)) < 1e-9;
const onGrid = (w, step) => step === 0 ? w === 0 : Math.abs(w / step - Math.round(w / step)) < 1e-9;

export function checkDemo({ now, today }) {
  const problems = [];
  const fail = (msg) => problems.push(msg);
  const sql = db.getDatabase();
  const tz = GYM.tz;
  const dayOf = ms => gymClock(ms, tz).date;
  const users = db.getAllUsers();
  const byName = new Map(users.map(u => [u.name, u]));
  const settings = getBillingSettings(sql);
  const types = new Map(cdb.getClassTypes({ includeArchived: true }).map(t => [t.id, t]));

  // ---------- cuentas ----------
  const owners = users.filter(u => u.owner === 1);
  const ownerName = PEOPLE.find(p => p.role === 'owner').username;
  if (owners.length !== 1 || owners[0].name !== ownerName) fail(`el dueño tiene que ser ${ownerName} y uno solo`);
  for (const u of users) {
    const created = Date.parse(u.created_at);
    if (!Number.isFinite(created) || created > now) fail(`${u.name}: created_at inválido`);
    const hasApp = db.countCredentials(u.id) > 0;
    const isFicha = !hasApp && !PEOPLE.some(p => p.username === u.name);
    if (!isFicha && u.legal_version !== LEGAL_VERSION) fail(`${u.name}: no aceptó los términos vigentes`);
    if (!['granted', 'declined', null].includes(u.health_consent)) fail(`${u.name}: consentimiento de salud inválido`);
    const profile = db.getMemberProfile(u.id);
    if (!profile?.fullName) fail(`${u.name}: sin nombre y apellido`);
    if (profile?.dniNorm && !/^\d{7,8}$/.test(profile.dniNorm)) fail(`${u.name}: DNI raro`);
  }
  for (const p of [...PEOPLE, ...EXTRAS]) if (!byName.has(p.username)) fail(`falta ${p.username}`);

  // ---------- cuotas ----------
  for (const plan of db.getPlans()) {
    const def = PLANS.find(p => p.name === plan.name);
    if (!def || plan.price !== def.price || plan.durationDays !== def.durationDays || (plan.classLimit ?? null) !== (def.classLimit ?? null)) fail(`plan ${plan.name}: no coincide con el de la demo`);
  }
  const expected = new Map([...PEOPLE.filter(p => p.status), ...EXTRAS].map(p => [p.username, p.status]));
  const planByName = new Map(PLANS.map(p => [p.name, p]));
  const raiseDate = gymClock(now - GYM.priceRaiseDaysAgo * 86400000, tz).date;
  for (const u of users) {
    const billing = db.getMemberBilling(u.id);
    const status = billingStatus(billing, today, settings);
    const want = expected.get(u.name);
    if (want === 'pendiente') {
      if (u.approval_status !== 'pending') fail(`${u.name}: tendría que estar pendiente de aprobación`);
      if (billing.planId != null) fail(`${u.name}: pendiente con plan`);
    } else if (want && status !== want) fail(`${u.name}: cuota ${status}, se esperaba ${want}`);
    const pays = db.getPaymentsByUserId(u.id).slice().reverse();     // del más viejo al más nuevo
    const live = pays.filter(p => !p.voidedAt);
    for (const p of pays) {
      if (!isInt(p.amount) || p.amount <= 0) fail(`${u.name}: monto ${p.amount}`);
      if (!['efectivo', 'transferencia', 'otro'].includes(p.method)) fail(`${u.name}: medio ${p.method}`);
      if (p.paidAt > now || p.paidAt < Date.parse(u.created_at)) fail(`${u.name}: pago fuera de fecha`);
      if (new Date(zonedToEpoch(dayOf(p.paidAt), '12:00', tz)).getUTCDay() === 0) fail(`${u.name}: pago un domingo (recepción cerrada)`);
      const plan = planByName.get(p.planName);
      const price = dayOf(p.paidAt) < raiseDate ? plan.oldPrice : plan.price;
      if (!p.voidedAt && p.amount !== price) fail(`${u.name}: pagó ${p.amount} y el plan costaba ${price}`);
      if (!isIsoDate(p.periodStart) || !isIsoDate(p.periodEnd) || p.periodEnd <= p.periodStart) fail(`${u.name}: período inválido`);
    }
    if (live.length && billing.dueDate !== live.at(-1).periodEnd) fail(`${u.name}: el vencimiento no es el del último pago`);
    for (let i = 1; i < live.length; i++) if (live[i].periodStart !== live[i - 1].periodEnd) fail(`${u.name}: hueco entre pagos`);
  }

  // ---------- estado de cada socio (entrenamientos, peso, mejores pesos) ----------
  const bookingsByUser = new Map();
  for (const b of sql.prepare('SELECT * FROM class_bookings').all()) (bookingsByUser.get(b.user_id) || bookingsByUser.set(b.user_id, []).get(b.user_id)).push(b);
  for (const u of users) {
    const S = db.getUserState(u.id);
    if (!S) continue;
    const declined = u.health_consent !== 'granted';
    const ws = S.workouts.slice().sort((a, b) => a.start - b.start);
    const best = {};
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i];
      const where = `${u.name} ${w.d} ${w.name}`;
      if (!isIsoDate(w.d) || w.d > today) fail(`${where}: fecha`);
      if (!isInt(w.start) || !isInt(w.end) || w.end <= w.start || w.end > now) fail(`${where}: horario`);
      if (dayOf(w.start) !== w.d) fail(`${where}: d no coincide con el inicio`);
      if (i && ws[i - 1].end > w.start) fail(`${where}: se pisa con el anterior`);
      if (!isInt(w.weekTarget) || w.weekTarget < 0 || w.weekTarget > 7) fail(`${where}: weekTarget ${w.weekTarget}`);
      if (w.kind === 'class') {
        const b = (bookingsByUser.get(u.id) || []).find(x => x.id === w.classBookingId);
        if (!b || b.status !== 'attended' || !b.logged) fail(`${where}: clase sin reserva presente`);
        const type = types.get(w.classId);
        if (!type || w.end - w.start !== type.durationMin * MIN) fail(`${where}: duración de clase`);
        if (type?.logMode === 'muscles' && !INTENSITIES.includes(w.muscleLoad?.intensity)) fail(`${where}: intensidad`);
        for (const e of w.entries) for (const s of e.sets) if (!isInt(s.r) || s.r < 1 || s.done !== true) fail(`${where}: serie de clase`);
        continue;
      }
      const minutes = (w.end - w.start) / MIN;
      if (minutes < 25 || minutes > 110) fail(`${where}: dura ${Math.round(minutes)} min`);
      if (!S.routines.some(r => r.id === w.routineId)) fail(`${where}: rutina inexistente`);
      if (declined && w.bw != null) fail(`${where}: peso corporal sin consentimiento`);
      if (w.bw != null && !oneDecimal(w.bw)) fail(`${where}: bw ${w.bw}`);
      if (!w.entries.length) fail(`${where}: sin ejercicios`);
      for (const e of w.entries) {
        const ex = EXIDX[e.id];
        if (!ex) { fail(`${where}: ejercicio ${e.id}`); continue; }
        const step = LOAD_STEPS[ex.eq];
        if (!isInt(e.target?.sets) || !isInt(e.target?.reps)) fail(`${where}: objetivo ${e.id}`);
        for (const s of e.sets) {
          if (s.done !== true) fail(`${where}: serie sin hacer`);
          if (!isInt(s.r) || s.r < 1 || s.r > 30) fail(`${where}: repeticiones ${s.r} en ${e.id}`);
          if (typeof s.w !== 'number' || !onGrid(s.w, step.step) || (step.step && s.w < step.min)) fail(`${where}: peso ${s.w} en ${e.id} (${ex.eq})`);
        }
        if (e.sets.length !== e.target.sets) fail(`${where}: ${e.sets.length} series de ${e.target.sets} en ${e.id}`);
        const mx = Math.max(0, ...e.sets.filter(s => s.done && !isWarmupRow(s)).map(s => s.w));
        const wasPr = mx > 0 && mx > (best[e.id] || 0);
        if (wasPr !== (w.prs || []).includes(e.id)) fail(`${where}: récord mal marcado en ${e.id}`);
        if (mx > (best[e.id] || 0)) best[e.id] = mx;
      }
      if (w.vol !== workoutVolume(w)) fail(`${where}: volumen ${w.vol} ≠ ${workoutVolume(w)}`);
    }
    for (const [id, top] of Object.entries(best)) if (S.exWeights[id]?.w !== top) fail(`${u.name}: mejor peso de ${id}`);
    for (const id of Object.keys(S.exWeights)) if (!(id in best)) fail(`${u.name}: mejor peso de más (${id})`);
    if (declined && (S.bodyweight.length || S.edad != null || S.altura != null || S.pesoKg != null)) fail(`${u.name}: datos de salud sin consentimiento`);
    const seenDays = new Set();
    for (const b of S.bodyweight) {
      if (!oneDecimal(b.w) || b.w < 40 || b.w > 140) fail(`${u.name}: peso corporal ${b.w}`);
      if (seenDays.has(b.d)) fail(`${u.name}: dos pesos el ${b.d}`);
      seenDays.add(b.d);
    }
    const logged = (bookingsByUser.get(u.id) || []).filter(b => b.logged).length;
    if (logged !== ws.filter(w => w.kind === 'class').length) fail(`${u.name}: clases en el historial ≠ reservas registradas`);
  }

  // ---------- clases ----------
  const sessions = sql.prepare('SELECT * FROM class_sessions').all();
  const monthCount = new Map();
  for (const s of sessions) {
    const type = types.get(s.class_id);
    const list = sql.prepare('SELECT * FROM class_bookings WHERE session_id = ?').all(s.id);
    const taken = list.filter(b => ['booked', 'attended', 'absent'].includes(b.status)).length;
    const cap = capOf(type ? { capacity: type.capacity } : null);
    if (taken > cap) fail(`${type.name} ${s.date}: ${taken} de ${cap}`);
    if (list.some(b => b.status === 'waitlist') && taken < cap) fail(`${type.name} ${s.date}: lista de espera con lugar`);
    const start = zonedToEpoch(s.date, s.start, tz);
    for (const b of list) {
      const who = users.find(u => u.id === b.user_id)?.name;
      if (Date.parse(b.created_at) >= start) fail(`${who} reservó ${type.name} ${s.date} después de empezar`);
      if (b.rating != null && (b.status !== 'attended' || !isInt(b.rating) || b.rating < 1 || b.rating > 5)) fail(`${who}: calificación inválida`);
      if (b.logged && b.status !== 'attended') fail(`${who}: registrada sin ir`);
      // Los perfiles principales usan la app aunque con --codigos-perfiles todavía no tengan passkey.
      const usesApp = db.countCredentials(b.user_id) > 0 || PEOPLE.some(p => p.username === who);
      if (!usesApp && (b.logged || b.rating != null || b.answered_at || !b.added_by)) fail(`${who}: sin app pero reservó, contestó o calificó solo`);
      if (['attended', 'absent'].includes(b.status) && !['teacher', 'member', 'checkin', 'timeout'].includes(b.attendance_source)) fail(`${who}: origen de asistencia ${b.attendance_source}`);
      if (b.status === 'attended' && !sql.prepare('SELECT 1 FROM attendance WHERE user_id = ? AND date = ?').get(b.user_id, s.date)) fail(`${who} fue a ${type.name} ${s.date} sin ingreso físico`);
      if (b.status === 'absent' && b.attendance_source === 'timeout' && sql.prepare('SELECT 1 FROM attendance WHERE user_id = ? AND date = ?').get(b.user_id, s.date)) fail(`${who}: ausente con ingreso ese día`);
      if (b.user_id === (s.teacher_user_id || type.teacherUserId)) fail(`la profe reservó su propia clase`);
      if (PLAN_COUNTED.includes(b.status)) {
        const key = `${b.user_id}:${s.date.slice(0, 7)}`;
        monthCount.set(key, (monthCount.get(key) || 0) + 1);
      }
    }
  }
  for (const [key, n] of monthCount) {
    const [userId] = key.split(':');
    const plan = db.getMemberBilling(userId);
    const def = PLANS.find(p => p.name === plan.planName);
    if (def?.classLimit && n > def.classLimit) fail(`${users.find(u => u.id === userId).name}: ${n} clases en ${key.split(':')[1]} con límite ${def.classLimit}`);
  }

  // ---------- ingreso físico ----------
  for (const a of sql.prepare('SELECT * FROM attendance').all()) {
    if (a.created_at > now || dayOf(a.created_at) !== a.date) fail(`ingreso de ${a.user_id} fuera de fecha`);
  }

  // ---------- nutrición ----------
  const foods = new Map(ALIMENTOS_BASE.map(f => [f.nombre, f]));
  for (const m of sql.prepare('SELECT * FROM comidas_registradas').all()) {
    const n = calcularNutrientesPorCantidad(foods.get(m.nombre_alimento), m.cantidad_gramos);
    if (n.calorias !== m.calorias || n.proteina !== m.proteina || n.carbohidratos !== m.carbohidratos || n.grasas !== m.grasas) fail(`comida ${m.nombre_alimento}: nutrientes`);
    if (m.fecha > today) fail('comida en el futuro');
    if (users.find(u => u.id === m.user_id)?.health_consent !== 'granted') fail('comidas sin consentimiento');
  }

  // ---------- registro de actividad ----------
  const lines = fs.readFileSync(path.join(process.env.DATA_DIR, 'audit.log'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
  lines.forEach((e, i) => {
    if (e.id !== i + 1) fail('registro: ids salteados');
    if (i && e.ts < lines[i - 1].ts) fail('registro: fuera de orden');
    if (e.ts > now || e.ts < now - 90 * 86400000) fail('registro: fecha fuera de los 90 días');
    if (auditCategory(e.ev) === 'other') fail(`registro: evento sin categoría ${e.ev}`);
  });

  // ---------- rachas (como las calcula la app) ----------
  const lucia = db.getUserState(byName.get(PEOPLE.find(p => p.key === 'lucia').username).id);
  const summary = streakSummary(lucia, new Date(now));
  if (summary.streak < 8) fail(`Lucía tiene racha de ${summary.streak} semanas (se esperaban 8 o más)`);

  return problems;
}
