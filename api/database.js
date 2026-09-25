/**
 * Capa de acceso a datos SQLite para openGym
 * Reemplaza las operaciones que antes usaban db.json + state-<uid>.json
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { setRowValues, setFromRow, workoutMeta, validateWorkouts, decodeMeta } from './row-meta.js';

const DATA = process.env.DATA_DIR || '/data';
const dbPath = path.join(DATA, 'gym.db');
const schemaPath = fileURLToPath(new URL('./schema.sql', import.meta.url));

let db;

export function initDatabase() {
  if (db?.isOpen) db.close();
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  // Migraciones adicionales si faltan columnas en bases existentes
  try {
    db.exec(`ALTER TABLE users ADD COLUMN last_reminder_sent_date TEXT;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE users ADD COLUMN last_fee_reminder_sent_date TEXT;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE users ADD COLUMN owner INTEGER NOT NULL DEFAULT 0;`);
  } catch {}
  // sv: versión de sesión (POST /api/logout/all la incrementa). invited_by: código de invite
  // con el que se registró.
  try { db.exec(`ALTER TABLE users ADD COLUMN sv INTEGER NOT NULL DEFAULT 0;`); } catch {}
  try { db.exec(`ALTER TABLE users ADD COLUMN invited_by TEXT;`); } catch {}
  try {
    db.exec(`ALTER TABLE routine_exercises ADD COLUMN progression_type TEXT;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE routine_exercises ADD COLUMN progression_config TEXT;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE preset_exercises ADD COLUMN progression_type TEXT;`);
  } catch {}
  try { db.exec(`ALTER TABLE presets ADD COLUMN group_name TEXT NOT NULL DEFAULT 'General';`); } catch {}
  try { db.exec(`ALTER TABLE presets ADD COLUMN planned_day INTEGER;`); } catch {}
  try {
    db.exec(`ALTER TABLE preset_exercises ADD COLUMN progression_config TEXT;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE user_state ADD COLUMN progression_type TEXT;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE user_state ADD COLUMN progression_config TEXT;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE comidas_registradas ADD COLUMN grupo_id TEXT;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE comidas_registradas ADD COLUMN grupo_nombre TEXT;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE plantillas_comida ADD COLUMN franjas_recomendadas TEXT;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE plantillas_comida ADD COLUMN updated_at INTEGER;`);
  } catch {}
  try {
    db.prepare(`UPDATE plantillas_comida SET updated_at = COALESCE(updated_at, created_at, ?) WHERE updated_at IS NULL`).run(Date.now());
  } catch {}
  try {
    db.exec(`ALTER TABLE plantillas_comida ADD COLUMN scope TEXT NOT NULL DEFAULT 'user';`);
  } catch {}
  try {
    db.exec(`ALTER TABLE plantillas_comida ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE plantillas_comida ADD COLUMN position INTEGER NOT NULL DEFAULT 0;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE plantillas_comida ADD COLUMN assigned_by TEXT;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE plantillas_comida ADD COLUMN source_plantilla_id INTEGER;`);
  } catch {}
  try {
    // scope quedó en el DEFAULT 'user' para las filas sembradas por plantillas_globales.js
    // (nunca lo seteaba). "Global" real siempre fue user_id IS NULL; esto alinea scope con
    // esa realidad para que el filtro por scope='global' sea confiable de acá en adelante.
    db.prepare(`UPDATE plantillas_comida SET scope = 'global' WHERE user_id IS NULL AND scope != 'global'`).run();
  } catch {}

  // Crear tablas principales si no existen
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      admin INTEGER DEFAULT 0,
      owner INTEGER NOT NULL DEFAULT 0,
      disabled INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_reminder_sent_date TEXT,
      last_fee_reminder_sent_date TEXT,
      sv INTEGER NOT NULL DEFAULT 0,
      invited_by TEXT
    );

    CREATE TABLE IF NOT EXISTS user_state (
      user_id TEXT PRIMARY KEY,
      _ts INTEGER,
      unit TEXT,
      rest_sec INTEGER,
      rest_pause_sec INTEGER,
      sound INTEGER,
      keep_awake INTEGER,
      lang TEXT,
      theme TEXT,
      accent TEXT,
      body TEXT,
      genero TEXT,
      gif_size TEXT,
      default_intensifier TEXT,
      default_sets INTEGER,
      target_w REAL,
      estado_inicial TEXT,
      onboarding_completado INTEGER,
      onboarding_stats_completado INTEGER,
      onboarding_nutrition_completado INTEGER,
      edad INTEGER,
      altura INTEGER,
      objetivo TEXT,
      nivel TEXT,
      peso_kg REAL,
      configuracion TEXT,
      respuestas_encuesta TEXT,
      rutina_generada TEXT,
      fecha_ultima_encuesta TEXT,
      effort TEXT,
      auto_backup INTEGER,
      active_equip_id TEXT,
      equip_filter_on INTEGER,
      routine_groups TEXT,
      active_group_id TEXT,
      sync_versions TEXT,
      nutrition_goals TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS custom_exercises (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      n TEXT NOT NULL,
      tipo TEXT,
      equipamiento TEXT,
      grupo_muscular TEXT,
      bp TEXT,
      eq TEXT,
      tg TEXT,
      mg TEXT,
      sm TEXT,
      st TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS public_custom_exercises (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at INTEGER NOT NULL);
  `);

  // Los tests y las bases nuevas necesitan también las tablas secundarias del schema.
  db.exec(fs.readFileSync(schemaPath, 'utf8'));
  // Catch-all de campos sin columna propia (ver row-meta.js). Va después del schema para que
  // también corra en bases nuevas; en ellas la columna ya viene del CREATE y el ALTER falla
  // en silencio, igual que en una base que ya migró.
  try { db.exec(`ALTER TABLE workout_sets ADD COLUMN meta TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE workouts ADD COLUMN meta TEXT;`); } catch {}
  // Cuotas v1: anular pagos. payments ya existe acá (lo crea schema.sql), así que estos ALTER
  // van después del schema; en una base nueva fallan en silencio porque el CREATE los trae.
  for (const col of ['previous_due_date TEXT', 'previous_plan_id INTEGER', 'previous_trial_until TEXT', 'voided_at INTEGER', 'voided_by TEXT', 'void_reason TEXT']) {
    try { db.exec(`ALTER TABLE payments ADD COLUMN ${col};`); } catch {}
  }
  // invites también viene de schema.sql: mismos ALTER después del schema.
  try { db.exec(`ALTER TABLE invites ADD COLUMN note TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE invites ADD COLUMN used_at TEXT;`); } catch {}
  // Fichas de socio: columnas agregadas después de la primera versión de las tablas.
  try { db.exec(`ALTER TABLE member_profile ADD COLUMN full_name TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE member_profile ADD COLUMN phone_norm TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE link_codes ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;`); } catch {}
  // Prueba gratis: último día de la prueba (se borra con el primer pago) y cuándo la usó la
  // persona (queda para siempre: una prueba por DNI).
  try { db.exec(`ALTER TABLE member_billing ADD COLUMN trial_until TEXT;`); } catch {}
  try { db.exec(`ALTER TABLE member_profile ADD COLUMN trial_used_at INTEGER;`); } catch {}
  db.exec(`CREATE TABLE IF NOT EXISTS sync_operations (
    user_id TEXT NOT NULL,
    op_id TEXT NOT NULL,
    result_json TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, op_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS admin_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );`);
  db.exec(`CREATE TABLE IF NOT EXISTS admin_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    actor_user_id TEXT NOT NULL,
    target_user_id TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_id TEXT,
    before_json TEXT,
    after_json TEXT,
    created_at INTEGER NOT NULL
  );`);

  // Enforce the single-owner invariant at the database level after all base tables exist.
  try {
    db.exec(`UPDATE users SET owner = 0 WHERE owner IS NULL OR owner <> 1;`);
    const firstOwner = db.prepare('SELECT id FROM users WHERE owner = 1 ORDER BY created_at, id LIMIT 1').get();
    if (firstOwner) {
      db.prepare('UPDATE users SET owner = 0 WHERE owner = 1 AND id <> ?').run(firstOwner.id);
      db.prepare('UPDATE users SET admin = 1 WHERE id = ?').run(firstOwner.id);
    }
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_owner ON users(owner) WHERE owner = 1;`);
  } catch (error) {
    console.error('Failed to enforce users.owner uniqueness:', error);
    throw error;
  }

  // Migración defensiva: asegurar que existan todas las columnas de la encuesta en bases de datos existentes
  const columnsToAdd = [
    ['edad', 'INTEGER'],
    ['altura', 'INTEGER'],
    ['objetivo', 'TEXT'],
    ['grasa_corporal', 'REAL'],
    ['nivel', 'TEXT'],
    ['peso_kg', 'REAL'],
    ['configuracion', 'TEXT'],
    ['respuestas_encuesta', 'TEXT'],
    ['rutina_generada', 'TEXT'],
    ['fecha_ultima_encuesta', 'TEXT'],
    ['effort', 'TEXT'],
    ['auto_backup', 'INTEGER'],
    ['active_equip_id', 'TEXT'],
    ['equip_filter_on', 'INTEGER'],
    ['onboarding_completado', 'INTEGER'],
    ['onboarding_stats_completado', 'INTEGER'],
    ['onboarding_nutrition_completado', 'INTEGER'],
    ['progression_type', 'TEXT'],
    ['progression_config', 'TEXT'],
    ['routine_groups', 'TEXT'],
    ['active_group_id', 'TEXT'],
    ['genero', 'TEXT'],
    ['gif_size', 'TEXT'],
    ['default_intensifier', 'TEXT'],
    ['default_sets', 'INTEGER'],
    ['sync_versions', 'TEXT'],
    ['nutrition_goals', 'TEXT']
  ];

  for (const [col, type] of columnsToAdd) {
    try {
      db.exec(`ALTER TABLE user_state ADD COLUMN ${col} ${type};`);
    } catch {
      // Si la columna ya existe, SQLite lanzará error y se ignora de forma segura
    }
  }

  try {
    db.exec(`ALTER TABLE custom_exercises ADD COLUMN tipo TEXT;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE custom_exercises ADD COLUMN equipamiento TEXT;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE custom_exercises ADD COLUMN grupo_muscular TEXT;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE workouts ADD COLUMN partial INTEGER DEFAULT 0;`);
  } catch {}

  return db;
}

export function closeDatabase() {
  if (db?.isOpen) db.close();
  db = undefined;
}

export function getDatabase() {
  if (!db) {
    db = initDatabase();
  }
  return db;
}

// ============================================================
// Operaciones de usuarios
// ============================================================

export function getAllUsers() {
  const stmt = getDatabase().prepare('SELECT * FROM users');
  return stmt.all();
}

export function getUserById(id) {
  const stmt = getDatabase().prepare('SELECT * FROM users WHERE id = ?');
  return stmt.get(id);
}

// users.created_at se guarda como string ISO. Bases viejas pueden tener ms, segundos o el
// 'YYYY-MM-DD HH:MM:SS' (UTC) del DEFAULT CURRENT_TIMESTAMP: esto los lleva a ISO para la
// API sin migrar datos. Devuelve null si el valor falta o no se puede interpretar.
export function isoTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  let ms;
  if (typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value))) {
    const n = Number(value);
    ms = n < 1e11 ? n * 1000 : n;
  } else {
    const s = String(value);
    ms = Date.parse(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(s) ? s.replace(' ', 'T') + 'Z' : s);
  }
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

// user.member: ficha de socio creada por un admin; nunca admin ni owner, aunque sea la primera fila.
export function createUser(user) {
  const db = getDatabase();
  const isFirstUser = !user.member && Number(db.prepare('SELECT COUNT(*) AS count FROM users').get().count) === 0;
  const owner = user.member ? 0 : isFirstUser ? 1 : (user.owner ? 1 : 0);
  const admin = user.member ? 0 : owner ? 1 : (user.admin ? 1 : 0);
  if (owner) db.prepare('UPDATE users SET owner = 0 WHERE owner = 1').run();
  const stmt = getDatabase().prepare(`
    INSERT INTO users (id, name, admin, owner, disabled, created_at, invited_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(user.id, user.name, admin, owner, user.disabled ? 1 : 0,
    isoTimestamp(user.created) || new Date().toISOString(), user.invitedBy || null);
}

export function updateUser(id, updates) {
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(updates)) {
    if (key === 'admin' || key === 'owner' || key === 'disabled') {
      fields.push(`${key} = ?`);
      values.push(value ? 1 : 0);
    } else {
      fields.push(`${key} = ?`);
      values.push(value);
    }
  }
  if (fields.length === 0) return;
  values.push(id);
  const stmt = getDatabase().prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`);
  stmt.run(...values);
}

// Permanent account deletion. Keep the operation transactional because invites reference
// users without ON DELETE CASCADE, while the rest of the user's data cascades from users.id.
// inTransaction: the caller already opened the transaction (merge de fichas) and owns the
// COMMIT/ROLLBACK; a failure here just throws so the caller rolls everything back.
export function deleteUser(id, { inTransaction = false } = {}) {
  const db = getDatabase();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return null;

  const run = () => {
    db.prepare('DELETE FROM invites WHERE created_by = ? OR used_by = ?').run(id, id);
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
    if (result.changes !== 1) throw new Error('user deletion did not affect exactly one row');
  };
  if (inTransaction) { run(); return user; }

  db.exec('BEGIN IMMEDIATE');
  try {
    run();
    db.exec('COMMIT');
    return user;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

// ============================================================
// Operaciones de credenciales
// ============================================================

export function getCredentialById(id) {
  const stmt = getDatabase().prepare('SELECT * FROM credentials WHERE id = ?');
  return stmt.get(id);
}

export function getCredentialsByUserId(userId) {
  const stmt = getDatabase().prepare('SELECT * FROM credentials WHERE user_id = ?');
  return stmt.all(userId);
}

export function createCredential(cred) {
  const stmt = getDatabase().prepare(`
    INSERT INTO credentials (id, user_id, public_key, counter, transports, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    cred.id,
    cred.userId,
    cred.publicKey,
    cred.counter || 0,
    cred.transports ? JSON.stringify(cred.transports) : null,
    cred.created || Date.now()
  );
}

export function updateCredentialCounter(id, counter) {
  const stmt = getDatabase().prepare('UPDATE credentials SET counter = ? WHERE id = ?');
  stmt.run(counter, id);
}

// ============================================================
// Operaciones de suscripciones
// ============================================================

export function getSubscriptionsByUserId(userId) {
  const stmt = getDatabase().prepare('SELECT * FROM subscriptions WHERE user_id = ?');
  return stmt.all(userId);
}

export function getAllSubscriptions() {
  const stmt = getDatabase().prepare('SELECT * FROM subscriptions');
  return stmt.all();
}

export function createSubscription(sub) {
  const stmt = getDatabase().prepare(`
    INSERT OR REPLACE INTO subscriptions (endpoint, user_id, keys, created_at)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(
    sub.endpoint,
    sub.userId,
    JSON.stringify(sub.keys),
    sub.created || Date.now()
  );
}

export function deleteSubscription(endpoint) {
  const stmt = getDatabase().prepare('DELETE FROM subscriptions WHERE endpoint = ?');
  stmt.run(endpoint);
}

export function deleteSubscriptionsByUserId(userId) {
  const stmt = getDatabase().prepare('DELETE FROM subscriptions WHERE user_id = ?');
  stmt.run(userId);
}

// ============================================================
// Operaciones de invites
// ============================================================

export function getAllInvites() {
  const stmt = getDatabase().prepare('SELECT * FROM invites');
  return stmt.all();
}

export function getInviteByCode(code) {
  const stmt = getDatabase().prepare('SELECT * FROM invites WHERE code = ?');
  return stmt.get(code);
}

export function createInvite(invite) {
  const stmt = getDatabase().prepare(`
    INSERT INTO invites (code, created_by, revoked, created_at, note)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(invite.code, invite.createdBy, invite.revoked ? 1 : 0, invite.created || Date.now(), invite.note || null);
}

export function updateInviteUsedBy(code, userId) {
  const stmt = getDatabase().prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ?');
  stmt.run(userId, new Date().toISOString(), code);
}

export function deleteInvite(code) {
  const stmt = getDatabase().prepare('DELETE FROM invites WHERE code = ?');
  stmt.run(code);
}

// ============================================================
// Operaciones de presets
// ============================================================

export function getAllPresets() {
  const stmt = getDatabase().prepare('SELECT * FROM presets');
  return stmt.all();
}

export function getPresetById(id) {
  const stmt = getDatabase().prepare('SELECT * FROM presets WHERE id = ?');
  return stmt.get(id);
}

export function getPresetWithExercises(id) {
  const presetStmt = getDatabase().prepare('SELECT * FROM presets WHERE id = ?');
  const preset = presetStmt.get(id);
  if (!preset) return null;

  const exStmt = getDatabase().prepare('SELECT * FROM preset_exercises WHERE preset_id = ? ORDER BY id');
  preset.ex = exStmt.all(id).map(row => ({
    id: row.exercise_id,
    sets: row.sets,
    reps: row.reps,
    weight: row.weight,
    mode: row.mode,
    min: row.min,
    speed: row.speed,
    sec: row.sec,
    bodyweight: row.bodyweight ? true : undefined,
    side: row.side ? true : undefined,
    progressionType: row.progression_type || undefined,
    progressionConfig: safeJsonParse(row.progression_config, null)
  }));
  return preset;
}

export function createPreset(preset) {
  const stmt = getDatabase().prepare(`
    INSERT INTO presets (id, name, emoji, group_name, planned_day)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(preset.id, preset.name, preset.emoji, preset.groupName || preset.group_name || 'General', Number.isInteger(preset.plannedDay) ? preset.plannedDay : null);

  const exStmt = getDatabase().prepare(`
    INSERT INTO preset_exercises (preset_id, exercise_id, sets, reps, weight, mode, min, speed, sec, bodyweight, side, progression_type, progression_config)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const ex of preset.ex) {
    exStmt.run(
      preset.id,
      ex.id,
      ex.sets,
      ex.reps || null,
      ex.weight || 0,
      ex.mode || 'reps',
      ex.min || null,
      ex.speed || null,
      ex.sec || null,
      ex.bodyweight ? 1 : 0,
      ex.side ? 1 : 0,
      ex.progressionType || null,
      ex.progressionConfig ? JSON.stringify(ex.progressionConfig) : null
    );
  }
}

export function updatePreset(id, preset) {
  const stmt = getDatabase().prepare('UPDATE presets SET name = ?, emoji = ?, group_name = ?, planned_day = ? WHERE id = ?');
  stmt.run(preset.name, preset.emoji, preset.groupName || preset.group_name || 'General', Number.isInteger(preset.plannedDay) ? preset.plannedDay : null, id);

  // Eliminar ejercicios viejos y insertar nuevos
  const deleteExStmt = getDatabase().prepare('DELETE FROM preset_exercises WHERE preset_id = ?');
  deleteExStmt.run(id);

  const exStmt = getDatabase().prepare(`
    INSERT INTO preset_exercises (preset_id, exercise_id, sets, reps, weight, mode, min, speed, sec, bodyweight, side)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const ex of preset.ex) {
    exStmt.run(
      id,
      ex.id,
      ex.sets,
      ex.reps || null,
      ex.weight || 0,
      ex.mode || 'reps',
      ex.min || null,
      ex.speed || null,
      ex.sec || null,
      ex.bodyweight ? 1 : 0,
      ex.side ? 1 : 0
    );
  }
}

export function deletePreset(id) {
  const stmt = getDatabase().prepare('DELETE FROM presets WHERE id = ?');
  stmt.run(id);
}

// ============================================================
// Operaciones de estado de usuario
// ============================================================

export function getUserState(userId) {
  const stmt = getDatabase().prepare('SELECT * FROM user_state WHERE user_id = ?');
  const row = stmt.get(userId);
  if (!row) return null;

  // Reconstruir el objeto de estado similar al JSON original
  const S = {
    _ts: row._ts,
    unit: row.unit,
    restSec: row.rest_sec,
    restPauseSec: row.rest_pause_sec,
    sound: row.sound === 1,
    keepAwake: row.keep_awake === 1,
    lang: row.lang,
    theme: row.theme,
    accent: row.accent,
    body: row.body,
    genero: row.genero || (row.body === 'female' ? 'femenino' : 'masculino'),
    gifSize: row.gif_size || 'full',
    defaultIntensifier: safeJsonParse(row.default_intensifier, { type: 'none' }),
    defaultSets: row.default_sets || 3,
    targetW: row.target_w,
    estadoInicial: row.estado_inicial,
    onboardingCompletado: row.onboarding_completado === 1,
    onboardingStatsCompletado: row.onboarding_stats_completado === 1,
    onboardingNutritionCompletado: row.onboarding_nutrition_completado === 1,
    edad: row.edad,
    altura: row.altura,
    objetivo: row.objetivo,
    grasaCorporal: row.grasa_corporal,
    nivel: row.nivel,
    pesoKg: row.peso_kg,
    configuracion: safeJsonParse(row.configuracion),
    respuestasEncuesta: safeJsonParse(row.respuestas_encuesta),
    rutinaGenerada: safeJsonParse(row.rutina_generada),
    fechaUltimaEncuesta: row.fecha_ultima_encuesta,
    effort: row.effort,
    autoBackup: row.auto_backup === 1,
    activeEquipId: row.active_equip_id,
    equipFilterOn: row.equip_filter_on === 1,
    progressionType: row.progression_type || null,
    progressionConfig: safeJsonParse(row.progression_config, null),
    routineGroups: safeJsonParse(row.routine_groups, []),
    activeGroupId: row.active_group_id || null,
    _syncVersions: safeJsonParse(row.sync_versions, {}),
    // Solo lectura para el cliente: se administra vía los endpoints admin (Fase 2),
    // nunca a través de este sync general — saveUserState() ignora este campo del cliente.
    nutritionGoals: getNutritionGoals(userId),
  };

  // Cargar relaciones
  S.routines = getRoutinesByUserId(userId);
  S.week = getWeekPlanByUserId(userId);
  S.dayPlan = getDayPlanByUserId(userId);
  S.workouts = getWorkoutsByUserId(userId);
  S.exWeights = getExerciseWeightsByUserId(userId);
  S.bodyweight = getBodyweightByUserId(userId);
  S.customEx = [...getPublicCustomExercises(), ...getCustomExercisesByUserId(userId)];
  S.exNotes = getExerciseNotesByUserId(userId);
  S.reminder = getReminderSettingsByUserId(userId);
  S.equipProfiles = getEquipProfilesByUserId(userId);

  return S;
}

export function saveUserState(userId, S) {
  const db = getDatabase();
  const validRoutineIds = new Set((S.routines || []).map(r => String(r?.id || '')).filter(Boolean));
  // nutrition_goals is set only through the admin nutrition endpoints, never part of the
  // client's full-state sync payload. INSERT OR REPLACE below would otherwise wipe it back
  // to NULL on every regular sync, so capture and restore it around the replace.
  const existingNutritionGoals = db.prepare('SELECT nutrition_goals FROM user_state WHERE user_id = ?').get(userId)?.nutrition_goals ?? null;

  // Guardar estado principal
  const stateStmt = db.prepare(`
    INSERT OR REPLACE INTO user_state (
      user_id, _ts, unit, rest_sec, rest_pause_sec, sound, keep_awake, lang, theme, accent,
      body, genero, gif_size, default_intensifier, default_sets, target_w, estado_inicial, onboarding_completado, onboarding_stats_completado, onboarding_nutrition_completado, edad, altura, objetivo, grasa_corporal, nivel, peso_kg, configuracion,
      respuestas_encuesta, rutina_generada, fecha_ultima_encuesta, effort, auto_backup,
      active_equip_id, equip_filter_on, progression_type, progression_config
    ) VALUES (
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `);
  stateStmt.run(
    userId,
    S._ts || Date.now(),
    S.unit || 'kg',
    S.restSec || 90,
    S.restPauseSec || 15,
    S.sound ? 1 : 0,
    S.keepAwake ? 1 : 0,
    S.lang || 'es',
    S.theme || 'dark',
    S.accent || 'lime',
    S.body || 'male',
    S.genero || (S.body === 'female' ? 'femenino' : 'masculino'),
    S.gifSize || 'full',
    S.defaultIntensifier ? JSON.stringify(S.defaultIntensifier) : JSON.stringify({ type: 'none' }),
    Number.isFinite(Number(S.defaultSets)) ? Number(S.defaultSets) : 3,
    S.targetW || null,
    S.estadoInicial || 'pendiente',
    S.onboardingCompletado ? 1 : 0,
    S.onboardingStatsCompletado ? 1 : 0,
    S.onboardingNutritionCompletado ? 1 : 0,
    S.edad || null,
    S.altura || null,
    S.objetivo || null,
    S.grasaCorporal || null,
    S.nivel || null,
    S.pesoKg || null,
    S.configuracion ? JSON.stringify(S.configuracion) : null,
    S.respuestasEncuesta ? JSON.stringify(S.respuestasEncuesta) : null,
    S.rutinaGenerada ? JSON.stringify(S.rutinaGenerada) : null,
    S.fechaUltimaEncuesta || null,
    S.effort || null,
    S.autoBackup ? 1 : 0,
    S.activeEquipId || null,
    S.equipFilterOn ? 1 : 0,
    S.progressionType || null,
    S.progressionConfig ? JSON.stringify(S.progressionConfig) : null
  );

  // Guardar rutinas
  saveRoutines(userId, S.routines || []);

  // Guardar week plan
  saveWeekPlan(userId, S.week || {}, validRoutineIds);

  // Guardar day plan
  saveDayPlan(userId, S.dayPlan || {}, validRoutineIds);

  // Guardar workouts
  saveWorkouts(userId, S.workouts || [], validRoutineIds);

  // Guardar exercise weights
  saveExerciseWeights(userId, S.exWeights || {});

  // Guardar bodyweight
  saveBodyweight(userId, S.bodyweight || []);

  // Guardar custom exercises
  saveCustomExercises(userId, S.customEx || []);

  // Guardar exercise notes
  saveExerciseNotes(userId, S.exNotes || {});

  // Guardar reminder settings
  saveReminderSettings(userId, S.reminder);

  // Guardar equipment profiles
  saveEquipProfiles(userId, S.equipProfiles || []);
  saveRoutineGroups(userId, S.routineGroups || [], S.activeGroupId || null);
  db.prepare('UPDATE user_state SET sync_versions = ? WHERE user_id = ?')
    .run(JSON.stringify(S._syncVersions || {}), userId);
  db.prepare('UPDATE user_state SET nutrition_goals = ? WHERE user_id = ?')
    .run(existingNutritionGoals, userId);
}

// ============================================================
// Metas nutricionales manuales (Admin/Owner override; ver Fase 2 del prompt)
// ============================================================

// limitarSugeridas: null = sin preferencia explícita (usa el default derivado de
// NUTRICION_AUTOMATICO, ver limitarSugeridasEfectivo() en server.js), true/false = el admin
// ya tocó el toggle "Limitar comidas sugeridas" para este socio y ese valor gana siempre.
const DEFAULT_NUTRITION_GOALS = { mode: 'automatic', objetivo: null, calories: null, caloriesBurn: null, protein: null, carbs: null, fat: null, limitarSugeridas: null, updatedAt: null, updatedBy: null };

export function getNutritionGoals(userId) {
  const row = getDatabase().prepare('SELECT nutrition_goals FROM user_state WHERE user_id = ?').get(userId);
  const parsed = row ? safeJsonParse(row.nutrition_goals, null) : null;
  return parsed ? { ...DEFAULT_NUTRITION_GOALS, ...parsed } : { ...DEFAULT_NUTRITION_GOALS };
}

export function setNutritionGoals(userId, goals) {
  const db = getDatabase();
  const stamp = Date.now();
  db.prepare(`
    INSERT INTO user_state (user_id, _ts, nutrition_goals) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      nutrition_goals = excluded.nutrition_goals,
      _ts = MAX(COALESCE(user_state._ts, 0), excluded._ts)
  `).run(userId, stamp, JSON.stringify(goals));
}

// El objetivo que el admin fija en metas manuales también es la configuración real del
// socio (mismo campo que edita en Settings y que usa la generación de rutina) — no un
// valor sombra aparte. Bumpea _ts como cualquier escritura normal de perfil para que el
// próximo pull limpio del socio (sin operaciones pendientes) lo traiga sin trato especial.
// Objetivo real efectivo del socio (mismo fallback que frontend/src/lib/nutricion.js), para
// prellenar el selector de metas manuales con lo que el socio ya tiene, no "Sin definir".
export function getUserObjetivo(userId) {
  const row = getDatabase().prepare('SELECT objetivo, respuestas_encuesta FROM user_state WHERE user_id = ?').get(userId);
  if (!row) return 'fitness_general';
  const resp = safeJsonParse(row.respuestas_encuesta, {}) || {};
  return row.objetivo || resp.objetivo || 'fitness_general';
}

export function setUserObjetivo(userId, objetivo) {
  const db = getDatabase();
  const stamp = Date.now();
  db.prepare(`
    INSERT INTO user_state (user_id, objetivo, _ts) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET objetivo = excluded.objetivo, _ts = MAX(user_state._ts, excluded._ts)
  `).run(userId, objetivo, stamp);
}

// ============================================================
// Lesiones (Fase 7 — panel admin, bloque Lesiones de Administrar Rutina)
// Viven dentro de respuestasEncuesta.lesiones (mismo campo que llena el paso 5 de
// SurveyWizard), así que se lee/escribe el resto del blob tal cual para no pisarlo.
// ============================================================

export function getLesiones(userId) {
  const row = getDatabase().prepare('SELECT respuestas_encuesta FROM user_state WHERE user_id = ?').get(userId);
  const resp = row ? safeJsonParse(row.respuestas_encuesta, null) : null;
  return Array.isArray(resp?.lesiones) ? resp.lesiones : [];
}

export function saveLesiones(userId, lesiones) {
  const db = getDatabase();
  const stamp = Date.now();
  const row = db.prepare('SELECT respuestas_encuesta FROM user_state WHERE user_id = ?').get(userId);
  const resp = (row && safeJsonParse(row.respuestas_encuesta, null)) || {};
  resp.lesiones = lesiones;
  db.prepare(`
    INSERT INTO user_state (user_id, _ts, respuestas_encuesta) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      respuestas_encuesta = excluded.respuestas_encuesta,
      _ts = MAX(COALESCE(user_state._ts, 0), excluded._ts)
  `).run(userId, stamp, JSON.stringify(resp));
}

// ============================================================
// Sugerencias de comida asignadas por admin (plantillas_comida scope='admin')
// ============================================================

export function getPlantillaWithIngredientes(id) {
  const db = getDatabase();
  const plantilla = db.prepare('SELECT * FROM plantillas_comida WHERE id = ?').get(id);
  if (!plantilla) return null;
  plantilla.ingredientes = db.prepare('SELECT * FROM plantillas_ingredientes WHERE plantilla_id = ?').all(id);
  return plantilla;
}

export function getAdminSuggestionsByUserId(userId) {
  const db = getDatabase();
  const rows = db.prepare(`SELECT * FROM plantillas_comida WHERE user_id = ? AND scope = 'admin' ORDER BY position, id`).all(userId);
  for (const row of rows) row.ingredientes = db.prepare('SELECT * FROM plantillas_ingredientes WHERE plantilla_id = ?').all(row.id);
  return rows;
}

// ============================================================
// Catálogo global de comidas compuestas (plantillas_comida scope='global', user_id NULL).
// Filas sembradas por plantillas_globales.js (assigned_by NULL) o creadas por un admin desde
// la UI (assigned_by = id del admin). Ver esa distinción también en plantillas_globales.js.
// ============================================================

export function getGlobalTemplates() {
  const db = getDatabase();
  const rows = db.prepare(`SELECT * FROM plantillas_comida WHERE scope = 'global' ORDER BY categoria, nombre`).all();
  for (const row of rows) row.ingredientes = db.prepare('SELECT * FROM plantillas_ingredientes WHERE plantilla_id = ?').all(row.id);
  return rows;
}

export function findGlobalTemplateByNombreCategoria(nombre, categoria, excludeId = null) {
  const db = getDatabase();
  return db.prepare(`SELECT id FROM plantillas_comida WHERE scope = 'global' AND nombre = ? AND categoria = ? AND id != ?`)
    .get(nombre, categoria || '', excludeId ?? -1) || null;
}

export function createGlobalTemplate({ nombre, categoria, franjasRecomendadas, ingredientes, assignedBy }) {
  const db = getDatabase();
  db.exec('BEGIN');
  try {
    const plantillaId = insertPlantillaConIngredientes(db, {
      userId: null, nombre, categoria, scope: 'global', assignedBy, position: 0, ingredientes, franjasRecomendadas
    });
    db.exec('COMMIT');
    return getPlantillaWithIngredientes(plantillaId);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function updateGlobalTemplate(id, { nombre, categoria, franjasRecomendadas, ingredientes }) {
  const db = getDatabase();
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE plantillas_comida SET nombre = ?, categoria = ?, franjas_recomendadas = ?, updated_at = ? WHERE id = ?')
      .run(nombre, categoria || null, JSON.stringify(franjasRecomendadas), Date.now(), id);
    db.prepare('DELETE FROM plantillas_ingredientes WHERE plantilla_id = ?').run(id);
    const stmt = db.prepare(`
      INSERT INTO plantillas_ingredientes (plantilla_id, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of ingredientes) {
      stmt.run(id, String(item.nombre_alimento).trim(), item.cantidad_gramos, item.calorias, item.proteina, item.carbohidratos, item.grasas);
    }
    db.exec('COMMIT');
    return getPlantillaWithIngredientes(id);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// Cuenta a cuántos socios distintos afecta borrar esta plantilla global (asignaciones
// clonadas vía assignExistingPlantillaToUser, que guardan source_plantilla_id).
export function countAssignedUsersForGlobalTemplate(id) {
  const db = getDatabase();
  const row = db.prepare(`SELECT COUNT(DISTINCT user_id) AS c FROM plantillas_comida WHERE scope = 'admin' AND source_plantilla_id = ?`).get(id);
  return row?.c || 0;
}

export function deleteGlobalTemplate(id) {
  getDatabase().prepare(`DELETE FROM plantillas_comida WHERE id = ? AND scope = 'global'`).run(id);
}

function insertPlantillaConIngredientes(db, { userId, nombre, categoria, scope, assignedBy, position, ingredientes, sourcePlantillaId, franjasRecomendadas }) {
  const now = Date.now();
  const result = db.prepare(`
    INSERT INTO plantillas_comida (user_id, nombre, categoria, created_at, updated_at, scope, enabled, position, assigned_by, source_plantilla_id, franjas_recomendadas)
    VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
  `).run(userId, nombre, categoria || null, now, now, scope, position, assignedBy,
    sourcePlantillaId ?? null, franjasRecomendadas ? JSON.stringify(franjasRecomendadas) : null);
  const plantillaId = Number(result.lastInsertRowid);
  const stmt = db.prepare(`
    INSERT INTO plantillas_ingredientes (plantilla_id, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const item of ingredientes) {
    stmt.run(plantillaId, String(item.nombre_alimento).trim(), item.cantidad_gramos, item.calorias, item.proteina, item.carbohidratos, item.grasas);
  }
  return plantillaId;
}

function nextSuggestionPosition(db, userId) {
  const row = db.prepare(`SELECT MAX(position) AS maxPos FROM plantillas_comida WHERE user_id = ? AND scope = 'admin'`).get(userId);
  return (Number.isFinite(row?.maxPos) ? row.maxPos : -1) + 1;
}

// Franjas ya asignadas a este socio para esta plantilla fuente (para bloquear checkboxes
// en el selector de franja del admin y para el chequeo de duplicado del endpoint).
export function getAssignedFranjasForSource(userId, sourcePlantillaId) {
  const db = getDatabase();
  const rows = db.prepare(`SELECT franjas_recomendadas FROM plantillas_comida WHERE user_id = ? AND scope = 'admin' AND source_plantilla_id = ?`).all(userId, sourcePlantillaId);
  const franjas = new Set();
  for (const row of rows) {
    try { (JSON.parse(row.franjas_recomendadas || '[]')).forEach(f => franjas.add(f)); } catch {}
  }
  return [...franjas];
}

// Asigna una plantilla existente (global o de otro socio, visible al admin) clonándola para
// el socio objetivo, en una franja puntual. Nunca reutiliza la fila original: así "quitar" la
// sugerencia después no afecta la plantilla fuente ni a otros socios que la tengan asignada.
// Una fila por franja (regla A.2): permite borrar/mover una franja sin afectar las demás.
export function assignExistingPlantillaToUser(userId, sourcePlantillaId, assignedByUserId, franja) {
  const db = getDatabase();
  const source = getPlantillaWithIngredientes(sourcePlantillaId);
  if (!source) return null;
  if (getAssignedFranjasForSource(userId, sourcePlantillaId).includes(franja)) {
    const error = new Error('Ya asignada a esa franja');
    error.code = 'DUPLICATE_FRANJA';
    throw error;
  }
  db.exec('BEGIN');
  try {
    const plantillaId = insertPlantillaConIngredientes(db, {
      userId, nombre: source.nombre, categoria: source.categoria, scope: 'admin',
      assignedBy: assignedByUserId, position: nextSuggestionPosition(db, userId), ingredientes: source.ingredientes,
      sourcePlantillaId, franjasRecomendadas: [franja]
    });
    db.exec('COMMIT');
    return getPlantillaWithIngredientes(plantillaId);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function createCustomSuggestionForUser(userId, { nombre, categoria, ingredientes }, assignedByUserId) {
  const db = getDatabase();
  db.exec('BEGIN');
  try {
    const plantillaId = insertPlantillaConIngredientes(db, {
      userId, nombre, categoria, scope: 'admin', assignedBy: assignedByUserId,
      position: nextSuggestionPosition(db, userId), ingredientes
    });
    db.exec('COMMIT');
    return getPlantillaWithIngredientes(plantillaId);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function updateAdminSuggestion(id, { nombre, categoria, ingredientes, position }) {
  const db = getDatabase();
  db.exec('BEGIN');
  try {
    if (Number.isInteger(position)) {
      db.prepare('UPDATE plantillas_comida SET nombre = ?, categoria = ?, updated_at = ?, position = ? WHERE id = ?')
        .run(nombre, categoria || null, Date.now(), position, id);
    } else {
      db.prepare('UPDATE plantillas_comida SET nombre = ?, categoria = ?, updated_at = ? WHERE id = ?')
        .run(nombre, categoria || null, Date.now(), id);
    }
    db.prepare('DELETE FROM plantillas_ingredientes WHERE plantilla_id = ?').run(id);
    const stmt = db.prepare(`
      INSERT INTO plantillas_ingredientes (plantilla_id, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const item of ingredientes) {
      stmt.run(id, String(item.nombre_alimento).trim(), item.cantidad_gramos, item.calorias, item.proteina, item.carbohidratos, item.grasas);
    }
    db.exec('COMMIT');
    return getPlantillaWithIngredientes(id);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function setSuggestionEnabled(id, enabled) {
  getDatabase().prepare('UPDATE plantillas_comida SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, Date.now(), id);
}

// Desasigna (borra) la sugerencia clonada del socio. Como cada sugerencia asignada es su
// propia fila (ver assignExistingPlantillaToUser), esto nunca toca plantillas scope='global'.
export function removeAdminSuggestion(id) {
  getDatabase().prepare('DELETE FROM plantillas_comida WHERE id = ?').run(id);
}

// ============================================================
// Auditoría de acciones administrativas (admin_audit_log; ver Fase 8 del prompt)
// ============================================================

export function logAdminAction({ actorUserId, targetUserId, action, entityId = null, before = null, after = null }) {
  getDatabase().prepare(`
    INSERT INTO admin_audit_log (actor_user_id, target_user_id, action, entity_id, before_json, after_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(actorUserId, targetUserId, action, entityId != null ? String(entityId) : null,
    before != null ? JSON.stringify(before) : null, after != null ? JSON.stringify(after) : null, Date.now());
}

// ============================================================
// Operaciones de rutinas
// ============================================================

export function getRoutinesByUserId(userId) {
  const stmt = getDatabase().prepare('SELECT * FROM routines WHERE user_id = ?');
  const routines = stmt.all(userId);

  for (const routine of routines) {
    const exStmt = getDatabase().prepare('SELECT * FROM routine_exercises WHERE routine_id = ? ORDER BY position');
    routine.ex = exStmt.all(routine.id).map(row => ({
      id: row.exercise_id,
      sg: row.sg,
      sets: row.sets,
      reps: row.reps,
      weight: row.weight,
      mode: row.mode,
      min: row.min,
      speed: row.speed,
      sec: row.sec,
      bodyweight: row.bodyweight ? true : undefined,
      side: row.side ? true : undefined,
      note: row.note,
      progressionType: row.progression_type || undefined,
      progressionConfig: safeJsonParse(row.progression_config, null)
    }));
  }

  return routines;
}

export function getRoutineGroups(userId) {
  const row = getDatabase().prepare('SELECT routine_groups, active_group_id FROM user_state WHERE user_id = ?').get(userId) || {};
  return { routineGroups: safeJsonParse(row.routine_groups, []), activeGroupId: row.active_group_id || null };
}

export function saveRoutineGroups(userId, routineGroups, activeGroupId) {
  const stamp = Date.now();
  getDatabase().prepare(`
    INSERT INTO user_state (user_id, _ts, routine_groups, active_group_id) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      routine_groups = excluded.routine_groups,
      active_group_id = excluded.active_group_id,
      _ts = MAX(COALESCE(user_state._ts, 0), excluded._ts)
  `).run(userId, stamp, JSON.stringify(routineGroups || []), activeGroupId || null);
}

export function saveRoutines(userId, routines) {
  const db = getDatabase();

  db.prepare(`
    INSERT INTO user_state (user_id, _ts) VALUES (?, ?)
    ON CONFLICT(user_id) DO NOTHING
  `).run(userId, Date.now());

  // Eliminar rutinas viejas
  const deleteStmt = db.prepare('DELETE FROM routines WHERE user_id = ?');
  deleteStmt.run(userId);

  const routineStmt = db.prepare(`
    INSERT INTO routines (id, user_id, name, emoji, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  const exStmt = db.prepare(`
    INSERT INTO routine_exercises (routine_id, exercise_id, position, sg, sets, reps, weight, mode, min, speed, sec, bodyweight, side, note, progression_type, progression_config)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const routine of routines) {
    routineStmt.run(routine.id, userId, routine.name, routine.emoji || 'dumbbell', routine.created || Date.now());
    for (let i = 0; i < (routine.ex || []).length; i++) {
      const ex = routine.ex[i];
      exStmt.run(
        routine.id,
        ex.id,
        i,
        ex.sg ?? null,
        ex.sets || null,
        ex.reps || null,
        ex.weight ?? null,
        ex.mode || 'reps',
        ex.min || null,
        ex.speed || null,
        ex.sec || null,
        ex.bodyweight ? 1 : 0,
        ex.side ? 1 : 0,
        ex.note || null,
        ex.progressionType || null,
        ex.progressionConfig ? JSON.stringify(ex.progressionConfig) : null
      );
    }
  }
}

// ============================================================
// Operaciones de week plan
// ============================================================

export function getWeekPlanByUserId(userId) {
  const stmt = getDatabase().prepare('SELECT * FROM week_plan WHERE user_id = ?');
  const rows = stmt.all(userId);
  const week = {};
  for (const row of rows) {
    week[row.day_index] = row.routine_id;
  }
  return week;
}

export function saveWeekPlan(userId, week, validRoutineIds = null) {
  const db = getDatabase();
  const deleteStmt = db.prepare('DELETE FROM week_plan WHERE user_id = ?');
  deleteStmt.run(userId);

  const stmt = db.prepare('INSERT INTO week_plan (user_id, day_index, routine_id) VALUES (?, ?, ?)');
  for (const [dayIndex, routineId] of Object.entries(week)) {
    const nextRoutineId = validRoutineIds && routineId ? (validRoutineIds.has(String(routineId)) ? String(routineId) : null) : (routineId || null);
    stmt.run(userId, parseInt(dayIndex), nextRoutineId);
  }
}

// ============================================================
// Operaciones de day plan
// ============================================================

export function getDayPlanByUserId(userId) {
  const stmt = getDatabase().prepare('SELECT * FROM day_plan WHERE user_id = ?');
  const rows = stmt.all(userId);
  const dayPlan = {};
  for (const row of rows) {
    dayPlan[row.date] = row.routine_id;
  }
  return dayPlan;
}

export function saveDayPlan(userId, dayPlan, validRoutineIds = null) {
  const db = getDatabase();
  const deleteStmt = db.prepare('DELETE FROM day_plan WHERE user_id = ?');
  deleteStmt.run(userId);

  const stmt = db.prepare('INSERT INTO day_plan (user_id, date, routine_id) VALUES (?, ?, ?)');
  for (const [date, routineId] of Object.entries(dayPlan)) {
    const nextRoutineId = validRoutineIds && routineId ? (validRoutineIds.has(String(routineId)) ? String(routineId) : null) : (routineId || null);
    stmt.run(userId, date, nextRoutineId);
  }
}

// ============================================================
// Operaciones de workouts
// ============================================================

function safeJsonParse(val, fallback = null) {
  if (!val || typeof val !== 'string') return fallback;
  try {
    return JSON.parse(val);
  } catch {
    return fallback;
  }
}

// Orden cronológico, como el cliente agrega los workouts: el último del arreglo es el más nuevo.
export function getWorkoutsByUserId(userId) {
  const stmt = getDatabase().prepare('SELECT * FROM workouts WHERE user_id = ? ORDER BY date ASC, start ASC');
  const rows = stmt.all(userId);

  return rows.map(row => {
    const entryStmt = getDatabase().prepare('SELECT * FROM workout_entries WHERE workout_id = ? ORDER BY id');
    const entries = entryStmt.all(row.id).map(entryRow => ({
      id: entryRow.exercise_id,
      topW: entryRow.top_w,
      target: safeJsonParse(entryRow.target),
      note: entryRow.note,
      notePin: entryRow.note_pin === 1,
      muscleSnapshot: safeJsonParse(entryRow.muscle_snapshot),
      sets: getWorkoutSetsByEntryId(entryRow.id)
    }));

    return decodeMeta({
      id: row.id,
      d: row.date,
      start: row.start,
      end: row.end,
      routineId: row.routine_id,
      name: row.name,
      bw: row.bw,
      vol: row.vol,
      note: row.note,
      partial: row.partial === 1,
      entries
    }, row.meta, `workouts#${row.id}`);
  });
}

function getWorkoutSetsByEntryId(entryId) {
  const stmt = getDatabase().prepare('SELECT * FROM workout_sets WHERE entry_id = ? ORDER BY id');
  return stmt.all(entryId).map(setFromRow);
}

function saveWorkouts(userId, workouts, validRoutineIds = null) {
  const db = getDatabase();
  // Eliminar workouts viejos
  const deleteStmt = db.prepare('DELETE FROM workouts WHERE user_id = ?');
  const workoutStmt = db.prepare(`
    INSERT OR REPLACE INTO workouts (id, user_id, date, start, end, routine_id, name, bw, vol, note, partial, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const entryStmt = db.prepare(`
    INSERT INTO workout_entries (workout_id, exercise_id, top_w, target, note, note_pin, muscle_snapshot)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const setStmt = db.prepare(`
    INSERT INTO workout_sets (entry_id, w, r, sec, min, speed, done, rir, rpe, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // Rechaza el estado antes del DELETE: un registro inválido no puede dejar el historial a medias.
  validateWorkouts(workouts);
  // Desduplicar el arreglo por ID y generar fallback si falta un ID
  const seenIds = new Set();
  const cleanWorkouts = [];
  for (const w of (workouts || [])) {
    if (!w) continue;
    const wId = String(w.id || ('w_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)));
    if (!seenIds.has(wId)) {
      seenIds.add(wId);
      cleanWorkouts.push({
        ...w,
        id: wId,
        routineId: validRoutineIds && w?.routineId ? (validRoutineIds.has(String(w.routineId)) ? String(w.routineId) : null) : (w?.routineId || null)
      });
    }
  }

  let ownsTransaction = false;
  try {
    db.exec('BEGIN');
    ownsTransaction = true;
  } catch (error) {
    if (!String(error?.message || '').toLowerCase().includes('within a transaction')) throw error;
  }
  try {
    deleteStmt.run(userId);
    for (const workout of cleanWorkouts) {
      workoutStmt.run(
        workout.id,
        userId,
        workout.d,
        workout.start,
        workout.end,
        workout.routineId || null,
        workout.name,
        workout.bw || null,
        workout.vol ?? null,
        workout.note || null,
        workout.partial ? 1 : 0,
        workoutMeta(workout)
      );

      for (const entry of workout.entries || []) {
        // El id de la fila recién insertada, no una búsqueda por ejercicio: con el mismo
        // ejercicio dos veces en un workout, la búsqueda devolvía siempre la primera entry.
        const { lastInsertRowid } = entryStmt.run(
          workout.id,
          entry.id,
          entry.topW ?? null,
          entry.target ? JSON.stringify(entry.target) : null,
          entry.note || null,
          entry.notePin ? 1 : 0,
          entry.muscleSnapshot ? JSON.stringify(entry.muscleSnapshot) : null
        );
        const entryId = Number(lastInsertRowid);
        for (const set of entry.sets || []) setStmt.run(entryId, ...setRowValues(set));
      }
    }
    if (ownsTransaction) db.exec('COMMIT');
  } catch (error) {
    if (ownsTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

// ============================================================
// Ajustes globales del panel Admin / asistencia
// ============================================================

export function getAdminSetting(key, fallback = null) {
  const row = getDatabase().prepare('SELECT value FROM admin_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setAdminSetting(key, value) {
  getDatabase().prepare(`
    INSERT INTO admin_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, String(value), Date.now());
}

export function getOrCreateQrAccessToken() {
  const existing = getAdminSetting('qr_access_token');
  if (existing) return existing;
  const token = crypto.randomBytes(32).toString('base64url');
  setAdminSetting('qr_access_token', token);
  return token;
}

export function getAttendanceByDate(startDate, endDate) {
  return getDatabase().prepare(`
    SELECT date, COUNT(DISTINCT user_id) AS users
    FROM workouts
    WHERE date >= ? AND date <= ?
    GROUP BY date
    ORDER BY date ASC
  `).all(startDate, endDate);
}

export function getPresetGroups() {
  return getDatabase().prepare('SELECT group_name AS name, COUNT(*) AS count FROM presets GROUP BY group_name ORDER BY group_name').all();
}

// ============================================================
// Operaciones de exercise weights
// ============================================================

export function getExerciseWeightsByUserId(userId) {
  const stmt = getDatabase().prepare('SELECT * FROM exercise_weights WHERE user_id = ?');
  const rows = stmt.all(userId);
  const exWeights = {};
  for (const row of rows) {
    exWeights[row.exercise_id] = { w: row.w, d: row.date };
  }
  return exWeights;
}

function saveExerciseWeights(userId, exWeights) {
  const db = getDatabase();
  const deleteStmt = db.prepare('DELETE FROM exercise_weights WHERE user_id = ?');
  deleteStmt.run(userId);

  const stmt = db.prepare('INSERT INTO exercise_weights (user_id, exercise_id, w, date) VALUES (?, ?, ?, ?)');
  for (const [exId, data] of Object.entries(exWeights)) {
    stmt.run(userId, exId, data.w, data.d);
  }
}

// ============================================================
// Operaciones de bodyweight
// ============================================================

export function getBodyweightByUserId(userId) {
  const stmt = getDatabase().prepare('SELECT * FROM bodyweight WHERE user_id = ? ORDER BY t ASC');
  return stmt.all(userId).map(row => ({
    d: row.date,
    w: row.w,
    t: row.t
  }));
}

function saveBodyweight(userId, bodyweight) {
  const db = getDatabase();
  const deleteStmt = db.prepare('DELETE FROM bodyweight WHERE user_id = ?');
  deleteStmt.run(userId);

  const stmt = db.prepare('INSERT INTO bodyweight (user_id, date, w, t) VALUES (?, ?, ?, ?)');
  for (const bw of bodyweight) {
    stmt.run(userId, bw.d, bw.w, bw.t);
  }
}

// ============================================================
// Operaciones de custom exercises
// ============================================================

export function getCustomExercisesByUserId(userId) {
  const stmt = getDatabase().prepare('SELECT * FROM custom_exercises WHERE user_id = ?');
  return stmt.all(userId).map(row => ({
    id: row.id,
    n: row.n,
    tipo: row.tipo,
    equipamiento: safeJsonParse(row.equipamiento, row.eq ? [row.eq] : ['body weight']),
    grupo_muscular: row.grupo_muscular || row.tg || row.bp || '',
    bp: row.bp,
    eq: row.eq,
    tg: row.tg,
    mg: row.mg,
    sm: safeJsonParse(row.sm, []),
    st: safeJsonParse(row.st, []),
    created: row.created_at,
    custom: true
  }));
}

export function getPublicCustomExercises() {
  return getDatabase().prepare('SELECT payload FROM public_custom_exercises').all().map(r => ({ ...safeJsonParse(r.payload, {}), custom: true, shared: true }));
}
export function savePublicCustomExercise(ex) {
  getDatabase().prepare('INSERT OR REPLACE INTO public_custom_exercises (id, payload, updated_at) VALUES (?, ?, ?)').run(ex.id, JSON.stringify(ex), Date.now());
}
export function deletePublicCustomExercise(id) { getDatabase().prepare('DELETE FROM public_custom_exercises WHERE id = ?').run(id); }

function saveCustomExercises(userId, customEx) {
  const db = getDatabase();
  const deleteStmt = db.prepare('DELETE FROM custom_exercises WHERE user_id = ?');
  deleteStmt.run(userId);

  const stmt = db.prepare(`
    INSERT OR REPLACE INTO custom_exercises (id, user_id, n, tipo, equipamiento, grupo_muscular, bp, eq, tg, mg, sm, st, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const ex of customEx) {
    const equipArr = Array.isArray(ex.equipamiento) ? ex.equipamiento : (ex.eq ? [ex.eq] : ['body weight']);
    stmt.run(
      ex.id,
      userId,
      ex.n,
      ex.tipo || null,
      JSON.stringify(equipArr),
      ex.grupo_muscular || ex.tg || ex.bp || '',
      ex.bp || '',
      equipArr[0] || ex.eq || 'body weight',
      ex.tg || ex.grupo_muscular || ex.bp || '',
      ex.mg || '',
      JSON.stringify(ex.sm || []),
      JSON.stringify(ex.st || []),
      ex.created || Date.now()
    );
  }
}

// ============================================================
// Operaciones de exercise notes
// ============================================================

export function getExerciseNotesByUserId(userId) {
  const stmt = getDatabase().prepare('SELECT * FROM exercise_notes WHERE user_id = ?');
  const rows = stmt.all(userId);
  const exNotes = {};
  for (const row of rows) {
    exNotes[row.exercise_id] = row.note;
  }
  return exNotes;
}

function saveExerciseNotes(userId, exNotes) {
  const db = getDatabase();
  const deleteStmt = db.prepare('DELETE FROM exercise_notes WHERE user_id = ?');
  deleteStmt.run(userId);

  const stmt = db.prepare('INSERT INTO exercise_notes (user_id, exercise_id, note) VALUES (?, ?, ?)');
  for (const [exId, note] of Object.entries(exNotes)) {
    stmt.run(userId, exId, note);
  }
}

// ============================================================
// Operaciones de reminder settings
// ============================================================

export function getReminderSettingsByUserId(userId) {
  const stmt = getDatabase().prepare('SELECT * FROM reminder_settings WHERE user_id = ?');
  const row = stmt.get(userId);
  if (!row) return null;
  return {
    on: row.on === 1,
    time: row.time,
    tz: row.tz,
    feeOn: row.fee_on === 1,
    feeInterval: row.fee_interval,
    feeDate: row.fee_date
  };
}

function saveReminderSettings(userId, reminder) {
  if (!reminder) return;
  const stmt = getDatabase().prepare(`
    INSERT OR REPLACE INTO reminder_settings (user_id, "on", time, tz, fee_on, fee_interval, fee_date)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    userId,
    reminder.on ? 1 : 0,
    reminder.time || null,
    reminder.tz || null,
    reminder.feeOn ? 1 : 0,
    reminder.feeInterval || 'monthly',
    reminder.feeDate || null
  );
}

// ============================================================
// Operaciones de equipment profiles
// ============================================================

export function getEquipProfilesByUserId(userId) {
  const stmt = getDatabase().prepare('SELECT * FROM equip_profiles WHERE user_id = ?');
  return stmt.all(userId).map(row => ({
    id: row.id,
    name: row.name,
    equipment: safeJsonParse(row.equipment, []),
    created: row.created_at
  }));
}

function saveEquipProfiles(userId, profiles) {
  const db = getDatabase();
  const deleteStmt = db.prepare('DELETE FROM equip_profiles WHERE user_id = ?');
  deleteStmt.run(userId);

  const stmt = db.prepare('INSERT INTO equip_profiles (id, user_id, name, equipment, created_at) VALUES (?, ?, ?, ?, ?)');
  for (const profile of profiles) {
    stmt.run(profile.id, userId, profile.name, JSON.stringify(profile.equipment), profile.created || Date.now());
  }
}


// ============================================================
// Cuotas v1: planes, plan/vencimiento por socio y pagos
// (reglas de estado y fechas en billing.js)
// ============================================================

const planFromRow = row => row ? {
  id: row.id,
  name: row.name,
  price: row.price,
  durationDays: row.duration_days,
  active: row.active === 1,
  created: row.created_at,
  updated: row.updated_at
} : null;

export function getPlans() {
  return getDatabase().prepare('SELECT * FROM plans ORDER BY active DESC, name COLLATE NOCASE, id').all().map(planFromRow);
}

export function getPlanById(id) {
  return planFromRow(getDatabase().prepare('SELECT * FROM plans WHERE id = ?').get(id));
}

export function createPlan({ name, price, durationDays }) {
  const now = Date.now();
  const { lastInsertRowid } = getDatabase().prepare(`
    INSERT INTO plans (name, price, duration_days, active, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)
  `).run(name, price, durationDays, now, now);
  return getPlanById(Number(lastInsertRowid));
}

// Parche parcial: solo cambia los campos presentes. Los planes no se borran.
export function updatePlan(id, { name, price, durationDays, active }) {
  const fields = [];
  const values = [];
  if (name !== undefined) { fields.push('name = ?'); values.push(name); }
  if (price !== undefined) { fields.push('price = ?'); values.push(price); }
  if (durationDays !== undefined) { fields.push('duration_days = ?'); values.push(durationDays); }
  if (active !== undefined) { fields.push('active = ?'); values.push(active ? 1 : 0); }
  if (fields.length) {
    fields.push('updated_at = ?'); values.push(Date.now());
    getDatabase().prepare(`UPDATE plans SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
  }
  return getPlanById(id);
}

const billingFromRow = (userId, row) => ({
  userId,
  planId: row?.plan_id ?? null,
  planName: row?.plan_name ?? null,
  planPrice: row?.plan_price ?? null,
  planDurationDays: row?.plan_duration_days ?? null,
  planActive: row?.plan_active == null ? null : row.plan_active === 1,
  dueDate: row?.due_date ?? null,
  trialUntil: row?.trial_until ?? null,
  pushSentForDue: row?.push_sent_for_due ?? null,
  updatedAt: row?.updated_at ?? null
});

const BILLING_SELECT = `
  mb.plan_id, mb.due_date, mb.trial_until, mb.push_sent_for_due, mb.updated_at,
  p.name AS plan_name, p.price AS plan_price, p.duration_days AS plan_duration_days, p.active AS plan_active
`;

// Plan y vencimiento de un socio. Sin fila devuelve el mismo objeto con todo en null.
export function getMemberBilling(userId) {
  const row = getDatabase().prepare(`
    SELECT ${BILLING_SELECT}
    FROM member_billing mb LEFT JOIN plans p ON p.id = mb.plan_id
    WHERE mb.user_id = ?
  `).get(userId);
  return billingFromRow(userId, row);
}

// Todos los usuarios con su plan y vencimiento, en una sola query (panel de cuotas y lista
// de usuarios del admin).
export function getAllMemberBilling() {
  return getDatabase().prepare(`
    SELECT u.id AS user_id, u.name, u.disabled, u.admin, u.owner, ${BILLING_SELECT},
      EXISTS (SELECT 1 FROM credentials c WHERE c.user_id = u.id) AS has_app
    FROM users u
    LEFT JOIN member_billing mb ON mb.user_id = u.id
    LEFT JOIN plans p ON p.id = mb.plan_id
    ORDER BY u.name COLLATE NOCASE, u.id
  `).all().map(row => ({
    ...billingFromRow(row.user_id, row),
    name: row.name,
    disabled: !!row.disabled,
    admin: row.admin === 1,
    owner: row.owner === 1,
    hasApp: row.has_app === 1
  }));
}

// Asigna, cambia o quita (planId null) el plan vigente. Un vencimiento nuevo reinicia el
// aviso push de ese período. Asignar un plan cierra la prueba; quitarlo no la toca.
export function setMemberBilling(userId, { planId, dueDate }) {
  getDatabase().prepare(`
    INSERT INTO member_billing (user_id, plan_id, due_date, push_sent_for_due, updated_at)
    VALUES (?, ?, ?, NULL, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      plan_id = excluded.plan_id, due_date = excluded.due_date,
      trial_until = CASE WHEN excluded.plan_id IS NULL THEN member_billing.trial_until ELSE NULL END,
      push_sent_for_due = NULL, updated_at = excluded.updated_at
  `).run(userId, planId ?? null, planId == null ? null : dueDate, Date.now());
  return getMemberBilling(userId);
}

// Guarda el pago y mueve el vencimiento en una sola transacción: nunca queda un pago sin
// su vencimiento nuevo, ni al revés. El plan y vencimiento anteriores quedan en el pago para
// poder anularlo (voidPayment).
// Sin transacción propia: la abre quien llama (recordPayment, o el alta de ficha con pago).
// El pago cierra la prueba si había una (trial_until = NULL).
function insertPayment(db, { userId, userName, planId, planName, amount, method, paidAt, periodStart, periodEnd, dueDate, note, createdBy }) {
  const now = Date.now();
  const before = db.prepare('SELECT plan_id, due_date, trial_until FROM member_billing WHERE user_id = ?').get(userId);
  // La prueba que el pago cierra también queda en el pago: anularlo la devuelve.
  const { lastInsertRowid } = db.prepare(`
    INSERT INTO payments (user_id, user_name, plan_id, plan_name, amount, method, paid_at, period_start, period_end, note, created_by, created_at, previous_due_date, previous_plan_id, previous_trial_until)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(userId, userName ?? null, planId, planName ?? null, amount, method, paidAt, periodStart, periodEnd, note ?? null, createdBy ?? null, now,
    before?.due_date ?? null, before?.plan_id ?? null, before?.trial_until ?? null);
  db.prepare(`
    INSERT INTO member_billing (user_id, plan_id, due_date, trial_until, push_sent_for_due, updated_at)
    VALUES (?, ?, ?, NULL, NULL, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      plan_id = excluded.plan_id, due_date = excluded.due_date, trial_until = NULL,
      push_sent_for_due = NULL, updated_at = excluded.updated_at
  `).run(userId, planId, dueDate, now);
  return Number(lastInsertRowid);
}

export function recordPayment(payment) {
  const db = getDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    const id = insertPayment(db, payment);
    db.exec('COMMIT');
    return id;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

// Empieza la prueba: último día en member_billing y la marca de "ya la usó" en el perfil. Sin
// transacción propia (ver startTrial y createMember). Si ya estaba marcada, no toca nada.
// → true si la empezó.
function beginTrial(db, userId, trialUntil) {
  const marked = db.prepare('UPDATE member_profile SET trial_used_at = ? WHERE user_id = ? AND trial_used_at IS NULL').run(Date.now(), userId);
  if (Number(marked.changes) !== 1) return false;
  db.prepare(`
    INSERT INTO member_billing (user_id, plan_id, due_date, trial_until, push_sent_for_due, updated_at)
    VALUES (?, NULL, NULL, ?, NULL, ?)
    ON CONFLICT(user_id) DO UPDATE SET trial_until = excluded.trial_until, updated_at = excluded.updated_at
  `).run(userId, trialUntil, Date.now());
  return true;
}

// Prueba de un socio que ya existe. La marca de uso se re-chequea dentro de la transacción:
// dos admins a la vez no le dan dos pruebas. → true, o false si ya la había usado.
export function startTrial(userId, trialUntil) {
  const db = getDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    const ok = beginTrial(db, userId, trialUntil);
    db.exec(ok ? 'COMMIT' : 'ROLLBACK');
    return ok;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

const paymentFromRow = row => row ? {
  id: row.id,
  userId: row.user_id,
  userName: row.user_name,
  planId: row.plan_id,
  planName: row.plan_name,
  amount: row.amount,
  method: row.method,
  paidAt: row.paid_at,
  periodStart: row.period_start,
  periodEnd: row.period_end,
  note: row.note,
  createdBy: row.created_by,
  createdByName: row.created_by_name ?? null,
  created: row.created_at,
  previousDueDate: row.previous_due_date,
  previousPlanId: row.previous_plan_id,
  previousTrialUntil: row.previous_trial_until ?? null,
  voidedAt: row.voided_at,
  voidedBy: row.voided_by,
  voidedByName: row.voided_by_name ?? null,
  voidReason: row.void_reason
} : null;

const PAYMENT_SELECT = `
  SELECT p.*, cu.name AS created_by_name, vu.name AS voided_by_name
  FROM payments p
  LEFT JOIN users cu ON cu.id = p.created_by
  LEFT JOIN users vu ON vu.id = p.voided_by
`;

// Historial completo, anulados incluidos (marcados con voidedAt).
export function getPaymentsByUserId(userId, limit = 200) {
  return getDatabase().prepare(`${PAYMENT_SELECT} WHERE p.user_id = ? ORDER BY p.paid_at DESC, p.id DESC LIMIT ?`)
    .all(userId, limit).map(paymentFromRow);
}

export function getPaymentById(id) {
  return paymentFromRow(getDatabase().prepare(`${PAYMENT_SELECT} WHERE p.id = ?`).get(id));
}

// El último pago vigente es el último REGISTRADO (id), no el de paid_at más alto: cada pago
// guardó el vencimiento que había al cargarlo, así que solo se deshacen en orden inverso.
export function getLatestActivePayment(userId) {
  return paymentFromRow(getDatabase().prepare(`${PAYMENT_SELECT} WHERE p.user_id = ? AND p.voided_at IS NULL ORDER BY p.id DESC LIMIT 1`).get(userId));
}

// Anula un pago y devuelve al socio el plan, vencimiento y prueba que tenía antes, en una
// transacción. Un pago viejo sin previous_trial_until deja la prueba en NULL (como antes).
// Las condiciones (último vigente, vencimiento sin cambios) las valida quien llama.
export function voidPayment({ paymentId, userId, voidedBy, reason, planId, dueDate, trialUntil = null }) {
  const db = getDatabase();
  const now = Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    const marked = db.prepare(`
      UPDATE payments SET voided_at = ?, voided_by = ?, void_reason = ? WHERE id = ? AND user_id = ? AND voided_at IS NULL
    `).run(now, voidedBy ?? null, reason ?? null, paymentId, userId);
    if (marked.changes !== 1) throw new Error('payment already voided or missing');
    db.prepare(`
      INSERT INTO member_billing (user_id, plan_id, due_date, trial_until, push_sent_for_due, updated_at)
      VALUES (?, ?, ?, ?, NULL, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        plan_id = excluded.plan_id, due_date = excluded.due_date, trial_until = excluded.trial_until,
        push_sent_for_due = NULL, updated_at = excluded.updated_at
    `).run(userId, planId ?? null, planId == null ? null : dueDate, trialUntil ?? null, now);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

// Marca el aviso push como enviado solo si el vencimiento sigue siendo el mismo: si un pago
// lo movió mientras el push salía, el período nuevo conserva su propio aviso.
export function markDuePushSent(userId, dueDate) {
  getDatabase().prepare('UPDATE member_billing SET push_sent_for_due = ? WHERE user_id = ? AND due_date = ?').run(dueDate, userId, dueDate);
}

// ============================================================
// Fichas de socio (member_profile) y códigos de vinculación
// (normalización y config de campos en members.js)
// ============================================================

const profileFromRow = row => row ? {
  userId: row.user_id,
  fullName: row.full_name ?? null,
  dni: row.dni ?? null,
  dniNorm: row.dni_norm ?? null,
  phone: row.phone ?? null,
  phoneNorm: row.phone_norm ?? null,
  email: row.email ?? null,
  trialUsedAt: row.trial_used_at ?? null,
  created: row.created_at ?? null,
  updated: row.updated_at ?? null
} : null;

export function getMemberProfile(userId) {
  return profileFromRow(getDatabase().prepare('SELECT * FROM member_profile WHERE user_id = ?').get(userId));
}

// Quién tiene ya ese DNI (otro que excludeUserId). → { userId, name, hasApp } o null.
export function findMemberByDni(dniNorm, excludeUserId = null) {
  if (!dniNorm) return null;
  const row = getDatabase().prepare(`
    SELECT u.id, u.name, EXISTS (SELECT 1 FROM credentials c WHERE c.user_id = u.id) AS has_app
    FROM member_profile mp JOIN users u ON u.id = mp.user_id
    WHERE mp.dni_norm = ? AND (? IS NULL OR u.id <> ?)
  `).get(dniNorm, excludeUserId, excludeUserId);
  return row ? { userId: row.id, name: row.name, hasApp: row.has_app === 1 } : null;
}

export function countCredentials(userId) {
  return Number(getDatabase().prepare('SELECT COUNT(*) AS n FROM credentials WHERE user_id = ?').get(userId).n);
}

// Para los listados: una query por conjunto, no una por usuario.
export function getAppUserIds() {
  return new Set(getDatabase().prepare('SELECT DISTINCT user_id FROM credentials').all().map(r => r.user_id));
}
export function getProfileUserIds() {
  return new Set(getDatabase().prepare('SELECT user_id FROM member_profile').all().map(r => r.user_id));
}

// Usuarios de la app = con al menos una passkey. Las fichas sin credencial no cuentan.
export function countAppUsers() {
  return Number(getDatabase().prepare('SELECT COUNT(DISTINCT user_id) AS n FROM credentials').get().n);
}

// La violación del índice único de dni_norm (dos altas simultáneas con el mismo DNI).
export const isDniUniqueError = error => /UNIQUE constraint failed: member_profile\.dni_norm/.test(String(error?.message || ''));

function writeMemberProfile(db, userId, p, nowIso) {
  db.prepare(`
    INSERT INTO member_profile (user_id, full_name, dni, dni_norm, phone, phone_norm, email, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      full_name = excluded.full_name, dni = excluded.dni, dni_norm = excluded.dni_norm,
      phone = excluded.phone, phone_norm = excluded.phone_norm, email = excluded.email,
      updated_at = excluded.updated_at
  `).run(userId, p.fullName ?? null, p.dni ?? null, p.dniNorm ?? null, p.phone ?? null, p.phoneNorm ?? null, p.email ?? null, nowIso, nowIso);
}

// Alta de ficha: usuario sin credencial (admin=0, owner=0) + perfil + (opcional) plan asignado,
// primer pago o prueba. Todo o nada: si el pago o la prueba fallan, no queda la ficha.
// start: { payment: {...recordPayment sin userId} } | { trialUntil } | null.
export function createMember({ id, name, profile, billing = null, start = null }) {
  const db = getDatabase();
  const nowIso = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    createUser({ id, name, created: nowIso, member: true });
    writeMemberProfile(db, id, profile, nowIso);
    if (billing) setMemberBilling(id, billing);
    if (start?.payment) insertPayment(db, { ...start.payment, userId: id, userName: name });
    if (start?.trialUntil && !beginTrial(db, id, start.trialUntil)) throw new Error('trial not started');
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

// Edición: users.name (si viene) y el perfil completo resultante (si viene), juntos.
export function updateMemberProfile(userId, { name, profile }) {
  const db = getDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    if (name !== undefined) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, userId);
    if (profile) writeMemberProfile(db, userId, profile, new Date().toISOString());
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

// --- códigos de vinculación ---

export const LINK_CODE_MAX_FAILURES = 5;
const linkCodeUsable = (row, nowIso) => !!row && !row.used_at && !row.revoked_at && row.expires_at > nowIso;

// Revoca los códigos vigentes del socio y guarda el nuevo (solo su hash).
export function issueLinkCode({ userId, codeHash, createdBy, expiresAt }) {
  const db = getDatabase();
  const nowIso = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('UPDATE link_codes SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL').run(nowIso, userId);
    db.prepare('INSERT INTO link_codes (user_id, code_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(userId, codeHash, createdBy ?? null, nowIso, expiresAt);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

export function revokeLinkCodes(userId) {
  return Number(getDatabase().prepare('UPDATE link_codes SET revoked_at = ? WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL')
    .run(new Date().toISOString(), userId).changes);
}

export function getLinkCodeByHash(codeHash) {
  return getDatabase().prepare('SELECT * FROM link_codes WHERE code_hash = ?').get(codeHash) || null;
}

export const isLinkCodeUsable = row => linkCodeUsable(row, new Date().toISOString());

// Un intento fallido con este código; al llegar a LINK_CODE_MAX_FAILURES queda revocado.
// → true si este fallo lo revocó.
export function recordLinkCodeFailure(id) {
  const db = getDatabase();
  const nowIso = new Date().toISOString();
  db.prepare('UPDATE link_codes SET failed_attempts = failed_attempts + 1 WHERE id = ?').run(id);
  const revoked = db.prepare(`
    UPDATE link_codes SET revoked_at = ? WHERE id = ? AND failed_attempts >= ? AND used_at IS NULL AND revoked_at IS NULL
  `).run(nowIso, id, LINK_CODE_MAX_FAILURES);
  return Number(revoked.changes) === 1;
}

// Canjea el código: re-chequea todo dentro de BEGIN IMMEDIATE (código vigente y de este socio,
// socio activo y todavía sin credencial, passkey nueva) y recién ahí crea la credencial.
// → { user } o { error: 'link-invalid' | 'link-unavailable' | 'credential-exists' }.
export function consumeLinkCode({ linkId, userId, credential }) {
  const db = getDatabase();
  const nowIso = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const fail = error => { db.exec('ROLLBACK'); return { error }; };
    const row = db.prepare('SELECT * FROM link_codes WHERE id = ?').get(linkId);
    if (!linkCodeUsable(row, nowIso) || row.user_id !== userId) return fail('link-invalid');
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user || user.disabled) return fail('link-unavailable');
    if (countCredentials(userId) > 0) return fail('link-unavailable');
    if (getCredentialById(credential.id)) return fail('credential-exists');
    createCredential({ ...credential, userId });
    db.prepare('UPDATE link_codes SET used_at = ? WHERE id = ?').run(nowIso, linkId);
    db.exec('COMMIT');
    return { user };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

// --- merge ficha → cuenta con app ---

// Datos propios de la ficha que no se mueven y se pierden con el borrado (rutinas o nutrición
// que un admin le haya cargado). Clave de la respuesta → tabla.
const FICHA_OWN_DATA = [
  ['state', 'user_state'], ['routines', 'routines'], ['weekPlan', 'week_plan'], ['dayPlan', 'day_plan'],
  ['workouts', 'workouts'], ['exerciseWeights', 'exercise_weights'], ['bodyweight', 'bodyweight'],
  ['customExercises', 'custom_exercises'], ['exerciseNotes', 'exercise_notes'], ['reminders', 'reminder_settings'],
  ['equipProfiles', 'equip_profiles'], ['meals', 'comidas_registradas'], ['mealTemplates', 'plantillas_comida'],
  ['subscriptions', 'subscriptions']
];

// Cuota de un lado del merge: un plan o una prueba (en curso o vencida). Sin ninguno, null.
const billingBrief = row => row?.plan_id != null || row?.trial_until
  ? { planId: row.plan_id ?? null, planName: row.plan_name ?? null, dueDate: row.due_date ?? null, trialUntil: row.trial_until ?? null }
  : null;

// Todo lo que el merge haría, sin escribir. keepBilling: 'ficha' | 'cuenta' | null.
// → { error } si no se puede, o { plan, fichaProfile, targetProfile }.
function mergePlan(db, fichaId, targetId, keepBilling) {
  if (fichaId === targetId) return { error: 'same_user' };
  const ficha = db.prepare('SELECT * FROM users WHERE id = ?').get(fichaId);
  if (!ficha) return { error: 'ficha_not_found' };
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!target) return { error: 'target_not_found' };
  if (countCredentials(fichaId) > 0) return { error: 'ficha_has_app' };
  if (countCredentials(targetId) < 1) return { error: 'target_without_app' };
  if (target.admin === 1 || target.owner === 1) return { error: 'target_is_staff' };

  const billingRow = id => db.prepare(`
    SELECT mb.plan_id, mb.due_date, mb.trial_until, p.name AS plan_name
    FROM member_billing mb LEFT JOIN plans p ON p.id = mb.plan_id WHERE mb.user_id = ?
  `).get(id);
  const fichaBilling = billingBrief(billingRow(fichaId));
  const targetBilling = billingBrief(billingRow(targetId));
  const billingConflict = !!fichaBilling && !!targetBilling;
  const billingKeep = !fichaBilling ? 'cuenta' : !targetBilling ? 'ficha' : (keepBilling || null);

  const fichaProfile = db.prepare('SELECT * FROM member_profile WHERE user_id = ?').get(fichaId);
  const targetProfile = db.prepare('SELECT * FROM member_profile WHERE user_id = ?').get(targetId);
  const dniConflict = !!fichaProfile?.dni_norm && !!targetProfile?.dni_norm && fichaProfile.dni_norm !== targetProfile.dni_norm;
  const profileAction = !fichaProfile ? 'none' : !targetProfile ? 'move' : 'fill';

  const payments = Number(db.prepare('SELECT COUNT(*) AS n FROM payments WHERE user_id = ?').get(fichaId).n);
  const lost = {};
  for (const [key, table] of FICHA_OWN_DATA) {
    const n = Number(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(fichaId).n);
    if (n) lost[key] = n;
  }
  return {
    plan: {
      ficha: { id: ficha.id, name: ficha.name },
      target: { id: target.id, name: target.name },
      payments,
      billing: { ficha: fichaBilling, cuenta: targetBilling, conflict: billingConflict, keep: billingKeep },
      profile: { ficha: !!fichaProfile, cuenta: !!targetProfile, conflict: dniConflict, action: profileAction },
      lost
    },
    fichaProfile,
    targetProfile
  };
}

// Columnas que se completan juntas (el valor ingresado va con su forma normalizada).
const PROFILE_FILL = [['full_name'], ['dni', 'dni_norm'], ['phone', 'phone_norm'], ['email']];

// Une una ficha (sin credencial) a la cuenta con app del mismo socio: pagos, plan y perfil
// pasan a la cuenta y la ficha se borra, en una sola transacción BEGIN IMMEDIATE.
// dryRun: devuelve el plan (conteos y conflictos) sin escribir.
// → { error, plan? } | { plan } (dry run) | { result }.
export function mergeMember({ fichaId, targetId, keepBilling = null, dryRun = false }) {
  const db = getDatabase();
  if (dryRun) {
    const checked = mergePlan(db, fichaId, targetId, keepBilling);
    return checked.error ? { error: checked.error } : { plan: checked.plan };
  }
  db.exec('BEGIN IMMEDIATE');
  try {
    const checked = mergePlan(db, fichaId, targetId, keepBilling);
    const stop = error => { db.exec('ROLLBACK'); return { error, plan: checked.plan }; };
    if (checked.error) return stop(checked.error);
    const { plan, fichaProfile, targetProfile } = checked;
    if (plan.billing.conflict && !plan.billing.keep) return stop('billing_conflict');
    if (plan.profile.conflict) return stop('dni_conflict');
    const nowIso = new Date().toISOString();

    // Pagos: cambian de dueño y conservan el snapshot user_name.
    db.prepare('UPDATE payments SET user_id = ? WHERE user_id = ?').run(targetId, fichaId);

    if (plan.billing.ficha && plan.billing.keep === 'ficha') {
      const fb = db.prepare('SELECT plan_id, due_date, trial_until FROM member_billing WHERE user_id = ?').get(fichaId);
      db.prepare(`
        INSERT INTO member_billing (user_id, plan_id, due_date, trial_until, push_sent_for_due, updated_at)
        VALUES (?, ?, ?, ?, NULL, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          plan_id = excluded.plan_id, due_date = excluded.due_date, trial_until = excluded.trial_until,
          push_sent_for_due = NULL, updated_at = excluded.updated_at
      `).run(targetId, fb.plan_id, fb.due_date, fb.trial_until, Date.now());
    }

    if (plan.profile.action === 'move') {
      db.prepare('UPDATE member_profile SET user_id = ?, updated_at = ? WHERE user_id = ?').run(targetId, nowIso, fichaId);
    } else if (plan.profile.action === 'fill') {
      // Primero se va el perfil de la ficha: si no, pasarle su DNI a la cuenta chocaría con el
      // índice único mientras las dos filas existen.
      db.prepare('DELETE FROM member_profile WHERE user_id = ?').run(fichaId);
      const sets = [];
      const values = [];
      for (const cols of PROFILE_FILL) {
        const [main] = cols;
        if (targetProfile[main] != null && targetProfile[main] !== '') continue;
        if (fichaProfile[main] == null || fichaProfile[main] === '') continue;
        for (const col of cols) { sets.push(`${col} = ?`); values.push(fichaProfile[col] ?? null); }
      }
      // La prueba usada es de la persona: si cualquiera de las dos la usó, la cuenta queda marcada.
      if (targetProfile.trial_used_at == null && fichaProfile.trial_used_at != null) {
        sets.push('trial_used_at = ?'); values.push(fichaProfile.trial_used_at);
      }
      if (sets.length) {
        db.prepare(`UPDATE member_profile SET ${sets.join(', ')}, updated_at = ? WHERE user_id = ?`).run(...values, nowIso, targetId);
      }
    }

    deleteUser(fichaId, { inTransaction: true });
    db.exec('COMMIT');
    return { result: plan };
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}
