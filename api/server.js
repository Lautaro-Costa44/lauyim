/* opengym-api — passkey (WebAuthn) auth + per-user state storage for openGym
   SQLite storage via node:sqlite, signed session cookies.                  */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';
import {
  generateRegistrationOptions, verifyRegistrationResponse,
  generateAuthenticationOptions, verifyAuthenticationResponse
} from '@simplewebauthn/server';
import { dayReminderPush, gymFeePush, restTimerPush, testPush } from './push-messages.js';
import { startScheduler } from './scheduler.js';
import { sendPushToSubscription, pushEndpointError } from './push-send.js';
import { verifyError } from './verify-error.js';
import { clientIpFrom } from './client-ip.js';
import { processSyncBatch } from './sync.js';
import { applyStatePut } from './data-put.js';
import { alignActiveGroupForAudit, detectRoutineAuditChanges } from './routine-audit.js';
import { ALIMENTOS_BASE } from './alimentos-base.js';
import { ALIMENTOS_USDA_DICT } from './alimentos-usda-dict.js';
import {
  initDatabase,
  getAllUsers,
  getUserById,
  deleteUser,
  createUser,
  isoTimestamp,
  updateUser,
  getCredentialById,
  getCredentialsByUserId,
  createCredential,
  updateCredentialCounter,
  getSubscriptionsByUserId,
  getAllSubscriptions,
  createSubscription,
  deleteSubscription,
  deleteSubscriptionsByUserId,
  getAllInvites,
  getInviteByCode,
  createInvite,
  updateInviteUsedBy,
  deleteInvite,
  getAllPresets,
  getPresetById,
  getPresetWithExercises,
  getPresetGroups,
  getPublicCustomExercises, savePublicCustomExercise, deletePublicCustomExercise,
  createPreset,
  updatePreset,
  deletePreset,
  duplicatePreset,
  duplicatePresetProgram,
  renamePresetProgram,
  deletePresetProgram,
  reorderPresets,
  getPresetPrograms,
  getPresetProgramById,
  setPresetProgramVisibility,
  getPresetProgramByName,
  getPresetProgramUsage,
  getPresetCustomExercises,
  ensurePresetCustomCopies,
  routineExerciseIds,
  getUserState,
  saveUserState,
  getWorkoutsByUserId,
  getAdminSetting,
  setAdminSetting,
  getOrCreateQrAccessToken,
  getAttendanceByDate,
  getDatabase,
  getNutritionGoals,
  setNutritionGoals,
  getUserObjetivo,
  setUserObjetivo,
  getAdminSuggestionsByUserId,
  getPlantillaWithIngredientes,
  assignExistingPlantillaToUser,
  createCustomSuggestionForUser,
  updateAdminSuggestion,
  setSuggestionEnabled,
  removeAdminSuggestion,
  logAdminAction,
  getGlobalTemplates,
  findGlobalTemplateByNombreCategoria,
  createGlobalTemplate,
  updateGlobalTemplate,
  countAssignedUsersForGlobalTemplate,
  deleteGlobalTemplate,
  getRoutinesByUserId,
  saveRoutines,
  getRoutineGroups,
  saveRoutineGroups,
  getLesiones,
  saveLesiones,
  getWeekPlanByUserId,
  saveWeekPlan,
  getDayPlanByUserId,
  saveDayPlan,
  getPlans,
  getPlanById,
  createPlan,
  updatePlan,
  getMemberBilling,
  getAllMemberBilling,
  setMemberBilling,
  recordPayment, startTrial,
  getPaymentsByUserId,
  getPaymentById,
  getLatestActivePayment,
  voidPayment,
  getMemberProfile,
  findMemberByDni,
  countCredentials,
  getAppUserIds,
  getProfileUserIds,
  countAppUsers,
  isDniUniqueError,
  createMember,
  updateMemberProfile,
  issueLinkCode,
  revokeLinkCodes,
  getLinkCodeByHash,
  isLinkCodeUsable,
  recordLinkCodeFailure,
  consumeLinkCode,
  mergeMember,
  getTrialsByUserId,
  getAllMemberProfiles,
  importMembers
} from './database.js';
import {
  MEMBER_FIELDS_SETTING, parseMemberFields, validateMemberFields, validateMemberProfile,
  normalizeDni, maskDni, profileChangeSummary, formatLinkCode, canonicalLinkCode, missingRequiredFields
} from './members.js';
import { parseImportBody, analyzeImport } from './member-import.js';
import { PRIVACY_GYM_NAME_SETTING, PRIVACY_CONTACT_SETTING, validatePrivacySettings } from './privacy.js';
import {
  getBillingSettings, validateBillingSettings, serializeBillingSetting, gymToday,
  billingStatus, nextDueDate, debtTotal, isIsoDate, daysBetween,
  isBillingEnabled, getBillingNotifyHour, isValidNotifyHour, BILLING_ENABLED_SETTING, BILLING_NOTIFY_HOUR_SETTING,
  memberDebt, isTrialEnded, trialEndDate, hasActivePlan
} from './billing.js';

const PORT = +(process.env.PORT || 3000);
const DATA = process.env.DATA_DIR || '/data';
const RP_ID = process.env.RP_ID || 'localhost';
const ORIGIN = process.env.ORIGIN || 'http://localhost:8080';
const RP_NAME = process.env.RP_NAME || 'openGym';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let apiVersion = '2.0.0';
try {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  apiVersion = pkg.version || apiVersion;
} catch {}
// Admin dashboard (issue): admins are matched by uid; INVITE_ONLY gates new signups behind a
// code the admin generates. Both default off so a fresh self-hosted instance stays open.
const ADMIN_UIDS = (process.env.ADMIN_UIDS || '').split(',').map(s => s.trim()).filter(Boolean);
const DEMO_ADMIN_ALL_USERS = /^(1|true|yes|on)$/i.test(process.env.DEMO_ADMIN_ALL_USERS || '');
const INVITE_ONLY = /^(1|true|yes|on)$/i.test(process.env.INVITE_ONLY || '');
// Guest mode ("Continue without account") keeps everything in the browser and never touches this
// server — but on an instance meant for a known set of people, an entrance nobody can walk back
// out of is still the wrong front door (#42). Default ON, so existing instances are unchanged;
// the polarity is inverted from INVITE_ONLY because the safe default here is the permissive one.
const ALLOW_GUEST = !/^(0|false|no|off)$/i.test(process.env.ALLOW_GUEST || '');

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Motor de encuesta de onboarding y generación de rutinas. Default true; poner SURVEY_ENABLED=false
// para ocultar completamente la opción en el frontend sin afectar rutinas ya generadas.
const SURVEY_ENABLED = !/^(0|false|no|off)$/i.test(process.env.SURVEY_ENABLED || 'true');
// Única variable del módulo de nutrición (metas + sugerencias de comida). Default true.
// NUTRICION_AUTOMATICO=0 oculta el toggle de cálculo automático en el panel admin: el modo
// es siempre manual y, sin metas/sugerencias cargadas por el admin, el socio no ve ningún
// valor calculado ni las plantillas globales.
const NUTRICION_AUTOMATICO = !/^(0|false|no|off)$/i.test(process.env.NUTRICION_AUTOMATICO || 'true');

// Única función que resuelve el toggle "Limitar comidas sugeridas" (goals.limitarSugeridas
// tri-state: null/true/false). Preferencia explícita del socio gana siempre; sin ella, cae al
// default derivado de NUTRICION_AUTOMATICO. Usada tanto por el gate de sugerencias del socio
// (GET /api/plantillas) como por lo que ve el admin (GET .../nutrition) — no repliques esta
// lógica en otro lado.
function limitarSugeridasEfectivo(userId) {
  const goals = getNutritionGoals(userId);
  return typeof goals.limitarSugeridas === 'boolean' ? goals.limitarSugeridas : !NUTRICION_AUTOMATICO;
}
// 90 days keeps someone who trains a few times a week permanently signed in without a stolen
// cookie staying good for a year. Overridable because a family instance and one on the open
// internet don't want the same number. Only affects cookies minted from now on — the expiry is
// baked into each cookie when it's issued, so lowering this never cuts an existing session short.
const SESSION_DAYS = Math.max(1, +(process.env.SESSION_DAYS || 90) || 90);
const MAX_BODY = 5 * 1024 * 1024;
// Rate limit: requests por ventana de 5 min, contando todas (no solo las fallidas). Cada
// ruta tiene un cupo por IP (en un gym con wifi todos los socios comparten la IP pública, por
// eso son altos) y algunas un segundo cupo por credencial o usuario. Override por env.
const envMax = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};
const RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;
const RATE_LIMIT_LOGIN_MAX = envMax('RATE_LIMIT_LOGIN_MAX', 60);                 // por IP: login/options, login/verify
const RATE_LIMIT_REGISTER_MAX = envMax('RATE_LIMIT_REGISTER_MAX', 30);           // por IP: register/options, register/verify
const RATE_LIMIT_QR_MAX = envMax('RATE_LIMIT_QR_MAX', 60);                       // por IP: access/qr
const RATE_LIMIT_DEVICE_START_MAX = envMax('RATE_LIMIT_DEVICE_START_MAX', 30);   // por IP: device/start
const RATE_LIMIT_DEVICE_MAX = envMax('RATE_LIMIT_DEVICE_MAX', 60);               // por IP: device/claim, device/confirm
const RATE_LIMIT_PER_CREDENTIAL_MAX = envMax('RATE_LIMIT_PER_CREDENTIAL_MAX', 10); // por credencial: login/verify
const RATE_LIMIT_PER_USER_MAX = envMax('RATE_LIMIT_PER_USER_MAX', 10);           // por usuario: device/claim, device/confirm
const RATE_LIMIT_SHARE_MAX = envMax('RATE_LIMIT_SHARE_MAX', 20);
const RATE_LIMIT_SUPPORT_MAX = envMax('RATE_LIMIT_SUPPORT_MAX', 5);
const RATE_LIMIT_LINK_MAX = envMax('RATE_LIMIT_LINK_MAX', 30);                   // por IP: link/options, link/verify
const RATE_LIMIT_PER_LINK_CODE_MAX = envMax('RATE_LIMIT_PER_LINK_CODE_MAX', 20); // por código: link/options
const RATE_LIMIT_IMPORT_MAX = envMax('RATE_LIMIT_IMPORT_MAX', 30);               // por usuario: owner/members/import (vistas previas incluidas)
// device/poll queda afuera: el cliente lo llama cada 2 s y el pairingId (128 bits) no se adivina.
const RATE_LIMITS_BY_IP = {
  'POST /api/login/options': RATE_LIMIT_LOGIN_MAX,
  'POST /api/login/verify': RATE_LIMIT_LOGIN_MAX,
  'POST /api/register/options': RATE_LIMIT_REGISTER_MAX,
  'POST /api/register/verify': RATE_LIMIT_REGISTER_MAX,
  'POST /api/access/qr': RATE_LIMIT_QR_MAX,
  'POST /api/auth/device/start': RATE_LIMIT_DEVICE_START_MAX,
  'POST /api/auth/device/claim': RATE_LIMIT_DEVICE_MAX,
  'POST /api/auth/device/confirm': RATE_LIMIT_DEVICE_MAX,
  'POST /api/share/plan': RATE_LIMIT_SHARE_MAX,
  'POST /api/support': RATE_LIMIT_SUPPORT_MAX,
  'POST /api/link/options': RATE_LIMIT_LINK_MAX,
  'POST /api/link/verify': RATE_LIMIT_LINK_MAX
};
// Secure cookies require HTTPS; over plain http://localhost the flag would drop the cookie
const SECURE = /^https:/i.test(ORIGIN) ? ' Secure;' : '';

// Licencia por fecha (LICENSE_EXPIRES_AT)
const LICENSE_EXPIRES_AT = process.env.LICENSE_EXPIRES_AT ? new Date(process.env.LICENSE_EXPIRES_AT).getTime() : null;

fs.mkdirSync(DATA, { recursive: true });

// Inicializar base de datos SQLite
initDatabase();
getOrCreateQrAccessToken();

function qrTokenMatches(candidate) {
  const raw = String(candidate || '');
  const current = getOrCreateQrAccessToken();
  if (!raw || raw.length !== current.length) return false;
  return crypto.timingSafeEqual(Buffer.from(raw), Buffer.from(current));
}

/* LEGACY DB CODE (db.json) - Comentado para preservar compatibilidad / rollback rápido:
let db = { users: [], creds: [], subs: [], invites: [], presets: [] };
function saveDb() { ... }
*/

function feeDueDate(reminder, today) {
  if (!reminder?.feeOn || !/^\d{4}-\d{2}-\d{2}$/.test(reminder.feeDate || '')) return null;
  const interval = reminder.feeInterval === 'annual' ? 12 : reminder.feeInterval === 'bimonthly' ? 2 : reminder.feeInterval === 'quarterly' ? 3 : 1;
  const anchor = new Date(reminder.feeDate + 'T12:00:00');
  if (Number.isNaN(anchor.getTime())) return null;
  if (reminder.feeDate > today) return null;
  let due = new Date(anchor);
  while (due.toISOString().slice(0, 10) <= today) {
    const next = new Date(due);
    next.setMonth(next.getMonth() + interval);
    due = next;
  }
  due.setMonth(due.getMonth() - interval);
  return due.toISOString().slice(0, 10);
}

/* ---------- secret ---------- */
const secretFile = path.join(DATA, 'secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(secretFile, 'utf8').trim();

// Funciones auxiliares para compatibilidad
const isAdmin = user => !!user && (DEMO_ADMIN_ALL_USERS || user.admin === 1 || user.admin === true || ADMIN_UIDS.includes(user.id));
const isOwner = user => !!user && (user.owner === 1 || user.owner === true);
function readState(uid) {
  return getUserState(uid);
}

// Lo que el editor de ejercicio (exConfigSheet) agrega además de series/reps/peso. Antes se
// descartaba en silencio: el admin configuraba un drop-set y el preset se guardaba sin él.
const INTENSIFIER_NUMBERS = { count: [1, 10], pct: [5, 100], dropRestSec: [0, 600], backoffReps: [1, 100], totalReps: [1, 200], restSec: [1, 600] };
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+v)));
function cleanPresetExtras(item, mode) {
  const out = {};
  if (!item || typeof item !== 'object') return out;
  if (item.bodyweight === false) out.bodyweight = false;
  const note = typeof item.note === 'string' ? item.note.trim().slice(0, 500) : '';
  if (note) out.note = note;
  if (+item.warmupSets > 0) out.warmupSets = clampInt(item.warmupSets, 0, 5);
  if (typeof item.prog === 'string' && item.prog.trim()) out.prog = item.prog.trim().slice(0, 40);
  if (+item.inc > 0) out.inc = Math.min(1000, +item.inc);
  if (typeof item.sg === 'string' && item.sg.trim()) out.sg = item.sg.trim().slice(0, 40);
  if (typeof item.progressionType === 'string' && item.progressionType.trim()) out.progressionType = item.progressionType.trim().slice(0, 40);
  if (item.progressionConfig && typeof item.progressionConfig === 'object' && !Array.isArray(item.progressionConfig)
    && JSON.stringify(item.progressionConfig).length <= 2000) out.progressionConfig = item.progressionConfig;
  if (mode === 'reps') {
    if (+item.repsMin > 0) out.repsMin = clampInt(item.repsMin, 1, 100);
    if (+item.repsMax > 0) out.repsMax = clampInt(item.repsMax, 1, 100);
    const it = item.intensifier;
    if (it && typeof it === 'object' && ['dropset', 'topback', 'restpause'].includes(it.type)) {
      const intensifier = { type: it.type };
      for (const [key, [lo, hi]] of Object.entries(INTENSIFIER_NUMBERS)) if (Number.isFinite(+it[key]) && it[key] !== null && it[key] !== '') intensifier[key] = clampInt(it[key], lo, hi);
      out.intensifier = intensifier;
    }
  }
  return out;
}

// Un cliente que conoce los campos de routine_exercises.extra (intensificador, reps objetivo,
// calentamiento…) lo dice con este header, que manda lib/api.js en cada request. Sin él (una
// versión anterior de la app todavía cacheada en un teléfono), un ejercicio que llega sin esos
// campos no los borra: saveRoutines conserva los guardados.
const ROUTINE_EXTRAS_CLIENT = 'routine-extras';
const routineSaveOpts = req => ({
  preserveExtras: !String(req.headers['x-lauyim-client'] || '').split(',').map(v => v.trim()).includes(ROUTINE_EXTRAS_CLIENT)
});

// Presets, grupos y programas para GET /api/presets (includeHidden: false, lo que ve el socio) o
// GET /api/admin/presets (todo). customExercises: definición de los ejercicios custom (del admin)
// que usan esos presets, para que el socio los vea y los cuente el modelo de fatiga antes de
// que llegue su copia.
function presetCatalog({ includeHidden }) {
  const allPrograms = getPresetPrograms();
  const hidden = new Set(includeHidden ? [] : allPrograms.filter(p => !p.visibleToMembers).map(p => p.id));
  const presets = getAllPresets().filter(p => !hidden.has(p.program_id)).map(p => getPresetWithExercises(p.id));
  return {
    presets,
    groups: getPresetGroups().filter(g => !hidden.has(g.id)),
    programs: allPrograms.filter(p => !hidden.has(p.id)),
    customExercises: getPresetCustomExercises(presets)
  };
}

function cleanPreset(body, existingId) {
  const name = String(body.name || '').trim().slice(0, 80);
  if (!name) return { error: 'name required' };
  const rawPlannedDay = body.plannedDay ?? body.planned_day;
  const plannedDay = rawPlannedDay === '' || rawPlannedDay === null || rawPlannedDay === undefined
    ? null
    : Number(rawPlannedDay);
  if (plannedDay !== null && (!Number.isInteger(plannedDay) || plannedDay < 0 || plannedDay > 6)) return { error: 'invalid planned day' };
  const exercises = Array.isArray(body.ex) ? body.ex : [];
  if (exercises.length > 100) return { error: 'too many exercises' };
  const ex = exercises.map(item => {
    const id = String(item?.id || '').trim().slice(0, 80);
    const sets = Math.max(1, Math.min(20, Math.round(+item?.sets || 0)));
    const mode = item?.mode === 'time' ? 'time' : item?.mode === 'cardio' ? 'cardio' : 'reps';
    const out = { id, sets };
    if (mode === 'cardio') {
      out.min = Math.max(1, Math.min(1440, Math.round(+item?.min || 20)));
      out.speed = Math.max(0, Math.min(500, +item?.speed || 8));
    } else if (mode === 'time') {
      out.mode = 'time';
      out.sec = Math.max(1, Math.min(86400, Math.round(+item?.sec || 45)));
      out.weight = Math.max(0, Math.min(10000, +item?.weight || 0));
    } else {
      out.reps = Math.max(1, Math.min(100, Math.round(+item?.reps || 0)));
      out.weight = Math.max(0, Math.min(10000, +item?.weight || 0));
    }
    for (const key of ['bodyweight', 'side']) if (item?.[key]) out[key] = true;
    Object.assign(out, cleanPresetExtras(item, mode));
    return out;
  });
  if (ex.some(item => !item.id || !item.sets || (item.mode === 'time' ? !item.sec : item.mode === 'cardio' ? !item.min : !item.reps))) return { error: 'invalid exercise' };
  return { value: { id: existingId || 'p' + crypto.randomBytes(8).toString('hex'), name, emoji: String(body.emoji || 'dumbbell').slice(0, 40), groupName: String(body.groupName || 'General').trim().slice(0, 80) || 'General', plannedDay, ex } };
}

function findPresetDayConflict(preset, excludeId = null) {
  if (preset.plannedDay === null) return null;
  const db = getDatabase();
  return db.prepare(`
    SELECT id, name, planned_day AS plannedDay
    FROM presets
    WHERE lower(trim(group_name)) = lower(trim(?)) AND planned_day = ? AND id != ?
    LIMIT 1
  `).get(preset.groupName, preset.plannedDay, excludeId || '') || null;
}

function presetConflictResponse(res, conflict, plannedDay) {
  return json(res, 409, {
    error: 'ROUTINE_DAY_CONFLICT',
    code: 'ROUTINE_DAY_CONFLICT',
    routineName: conflict.name,
    plannedDay,
    message: `Routine "${conflict.name}" already occupies planned day ${plannedDay}.`
  });
}

const DEFAULT_PRESETS = [
  { id: 'starter-push', name: 'Push Day', emoji: 'barbell', plannedDay: 1, ex: [['0025', 4, 8], ['0047', 3, 10], ['0426', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 3, 10]] },
  { id: 'starter-pull', name: 'Pull Day', emoji: 'pullup', plannedDay: 3, ex: [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['0031', 3, 10], ['0313', 3, 12]] },
  { id: 'starter-legs', name: 'Leg Day', emoji: 'legs', plannedDay: 5, ex: [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]] }
].map(r => ({ ...r, ex: r.ex.map(([id, sets, reps]) => ({ id, sets, reps, weight: 0 })) }));

if (getAllPresets().length === 0) {
  const db = getDatabase();
  db.exec('BEGIN');
  try {
    for (const p of DEFAULT_PRESETS) {
      createPreset(p);
    }
    // El programa de ejemplo de un gym nuevo se ve, como siempre: los que crea el admin nacen ocultos.
    const seeded = getAllPresets().find(p => p.id === DEFAULT_PRESETS[0].id);
    if (seeded?.program_id) setPresetProgramVisibility(seeded.program_id, true);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
} else {
  // Existing installations predate planned_day. Seed only the built-in presets that have
  // never been assigned a day, preserving an admin's explicit null/custom choice.
  const db = getDatabase();
  const stmt = db.prepare('UPDATE presets SET planned_day = ? WHERE id = ? AND planned_day IS NULL');
  for (const p of DEFAULT_PRESETS) stmt.run(p.plannedDay, p.id);
}

/* ---------- push notifications (Web Push / VAPID) ---------- */
const vapidFile = path.join(DATA, 'vapid.json');
let vapid;
try { vapid = JSON.parse(fs.readFileSync(vapidFile, 'utf8')); }
catch { vapid = webpush.generateVAPIDKeys(); fs.writeFileSync(vapidFile, JSON.stringify(vapid), { mode: 0o600 }); }
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || (SECURE ? ORIGIN : 'mailto:admin@localhost');
webpush.setVapidDetails(VAPID_SUBJECT, vapid.publicKey, vapid.privateKey);

const PUSH_CONCURRENCY = 6;
const MAX_SUBS_PER_USER = 20;

async function sendPush(userId, payload) {
  const subs = getSubscriptionsByUserId(userId);
  if (!subs.length) return;
  const body = JSON.stringify(payload);
  let next = 0;
  const worker = async () => {
    while (next < subs.length) {
      const sub = subs[next++];
      try {
        await sendPushToSubscription(sub, body);
      } catch (e) {
        console.error('push send failed', userId, e.statusCode, e.body || e.message);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PUSH_CONCURRENCY, subs.length) }, worker));
  // saveDb(); // Eliminado: SQLite actualiza en tiempo real al ejecutar deleteSubscription
}

const restTimers = new Map();
function scheduleRestTimer(userId, sec, lang) {
  const t = restTimers.get(userId);
  if (t) clearTimeout(t);
  restTimers.set(userId, setTimeout(() => {
    restTimers.delete(userId);
    sendPush(userId, restTimerPush(lang));
  }, sec * 1000));
}
function cancelRestTimer(userId) {
  const t = restTimers.get(userId);
  if (t) { clearTimeout(t); restTimers.delete(userId); }
}

function effectiveRoutineId(S, iso) {
  const ov = S.dayPlan?.[iso];
  if (ov === 'rest') return null;
  if (ov && S.routines?.some(r => r.id === ov)) return ov;
  const wd = new Date(iso + 'T12:00:00').getDay();
  return S.week?.[wd] || null;
}

function userNow(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).formatToParts(new Date());
    const g = t => parts.find(p => p.type === t)?.value;
    return { date: `${g('year')}-${g('month')}-${g('day')}`, hhmm: `${g('hour')}:${g('minute')}` };
  } catch { return null; }
}


/* ---------- sessions (signed cookie) ---------- */
function sign(payload) {
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + mac;
}
function verifySig(token) {
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i), mac = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null;
  } catch { return null; }
  return payload;
}

const sessionVersion = user => user.sv || 0;
function makeSession(user) {
  const exp = Date.now() + SESSION_DAYS * 86400000;
  return sign(user.id + ':' + exp + ':' + sessionVersion(user));
}

const COOKIE = SECURE ? '__Host-gymsid' : 'gymsid';
const LEGACY_COOKIE = 'gymsid';

function cookieValues(req, name) {
  const out = [];
  for (const c of (req.headers.cookie || '').split(';')) {
    const i = c.indexOf('=');
    if (i < 0) continue;
    if (c.slice(0, i).trim() === name) out.push(c.slice(i + 1).trim());
  }
  return out;
}
function cookieToken(req) {
  for (const name of (COOKIE === LEGACY_COOKIE ? [COOKIE] : [COOKIE, LEGACY_COOKIE])) {
    const vals = cookieValues(req, name);
    if (!vals.length) continue;
    if (vals.some(v => v !== vals[0])) return null;
    return vals[0];
  }
  return null;
}
function readSession(req) {
  const tok = cookieToken(req);
  if (!tok) return null;
  const payload = verifySig(tok);
  if (!payload) return null;
  const [uid, exp, ver] = payload.split(':');
  if (!uid || +exp < Date.now()) return null;
  const user = getUserById(uid);
  if (!user) return null;
  if (user.disabled) return null;
  const claimed = ver === undefined ? 0 : Number(ver);
  if (!Number.isInteger(claimed) || claimed !== sessionVersion(user)) return null;
  return user;
}

function requireAdmin(req, res) {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'No has iniciado sesión' }); return null; }
  if (!isAdmin(user)) { audit(req, 'admin.denied', { ok: false, user }); json(res, 403, { error: 'No autorizado' }); return null; }
  return user;
}

function requireOwner(req, res) {
  const user = readSession(req);
  if (!user) { json(res, 401, { error: 'No has iniciado sesión' }); return null; }
  if (!isOwner(user)) { audit(req, 'owner.denied', { ok: false, user }); json(res, 403, { error: 'owner required' }); return null; }
  return user;
}

// Single reusable gate for every admin mutation that targets a socio (nutrition/routine/injury
// admin endpoints): confirms the target exists and is active before any write is allowed.
// Read-only admin views may look up getUserById directly instead of calling this.
function requireActiveTargetUser(res, userId) {
  const target = getUserById(userId);
  if (!target) { json(res, 404, { error: 'El usuario no existe' }); return null; }
  if (target.disabled) { json(res, 409, { error: 'El socio está desactivado' }); return null; }
  return target;
}

/* ---------- cuotas v1 (reglas en billing.js) ---------- */
// "Hoy" es siempre el día calendario en la tz del gym (admin_settings.gym_tz), para la API
// y para el scheduler por igual.
const billingSettingsNow = () => getBillingSettings(getDatabase());
const billingToday = settings => gymToday(Date.now(), settings.gym_tz);
// Interruptor de cuotas (lo cambia el owner). Apagado no borra ni toca ningún dato de cuotas:
// solo deja de bloquear, de avisar vencimientos y de aceptar cambios.
const billingEnabledNow = () => isBillingEnabled(getDatabase());
function billingDisabled(res) {
  if (billingEnabledNow()) return false;
  json(res, 409, { error: 'billing_disabled' });
  return true;
}

function billingView(billing, today, settings) {
  const status = billingStatus(billing, today, settings);
  return {
    planId: billing.planId, planName: billing.planName, planPrice: billing.planPrice,
    planDurationDays: billing.planDurationDays, planActive: billing.planActive,
    dueDate: billing.dueDate, trialUntil: billing.trialUntil ?? null, status, debt: memberDebt(billing, status)
  };
}

// ¿Se le puede dar la prueba gratis? Una por persona (DNI), sin plan vigente ni prueba en curso.
// → null si se puede, o el código de error del 409.
function trialBlocker(userId, billing, today, settings) {
  const profile = getMemberProfile(userId);
  if (!memberFieldsNow().dni.enabled || !profile?.dniNorm) return 'trial_requires_dni';
  if (profile.trialUsedAt) return 'trial_used';
  if (hasActivePlan(billing, today, settings) || billingStatus(billing, today, settings) === 'prueba') return 'has_plan';
  return null;
}
const TRIAL_ERRORS = {
  trial_requires_dni: 'La prueba necesita el DNI del socio (una por persona)',
  trial_used: 'Este socio ya usó su prueba',
  has_plan: 'El socio tiene un plan vigente'
};

// Historial de cuota: pagos ({ type: 'payment', ...pago }) y pruebas ({ type: 'trial',
// startDate, trialUntil, days, amount: 0, createdByName }) por fecha, el más nuevo primero.
// days: null si el backfill no pudo reconstruir el último día.
function billingHistory(payments, trials, settings) {
  const items = [
    ...payments.map(p => ({ type: 'payment', at: p.paidAt ?? 0, ...p })),
    ...trials.map(tr => {
      const startDate = gymToday(tr.startedAt, settings.gym_tz);
      const days = isIsoDate(tr.trialUntil) ? daysBetween(startDate, tr.trialUntil) + 1 : null;
      return { type: 'trial', at: tr.startedAt, id: tr.id, startDate, trialUntil: tr.trialUntil, days, amount: 0, createdByName: tr.createdByName };
    })
  ];
  return items.sort((a, b) => b.at - a.at).map(({ at, ...item }) => item);
}

// Pago a registrar (pago suelto o primer pago del alta): plan, monto, método, fecha y el
// vencimiento que deja. → { value } o { status, error }.
function checkPayment(body, current, settings) {
  const planId = body.planId ?? current.planId;
  if (planId == null) return { status: 400, error: 'El socio no tiene plan asignado' };
  if (!Number.isInteger(planId) || planId < 1) return { status: 400, error: 'planId inválido' };
  const plan = getPlanById(planId);
  if (!plan) return { status: 404, error: 'El plan no existe' };
  if (!plan.active && plan.id !== current.planId) return { status: 409, error: 'El plan está inactivo' };
  const amount = body.amount ?? plan.price;
  if (!Number.isInteger(amount) || amount < 1 || amount > MAX_PLAN_PRICE) return { status: 400, error: 'El monto debe ser un entero en pesos mayor que 0' };
  if (!settings.payment_methods.includes(body.method)) return { status: 400, error: `method debe ser uno de: ${settings.payment_methods.join(', ')}` };
  const now = Date.now();
  const paidAt = body.paidAt ?? now;
  if (!Number.isInteger(paidAt) || paidAt < 1 || paidAt > now + 86400000) return { status: 400, error: 'paidAt debe ser un instante en ms, no futuro' };
  if (body.note != null && (typeof body.note !== 'string' || body.note.length > MAX_PAYMENT_NOTE)) return { status: 400, error: `note debe ser texto (máx. ${MAX_PAYMENT_NOTE})` };
  // El período se calcula sobre el día del pago en la tz del gym (un pago cargado con fecha
  // atrasada cuenta desde ese día). Sin vencimiento previo, arranca ese día.
  const period = nextDueDate(current.dueDate, gymToday(paidAt, settings.gym_tz), plan.durationDays, settings.grace_days);
  return { value: { plan, amount, method: body.method, paidAt, note: body.note ? body.note.trim() || null : null, period } };
}

// Bloqueo por cuota: distinto de users.disabled. El socio conserva la sesión; solo se le
// rechazan las rutas de MEMBERSHIP_GATED. Admins y owner nunca quedan bloqueados, y nadie
// queda bloqueado con cuotas apagado.
function isMembershipBlocked(user) {
  if (!user || isAdmin(user) || !billingEnabledNow()) return false;
  const settings = billingSettingsNow();
  return billingStatus(getMemberBilling(user.id), billingToday(settings), settings) === 'bloqueado';
}

// Entrenamiento, sync y nutrición del socio. Fuera a propósito: /api/me, logout, credenciales,
// vinculación de dispositivos y push (el aviso de cuota tiene que poder llegarle), endpoints
// públicos y todo /api/admin y /api/owner.
const MEMBERSHIP_GATED = new Set([
  'GET /api/data', 'PUT /api/data', 'POST /api/data/sync', 'POST /api/activity', 'GET /api/presets', 'POST /api/presets/apply',
  'GET /api/alimentos/buscar',
  'POST /api/comidas', 'POST /api/comidas/grupo', 'GET /api/comidas', 'GET /api/comidas/historial',
  'DELETE /api/comidas/:id', 'DELETE /api/comidas/grupo/:grupo_id',
  'POST /api/plantillas', 'GET /api/plantillas', 'PUT /api/plantillas/:id', 'DELETE /api/plantillas/:id',
  'POST /api/comidas-compuestas', 'GET /api/nutrition/goals'
]);

const MAX_PLAN_PRICE = 100000000;      // pesos enteros
const MAX_PLAN_DAYS = 3660;
const MAX_PAYMENT_NOTE = 200;

// Valida los campos de plan presentes en `body`. `partial` permite omitir los obligatorios.
function parsePlanBody(body, partial) {
  const out = {};
  if (body.name !== undefined || !partial) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 60) return { error: 'El nombre del plan es obligatorio (máx. 60 caracteres)' };
    out.name = name;
  }
  if (body.price !== undefined || !partial) {
    if (!Number.isInteger(body.price) || body.price < 0 || body.price > MAX_PLAN_PRICE) return { error: 'El precio debe ser un entero en pesos, 0 o mayor' };
    out.price = body.price;
  }
  if (body.durationDays !== undefined || !partial) {
    if (!Number.isInteger(body.durationDays) || body.durationDays < 1 || body.durationDays > MAX_PLAN_DAYS) return { error: `La duración debe ser un entero entre 1 y ${MAX_PLAN_DAYS} días` };
    out.durationDays = body.durationDays;
  }
  if (partial && body.active !== undefined) {
    if (typeof body.active !== 'boolean') return { error: 'active debe ser true o false' };
    out.active = body.active;
  }
  return { value: out };
}

const planSummary = plan => `${plan.name} · $${plan.price} · ${plan.durationDays} días${plan.active === false ? ' · inactivo' : ''}`;
const userIdFromPath = req => decodeURIComponent(new URL(req.url, 'http://x').pathname.split('/')[4] || '');

// Plan + vencimiento a asignar (PUT billing y alta de ficha). body.planId null quita el plan.
// → { value: { plan, dueDate } | { plan: null } } o { status, error }.
function checkPlanAssignment(body, currentPlanId) {
  if (body.planId === null) return { value: { plan: null } };
  if (!Number.isInteger(body.planId) || body.planId < 1) return { status: 400, error: 'planId debe ser un id de plan o null' };
  const plan = getPlanById(body.planId);
  if (!plan) return { status: 404, error: 'El plan no existe' };
  // Un plan inactivo no se asigna de nuevo, pero quien ya lo tiene puede cambiar su vencimiento.
  if (!plan.active && plan.id !== currentPlanId) return { status: 409, error: 'El plan está inactivo' };
  if (!isIsoDate(body.dueDate)) return { status: 400, error: 'dueDate es obligatorio (YYYY-MM-DD) al asignar un plan' };
  return { value: { plan, dueDate: body.dueDate } };
}

/* ---------- fichas de socio (reglas de campos en members.js) ---------- */
const LINK_CODE_TTL_MS = 72 * 3600000;
const MAX_USER_NAME = 40;
const memberFieldsNow = () => parseMemberFields(getAdminSetting(MEMBER_FIELDS_SETTING));
const sha256 = value => crypto.createHash('sha256').update(String(value)).digest('hex');

// users.name: nombre de usuario (el mismo tope que el registro).
function parseUserName(raw) {
  const name = typeof raw === 'string' ? raw.trim().replace(/\s+/g, ' ') : '';
  if (!name || name.length > MAX_USER_NAME) return { error: `El nombre es obligatorio (máx. ${MAX_USER_NAME} caracteres)` };
  return { value: name };
}

// La ficha completa: solo para GET/PUT profile, nunca en listados.
const profileView = (user, profile) => ({
  userId: user.id,
  name: user.name,
  hasApp: countCredentials(user.id) > 0,
  disabled: !!user.disabled,
  fullName: profile?.fullName ?? null,
  dni: profile?.dni ?? null,
  phone: profile?.phone ?? null,
  phoneNorm: profile?.phoneNorm ?? null,
  email: profile?.email ?? null,
  updated: profile?.updated ?? null
});

// Otra persona ya tiene ese DNI: datos mínimos para que la UI ofrezca vincular.
const dniDuplicate = (res, other) => json(res, 409, { error: 'dni_duplicado', userId: other.userId, name: other.name, hasApp: other.hasApp });

const MERGE_ERRORS = {
  same_user: [400, 'La ficha y la cuenta son la misma persona'],
  ficha_not_found: [404, 'La ficha no existe'],
  target_not_found: [404, 'La cuenta no existe'],
  ficha_has_app: [409, 'La ficha ya tiene acceso a la app'],
  target_without_app: [409, 'La cuenta destino no tiene acceso a la app'],
  target_is_staff: [409, 'No se puede unir una ficha a un admin'],
  billing_conflict: [409, 'Las dos tienen plan: elegí cuál conservar (keepBilling)'],
  dni_conflict: [409, 'La ficha y la cuenta tienen DNI distintos']
};
const expireCookie = name => `${name}=; Path=/; Max-Age=0; HttpOnly;${SECURE} SameSite=Lax`;
function sessionCookie(user) {
  const fresh = `${COOKIE}=${makeSession(user)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly;${SECURE} SameSite=Lax`;
  return COOKIE === LEGACY_COOKIE ? [fresh] : [fresh, expireCookie(LEGACY_COOKIE)];
}
const clearCookie = COOKIE === LEGACY_COOKIE
  ? [expireCookie(LEGACY_COOKIE)]
  : [expireCookie(COOKIE), expireCookie(LEGACY_COOKIE)];

/* ---------- CSRF ---------- */
const CSRF_EXEMPT = new Set([
  'POST /api/access/qr',
  'POST /api/register/options', 'POST /api/register/verify',
  'POST /api/login/options', 'POST /api/login/verify',
  'POST /api/auth/device/start', 'GET /api/auth/device/poll',
  'POST /api/share/plan',
  'POST /api/link/options', 'POST /api/link/verify'
]);

/* ---------- Shared Plans Store (QR sharing, TTL 10 mins) ---------- */
const sharedPlans = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [code, item] of sharedPlans.entries()) {
    if (now > item.expiresAt) sharedPlans.delete(code);
  }
}, 60000).unref();
const originsMatch = (a, b) => a.replace(/\/+$/, '') === b.replace(/\/+$/, '');
function csrfOk(req, key) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return true;
  if (CSRF_EXEMPT.has(key)) return true;
  const site = req.headers['sec-fetch-site'];
  if (site) return site === 'same-origin' || site === 'none';
  const origin = req.headers.origin;
  if (!origin) return true;
  return originsMatch(origin, ORIGIN);
}

/* ---------- challenge store ---------- */
const challenges = new Map();
function putChallenge(data) {
  const cid = crypto.randomBytes(16).toString('base64url');
  challenges.set(cid, { ...data, exp: Date.now() + 5 * 60000 });
  return cid;
}
function takeChallenge(cid) {
  const c = challenges.get(cid);
  challenges.delete(cid);
  if (!c || c.exp < Date.now()) return null;
  return c;
}
setInterval(() => { for (const [k, v] of challenges) if (v.exp < Date.now()) challenges.delete(k); }, 60000).unref();

/* ---------- device pairing store ---------- */
const pendingPairings = new Map();
const manualCodeMap = new Map();

function genManualCode() {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) c += '-';
    c += chars[crypto.randomInt(0, chars.length)];
  }
  return c;
}

const PAIRING_MAX_ATTEMPTS = 5;
function dropPairing(p) {
  pendingPairings.delete(p.pairingId);
  manualCodeMap.delete(p.manualCode);
}

function cleanExpiredPairings() {
  const now = Date.now();
  for (const p of pendingPairings.values()) if (p.exp < now) dropPairing(p);
}
setInterval(cleanExpiredPairings, 60000).unref();

/* ---------- helpers ---------- */
function json(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...(extraHeaders || {}) });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', d => {
      size += d.length;
      if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(d);
    });
    req.on('end', () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}
const b64uToBuf = s => Buffer.from(s, 'base64url');

/* ---------- live presence ---------- */
const presence = new Map();
const PRESENCE_TTL = 70000;
function livePresence(uid) {
  const p = presence.get(uid);
  if (!p) return null;
  if (Date.now() - p.updatedAt > PRESENCE_TTL) { presence.delete(uid); return null; }
  return p;
}
setInterval(() => { for (const [k, v] of presence) if (Date.now() - v.updatedAt > PRESENCE_TTL) presence.delete(k); }, 30000).unref();

/* ---------- audit log ---------- */
const AUDIT_ON = !/^(0|false|no|off)$/i.test(process.env.AUDIT_LOG || '');
const AUDIT_MAX = Math.max(0, +(process.env.AUDIT_MAX || 5000) || 0);
const AUDIT_DAYS = Math.max(0, +(process.env.AUDIT_DAYS || 90) || 0);
const AUDIT_IP = /^full$/i.test(process.env.AUDIT_IP || '') ? 'full'
  : /^(1|true|yes|on|net)$/i.test(process.env.AUDIT_IP || '') ? 'net' : 'off';
const auditFile = path.join(DATA, 'audit.log');
let auditSeq = 0;
let auditCount = 0;

const rawClientIp = req => clientIpFrom(req.headers, req.socket?.remoteAddress);

function clientIp(req) {
  if (AUDIT_IP === 'off') return null;
  const ip = rawClientIp(req);
  if (!ip) return null;
  if (AUDIT_IP === 'full') return ip;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return ip.replace(/\.\d{1,3}$/, '.0/24');
  const g = ip.split(':').filter(Boolean).slice(0, 3).join(':');
  return g ? g + '::/48' : null;
}

// Claves de rate limit: 'ip:<ip> <ruta>', 'cred:<credential id> <ruta>', 'user:<uid> <ruta>'.
// Una ruta puede chequear varias (primero la IP, después la más específica). link/options suma
// 'code:<sha256 del código> <ruta>' antes de buscar el código (hasheado para no dejarlo en claro
// en memoria); los fallos de verify se cuentan en link_codes.failed_attempts.
const rateLimits = new Map();
const ipRateKey = (req, routeKey) => {
  const ip = rawClientIp(req);
  return ip ? `ip:${ip} ${routeKey}` : null;
};
// Devuelve false (y ya respondió 429) si la clave se pasó del cupo. Clave null: no limita.
function rateLimit(res, key, max) {
  if (!key) return true;
  const now = Date.now();
  let entry = rateLimits.get(key);
  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    for (const [k, value] of rateLimits) {
      if (now - value.windowStart >= RATE_LIMIT_WINDOW_MS) rateLimits.delete(k);
    }
    entry = { count: 0, windowStart: now };
    rateLimits.set(key, entry);
  }
  entry.count += 1;
  if (entry.count > max) {
    json(res, 429, { error: 'Demasiados intentos, intentá de nuevo más tarde.' });
    return false;
  }
  return true;
}

function auditLines() {
  let text;
  try { text = fs.readFileSync(auditFile, 'utf8'); } catch { return []; }
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line) continue;
    try { const r = JSON.parse(line); if (r && r.id && r.ev) rows.push(r); } catch { /* torn line */ }
  }
  return rows;
}

function auditKeep(rows) {
  let out = rows;
  if (AUDIT_DAYS) { const cut = Date.now() - AUDIT_DAYS * 86400000; out = out.filter(r => r.ts >= cut); }
  if (AUDIT_MAX && out.length > AUDIT_MAX) out = out.slice(out.length - AUDIT_MAX);
  return out;
}

function compactAudit() {
  const rows = auditLines();
  for (const r of rows) if (+r.id > auditSeq) auditSeq = +r.id;
  const keep = auditKeep(rows);
  auditCount = keep.length;
  if (keep.length === rows.length) return;
  try { fs.writeFileSync(auditFile, keep.map(r => JSON.stringify(r)).join('\n') + (keep.length ? '\n' : '')); }
  catch (e) { console.error('audit compact failed', e.message); }
}

function audit(req, ev, f = {}) {
  if (!AUDIT_ON) return;
  const rec = { id: ++auditSeq, ts: Date.now(), ev, ok: f.ok !== false };
  if (f.user) { rec.uid = f.user.id; rec.name = String(f.user.name || '').slice(0, 40); }
  else {
    if (f.uid) rec.uid = f.uid;
    if (f.name) rec.name = String(f.name).slice(0, 40);
  }
  if (f.target) { rec.tgt = f.target.id; rec.tname = String(f.target.name || '').slice(0, 40); }
  if (f.msg) rec.msg = String(f.msg).slice(0, 120);
  if (f.summary) rec.summary = String(f.summary).slice(0, 240);
  const ip = clientIp(req);
  if (ip) rec.ip = ip;
  try { fs.appendFileSync(auditFile, JSON.stringify(rec) + '\n'); }
  catch (e) { return console.error('audit write failed', e.message); }
  if (AUDIT_MAX && ++auditCount > AUDIT_MAX * 1.25) compactAudit();
}

const nutritionGoalFields = ['mode', 'objetivo', 'calories', 'caloriesBurn', 'protein', 'carbs', 'fat', 'limitarSugeridas'];
const nutritionGoalsEqual = (a, b) => nutritionGoalFields.every(field => (a?.[field] ?? null) === (b?.[field] ?? null));
function nutritionGoalsSummary(goals) {
  if (goals.mode !== 'manual') return 'Metas: automático';
  const values = ['calories', 'caloriesBurn', 'protein', 'carbs', 'fat'];
  const labels = { calories: 'kcal', caloriesBurn: 'quema', protein: 'P', carbs: 'C', fat: 'G' };
  const parts = values.filter(field => goals[field] != null).map(field => labels[field] + ' ' + goals[field]);
  return 'Metas: manual' + (parts.length ? ' · ' + parts.join(' · ') : '');
}
const suggestionsSummary = (name, verb) => `Sugerencia '${name}' ${verb}`;
const injuriesSummary = lesiones => `Lesiones: ${lesiones.length ? lesiones.join(', ') : 'ninguna'}`;
function suggestionContentEqual(a, b) {
  const fields = ['nombre', 'categoria', 'position'];
  if (!fields.every(field => a[field] === b[field])) return false;
  const ingredients = item => ['nombre_alimento', 'cantidad_gramos', 'calorias', 'proteina', 'carbohidratos', 'grasas']
    .reduce((out, field) => ({ ...out, [field]: item[field] }), {});
  return JSON.stringify((a.ingredientes || []).map(ingredients)) === JSON.stringify((b.ingredientes || []).map(ingredients));
}

function normalizarTexto(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

const USDA_API_KEY = process.env.USDA_API_KEY || '';
let usdaKeyWarningLogged = false;

function nutrientValue(food, name, unitName) {
  const nutrient = food?.foodNutrients?.find(item => item?.nutrientName === name && (!unitName || item.unitName === unitName));
  if (nutrient?.value === null || nutrient?.value === undefined) return null;
  return Number.isFinite(Number(nutrient.value)) ? Number(nutrient.value) : null;
}

async function buscarAlimentosUSDA(query, db) {
  const tokens = normalizarTexto(query).split(/\s+/).filter(Boolean);
  const termino = ALIMENTOS_USDA_DICT.find(item => {
    const texto = normalizarTexto(item.es);
    return tokens.every(token => texto.includes(token));
  });
  if (!termino) return [];

  const cacheKey = `v2:usda:${query}`;
  const cached = db.prepare('SELECT resultado_json, fecha_cache FROM cache_alimentos WHERE query = ?').get(cacheKey);
  if (cached && Date.now() - new Date(cached.fecha_cache).getTime() < 24 * 60 * 60 * 1000) {
    try { return JSON.parse(cached.resultado_json); } catch { /* caché inválida: actualizar */ }
  }

  if (!USDA_API_KEY) {
    if (!usdaKeyWarningLogged) {
      console.warn('USDA_API_KEY is not configured; USDA food search is disabled');
      usdaKeyWarningLogged = true;
    }
    return [];
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const searchUrl = new URL('https://api.nal.usda.gov/fdc/v1/foods/search');
    searchUrl.searchParams.set('api_key', USDA_API_KEY);
    searchUrl.searchParams.set('query', termino.en);
    searchUrl.searchParams.set('dataType', 'Foundation,SR Legacy');
    searchUrl.searchParams.set('pageSize', '5');
    const response = await fetch(searchUrl, { signal: controller.signal });
    if (!response.ok) throw new Error(`USDA FoodData Central HTTP ${response.status}`);
    const data = await response.json();
    const food = Array.isArray(data.foods) ? data.foods[0] : null;
    const alimentos = food ? [{
      nombre: termino.label,
      marca: '',
      gramosPorUnidad: termino.gramosPorUnidad,
      unidadLabel: termino.unidadLabel,
      caloriasPor100g: nutrientValue(food, 'Energy', 'KCAL'),
      proteinaPor100g: nutrientValue(food, 'Protein'),
      carbosPor100g: nutrientValue(food, 'Carbohydrate, by difference'),
      grasasPor100g: nutrientValue(food, 'Total lipid (fat)')
    }] : [];
    db.prepare(`INSERT INTO cache_alimentos (query, resultado_json, fecha_cache)
      VALUES (?, ?, ?) ON CONFLICT(query) DO UPDATE SET resultado_json = excluded.resultado_json, fecha_cache = excluded.fecha_cache`)
      .run(cacheKey, JSON.stringify(alimentos), new Date().toISOString());
    return alimentos;
  } catch (error) {
    console.error('USDA food search error:', error);
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function buscarAlimentosBase(query) {
  const tokens = normalizarTexto(query).split(/\s+/).filter(Boolean);
  return ALIMENTOS_BASE.filter(alimento => {
    const texto = normalizarTexto([alimento.nombre, ...(alimento.aliases || [])].join(' '));
    return tokens.every(token => texto.includes(token));
  }).map(alimento => ({
    nombre: alimento.nombre,
    marca: '',
    caloriasPor100g: alimento.caloriasPor100g,
    proteinaPor100g: alimento.proteinaPor100g,
    carbosPor100g: alimento.carbosPor100g,
    grasasPor100g: alimento.grasasPor100g,
    gramosPorUnidad: alimento.gramosPorUnidad,
    unidadLabel: alimento.unidadLabel,
  }));
}

function parseServingSize(texto) {
  try {
    const text = String(texto || '').trim();
    if (!text) return null;
    const number = '[0-9]+(?:[.,][0-9]+)?';
    const grouped = new RegExp(`^\\s*(${number})\\s+([^()]+?)\\s*\\(\\s*(${number})\\s*g(?:ramos?)?\\s*\\)\\s*$`, 'i').exec(text);
    if (grouped) {
      const count = Number(grouped[1].replace(',', '.'));
      const grams = Number(grouped[3].replace(',', '.'));
      if (!(count > 0) || !(grams > 0)) return null;
      const rawLabel = grouped[2].trim();
      const labels = {
        slice: 'rodaja', slices: 'rodaja', rebanada: 'rodaja', rebanadas: 'rodaja',
        portion: 'porción', portions: 'porción', porción: 'porción', porciones: 'porción'
      };
      return { gramosPorUnidad: grams / count, unidadLabel: labels[rawLabel.toLowerCase()] || rawLabel };
    }
    const simple = new RegExp(`^\\s*(${number})\\s*g(?:ramos?)?\\s*$`, 'i').exec(text);
    if (simple) {
      const grams = Number(simple[1].replace(',', '.'));
      return grams > 0 ? { gramosPorUnidad: grams, unidadLabel: 'porción' } : null;
    }
  } catch { /* serving_size inesperado: dejar el alimento en gramos */ }
  return null;
}

function mapearProductoOpenFoodFacts(product) {
  const n = product.nutriments || {};
  const numberOrNull = value => Number.isFinite(Number(value)) ? Number(value) : null;
  const serving = parseServingSize(product.serving_size);
  return {
    nombre: product.product_name || product.product_name_es || product.generic_name || '',
    marca: Array.isArray(product.brands) ? product.brands.join(', ') : product.brands || '',
    caloriasPor100g: numberOrNull(n['energy-kcal_100g'] ?? n['energy-kcal'] ?? n['energy-kcal_value']),
    proteinaPor100g: numberOrNull(n.proteins_100g),
    carbosPor100g: numberOrNull(n.carbohydrates_100g),
    grasasPor100g: numberOrNull(n.fat_100g),
    ...(serving || {})
  };
}

function combinarAlimentos(...listas) {
  const vistos = new Set();
  return listas.flat().filter(alimento => {
    if (!alimento.nombre) return false;
    const clave = `${normalizarTexto(alimento.nombre)}|${normalizarTexto(alimento.marca)}`;
    if (vistos.has(clave)) return false;
    vistos.add(clave);
    return true;
  }).slice(0, 15);
}

function inferirFranjasPlantilla(nombre, categoria) {
  if (categoria !== 'fitness') return [];
  const texto = String(nombre || '').toLowerCase();
  const franjas = new Set();
  if (/omelette|tostad|avena|yogur|huevo.*revuelt|panqueque|batido/.test(texto)) franjas.add('desayuno');
  if (/yogur|batido|galleta|panqueque|manzana|tostad|banana|mantequilla de maní/.test(texto)) franjas.add('merienda');
  if (/pollo|arroz|salmón|salmon|ensalada|bowl|wrap|bife|fideo|tofu|merluza|solomillo|lenteja|huevo.*arroz/.test(texto)) {
    franjas.add('almuerzo');
    franjas.add('cena');
  }
  if (/galleta|batido|manzana|yogur|atún con galletas|atun con galletas/.test(texto)) franjas.add('extra');
  return franjas.size ? [...franjas] : ['extra'];
}

function obtenerPlantillas(db, userId, categoria = '', soloUsuario = false, franja = '') {
  const soloCategoria = String(categoria || '').trim();
  const soloFranja = String(franja || '').trim();
  let where;
  let params;
  if (soloUsuario) {
    where = soloCategoria ? 'WHERE p.user_id = ? AND p.categoria = ?' : 'WHERE p.user_id = ?';
    params = soloCategoria ? [userId, soloCategoria] : [userId];
  } else {
    where = soloCategoria
      ? 'WHERE p.user_id IS NULL AND p.categoria = ?'
      : 'WHERE p.user_id IS NULL OR p.user_id = ?';
    params = soloCategoria ? [soloCategoria] : [userId];
  }
  const rows = db.prepare(`
    SELECT p.id AS plantilla_id, p.user_id, p.nombre AS plantilla_nombre, p.categoria, p.created_at, p.updated_at, p.franjas_recomendadas,
      i.id AS ingrediente_id, i.nombre_alimento, i.cantidad_gramos, i.calorias,
      i.proteina, i.carbohidratos, i.grasas
    FROM plantillas_comida p
    LEFT JOIN plantillas_ingredientes i ON i.plantilla_id = p.id
    ${where}
    ORDER BY CASE WHEN p.user_id = ? THEN 0 ELSE 1 END, p.id
  `).all(...params, userId);
  const plantillas = new Map();
  for (const row of rows) {
    let plantilla = plantillas.get(row.plantilla_id);
    if (!plantilla) {
      plantilla = {
        id: row.plantilla_id,
        user_id: row.user_id,
        nombre: row.plantilla_nombre,
        created_at: row.created_at,
        updated_at: row.updated_at || row.created_at,
        franjas_recomendadas: (() => {
          try {
            const franjas = JSON.parse(row.franjas_recomendadas || '[]');
            return franjas.length ? franjas : inferirFranjasPlantilla(row.plantilla_nombre, row.categoria);
          } catch { return inferirFranjasPlantilla(row.plantilla_nombre, row.categoria); }
        })(),
        ingredientes: []
      };
      plantillas.set(row.plantilla_id, plantilla);
    }
    if (row.ingrediente_id !== null) {
      plantilla.ingredientes.push({
        id: row.ingrediente_id,
        nombre_alimento: row.nombre_alimento,
        cantidad_gramos: row.cantidad_gramos,
        calorias: row.calorias,
        proteina: row.proteina,
        carbohidratos: row.carbohidratos,
        grasas: row.grasas
      });
    }
  }
  const resultado = [...plantillas.values()];
  return soloFranja
    ? resultado.filter(plantilla => plantilla.franjas_recomendadas.includes(soloFranja))
    : resultado;
}

function validarIngredientes(ingredientes) {
  return Array.isArray(ingredientes) && ingredientes.length > 0 && ingredientes.every(item => {
    const nombre = String(item?.nombre_alimento || '').trim();
    return nombre && Number.isFinite(Number(item?.cantidad_gramos)) && Number(item.cantidad_gramos) > 0 &&
      [item?.calorias, item?.proteina, item?.carbohidratos, item?.grasas]
        .every(value => Number.isFinite(Number(value)) && Number(value) >= 0);
  });
}

// Mismos 4 objetivos que ofrece el paso 1 de SurveyWizard.jsx (OPT.objetivo) — sin catálogo
// paralelo, la lista vive una sola vez en el frontend.
const OBJETIVOS_VALIDOS = new Set(['hipertrofia', 'fuerza', 'perder_grasa', 'fitness_general']);

const NUTRITION_GOAL_LIMITS = {
  macros: { min: 0, max: 2000, integer: false },
  calories: { min: 0, max: 20000, integer: true },
  caloriesBurn: { min: 0, max: 20000, integer: true },
};

// Campo vacío ('', null, undefined) => null. Cero y valores dentro del rango son válidos.
function parsePositiveOrNull(value, limits, label) {
  if (value === null || value === undefined || value === '') return { ok: true, value: null };
  const n = Number(value);
  if (!Number.isFinite(n) || n < limits.min || n > limits.max || (limits.integer && !Number.isInteger(n))) {
    return {
      ok: false,
      error: !Number.isFinite(n) || n < limits.min ? `${label}: debe ser mayor o igual que 0` :
        limits.integer && !Number.isInteger(n) ? `${label}: debe ser un número entero` :
          `${label}: máximo ${limits.max}${label.includes('Calor') ? '' : ' g'}`,
    };
  }
  return { ok: true, value: n };
}

// Body shape: { mode: 'automatic' } clears the manual override, or
// { mode: 'manual', objetivo, calories, caloriesBurn, protein, carbs, fat } sets it —
// cada numérico es independiente y puede quedar vacío (null). Returns { ok, goals/error }.
function parseNutritionGoalsBody(body) {
  if (body?.mode === 'automatic') {
    return { ok: true, goals: { mode: 'automatic', objetivo: null, calories: null, caloriesBurn: null, protein: null, carbs: null, fat: null } };
  }
  if (body?.mode !== 'manual') return { ok: false, error: 'Metas inválidas: el modo debe ser automático o manual' };
  const objetivoRaw = body.objetivo;
  const objetivo = (objetivoRaw === null || objetivoRaw === undefined || objetivoRaw === '') ? null : objetivoRaw;
  if (objetivo !== null && !OBJETIVOS_VALIDOS.has(objetivo)) return { ok: false, error: 'Objetivo inválido' };
  const calories = parsePositiveOrNull(body.calories, NUTRITION_GOAL_LIMITS.calories, 'Calorías');
  const caloriesBurn = parsePositiveOrNull(body.caloriesBurn, NUTRITION_GOAL_LIMITS.caloriesBurn, 'Calorías a quemar');
  const protein = parsePositiveOrNull(body.protein, NUTRITION_GOAL_LIMITS.macros, 'Proteínas');
  const carbs = parsePositiveOrNull(body.carbs, NUTRITION_GOAL_LIMITS.macros, 'Carbohidratos');
  const fat = parsePositiveOrNull(body.fat, NUTRITION_GOAL_LIMITS.macros, 'Grasas');
  const invalid = [calories, caloriesBurn, protein, carbs, fat].find(result => !result.ok);
  if (invalid) return { ok: false, error: invalid.error };
  return { ok: true, goals: {
    mode: 'manual', objetivo,
    calories: calories.value, caloriesBurn: caloriesBurn.value,
    protein: protein.value, carbs: carbs.value, fat: fat.value
  } };
}

function suggestionResponse(row) {
  let franjas = [];
  try { franjas = JSON.parse(row.franjas_recomendadas || '[]'); } catch { franjas = []; }
  if (!franjas.length) franjas = inferirFranjasPlantilla(row.nombre, row.categoria);
  return {
    id: row.id, nombre: row.nombre, categoria: row.categoria, enabled: !!row.enabled, position: row.position,
    assignedBy: row.assigned_by, createdAt: row.created_at, updatedAt: row.updated_at,
    sourcePlantillaId: row.source_plantilla_id ?? null,
    franjas,
    ingredientes: (row.ingredientes || []).map(i => ({
      id: i.id, nombre_alimento: i.nombre_alimento, cantidad_gramos: i.cantidad_gramos,
      calorias: i.calorias, proteina: i.proteina, carbohidratos: i.carbohidratos, grasas: i.grasas
    }))
  };
}

// Parsea y valida un array de rutinas con la misma forma usada tanto para el bloque
// suelto {routines,week,dayPlan} como para las rutinas congeladas dentro de cada grupo.
function parseRoutineList(list) {
  if (!Array.isArray(list)) return null;
  const routines = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') return null;
    const id = String(r.id || '').trim();
    const name = String(r.name || '').trim();
    if (!id || !name) return null;
    if (!Array.isArray(r.ex)) return null;
    const ex = [];
    for (const item of r.ex) {
      if (!item || typeof item !== 'object' || !String(item.id || '').trim()) return null;
      ex.push(item);
    }
    routines.push({ id, name, emoji: r.emoji || 'dumbbell', created: r.created_at || r.created || Date.now(), ex });
  }
  return routines;
}

// Body validado para PUT /api/admin/users/:userId/routines (Fase 6 + 7). Misma forma que
// {routines, week, dayPlan, routineGroups, activeGroupId} que ya maneja saveUserState()
// del lado del socio (frontend/src/lib/routineGroups.js) — sin campos nuevos.
function parseRoutinesBody(body) {
  const routines = parseRoutineList(body?.routines);
  if (!routines) return null;
  const week = (body.week && typeof body.week === 'object' && !Array.isArray(body.week)) ? body.week : {};
  const dayPlan = (body.dayPlan && typeof body.dayPlan === 'object' && !Array.isArray(body.dayPlan)) ? body.dayPlan : {};

  let routineGroups = [];
  if (body.routineGroups !== undefined) {
    if (!Array.isArray(body.routineGroups)) return null;
    for (const g of body.routineGroups) {
      if (!g || typeof g !== 'object') return null;
      const id = String(g.id || '').trim();
      const name = String(g.name || '').trim();
      if (!id || !name) return null;
      const groupRoutines = parseRoutineList(g.routines || []);
      if (!groupRoutines) return null;
      const groupWeek = (g.week && typeof g.week === 'object' && !Array.isArray(g.week)) ? g.week : {};
      const group = { id, name, routines: groupRoutines, week: groupWeek, createdAt: g.createdAt || Date.now() };
      // De qué programa de presets salió el grupo (cuenta el uso en Rutinas del admin).
      const src = g.source;
      if (src && typeof src === 'object' && src.kind === 'preset' && typeof src.programId === 'string' && src.programId) {
        group.source = { kind: 'preset', programId: src.programId.slice(0, 40), at: Number.isFinite(+src.at) ? +src.at : Date.now() };
      }
      routineGroups.push(group);
    }
  }
  const activeGroupId = body.activeGroupId !== undefined ? (body.activeGroupId ? String(body.activeGroupId) : null) : null;
  if (activeGroupId && !routineGroups.some(g => g.id === activeGroupId)) return null;

  return { routines, week, dayPlan, routineGroups, activeGroupId };
}

// Auditoría granular de Fase 6/8: el guardado admin reemplaza el blob completo de rutinas
// (mismo patrón que usa el propio socio), así que la auditoría por acción sale de comparar
// antes/después en vez de tener un endpoint por operación.
function logRoutineStateChanges({ actorUserId, targetUserId, before, after }) {
  const meta = routine => ({ name: routine.name, emoji: routine.emoji });
  const change = detectRoutineAuditChanges(before, after);
  for (const entry of change.routineLogs) {
    const action = entry.action === 'create' ? 'routine.create' : entry.action === 'delete' ? 'routine.delete' : 'routine.update';
    logAdminAction({ actorUserId, targetUserId, action, entityId: entry.entityId, before: entry.before && meta(entry.before), after: entry.after && meta(entry.after) });
    if (entry.action === 'create') {
      for (const exercise of entry.after.ex || []) logAdminAction({ actorUserId, targetUserId, action: 'routine.exercise.add', entityId: entry.entityId, after: exercise });
    }
    if (entry.action === 'update') {
      const beforeExercises = entry.before.ex || [];
      const afterExercises = entry.after.ex || [];
      const maxExercises = Math.max(beforeExercises.length, afterExercises.length);
      for (let index = 0; index < maxExercises; index++) {
        const beforeExercise = beforeExercises[index], afterExercise = afterExercises[index];
        if (beforeExercise && !afterExercise) logAdminAction({ actorUserId, targetUserId, action: 'routine.exercise.remove', entityId: entry.entityId, before: beforeExercise });
        else if (!beforeExercise && afterExercise) logAdminAction({ actorUserId, targetUserId, action: 'routine.exercise.add', entityId: entry.entityId, after: afterExercise });
        else if (JSON.stringify(beforeExercise) !== JSON.stringify(afterExercise)) logAdminAction({ actorUserId, targetUserId, action: 'routine.exercise.update', entityId: entry.entityId, before: beforeExercise, after: afterExercise });
      }
    }
  }
  if (change.planChanged) logAdminAction({
    actorUserId, targetUserId, action: 'routine.plan.update',
    before: { routineGroups: before.routineGroups }, after: { routineGroups: after.routineGroups }
  });
  return { changed: change.changed, summaries: change.summaries };
}

if (AUDIT_ON) {
  compactAudit();
  setInterval(compactAudit, 3600000).unref();
}

/* ---------- routes ---------- */
const routes = {
  'GET /api/health': async (req, res) => json(res, 200, { ok: true, users: countAppUsers() }),

  'GET /api/alimentos/buscar': async (req, res) => {
    const query = normalizarTexto(new URL(req.url, 'http://x').searchParams.get('q')).slice(0, 100);
    if (!query) return json(res, 200, []);

    const db = getDatabase();
    const user = readSession(req);
    const plantillas = obtenerPlantillas(db, user?.id || null)
      .filter(plantilla => normalizarTexto(plantilla.nombre).includes(query))
      .map(plantilla => ({
        nombre: plantilla.nombre,
        marca: '',
        caloriasPor100g: null,
        proteinaPor100g: null,
        carbosPor100g: null,
        grasasPor100g: null,
        tipo: 'plantilla_comida',
        plantilla_id: plantilla.id,
        ingredientes: plantilla.ingredientes
      }));
    const baseResults = buscarAlimentosBase(query);
    const usdaResults = await buscarAlimentosUSDA(query, db);
    const cacheFor = scope => `v2:${scope}:${query}`;
    const freshCached = key => {
      const cached = db.prepare('SELECT resultado_json, fecha_cache FROM cache_alimentos WHERE query = ?').get(key);
      if (!cached || Date.now() - new Date(cached.fecha_cache).getTime() >= 24 * 60 * 60 * 1000) return null;
      try { return JSON.parse(cached.resultado_json); } catch { return null }
    };
    const cachedArgentina = freshCached(cacheFor('ar'));
    if (Array.isArray(cachedArgentina) && cachedArgentina.length) return json(res, 200, combinarAlimentos(plantillas, baseResults, usdaResults, cachedArgentina));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const searchUrl = new URL('https://search.openfoodfacts.org/search');
      searchUrl.searchParams.set('q', `countries_tags:"en:argentina" ${query}`);
      searchUrl.searchParams.set('langs', 'es');
      searchUrl.searchParams.set('page_size', '15');
      searchUrl.searchParams.set('fields', 'product_name,brands,serving_size,nutriments');
      const response = await fetch(searchUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'LauyimGym/1.0 (food search)' }
      });
      if (!response.ok) throw new Error(`Open Food Facts HTTP ${response.status}`);
      const data = await response.json();
      const hits = Array.isArray(data.hits) ? data.hits : [];
      const alimentos = hits.map(mapearProductoOpenFoodFacts).filter(item => item.nombre);
      db.prepare(`INSERT INTO cache_alimentos (query, resultado_json, fecha_cache)
        VALUES (?, ?, ?) ON CONFLICT(query) DO UPDATE SET resultado_json = excluded.resultado_json, fecha_cache = excluded.fecha_cache`)
        .run(cacheFor('ar'), JSON.stringify(alimentos), new Date().toISOString());
      if (data.count !== 0 && hits.length) return json(res, 200, combinarAlimentos(plantillas, baseResults, usdaResults, alimentos));

      const cachedFallback = freshCached(cacheFor('world-ar'));
      if (Array.isArray(cachedFallback)) return json(res, 200, combinarAlimentos(plantillas, baseResults, usdaResults, cachedFallback));
      const fallbackUrl = new URL('https://search.openfoodfacts.org/search');
      fallbackUrl.searchParams.set('q', query);
      fallbackUrl.searchParams.set('langs', 'es');
      fallbackUrl.searchParams.set('page_size', '15');
      fallbackUrl.searchParams.set('fields', 'product_name,brands,serving_size,nutriments');
      const fallbackResponse = await fetch(fallbackUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'LauyimGym/1.0 (food search)' }
      });
      if (!fallbackResponse.ok) throw new Error(`Open Food Facts HTTP ${fallbackResponse.status}`);
      const fallbackData = await fallbackResponse.json();
      const fallbackHits = Array.isArray(fallbackData.hits) ? fallbackData.hits : [];
      const fallbackAlimentos = fallbackHits.map(mapearProductoOpenFoodFacts).filter(item => item.nombre);
      db.prepare(`INSERT INTO cache_alimentos (query, resultado_json, fecha_cache)
        VALUES (?, ?, ?) ON CONFLICT(query) DO UPDATE SET resultado_json = excluded.resultado_json, fecha_cache = excluded.fecha_cache`)
        .run(cacheFor('world-ar'), JSON.stringify(fallbackAlimentos), new Date().toISOString());
      return json(res, 200, combinarAlimentos(plantillas, baseResults, usdaResults, fallbackAlimentos));
    } catch (error) {
      console.error('GET /api/alimentos/buscar error:', error);
      if (baseResults.length || usdaResults.length || plantillas.length) return json(res, 200, combinarAlimentos(plantillas, baseResults, usdaResults));
      return json(res, 502, { alimentos: [], error: 'No se pudo consultar Open Food Facts' });
    } finally {
      clearTimeout(timeout);
    }
  },

  'POST /api/plantillas': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    const body = await readBody(req);
    const nombre = String(body.nombre || '').trim();
    if (!nombre || !validarIngredientes(body.ingredientes)) return json(res, 400, { error: 'Nombre e ingredientes requeridos' });

    const db = getDatabase();
    db.exec('BEGIN');
    try {
      const now = Date.now();
      const plantilla = db.prepare('INSERT INTO plantillas_comida (user_id, nombre, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(user.id, nombre, now, now);
      const plantillaId = Number(plantilla.lastInsertRowid);
      const stmt = db.prepare(`INSERT INTO plantillas_ingredientes
        (plantilla_id, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas)
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const item of body.ingredientes) {
        stmt.run(plantillaId, String(item.nombre_alimento).trim(), item.cantidad_gramos, item.calorias,
          item.proteina, item.carbohidratos, item.grasas);
      }
      db.exec('COMMIT');
      return json(res, 201, { id: plantillaId });
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  },

  'POST /api/comidas-compuestas': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    const body = await readBody(req);
    const nombre = String(body.nombre || '').trim();
    if (!nombre || !validarIngredientes(body.ingredientes)) return json(res, 400, { error: 'Nombre e ingredientes requeridos' });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.fecha || '')) || !['desayuno', 'almuerzo', 'merienda', 'cena', 'extra'].includes(body.franja)) {
      return json(res, 400, { error: 'fecha or franja invalid' });
    }

    const db = getDatabase();
    const grupoId = 'g' + crypto.randomBytes(16).toString('hex');
    db.exec('BEGIN');
    try {
      const now = Date.now();
      const plantilla = db.prepare('INSERT INTO plantillas_comida (user_id, nombre, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(user.id, nombre, now, now);
      const plantillaId = Number(plantilla.lastInsertRowid);
      const plantillaStmt = db.prepare(`INSERT INTO plantillas_ingredientes
        (plantilla_id, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas)
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
      const comidaStmt = db.prepare(`INSERT INTO comidas_registradas
        (user_id, grupo_id, grupo_nombre, fecha, franja, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const item of body.ingredientes) {
        const nombreIngrediente = String(item.nombre_alimento).trim();
        plantillaStmt.run(plantillaId, nombreIngrediente, item.cantidad_gramos, item.calorias,
          item.proteina, item.carbohidratos, item.grasas);
        comidaStmt.run(user.id, grupoId, nombre, body.fecha, body.franja, nombreIngrediente,
          item.cantidad_gramos, item.calorias, item.proteina, item.carbohidratos, item.grasas);
      }
      db.exec('COMMIT');
      return json(res, 201, { id: plantillaId, grupo_id: grupoId });
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  },

  'GET /api/plantillas': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    const categoria = new URL(req.url, 'http://x').searchParams.get('categoria') || '';
    const requestUrl = new URL(req.url, 'http://x');
    const soloUsuario = requestUrl.searchParams.get('scope') === 'mine';
    const franja = requestUrl.searchParams.get('franja') || '';

    // Prioridad total del admin (Fase 3): scope=mine pide las plantillas propias del socio
    // (gestión personal, sin relación con sugerencias de admin) y sigue como siempre. El
    // feed de sugerencias (sin scope=mine) sí respeta la precedencia: si hay alguna
    // sugerencia scope='admin' habilitada asignada a este socio, es la única fuente —
    // nunca se mezcla con plantillas globales ni con lo automático, aunque el filtro de
    // franja/categoria la deje vacía.
    if (!soloUsuario) {
      const asignadas = getAdminSuggestionsByUserId(user.id).filter(row => row.enabled);
      if (asignadas.length) {
        const soloCategoria = String(categoria || '').trim();
        const soloFranja = String(franja || '').trim();
        const mapeadas = asignadas
          .filter(row => !soloCategoria || row.categoria === soloCategoria)
          .map(row => ({
            id: row.id,
            user_id: row.user_id,
            nombre: row.nombre,
            created_at: row.created_at,
            updated_at: row.updated_at || row.created_at,
            franjas_recomendadas: (() => {
              try {
                const franjas = JSON.parse(row.franjas_recomendadas || '[]');
                return franjas.length ? franjas : inferirFranjasPlantilla(row.nombre, row.categoria);
              } catch { return inferirFranjasPlantilla(row.nombre, row.categoria); }
            })(),
            ingredientes: row.ingredientes.map(i => ({
              id: i.id, nombre_alimento: i.nombre_alimento, cantidad_gramos: i.cantidad_gramos,
              calorias: i.calorias, proteina: i.proteina, carbohidratos: i.carbohidratos, grasas: i.grasas
            }))
          }));
        const resultado = soloFranja ? mapeadas.filter(p => p.franjas_recomendadas.includes(soloFranja)) : mapeadas;
        return json(res, 200, resultado);
      }
      // Toggle "Limitar comidas sugeridas" (por socio, con default de NUTRICION_AUTOMATICO):
      // activo y sin sugerencias asignadas = nada de plantillas globales ni inferencia, el
      // socio depende exclusivamente de lo que cargue el admin.
      if (limitarSugeridasEfectivo(user.id)) return json(res, 200, []);
    }

    return json(res, 200, obtenerPlantillas(getDatabase(), user.id, categoria, soloUsuario, franja));
  },

  'PUT /api/plantillas/:id': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    const id = new URL(req.url, 'http://x').pathname.split('/').pop();
    const db = getDatabase();
    const plantilla = db.prepare('SELECT id, user_id, updated_at FROM plantillas_comida WHERE id = ?').get(id);
    if (!plantilla) return json(res, 404, { error: 'template not found' });
    if (plantilla.user_id !== user.id) return json(res, 403, { error: 'No autorizado' });
    const body = await readBody(req);
    const nombre = String(body.nombre || '').trim();
    if (!nombre || !validarIngredientes(body.ingredientes)) return json(res, 400, { error: 'Nombre e ingredientes requeridos' });

    db.exec('BEGIN');
    try {
      db.prepare('UPDATE plantillas_comida SET nombre = ?, updated_at = ? WHERE id = ?').run(nombre, Date.now(), id);
      db.prepare('DELETE FROM plantillas_ingredientes WHERE plantilla_id = ?').run(id);
      const stmt = db.prepare(`INSERT INTO plantillas_ingredientes
        (plantilla_id, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas)
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const item of body.ingredientes) {
        stmt.run(id, String(item.nombre_alimento).trim(), item.cantidad_gramos, item.calorias,
          item.proteina, item.carbohidratos, item.grasas);
      }
      db.exec('COMMIT');
      return json(res, 200, { ok: true });
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  },

  'DELETE /api/plantillas/:id': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    const id = new URL(req.url, 'http://x').pathname.split('/').pop();
    const db = getDatabase();
    const plantilla = db.prepare('SELECT id, user_id FROM plantillas_comida WHERE id = ?').get(id);
    if (!plantilla) return json(res, 404, { error: 'template not found' });
    if (plantilla.user_id !== user.id) return json(res, 403, { error: 'No autorizado' });
    db.prepare('DELETE FROM plantillas_comida WHERE id = ?').run(id);
    return json(res, 200, { ok: true });
  },

  // El socio lee sus propias metas. Existe aparte de GET /api/data porque escribirlas (solo
  // un admin puede) no bumpea user_state._ts: ningún gate de sync las trae, y GET /api/data
  // solo se pide al arrancar la app. Una PWA instalada puede pasar días sin reiniciarse, así
  // que la prioridad del admin nunca llegaba al socio hasta que cerrara y abriera la app.
  'GET /api/nutrition/goals': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    json(res, 200, { goals: getNutritionGoals(user.id) });
  },

  /* ---------- admin: nutrición de un socio (Fase 2) ---------- */
  'GET /api/admin/users/:userId/nutrition': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const userId = decodeURIComponent(new URL(req.url, 'http://x').pathname.split('/')[4]);
    if (!getUserById(userId)) return json(res, 404, { error: 'El usuario no existe' });
    const goals = getNutritionGoals(userId);
    const suggestions = getAdminSuggestionsByUserId(userId).map(suggestionResponse);
    json(res, 200, { goals, suggestions, userObjetivo: getUserObjetivo(userId), limitarSugeridas: limitarSugeridasEfectivo(userId) });
  },

  'PUT /api/admin/users/:userId/nutrition/goals': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const userId = decodeURIComponent(new URL(req.url, 'http://x').pathname.split('/')[4]);
    const target = requireActiveTargetUser(res, userId); if (!target) return;
    const body = await readBody(req);
    const parsedGoals = parseNutritionGoalsBody(body);
    if (!parsedGoals.ok) return json(res, 400, { error: parsedGoals.error });
    const goals = parsedGoals.goals;
    const before = getNutritionGoals(userId);
    // Preserva limitarSugeridas (y cualquier otro campo fuera de parseNutritionGoalsBody):
    // guardar metas no debe pisar la preferencia de sugerencias ya guardada del socio.
    const after = { ...before, ...goals, updatedAt: Date.now(), updatedBy: admin.id };
    if (nutritionGoalsEqual(before, after)) return json(res, 200, { goals: before });
    setNutritionGoals(userId, after);
    // El objetivo manual también es la configuración real del socio (Settings, generación
    // de rutina) — no solo la etiqueta del cálculo nutricional.
    if (goals.mode === 'manual' && goals.objetivo) setUserObjetivo(userId, goals.objetivo);
    logAdminAction({ actorUserId: admin.id, targetUserId: userId, action: 'nutrition.goals.update', entityId: userId, before, after });
    audit(req, 'admin.nutrition.goals.update', { user: admin, target, summary: nutritionGoalsSummary(after) });
    json(res, 200, { goals: after });
  },

  'PUT /api/admin/users/:userId/nutrition/suggestions-limit': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const userId = decodeURIComponent(new URL(req.url, 'http://x').pathname.split('/')[4]);
    const target = requireActiveTargetUser(res, userId); if (!target) return;
    const body = await readBody(req);
    if (typeof body.limitarSugeridas !== 'boolean') return json(res, 400, { error: 'Falta limitarSugeridas (boolean)' });
    const before = getNutritionGoals(userId);
    const after = { ...before, limitarSugeridas: body.limitarSugeridas, updatedAt: Date.now(), updatedBy: admin.id };
    if (nutritionGoalsEqual(before, after)) return json(res, 200, { limitarSugeridas: before.limitarSugeridas });
    setNutritionGoals(userId, after);
    logAdminAction({ actorUserId: admin.id, targetUserId: userId, action: 'nutrition.suggestions.limit.update', entityId: userId, before, after });
    audit(req, 'admin.nutrition.suggestions.limit.update', { user: admin, target, summary: `Limitar sugeridas: ${after.limitarSugeridas ? 'sí' : 'no'}` });
    json(res, 200, { limitarSugeridas: after.limitarSugeridas });
  },

  'GET /api/admin/users/:userId/nutrition/suggestions': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const userId = decodeURIComponent(new URL(req.url, 'http://x').pathname.split('/')[4]);
    if (!getUserById(userId)) return json(res, 404, { error: 'El usuario no existe' });
    json(res, 200, { suggestions: getAdminSuggestionsByUserId(userId).map(suggestionResponse) });
  },

  'POST /api/admin/users/:userId/nutrition/suggestions': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const userId = decodeURIComponent(new URL(req.url, 'http://x').pathname.split('/')[4]);
    const target = requireActiveTargetUser(res, userId); if (!target) return;
    if (!limitarSugeridasEfectivo(userId)) return json(res, 409, { error: 'Activá "Limitar comidas sugeridas" para este socio antes de asignarle sugerencias' });
    const body = await readBody(req);
    const sourceId = Number(body.plantilla_id);
    if (!Number.isInteger(sourceId)) return json(res, 400, { error: 'Falta plantilla_id' });
    if (!['desayuno', 'almuerzo', 'merienda', 'cena', 'extra'].includes(body.franja)) {
      return json(res, 400, { error: 'Franja inválida' });
    }
    const source = getPlantillaWithIngredientes(sourceId);
    if (!source) return json(res, 404, { error: 'Plantilla no encontrada' });
    let created;
    try {
      created = assignExistingPlantillaToUser(userId, sourceId, admin.id, body.franja);
    } catch (error) {
      if (error.code === 'DUPLICATE_FRANJA') return json(res, 409, { error: 'Ya asignada a esa franja' });
      throw error;
    }
    logAdminAction({ actorUserId: admin.id, targetUserId: userId, action: 'nutrition.suggestion.assign', entityId: created.id, after: suggestionResponse(created) });
    audit(req, 'admin.nutrition.suggestion.assign', { user: admin, target, summary: suggestionsSummary(created.nombre, 'asignada') });
    json(res, 201, { suggestion: suggestionResponse(created) });
  },

  'POST /api/admin/users/:userId/nutrition/suggestions/custom': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const userId = decodeURIComponent(new URL(req.url, 'http://x').pathname.split('/')[4]);
    const target = requireActiveTargetUser(res, userId); if (!target) return;
    if (!limitarSugeridasEfectivo(userId)) return json(res, 409, { error: 'Activá "Limitar comidas sugeridas" para este socio antes de asignarle sugerencias' });
    const body = await readBody(req);
    const nombre = String(body.nombre || '').trim();
    if (!nombre || !validarIngredientes(body.ingredientes)) return json(res, 400, { error: 'Nombre e ingredientes requeridos' });
    const created = createCustomSuggestionForUser(userId, { nombre, categoria: body.categoria, ingredientes: body.ingredientes }, admin.id);
    logAdminAction({ actorUserId: admin.id, targetUserId: userId, action: 'nutrition.suggestion.create', entityId: created.id, after: suggestionResponse(created) });
    audit(req, 'admin.nutrition.suggestion.create', { user: admin, target, summary: suggestionsSummary(nombre, 'creada') });
    json(res, 201, { suggestion: suggestionResponse(created) });
  },

  /* ---------- admin: catálogo global de comidas compuestas ---------- */
  'GET /api/admin/nutrition/templates': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    json(res, 200, { templates: getGlobalTemplates().map(suggestionResponse) });
  },

  'POST /api/admin/nutrition/templates': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const nombre = String(body.nombre || '').trim();
    const categoria = String(body.categoria || '').trim();
    const franjas = Array.isArray(body.franjas) ? body.franjas : [];
    if (!nombre || !categoria || !validarIngredientes(body.ingredientes)) {
      return json(res, 400, { error: 'Nombre, categoría e ingredientes requeridos' });
    }
    if (!franjas.length || !franjas.every(f => ['desayuno', 'almuerzo', 'merienda', 'cena', 'extra'].includes(f))) {
      return json(res, 400, { error: 'Elegí al menos una franja válida' });
    }
    if (findGlobalTemplateByNombreCategoria(nombre, categoria)) {
      return json(res, 409, { error: 'Ya existe una comida global con ese nombre y categoría' });
    }
    const created = createGlobalTemplate({ nombre, categoria, franjasRecomendadas: franjas, ingredientes: body.ingredientes, assignedBy: admin.id });
    audit(req, 'admin.nutrition.template.create', { user: admin, msg: `${nombre} · ${categoria}` });
    json(res, 201, { template: suggestionResponse(created) });
  },

  'PUT /api/admin/nutrition/templates/:id': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const id = Number(new URL(req.url, 'http://x').pathname.split('/').pop());
    const before = getPlantillaWithIngredientes(id);
    if (!before || before.scope !== 'global') return json(res, 404, { error: 'Plantilla no encontrada' });
    const body = await readBody(req);
    const nombre = String(body.nombre || '').trim();
    const categoria = String(body.categoria || '').trim();
    const franjas = Array.isArray(body.franjas) ? body.franjas : [];
    if (!nombre || !categoria || !validarIngredientes(body.ingredientes)) {
      return json(res, 400, { error: 'Nombre, categoría e ingredientes requeridos' });
    }
    if (!franjas.length || !franjas.every(f => ['desayuno', 'almuerzo', 'merienda', 'cena', 'extra'].includes(f))) {
      return json(res, 400, { error: 'Elegí al menos una franja válida' });
    }
    const dup = findGlobalTemplateByNombreCategoria(nombre, categoria, id);
    if (dup) return json(res, 409, { error: 'Ya existe una comida global con ese nombre y categoría' });
    const after = updateGlobalTemplate(id, { nombre, categoria, franjasRecomendadas: franjas, ingredientes: body.ingredientes });
    audit(req, 'admin.nutrition.template.update', { user: admin, msg: `${nombre} · ${categoria}` });
    json(res, 200, { template: suggestionResponse(after) });
  },

  'DELETE /api/admin/nutrition/templates/:id': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const id = Number(new URL(req.url, 'http://x').pathname.split('/').pop());
    const before = getPlantillaWithIngredientes(id);
    if (!before || before.scope !== 'global') return json(res, 404, { error: 'Plantilla no encontrada' });
    const afectados = countAssignedUsersForGlobalTemplate(id);
    if (afectados > 0) {
      return json(res, 409, { error: `Asignada a ${afectados} socio${afectados === 1 ? '' : 's'}. Desasignala primero.`, sociosAfectados: afectados });
    }
    deleteGlobalTemplate(id);
    audit(req, 'admin.nutrition.template.delete', { user: admin, msg: before.nombre });
    json(res, 200, { ok: true });
  },

  'PUT /api/admin/users/:userId/nutrition/suggestions/:id': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const parts = new URL(req.url, 'http://x').pathname.split('/');
    const userId = decodeURIComponent(parts[4]);
    const id = Number(parts[7]);
    const target = requireActiveTargetUser(res, userId); if (!target) return;
    const before = getPlantillaWithIngredientes(id);
    if (!before || before.user_id !== userId || before.scope !== 'admin') return json(res, 404, { error: 'Sugerencia no encontrada' });
    const body = await readBody(req);
    const nombre = String(body.nombre || '').trim();
    if (!nombre || !validarIngredientes(body.ingredientes)) return json(res, 400, { error: 'Nombre e ingredientes requeridos' });
    const position = Number.isInteger(body.position) ? body.position : undefined;
    const beforeResponse = suggestionResponse(before);
    const requested = { ...beforeResponse, nombre, categoria: body.categoria || null,
      position: position === undefined ? beforeResponse.position : position, ingredientes: body.ingredientes };
    if (suggestionContentEqual(beforeResponse, requested)) return json(res, 200, { suggestion: beforeResponse });
    const after = updateAdminSuggestion(id, { nombre, categoria: body.categoria, ingredientes: body.ingredientes, position });
    logAdminAction({ actorUserId: admin.id, targetUserId: userId, action: 'nutrition.suggestion.update', entityId: id, before: suggestionResponse(before), after: suggestionResponse(after) });
    audit(req, 'admin.nutrition.suggestion.update', { user: admin, target, summary: suggestionsSummary(after.nombre, 'editada') });
    json(res, 200, { suggestion: suggestionResponse(after) });
  },

  'PATCH /api/admin/users/:userId/nutrition/suggestions/:id': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const parts = new URL(req.url, 'http://x').pathname.split('/');
    const userId = decodeURIComponent(parts[4]);
    const id = Number(parts[7]);
    const target = requireActiveTargetUser(res, userId); if (!target) return;
    const before = getPlantillaWithIngredientes(id);
    if (!before || before.user_id !== userId || before.scope !== 'admin') return json(res, 404, { error: 'Sugerencia no encontrada' });
    const body = await readBody(req);
    if (typeof body.enabled !== 'boolean') return json(res, 400, { error: 'Falta enabled (boolean)' });
    if (!!before.enabled === body.enabled) return json(res, 200, { suggestion: suggestionResponse(before) });
    setSuggestionEnabled(id, body.enabled);
    const after = getPlantillaWithIngredientes(id);
    logAdminAction({ actorUserId: admin.id, targetUserId: userId, action: 'nutrition.suggestion.enable', entityId: id, before: suggestionResponse(before), after: suggestionResponse(after) });
    audit(req, 'admin.nutrition.suggestion.enable', { user: admin, target, summary: suggestionsSummary(after.nombre, body.enabled ? 'activada' : 'desactivada') });
    json(res, 200, { suggestion: suggestionResponse(after) });
  },

  'DELETE /api/admin/users/:userId/nutrition/suggestions/:id': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const parts = new URL(req.url, 'http://x').pathname.split('/');
    const userId = decodeURIComponent(parts[4]);
    const id = Number(parts[7]);
    const target = requireActiveTargetUser(res, userId); if (!target) return;
    const before = getPlantillaWithIngredientes(id);
    if (!before || before.user_id !== userId || before.scope !== 'admin') return json(res, 404, { error: 'Sugerencia no encontrada' });
    removeAdminSuggestion(id);
    logAdminAction({ actorUserId: admin.id, targetUserId: userId, action: 'nutrition.suggestion.remove', entityId: id, before: suggestionResponse(before) });
    audit(req, 'admin.nutrition.suggestion.remove', { user: admin, target, msg: before.nombre });
    json(res, 200, { ok: true });
  },

  // Fase 7 (B.2): el admin confirmó igual asignar un ejercicio que afecta una zona lesionada
  // del socio. No muta nada — solo deja rastro auditado del override.
  'POST /api/admin/users/:userId/injuries/exercise-warning-override': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const userId = decodeURIComponent(new URL(req.url, 'http://x').pathname.split('/')[4]);
    const target = requireActiveTargetUser(res, userId); if (!target) return;
    const body = await readBody(req);
    const exerciseId = String(body?.exerciseId || '').trim();
    if (!exerciseId) return json(res, 400, { error: 'Falta exerciseId' });
    const lesionesAfectadas = Array.isArray(body?.lesiones) ? body.lesiones.filter(l => typeof l === 'string') : [];
    logAdminAction({ actorUserId: admin.id, targetUserId: userId, action: 'injury.exercise_warning.override', entityId: exerciseId, after: { exerciseId, lesiones: lesionesAfectadas } });
    audit(req, 'admin.injury.exercise_warning.override', { user: admin, target, summary: `Advertencia de lesión ignorada: ${exerciseId}` });
    json(res, 200, { ok: true });
  },

  /* ---------- admin: rutinas de un socio (Fase 6) ---------- */
  'GET /api/admin/users/:userId/routines': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const userId = decodeURIComponent(new URL(req.url, 'http://x').pathname.split('/')[4]);
    if (!getUserById(userId)) return json(res, 404, { error: 'El usuario no existe' });
    const prefs = getDatabase().prepare('SELECT unit, body FROM user_state WHERE user_id = ?').get(userId) || {};
    const { routineGroups, activeGroupId } = getRoutineGroups(userId);
    json(res, 200, {
      routines: getRoutinesByUserId(userId),
      week: getWeekPlanByUserId(userId),
      dayPlan: getDayPlanByUserId(userId),
      routineGroups,
      activeGroupId,
      lesiones: getLesiones(userId),
      unit: prefs.unit || 'kg',
      body: prefs.body || 'male'
    });
  },

  'PUT /api/admin/users/:userId/injuries': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const userId = decodeURIComponent(new URL(req.url, 'http://x').pathname.split('/')[4]);
    const target = requireActiveTargetUser(res, userId); if (!target) return;
    const body = await readBody(req);
    if (!Array.isArray(body?.lesiones) || !body.lesiones.every(l => typeof l === 'string' && l.trim())) {
      return json(res, 400, { error: 'Lesiones inválidas' });
    }
    const lesiones = [...new Set(body.lesiones.map(l => l.trim()))];
    const before = getLesiones(userId);
    if (JSON.stringify(before) === JSON.stringify(lesiones)) return json(res, 200, { lesiones: before });
    saveLesiones(userId, lesiones);
    logAdminAction({ actorUserId: admin.id, targetUserId: userId, action: 'injury.update', entityId: userId, before: { lesiones: before }, after: { lesiones } });
    audit(req, 'admin.injury.update', { user: admin, target, summary: injuriesSummary(lesiones) });
    json(res, 200, { lesiones });
  },

  'PUT /api/admin/users/:userId/routines': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const userId = decodeURIComponent(new URL(req.url, 'http://x').pathname.split('/')[4]);
    const target = requireActiveTargetUser(res, userId); if (!target) return;
    const body = await readBody(req);
    const parsed = parseRoutinesBody(body);
    if (!parsed) return json(res, 400, { error: 'Rutinas inválidas' });
    const before = {
      routines: getRoutinesByUserId(userId),
      week: getWeekPlanByUserId(userId),
      dayPlan: getDayPlanByUserId(userId),
      ...getRoutineGroups(userId)
    };
    const validRoutineIds = new Set(parsed.routines.map(r => r.id));
    saveRoutines(userId, parsed.routines, routineSaveOpts(req));
    saveWeekPlan(userId, parsed.week, validRoutineIds);
    saveDayPlan(userId, parsed.dayPlan, validRoutineIds);
    if (body.routineGroups !== undefined) saveRoutineGroups(userId, parsed.routineGroups, parsed.activeGroupId);
    // Un programa asignado con ejercicios custom del admin: el socio recibe su copia.
    ensurePresetCustomCopies(userId, routineExerciseIds({ routines: parsed.routines, routineGroups: body.routineGroups === undefined ? [] : parsed.routineGroups }));
    const auditBefore = alignActiveGroupForAudit(before, before.routines, before.week);
    const auditAfter = body.routineGroups === undefined
      ? {
        ...parsed,
        routineGroups: alignActiveGroupForAudit(auditBefore, parsed.routines, parsed.week).routineGroups,
        activeGroupId: before.activeGroupId
      }
      : parsed;
    const routineChange = logRoutineStateChanges({ actorUserId: admin.id, targetUserId: userId, before: auditBefore, after: auditAfter });
    if (routineChange.changed) {
      audit(req, 'admin.routine.update', {
        user: admin,
        target,
        summary: routineChange.summaries.join(' · ') || 'Rutinas actualizadas'
      });
    }
    json(res, 200, {
      routines: getRoutinesByUserId(userId),
      week: getWeekPlanByUserId(userId),
      dayPlan: getDayPlanByUserId(userId),
      ...getRoutineGroups(userId)
    });
  },

  'GET /api/alimentos/codigo/:codigo': async (req, res) => {
    const codigo = decodeURIComponent(new URL(req.url, 'http://x').pathname.split('/').pop() || '').trim();
    if (!codigo) return json(res, 400, { error: 'Código de barras requerido' });

    const cacheKey = `codigo:${codigo}`;
    const db = getDatabase();
    const cached = db.prepare('SELECT resultado_json, fecha_cache FROM cache_alimentos WHERE query = ?').get(cacheKey);
    if (cached && Date.now() - new Date(cached.fecha_cache).getTime() < 24 * 60 * 60 * 1000) {
      try { return json(res, 200, JSON.parse(cached.resultado_json)); } catch { /* caché inválida: actualizar */ }
    }

    const controller = new AbortController();
    let timeoutTriggered = false;
    const timeout = setTimeout(() => {
      timeoutTriggered = true;
      controller.abort();
    }, 5000);
    let response;
    try {
      const productUrl = new URL(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(codigo)}.json`);
      productUrl.searchParams.set('fields', 'product_name,brands,serving_size,nutriments');
      response = await fetch(productUrl, {
        signal: controller.signal,
        headers: { 'User-Agent': 'LauyimGym/1.0 (barcode lookup)' }
      });
      if (!response.ok) throw new Error(`Open Food Facts HTTP ${response.status}`);
      const data = await response.json();
      if (data.status !== 1 || !data.product) return json(res, 404, { error: 'Producto no encontrado en Open Food Facts' });

      const alimento = mapearProductoOpenFoodFacts(data.product);
      if (!alimento.nombre) return json(res, 404, { error: 'Producto no encontrado en Open Food Facts' });

      db.prepare(`INSERT INTO cache_alimentos (query, resultado_json, fecha_cache)
        VALUES (?, ?, ?) ON CONFLICT(query) DO UPDATE SET resultado_json = excluded.resultado_json, fecha_cache = excluded.fecha_cache`)
        .run(cacheKey, JSON.stringify(alimento), new Date().toISOString());
      return json(res, 200, alimento);
    } catch (error) {
      const abortError = error?.name === 'AbortError' || controller.signal.aborted;
      console.error('GET /api/alimentos/codigo/:codigo error details:', {
        codigo,
        openFoodFactsStatus: response?.status ?? null,
        timeoutOrAbort: abortError,
        timeoutTriggered,
        networkErrorBeforeResponse: !response && !abortError,
        errorName: error?.name ?? null,
        errorMessage: error?.message ?? String(error)
      });
      console.error('GET /api/alimentos/codigo/:codigo error:', error);
      return json(res, 502, { error: 'No se pudo consultar Open Food Facts' });
    } finally {
      clearTimeout(timeout);
    }
  },

  'POST /api/comidas': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    const body = await readBody(req);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.fecha || '')) || !['desayuno', 'almuerzo', 'merienda', 'cena', 'extra'].includes(body.franja)) {
      return json(res, 400, { error: 'fecha or franja invalid' });
    }
    const values = [body.fecha, body.franja, String(body.nombre_alimento || '').trim(), body.cantidad_gramos, body.calorias, body.proteina, body.carbohidratos, body.grasas];
    if (!values[2] || values.slice(3).some(value => !Number.isFinite(Number(value)) || Number(value) < 0)) return json(res, 400, { error: 'invalid meal data' });
    const result = getDatabase().prepare(`INSERT INTO comidas_registradas
      (user_id, fecha, franja, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(user.id, ...values);
    return json(res, 201, { id: Number(result.lastInsertRowid) });
  },

  'POST /api/comidas/grupo': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    const body = await readBody(req);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(body.fecha || '')) || !['desayuno', 'almuerzo', 'merienda', 'cena', 'extra'].includes(body.franja)) {
      return json(res, 400, { error: 'fecha or franja invalid' });
    }
    const grupoNombre = String(body.grupo_nombre || '').trim();
    const ingredientes = Array.isArray(body.ingredientes) ? body.ingredientes : [];
    if (!grupoNombre || !ingredientes.length) return json(res, 400, { error: 'grupo_nombre and ingredientes required' });

    const values = ingredientes.map(item => [
      String(item?.nombre_alimento || '').trim(),
      item?.cantidad_gramos,
      item?.calorias,
      item?.proteina,
      item?.carbohidratos,
      item?.grasas
    ]);
    if (values.some(item => !item[0] || item.slice(1).some(value => !Number.isFinite(Number(value)) || Number(value) < 0))) {
      return json(res, 400, { error: 'invalid ingredient data' });
    }

    const db = getDatabase();
    const grupoId = 'g' + crypto.randomBytes(16).toString('hex');
    const stmt = db.prepare(`INSERT INTO comidas_registradas
      (user_id, grupo_id, grupo_nombre, fecha, franja, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    db.exec('BEGIN');
    try {
      for (const [nombre, cantidad, calorias, proteina, carbohidratos, grasas] of values) {
        stmt.run(user.id, grupoId, grupoNombre, body.fecha, body.franja, nombre, cantidad, calorias, proteina, carbohidratos, grasas);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return json(res, 201, { grupo_id: grupoId });
  },

  'GET /api/comidas': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    const fecha = new URL(req.url, 'http://x').searchParams.get('fecha') || '';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return json(res, 400, { error: 'fecha invalid' });
    const comidas = getDatabase().prepare('SELECT * FROM comidas_registradas WHERE user_id = ? AND fecha = ? ORDER BY id').all(user.id, fecha);
    return json(res, 200, comidas);
  },

  'GET /api/comidas/historial': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });

    const dias = Number(new URL(req.url, 'http://x').searchParams.get('dias') || 30);
    if (!Number.isInteger(dias) || dias < 1 || dias > 365) {
      return json(res, 400, { error: 'dias invalid' });
    }

    const desde = `-${dias - 1} days`;
    const historial = getDatabase().prepare(`
      SELECT
        fecha,
        SUM(calorias) AS calorias,
        SUM(proteina) AS proteina,
        SUM(carbohidratos) AS carbohidratos,
        SUM(grasas) AS grasas
      FROM comidas_registradas
      WHERE user_id = ? AND fecha >= date('now', ?)
      GROUP BY fecha
      ORDER BY fecha DESC
    `).all(user.id, desde);

    return json(res, 200, historial);
  },

  'DELETE /api/comidas/:id': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    const id = new URL(req.url, 'http://x').pathname.split('/').pop();
    const result = getDatabase().prepare('DELETE FROM comidas_registradas WHERE id = ? AND user_id = ?').run(id, user.id);
    if (!result.changes) return json(res, 404, { error: 'meal not found' });
    return json(res, 200, { ok: true });
  },

  'DELETE /api/comidas/grupo/:grupo_id': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    const grupoId = new URL(req.url, 'http://x').pathname.split('/').pop();
    const result = getDatabase().prepare('DELETE FROM comidas_registradas WHERE grupo_id = ? AND user_id = ?').run(grupoId, user.id);
    if (!result.changes) return json(res, 404, { error: 'meal group not found' });
    return json(res, 200, { ok: true });
  },

  'POST /api/share/plan': async (req, res) => {
    const body = await readBody(req);
    if (!body || !body.lauyim_plan) {
      return json(res, 400, { error: 'invalid plan data' });
    }
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    while (sharedPlans.has(code)) {
      code = '';
      for (let i = 0; i < 4; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
      }
    }
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutos exactos
    sharedPlans.set(code, { data: body, expiresAt });
    return json(res, 200, { code });
  },

  'POST /api/support': async (req, res) => {
    const body = await readBody(req);
    const asunto = String(body.asunto || '').trim().slice(0, 150);
    const mensaje = String(body.mensaje || '').trim().slice(0, 2000);
    const emailContacto = String(body.emailContacto || '').trim().slice(0, 100);
    const pwaInstalled = !!body.pwaInstalled;

    if (!asunto || !mensaje) {
      return json(res, 400, { error: 'Asunto y mensaje son requeridos' });
    }

    const brevoApiKey = process.env.BREVO_API_KEY;
    const supportDestination = process.env.SUPPORT_DESTINATION_EMAIL || 'soporte@lauyim.online';
    const instanceName = process.env.INSTANCE_NAME || body.hostname || req.headers['x-forwarded-host'] || req.headers['host'] || 'Desconocida';

    if (!brevoApiKey) {
      console.error('POST /api/support error: BREVO_API_KEY is not configured');
      return json(res, 500, { error: 'No se pudo enviar el reporte, intentá de nuevo' });
    }

    const userAgent = req.headers['user-agent'] || 'Desconocido';
    const appVersion = apiVersion;
    const user = readSession(req);
    const userInfo = user
      ? `Usuario: ${escapeHtml(user.name)} (ID: ${escapeHtml(user.id)})`
      : 'Usuario: Invitado / No autenticado';

    const safeInstanceName = escapeHtml(instanceName);
    const safeAsunto = escapeHtml(asunto);
    const safeMensaje = escapeHtml(mensaje).replace(/\n/g, '<br/>');
    const safeEmailContacto = escapeHtml(emailContacto);
    const safeUserAgent = escapeHtml(userAgent);

    const htmlContent = `
      <h2>Nuevo reporte de soporte / problema</h2>
      <p><strong>Instancia / Origen:</strong> ${safeInstanceName}</p>
      <p><strong>Asunto:</strong> ${safeAsunto}</p>
      <p><strong>Mensaje:</strong><br/>${safeMensaje}</p>
      <hr/>
      <h3>Datos de diagnóstico:</h3>
      <ul>
        <li><strong>Instancia:</strong> ${safeInstanceName}</li>
        <li><strong>Email de contacto:</strong> ${safeEmailContacto || 'No provisto'}</li>
        <li>${userInfo}</li>
        <li><strong>Versión de la app:</strong> v${appVersion}</li>
        <li><strong>PWA instalada:</strong> ${pwaInstalled ? 'Sí' : 'No'}</li>
        <li><strong>User Agent:</strong> ${safeUserAgent}</li>
      </ul>
    `;

    try {
      const brevoRes = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': brevoApiKey,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          sender: { name: 'Soporte Lauyim', email: 'soporte@lauyim.online' },
          to: [{ email: supportDestination }],
          subject: `[Soporte Lauyim] [${instanceName}] ${asunto}`,
          htmlContent
        })
      });

      if (!brevoRes.ok) {
        const errText = await brevoRes.text();
        console.error('Brevo API error:', brevoRes.status, errText);
        return json(res, 500, { error: 'No se pudo enviar el reporte, intentá de nuevo' });
      }

      return json(res, 200, { ok: true });
    } catch (e) {
      console.error('POST /api/support fetch error:', e);
      return json(res, 500, { error: 'No se pudo enviar el reporte, intentá de nuevo' });
    }
  },

  'GET /api/config': async (req, res) => {
    json(res, 200, {
      invite_only: INVITE_ONLY,
      allow_guest: ALLOW_GUEST,
      nutricion_automatico: NUTRICION_AUTOMATICO,
      instance_name: process.env.INSTANCE_NAME || req.headers['x-forwarded-host'] || req.headers['host'] || 'lauyim'
    });
  },

  'POST /api/access/qr': async (req, res) => {
    const body = await readBody(req);
    const token = String(body.token || '');
    const valid = qrTokenMatches(token);
    if (!valid && token) audit(req, 'auth.qr.validate.fail', { ok: false, msg: 'qr-invalid' });
    json(res, 200, { valid });
  },

  'GET /api/owner/qr': async (req, res) => {
    const owner = requireOwner(req, res); if (!owner) return;
    json(res, 200, { token: getOrCreateQrAccessToken() });
  },

  'POST /api/owner/qr/regenerate': async (req, res) => {
    const owner = requireOwner(req, res); if (!owner) return;
    const token = crypto.randomBytes(32).toString('base64url');
    setAdminSetting('qr_access_token', token);
    audit(req, 'owner.qr.regenerate', { user: owner });
    json(res, 200, { token });
  },

  // Interruptor de cuotas. Apagarlo no borra ni modifica datos de cuotas.
  'PUT /api/owner/billing/enabled': async (req, res) => {
    const owner = requireOwner(req, res); if (!owner) return;
    const body = await readBody(req);
    if (typeof body.enabled !== 'boolean') return json(res, 400, { error: 'enabled debe ser true o false' });
    if (body.enabled !== billingEnabledNow()) {
      setAdminSetting(BILLING_ENABLED_SETTING, body.enabled ? '1' : '0');
      audit(req, body.enabled ? 'owner.billing.enabled' : 'owner.billing.disabled', { user: owner });
    }
    json(res, 200, { enabled: billingEnabledNow() });
  },

  // Qué pasaría al encender cuotas hoy: socios (no staff, no desactivados) por estado.
  'GET /api/owner/billing/enable-preview': async (req, res) => {
    if (!requireOwner(req, res)) return;
    const settings = billingSettingsNow();
    const today = billingToday(settings);
    const counts = { bloqueado: 0, vencido: 0, por_vencer: 0 };
    for (const b of getAllMemberBilling()) {
      if (b.disabled || b.owner || isAdmin({ id: b.userId, admin: b.admin })) continue;
      const status = billingStatus(b, today, settings);
      if (status in counts) counts[status]++;
    }
    json(res, 200, { today, ...counts });
  },

  'GET /api/me': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    const me = { id: user.id, name: user.name, admin: isAdmin(user), owner: !!user.owner };
    // Con cuotas apagado el socio no ve estado de cuota: billing null y sin bloqueo.
    if (!billingEnabledNow()) return json(res, 200, { user: me, billingEnabled: false, billing: null });
    const settings = billingSettingsNow();
    const billing = getMemberBilling(user.id);
    const status = billingStatus(billing, billingToday(settings), settings);
    json(res, 200, {
      user: me,
      billingEnabled: true,
      billing: {
        hasPlan: billing.planId != null, status, dueDate: billing.dueDate, planName: billing.planName,
        blocked: status === 'bloqueado' && !isAdmin(user), trialUntil: billing.trialUntil, trialEnded: isTrialEnded(billing, status)
      }
    });
  },

  'POST /api/register/options': async (req, res) => {
    const body = await readBody(req);
    const name = String(body.name || '').trim().slice(0, 40);
    if (!name) return json(res, 400, { error: 'name required' });
    const code = String(body.code || '').trim().toUpperCase();
    const qr = String(body.qr || '');
    const qrValid = qrTokenMatches(qr);
    if (qr && !qrValid) audit(req, 'auth.qr.validate.fail', { ok: false, name, msg: 'qr-invalid' });
    if (INVITE_ONLY && !qrValid) {
      const inv = getInviteByCode(code);
      if (!inv || inv.used_by || inv.revoked) {
        audit(req, 'auth.register.denied', { ok: false, name, msg: 'invite-rejected' });
        return json(res, 403, { error: 'a valid invite code is required' });
      }
    }
    const uid = crypto.randomBytes(12).toString('base64url');
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID: RP_ID,
      userID: Buffer.from(uid), userName: name, userDisplayName: name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      excludeCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge, name, uid, code, qr: qrValid ? qr : null });
    json(res, 200, { cid, options });
  },

  'POST /api/register/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c || !c.uid) {
      audit(req, 'auth.register.fail', { ok: false, msg: 'challenge-expired' });
      return json(res, 400, { error: 'challenge expired — try again' });
    }
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false
      });
    } catch (e) {
      audit(req, 'auth.register.fail', { ok: false, name: c.name, msg: 'verify-error' });
      return json(res, 400, { error: verifyError(e, { rpId: RP_ID, origin: ORIGIN }) });
    }
    if (!verification.verified) {
      audit(req, 'auth.register.fail', { ok: false, name: c.name, msg: 'not-verified' });
      return json(res, 400, { error: 'not verified' });
    }
    const { credential } = verification.registrationInfo;
    if (getCredentialById(credential.id)) {
      audit(req, 'auth.register.fail', { ok: false, name: c.name, msg: 'credential-exists' });
      return json(res, 409, { error: 'credential already registered' });
    }
    const qrValid = !!c.qr && qrTokenMatches(c.qr);
    if (c.qr && !qrValid) audit(req, 'auth.qr.validate.fail', { ok: false, name: c.name, msg: 'qr-invalid' });
    let invite = null;
    if (INVITE_ONLY && !qrValid) {
      invite = getInviteByCode(c.code);
      if (!invite || invite.used_by || invite.revoked) {
        audit(req, 'auth.register.fail', { ok: false, name: c.name, msg: 'invite-invalid' });
        return json(res, 403, { error: 'invite code is no longer valid — ask for a new one' });
      }
    }
    const user = { id: c.uid, name: c.name, created: new Date().toISOString() };
    if (invite) { user.invitedBy = invite.code; }

    // Uso de transacción atómica para insertar usuario, credencial y actualizar invitación
    const db = getDatabase();
    db.exec('BEGIN');
    try {
      createUser(user);
      createCredential({
        id: credential.id, userId: user.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter || 0,
        transports: body.credential?.response?.transports || []
      });
      if (invite) {
        updateInviteUsedBy(invite.code, user.id);
      }
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    // saveDb(); // Eliminado: SQLite persiste automáticamente
    audit(req, 'auth.register.ok', { user, msg: invite ? invite.code : null });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user), owner: !!user.owner } }, { 'Set-Cookie': sessionCookie(user) });
  },

  /* ---------- vinculación ficha → passkey (código de un solo uso) ---------- */
  // Un socio bloqueado por cuota vincula igual: el cartel lo ve después, ya con sesión.
  'POST /api/link/options': async (req, res) => {
    const body = await readBody(req);
    const code = canonicalLinkCode(body.code);
    if (!code) {
      audit(req, 'auth.link.fail', { ok: false, msg: 'link-invalid' });
      return json(res, 400, { error: 'link_invalid' });
    }
    // Hasheado: el código no queda en claro ni en las claves del rate limit.
    const codeHash = sha256(code);
    if (!rateLimit(res, `code:${codeHash} POST /api/link/options`, RATE_LIMIT_PER_LINK_CODE_MAX)) return;
    const row = getLinkCodeByHash(codeHash);
    if (!isLinkCodeUsable(row)) {
      audit(req, 'auth.link.fail', { ok: false, msg: 'link-invalid' });
      return json(res, 400, { error: 'link_invalid' });
    }
    const user = getUserById(row.user_id);
    if (!user || user.disabled || countCredentials(user.id) > 0) {
      audit(req, 'auth.link.fail', { ok: false, user, msg: 'link-unavailable' });
      return json(res, 409, { error: 'link_unavailable' });
    }
    const fullName = getMemberProfile(user.id)?.fullName ?? null;
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID: RP_ID,
      userID: Buffer.from(user.id), userName: user.name, userDisplayName: fullName || user.name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      excludeCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge, link: { id: row.id, userId: user.id } });
    json(res, 200, { cid, options, name: user.name, fullName });
  },

  'POST /api/link/verify': async (req, res) => {
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c || !c.link) {
      audit(req, 'auth.link.fail', { ok: false, msg: 'challenge-expired' });
      return json(res, 400, { error: 'challenge expired — try again' });
    }
    const ficha = getUserById(c.link.userId);
    // Fallo atribuible al código: suma un intento y al quinto lo revoca.
    const fail = (status, error, msg) => {
      const revoked = recordLinkCodeFailure(c.link.id);
      audit(req, 'auth.link.fail', { ok: false, user: ficha, uid: c.link.userId, msg: revoked ? 'link-revoked' : msg });
      return json(res, status, { error });
    };
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false
      });
    } catch (e) {
      return fail(400, verifyError(e, { rpId: RP_ID, origin: ORIGIN }), 'verify-error');
    }
    if (!verification.verified) return fail(400, 'not verified', 'not-verified');
    const { credential } = verification.registrationInfo;
    const out = consumeLinkCode({
      linkId: c.link.id,
      userId: c.link.userId,
      credential: {
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter || 0,
        transports: body.credential?.response?.transports || []
      }
    });
    if (out.error === 'credential-exists') return fail(409, 'credential already registered', 'credential-exists');
    if (out.error) {
      audit(req, 'auth.link.fail', { ok: false, user: ficha, uid: c.link.userId, msg: out.error });
      return json(res, out.error === 'link-invalid' ? 400 : 409, { error: out.error === 'link-invalid' ? 'link_invalid' : 'link_unavailable' });
    }
    const user = out.user;
    audit(req, 'auth.link.ok', { user });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user), owner: !!user.owner } }, { 'Set-Cookie': sessionCookie(user) });
  },

  'POST /api/login/options': async (req, res) => {
    const options = await generateAuthenticationOptions({
      rpID: RP_ID, userVerification: 'preferred', allowCredentials: []
    });
    const cid = putChallenge({ challenge: options.challenge });
    json(res, 200, { cid, options });
  },

  'POST /api/login/verify': async (req, res) => {
    const body = await readBody(req);
    // Segundo cupo por credencial: en un wifi compartido el de IP es alto; este frena a
    // alguien machacando una misma passkey. Antes de tocar el challenge o la base.
    const credId = String(body.credential?.id || '').slice(0, 512);
    if (credId && !rateLimit(res, `cred:${credId} POST /api/login/verify`, RATE_LIMIT_PER_CREDENTIAL_MAX)) return;
    const c = takeChallenge(body.cid);
    if (!c) {
      audit(req, 'auth.login.fail', { ok: false, msg: 'challenge-expired' });
      return json(res, 400, { error: 'challenge expired — try again' });
    }
    const cred = getCredentialById(body.credential?.id);
    if (!cred) {
      audit(req, 'auth.login.fail', { ok: false, msg: 'unknown-credential' });
      return json(res, 404, { error: 'unknown passkey — create a profile first' });
    }
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false,
        credential: {
          id: cred.id,
          publicKey: b64uToBuf(cred.public_key || cred.publicKey),
          counter: cred.counter,
          transports: typeof cred.transports === 'string' ? JSON.parse(cred.transports) : cred.transports
        }
      });
    } catch (e) {
      audit(req, 'auth.login.fail', { ok: false, user: getUserById(cred.user_id || cred.userId), uid: cred.user_id || cred.userId, msg: 'verify-error' });
      return json(res, 400, { error: verifyError(e, { rpId: RP_ID, origin: ORIGIN }) });
    }
    if (!verification.verified) {
      audit(req, 'auth.login.fail', { ok: false, user: getUserById(cred.user_id || cred.userId), uid: cred.user_id || cred.userId, msg: 'not-verified' });
      return json(res, 400, { error: 'not verified' });
    }
    updateCredentialCounter(cred.id, verification.authenticationInfo.newCounter);
    // saveDb(); // Eliminado: SQLite persiste automáticamente
    const user = getUserById(cred.user_id || cred.userId);
    if (!user) {
      audit(req, 'auth.login.fail', { ok: false, uid: cred.user_id || cred.userId, msg: 'user-missing' });
      return json(res, 500, { error: 'user missing' });
    }
    if (user.disabled) {
      audit(req, 'auth.login.fail', { ok: false, user, msg: 'account-disabled' });
      return json(res, 403, { error: 'this account has been disabled' });
    }
    audit(req, 'auth.login.ok', { user });
    json(res, 200, { user: { id: user.id, name: user.name, admin: isAdmin(user), owner: !!user.owner } }, { 'Set-Cookie': sessionCookie(user) });
  },

  /* ---------- Device Pairing Flow ---------- */
  'POST /api/auth/device/start': async (req, res) => {
    cleanExpiredPairings();
    const pairingId = crypto.randomBytes(16).toString('base64url');
    const manualCode = genManualCode();
    const exp = Date.now() + 5 * 60000;
    const data = { pairingId, manualCode, status: 'pending', user: null, attempts: 0, exp };
    pendingPairings.set(pairingId, data);
    manualCodeMap.set(manualCode, pairingId);
    json(res, 200, { pairingId, manualCode, expiresAt: exp });
  },

  // El primer claim exitoso ata el pairing a esa cuenta (claimedBy). Un claim de otra cuenta
  // sobre el mismo pairing es un intento fallido; al llegar a PAIRING_MAX_ATTEMPTS el pairing
  // se invalida. Un código inexistente no se puede atribuir a ningún pairing: eso lo frena el
  // rate limit por IP.
  'POST /api/auth/device/claim': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    if (!rateLimit(res, `user:${user.id} POST /api/auth/device/claim`, RATE_LIMIT_PER_USER_MAX)) return;
    const body = await readBody(req);
    cleanExpiredPairings();
    const rawCode = String(body.code || body.manualCode || body.pairingId || '').trim().toUpperCase();
    const pairingId = pendingPairings.has(rawCode) ? rawCode : manualCodeMap.get(rawCode);
    const pairing = pairingId ? pendingPairings.get(pairingId) : null;
    if (!pairing || pairing.exp < Date.now()) {
      return json(res, 400, { error: 'Código o QR no válido o expirado' });
    }
    if (pairing.status !== 'pending' || (pairing.claimedBy && pairing.claimedBy !== user.id)) {
      pairing.attempts += 1;
      if (pairing.attempts >= PAIRING_MAX_ATTEMPTS) dropPairing(pairing);
      audit(req, 'auth.device.claim.fail', { ok: false, user, msg: 'already-claimed' });
      return json(res, 409, { error: 'Este código ya fue usado desde otra cuenta' });
    }
    pairing.claimedBy = user.id;
    json(res, 200, { pairingId: pairing.pairingId, manualCode: pairing.manualCode, ok: true });
  },

  'POST /api/auth/device/confirm': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    if (!rateLimit(res, `user:${user.id} POST /api/auth/device/confirm`, RATE_LIMIT_PER_USER_MAX)) return;
    const body = await readBody(req);
    cleanExpiredPairings();
    const pairingId = String(body.pairingId || '').trim();
    const pairing = pendingPairings.get(pairingId);
    if (!pairing || pairing.exp < Date.now()) {
      return json(res, 400, { error: 'Solicitud de vinculación expirada' });
    }
    if (pairing.status !== 'pending' || pairing.claimedBy !== user.id) {
      return json(res, 409, { error: 'Primero ingresá el código de vinculación' });
    }
    pairing.status = 'approved';
    pairing.user = user;
    audit(req, 'auth.device.approved', { user, pairingId });
    json(res, 200, { ok: true });
  },

  'GET /api/auth/device/poll': async (req, res) => {
    cleanExpiredPairings();
    const u = new URL(req.url, ORIGIN);
    const pairingId = u.searchParams.get('pairingId') || u.searchParams.get('id');
    if (!pairingId) return json(res, 400, { error: 'pairingId required' });
    const pairing = pendingPairings.get(pairingId);
    if (!pairing || pairing.exp < Date.now()) {
      return json(res, 400, { status: 'expired', error: 'expired' });
    }
    if (pairing.status === 'pending') {
      return json(res, 200, { status: 'pending' });
    }
    if (pairing.status === 'approved' && pairing.user) {
      const user = pairing.user;
      dropPairing(pairing);
      audit(req, 'auth.device.login', { user });
      return json(res, 200, { status: 'approved', user: { id: user.id, name: user.name, admin: isAdmin(user), owner: !!user.owner } }, { 'Set-Cookie': sessionCookie(user) });
    }
    json(res, 400, { status: 'expired', error: 'invalid state' });
  },

  /* ---------- Additional Passkey Registration ---------- */
  'POST /api/credentials/add/options': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    const userCreds = getCredentialsByUserId(user.id);
    const excludeCredentials = userCreds.map(c => ({ id: c.id, type: 'public-key' }));
    const options = await generateRegistrationOptions({
      rpName: RP_NAME, rpID: RP_ID,
      userID: Buffer.from(user.id), userName: user.name, userDisplayName: user.name,
      attestationType: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      excludeCredentials
    });
    const cid = putChallenge({ challenge: options.challenge, uid: user.id });
    json(res, 200, { cid, options });
  },

  'POST /api/credentials/add/verify': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c || c.uid !== user.id) {
      return json(res, 400, { error: 'challenge expired — try again' });
    }
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: c.challenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        requireUserVerification: false
      });
    } catch (e) {
      return json(res, 400, { error: verifyError(e, { rpId: RP_ID, origin: ORIGIN }) });
    }
    if (!verification.verified) {
      return json(res, 400, { error: 'not verified' });
    }
    const { credential } = verification.registrationInfo;
    if (getCredentialById(credential.id)) {
      return json(res, 409, { error: 'credential already registered' });
    }
    createCredential({
      id: credential.id, userId: user.id,
      publicKey: Buffer.from(credential.publicKey).toString('base64url'),
      counter: credential.counter || 0,
      transports: body.credential?.response?.transports || []
    });
    // saveDb(); // Eliminado: SQLite persiste automáticamente
    audit(req, 'auth.cred.added', { user });
    json(res, 200, { ok: true, msg: 'Passkey agregada con éxito' });
  },

  'POST /api/logout': async (req, res) => {
    const user = readSession(req);
    if (user) audit(req, 'auth.logout', { user });
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  'POST /api/logout/all': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    const newSv = sessionVersion(user) + 1;
    updateUser(user.id, { sv: newSv });
    // saveDb(); // Eliminado: SQLite persiste automáticamente
    audit(req, 'auth.logout.all', { user });
    json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie });
  },

  'GET /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    const state = getUserState(user.id);
    json(res, 200, { state });
  },

  'GET /api/public-exercises': async (req, res) => json(res, 200, { exercises: getPublicCustomExercises() }),
  'POST /api/admin/public-exercises': async (req, res) => { const admin = requireAdmin(req, res); if (!admin) return; const ex = await readBody(req); if (!ex.id || !ex.n) return json(res, 400, { error: 'invalid exercise' }); savePublicCustomExercise(ex); json(res, 200, { ok: true }); },
  'POST /api/admin/public-exercises/delete': async (req, res) => { const admin = requireAdmin(req, res); if (!admin) return; deletePublicCustomExercise((await readBody(req)).id); json(res, 200, { ok: true }); },

  'PUT /api/data': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    const body = await readBody(req);
    const saveOpts = routineSaveOpts(req);
    const { status, body: payload } = applyStatePut({ db: getDatabase(), userId: user.id, state: body.state, getUserState, saveUserState: (uid, st) => saveUserState(uid, st, saveOpts) });
    json(res, status, payload);
  },

  // Incremental sync endpoint. The client sends a bounded batch of top-level patches;
  // applying them against the current server state prevents one device from replacing
  // unrelated fields changed by another device. The operation ids are client-side and
  // patches are idempotent, so a response lost after commit is safe to retry.
  'POST /api/data/sync': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    const body = await readBody(req);
    if (!Array.isArray(body.operations) || body.operations.length > 50) return json(res, 400, { error: 'invalid operations batch' });
    const saveOpts = routineSaveOpts(req);
    const processed = processSyncBatch({ db: getDatabase(), userId: user.id, operations: body.operations, getUserState, saveUserState: (uid, st) => saveUserState(uid, st, saveOpts) });
    return json(res, 200, processed);
  },

  'GET /api/push/public-key': async (req, res) => json(res, 200, { key: vapid.publicKey }),

  'POST /api/push/subscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    const body = await readBody(req);
    const sub = body.subscription;
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) return json(res, 400, { error: 'invalid subscription' });
    const bad = pushEndpointError(sub.endpoint);
    if (bad) return json(res, 400, { error: bad });

    const keys = { p256dh: String(sub.keys.p256dh), auth: String(sub.keys.auth) };
    // p256dh: 65 bytes en base64url (87 chars); auth: 16 bytes (22 chars).
    if (keys.p256dh.length > 128 || keys.auth.length > 64) return json(res, 400, { error: 'invalid subscription' });
    
    const db = getDatabase();
    db.exec('BEGIN');
    try {
      deleteSubscription(sub.endpoint);
      const mine = getSubscriptionsByUserId(user.id);
      if (mine.length >= MAX_SUBS_PER_USER) {
        const drop = mine.slice(0, mine.length - MAX_SUBS_PER_USER + 1);
        for (const s of drop) {
          deleteSubscription(s.endpoint);
        }
      }
      createSubscription({ userId: user.id, endpoint: sub.endpoint, keys, created: new Date().toISOString() });
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }

    // saveDb(); // Eliminado: SQLite persiste automáticamente
    json(res, 200, { ok: true });
  },

  'POST /api/push/unsubscribe': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    const body = await readBody(req);
    deleteSubscription(body.endpoint);
    // saveDb(); // Eliminado: SQLite persiste automáticamente
    json(res, 200, { ok: true });
  },

  'POST /api/push/test': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    await sendPush(user.id, testPush(readState(user.id)?.lang));
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    const body = await readBody(req);
    const sec = Math.max(1, Math.min(3600, Math.round(+body.seconds || 0)));
    if (!sec) return json(res, 400, { error: 'seconds required' });
    scheduleRestTimer(user.id, sec, readState(user.id)?.lang);
    json(res, 200, { ok: true });
  },

  'POST /api/push/rest-timer/cancel': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    cancelRestTimer(user.id);
    json(res, 200, { ok: true });
  },

  'POST /api/activity': async (req, res) => {
    const user = readSession(req);
    if (!user) return json(res, 401, { error: 'No has iniciado sesión' });
    const body = await readBody(req);
    if (body.active) {
      presence.set(user.id, {
        name: String(body.name || '').slice(0, 60),
        exIdx: +body.exIdx || 0, exTotal: +body.exTotal || 0,
        setsDone: +body.setsDone || 0, setsTotal: +body.setsTotal || 0,
        startedAt: +body.startedAt || Date.now(),
        updatedAt: Date.now()
      });
    } else presence.delete(user.id);
    json(res, 200, { ok: true });
  },

  /* ---------- admin dashboard ---------- */
  // Los programas que la app del socio ofrece: solo los visibles, para todos (el panel de
  // Rutinas lee GET /api/admin/presets). Sin ninguno visible, la app se comporta como un gym
  // sin programas.
  'GET /api/presets': async (req, res) => {
    if (!readSession(req)) return json(res, 401, { error: 'No has iniciado sesión' });
    json(res, 200, presetCatalog({ includeHidden: false }));
  },

  // Todos los programas, visibles y ocultos, con visibleToMembers: Rutinas y "Asignar a socio".
  'GET /api/admin/presets': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    json(res, 200, presetCatalog({ includeHidden: true }));
  },

  // El socio carga un programa (primer ingreso, "Cargar planes prearmados", "Load starter
  // plan"): la app pide acá sus días justo antes de armar el plan, así un programa que el admin
  // ocultó después de que se abrió la lista no se carga. 403 si está oculto.
  'POST /api/presets/apply': async (req, res) => {
    if (!readSession(req)) return json(res, 401, { error: 'No has iniciado sesión' });
    const body = await readBody(req);
    const program = getPresetProgramById(body.id);
    if (!program) return json(res, 404, { error: 'no such program' });
    if (!program.visibleToMembers) return json(res, 403, { error: 'program_hidden' });
    const presets = getAllPresets().filter(p => p.program_id === program.id).map(p => getPresetWithExercises(p.id));
    json(res, 200, { program, presets, customExercises: getPresetCustomExercises(presets) });
  },

  'POST /api/admin/presets': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const result = cleanPreset(await readBody(req));
    if (result.error) return json(res, 400, { error: result.error });
    const conflict = findPresetDayConflict(result.value);
    if (conflict) return presetConflictResponse(res, conflict, result.value.plannedDay);
    createPreset(result.value);
    audit(req, 'admin.preset.create', { user: admin, msg: result.value.name });
    json(res, 200, { preset: getPresetWithExercises(result.value.id) });
  },

  'PUT /api/admin/presets': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const existing = getPresetById(body.id);
    if (!existing) return json(res, 404, { error: 'no such preset' });
    const result = cleanPreset(body, existing.id);
    if (result.error) return json(res, 400, { error: result.error });
    const conflict = findPresetDayConflict(result.value, existing.id);
    if (conflict) return presetConflictResponse(res, conflict, result.value.plannedDay);
    updatePreset(existing.id, result.value);
    audit(req, 'admin.preset.update', { user: admin, msg: result.value.name });
    json(res, 200, { preset: getPresetWithExercises(existing.id) });
  },

  'POST /api/admin/presets/delete': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const preset = getPresetById(body.id);
    if (!preset) return json(res, 404, { error: 'no such preset' });
    deletePreset(preset.id);
    audit(req, 'admin.preset.delete', { user: admin, msg: preset.name });
    json(res, 200, { ok: true });
  },

  // Copia de un día en su mismo programa, sin día planeado (el original lo ocupa).
  'POST /api/admin/presets/duplicate': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const preset = getPresetById(body.id);
    if (!preset) return json(res, 404, { error: 'no such preset' });
    const name = (String(body.name || '').trim() || `${preset.name} (copia)`).slice(0, 80);
    const copy = duplicatePreset(preset.id, name);
    audit(req, 'admin.preset.duplicate', { user: admin, msg: `${preset.name} → ${copy.name}` });
    json(res, 200, { preset: copy });
  },

  // Orden de los días de un programa: ids = todos sus días, en el orden nuevo.
  'POST /api/admin/presets/reorder': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    if (!getPresetProgramById(body.programId)) return json(res, 404, { error: 'no such program' });
    if (!Array.isArray(body.ids) || !body.ids.every(id => typeof id === 'string')) return json(res, 400, { error: 'invalid ids' });
    if (!reorderPresets(body.programId, body.ids)) return json(res, 409, { error: 'PROGRAM_CHANGED', code: 'PROGRAM_CHANGED' });
    json(res, 200, { ok: true });
  },

  // Borra un programa con todos sus días. Los socios que ya lo cargaron conservan su copia.
  'POST /api/admin/programs/delete': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const program = getPresetProgramById(body.id);
    if (!program) return json(res, 404, { error: 'no such program' });
    const days = deletePresetProgram(program.id);
    audit(req, 'admin.program.delete', { user: admin, msg: `${program.name} (${days} días)` });
    json(res, 200, { ok: true, days });
  },

  'PUT /api/admin/programs': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const program = getPresetProgramById(body.id);
    if (!program) return json(res, 404, { error: 'no such program' });
    const name = String(body.name || '').trim().slice(0, 80);
    if (!name) return json(res, 400, { error: 'name required' });
    const taken = getPresetProgramByName(name);
    if (taken && taken.id !== program.id) return json(res, 409, { error: 'PROGRAM_NAME_TAKEN', code: 'PROGRAM_NAME_TAKEN' });
    const renamed = renamePresetProgram(program.id, name);
    audit(req, 'admin.program.rename', { user: admin, msg: `${program.name} → ${name}` });
    json(res, 200, { program: renamed });
  },

  // Mostrar u ocultar un programa en la app del socio. Quien ya lo cargó conserva su rutina.
  'POST /api/admin/programs/visibility': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const program = getPresetProgramById(body.id);
    if (!program) return json(res, 404, { error: 'no such program' });
    if (typeof body.visible !== 'boolean') return json(res, 400, { error: 'visible must be a boolean' });
    const updated = setPresetProgramVisibility(program.id, body.visible);
    audit(req, 'admin.program.visibility', { user: admin, msg: `${program.name}: ${body.visible ? 'visible' : 'oculto'} para socios` });
    json(res, 200, { program: updated });
  },

  // Copia de un programa entero. Sin nombre, "<nombre> (copia)", "(copia 2)"… el primero libre.
  'POST /api/admin/programs/duplicate': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const program = getPresetProgramById(body.id);
    if (!program) return json(res, 404, { error: 'no such program' });
    let name = String(body.name || '').trim().slice(0, 80);
    if (name && getPresetProgramByName(name)) return json(res, 409, { error: 'PROGRAM_NAME_TAKEN', code: 'PROGRAM_NAME_TAKEN' });
    for (let n = 1; !name; n++) {
      const candidate = `${program.name} (copia${n > 1 ? ' ' + n : ''})`.slice(0, 80);
      if (!getPresetProgramByName(candidate)) name = candidate;
    }
    const copy = duplicatePresetProgram(program.id, name);
    audit(req, 'admin.program.duplicate', { user: admin, msg: `${program.name} → ${copy.name}` });
    json(res, 200, { program: copy });
  },

  // Socios activos con cada programa cargado ({ programId: { users, active } }).
  'GET /api/admin/programs/usage': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    json(res, 200, { usage: getPresetProgramUsage() });
  },

  'GET /api/admin/users': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const dbUsers = getAllUsers();
    const settings = billingSettingsNow();
    const today = billingToday(settings);
    const billingByUser = new Map(getAllMemberBilling().map(b => [b.userId, b]));
    const appUserIds = getAppUserIds();
    const profileUserIds = getProfileUserIds();
    // "Datos incompletos": fichas con algún obligatorio vacío (típico de una importación).
    const fields = memberFieldsNow();
    const incomplete = new Set(getAllMemberProfiles().filter(p => missingRequiredFields(p, fields).length).map(p => p.userId));
    // Nunca DNI ni celular acá: solo si existen (hasProfile). La ficha completa va por /profile.
    const users = dbUsers.map(u => {
      const S = readState(u.id) || {};
      const workouts = S.workouts || [];
      const last = workouts[workouts.length - 1];
      return {
        id: u.id, name: u.name, created: isoTimestamp(u.created_at),
        disabled: !!u.disabled, admin: isAdmin(u), owner: !!u.owner, invitedBy: u.invited_by || null,
        hasApp: appUserIds.has(u.id), hasProfile: profileUserIds.has(u.id), profileIncomplete: incomplete.has(u.id),
        workouts: workouts.length,
        lastWorkout: last ? last.d : null,
        lastSync: S._ts || null,
        hasPush: getSubscriptionsByUserId(u.id).length > 0,
        live: livePresence(u.id),
        billing: (b => ({ status: billingStatus(b, today, settings), dueDate: b.dueDate ?? null }))(billingByUser.get(u.id) || {})
      };
    });
    json(res, 200, { users, invite_only: INVITE_ONLY, audit_enabled: AUDIT_ON, billing_enabled: billingEnabledNow(), now: Date.now() });
  },

  'GET /api/admin/attendance-heatmap': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const start = getAdminSetting('attendance_week_start', 'monday') === 'sunday' ? 'sunday' : 'monday';
    const endDate = new Date();
    endDate.setHours(12, 0, 0, 0);
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 27);
    const iso = d => d.toISOString().slice(0, 10);
    const rows = getAttendanceByDate(iso(startDate), iso(endDate));
    const days = Object.fromEntries(rows.map(r => [r.date, Number(r.users) || 0]));
    // Las fichas sin passkey no entrenan con la app: no cuentan en el total.
    json(res, 200, { start, days, totalUsers: countAppUsers(), now: Date.now() });
  },

  'POST /api/admin/attendance-week-start': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const start = body.start === 'sunday' ? 'sunday' : body.start === 'monday' ? 'monday' : null;
    if (!start) return json(res, 400, { error: 'start must be sunday or monday' });
    setAdminSetting('attendance_week_start', start);
    audit(req, 'admin.attendance.settings', { user: admin, msg: start });
    json(res, 200, { ok: true, start });
  },

  'GET /api/admin/user': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const u = getUserById(id);
    if (!u) return json(res, 404, { error: 'El usuario no existe' });
    const S = readState(u.id) || {};
    json(res, 200, {
      user: {
        id: u.id, name: u.name, created: isoTimestamp(u.created_at), disabled: !!u.disabled, admin: isAdmin(u), owner: !!u.owner, invitedBy: u.invited_by || null,
        hasApp: countCredentials(u.id) > 0, hasProfile: !!getMemberProfile(u.id)
      },
      unit: S.unit || 'kg',
      lastSync: S._ts || null,
      routines: (S.routines || []).map(r => ({ id: r.id, name: r.name, emoji: r.emoji, count: (r.ex || []).length })),
      bodyweight: S.bodyweight || [],
      workouts: (S.workouts || []).slice().reverse()
    });
  },

  'POST /api/admin/user/disable': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const u = getUserById(body.id);
    if (!u) return json(res, 404, { error: 'El usuario no existe' });
    if (isAdmin(u)) return json(res, 400, { error: 'cannot disable an admin' });
    const newDisabled = !!body.disabled;
    updateUser(u.id, { disabled: newDisabled });
    if (newDisabled) presence.delete(u.id);
    // saveDb(); // Eliminado: SQLite persiste automáticamente
    audit(req, newDisabled ? 'admin.user.disable' : 'admin.user.enable', { user: admin, target: u });
    json(res, 200, { ok: true, id: u.id, disabled: newDisabled });
  },

  'POST /api/owner/user/admin': async (req, res) => {
    const owner = requireOwner(req, res); if (!owner) return;
    const body = await readBody(req);
    const id = String(body.id || '').trim();
    if (!id) return json(res, 400, { error: 'user id required' });
    const u = getUserById(id);
    if (!u) return json(res, 404, { error: 'El usuario no existe' });
    if (isOwner(u)) return json(res, 400, { error: 'cannot change the owner role' });
    const admin = !!body.admin;
    updateUser(u.id, { admin });
    audit(req, admin ? 'owner.user.promote' : 'owner.user.demote', { user: owner, target: u });
    json(res, 200, { ok: true, id: u.id, admin });
  },

  'POST /api/owner/user/delete': async (req, res) => {
    const owner = requireOwner(req, res); if (!owner) return;
    const body = await readBody(req);
    const id = String(body.id || '').trim();
    if (!id) return json(res, 400, { error: 'user id required' });
    const u = getUserById(id);
    if (!u) return json(res, 404, { error: 'El usuario no existe' });
    if (!u.disabled) return json(res, 400, { error: 'only disabled accounts can be deleted' });
    if (isOwner(u)) return json(res, 400, { error: 'cannot delete the owner account' });

    try {
      const deleted = deleteUser(u.id);
      audit(req, 'owner.user.delete', { user: owner, target: deleted });
      return json(res, 200, { ok: true, id: deleted.id });
    } catch (error) {
      audit(req, 'owner.user.delete', { ok: false, user: owner, target: u, msg: error.message });
      throw error;
    }
  },

  /* ---------- cuotas v1 ---------- */
  'GET /api/admin/billing': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (billingDisabled(res)) return;
    const settings = billingSettingsNow();
    const today = billingToday(settings);
    const members = getAllMemberBilling().map(b => {
      const view = billingView(b, today, settings);
      return { id: b.userId, name: b.name, disabled: b.disabled, admin: isAdmin({ id: b.userId, admin: b.admin }), hasApp: b.hasApp, planId: view.planId, planName: view.planName, dueDate: view.dueDate, trialUntil: view.trialUntil, status: view.status, debt: view.debt };
    });
    // El resumen cuenta socios activos y no admins: un desactivado no es deuda por cobrar ni un
    // cupo, y admins/owner no quedan bloqueados por cuota. Siguen en members con admin: true.
    const active = members.filter(m => !m.disabled && !m.admin);
    const summary = { al_dia: 0, por_vencer: 0, vencido: 0, bloqueado: 0, sin_plan: 0, en_prueba: 0 };
    for (const m of active) summary[m.status === 'prueba' ? 'en_prueba' : m.status]++;
    summary.deuda_total = debtTotal(active);
    json(res, 200, { today, settings, summary, members });
  },

  'GET /api/admin/billing/plans': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    json(res, 200, { plans: getPlans() });
  },

  'POST /api/admin/billing/plans': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    if (billingDisabled(res)) return;
    const parsed = parsePlanBody(await readBody(req), false);
    if (parsed.error) return json(res, 400, { error: parsed.error });
    const plan = createPlan(parsed.value);
    audit(req, 'admin.billing.plan_create', { user: admin, summary: planSummary(plan) });
    json(res, 200, { plan });
  },

  'PUT /api/admin/billing/plans/:id': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    if (billingDisabled(res)) return;
    const id = Number(new URL(req.url, 'http://x').pathname.split('/').pop());
    if (!Number.isInteger(id) || id < 1) return json(res, 400, { error: 'id de plan inválido' });
    if (!getPlanById(id)) return json(res, 404, { error: 'El plan no existe' });
    const parsed = parsePlanBody(await readBody(req), true);
    if (parsed.error) return json(res, 400, { error: parsed.error });
    if (!Object.keys(parsed.value).length) return json(res, 400, { error: 'Nada para actualizar' });
    const plan = updatePlan(id, parsed.value);
    audit(req, 'admin.billing.plan_update', { user: admin, summary: planSummary(plan) });
    json(res, 200, { plan });
  },

  'GET /api/admin/billing/settings': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    json(res, 200, { settings: billingSettingsNow() });
  },

  'PUT /api/admin/billing/settings': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    if (billingDisabled(res)) return;
    const checked = validateBillingSettings(await readBody(req));
    if (checked.error) return json(res, 400, { error: checked.error });
    const keys = Object.keys(checked.value);
    if (!keys.length) return json(res, 400, { error: 'Nada para actualizar' });
    for (const key of keys) setAdminSetting(key, serializeBillingSetting(key, checked.value[key]));
    audit(req, 'admin.billing.settings', { user: admin, summary: keys.map(k => `${k}=${[].concat(checked.value[k]).join('/')}`).join(' · ') });
    json(res, 200, { settings: billingSettingsNow() });
  },

  'GET /api/admin/users/:userId/billing': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const userId = userIdFromPath(req);
    if (!getUserById(userId)) return json(res, 404, { error: 'El usuario no existe' });
    const settings = billingSettingsNow();
    const today = billingToday(settings);
    const billing = getMemberBilling(userId);
    const blocker = trialBlocker(userId, billing, today, settings);
    const payments = getPaymentsByUserId(userId);
    json(res, 200, {
      billing: billingView(billing, today, settings),
      payments,
      // Pagos y pruebas juntos, el más nuevo primero. Una prueba no es un pago: monto 0, no se
      // anula y no suma a recaudación ni a deuda.
      history: billingHistory(payments, getTrialsByUserId(userId), settings),
      // Para la ficha de cuota: si se puede dar la prueba y, si no, por qué.
      trial: { days: settings.trial_days, until: trialEndDate(today, settings.trial_days), available: !blocker, blocker }
    });
  },

  // Prueba gratis de trial_days días desde hoy (1 = solo hoy). Una por persona: exige el DNI.
  'POST /api/admin/users/:userId/trial': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    if (billingDisabled(res)) return;
    const userId = userIdFromPath(req);
    const target = requireActiveTargetUser(res, userId); if (!target) return;
    const settings = billingSettingsNow();
    const today = billingToday(settings);
    const blocker = trialBlocker(userId, getMemberBilling(userId), today, settings);
    if (blocker) return json(res, 409, { error: blocker, message: TRIAL_ERRORS[blocker] });
    const until = trialEndDate(today, settings.trial_days);
    if (!startTrial(userId, until, admin.id)) return json(res, 409, { error: 'trial_used', message: TRIAL_ERRORS.trial_used });
    audit(req, 'admin.billing.trial_start', { user: admin, target, summary: `Prueba de ${settings.trial_days} día${settings.trial_days === 1 ? '' : 's'} · hasta ${until}` });
    json(res, 200, { billing: billingView(getMemberBilling(userId), billingToday(settings), settings) });
  },

  // Asignar, cambiar o quitar (planId null) el plan, con el vencimiento vigente.
  'PUT /api/admin/users/:userId/billing': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    if (billingDisabled(res)) return;
    const userId = userIdFromPath(req);
    const target = getUserById(userId);
    if (!target) return json(res, 404, { error: 'El usuario no existe' });
    const body = await readBody(req);
    const current = getMemberBilling(userId);
    const checked = checkPlanAssignment(body, current.planId);
    if (checked.error) return json(res, checked.status, { error: checked.error });
    const { plan, dueDate } = checked.value;
    let summary;
    if (!plan) {
      setMemberBilling(userId, { planId: null });
      summary = 'Plan quitado';
    } else {
      setMemberBilling(userId, { planId: plan.id, dueDate });
      summary = `Plan: ${plan.name} · vence ${dueDate}`;
    }
    audit(req, 'admin.billing.assign', { user: admin, target, summary });
    const settings = billingSettingsNow();
    json(res, 200, { billing: billingView(getMemberBilling(userId), billingToday(settings), settings) });
  },

  // Registrar un pago: mueve el vencimiento según nextDueDate. Vale también para un socio
  // desactivado — el pago no toca users.disabled.
  'POST /api/admin/users/:userId/payments': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    if (billingDisabled(res)) return;
    const userId = userIdFromPath(req);
    const target = getUserById(userId);
    if (!target) return json(res, 404, { error: 'El usuario no existe' });
    const body = await readBody(req);
    const settings = billingSettingsNow();
    const current = getMemberBilling(userId);

    const checked = checkPayment(body, current, settings);
    if (checked.error) return json(res, checked.status, { error: checked.error });
    const { plan, amount, method, paidAt, note, period } = checked.value;
    // El desbloqueo se mide contra hoy.
    const statusBefore = billingStatus(current, billingToday(settings), settings);
    // Vista previa para el formulario: la misma regla de vencimiento, sin guardar ni auditar.
    if (body.dry_run === true) {
      const preview = { ...current, planId: plan.id, planName: plan.name, planPrice: plan.price, planDurationDays: plan.durationDays, planActive: plan.active, dueDate: period.dueDate, trialUntil: null };
      return json(res, 200, { dry_run: true, billing: billingView(preview, billingToday(settings), settings), period, amount });
    }
    const paymentId = recordPayment({
      userId, userName: target.name, planId: plan.id, planName: plan.name, amount, method,
      paidAt, periodStart: period.periodStart, periodEnd: period.periodEnd, dueDate: period.dueDate,
      note, createdBy: admin.id
    });
    audit(req, 'admin.billing.payment', { user: admin, target, summary: `$${amount} · ${method} · ${plan.name} · vence ${period.dueDate}` });
    if (statusBefore === 'bloqueado') audit(req, 'admin.billing.unblocked', { user: admin, target, summary: `Vence ${period.dueDate}` });
    json(res, 200, {
      billing: billingView(getMemberBilling(userId), billingToday(settings), settings),
      payment: getPaymentById(paymentId)
    });
  },

  // Anular el último pago vigente del socio: vuelve al plan y vencimiento previos. Solo si nada
  // movió el vencimiento después (otra asignación o pago); el pago queda en el historial, marcado.
  'POST /api/admin/users/:userId/payments/:paymentId/void': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    if (billingDisabled(res)) return;
    const parts = new URL(req.url, 'http://x').pathname.split('/');
    const userId = decodeURIComponent(parts[4] || '');
    const paymentId = Number(parts[6]);
    if (!Number.isInteger(paymentId) || paymentId < 1) return json(res, 400, { error: 'id de pago inválido' });
    const target = getUserById(userId);
    if (!target) return json(res, 404, { error: 'El usuario no existe' });
    const payment = getPaymentById(paymentId);
    if (!payment || payment.userId !== userId) return json(res, 404, { error: 'El pago no existe' });
    const body = await readBody(req);
    if (body.reason != null && (typeof body.reason !== 'string' || body.reason.length > MAX_PAYMENT_NOTE)) return json(res, 400, { error: `reason debe ser texto (máx. ${MAX_PAYMENT_NOTE})` });
    if (payment.voidedAt) return json(res, 409, { error: 'Este pago ya está anulado' });
    if (payment.source === 'import') return json(res, 409, { error: 'Un pago importado no se puede anular' });
    if (getLatestActivePayment(userId)?.id !== payment.id) return json(res, 409, { error: 'Solo se puede anular el último pago registrado del socio' });
    const current = getMemberBilling(userId);
    if (current.dueDate !== payment.periodEnd || current.planId !== payment.planId) {
      return json(res, 409, { error: 'El vencimiento cambió después de este pago; no se puede anular' });
    }
    // Se puede volver a un vencimiento anterior o a la prueba que el pago cerró.
    const backTo = payment.previousDueDate ?? null;
    const backToTrial = payment.previousTrialUntil ?? null;
    if (backTo == null && backToTrial == null) return json(res, 409, { error: 'Este pago no guarda el vencimiento anterior; no se puede anular' });

    const reason = body.reason ? body.reason.trim() || null : null;
    voidPayment({ paymentId, userId, voidedBy: admin.id, reason, planId: payment.previousPlanId, dueDate: backTo, trialUntil: backToTrial });
    const settings = billingSettingsNow();
    const billing = billingView(getMemberBilling(userId), billingToday(settings), settings);
    const back = backToTrial ? `vuelve a la prueba (hasta ${backToTrial})` : `vuelve a vencer ${backTo}`;
    audit(req, 'admin.billing.payment_void', { user: admin, target, summary: `$${payment.amount} · ${back}${reason ? ' · ' + reason : ''}` });
    if (billing.status === 'bloqueado' && !isAdmin(target)) audit(req, 'admin.billing.blocked', { user: admin, target, summary: backToTrial ? `Prueba terminada el ${backToTrial}` : `Venció ${backTo}` });
    json(res, 200, { billing, payment: getPaymentById(paymentId) });
  },

  /* ---------- horario de avisos de cuota ---------- */
  // Hora del gym (gym_tz) desde la que salen el aviso de vencimiento y el recordatorio manual.
  'GET /api/admin/notifications/settings': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    json(res, 200, { billing_notify_hour: getBillingNotifyHour(getDatabase()), gym_tz: billingSettingsNow().gym_tz });
  },

  'PUT /api/admin/notifications/settings': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    if (!isValidNotifyHour(body.billing_notify_hour)) return json(res, 400, { error: 'billing_notify_hour debe tener el formato HH:MM' });
    setAdminSetting(BILLING_NOTIFY_HOUR_SETTING, body.billing_notify_hour);
    audit(req, 'admin.notifications.settings', { user: admin, summary: `Avisos de cuota desde las ${body.billing_notify_hour}` });
    json(res, 200, { billing_notify_hour: getBillingNotifyHour(getDatabase()), gym_tz: billingSettingsNow().gym_tz });
  },

  /* ---------- aviso de privacidad ---------- */
  // Público (sin sesión): la página /#/privacidad arma el texto con esto. Solo datos que el
  // aviso tiene que decir de todos modos: quién es el responsable y qué datos se piden.
  'GET /api/privacy': async (req, res) => {
    const fields = memberFieldsNow();
    json(res, 200, {
      gymName: getAdminSetting(PRIVACY_GYM_NAME_SETTING, ''),
      contact: getAdminSetting(PRIVACY_CONTACT_SETTING, ''),
      fields: Object.keys(fields).filter(k => fields[k].enabled),
      billingEnabled: billingEnabledNow(),
      auditDays: AUDIT_ON ? AUDIT_DAYS : null
    });
  },

  'GET /api/owner/privacy': async (req, res) => {
    if (!requireOwner(req, res)) return;
    json(res, 200, { gymName: getAdminSetting(PRIVACY_GYM_NAME_SETTING, ''), contact: getAdminSetting(PRIVACY_CONTACT_SETTING, '') });
  },

  'PUT /api/owner/privacy': async (req, res) => {
    const owner = requireOwner(req, res); if (!owner) return;
    const checked = validatePrivacySettings(await readBody(req));
    if (checked.error) return json(res, 400, { error: checked.error });
    if (checked.value.gymName !== undefined) setAdminSetting(PRIVACY_GYM_NAME_SETTING, checked.value.gymName);
    if (checked.value.contact !== undefined) setAdminSetting(PRIVACY_CONTACT_SETTING, checked.value.contact);
    const out = { gymName: getAdminSetting(PRIVACY_GYM_NAME_SETTING, ''), contact: getAdminSetting(PRIVACY_CONTACT_SETTING, '') };
    audit(req, 'owner.privacy.settings', { user: owner, summary: `Responsable: ${out.gymName || '—'}` });
    json(res, 200, out);
  },

  /* ---------- fichas de socio ---------- */
  // Config de campos: la leen los admins (arman los formularios con ella), la cambia el owner.
  'GET /api/admin/members/settings': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    json(res, 200, { fields: memberFieldsNow() });
  },

  'PUT /api/admin/members/settings': async (req, res) => {
    const owner = requireOwner(req, res); if (!owner) return;
    const body = await readBody(req);
    const checked = validateMemberFields(body.fields, memberFieldsNow());
    if (checked.error) return json(res, 400, { error: checked.error });
    setAdminSetting(MEMBER_FIELDS_SETTING, JSON.stringify(checked.value));
    const fields = memberFieldsNow();
    audit(req, 'owner.member.fields', {
      user: owner,
      summary: Object.entries(fields).map(([k, f]) => `${k}=${!f.enabled ? 'no' : f.required ? 'obligatorio' : 'opcional'}`).join(' · ')
    });
    json(res, 200, { fields });
  },

  // Alta de ficha: socio sin passkey, cargado por un admin. Datos según la config de campos.
  'POST /api/admin/members': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    if (body.planId !== undefined && body.planId !== null && billingDisabled(res)) return;
    const fields = memberFieldsNow();

    // Cuota inicial (start): primer pago o prueba, en la misma transacción que la ficha.
    // planId/dueDate (asignar sin pago) siguen para importar; no se combinan con start.
    const start = body.start ?? null;
    if (start !== null) {
      if (typeof start !== 'object' || !['payment', 'trial'].includes(start.type)) return json(res, 400, { error: "start.type debe ser 'payment' o 'trial'" });
      if (billingDisabled(res)) return;
      if (body.planId != null) return json(res, 400, { error: 'start no se combina con planId' });
    }
    const settings = billingSettingsNow();
    const today = billingToday(settings);
    let payment = null;
    let trialUntil = null;
    if (start?.type === 'payment') {
      const pay = checkPayment(start, { planId: null, dueDate: null }, settings);
      if (pay.error) return json(res, pay.status, { error: pay.error });
      payment = pay.value;
    } else if (start?.type === 'trial') {
      trialUntil = trialEndDate(today, settings.trial_days);
    }
    // Vista previa para el formulario: el vencimiento (o fin de prueba) que quedaría. No valida
    // los datos de la ficha (el formulario puede estar a medio completar) ni guarda nada.
    if (body.dry_run === true) {
      return json(res, 200, { dry_run: true, dueDate: payment?.period.dueDate ?? null, amount: payment?.amount ?? null, trialUntil, trialDays: settings.trial_days });
    }

    const checked = validateMemberProfile(body, fields);
    if (checked.error) return json(res, 400, { error: checked.error, field: checked.field });
    const profile = checked.value;
    // Sin nombre de usuario explícito, se usa el nombre y apellido.
    const rawName = typeof body.name === 'string' && body.name.trim() ? body.name : (profile.fullName || '').slice(0, MAX_USER_NAME);
    const name = parseUserName(rawName);
    if (name.error) return json(res, 400, { error: name.error, field: 'name' });

    let plan = null;
    let billing = null;
    if (body.planId !== undefined && body.planId !== null) {
      const assigned = checkPlanAssignment(body, null);
      if (assigned.error) return json(res, assigned.status, { error: assigned.error });
      plan = assigned.value.plan;
      billing = { planId: plan.id, dueDate: assigned.value.dueDate };
    }
    if (profile.dniNorm) {
      const other = findMemberByDni(profile.dniNorm);
      if (other) return dniDuplicate(res, other);
    }
    if (trialUntil && (!fields.dni.enabled || !profile.dniNorm)) return json(res, 409, { error: 'trial_requires_dni', message: TRIAL_ERRORS.trial_requires_dni });

    const id = crypto.randomBytes(12).toString('base64url');
    const paymentRow = payment && {
      planId: payment.plan.id, planName: payment.plan.name, amount: payment.amount, method: payment.method, paidAt: payment.paidAt,
      periodStart: payment.period.periodStart, periodEnd: payment.period.periodEnd, dueDate: payment.period.dueDate, note: payment.note, createdBy: admin.id
    };
    try {
      createMember({ id, name: name.value, profile, billing, start: paymentRow ? { payment: paymentRow } : trialUntil ? { trialUntil, createdBy: admin.id } : null });
    } catch (error) {
      // Otra alta con el mismo DNI entró entre el chequeo y la transacción.
      const other = isDniUniqueError(error) && findMemberByDni(profile.dniNorm);
      if (other) return dniDuplicate(res, other);
      throw error;
    }
    const user = getUserById(id);
    const summary = [profile.dniNorm ? `DNI ${maskDni(profile.dniNorm)}` : null, plan ? `Plan: ${plan.name} · vence ${billing.dueDate}` : null].filter(Boolean).join(' · ');
    audit(req, 'admin.member.create', { user: admin, target: user, summary });
    if (payment) audit(req, 'admin.billing.payment', { user: admin, target: user, summary: `$${payment.amount} · ${payment.method} · ${payment.plan.name} · vence ${payment.period.dueDate}` });
    if (trialUntil) audit(req, 'admin.billing.trial_start', { user: admin, target: user, summary: `Prueba de ${settings.trial_days} día${settings.trial_days === 1 ? '' : 's'} · hasta ${trialUntil}` });
    json(res, 200, { member: { ...profileView(user, getMemberProfile(id)), billing: billingView(getMemberBilling(id), billingToday(settings), settings) } });
  },

  // Importar socios desde Excel/CSV (el frontend lee el archivo y manda las filas ya mapeadas).
  // dry_run: qué pasaría fila por fila, sin escribir. Real: todo en una transacción.
  'POST /api/owner/members/import': async (req, res) => {
    const owner = requireOwner(req, res); if (!owner) return;
    if (!rateLimit(res, `user:${owner.id} POST /api/owner/members/import`, RATE_LIMIT_IMPORT_MAX)) return;
    const parsed = parseImportBody(await readBody(req), plan => parsePlanBody(plan, false));
    if (parsed.error) return json(res, 400, { error: parsed.error });
    const settings = billingSettingsNow();
    const analysis = analyzeImport(parsed.value, {
      fields: memberFieldsNow(),
      billingEnabled: billingEnabledNow(),
      paymentMethods: settings.payment_methods,
      today: billingToday(settings),
      plans: getPlans(),
      existingProfiles: getAllMemberProfiles()
    });
    if (analysis.error) return json(res, 400, { error: analysis.error });
    const { summary, rows, warnings, write } = analysis;
    if (parsed.value.dryRun) return json(res, 200, { dry_run: true, summary, rows, warnings });

    const members = write.members.map(m => ({ ...m, id: crypto.randomBytes(12).toString('base64url') }));
    let result;
    try {
      result = importMembers({ plans: write.plans, members, fills: write.fills, createdBy: owner.id });
    } catch (error) {
      // Otra alta tomó un DNI del archivo entre la vista previa y la importación: nada se guardó.
      if (isDniUniqueError(error)) return json(res, 409, { error: 'dni_duplicado', message: 'Otro socio con un DNI del archivo se cargó mientras tanto. No se importó nada: volvé a generar la vista previa.' });
      throw error;
    }
    const skipped = summary.existentes - result.updated;
    // Solo conteos: nunca DNIs ni nombres del archivo.
    audit(req, 'owner.member.import', {
      user: owner,
      summary: [`${result.created} creados`, `${result.updated} completados`, `${skipped} salteados`, `${summary.errores} con error`,
        write.plans.length ? `${write.plans.length} planes nuevos` : null, `${members.filter(m => m.payment).length} pagos importados`].filter(Boolean).join(' · ')
    });
    json(res, 200, { ok: true, created: result.created, updated: result.updated, skipped, errors: summary.errores });
  },

  // ¿Ya existe alguien con este DNI? Para ofrecer vincular en vez de duplicar.
  'GET /api/admin/members/lookup': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (!memberFieldsNow().dni.enabled) return json(res, 409, { error: 'dni_deshabilitado' });
    const dni = normalizeDni(new URL(req.url, 'http://x').searchParams.get('dni') || '');
    if (dni.error) return json(res, 400, { error: dni.error });
    const found = findMemberByDni(dni.value.dniNorm);
    if (!found) return json(res, 404, { error: 'No hay ningún socio con ese DNI' });
    json(res, 200, found);
  },

  'GET /api/admin/users/:userId/profile': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const user = getUserById(userIdFromPath(req));
    if (!user) return json(res, 404, { error: 'El usuario no existe' });
    json(res, 200, { profile: profileView(user, getMemberProfile(user.id)), fields: memberFieldsNow() });
  },

  // Edición parcial: solo cambia lo que viene; '' o null borran. Vale para fichas y cuentas con app.
  'PUT /api/admin/users/:userId/profile': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const user = getUserById(userIdFromPath(req));
    if (!user) return json(res, 404, { error: 'El usuario no existe' });
    const body = await readBody(req);
    const fields = memberFieldsNow();

    let name;
    if (body.name !== undefined) {
      const parsed = parseUserName(body.name);
      if (parsed.error) return json(res, 400, { error: parsed.error, field: 'name' });
      if (parsed.value !== user.name) name = parsed.value;
    }
    let profile = null;
    let changed = [];
    if (['fullName', 'dni', 'phone', 'email'].some(k => Object.prototype.hasOwnProperty.call(body, k))) {
      const checked = validateMemberProfile(body, fields, { current: getMemberProfile(user.id), partial: true });
      if (checked.error) return json(res, 400, { error: checked.error, field: checked.field });
      ({ changed } = checked);
      profile = checked.value;
      if (changed.includes('dni') && profile.dniNorm) {
        const other = findMemberByDni(profile.dniNorm, user.id);
        if (other) return dniDuplicate(res, other);
      }
    }
    if (name !== undefined || changed.length) {
      try {
        updateMemberProfile(user.id, { name, profile: changed.length ? profile : null });
      } catch (error) {
        const other = isDniUniqueError(error) && findMemberByDni(profile.dniNorm, user.id);
        if (other) return dniDuplicate(res, other);
        throw error;
      }
      const summary = [name !== undefined ? 'nombre de usuario' : null, changed.length ? profileChangeSummary(changed, profile) : null].filter(Boolean).join(', ');
      audit(req, 'admin.member.profile_update', { user: admin, target: getUserById(user.id), summary: 'Cambió: ' + summary });
    }
    json(res, 200, { profile: profileView(getUserById(user.id), getMemberProfile(user.id)) });
  },

  // Código para que el socio de una ficha cree su passkey. Se muestra una sola vez.
  'POST /api/admin/users/:userId/link-code': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const user = getUserById(userIdFromPath(req));
    if (!user) return json(res, 404, { error: 'El usuario no existe' });
    if (user.disabled) return json(res, 409, { error: 'El socio está desactivado' });
    if (countCredentials(user.id) > 0) return json(res, 409, { error: 'El socio ya tiene acceso a la app' });
    let code;
    let codeHash;
    do {
      code = formatLinkCode(n => crypto.randomInt(0, n));
      codeHash = sha256(code);
    } while (getLinkCodeByHash(codeHash));
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS).toISOString();
    issueLinkCode({ userId: user.id, codeHash, createdBy: admin.id, expiresAt });
    audit(req, 'admin.member.link_code', { user: admin, target: user, summary: `Vence ${expiresAt.slice(0, 16).replace('T', ' ')} UTC` });
    json(res, 200, { code, link: ORIGIN.replace(/\/+$/, '') + '/?link=' + code, expiresAt });
  },

  'DELETE /api/admin/users/:userId/link-code': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const user = getUserById(userIdFromPath(req));
    if (!user) return json(res, 404, { error: 'El usuario no existe' });
    const revoked = revokeLinkCodes(user.id);
    if (revoked) audit(req, 'admin.member.link_code_revoke', { user: admin, target: user });
    json(res, 200, { ok: true, revoked });
  },

  // Une una ficha a la cuenta con app de la misma persona. dry_run: qué pasaría, sin escribir.
  'POST /api/admin/users/:userId/merge': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const fichaId = userIdFromPath(req);
    const body = await readBody(req);
    const targetId = typeof body.targetId === 'string' ? body.targetId.trim() : '';
    if (!targetId) return json(res, 400, { error: 'targetId es obligatorio' });
    const keepBilling = body.keepBilling ?? null;
    if (keepBilling !== null && keepBilling !== 'ficha' && keepBilling !== 'cuenta') return json(res, 400, { error: "keepBilling debe ser 'ficha' o 'cuenta'" });
    const dryRun = body.dry_run === true;
    const out = mergeMember({ fichaId, targetId, keepBilling, dryRun });
    if (out.error) {
      const [status, message] = MERGE_ERRORS[out.error];
      return json(res, status, { error: out.error, message, ...(out.plan ? { preview: out.plan } : {}) });
    }
    if (dryRun) return json(res, 200, { dry_run: true, ...out.plan });
    const r = out.result;
    const lostTotal = Object.values(r.lost).reduce((a, b) => a + b, 0);
    audit(req, 'admin.member.merge', {
      user: admin,
      target: { id: r.target.id, name: r.target.name },
      summary: [`Ficha ${r.ficha.name}`, `${r.payments} pagos`, r.billing.ficha || r.billing.cuenta ? `plan de la ${r.billing.keep}` : null, lostTotal ? `${lostTotal} datos descartados` : null].filter(Boolean).join(' · ')
    });
    json(res, 200, { ok: true, ...r });
  },

  'GET /api/admin/invites': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const allInvites = getAllInvites();
    const invites = allInvites.map(i => {
      const usedBy = i.used_by || i.usedBy;
      const u = usedBy ? getUserById(usedBy) : null;
      return {
        code: i.code,
        note: i.note,
        createdBy: i.created_by || i.createdBy,
        created: i.created_at || i.created,
        usedBy: usedBy || null,
        usedAt: i.used_at || i.usedAt || null,
        revoked: !!i.revoked,
        usedByName: u ? u.name : null
      };
    });
    json(res, 200, { invites, invite_only: INVITE_ONLY });
  },

  'POST /api/admin/invites/new': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    let code;
    do { code = crypto.randomBytes(8).toString('hex').toUpperCase(); } while (getInviteByCode(code));
    const invite = { code, note: String(body.note || '').slice(0, 60), createdBy: admin.id, created: new Date().toISOString() };
    createInvite(invite);
    // saveDb(); // Eliminado: SQLite persiste automáticamente
    audit(req, 'admin.invite.create', { user: admin, msg: code });
    json(res, 200, { invite });
  },

  'POST /api/admin/invites/revoke': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const inv = getInviteByCode(String(body.code || '').toUpperCase());
    if (!inv) return json(res, 404, { error: 'no such code' });
    if (inv.used_by || inv.usedBy) return json(res, 400, { error: 'already used — cannot revoke' });
    deleteInvite(inv.code);
    // saveDb(); // Eliminado: SQLite persiste automáticamente
    audit(req, 'admin.invite.revoke', { user: admin, msg: inv.code });
    json(res, 200, { ok: true });
  },

  'POST /api/admin/push': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const titulo = String(body.titulo || '').trim();
    const texto = String(body.texto || '').trim();
    if (!titulo || !texto) return json(res, 400, { error: 'titulo and texto required' });
    if (titulo.length > 50) return json(res, 400, { error: 'titulo exceeds 50 characters' });
    if (texto.length > 120) return json(res, 400, { error: 'texto exceeds 120 characters' });

    let redirectUrl = body.redirectUrl ? String(body.redirectUrl).trim() : null;
    if (redirectUrl) {
      try {
        const u = new URL(redirectUrl);
        if (!['http:', 'https:'].includes(u.protocol)) throw new Error('invalid protocol');
      } catch {
        return json(res, 400, { error: 'invalid redirectUrl' });
      }
    }

    const rawSubs = getAllSubscriptions();
    if (!rawSubs.length) return json(res, 200, { ok: true, sent: 0 });

    const payload = {
      title: titulo,
      body: texto,
      tag: 'admin-custom',
      data: {
        redirectUrl: redirectUrl
      }
    };

    const payloadStr = JSON.stringify(payload);
    let sent = 0;
    for (const s of rawSubs) {
      try {
        await sendPushToSubscription(s, payloadStr);
        sent++;
      } catch (e) {
        console.error('admin push send failed', s.endpoint, e.statusCode, e.body || e.message);
      }
    }

    audit(req, 'admin.push.send', { user: admin, msg: titulo, sent });
    json(res, 200, { ok: true, sent });
  },

  /* ---------- activity log ---------- */
  'GET /api/admin/audit': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const q = new URL(req.url, 'http://x').searchParams;
    const limit = Math.max(1, Math.min(200, +q.get('limit') || 100));
    const before = +q.get('before') || Infinity;
    const cat = q.get('cat') || '';
    let rows = auditKeep(auditLines()).reverse();
    if (cat === 'fail') rows = rows.filter(r => !r.ok);
    else if (cat === 'admin') rows = rows.filter(r => String(r.ev).startsWith('admin.') || String(r.ev).startsWith('owner.'));
    else if (cat) rows = rows.filter(r => String(r.ev).startsWith(cat + '.'));
    const page = rows.filter(r => r.id < before).slice(0, limit);
    json(res, 200, {
      events: page,
      total: rows.length,
      nextBefore: page.length === limit ? page[page.length - 1].id : null,
      enabled: AUDIT_ON, ip_mode: AUDIT_IP,
      retention: { max: AUDIT_MAX, days: AUDIT_DAYS },
      now: Date.now()
    });
  },

  'POST /api/admin/audit/clear': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    try { fs.unlinkSync(auditFile); } catch { /* nothing logged yet */ }
    auditCount = 0;
    audit(req, 'admin.audit.clear', { user: admin });
    json(res, 200, { ok: true });
  }
};

http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (origin) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'Access-Control-Max-Age': '86400'
    });
    return res.end();
  }
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' && url.pathname.startsWith('/api/share/plan/')) {
    if (!rateLimit(res, ipRateKey(req, 'GET /api/share/plan/:code'), RATE_LIMIT_SHARE_MAX)) return;
    const code = url.pathname.replace('/api/share/plan/', '').trim().toUpperCase();
    const item = sharedPlans.get(code);
    if (!item || Date.now() > item.expiresAt) {
      if (item) sharedPlans.delete(code);
      return json(res, 404, { error: 'code not found or expired' });
    }
    return json(res, 200, item.data);
  }

  const key = req.method + ' ' + url.pathname;
  const routeKey = req.method === 'DELETE' && /^\/api\/comidas\/grupo\/[^/]+$/.test(url.pathname)
    ? 'DELETE /api/comidas/grupo/:grupo_id'
    : req.method === 'DELETE' && /^\/api\/comidas\/[^/]+$/.test(url.pathname)
    ? 'DELETE /api/comidas/:id'
    : req.method === 'GET' && /^\/api\/alimentos\/codigo\/[^/]+$/.test(url.pathname)
      ? 'GET /api/alimentos/codigo/:codigo'
    : req.method === 'PUT' && /^\/api\/plantillas\/[^/]+$/.test(url.pathname)
      ? 'PUT /api/plantillas/:id'
    : req.method === 'DELETE' && /^\/api\/plantillas\/[^/]+$/.test(url.pathname)
      ? 'DELETE /api/plantillas/:id'
    : req.method === 'GET' && /^\/api\/admin\/users\/[^/]+\/nutrition$/.test(url.pathname)
      ? 'GET /api/admin/users/:userId/nutrition'
    : req.method === 'PUT' && /^\/api\/admin\/users\/[^/]+\/nutrition\/goals$/.test(url.pathname)
      ? 'PUT /api/admin/users/:userId/nutrition/goals'
    : req.method === 'PUT' && /^\/api\/admin\/users\/[^/]+\/nutrition\/suggestions-limit$/.test(url.pathname)
      ? 'PUT /api/admin/users/:userId/nutrition/suggestions-limit'
    : req.method === 'GET' && /^\/api\/admin\/users\/[^/]+\/nutrition\/suggestions$/.test(url.pathname)
      ? 'GET /api/admin/users/:userId/nutrition/suggestions'
    : req.method === 'POST' && /^\/api\/admin\/users\/[^/]+\/nutrition\/suggestions\/custom$/.test(url.pathname)
      ? 'POST /api/admin/users/:userId/nutrition/suggestions/custom'
    : req.method === 'POST' && /^\/api\/admin\/users\/[^/]+\/nutrition\/suggestions$/.test(url.pathname)
      ? 'POST /api/admin/users/:userId/nutrition/suggestions'
    : req.method === 'PUT' && /^\/api\/admin\/users\/[^/]+\/nutrition\/suggestions\/[^/]+$/.test(url.pathname)
      ? 'PUT /api/admin/users/:userId/nutrition/suggestions/:id'
    : req.method === 'PATCH' && /^\/api\/admin\/users\/[^/]+\/nutrition\/suggestions\/[^/]+$/.test(url.pathname)
      ? 'PATCH /api/admin/users/:userId/nutrition/suggestions/:id'
    : req.method === 'DELETE' && /^\/api\/admin\/users\/[^/]+\/nutrition\/suggestions\/[^/]+$/.test(url.pathname)
      ? 'DELETE /api/admin/users/:userId/nutrition/suggestions/:id'
    : req.method === 'GET' && /^\/api\/admin\/users\/[^/]+\/routines$/.test(url.pathname)
      ? 'GET /api/admin/users/:userId/routines'
    : req.method === 'PUT' && /^\/api\/admin\/users\/[^/]+\/routines$/.test(url.pathname)
      ? 'PUT /api/admin/users/:userId/routines'
    : req.method === 'PUT' && /^\/api\/admin\/users\/[^/]+\/injuries$/.test(url.pathname)
      ? 'PUT /api/admin/users/:userId/injuries'
    : req.method === 'POST' && /^\/api\/admin\/users\/[^/]+\/injuries\/exercise-warning-override$/.test(url.pathname)
      ? 'POST /api/admin/users/:userId/injuries/exercise-warning-override'
    : req.method === 'PUT' && /^\/api\/admin\/billing\/plans\/[^/]+$/.test(url.pathname)
      ? 'PUT /api/admin/billing/plans/:id'
    : (req.method === 'GET' || req.method === 'PUT') && /^\/api\/admin\/users\/[^/]+\/billing$/.test(url.pathname)
      ? req.method + ' /api/admin/users/:userId/billing'
    : req.method === 'POST' && /^\/api\/admin\/users\/[^/]+\/payments$/.test(url.pathname)
      ? 'POST /api/admin/users/:userId/payments'
    : req.method === 'POST' && /^\/api\/admin\/users\/[^/]+\/trial$/.test(url.pathname)
      ? 'POST /api/admin/users/:userId/trial'
    : req.method === 'POST' && /^\/api\/admin\/users\/[^/]+\/payments\/\d+\/void$/.test(url.pathname)
      ? 'POST /api/admin/users/:userId/payments/:paymentId/void'
    : (req.method === 'GET' || req.method === 'PUT') && /^\/api\/admin\/users\/[^/]+\/profile$/.test(url.pathname)
      ? req.method + ' /api/admin/users/:userId/profile'
    : (req.method === 'POST' || req.method === 'DELETE') && /^\/api\/admin\/users\/[^/]+\/link-code$/.test(url.pathname)
      ? req.method + ' /api/admin/users/:userId/link-code'
    : req.method === 'POST' && /^\/api\/admin\/users\/[^/]+\/merge$/.test(url.pathname)
      ? 'POST /api/admin/users/:userId/merge'
    : req.method === 'PUT' && /^\/api\/admin\/nutrition\/templates\/[^/]+$/.test(url.pathname)
      ? 'PUT /api/admin/nutrition/templates/:id'
    : req.method === 'DELETE' && /^\/api\/admin\/nutrition\/templates\/[^/]+$/.test(url.pathname)
      ? 'DELETE /api/admin/nutrition/templates/:id'
    : key;

  // Cupo por IP; los cupos por credencial / usuario van en cada handler.
  const rateLimitMax = RATE_LIMITS_BY_IP[routeKey];
  if (rateLimitMax && !rateLimit(res, ipRateKey(req, routeKey), rateLimitMax)) return;

  // Verificar expiración de licencia por fecha (si está configurada y vencida)
  // Excluimos /api/health para que monitores o chequeos básicos puedan seguir funcionando si es necesario, 
  // pero endpoints protegidos / login / /api/me devuelven license_expired.
  if (LICENSE_EXPIRES_AT && Date.now() > LICENSE_EXPIRES_AT && url.pathname.startsWith('/api/') && url.pathname !== '/api/health' && url.pathname !== '/api/support' && url.pathname !== '/api/privacy') {
    return json(res, 403, { error: 'license_expired' });
  }

  // Bloqueo por cuota (Cuotas v1). Sin sesión sigue al handler, que responde 401 como siempre.
  if (MEMBERSHIP_GATED.has(routeKey) && isMembershipBlocked(readSession(req))) {
    return json(res, 403, { error: 'membership_blocked' });
  }

  const handler = routes[routeKey];
  if (!handler) return json(res, 404, { error: 'not found' });
  if (!csrfOk(req, routeKey)) {
    console.warn('refused cross-origin', routeKey, 'origin=' + req.headers.origin, 'expected=' + ORIGIN);
    return json(res, 403, { error: 'cross-origin request refused' });
  }
  try { await handler(req, res); }
  catch (e) {
    console.error(routeKey, e);
    if (!res.headersSent) json(res, 500, { error: 'server error' });
  }
}).listen(PORT, () => {
  console.log(`gym-api on :${PORT} (rpID=${RP_ID}, origin=${ORIGIN})`);
  startScheduler();
});
