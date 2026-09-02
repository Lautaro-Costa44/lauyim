/**
 * Capa de acceso a datos SQLite para openGym
 * Reemplaza las operaciones que antes usaban db.json + state-<uid>.json
 */

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA = process.env.DATA_DIR || '/data';
const dbPath = path.join(DATA, 'gym.db');

let db;

export function initDatabase() {
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Migraciones adicionales si faltan columnas en bases existentes
  try {
    db.exec(`ALTER TABLE users ADD COLUMN last_reminder_sent_date TEXT;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE users ADD COLUMN last_fee_reminder_sent_date TEXT;`);
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
  try {
    db.exec(`ALTER TABLE preset_exercises ADD COLUMN progression_config TEXT;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE user_state ADD COLUMN progression_type TEXT;`);
  } catch {}
  try {
    db.exec(`ALTER TABLE user_state ADD COLUMN progression_config TEXT;`);
  } catch {}

  // Crear tablas principales si no existen
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      admin INTEGER DEFAULT 0,
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
      target_w REAL,
      estado_inicial TEXT,
      onboarding_completado INTEGER,
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
  `);

  // Migración defensiva: asegurar que existan todas las columnas de la encuesta en bases de datos existentes
  const columnsToAdd = [
    ['edad', 'INTEGER'],
    ['altura', 'INTEGER'],
    ['objetivo', 'TEXT'],
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
    ['onboarding_completado', 'INTEGER']
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
  const stmt = getDatabase().prepare(`
    INSERT INTO users (id, name, admin, disabled, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  stmt.run(user.id, user.name, user.admin ? 1 : 0, user.disabled ? 1 : 0, user.created || Date.now());
}

export function updateUser(id, updates) {
  const fields = [];
  const values = [];
  for (const [key, value] of Object.entries(updates)) {
    if (key === 'admin' || key === 'disabled') {
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
    INSERT INTO presets (id, name, emoji)
    VALUES (?, ?, ?)
  `);
  stmt.run(preset.id, preset.name, preset.emoji);

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
  const stmt = getDatabase().prepare('UPDATE presets SET name = ?, emoji = ? WHERE id = ?');
  stmt.run(preset.name, preset.emoji, id);

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
    targetW: row.target_w,
    estadoInicial: row.estado_inicial,
    onboardingCompletado: row.onboarding_completado === 1,
    onboardingStatsCompletado: row.onboarding_stats_completado === 1,
    edad: row.edad,
    altura: row.altura,
    objetivo: row.objetivo,
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
  };

  // Cargar relaciones
  S.routines = getRoutinesByUserId(userId);
  S.week = getWeekPlanByUserId(userId);
  S.dayPlan = getDayPlanByUserId(userId);
  S.workouts = getWorkoutsByUserId(userId);
  S.exWeights = getExerciseWeightsByUserId(userId);
  S.bodyweight = getBodyweightByUserId(userId);
  S.customEx = getCustomExercisesByUserId(userId);
  S.exNotes = getExerciseNotesByUserId(userId);
  S.reminder = getReminderSettingsByUserId(userId);
  S.equipProfiles = getEquipProfilesByUserId(userId);

  return S;
}

export function saveUserState(userId, S) {
  const db = getDatabase();
  const validRoutineIds = new Set((S.routines || []).map(r => String(r?.id || '')).filter(Boolean));

  // Guardar estado principal
  const stateStmt = db.prepare(`
    INSERT OR REPLACE INTO user_state (
      user_id, _ts, unit, rest_sec, rest_pause_sec, sound, keep_awake, lang, theme, accent,
      body, target_w, estado_inicial, onboarding_completado, onboarding_stats_completado, edad, altura, objetivo, nivel, peso_kg, configuracion,
      respuestas_encuesta, rutina_generada, fecha_ultima_encuesta, effort, auto_backup,
      active_equip_id, equip_filter_on, progression_type, progression_config
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    S.targetW || null,
    S.estadoInicial || 'pendiente',
    S.onboardingCompletado ? 1 : 0,
    S.onboardingStatsCompletado ? 1 : 0,
    S.edad || null,
    S.altura || null,
    S.objetivo || null,
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

function saveRoutines(userId, routines) {
  const db = getDatabase();

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

function saveWeekPlan(userId, week, validRoutineIds = null) {
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

function saveDayPlan(userId, dayPlan, validRoutineIds = null) {
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

  const runTransaction = db.transaction((items) => {
    deleteStmt.run(userId);
    for (const workout of items) {
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
  });
  runTransaction(cleanWorkouts);
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

