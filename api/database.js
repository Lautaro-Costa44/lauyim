/**
 * Capa de acceso a datos SQLite para openGym
 * Reemplaza las operaciones que antes usaban db.json + state-<uid>.json
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

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
      last_fee_reminder_sent_date TEXT
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

export function createUser(user) {
  const db = getDatabase();
  const isFirstUser = Number(db.prepare('SELECT COUNT(*) AS count FROM users').get().count) === 0;
  const owner = isFirstUser ? 1 : (user.owner ? 1 : 0);
  const admin = owner ? 1 : (user.admin ? 1 : 0);
  if (owner) db.prepare('UPDATE users SET owner = 0 WHERE owner = 1').run();
  const stmt = getDatabase().prepare(`
    INSERT INTO users (id, name, admin, owner, disabled, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(user.id, user.name, admin, owner, user.disabled ? 1 : 0, user.created || Date.now());
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
export function deleteUser(id) {
  const db = getDatabase();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) return null;

  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM invites WHERE created_by = ? OR used_by = ?').run(id, id);
    const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
    if (result.changes !== 1) throw new Error('user deletion did not affect exactly one row');
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
    INSERT INTO invites (code, created_by, revoked, created_at)
    VALUES (?, ?, ?, ?)
  `);
  stmt.run(invite.code, invite.createdBy, invite.revoked ? 1 : 0, invite.created || Date.now());
}

export function updateInviteUsedBy(code, userId) {
  const stmt = getDatabase().prepare('UPDATE invites SET used_by = ? WHERE code = ?');
  stmt.run(userId, code);
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
        ex.sg || null,
        ex.sets || null,
        ex.reps || null,
        ex.weight || null,
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

export function getWorkoutsByUserId(userId) {
  const stmt = getDatabase().prepare('SELECT * FROM workouts WHERE user_id = ? ORDER BY start DESC');
  const rows = stmt.all(userId);

  return rows.map(row => {
    const entryStmt = getDatabase().prepare('SELECT * FROM workout_entries WHERE workout_id = ?');
    const entries = entryStmt.all(row.id).map(entryRow => ({
      id: entryRow.exercise_id,
      topW: entryRow.top_w,
      target: safeJsonParse(entryRow.target),
      note: entryRow.note,
      notePin: entryRow.note_pin === 1,
      muscleSnapshot: safeJsonParse(entryRow.muscle_snapshot),
      sets: getWorkoutSetsByEntryId(entryRow.id)
    }));

    return {
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
    };
  });
}

function getWorkoutSetsByEntryId(entryId) {
  const stmt = getDatabase().prepare('SELECT * FROM workout_sets WHERE entry_id = ?');
  return stmt.all(entryId).map(row => ({
    w: row.w,
    r: row.r,
    sec: row.sec,
    min: row.min,
    speed: row.speed,
    done: row.done === 1,
    rir: row.rir,
    rpe: row.rpe
  }));
}

function saveWorkouts(userId, workouts, validRoutineIds = null) {
  const db = getDatabase();
  // Eliminar workouts viejos
  const deleteStmt = db.prepare('DELETE FROM workouts WHERE user_id = ?');
  const workoutStmt = db.prepare(`
    INSERT OR REPLACE INTO workouts (id, user_id, date, start, end, routine_id, name, bw, vol, note, partial)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const entryStmt = db.prepare(`
    INSERT INTO workout_entries (workout_id, exercise_id, top_w, target, note, note_pin, muscle_snapshot)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const setStmt = db.prepare(`
    INSERT INTO workout_sets (entry_id, w, r, sec, min, speed, done, rir, rpe)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
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
        workout.vol || null,
        workout.note || null,
        workout.partial ? 1 : 0
      );

      for (const entry of workout.entries || []) {
        entryStmt.run(
          workout.id,
          entry.id,
          entry.topW || null,
          entry.target ? JSON.stringify(entry.target) : null,
          entry.note || null,
          entry.notePin ? 1 : 0,
          entry.muscleSnapshot ? JSON.stringify(entry.muscleSnapshot) : null
        );

        const entryId = db.prepare('SELECT id FROM workout_entries WHERE workout_id = ? AND exercise_id = ? LIMIT 1')
          .get(workout.id, entry.id)?.id;
        if (entryId) {
          for (const set of entry.sets || []) {
            setStmt.run(
              entryId,
              set.w || null,
              set.r || null,
              set.sec || null,
              set.min || null,
              set.speed || null,
              set.done ? 1 : 0,
              set.rir || null,
              set.rpe || null
            );
          }
        }
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
  const stmt = getDatabase().prepare('SELECT * FROM bodyweight WHERE user_id = ? ORDER BY t DESC');
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

