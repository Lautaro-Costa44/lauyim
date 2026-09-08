#!/usr/bin/env node
/**
 * Script de migración de db.json + state-<uid>.json a SQLite
 *
 * Este script:
 * 1. Lee db.json y todos los archivos state-<uid>.json
 * 2. Crea la base SQLite con el esquema definido
 * 3. Migra todos los datos preservando el historial completo
 * 4. Hace backup de db.json antes de migrar
 * 5. Es idempotente: puede correrse varias veces sin duplicar datos
 *
 * Uso: node migrate-to-sqlite.js
 */

import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'crypto';

const DATA = process.env.DATA_DIR || '/data';
const dbFile = path.join(DATA, 'db.json');
const sqliteFile = path.join(DATA, 'gym.db');
const backupFile = path.join(DATA, 'db.json.backup');

console.log('🔄 Iniciando migración a SQLite...');
console.log(`📁 DATA_DIR: ${DATA}`);
console.log(`📄 db.json: ${dbFile}`);
console.log(`💾 gym.db: ${sqliteFile}`);

// Backup de db.json
if (fs.existsSync(dbFile)) {
  console.log('📦 Creando backup de db.json...');
  fs.copyFileSync(dbFile, backupFile);
  console.log('✅ Backup creado en', backupFile);
}

// Leer db.json
let db = { users: [], creds: [], subs: [], invites: [], presets: [] };
try {
  db = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  console.log('✅ db.json leído:', Object.keys(db));
} catch (e) {
  console.log('⚠️  db.json no existe o está vacío, usando estructura vacía');
}

// Crear base SQLite
console.log('🔨 Creando base SQLite...');
const sqlite = new DatabaseSync(sqliteFile);
sqlite.exec('PRAGMA journal_mode = WAL'); // Mejor performance
sqlite.exec('PRAGMA foreign_keys = ON');

// Leer y ejecutar schema
const schema = fs.readFileSync(path.join(process.cwd(), 'schema.sql'), 'utf8');
sqlite.exec(schema);
console.log('✅ Esquema creado');

// Función auxiliar para insertar o ignorar (idempotente)
const insertOrIgnore = (table, data) => {
  const keys = Object.keys(data);
  const values = Object.values(data);
  const placeholders = keys.map(() => '?').join(', ');
  const sql = `INSERT OR IGNORE INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`;
  const stmt = sqlite.prepare(sql);
  stmt.run(...values);
};

// Migrar usuarios
console.log('👥 Migrando usuarios...');
const userStmt = sqlite.prepare(`
  INSERT OR IGNORE INTO users (id, name, admin, disabled, created_at, last_reminder, last_fee_reminder)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
for (const user of db.users) {
  userStmt.run(
    user.id,
    user.name,
    user.admin ? 1 : 0,
    user.disabled ? 1 : 0,
    user.created || Date.now(),
    user.lastReminder || null,
    user.lastFeeReminder || null
  );
}
console.log(`✅ ${db.users.length} usuarios migrados`);

// Migrar credenciales
console.log('🔑 Migrando credenciales...');
const credStmt = sqlite.prepare(`
  INSERT OR IGNORE INTO credentials (id, user_id, public_key, counter, transports, created_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);
for (const cred of db.creds) {
  credStmt.run(
    cred.id,
    cred.userId,
    cred.publicKey,
    cred.counter || 0,
    cred.transports ? JSON.stringify(cred.transports) : null,
    cred.created || Date.now()
  );
}
console.log(`✅ ${db.creds.length} credenciales migradas`);

// Migrar suscripciones
console.log('📱 Migrando suscripciones...');
const subStmt = sqlite.prepare(`
  INSERT OR IGNORE INTO subscriptions (endpoint, user_id, keys, created_at)
  VALUES (?, ?, ?, ?)
`);
for (const sub of db.subs) {
  subStmt.run(
    sub.endpoint,
    sub.userId,
    JSON.stringify(sub.keys),
    sub.created || Date.now()
  );
}
console.log(`✅ ${db.subs.length} suscripciones migradas`);

// Migrar invites
console.log('🎫 Migrando invites...');
const inviteStmt = sqlite.prepare(`
  INSERT OR IGNORE INTO invites (code, created_by, used_by, revoked, created_at)
  VALUES (?, ?, ?, ?, ?)
`);
for (const invite of db.invites) {
  inviteStmt.run(
    invite.code,
    invite.createdBy,
    invite.usedBy || null,
    invite.revoked ? 1 : 0,
    invite.created || Date.now()
  );
}
console.log(`✅ ${db.invites.length} invites migrados`);

// Migrar presets
console.log('📋 Migrando presets...');
const presetStmt = sqlite.prepare(`
  INSERT OR IGNORE INTO presets (id, name, emoji)
  VALUES (?, ?, ?)
`);
const presetExStmt = sqlite.prepare(`
  INSERT OR IGNORE INTO preset_exercises (preset_id, exercise_id, sets, reps, weight, mode, min, speed, sec, bodyweight, side)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);
for (const preset of db.presets) {
  presetStmt.run(preset.id, preset.name, preset.emoji);
  for (const ex of preset.ex || []) {
    presetExStmt.run(
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
      ex.side ? 1 : 0
    );
  }
}
console.log(`✅ ${db.presets.length} presets migrados`);

// Migrar estados de usuarios (state-<uid>.json)
console.log('📊 Migrando estados de usuarios...');
const stateFiles = fs.readdirSync(DATA).filter(f => f.startsWith('state-') && f.endsWith('.json'));

const stateStmt = sqlite.prepare(`
  INSERT OR REPLACE INTO user_state (
    user_id, _ts, unit, rest_sec, rest_pause_sec, sound, keep_awake, lang, theme, accent,
    body, target_w, estado_inicial, onboarding_completado, onboarding_stats_completado, edad, altura, objetivo, grasa_corporal, nivel, peso_kg, configuracion,
    respuestas_encuesta, rutina_generada, fecha_ultima_encuesta, effort, auto_backup,
    active_equip_id, equip_filter_on
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const routineStmt = sqlite.prepare(`
  INSERT OR IGNORE INTO routines (id, user_id, name, emoji, created_at)
  VALUES (?, ?, ?, ?, ?)
`);

const routineExStmt = sqlite.prepare(`
  INSERT OR IGNORE INTO routine_exercises (routine_id, exercise_id, position, sg, sets, reps, weight, mode, min, speed, sec, bodyweight, side, note)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const weekStmt = sqlite.prepare(`
  INSERT OR REPLACE INTO week_plan (user_id, day_index, routine_id)
  VALUES (?, ?, ?)
`);

const dayPlanStmt = sqlite.prepare(`
  INSERT OR REPLACE INTO day_plan (user_id, date, routine_id)
  VALUES (?, ?, ?)
`);

const workoutStmt = sqlite.prepare(`
  INSERT OR IGNORE INTO workouts (id, user_id, date, start, end, routine_id, name, bw, vol, note, partial)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const entryStmt = sqlite.prepare(`
  INSERT OR IGNORE INTO workout_entries (workout_id, exercise_id, top_w, target, note, note_pin, muscle_snapshot)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const setStmt = sqlite.prepare(`
  INSERT OR IGNORE INTO workout_sets (entry_id, w, r, sec, min, speed, done, rir, rpe)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const exWeightStmt = sqlite.prepare(`
  INSERT OR REPLACE INTO exercise_weights (user_id, exercise_id, w, date)
  VALUES (?, ?, ?, ?)
`);

const bodyweightStmt = sqlite.prepare(`
  INSERT OR IGNORE INTO bodyweight (user_id, date, w, t)
  VALUES (?, ?, ?, ?)
`);

const customExStmt = sqlite.prepare(`
  INSERT OR IGNORE INTO custom_exercises (id, user_id, n, tipo, equipamiento, grupo_muscular, bp, eq, tg, mg, sm, st, created_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const exNoteStmt = sqlite.prepare(`
  INSERT OR REPLACE INTO exercise_notes (user_id, exercise_id, note)
  VALUES (?, ?, ?)
`);

const reminderStmt = sqlite.prepare(`
  INSERT OR REPLACE INTO reminder_settings (user_id, "on", time, tz, fee_on, fee_interval, fee_date)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const equipProfileStmt = sqlite.prepare(`
  INSERT OR IGNORE INTO equip_profiles (id, user_id, name, equipment, created_at)
  VALUES (?, ?, ?, ?, ?)
`);

let totalStates = 0;
for (const file of stateFiles) {
  const uid = file.replace('state-', '').replace('.json', '');
  const statePath = path.join(DATA, file);
  try {
    const S = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    totalStates++;

    const validRoutineIds = new Set((S.routines || []).map(r => String(r?.id || '')).filter(Boolean));

    // User state
    stateStmt.run(
      uid,
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
      S.equipFilterOn ? 1 : 0
    );

    // Routines
    for (const routine of S.routines || []) {
      routineStmt.run(routine.id, uid, routine.name, routine.emoji || 'dumbbell', routine.created || Date.now());
      for (let i = 0; i < (routine.ex || []).length; i++) {
        const ex = routine.ex[i];
        routineExStmt.run(
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
          ex.note || null
        );
      }
    }

    // Week plan
    if (S.week) {
      for (const [dayIndex, routineId] of Object.entries(S.week)) {
        const nextRoutineId = validRoutineIds && routineId ? (validRoutineIds.has(String(routineId)) ? String(routineId) : null) : (routineId || null);
        weekStmt.run(uid, parseInt(dayIndex), nextRoutineId);
      }
    }

    // Day plan
    if (S.dayPlan) {
      for (const [date, routineId] of Object.entries(S.dayPlan)) {
        const nextRoutineId = validRoutineIds && routineId ? (validRoutineIds.has(String(routineId)) ? String(routineId) : null) : (routineId || null);
        dayPlanStmt.run(uid, date, nextRoutineId);
      }
    }

    // Workouts
    for (const workout of S.workouts || []) {
      const nextRoutineId = validRoutineIds && workout?.routineId ? (validRoutineIds.has(String(workout.routineId)) ? String(workout.routineId) : null) : (workout?.routineId || null);
      workoutStmt.run(
        workout.id,
        uid,
        workout.d,
        workout.start,
        workout.end,
        nextRoutineId,
        workout.name,
        workout.bw || null,
        workout.vol || null,
        workout.note || null,
        workout.partial ? 1 : 0
      );

      // Entries
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

        // Sets
        const entryId = sqlite.prepare('SELECT id FROM workout_entries WHERE workout_id = ? AND exercise_id = ? LIMIT 1')
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

    // Exercise weights
    if (S.exWeights) {
      for (const [exId, data] of Object.entries(S.exWeights)) {
        exWeightStmt.run(uid, exId, data.w, data.d);
      }
    }

    // Bodyweight
    for (const bw of S.bodyweight || []) {
      bodyweightStmt.run(uid, bw.d, bw.w, bw.t);
    }

    // Custom exercises
    for (const ex of S.customEx || []) {
      const equipArr = Array.isArray(ex.equipamiento) ? ex.equipamiento : (ex.eq ? [ex.eq] : null);
      customExStmt.run(
        ex.id,
        uid,
        ex.n,
        ex.tipo || 'fuerza',
        equipArr ? JSON.stringify(equipArr) : (ex.equipamiento ? JSON.stringify(ex.equipamiento) : null),
        ex.grupo_muscular || ex.tg || ex.bp || null,
        ex.bp || null,
        ex.eq || null,
        ex.tg || null,
        ex.mg || null,
        ex.sm ? JSON.stringify(ex.sm) : null,
        ex.st ? JSON.stringify(ex.st) : null,
        ex.created || Date.now()
      );
    }

    // Exercise notes
    if (S.exNotes) {
      for (const [exId, note] of Object.entries(S.exNotes)) {
        exNoteStmt.run(uid, exId, note);
      }
    }

    // Reminder settings
    if (S.reminder) {
      reminderStmt.run(
        uid,
        S.reminder.on ? 1 : 0,
        S.reminder.time || null,
        S.reminder.tz || null,
        S.reminder.feeOn ? 1 : 0,
        S.reminder.feeInterval || 'monthly',
        S.reminder.feeDate || null
      );
    }

    // Equipment profiles
    for (const profile of S.equipProfiles || []) {
      equipProfileStmt.run(
        profile.id,
        uid,
        profile.name,
        JSON.stringify(profile.equipment),
        profile.created || Date.now()
      );
    }

  } catch (e) {
    console.error(`❌ Error migrando ${file}:`, e.message);
  }
}
console.log(`✅ ${totalStates} estados de usuarios migrados`);

// Verificar migración
console.log('🔍 Verificando migración...');
const userCount = sqlite.prepare('SELECT COUNT(*) as c FROM users').get().c;
const workoutCount = sqlite.prepare('SELECT COUNT(*) as c FROM workouts').get().c;
const routineCount = sqlite.prepare('SELECT COUNT(*) as c FROM routines').get().c;

console.log(`📊 Estadísticas finales:`);
console.log(`   - Usuarios: ${userCount}`);
console.log(`   - Workouts: ${workoutCount}`);
console.log(`   - Rutinas: ${routineCount}`);

sqlite.close();
console.log('✅ Migración completada exitosamente!');
console.log('📝 Backup original guardado en:', backupFile);
console.log('⚠️  Puedes eliminar db.json manualmente después de verificar que todo funciona correctamente');
