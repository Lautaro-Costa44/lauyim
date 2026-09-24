
-- Usuarios
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  admin INTEGER DEFAULT 0,
  owner INTEGER DEFAULT 0,
  disabled INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,  -- timestamp ms
  last_reminder TEXT,           -- ISO date
  last_fee_reminder TEXT        -- ISO date
);
 
-- Índices para usuarios
CREATE INDEX IF NOT EXISTS idx_users_admin ON users(admin);
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_single_owner ON users(owner) WHERE owner = 1;
CREATE INDEX IF NOT EXISTS idx_users_disabled ON users(disabled);
 
-- Credenciales WebAuthn
CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  counter INTEGER DEFAULT 0,
  transports TEXT,           -- JSON array
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
 
-- Índices para credenciales
CREATE INDEX IF NOT EXISTS idx_credentials_user_id ON credentials(user_id);
 
-- Suscripciones Web Push
CREATE TABLE IF NOT EXISTS subscriptions (
  endpoint TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  keys TEXT NOT NULL,         -- JSON object
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
 
-- Índices para suscripciones
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
 
-- Invites
CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  used_by TEXT,               -- user_id
  revoked INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id),
  FOREIGN KEY (used_by) REFERENCES users(id)
);
 
-- Índices para invites
CREATE INDEX IF NOT EXISTS idx_invites_used_by ON invites(used_by);
CREATE INDEX IF NOT EXISTS idx_invites_revoked ON invites(revoked);
 
-- Presets de rutinas
CREATE TABLE IF NOT EXISTS presets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  group_name TEXT NOT NULL DEFAULT 'General',
  planned_day INTEGER
);

-- Migración para bases existentes (CREATE TABLE IF NOT EXISTS no modifica tablas ya creadas):
-- ALTER TABLE users ADD COLUMN owner INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE presets ADD COLUMN planned_day INTEGER;
 
-- Ejercicios de presets
CREATE TABLE IF NOT EXISTS preset_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  preset_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  sets INTEGER NOT NULL,
  reps INTEGER,
  weight REAL DEFAULT 0,
  mode TEXT DEFAULT 'reps',  -- 'reps', 'time', 'cardio'
  min INTEGER,               -- para cardio
  speed REAL,                -- para cardio
  sec INTEGER,               -- para time
  bodyweight INTEGER DEFAULT 0,
  side INTEGER DEFAULT 0,
  progression_type TEXT NULL,
  progression_config TEXT NULL,
  FOREIGN KEY (preset_id) REFERENCES presets(id) ON DELETE CASCADE
);
 
-- Índices para preset_exercises
CREATE INDEX IF NOT EXISTS idx_preset_exercises_preset_id ON preset_exercises(preset_id);
 
-- ============================================================
-- Tablas de estado por usuario (antes en state-<uid>.json)
-- ============================================================
 
-- Estado principal del usuario (metadata)
CREATE TABLE IF NOT EXISTS user_state (
  user_id TEXT PRIMARY KEY,
  _ts INTEGER NOT NULL,      -- timestamp ms
  unit TEXT DEFAULT 'kg',
  rest_sec INTEGER DEFAULT 90,
  rest_pause_sec INTEGER DEFAULT 15,
  sound INTEGER DEFAULT 1,
  keep_awake INTEGER DEFAULT 1,
  lang TEXT DEFAULT 'es',
  theme TEXT DEFAULT 'dark',
  accent TEXT DEFAULT 'lime',
  body TEXT DEFAULT 'male',
  genero TEXT DEFAULT 'masculino',
  gif_size TEXT DEFAULT 'full',
  default_intensifier TEXT,
  default_sets INTEGER DEFAULT 3,
  target_w REAL,
  estado_inicial TEXT DEFAULT 'pendiente',
  onboarding_completado INTEGER DEFAULT 0,
  onboarding_stats_completado INTEGER DEFAULT 0,
  onboarding_nutrition_completado INTEGER DEFAULT 0,
  edad INTEGER,
  altura INTEGER,
  objetivo TEXT,
  grasa_corporal REAL,
  nivel TEXT,
  peso_kg REAL,
  configuracion TEXT,        -- JSON
  respuestas_encuesta TEXT,  -- JSON
  rutina_generada TEXT,      -- JSON
  fecha_ultima_encuesta TEXT,
  effort TEXT,               -- 'none', 'rir', 'rpe'
  auto_backup INTEGER DEFAULT 0,
  active_equip_id TEXT,
  equip_filter_on INTEGER DEFAULT 0,
  routine_groups TEXT,
  active_group_id TEXT,
  sync_versions TEXT,
  progression_tips INTEGER DEFAULT 1,
  progression_type TEXT NULL,
  progression_config TEXT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
 
-- COMANDOS ALTER TABLE PARA BASES YA EXISTENTES (user_state):
-- ALTER TABLE user_state ADD COLUMN onboarding_completado INTEGER DEFAULT 0;
-- ALTER TABLE user_state ADD COLUMN onboarding_stats_completado INTEGER DEFAULT 0;
-- ALTER TABLE user_state ADD COLUMN onboarding_nutrition_completado INTEGER DEFAULT 0;
 
-- Rutinas
CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  emoji TEXT DEFAULT 'dumbbell',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
 
-- Índices para rutinas
CREATE INDEX IF NOT EXISTS idx_routines_user_id ON routines(user_id);
 
-- Ejercicios de rutinas
CREATE TABLE IF NOT EXISTS routine_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  routine_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  position INTEGER NOT NULL,  -- orden en la rutina
  sg TEXT,                    -- superset group
  sets INTEGER,
  reps INTEGER,
  weight REAL,
  mode TEXT DEFAULT 'reps',
  min INTEGER,
  speed REAL,
  sec INTEGER,
  bodyweight INTEGER DEFAULT 0,
  side INTEGER DEFAULT 0,
  note TEXT,
  progression_type TEXT NULL,
  progression_config TEXT NULL,
  FOREIGN KEY (routine_id) REFERENCES routines(id) ON DELETE CASCADE
);
 
-- Índices para routine_exercises
CREATE INDEX IF NOT EXISTS idx_routine_exercises_routine_id ON routine_exercises(routine_id);
 
-- Plan semanal (week)
CREATE TABLE IF NOT EXISTS week_plan (
  user_id TEXT NOT NULL,
  day_index INTEGER NOT NULL,  -- 0-6 (Domingo-Sábado)
  routine_id TEXT,
  PRIMARY KEY (user_id, day_index),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (routine_id) REFERENCES routines(id) ON DELETE SET NULL
);
 
-- Plan de día específico (dayPlan)
CREATE TABLE IF NOT EXISTS day_plan (
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,          -- ISO date
  routine_id TEXT,
  PRIMARY KEY (user_id, date),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (routine_id) REFERENCES routines(id) ON DELETE SET NULL
);
 
-- Índices para day_plan
CREATE INDEX IF NOT EXISTS idx_day_plan_user_id ON day_plan(user_id);
CREATE INDEX IF NOT EXISTS idx_day_plan_date ON day_plan(date);
 
-- Sesiones de entrenamiento (workouts)
CREATE TABLE IF NOT EXISTS workouts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,          -- ISO date
  start INTEGER NOT NULL,      -- timestamp ms
  end INTEGER NOT NULL,        -- timestamp ms
  routine_id TEXT,
  name TEXT NOT NULL,
  bw REAL,                     -- bodyweight
  vol REAL,                    -- volumen total
  note TEXT,
  partial INTEGER DEFAULT 0,   -- 1 si el entrenamiento fue finalizado parcialmente
  meta TEXT,                   -- JSON de claves sin columna propia (prs, routineGroupId, ...)
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (routine_id) REFERENCES routines(id) ON DELETE SET NULL
);
 
-- COMANDOS ALTER TABLE PARA BASES YA EXISTENTES (workouts):
-- ALTER TABLE workouts ADD COLUMN partial INTEGER DEFAULT 0;
 
-- Índices para workouts (CRÍTICO para calendario y fatiga)
CREATE INDEX IF NOT EXISTS idx_workouts_user_id ON workouts(user_id);
CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(date);
CREATE INDEX IF NOT EXISTS idx_workouts_start ON workouts(start);
 
-- Entries de workouts (ejercicios en una sesión)
CREATE TABLE IF NOT EXISTS workout_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workout_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  top_w REAL,                  -- mejor peso
  target TEXT,                -- JSON (configuración objetivo)
  note TEXT,
  note_pin INTEGER DEFAULT 0,
  muscle_snapshot TEXT,        -- JSON (para ejercicios custom)
  FOREIGN KEY (workout_id) REFERENCES workouts(id) ON DELETE CASCADE
);
 
-- Índices para workout_entries
CREATE INDEX IF NOT EXISTS idx_workout_entries_workout_id ON workout_entries(workout_id);
 
-- Sets de workout entries
CREATE TABLE IF NOT EXISTS workout_sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  w REAL,                      -- peso
  r INTEGER,                   -- reps
  sec INTEGER,                 -- segundos (para time)
  min INTEGER,                 -- minutos (para cardio)
  speed REAL,                  -- velocidad (para cardio)
  done INTEGER DEFAULT 0,
  rir REAL,                    -- reps in reserve
  rpe REAL,                    -- effort percibido
  meta TEXT,                   -- JSON de claves sin columna propia (ver row-meta.js)
  FOREIGN KEY (entry_id) REFERENCES workout_entries(id) ON DELETE CASCADE
);
 
-- Índices para workout_sets
CREATE INDEX IF NOT EXISTS idx_workout_sets_entry_id ON workout_sets(entry_id);
 
-- Pesos máximos por ejercicio (exWeights)
CREATE TABLE IF NOT EXISTS exercise_weights (
  user_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  w REAL NOT NULL,             -- peso máximo
  date TEXT NOT NULL,          -- ISO date
  PRIMARY KEY (user_id, exercise_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
 
-- Índices para exercise_weights
CREATE INDEX IF NOT EXISTS idx_exercise_weights_user_id ON exercise_weights(user_id);
 
-- Peso corporal histórico
CREATE TABLE IF NOT EXISTS bodyweight (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,          -- ISO date
  w REAL NOT NULL,             -- peso
  t INTEGER NOT NULL,         -- timestamp ms
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
 
-- Índices para bodyweight
CREATE INDEX IF NOT EXISTS idx_bodyweight_user_id ON bodyweight(user_id);
CREATE INDEX IF NOT EXISTS idx_bodyweight_date ON bodyweight(date);
 
-- Ejercicios custom del usuario
CREATE TABLE IF NOT EXISTS custom_exercises (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  n TEXT NOT NULL,             -- nombre
  tipo TEXT DEFAULT 'fuerza',  -- 'fuerza' | 'cardio' | 'estiramiento'
  equipamiento TEXT,           -- JSON array (equipamiento necesario)
  grupo_muscular TEXT,         -- grupo muscular / target principal
  bp TEXT,                     -- body part (compatibilidad)
  eq TEXT,                     -- equipment (compatibilidad)
  tg TEXT,                     -- target group (compatibilidad)
  mg TEXT,                     -- main muscle
  sm TEXT,                     -- JSON array (secondary muscles)
  st TEXT,                     -- JSON array (instructions)
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
 
-- COMANDOS ALTER TABLE PARA BASES YA EXISTENTES (custom_exercises):
-- ALTER TABLE custom_exercises ADD COLUMN tipo TEXT DEFAULT 'fuerza';
-- ALTER TABLE custom_exercises ADD COLUMN equipamiento TEXT;
-- ALTER TABLE custom_exercises ADD COLUMN grupo_muscular TEXT;
 
-- Índices para custom_exercises
CREATE INDEX IF NOT EXISTS idx_custom_exercises_user_id ON custom_exercises(user_id);
 
-- Notas por ejercicio (exNotes)
CREATE TABLE IF NOT EXISTS exercise_notes (
  user_id TEXT NOT NULL,
  exercise_id TEXT NOT NULL,
  note TEXT NOT NULL,
  PRIMARY KEY (user_id, exercise_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
 
-- Índices para exercise_notes
CREATE INDEX IF NOT EXISTS idx_exercise_notes_user_id ON exercise_notes(user_id);
 
-- Reminder settings
CREATE TABLE IF NOT EXISTS reminder_settings (
  user_id TEXT PRIMARY KEY,
  "on" INTEGER DEFAULT 0,
  time TEXT,                   -- HH:MM
  tz TEXT,                     -- timezone IANA
  fee_on INTEGER DEFAULT 0,
  fee_interval TEXT DEFAULT 'monthly',
  fee_date TEXT,               -- ISO date
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
 
-- Perfiles de equipamiento
CREATE TABLE IF NOT EXISTS equip_profiles (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  equipment TEXT NOT NULL,     -- JSON array
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
 
-- Índices para equip_profiles
CREATE INDEX IF NOT EXISTS idx_equip_profiles_user_id ON equip_profiles(user_id);

-- Caché de búsquedas de alimentos de Open Food Facts
CREATE TABLE IF NOT EXISTS cache_alimentos (
  query TEXT PRIMARY KEY,
  resultado_json TEXT NOT NULL,
  fecha_cache TEXT NOT NULL
);

-- Comidas registradas por usuario y día
CREATE TABLE IF NOT EXISTS comidas_registradas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  grupo_id TEXT,
  grupo_nombre TEXT,
  fecha TEXT NOT NULL,
  franja TEXT NOT NULL,
  nombre_alimento TEXT NOT NULL,
  cantidad_gramos REAL NOT NULL,
  calorias REAL NOT NULL,
  proteina REAL NOT NULL,
  carbohidratos REAL NOT NULL,
  grasas REAL NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CHECK (franja IN ('desayuno', 'almuerzo', 'merienda', 'cena', 'extra'))
);

-- Índices para comidas registradas
CREATE INDEX IF NOT EXISTS idx_comidas_registradas_user_id ON comidas_registradas(user_id);
CREATE INDEX IF NOT EXISTS idx_comidas_registradas_fecha ON comidas_registradas(fecha);
CREATE INDEX IF NOT EXISTS idx_comidas_registradas_user_fecha ON comidas_registradas(user_id, fecha);

-- Plantillas de comidas compuestas reutilizables
CREATE TABLE IF NOT EXISTS plantillas_comida (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  nombre TEXT NOT NULL,
  categoria TEXT,
  franjas_recomendadas TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  scope TEXT NOT NULL DEFAULT 'user',
  enabled INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  assigned_by TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- COMANDO ALTER TABLE PARA BASES YA EXISTENTES (plantillas_comida):
-- ALTER TABLE plantillas_comida ADD COLUMN categoria TEXT;
-- ALTER TABLE plantillas_comida ADD COLUMN franjas_recomendadas TEXT;
-- ALTER TABLE plantillas_comida ADD COLUMN updated_at INTEGER;
-- ALTER TABLE plantillas_comida ADD COLUMN scope TEXT NOT NULL DEFAULT 'user';
-- ALTER TABLE plantillas_comida ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
-- ALTER TABLE plantillas_comida ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
-- ALTER TABLE plantillas_comida ADD COLUMN assigned_by TEXT;

CREATE TABLE IF NOT EXISTS plantillas_ingredientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  plantilla_id INTEGER NOT NULL,
  nombre_alimento TEXT NOT NULL,
  cantidad_gramos REAL NOT NULL,
  calorias REAL NOT NULL,
  proteina REAL NOT NULL,
  carbohidratos REAL NOT NULL,
  grasas REAL NOT NULL,
  FOREIGN KEY (plantilla_id) REFERENCES plantillas_comida(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_plantillas_comida_user_id ON plantillas_comida(user_id);
CREATE INDEX IF NOT EXISTS idx_plantillas_ingredientes_plantilla_id ON plantillas_ingredientes(plantilla_id);

-- Idempotency keys for offline mutations retried after reconnecting.
CREATE TABLE IF NOT EXISTS sync_operations (
  user_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  result_json TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, op_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Ajustes globales del panel Admin.
CREATE TABLE IF NOT EXISTS admin_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Cuotas v1. Montos en pesos enteros; fechas de calendario 'YYYY-MM-DD' en la tz del gym
-- (admin_settings.gym_tz); instantes en ms.
-- Los planes no se borran: uno inactivo no se asigna, pero quien ya lo tiene lo conserva.
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  duration_days INTEGER NOT NULL CHECK (duration_days > 0),
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER,
  updated_at INTEGER
);

-- Plan y vencimiento vigentes de cada socio; se va con el socio.
-- push_sent_for_due: vencimiento para el que ya salió el aviso push (uno por período).
CREATE TABLE IF NOT EXISTS member_billing (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_id INTEGER REFERENCES plans(id),
  due_date TEXT,
  push_sent_for_due TEXT,
  updated_at INTEGER
);

-- Historial de pagos. Sin FK a users a propósito: el registro contable sobrevive al borrado
-- del socio, por eso guarda nombre y plan como snapshot.
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  user_name TEXT,
  plan_id INTEGER,
  plan_name TEXT,
  amount INTEGER NOT NULL CHECK (amount > 0),
  method TEXT,
  paid_at INTEGER,
  period_start TEXT,
  period_end TEXT,
  note TEXT,
  created_by TEXT,
  created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_payments_user_paid ON payments(user_id, paid_at);
