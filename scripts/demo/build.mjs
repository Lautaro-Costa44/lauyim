// Arma la base del gimnasio de la demo en DATA_DIR. Cada dato pasa por las mismas funciones que
// usan los endpoints de la app (database.js, classes-db.js, billing.js, members.js, data-put.js) y
// los cálculos del cliente (volumen, meta semanal, nutrientes) salen de frontend/src/lib. Así los
// tipos y las reglas son los de la app, no una copia.
//
// Todo es relativo a `now`: el historial termina hoy, los vencimientos y las clases de la semana
// que viene se ven al día. El azar sale de un generador con semilla fija: dos corridas el mismo día
// dan los mismos números (los ids sí cambian).
//
// DATA_DIR tiene que estar puesto ANTES de importar este módulo (database.js lo lee al cargar).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import * as db from '../../api/database.js';
import * as cdb from '../../api/classes-db.js';
import { CLASS_DEFAULTS, validateClassType, validateSlot, occurrencesBetween, overlapConflicts, classWorkout, zonedToEpoch, addDays, weekdayOf, resolveAttendance, capOf } from '../../api/classes.js';
import { BILLING_ENABLED_SETTING, BILLING_DEFAULTS, gymClock, nextDueDate, billingStatus, getBillingSettings } from '../../api/billing.js';
import { validateMemberProfile, formatLinkCode, maskDni } from '../../api/members.js';
import { LEGAL_VERSION } from '../../api/legal.js';
import { applyStatePut } from '../../api/data-put.js';
import { createDevice, CHECKIN_SETTINGS } from '../../api/checkin.js';
import { BRANDING_SETTING, validateBranding } from '../../api/branding.js';
import { PRIVACY_GYM_NAME_SETTING, PRIVACY_CONTACT_SETTING } from '../../api/privacy.js';
import { APPROVAL_REQUIRED_SETTING, APPROVAL_MODE_SETTING } from '../../api/approval.js';
import { ALIMENTOS_BASE } from '../../api/alimentos-base.js';
import { EXIDX } from '../../frontend/src/lib/exercises.js';
import { workoutVolume, stampWeekTargets } from '../../frontend/src/lib/history.js';
import { isWarmupRow } from '../../frontend/src/lib/workout-model.js';
import { calcularNutrientesPorCantidad } from '../../frontend/src/lib/nutricion.js';
import { uid } from '../../frontend/src/lib/format.js';

import { GYM, PLANS, LOAD_STEPS, PROGRAMS, CLASSES, PEOPLE, EXTRAS, MEALS, GENERATED_COUNT, FIRST_NAMES, LAST_NAMES, CLASS_POPULARITY } from './demo-data.mjs';

const MIN = 60000;
const DAY_MS = 86400000;
const CLASS_SETTINGS_KEY = 'classes';     // classes-routes.js (no se importa: trae los push)
const TRIAL_DAYS = 3;
const DEVICE_NAME = 'Recepción';

// ---- azar con semilla ----
function rngFrom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// profileCodes: los 5 perfiles quedan sin passkey y con código (para mostrar su vista en otro
// celular). Si no, tienen la app como cualquier socio y solo el dueño recibe código.
export async function buildDemo({ now = Date.now(), seed = 20261004, profileCodes = false, log = () => {} } = {}) {
  const rand = rngFrom(seed);
  const chance = p => rand() < p;
  const int = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
  const pick = list => list[Math.floor(rand() * list.length)];
  const tz = GYM.tz;
  const clock = gymClock(now, tz);
  const T = clock.date;
  const daysAgo = n => addDays(T, -n);
  // Recepción atiende de lunes a sábado: lo que hace el staff un domingo pasa al sábado.
  const receptionDay = date => weekdayOf(date) === 0 ? addDays(date, -1) : date;
  const at = (date, time) => zonedToEpoch(date, time, tz);
  const iso = ms => new Date(ms).toISOString();
  const hhmm = minutes => String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
  const toMin = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  // Un instante del día en horario del gimnasio, con segundos y milisegundos como los de Date.now().
  const instant = (date, minutes) => at(date, hhmm(minutes)) + int(0, 59) * 1000 + int(0, 999);
  const between = (date, fromTime, toTime) => instant(date, int(toMin(fromTime), toMin(toTime)));
  const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');
  const newUserId = () => crypto.randomBytes(12).toString('base64url');

  db.initDatabase();
  const sql = db.getDatabase();
  const audit = [];       // eventos del registro de actividad: { ts, ev, ... }

  // ---------- ajustes del gimnasio ----------
  db.setAdminSetting(BILLING_ENABLED_SETTING, 'true');
  db.setAdminSetting('trial_days', String(TRIAL_DAYS));
  db.setAdminSetting(APPROVAL_REQUIRED_SETTING, '1');
  db.setAdminSetting(APPROVAL_MODE_SETTING, 'approve');
  db.setAdminSetting(CHECKIN_SETTINGS.enabled, 'true');
  db.setAdminSetting(CLASS_SETTINGS_KEY, JSON.stringify({ ...CLASS_DEFAULTS, enabled: true }));
  const branding = validateBranding({ appName: GYM.name, shortName: GYM.shortName, tagline: GYM.tagline, color: null, theme: 'dark', lockTheme: true });
  if (branding.error) throw new Error('branding: ' + branding.error);
  db.setAdminSetting(BRANDING_SETTING, JSON.stringify({ ...branding.value, logo: null }));
  db.setAdminSetting(PRIVACY_GYM_NAME_SETTING, GYM.name);
  db.setAdminSetting(PRIVACY_CONTACT_SETTING, GYM.contact);
  const billingSettings = getBillingSettings(sql);
  if (billingSettings.trial_days !== TRIAL_DAYS) throw new Error('trial_days no quedó guardado');
  const grace = billingSettings.grace_days;

  // ---------- personas ----------
  const people = new Map();   // key → { id, username, fullName, joinDate, joinTs, ... }
  const profileOf = p => {
    const checked = validateMemberProfile({ fullName: p.fullName, dni: p.dni, phone: p.phone, email: p.email || '' }, undefined, { enforceRequired: false });
    if (checked.error) throw new Error(`perfil de ${p.username}: ${checked.error}`);
    return checked.value;
  };
  const stampUser = (id, ts, { legal = true, health = null } = {}) => {
    sql.prepare('UPDATE users SET created_at = ?, legal_version = ?, legal_accepted_at = ?, privacy_accepted_at = ?, health_consent = ?, health_consent_at = ? WHERE id = ?')
      .run(iso(ts), legal ? LEGAL_VERSION : null, legal ? iso(ts) : null, legal ? iso(ts) : null, health, health ? iso(ts) : null, id);
    sql.prepare('UPDATE member_profile SET created_at = ?, updated_at = ? WHERE user_id = ?').run(iso(ts), iso(ts), id);
  };
  const addCredential = (userId, ts) => db.createCredential({
    id: crypto.randomBytes(16).toString('base64url'), userId,
    // Clave de ejemplo: la cuenta figura con la app instalada, pero con esta passkey nadie entra.
    publicKey: crypto.randomBytes(77).toString('base64url'), counter: 0, transports: ['internal', 'hybrid'], created: ts
  });

  // Dueño primero (la primera cuenta es el owner).
  const owner = PEOPLE.find(p => p.role === 'owner');
  for (const p of [owner, ...PEOPLE.filter(x => x !== owner)]) {
    const id = newUserId();
    // Alta en un día que abre recepción: así el estado de la cuota de hoy es el de la lista.
    const joinDate = receptionDay(daysAgo(p.joinDaysAgo));
    const joinTs = between(joinDate, '09:00', '20:00');
    db.createUser({ id, name: p.username, created: iso(joinTs), legalVersion: LEGAL_VERSION, healthConsent: p.health });
    db.writeRegistrationProfile(id, profileOf(p));
    stampUser(id, joinTs, { health: p.health ? 'granted' : 'declined' });
    if (p.role && p.role !== 'owner') db.setUserRole(id, p.role);
    people.set(p.key, { ...p, id, joinDate, joinTs, app: true });
  }
  const juan = people.get('juan');
  const staffIds = { owner: juan.id, reception: people.get('martin').id, coach: people.get('carolina').id };
  const receptionist = people.get('martin');
  // Socios generados: nombre, año, plan, alta y clases preferidas (todos al día).
  const generated = [];
  {
    const used = new Set([...PEOPLE, ...EXTRAS].map(p => p.username));
    const slotsOf = key => CLASSES.find(c => c.key === key).slots.map(([weekday]) => weekday);
    const pickClass = () => { let r = rand(); for (const [key, w] of Object.entries(CLASS_POPULARITY)) { if ((r -= w) < 0) return key; } return 'spinning'; };
    while (generated.length < GENERATED_COUNT) {
      const sex = chance(0.55) ? 'femenino' : 'masculino';
      const first = pick(FIRST_NAMES[sex]);
      const last = pick(LAST_NAMES);
      if (generated.some(g => g.fullName === `${first} ${last} (demo)`)) continue;
      // Como se registra la gente: nombre e inicial del apellido.
      let username = `${first.split(' ')[0]} ${last[0]}.`;
      if (used.has(username)) username = `${first.split(' ')[0]} ${last}`;     // dos "María G.": una pone el apellido
      if (used.has(username)) continue;
      used.add(username);
      used.add(username);
      const year = chance(0.8) ? int(1985, 2005) : int(1962, 1984);
      const planRoll = rand();
      const plan = planRoll < 0.55 ? 'mensual' : planRoll < 0.7 ? 'trimestral' : planRoll < 0.85 ? 'clases8' : (year >= 1999 ? 'estudiante' : 'mensual');
      const prefs = [];
      for (let i = 0, n = int(2, 4); i < n; i++) {
        const cls = pickClass();
        const weekday = pick(slotsOf(cls));
        if (!prefs.some(([c, d]) => c === cls && d === weekday)) prefs.push([cls, weekday, Math.round((0.6 + rand() * 0.35) * 100) / 100]);
      }
      // Algunos pagan pero hace un par de semanas que no vienen (vacaciones, una lesión, poco tiempo).
      const pausedDaysAgo = chance(0.15) ? int(10, 25) : null;
      generated.push({ sex, username, fullName: `${first} ${last} (demo)`, year, plan, status: null, app: chance(0.85), joinDaysAgo: int(pausedDaysAgo ? 40 : 12, 150), visitsPerWeek: int(1, 3), classes: prefs, pausedDaysAgo });
    }
  }
  const usedDnis = new Set(PEOPLE.map(p => p.dni));
  for (const [k, ex] of [...EXTRAS, ...generated].entries()) {
    const id = newUserId();
    // Las fichas las carga recepción (un día que abre); con la app, cualquiera se registra cuando quiere.
    // Las fichas las carga recepción (un día que abre) y los de EXTRAS tienen un estado de cuota fijo;
    // los generados se registran cualquier día (si es domingo, pagan el lunes).
    const joinDate = ex.app && ex.status == null ? daysAgo(ex.joinDaysAgo) : receptionDay(daysAgo(ex.joinDaysAgo));
    const born = ex.year;
    // DNI acorde a la edad (en Argentina el número crece con el año de nacimiento).
    let dni;
    do dni = String(Math.round((14 + 0.7 * (born - 1960)) * 1e6) + int(10000, 899999)); while (usedDnis.has(dni));
    usedDnis.add(dni);
    const words = ex.fullName.replace(' (demo)', '').split(' ');
    const [first, last] = [words[0], words.at(-1)];
    const p = { ...ex, key: ex.username, dni, phone: `11 ${int(2, 6)}${int(100, 999)}-${String(int(0, 9999)).padStart(4, '0')}`,
      email: k % 4 === 3 ? null : `${first.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}.${last.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')}${k % 3 === 0 ? born % 100 : ''}@${pick(['gmail.com', 'gmail.com', 'hotmail.com', 'yahoo.com.ar'])}` };
    const pending = ex.status === 'pendiente';
    // Fichas sin app: las carga recepción en horario de atención. Con app: se registran cuando quieren.
    const joinTs = ex.joinDaysAgo === 0 ? Math.min(now - 40 * MIN, between(T, '08:00', '12:00')) : between(joinDate, ex.app ? '08:00' : '09:00', ex.app ? '22:30' : '20:30');
    if (ex.app) {
      db.createUser({ id, name: ex.username, created: iso(joinTs), legalVersion: LEGAL_VERSION, pending, healthConsent: false });
      db.writeRegistrationProfile(id, profileOf(p));
      stampUser(id, joinTs, { health: 'declined' });
      addCredential(id, joinTs);
    } else {
      db.createMember({ id, name: ex.username, profile: profileOf(p) });
      // Ficha: sin aceptación propia (la acepta al vincularse) ni consentimiento de salud.
      stampUser(id, joinTs, { legal: false, health: null });
    }
    people.set(p.key, { ...p, id, joinDate, joinTs, extra: true });
  }

  // ---------- planes (con el aumento de precio) ----------
  const raiseDate = daysAgo(GYM.priceRaiseDaysAgo);
  const plans = new Map();
  for (const pl of PLANS) {
    const created = db.createPlan({ name: pl.name, price: pl.oldPrice, durationDays: pl.durationDays, classLimit: pl.classLimit ?? null, classPeriod: pl.classPeriod ?? null });
    plans.set(pl.key, { ...pl, id: created.id });
  }
  const priceOn = (planKey, date) => date < raiseDate ? plans.get(planKey).oldPrice : plans.get(planKey).price;
  // El aumento: el plan pasa al precio de hoy (los pagos de antes guardan el monto que se cobró).
  for (const pl of plans.values()) {
    db.updatePlan(pl.id, { price: pl.price });
    sql.prepare('UPDATE plans SET created_at = ?, updated_at = ? WHERE id = ?').run(at(daysAgo(GYM.historyDays + 5), '10:00'), at(raiseDate, '09:15'), pl.id);
  }

  // ---------- programas del gimnasio (presets) ----------
  for (const program of PROGRAMS) {
    program.days.forEach((d, position) => db.createPreset({ id: d.id, name: d.name, emoji: d.emoji, groupName: program.name, plannedDay: d.plannedDay, position, ex: d.ex.map(([id, sets, reps]) => ({ id, sets, reps, weight: 0 })) }));
  }
  const programs = db.getPresetPrograms();
  for (const pr of programs) db.setPresetProgramVisibility(pr.id, true);
  const presetsOf = name => db.getAllPresets().filter(p => p.group_name === name).sort((a, b) => a.position - b.position).map(p => db.getPresetWithExercises(p.id));

  // ---------- clases ----------
  const classTypes = new Map();
  for (const c of CLASSES) {
    const checked = validateClassType({ ...c, teacherUserId: c.teacher ? people.get(c.teacher).id : null, teacherName: c.teacherName || '' }, { activeNames: [...classTypes.values()].map(t => t.name) });
    if (checked.error) throw new Error(`clase ${c.name}: ${checked.error}`);
    const type = cdb.saveClassType(checked.value);
    const slots = c.slots.map(([weekday, start]) => {
      const s = validateSlot({ weekday, start });
      if (s.error) throw new Error(`horario de ${c.name}: ${s.error}`);
      return cdb.saveClassSlot({ classId: type.id, ...s.value });
    });
    classTypes.set(c.key, { ...type, key: c.key, slots });
  }
  const userNames = Object.fromEntries([...people.values()].map(p => [p.id, p.fullName.replace(' (demo)', '')]));
  // Sin choques de horario (mismo salón u hora de la misma profe).
  {
    const types = cdb.getClassTypes(), slots = cdb.getClassSlots();
    const week = occurrencesBetween({ types, slots, from: T, days: 7, userNames });
    for (const occ of week) {
      const others = week.filter(o => o !== occ);
      const conflicts = overlapConflicts(occ, others, { allowOverlap: false });
      if (conflicts.length) throw new Error(`choque de horario: ${occ.type.name} ${occ.date} ${occ.start}`);
    }
  }

  // ---------- cuotas: pagos desde el alta hasta hoy ----------
  // Cada socio paga cerca del vencimiento (dentro de la tolerancia conserva su fecha, igual que en
  // el servidor: nextDueDate). Según `status`, deja de pagar el período actual.
  const payments = [];    // para el registro de actividad
  const paymentMethodFor = p => (chance(0.85) && p.payMethod) || pick(['efectivo', 'efectivo', 'transferencia', 'transferencia', 'otro']);
  const pay = (p, planKey, payDate, { amount, method, note, notBefore = 0, createdBy: by = null } = {}) => {
    const plan = plans.get(planKey);
    const current = db.getMemberBilling(p.id);
    const period = nextDueDate(current.dueDate, payDate, plan.durationDays, grace);
    const paidAt = Math.min(Math.max(between(payDate, '08:30', '21:00'), notBefore), now - 5 * MIN);
    if (gymClock(paidAt, tz).date !== payDate) throw new Error(`pago de ${p.username} fuera de su día (${payDate})`);
    const createdBy = by || (chance(0.8) ? receptionist.id : juan.id);
    const value = { userId: p.id, userName: p.username, planId: plan.id, planName: plan.name, amount: amount ?? priceOn(planKey, payDate), method: method || paymentMethodFor(p), paidAt, periodStart: period.periodStart, periodEnd: period.periodEnd, dueDate: period.dueDate, note: note ?? null, createdBy };
    const id = db.recordPayment(value);
    sql.prepare('UPDATE payments SET created_at = ? WHERE id = ?').run(paidAt, id);
    payments.push({ id, ...value });
    return { id, ...value };
  };
  const paidMembers = [...people.values()].filter(p => p.plan);
  for (const p of paidMembers) {
    const plan = plans.get(p.plan);
    // Primer pago, al habilitar la cuenta: si se registró un domingo, el lunes.
    let start = weekdayOf(p.joinDate) === 0 ? addDays(p.joinDate, 1) : p.joinDate;
    if (start > T) throw new Error(`${p.username} se registró hoy domingo: no puede tener pagos`);
    if (p.trialFirst) {
      const until = addDays(p.joinDate, TRIAL_DAYS - 1);
      if (!db.startTrial(p.id, until, receptionist.id)) throw new Error('prueba de ' + p.username);
      sql.prepare('UPDATE member_trials SET started_at = ?, created_at = ? WHERE user_id = ?').run(p.joinTs, p.joinTs, p.id);
      sql.prepare('UPDATE member_profile SET trial_used_at = ? WHERE user_id = ?').run(p.joinTs, p.id);
      p.trialUntil = until;
      start = receptionDay(until);          // paga el último día de la prueba
    }
    // Vencimientos de la cadena: el primer pago + k * duración (pagando dentro de la tolerancia
    // se conserva la fecha). Al día o por vencer: pagó el período de hoy. Vencido o bloqueado: no.
    const stopsPaying = ['vencido', 'bloqueado'].includes(p.status);
    // El primer pago, al habilitar la cuenta: un rato después del alta.
    const firstAfter = p.app === false ? p.joinTs + int(1, 3) * MIN : p.joinTs + int(10, 60) * MIN;
    let due = null;
    let k = 0;
    while (true) {
      let payDate = start;
      if (due != null) {
        if (due > T) break;                                                   // ya pagó lo de hoy
        if (stopsPaying && addDays(due, plan.durationDays) > T) break;        // no pagó el período de hoy
        payDate = receptionDay(addDays(due, int(-2, 3)));
        if (payDate > T) payDate = receptionDay(T);
      }
      const notBefore = k === 0 ? (p.trialFirst || start !== p.joinDate ? at(start, '08:30') : firstAfter) : 0;
      if (p.voidedPayment && k > 0 && addDays(due, plan.durationDays) > T) {
        // El último pago se cargó mal (un cero de menos) y se anuló a los pocos minutos.
        const wrong = pay(p, p.plan, payDate, { amount: priceOn(p.plan, payDate) / 10, method: 'efectivo' });
        const voidAt = Math.min(wrong.paidAt + int(2, 6) * MIN, now - 3 * MIN);
        db.voidPayment({ paymentId: wrong.id, userId: p.id, voidedBy: wrong.createdBy, reason: 'Monto mal cargado', planId: plan.id, dueDate: due });
        sql.prepare('UPDATE payments SET voided_at = ? WHERE id = ?').run(voidAt, wrong.id);
        Object.assign(payments.find(x => x.id === wrong.id), { voidedAt: voidAt, backTo: due });
        const right = pay(p, p.plan, payDate, { method: 'efectivo', createdBy: wrong.createdBy });
        const rightAt = Math.min(voidAt + int(1, 3) * MIN, now - 2 * MIN);
        sql.prepare('UPDATE payments SET paid_at = ?, created_at = ? WHERE id = ?').run(rightAt, rightAt, right.id);
        Object.assign(payments.find(x => x.id === right.id), { paidAt: rightAt });
        due = right.dueDate;
      } else {
        due = pay(p, p.plan, payDate, { notBefore }).dueDate;
      }
      k++;
    }
  }
  // Paula: prueba gratis que empezó hoy.
  for (const p of [...people.values()].filter(x => x.status === 'prueba')) {
    const until = addDays(p.joinDate, TRIAL_DAYS - 1);
    if (!db.startTrial(p.id, until, receptionist.id)) throw new Error('prueba de ' + p.username);
    sql.prepare('UPDATE member_trials SET started_at = ?, created_at = ? WHERE user_id = ?').run(p.joinTs, p.joinTs, p.id);
    sql.prepare('UPDATE member_profile SET trial_used_at = ? WHERE user_id = ?').run(p.joinTs, p.id);
    p.trialUntil = until;
  }
  // Estado de cuota de un socio un día dado (para no dejar entrenar ni reservar a un bloqueado).
  const paymentsOf = new Map();
  for (const pm of payments) if (!pm.voidedAt) (paymentsOf.get(pm.userId) || paymentsOf.set(pm.userId, []).get(pm.userId)).push(pm);
  const statusOn = (p, date) => {
    if (!p.plan && !p.trialUntil) return p.role ? 'staff' : 'sin_plan';
    const paid = (paymentsOf.get(p.id) || []).filter(pm => gymClock(pm.paidAt, tz).date <= date);
    const last = paid.at(-1);
    if (!last) return p.trialUntil && date >= addDays(p.trialUntil, -(TRIAL_DAYS - 1)) ? billingStatus({ planId: null, dueDate: null, trialUntil: p.trialUntil }, date, billingSettings) : 'sin_plan';
    return billingStatus({ planId: last.planId, dueDate: last.dueDate, trialUntil: null }, date, billingSettings);
  };
  const canUseOn = (p, date) => date >= p.joinDate && !['bloqueado', 'sin_plan'].includes(statusOn(p, date)) && p.status !== 'pendiente'
    && !(p.pausedDaysAgo && date >= daysAgo(p.pausedDaysAgo));

  // ---------- entrenamientos de rutina ----------
  const states = new Map();      // userId → S
  const workoutDays = new Map(); // userId → Map(date → instante de entrada)
  const markEntry = (userId, date, ts) => {
    const m = workoutDays.get(userId) || workoutDays.set(userId, new Map()).get(userId);
    if (!m.has(date) || m.get(date) > ts) m.set(date, ts);
  };
  const baseState = p => ({
    unit: 'kg', restSec: 90, restPauseSec: 15, sound: true, keepAwake: true, lang: 'es', theme: 'dark', accent: 'lime',
    body: p.sex === 'femenino' ? 'female' : 'male', genero: p.sex || 'masculino', targetW: null,
    bodyweight: [], routines: [], week: {}, dayPlan: {}, exWeights: {}, workouts: [], customEx: [], gifSize: 'full',
    reminder: { on: false, time: '08:00', tz: null, feeOn: false, feeInterval: 'monthly', feeDate: '' }, effort: null, autoBackup: false,
    defaultIntensifier: { type: 'none' }, defaultSets: 3, equipProfiles: [], activeEquipId: null, equipFilterOn: false, exNotes: {},
    routineGroups: [], activeGroupId: null,
    // Los recorridos guiados ya los hizo (no aparecen en medio de la demo).
    onboardingCompletado: true, onboardingStatsCompletado: true, onboardingNutritionCompletado: true,
    estadoInicial: 'pendiente'
  });
  const stepOf = id => LOAD_STEPS[EXIDX[id].eq];
  const roundTo = (w, step) => step ? Math.round(w / step) * step : 0;
  const bwOn = (p, date) => {
    // Tendencia lineal del alta a hoy, con ±0,3 kg de día a día.
    const total = Math.max(1, Math.round((Date.parse(T) - Date.parse(p.joinDate)) / DAY_MS));
    const done = Math.round((Date.parse(date) - Date.parse(p.joinDate)) / DAY_MS);
    const trend = p.bw[0] + (p.bw[1] - p.bw[0]) * (done / total);
    return Math.round((trend + (rand() - 0.5) * 0.6) * 10) / 10;
  };

  for (const p of PEOPLE.map(x => people.get(x.key))) {
    const S = baseState(p);
    if (p.health) Object.assign(S, { edad: p.age, altura: p.height, objetivo: p.objetivo, nivel: p.nivel, pesoKg: p.bw[1] });
    if (p.injuries) S.respuestasEncuesta = { lesiones: [...p.injuries], tieneLesion: true };
    states.set(p.id, S);
    if (!p.training) continue;

    // Elegir el programa como en Plan → "Cargar un plan" (frontend/src/lib/starter.js → pickProgram,
    // routineGroups.js → applyPlannedDays / createRoutineGroup): rutinas nuevas con su día, la semana
    // y un grupo con el programa como origen.
    const program = programs.find(pr => pr.name === p.training.program);
    const routines = presetsOf(program.name).map(pr => ({ id: uid(), name: pr.name, emoji: pr.emoji || 'dumbbell', plannedDay: pr.planned_day, created: p.joinTs, ex: pr.ex.map(e => ({ ...e })) }));
    const week = Object.fromEntries(routines.map(r => [r.plannedDay, r.id]));
    const group = { id: uid(), name: program.name, routines: JSON.parse(JSON.stringify(routines)), week: { ...week }, createdAt: p.joinTs, source: { kind: 'preset', programId: program.id, at: p.joinTs } };
    Object.assign(S, { routines, week, routineGroups: [group], activeGroupId: group.id, estadoInicial: 'plan_predeterminado', planIniciado: true });
    if (p.key === 'lucia') S.reminder = { on: true, time: '18:30', tz, feeOn: false, feeInterval: 'monthly', feeDate: '' };

    // Carga de trabajo por ejercicio: doble progresión (primero las repeticiones, después el peso).
    const loads = {};
    for (const r of routines) for (const e of r.ex) {
      if (loads[e.id]) continue;
      const step = stepOf(e.id);
      const w0 = p.start[e.id];
      if (w0 == null) throw new Error(`falta la carga inicial de ${e.id} para ${p.username}`);
      loads[e.id] = { w: w0, cap: step.step ? roundTo(w0 * 1.3, step.step) : 0, hits: 0, fresh: true, extraReps: 0 };
    }
    const need = p.nivel === 'principiante' ? 2 : 3;
    let lastWeigh = null;
    for (let d = addDays(p.joinDate, 1); d <= T; d = addDays(d, 1)) {
      const routineId = week[weekdayOf(d)];
      if (!routineId) continue;
      if (!p.role && !canUseOn(p, d)) continue;
      const perfect = p.training.perfectWeeks && d >= addDays(T, -7 * p.training.perfectWeeks);
      if (!perfect && !chance(p.training.consistency)) continue;
      const r = routines.find(x => x.id === routineId);
      const startMin = toMin(p.training.time) + int(-p.training.jitter, p.training.jitter);
      const start = instant(d, startMin);
      const badDay = chance(0.08);
      let elapsed = int(4, 9) * MIN;           // entrada en calor
      const entries = r.ex.map(cfg => {
        const L = loads[cfg.id];
        const step = stepOf(cfg.id);
        const target = cfg.reps;
        const sets = [];
        for (let i = 0; i < cfg.sets; i++) {
          let reps = step.step ? target : target + L.extraReps;
          if (L.fresh) reps -= i === 0 ? int(0, 1) : int(1, 2);
          else if (i === cfg.sets - 1 && chance(0.35)) reps -= 1;
          if (badDay) reps -= 1;
          reps = Math.max(Math.max(1, target - 3), reps);
          sets.push({ w: L.w, r: reps, done: true });
          elapsed += int(95, 170) * 1000;
        }
        const hit = sets.every(s => s.r >= target);
        if (step.step) {
          L.fresh = false;
          if (hit) { L.hits++; if (L.hits >= need && L.w + step.step <= L.cap) { L.w += step.step; L.hits = 0; L.fresh = true; } }
          else L.hits = 0;
        } else if (hit && chance(0.3) && L.extraReps < 3) L.extraReps++;     // peso corporal: más repeticiones
        return { id: cfg.id, sets, topW: null, target: { ...cfg } };
      });
      const end = start + elapsed + int(2, 6) * MIN;
      if (end > now - 5 * MIN) continue;     // hoy, solo si ya terminó
      // Se pesa cada `weighEvery` días al empezar (BwSheet): queda en el entreno y en su peso corporal.
      let bw = null;
      if (p.health && p.training.weighEvery && (!lastWeigh || Date.parse(d) - Date.parse(lastWeigh) >= p.training.weighEvery * DAY_MS)) {
        bw = bwOn(p, d);
        S.bodyweight.push({ d, w: bw, t: start - int(1, 3) * MIN });
        lastWeigh = d;
      }
      // Récords como en doFinishWorkout: el mejor peso de trabajo, si supera el mejor anterior.
      const prs = [];
      for (const e of entries) {
        const mx = Math.max(0, ...e.sets.filter(s => s.done && !isWarmupRow(s)).map(s => s.w));
        const best = Math.max(0, S.exWeights[e.id]?.w || 0);
        if (mx > 0 && mx > best) prs.push(e.id);
      }
      const w = { id: uid(), d, start, end, routineId: r.id, routineGroupId: group.id, name: r.name, bw, entries, prs };
      w.vol = workoutVolume(w);
      for (const e of entries) {
        const mx = Math.max(0, ...e.sets.filter(x => x.done && !isWarmupRow(x)).map(x => x.w || 0));
        if (mx > 0) { const cur = S.exWeights[e.id]; if (!cur || mx > cur.w) S.exWeights[e.id] = { w: mx, d }; }
      }
      S.workouts.push(w);
      markEntry(p.id, d, start - int(3, 12) * MIN);
    }
  }

  // ---------- ingresos sueltos de los socios de relleno ----------
  for (const p of [...people.values()].filter(x => x.extra && x.visitsPerWeek)) {
    for (let d = addDays(p.joinDate, 0); d <= T; d = addDays(d, 1)) {
      if (weekdayOf(d) === 0) continue;                       // domingo cerrado
      if (!canUseOn(p, d)) continue;
      if (!chance(p.visitsPerWeek / 6)) continue;
      const ts = between(d, GYM.opens, '21:30');
      if (ts > now - 10 * MIN) continue;
      markEntry(p.id, d, ts);
    }
  }

  // ---------- clases: semanas pasadas y la semana que viene ----------
  const settings = { ...CLASS_DEFAULTS, enabled: true };
  const pastFrom = daysAgo(GYM.classWeeks * 7);
  const horizon = GYM.classWeeks * 7 + settings.bookAheadDays;
  const types = cdb.getClassTypes();
  const slots = cdb.getClassSlots();
  const occs = occurrencesBetween({ types, slots, from: pastFrom, days: horizon, userNames });
  const nowClock = gymClock(now, tz);
  const startTs = occ => at(occ.date, occ.start);
  const endTs = occ => startTs(occ) + occ.type.durationMin * MIN;
  const classKeyOf = occ => [...classTypes.values()].find(t => t.id === occ.classId).key;
  const fans = [];   // [persona, clase, día, probabilidad, fija]
  for (const p of people.values()) {
    for (const c of p.classes || []) {
      if (Array.isArray(c)) fans.push({ p, cls: c[0], weekday: c[1], chance: c[2], recurring: false });
      else fans.push({ p, cls: c.class, weekday: c.weekday, chance: c.chance, recurring: !!c.recurring });
    }
  }
  // Reservas fijas.
  const recurring = new Map();   // `${slotId}:${userId}` → recurringId
  for (const f of fans.filter(x => x.recurring)) {
    const type = classTypes.get(f.cls);
    const slot = type.slots.find(s => s.weekday === f.weekday);
    const r = cdb.addRecurring(slot.id, f.p.id);
    sql.prepare('UPDATE class_recurring SET created_at = ? WHERE id = ?').run(iso(f.p.joinTs + int(1, 3) * DAY_MS), r.id);
    recurring.set(`${slot.id}:${f.p.id}`, r.id);
  }
  // Una Pilates de hace unas semanas se suspendió (la profe estaba enferma).
  const suspendedOcc = occs.find(o => classKeyOf(o) === 'pilates' && o.date >= daysAgo(20) && o.date <= daysAgo(14));
  const classMonthUsed = new Map();  // `${userId}:${YYYY-MM}` → reservas que cuentan para el plan
  const bookingsMade = [];
  const sofia = people.get('sofia');
  const spinTuesday = classTypes.get('spinning').slots.find(s => s.weekday === 2).id;
  const fullOcc = occs.find(o => classKeyOf(o) === 'spinning' && o.date > T && o.date <= addDays(T, settings.bookAheadDays) && o.slotId !== spinTuesday);
  if (!fullOcc) throw new Error('no hay Spinning en la semana que viene');
  // Sofía queda primera en la lista de espera de la clase llena: ese lugar ya cuenta para su plan.
  classMonthUsed.set(`${sofia.id}:${fullOcc.date.slice(0, 7)}`, 1);
  const planAllows = (p, occ) => {
    const plan = p.plan && plans.get(p.plan);
    if (!plan?.classLimit) return true;
    const key = `${p.id}:${occ.date.slice(0, 7)}`;
    const used = classMonthUsed.get(key) || 0;
    if (used >= plan.classLimit) return false;
    classMonthUsed.set(key, used + 1);
    return true;
  };
  for (const occ of occs) {
    if (occ.cancelled) continue;
    if (occ.date > addDays(T, settings.bookAheadDays)) continue;
    const isPast = endTs(occ) <= now;
    const type = occ.type;
    const cap = capOf(type);
    const opensAt = at(addDays(occ.date, -settings.bookAheadDays), occ.start);
    // Se reserva hasta 2 h antes (y nunca después de ahora).
    const latest = Math.min(startTs(occ) - 120 * MIN, now - MIN);
    const seen = new Set();
    const wants = fans
      .filter(f => f.cls === classKeyOf(occ) && f.weekday === weekdayOf(occ.date) && f.p.joinDate < occ.date && canUseOn(f.p, occ.date) && (f.recurring || chance(f.chance)))
      .filter(f => !seen.has(f.p.id) && seen.add(f.p.id))
      .filter(f => planAllows(f.p, occ));
    // Cuándo reservó cada uno: la fija apenas abre la fecha; el resto, en algún momento antes.
    let list = wants.map(f => {
      const recurringId = occ.slotId ? recurring.get(`${occ.slotId}:${f.p.id}`) || null : null;
      const lo = Math.max(opensAt, f.p.joinTs + MIN);
      const bookedAt = recurringId ? lo + int(0, 30) * 1000 : lo + Math.floor(rand() * Math.max(0, latest - lo));
      return { p: f.p, recurringId, bookedAt };
    }).filter(x => x.bookedAt <= latest).sort((a, b) => a.bookedAt - b.bookedAt).slice(0, cap === Infinity ? undefined : cap);
    if (occ === fullOcc) {
      // La clase llena de la semana que viene: cupo completo y dos en lista de espera (Sofía, la
      // primera). Los demás reservaron antes que ellos.
      const fillUntil = latest - 180 * MIN;
      list = list.map(x => ({ ...x, bookedAt: Math.min(x.bookedAt, fillUntil) }));
      const others = [...people.values()].filter(x => x.extra && x.app && x.plan && !plans.get(x.plan).classLimit && x.joinDate < occ.date && canUseOn(x, occ.date) && !list.some(l => l.p === x));
      while (list.length < cap && others.length) {
        const p = others.splice(Math.floor(rand() * others.length), 1)[0];
        const lo = Math.max(opensAt, p.joinTs + MIN);
        list.push({ p, recurringId: null, bookedAt: lo + Math.floor(rand() * Math.max(0, fillUntil - lo)) });
      }
      if (list.length < cap) throw new Error('no alcanzan los socios para llenar la clase');
      list.sort((a, b) => a.bookedAt - b.bookedAt);
      list.push({ p: sofia, recurringId: null, bookedAt: latest - int(60, 150) * MIN, waitlist: true });
      const second = others.shift();
      if (second) list.push({ p: second, recurringId: null, bookedAt: latest - int(5, 50) * MIN, waitlist: true });
    }
    if (!list.length) continue;
    const session = cdb.ensureClassSession({ classId: occ.classId, slotId: occ.slotId, date: occ.date, start: occ.start });
    for (const item of list) {
      // Sin app, lo anota recepción (en el mostrador o por teléfono).
      const addedBy = item.p.app === false ? receptionist.id : null;
      if (addedBy && weekdayOf(gymClock(item.bookedAt, tz).date) === 0) item.bookedAt -= DAY_MS;
      const res = cdb.bookOrWaitlist({ sessionId: session.id, userId: item.p.id, capacity: cap, reminders: [60], recurringId: item.recurringId, addedBy, force: false });
      if (!res.created) throw new Error('reserva repetida');
      if (res.booking.status !== (item.waitlist ? 'waitlist' : 'booked')) throw new Error(`reserva en ${res.booking.status}: ${type.name} ${occ.date}`);
      sql.prepare('UPDATE class_bookings SET created_at = ?, updated_at = ? WHERE id = ?').run(iso(item.bookedAt), iso(item.bookedAt), res.booking.id);
      bookingsMade.push({ occ, session, booking: res.booking, p: item.p, bookedAt: item.bookedAt, isPast });
    }
    if (occ === suspendedOcc) {
      // Suspendida con un día de aviso: las reservas pasan a canceladas por la suspensión.
      cdb.updateClassSession(session.id, { cancelled: true });
      cdb.cancelSessionBookings(session.id);
      const suspendedAt = iso(startTs(occ) - int(18, 30) * 60 * MIN);
      sql.prepare('UPDATE class_bookings SET updated_at = ? WHERE session_id = ?').run(suspendedAt, session.id);
      for (const b of bookingsMade.filter(x => x.session.id === session.id)) Object.assign(b, { final: 'cancelled', cancelTs: Date.parse(suspendedAt) });
    }
  }
  if (!bookingsMade.some(b => b.occ === fullOcc && b.p === sofia && b.booking.status === 'waitlist')) throw new Error('falta la clase llena con lista de espera');
  // Lo que pasó en cada fecha ya terminada.
  const classAttendance = [];   // { p, occ, booking } presentes (van al historial)
  const rollCalls = [];
  const bySession = new Map();
  for (const b of bookingsMade.filter(x => x.isPast && !x.final)) (bySession.get(b.session.id) || bySession.set(b.session.id, []).get(b.session.id)).push(b);
  for (const list of bySession.values()) {
    const occ = list[0].occ;
    const cap = capOf(occ.type);
    // Una parte cancela: con tiempo (más de cancelHours antes) o tarde (cuenta como ausencia). El
    // lugar se libera igual; en las fechas pasadas no quedó nadie esperando.
    for (const b of list) {
      const roll = rand();
      const onTimeLimit = startTs(occ) - (settings.cancelHours * 60 + 10) * MIN;
      if (roll < 0.06 && b.bookedAt < onTimeLimit - 60 * MIN) {
        b.final = 'cancelled';
        b.cancelTs = b.bookedAt + Math.floor(rand() * (onTimeLimit - b.bookedAt));
      } else if (roll < 0.1 && b.bookedAt < startTs(occ) - 20 * MIN) {
        b.final = 'late_cancel';
        const lo = Math.max(b.bookedAt + MIN, startTs(occ) - (settings.cancelHours * 60 - 5) * MIN);
        b.cancelTs = lo + Math.floor(rand() * Math.max(0, startTs(occ) - 15 * MIN - lo));
      }
      if (b.final) {
        cdb.cancelAndPromote({ bookingId: b.booking.id, kind: b.final, promote: false, capacity: cap });
        sql.prepare('UPDATE class_bookings SET updated_at = ? WHERE id = ?').run(iso(b.cancelTs), b.booking.id);
      }
    }
    const remaining = list.filter(b => !b.final);
    for (const b of remaining) b.came = chance(0.88);
    // La profe con cuenta toma lista en la mayoría de sus clases (hasta una hora después del final).
    const rollTs = endTs(occ) + int(1, 50) * MIN;
    if (occ.teacherUserId && rollTs < now && chance(0.85)) {
      for (const b of remaining) {
        cdb.updateBooking(b.booking.id, { status: b.came ? 'attended' : 'absent', attendanceSource: 'teacher' });
        sql.prepare('UPDATE class_bookings SET updated_at = ? WHERE id = ?').run(iso(rollTs), b.booking.id);
        b.final = b.came ? 'attended' : 'absent';
      }
      cdb.updateClassSession(list[0].session.id, { attendanceTaken: true });
      rollCalls.push({ occ, ts: rollTs, present: remaining.filter(b => b.came).length, absent: remaining.filter(b => !b.came).length });
    }
    for (const b of remaining) if (b.came) markEntry(b.p.id, occ.date, startTs(occ) - int(5, 15) * MIN);
  }
  // Segunda pasada: "¿Fuiste?" y la resolución de las 24 h, con todos los ingresos del día ya
  // registrados (el servidor la hace un día después, cuando ya entró todo el mundo).
  for (const list of bySession.values()) {
    const occ = list[0].occ;
    for (const b of list) {
      if (b.final) continue;
      // Contesta "¿Fuiste?" (la mayoría, dentro de las 48 h) o se resuelve a las 24 h.
      const answerTs = endTs(occ) + int(20, 20 * 60) * MIN;
      if (b.p.app !== false && chance(b.came ? 0.6 : 0.4) && answerTs < now) {
        cdb.updateBooking(b.booking.id, { status: b.came ? 'attended' : 'absent', attendanceSource: 'member', answeredAt: iso(answerTs) });
        sql.prepare('UPDATE class_bookings SET updated_at = ? WHERE id = ?').run(iso(answerTs), b.booking.id);
        b.final = b.came ? 'attended' : 'absent';
      } else {
        const checkedIn = (workoutDays.get(b.p.id) || new Map()).has(occ.date);
        const r = resolveAttendance({ occ, booking: { status: 'booked', answeredAt: null }, checkedIn, now: nowClock });
        if (r) {
          cdb.updateBooking(b.booking.id, { status: r.status, attendanceSource: r.source });
          sql.prepare('UPDATE class_bookings SET updated_at = ? WHERE id = ?').run(iso(endTs(occ) + (24 * 60 + int(1, 5)) * MIN), b.booking.id);
          b.final = r.status;
        } else b.final = 'booked';    // terminó hace menos de 24 h: todavía le preguntan "¿Fuiste?"
      }
    }
  }
  // Recordatorios ya enviados: los que tocaban después de reservar y antes de cancelar.
  for (const b of bookingsMade) {
    const sent = b.booking.reminders.filter(m => {
      const due = startTs(b.occ) - m * MIN;
      return due > b.bookedAt && due <= now && (b.cancelTs == null || due < b.cancelTs);
    });
    if (sent.length) cdb.updateBooking(b.booking.id, { remindersSent: sent });
  }
  // Calificaciones y el entrenamiento de la clase en el historial de los presentes (con la app: sin
  // app no se califica ni hay historial).
  for (const b of bookingsMade.filter(x => x.final === 'attended' && x.p.app !== false)) {
    const fresh = cdb.getBooking(b.booking.id);
    let rating = null;
    if (['member', 'teacher'].includes(fresh.attendanceSource) && chance(0.6)) rating = pick([5, 5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4, 3, 3, 3, 2]);
    cdb.updateBooking(b.booking.id, { rating, logged: true });
    classAttendance.push({ p: b.p, occ: b.occ, booking: fresh });
  }

  // Entrenamiento de cada clase a la que fue (classWorkout del servidor, como GET /answer).
  for (const { p, occ, booking } of classAttendance) {
    const S = states.get(p.id) || states.set(p.id, baseState(p)).get(p.id);
    S.workouts.push(classWorkout({ occ, bookingId: booking.id, tz }));
  }

  // ---------- meta semanal y guardado del estado (PUT /api/data) ----------
  for (const [userId, S] of states) {
    S.workouts.sort((a, b) => a.start - b.start);
    // Cada entreno guarda el objetivo de su semana, en el orden en que se cargaron (stampWeekTargets).
    const done = [];
    for (const w of S.workouts) {
      const before = { ...S, workouts: [...done] };
      const after = { ...S, workouts: [...done, w] };
      stampWeekTargets(before, after);
      done.push(w);
    }
    S.workouts = done;
    S.bodyweight.sort((a, b) => (a.d < b.d ? -1 : 1));
    if (S.bodyweight.length && S.pesoKg != null) S.pesoKg = S.bodyweight.at(-1).w;
    if (S.workouts.length) S.planIniciado = true;
    const out = applyStatePut({ db: sql, userId, state: JSON.parse(JSON.stringify(S)), getUserState: db.getUserState, saveUserState: db.saveUserState });
    if (out.status !== 200) throw new Error(`estado de ${userId}: ${JSON.stringify(out.body)}`);
  }
  // Última sincronización = la última vez que usó la app (no hoy para todos): el panel cuenta los
  // "activos esta semana" con esto.
  const lastUse = new Map();
  const touch = (userId, ts) => { if (ts <= now && ts > (lastUse.get(userId) || 0)) lastUse.set(userId, ts); };
  for (const [userId, S] of states) for (const w of S.workouts) touch(userId, w.kind === 'class' ? w.end + int(20, 600) * MIN : w.end + int(1, 5) * MIN);
  for (const b of bookingsMade) if (b.p.app !== false) touch(b.p.id, b.bookedAt);
  for (const [userId, S] of states) {
    const ts = lastUse.get(userId) || (people.get([...people.values()].find(p => p.id === userId)?.key)?.joinTs ?? now);
    const versions = Object.fromEntries(Object.keys(JSON.parse(sql.prepare('SELECT sync_versions FROM user_state WHERE user_id = ?').get(userId).sync_versions || '{}')).map(k => [k, ts]));
    sql.prepare('UPDATE user_state SET _ts = ?, sync_versions = ? WHERE user_id = ?').run(ts, JSON.stringify(versions), userId);
  }

  // ---------- ingreso físico ----------
  const { device } = createDevice(sql, { name: DEVICE_NAME, createdBy: receptionist.id });
  sql.prepare('UPDATE checkin_devices SET created_at = ?, last_used_at = ? WHERE id = ?').run(juan.joinTs + DAY_MS, now - int(5, 60) * MIN, device.id);
  const insertAttendance = sql.prepare("INSERT INTO attendance (user_id, date, source, device_id, created_at) VALUES (?, ?, 'physical', ?, ?)");
  const checkins = [];
  for (const [userId, days] of workoutDays) {
    for (const [date, ts] of days) {
      if (ts > now) continue;
      insertAttendance.run(userId, date, device.id, ts);
      checkins.push({ userId, ts });
    }
  }

  // ---------- nutrición (Juan y Lucía) ----------
  const foods = new Map(ALIMENTOS_BASE.map(a => [a.nombre, a]));
  const insertMeal = sql.prepare('INSERT INTO comidas_registradas (user_id, fecha, franja, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const mealTimes = { desayuno: '08:30', almuerzo: '13:30', merienda: '17:30', cena: '21:30' };
  for (const p of PEOPLE.filter(x => x.nutritionDays).map(x => people.get(x.key))) {
    const scale = p.sex === 'femenino' ? 0.8 : 1.1;
    for (let i = p.nutritionDays - 1; i >= 0; i--) {
      const d = daysAgo(i);
      for (const [franja, options] of Object.entries(MEALS)) {
        if (d === T && at(d, mealTimes[franja]) > now) continue;
        if (chance(0.08)) continue;                // alguna comida sin anotar
        for (const [name, grams] of pick(options)) {
          const food = foods.get(name);
          if (!food) throw new Error('alimento desconocido: ' + name);
          const g = food.gramosPorUnidad ? Math.max(1, Math.round(grams * scale / food.gramosPorUnidad)) * food.gramosPorUnidad : Math.round(grams * scale / 10) * 10;
          const n = calcularNutrientesPorCantidad(food, g);
          insertMeal.run(p.id, d, franja, food.nombre, g, n.calorias, n.proteina, n.carbohidratos, n.grasas);
        }
      }
    }
  }

  // ---------- cierre del gimnasio (feriado, fuera de la ventana de reservas) ----------
  let closureDate = addDays(T, settings.bookAheadDays + 3);
  if (weekdayOf(closureDate) === 0) closureDate = addDays(closureDate, 1);
  const closure = cdb.addClosure({ from: closureDate, to: closureDate, reason: 'Feriado', createdBy: juan.id });
  sql.prepare('UPDATE class_closures SET created_at = ? WHERE id = ?').run(iso(now - int(2, 5) * DAY_MS), closure.id);

  // ---------- registro de actividad ----------
  const userById = new Map([...people.values()].map(p => [p.id, p]));
  const auditFrom = now - 89 * DAY_MS;
  const ev = (ts, name, f = {}) => { if (ts >= auditFrom && ts <= now) audit.push({ ts, ev: name, ...f }); };
  const who = p => ({ uid: p.id, name: p.username });
  const tgt = p => ({ tgt: p.id, tname: p.username });
  for (const p of people.values()) {
    if (!p.extra) continue;
    if (p.app) ev(p.joinTs, 'auth.register.ok', { ...who(p), msg: 'pendiente' });
    else {
      const first = payments.find(pm => pm.userId === p.id);
      ev(p.joinTs, 'admin.member.create', { ...who(receptionist), ...tgt(p), summary: [`DNI ${maskDni(p.dni)}`, first ? `Plan: ${first.planName} · vence ${first.dueDate}` : null].filter(Boolean).join(' · ') });
    }
  }
  for (const p of [...people.values()].filter(x => x.extra && x.app && x.status !== 'pendiente')) {
    const first = payments.find(pm => pm.userId === p.id);
    if (first) ev(first.paidAt - 30000, 'admin.member.approve', { ...who(userById.get(first.createdBy)), ...tgt(p), summary: `Habilitada con primer pago · DNI ${maskDni(p.dni)}` });
  }
  for (const pm of payments) {
    const by = userById.get(pm.createdBy);
    ev(pm.paidAt, 'admin.billing.payment', { ...who(by), ...tgt(userById.get(pm.userId)), summary: `$${pm.amount} · ${pm.method} · ${pm.planName} · vence ${pm.dueDate}` });
    if (pm.voidedAt) ev(pm.voidedAt, 'admin.billing.payment_void', { ...who(by), ...tgt(userById.get(pm.userId)), summary: `$${pm.amount} · vuelve a vencer ${pm.backTo} · Monto mal cargado` });
  }
  for (const p of [...people.values()].filter(x => x.trialUntil)) ev(p.joinTs + MIN, 'admin.billing.trial_start', { ...who(receptionist), ...tgt(p), summary: `Prueba de ${TRIAL_DAYS} días · hasta ${p.trialUntil}` });
  for (const c of checkins) ev(c.ts, 'checkin.ok', { ...tgt(userById.get(c.userId)), msg: `device=${DEVICE_NAME}` });
  const DAYS_AUDIT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
  for (const r of rollCalls) {
    const teacher = userById.get(r.occ.teacherUserId);
    const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
    ev(r.ts, 'classes.attendance', { ...who(teacher), msg: `${r.occ.type.name} · ${DAYS_AUDIT[weekdayOf(r.occ.date)]} ${Number(r.occ.date.slice(8, 10))}/${Number(r.occ.date.slice(5, 7))} ${r.occ.start}: ${count(r.present, 'presente', 'presentes')}, ${count(r.absent, 'ausente', 'ausentes')}` });
  }
  audit.sort((a, b) => a.ts - b.ts);
  const auditLines = audit.map((e, i) => JSON.stringify({ id: i + 1, ts: e.ts, ev: e.ev, ok: true, ...(e.uid ? { uid: e.uid, name: e.name } : {}), ...(e.tgt ? { tgt: e.tgt, tname: e.tname } : {}), ...(e.msg ? { msg: e.msg } : {}), ...(e.summary ? { summary: e.summary } : {}) }));
  fs.writeFileSync(path.join(process.env.DATA_DIR, 'audit.log'), auditLines.join('\n') + '\n');

  // ---------- códigos para entrar (vinculación, 72 h) ----------
  // Los perfiles sin código tienen la app instalada (passkey de ejemplo, como los socios de relleno).
  const linkCodes = [];
  for (const p of PEOPLE.map(x => people.get(x.key))) {
    if (p.role !== 'owner' && !profileCodes) { addCredential(p.id, p.joinTs); continue; }
    const code = formatLinkCode(n => crypto.randomInt(0, n));
    db.issueLinkCode({ userId: p.id, codeHash: sha256(code), createdBy: juan.id, expiresAt: iso(now + 72 * 3600000) });
    linkCodes.push({ key: p.key, username: p.username, fullName: p.fullName, role: p.role, code });
  }

  log(`personas: ${people.size} · pagos: ${payments.length} · reservas: ${bookingsMade.length} · ingresos: ${checkins.length} · eventos: ${audit.length}`);
  return { today: T, people: [...people.values()].map(({ id, key, username, fullName, role, status, plan, extra, app }) => ({ id, key, username, fullName, role, status, plan, extra: !!extra, app: !!app })), linkCodes, fullOccDate: fullOcc.date, closureDate };
}
