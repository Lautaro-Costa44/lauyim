# Cierre del gimnasio más allá de las clases: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sacar el cierre del gimnasio del módulo de clases. Debe tener permiso propio, aviso general por push a una hora configurable, cartel y banner para el socio, racha que descuenta los días cerrados y extensión opcional (reversible) de vencimientos.

**Architecture:**
- **Backend:**
  - Módulo puro `api/closures.js`: validación, hora del aviso, elegibilidad de extensión, días a sumar al anular.
  - Datos en `api/closures-db.js`: la tabla `class_closures` con columnas nuevas y `closure_extensions`.
  - Rutas en `api/closures-routes.js`, que server.js suma como hace con `classRoutes`.
  - El scheduler envía los avisos pendientes.
- **Frontend:**
  - Store chico `useClosures`, fuera de `S` y sin sincronizar con `PUT /api/data`.
  - `lib/history.js` recibe los cierres para calcular la racha.
  - Componentes nuevos de aviso para el socio y tarjeta en Admin → Resumen.

**Tech Stack:**
- Backend: Node `node:http` + `node:sqlite`; tests con `node --test`.
- Frontend: React 19 + Zustand + Vite; tests con Vitest + happy-dom.

**Spec:** `docs/superpowers/specs/2026-10-09-cierres-gym-design.md`

## Global Constraints

- Textos de la UI en español rioplatense con voseo, como el resto de la app ("Revisá", "Tocá", "Podés"). Las cadenas en español no necesitan entrada en `locales/es.js` (`t()` devuelve la clave); solo las claves en inglés la necesitan.
- El nombre del producto va siempre en minúscula: `lauyim`.
- Fechas `YYYY-MM-DD` y horas `HH:MM` en la zona del gimnasio (`gym_tz`, `getBillingSettings(db).gym_tz`). Nunca la fecha del celular para decidir "hoy está cerrado".
- Un cierre dura de 1 a 31 días (`CLOSURE_MAX_DAYS = 31`), de hoy en adelante, sin superponerse, con motivo de hasta 40 caracteres.
- `closure_notify_hour` vale `08:00` por defecto.
- El cierre nunca bloquea nada en la app ni en el check-in.
- localStorage siempre con try/catch.
- Backend: `cd api && node --test <archivo>`. Todo: `cd api && npm test`.
- Frontend: `cd frontend && npx vitest run <archivo>`. Todo: `cd frontend && npm test && npm run build && node scripts/check-locales.mjs`.
- Commits en inglés, Conventional Commits. Cada uno termina con la línea `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Rama: `feat/cierres` (ya existe, con la spec commiteada).

---

### Task 1: Permiso `gym.closures` y su migración

**Files:**
- Modify: `api/permissions.js` (catálogo `PERMISSIONS`; `ROUTE_PERMISSIONS`)
- Modify: `api/database.js:489-495` (`migrateRolePerms`)
- Test: `api/permissions.test.js`, `api/roles-db.test.js`

**Interfaces:**
- Produces:
  - el código de permiso `'gym.closures'`;
  - las entradas de ruta `GET /api/admin/closures`, `GET /api/admin/closures/preview`, `POST /api/admin/closures` y `POST /api/admin/closures/delete`, que se usan en la Task 4.

- [ ] **Step 1: Tests que fallan**

En `api/permissions.test.js`, agregar:

```js
test('gym.closures: en el catálogo (Operación), sin dependencias, y las rutas de cierres lo piden', () => {
  const p = PERMISSIONS.find(x => x.code === 'gym.closures');
  assert.ok(p, 'falta gym.closures');
  assert.equal(p.area, 'Operación');
  assert.deepEqual(p.requires, []);
  assert.equal(ROUTE_PERMISSIONS['POST /api/admin/closures'], 'gym.closures');
  assert.equal(ROUTE_PERMISSIONS['POST /api/admin/closures/delete'], 'gym.closures');
  assert.equal(ROUTE_PERMISSIONS['GET /api/admin/closures/preview'], 'gym.closures');
  assert.deepEqual(ROUTE_PERMISSIONS['GET /api/admin/closures'], ['gym.closures', 'stats.view', 'classes.view_all', 'classes.attendance']);
  assert.equal(ROUTE_PERMISSIONS['POST /api/admin/classes/closures'], undefined);
  assert.ok(DEFAULT_ROLES.find(r => r.id === 'admin').permissions.includes('gym.closures'));
});
```

Si el archivo no importa `PERMISSIONS`, `ROUTE_PERMISSIONS` o `DEFAULT_ROLES`, sumarlos al `import` de `./permissions.js` que ya tiene.

En `api/roles-db.test.js`, agregar un test con el mismo armado que los demás del archivo (directorio temporal, `initDatabase`):

```js
test('migración closures_perm_seeded: quien tenía classes.manage recibe gym.closures, una sola vez', () => {
  const db = getDatabase();
  const custom = saveRole({ name: 'Jefa de clases', color: '#112233', permissions: ['classes.manage'] });
  db.prepare("DELETE FROM admin_settings WHERE key = 'closures_perm_seeded'").run();
  closeDatabase(); initDatabase();
  assert.ok(getRoleById(custom.id).permissions.includes('gym.closures'));
  // Si el owner se lo saca, no vuelve.
  saveRole({ id: custom.id, name: 'Jefa de clases', color: '#112233', permissions: ['classes.manage'] });
  closeDatabase(); initDatabase();
  assert.ok(!getRoleById(custom.id).permissions.includes('gym.closures'));
});
```

Antes de escribirlo, revisar en `api/database.js` cómo se llaman `saveRole` y `getRoleById` (`grep -n "export function saveRole\|export function getRole" api/database.js`) y usar esos nombres exactos.

- [ ] **Step 2: Verificar que fallan**

Run: `cd api && node --test permissions.test.js roles-db.test.js`
Expected: FAIL (`falta gym.closures`).

- [ ] **Step 3: Implementar**

En `api/permissions.js`, dentro de `PERMISSIONS`, justo antes de `audit.view`:

```js
  { code: 'gym.closures', area: 'Operación', name: 'Cerrar el gimnasio', help: 'Feriados y vacaciones: cerrar y reabrir, y avisar a los socios.', requires: [] },
```

En `ROUTE_PERMISSIONS`:
- Borrar las cuatro entradas `'... /api/admin/classes/closures...'`.
- Agregar, después de `'GET /api/admin/audit': 'audit.view',`:

```js
  // Cierres del gimnasio (closures-routes.js). Ver la lista: cualquiera que vea Resumen o Clases.
  'GET /api/admin/closures': ['gym.closures', 'stats.view', 'classes.view_all', 'classes.attendance'],
  'GET /api/admin/closures/preview': 'gym.closures',
  'POST /api/admin/closures': 'gym.closures',
  'POST /api/admin/closures/delete': 'gym.closures',
```

En `api/database.js`, después del último `migrateRolePerms('classes_perms_v2', …)`:

```js
  // Cierres del gimnasio con permiso propio (antes los hacía classes.manage): quien podía cerrar
  // sigue pudiendo. Una sola vez; si el owner se lo saca, no vuelve.
  if (!db.prepare("SELECT value FROM admin_settings WHERE key = 'closures_perm_seeded'").get()) {
    for (const row of db.prepare('SELECT id, permissions FROM roles').all()) {
      const perms = JSON.parse(row.permissions || '[]');
      if (row.id === ADMIN_ROLE_ID || perms.includes('classes.manage')) {
        db.prepare('UPDATE roles SET permissions = ? WHERE id = ?').run(JSON.stringify(withDependencies([...perms, 'gym.closures'])), row.id);
      }
    }
    db.prepare("INSERT INTO admin_settings (key, value, updated_at) VALUES ('closures_perm_seeded', 'true', ?)").run(Date.now());
  }
```

- [ ] **Step 4: Verificar que pasan**

Run: `cd api && node --test permissions.test.js roles-db.test.js route-permissions.test.js`
Expected: PASS.

`route-permissions.test.js` puede quejarse porque las rutas viejas siguen en `classes-routes.js` sin entrada. En ese caso, borrar ya en este task los cuatro handlers `'… /api/admin/classes/closures…'` de `api/classes-routes.js` (líneas ~709-746). La Task 4 crea los nuevos.

- [ ] **Step 5: Commit**

```bash
git add api/permissions.js api/database.js api/permissions.test.js api/roles-db.test.js api/classes-routes.js
git commit -m "feat(closures): own gym.closures permission with role migration"
```

---

### Task 2: Lógica pura de cierres (`api/closures.js`)

**Files:**
- Create: `api/closures.js`
- Modify: `api/classes.js:215-227` (sacar `validateClosure` y `CLOSURE_MAX_DAYS`; re-exportar)
- Test: `api/closures.test.js`

**Interfaces:**
- Consumes:
  - `zonedToEpoch(date, time, tz)` y `addDays(date, n)` de `./classes.js`;
  - `gymClock(now, tz)` y `billingStatus(billing, today, settings)` de `./billing.js`.
- Produces:
  - `CLOSURE_MAX_DAYS = 31`
  - `closureDays({ from, to }) → number`
  - `validateClosure(body, { today, existing }) → { value: { from, to, reason } } | { error, field?, message }`
  - `closureOptions(body, { days }) → { value: { notifyAll: boolean, extendDays: number } } | { error, field, message }`
  - `announceAtFor({ from, nowMs, notifyHour, tz }) → number` (epoch ms)
  - `extensionTargets(rows, today, settings, isExempt) → [{ userId, field: 'due'|'trial', before }]`
  - `extensionDaysSince(extensions, sinceMs) → number`

- [ ] **Step 1: Tests que fallan**

Crear `api/closures.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { closureDays, validateClosure, closureOptions, announceAtFor, extensionTargets, extensionDaysSince, CLOSURE_MAX_DAYS } from './closures.js';
import { gymClock } from './billing.js';

const TZ = 'America/Argentina/Buenos_Aires';   // UTC-3 fijo
const at = (date, time) => Date.parse(`${date}T${time}:00-03:00`);

test('closureDays cuenta los dos extremos', () => {
  assert.equal(closureDays({ from: '2026-10-12', to: '2026-10-12' }), 1);
  assert.equal(closureDays({ from: '2026-12-24', to: '2027-01-02' }), 10);
});

test('validateClosure: igual que antes (de hoy en adelante, hasta 31 días, sin superponerse, motivo corto)', () => {
  const today = '2026-10-09';
  assert.deepEqual(validateClosure({ from: '2026-10-12', reason: ' Feriado ' }, { today }).value, { from: '2026-10-12', to: '2026-10-12', reason: 'Feriado' });
  assert.equal(validateClosure({ from: '2026-10-08' }, { today }).field, 'from');
  assert.equal(validateClosure({ from: '2026-10-12', to: '2026-10-11' }, { today }).field, 'to');
  assert.equal(CLOSURE_MAX_DAYS, 31);
  assert.equal(validateClosure({ from: '2026-10-10', to: '2026-11-10' }, { today }).field, 'to');
  assert.equal(validateClosure({ from: '2026-10-12', reason: 'x'.repeat(41) }, { today }).field, 'reason');
  assert.equal(validateClosure({ from: '2026-10-12' }, { today, existing: [{ from: '2026-10-12', to: '2026-10-13' }] }).error, 'closure_overlap');
});

test('closureOptions: aviso prendido por defecto; extender de 0 a los días cerrados', () => {
  assert.deepEqual(closureOptions({}, { days: 3 }).value, { notifyAll: true, extendDays: 0 });
  assert.deepEqual(closureOptions({ notifyAll: false, extendDays: 3 }, { days: 3 }).value, { notifyAll: false, extendDays: 3 });
  assert.equal(closureOptions({ extendDays: 4 }, { days: 3 }).field, 'extendDays');
  assert.equal(closureOptions({ extendDays: 1.5 }, { days: 3 }).field, 'extendDays');
  assert.equal(closureOptions({ extendDays: -1 }, { days: 3 }).field, 'extendDays');
});

test('announceAtFor: la próxima hora de avisos, salvo que el cierre empiece antes', () => {
  // Creado a las 23:00 para mañana: sale mañana a las 08:00.
  assert.equal(announceAtFor({ from: '2026-10-10', nowMs: at('2026-10-09', '23:00'), notifyHour: '08:00', tz: TZ }), at('2026-10-10', '08:00'));
  // Creado a las 10:00 para hoy: sale en el momento.
  const now = at('2026-10-09', '10:00');
  assert.equal(announceAtFor({ from: '2026-10-09', nowMs: now, notifyHour: '08:00', tz: TZ }), now);
  // Creado a las 07:00 para hoy: sale hoy a las 08:00.
  assert.equal(announceAtFor({ from: '2026-10-09', nowMs: at('2026-10-09', '07:00'), notifyHour: '08:00', tz: TZ }), at('2026-10-09', '08:00'));
  // Creado a las 10:00 para dentro de una semana: mañana a las 08:00.
  assert.equal(announceAtFor({ from: '2026-10-16', nowMs: now, notifyHour: '08:00', tz: TZ }), at('2026-10-10', '08:00'));
  assert.equal(gymClock(at('2026-10-10', '08:00'), TZ).time, '08:00');
});

test('extensionTargets: al día y por vencer corren el vencimiento, prueba corre la prueba; el resto no', () => {
  const settings = { grace_days: 5, due_soon_days: 3, auto_block: true };
  const today = '2026-10-09';
  const rows = [
    { userId: 'aldia', planId: 1, dueDate: '2026-11-01', trialUntil: null, disabled: false, pending: false },
    { userId: 'porvencer', planId: 1, dueDate: '2026-10-11', trialUntil: null, disabled: false, pending: false },
    { userId: 'vencido', planId: 1, dueDate: '2026-10-07', trialUntil: null, disabled: false, pending: false },
    { userId: 'bloqueado', planId: 1, dueDate: '2026-09-01', trialUntil: null, disabled: false, pending: false },
    { userId: 'prueba', planId: null, dueDate: null, trialUntil: '2026-10-15', disabled: false, pending: false },
    { userId: 'sinplan', planId: null, dueDate: null, trialUntil: null, disabled: false, pending: false },
    { userId: 'exento', planId: 1, dueDate: '2026-11-01', trialUntil: null, disabled: false, pending: false },
    { userId: 'baja', planId: 1, dueDate: '2026-11-01', trialUntil: null, disabled: true, pending: false },
    { userId: 'pendiente', planId: 1, dueDate: '2026-11-01', trialUntil: null, disabled: false, pending: true }
  ];
  const out = extensionTargets(rows, today, settings, r => r.userId === 'exento');
  assert.deepEqual(out, [
    { userId: 'aldia', field: 'due', before: '2026-11-01' },
    { userId: 'porvencer', field: 'due', before: '2026-10-11' },
    { userId: 'prueba', field: 'trial', before: '2026-10-15' }
  ]);
});

test('extensionDaysSince: suma lo aplicado después del pago y no revertido', () => {
  const ext = [
    { field: 'due', days: 3, appliedAt: 100, revertedAt: null },
    { field: 'due', days: 2, appliedAt: 300, revertedAt: null },
    { field: 'due', days: 7, appliedAt: 400, revertedAt: 500 },
    { field: 'trial', days: 5, appliedAt: 300, revertedAt: null }
  ];
  assert.equal(extensionDaysSince(ext, 200), 2);
  assert.equal(extensionDaysSince(ext, 0), 5);
  assert.equal(extensionDaysSince([], 0), 0);
});
```

- [ ] **Step 2: Verificar que fallan**

Run: `cd api && node --test closures.test.js`
Expected: FAIL (`Cannot find module './closures.js'`).

- [ ] **Step 3: Implementar**

Crear `api/closures.js`:

```js
// Cierres del gimnasio (docs/superpowers/specs/2026-10-09-cierres-gym-design.md): lo puro. Validar
// fechas y opciones, cuándo sale el aviso general, a quién se le corre el vencimiento y cuántos días
// suma una extensión al anular un pago. Los datos están en closures-db.js; las rutas, en closures-routes.js.
import { addDays, zonedToEpoch } from './classes.js';
import { gymClock, billingStatus } from './billing.js';

export const CLOSURE_MAX_DAYS = 31;
const dayNumber = date => Date.parse(date + 'T00:00:00Z') / 86400000;
const isDay = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v + 'T00:00:00Z'));

export const closureDays = ({ from, to }) => dayNumber(to) - dayNumber(from) + 1;

// Un cierre: de hoy en adelante, de 1 a 31 días, sin pisar otro y con un motivo corto.
export function validateClosure(body, { today, existing = [] } = {}) {
  const from = body?.from, to = body?.to || body?.from;
  if (!isDay(from) || from < today) return { error: 'validation_error', field: 'from', message: 'Elegí una fecha de hoy en adelante' };
  if (!isDay(to) || to < from) return { error: 'validation_error', field: 'to', message: 'La fecha final tiene que ser igual o posterior' };
  if (closureDays({ from, to }) > CLOSURE_MAX_DAYS) return { error: 'validation_error', field: 'to', message: `Un cierre dura hasta ${CLOSURE_MAX_DAYS} días` };
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason.length > 40) return { error: 'validation_error', field: 'reason', message: 'El motivo admite hasta 40 letras' };
  if (existing.some(c => c.from <= to && from <= c.to)) return { error: 'closure_overlap', message: 'Ya hay un cierre en esos días' };
  return { value: { from, to, reason } };
}

// Avisar a todos (prendido salvo false explícito) y cuántos días correr los vencimientos (0 a días cerrados).
export function closureOptions(body, { days }) {
  const extendDays = body?.extendDays == null ? 0 : body.extendDays;
  if (!Number.isInteger(extendDays) || extendDays < 0 || extendDays > days) {
    return { error: 'validation_error', field: 'extendDays', message: `Los días a correr van de 0 a ${days}` };
  }
  return { value: { notifyAll: body?.notifyAll !== false, extendDays } };
}

// El aviso general sale la próxima vez que el reloj del gimnasio marque `notifyHour`. Si ese día ya
// es posterior al primero del cierre (un cierre para hoy creado después de la hora), sale ahora.
export function announceAtFor({ from, nowMs, notifyHour, tz }) {
  const clock = gymClock(nowMs, tz);
  const day = clock.time < notifyHour ? clock.date : addDays(clock.date, 1);
  if (day > from) return nowMs;
  return zonedToEpoch(day, notifyHour, tz);
}

// A quiénes se les corre la fecha: activos, no exentos, al día o por vencer (el vencimiento) o en
// prueba vigente (la prueba). Los vencidos y bloqueados ya debían antes del cierre.
// rows: getAllMemberBilling() (userId, planId, dueDate, trialUntil, disabled, pending).
export function extensionTargets(rows, today, settings, isExempt = () => false) {
  const out = [];
  for (const r of rows || []) {
    if (r.disabled || r.pending || isExempt(r)) continue;
    const status = billingStatus({ planId: r.planId, dueDate: r.dueDate, trialUntil: r.trialUntil }, today, settings);
    if (status === 'prueba') out.push({ userId: r.userId, field: 'trial', before: r.trialUntil });
    else if ((status === 'al_dia' || status === 'por_vencer') && r.dueDate) out.push({ userId: r.userId, field: 'due', before: r.dueDate });
  }
  return out;
}

// Días de vencimiento corridos por cierres después de `sinceMs` (un pago) y no devueltos.
export const extensionDaysSince = (extensions, sinceMs) => (extensions || [])
  .filter(e => e.field === 'due' && !e.revertedAt && e.appliedAt > sinceMs)
  .reduce((sum, e) => sum + e.days, 0);
```

En `api/classes.js`, borrar `CLOSURE_MAX_DAYS` y la función `validateClosure` (líneas ~215-227) y, en su lugar, agregar:

```js
// Los cierres pasaron a closures.js; se re-exportan para quien los importaba de acá.
export { CLOSURE_MAX_DAYS, validateClosure } from './closures.js';
```

Revisar que `dayNumber` siga usándose en `classes.js`. Si no se usa más, borrarlo.

- [ ] **Step 4: Verificar que pasan**

Run: `cd api && node --test closures.test.js classes.test.js`
Expected: PASS.

Si aparece un error de import circular (`classes.js` ↔ `closures.js`), mover `validateClosure` adentro de `closures.js` sin re-export, y en `classes-routes.js` importar `validateClosure` desde `./closures.js` en vez de `./classes.js`.

- [ ] **Step 5: Commit**

```bash
git add api/closures.js api/closures.test.js api/classes.js
git commit -m "feat(closures): pure closure rules (validation, announce time, extension targets)"
```

---

### Task 3: Datos de cierres (`api/closures-db.js`)

**Files:**
- Create: `api/closures-db.js`
- Modify: `api/classes-db.js` (sacar `closureFromRow`, `getClosures`, `getClosure`, `addClosure` y `deleteClosure`, y re-exportarlos; llamar a `migrateClosures(db)` en `migrateClasses`)
- Test: `api/closures-db.test.js`

**Interfaces:**
- Consumes: `getDatabase` de `./database.js`; `addDays` de `./classes.js`.
- Produces:
  - `migrateClosures(db)`
  - `getClosures({ from?, to? }) → Closure[]`, `getClosure(id) → Closure|null`
    - `Closure = { id, from, to, reason, createdBy, createdAt, notifyAll: boolean, announceAt: number|null, announcedAt: number|null, notifiedIds: string[], extendDays: number }`
  - `addClosure({ from, to, reason?, createdBy?, notifyAll?, announceAt?, notifiedIds?, extendDays? }) → Closure`
  - `deleteClosure(id) → boolean`
  - `pendingAnnouncements(nowMs, today) → Closure[]`
  - `markAnnounced(id, nowMs) → boolean` (true solo si no estaba marcado)
  - `announcementRecipients(excludeIds = []) → string[]`
  - `applyExtensions(closureId, targets, days, nowMs) → number`
  - `getExtensions({ closureId?, userId? }) → [{ id, closureId, userId, field, days, before, after, appliedAt, revertedAt }]`
  - `revertExtensions(closureId, nowMs) → number`

- [ ] **Step 1: Tests que fallan**

Crear `api/closures-db.test.js`:

```js
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-closures-db-'));
process.env.DATA_DIR = dataDir;
const db = await import('./database.js');
const kdb = await import('./closures-db.js');
const cdb = await import('./classes-db.js');
db.initDatabase();
after(() => { db.closeDatabase(); fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

const sql = () => db.getDatabase();
for (const id of ['ana', 'beto', 'caro', 'baja']) db.createUser({ id, name: id, created: Date.now() });
db.getDatabase().prepare('UPDATE users SET disabled = 1 WHERE id = ?').run('baja');
const sub = id => sql().prepare('INSERT INTO subscriptions (user_id, endpoint, keys) VALUES (?, ?, ?)').run(id, 'https://push/' + id, '{}');
['ana', 'beto', 'baja'].forEach(sub);

test('alta con las columnas nuevas; classes-db sigue exportando lo mismo', () => {
  const k = kdb.addClosure({ from: '2026-10-12', to: '2026-10-12', reason: 'Feriado', createdBy: 'ana', notifyAll: true, announceAt: 1000, notifiedIds: ['beto'], extendDays: 1 });
  assert.deepEqual([k.notifyAll, k.announceAt, k.announcedAt, k.notifiedIds, k.extendDays], [true, 1000, null, ['beto'], 1]);
  assert.equal(cdb.getClosure(k.id).id, k.id);
  const plain = cdb.addClosure({ from: '2026-10-20', to: '2026-10-20', reason: '' });
  assert.deepEqual([plain.notifyAll, plain.announceAt, plain.notifiedIds, plain.extendDays], [false, null, [], 0]);
  kdb.deleteClosure(k.id); kdb.deleteClosure(plain.id);
});

test('avisos pendientes: vencidos, no enviados, de cierres que no terminaron; se marcan una vez', () => {
  const due = kdb.addClosure({ from: '2026-10-12', to: '2026-10-12', notifyAll: true, announceAt: 500 });
  kdb.addClosure({ from: '2026-10-14', to: '2026-10-14', notifyAll: true, announceAt: 5000 });
  kdb.addClosure({ from: '2026-10-01', to: '2026-10-02', notifyAll: true, announceAt: 100 });   // ya terminó
  kdb.addClosure({ from: '2026-10-16', to: '2026-10-16', notifyAll: false, announceAt: 100 });
  assert.deepEqual(kdb.pendingAnnouncements(1000, '2026-10-09').map(c => c.id), [due.id]);
  assert.equal(kdb.markAnnounced(due.id, 1000), true);
  assert.equal(kdb.markAnnounced(due.id, 1001), false);
  assert.deepEqual(kdb.pendingAnnouncements(1000, '2026-10-09'), []);
  for (const c of kdb.getClosures()) kdb.deleteClosure(c.id);
});

test('destinatarios: activos con suscripción, menos los excluidos', () => {
  assert.deepEqual(kdb.announcementRecipients().sort(), ['ana', 'beto']);
  assert.deepEqual(kdb.announcementRecipients(['beto']), ['ana']);
});

test('extensiones: corren vencimiento o prueba, se registran y se revierten sobre el valor actual', () => {
  sql().prepare("INSERT INTO plans (id, name, price, duration_days, active, created_at, updated_at) VALUES (1, 'Mensual', 100, 30, 1, 0, 0)").run();
  sql().prepare("INSERT INTO member_billing (user_id, plan_id, due_date, trial_until, updated_at) VALUES ('ana', 1, '2026-11-01', NULL, 0)").run();
  sql().prepare("INSERT INTO member_billing (user_id, plan_id, due_date, trial_until, updated_at) VALUES ('beto', NULL, NULL, '2026-10-15', 0)").run();
  const k = kdb.addClosure({ from: '2026-10-12', to: '2026-10-14', extendDays: 3 });
  const n = kdb.applyExtensions(k.id, [{ userId: 'ana', field: 'due', before: '2026-11-01' }, { userId: 'beto', field: 'trial', before: '2026-10-15' }], 3, 777);
  assert.equal(n, 2);
  assert.equal(db.getMemberBilling('ana').dueDate, '2026-11-04');
  assert.equal(db.getMemberBilling('beto').trialUntil, '2026-10-18');
  assert.deepEqual(kdb.getExtensions({ userId: 'ana' }).map(e => [e.field, e.days, e.before, e.after, e.appliedAt, e.revertedAt]), [['due', 3, '2026-11-01', '2026-11-04', 777, null]]);
  // Un pago en el medio mueve el vencimiento: revertir resta sobre el valor actual.
  sql().prepare("UPDATE member_billing SET due_date = '2026-12-04' WHERE user_id = 'ana'").run();
  assert.equal(kdb.revertExtensions(k.id, 900), 2);
  assert.equal(db.getMemberBilling('ana').dueDate, '2026-12-01');
  assert.equal(db.getMemberBilling('beto').trialUntil, '2026-10-15');
  assert.equal(kdb.revertExtensions(k.id, 901), 0);
  assert.ok(kdb.getExtensions({ closureId: k.id }).every(e => e.revertedAt === 900));
});
```

Antes de escribirlo, revisar en `api/schema.sql` las columnas reales de `subscriptions` y `plans` (`grep -n "CREATE TABLE IF NOT EXISTS subscriptions\|CREATE TABLE IF NOT EXISTS plans" -A 10 api/schema.sql`). Ajustar los `INSERT` del test a las columnas `NOT NULL` que existan.

- [ ] **Step 2: Verificar que fallan**

Run: `cd api && node --test closures-db.test.js`
Expected: FAIL (`Cannot find module './closures-db.js'`).

- [ ] **Step 3: Implementar**

Crear `api/closures-db.js`:

```js
// Cierres del gimnasio en la base: la tabla class_closures (nació con clases; no se renombra) con
// las columnas del aviso general y la extensión, y closure_extensions (qué vencimiento se corrió a
// quién, para devolverlo al reabrir y para anular un pago). migrateClasses llama a migrateClosures.
import crypto from 'node:crypto';
import { getDatabase } from './database.js';
import { addDays } from './classes.js';

export function migrateClosures(db) {
  for (const col of ['notify_all INTEGER NOT NULL DEFAULT 0', 'announce_at INTEGER', 'announced_at INTEGER', 'notified_ids TEXT', 'extend_days INTEGER NOT NULL DEFAULT 0']) {
    try { db.exec(`ALTER TABLE class_closures ADD COLUMN ${col};`); } catch {}
  }
  db.exec(`CREATE TABLE IF NOT EXISTS closure_extensions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    closure_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    field TEXT NOT NULL CHECK (field IN ('due', 'trial')),
    days INTEGER NOT NULL,
    before TEXT,
    after TEXT,
    applied_at INTEGER NOT NULL,
    reverted_at INTEGER
  );`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_closure_extensions_user ON closure_extensions(user_id);');
}

const parseIds = s => { try { const v = JSON.parse(s || '[]'); return Array.isArray(v) ? v.map(String) : []; } catch { return []; } };
const closureFromRow = r => r && ({
  id: r.id, from: r.from_date, to: r.to_date, reason: r.reason || '', createdBy: r.created_by || null, createdAt: r.created_at,
  notifyAll: r.notify_all === 1, announceAt: r.announce_at ?? null, announcedAt: r.announced_at ?? null,
  notifiedIds: parseIds(r.notified_ids), extendDays: r.extend_days || 0
});

// Los cierres que tocan [from, to] (fechas incluidas). Sin rango, todos.
export function getClosures({ from, to } = {}) {
  const db = getDatabase();
  const rows = from && to
    ? db.prepare('SELECT * FROM class_closures WHERE to_date >= ? AND from_date <= ? ORDER BY from_date').all(from, to)
    : db.prepare('SELECT * FROM class_closures ORDER BY from_date').all();
  return rows.map(closureFromRow);
}

export const getClosure = id => closureFromRow(getDatabase().prepare('SELECT * FROM class_closures WHERE id = ?').get(id));

export function addClosure({ from, to, reason = '', createdBy = null, notifyAll = false, announceAt = null, notifiedIds = [], extendDays = 0 }) {
  const id = 'k' + crypto.randomBytes(8).toString('hex');
  getDatabase().prepare(`INSERT INTO class_closures (id, from_date, to_date, reason, created_by, created_at, notify_all, announce_at, notified_ids, extend_days)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, from, to, reason, createdBy, new Date().toISOString(), notifyAll ? 1 : 0, announceAt, JSON.stringify(notifiedIds), extendDays);
  return getClosure(id);
}

export const deleteClosure = id => getDatabase().prepare('DELETE FROM class_closures WHERE id = ?').run(id).changes > 0;

// Avisos generales que ya tocan y no salieron, de cierres que todavía no terminaron.
export const pendingAnnouncements = (nowMs, today) => getDatabase()
  .prepare('SELECT * FROM class_closures WHERE notify_all = 1 AND announced_at IS NULL AND announce_at IS NOT NULL AND announce_at <= ? AND to_date >= ? ORDER BY from_date')
  .all(nowMs, today).map(closureFromRow);

// Marca el aviso como enviado (antes de mandarlo: un tick lento no lo repite). false si ya estaba.
export const markAnnounced = (id, nowMs) => getDatabase()
  .prepare('UPDATE class_closures SET announced_at = ? WHERE id = ? AND announced_at IS NULL').run(nowMs, id).changes === 1;

// Socios que reciben el aviso general: cuenta activa y aprobada, con alguna suscripción push.
export function announcementRecipients(excludeIds = []) {
  const skip = new Set(excludeIds);
  return getDatabase().prepare(`SELECT u.id FROM users u WHERE u.disabled = 0
      AND (u.approval_status IS NULL OR u.approval_status <> 'pending')
      AND EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id)`).all()
    .map(r => r.id).filter(id => !skip.has(id));
}

const extFromRow = r => ({ id: r.id, closureId: r.closure_id, userId: r.user_id, field: r.field, days: r.days, before: r.before, after: r.after, appliedAt: r.applied_at, revertedAt: r.reverted_at ?? null });

export function getExtensions({ closureId, userId } = {}) {
  const db = getDatabase();
  const rows = closureId ? db.prepare('SELECT * FROM closure_extensions WHERE closure_id = ? ORDER BY id').all(closureId)
    : userId ? db.prepare('SELECT * FROM closure_extensions WHERE user_id = ? ORDER BY id').all(userId)
    : db.prepare('SELECT * FROM closure_extensions ORDER BY id').all();
  return rows.map(extFromRow);
}

const COLUMN = { due: 'due_date', trial: 'trial_until' };

// Corre `days` el vencimiento (o la prueba) de cada destino y lo registra. Todo o nada.
export function applyExtensions(closureId, targets, days, nowMs = Date.now()) {
  if (!days || !targets?.length) return 0;
  const db = getDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    let n = 0;
    for (const t of targets) {
      const col = COLUMN[t.field];
      const row = db.prepare(`SELECT ${col} AS v FROM member_billing WHERE user_id = ?`).get(t.userId);
      if (!row?.v) continue;
      const after = addDays(row.v, days);
      db.prepare(`UPDATE member_billing SET ${col} = ?, push_sent_for_due = NULL, updated_at = ? WHERE user_id = ?`).run(after, nowMs, t.userId);
      db.prepare('INSERT INTO closure_extensions (closure_id, user_id, field, days, before, after, applied_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(closureId, t.userId, t.field, days, row.v, after, nowMs);
      n++;
    }
    db.exec('COMMIT');
    return n;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

// Devuelve los días: resta `days` al valor actual (respeta los pagos del medio). Si el socio ya no
// tiene ese campo (sin plan, prueba cerrada por un pago), solo se marca.
export function revertExtensions(closureId, nowMs = Date.now()) {
  const db = getDatabase();
  const open = getExtensions({ closureId }).filter(e => !e.revertedAt);
  if (!open.length) return 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const e of open) {
      const col = COLUMN[e.field];
      const row = db.prepare(`SELECT ${col} AS v FROM member_billing WHERE user_id = ?`).get(e.userId);
      if (row?.v) db.prepare(`UPDATE member_billing SET ${col} = ?, push_sent_for_due = NULL, updated_at = ? WHERE user_id = ?`).run(addDays(row.v, -e.days), nowMs, e.userId);
      db.prepare('UPDATE closure_extensions SET reverted_at = ? WHERE id = ?').run(nowMs, e.id);
    }
    db.exec('COMMIT');
    return open.length;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}
```

En `api/classes-db.js`:
- Borrar `closureFromRow`, `getClosures`, `getClosure`, `addClosure` y `deleteClosure` (líneas ~417-439).
- Agregar arriba, después del `import { getDatabase } …`:

```js
import { migrateClosures } from './closures-db.js';
// Los cierres pasaron a closures-db.js; se re-exportan para classes-routes y el seed de la demo.
export { getClosures, getClosure, addClosure, deleteClosure } from './closures-db.js';
```

- En `migrateClasses(db)`, justo después del `db.exec(\`CREATE TABLE IF NOT EXISTS class_closures (…)\`)`, agregar `migrateClosures(db);`.

- [ ] **Step 4: Verificar que pasan**

Run: `cd api && node --test closures-db.test.js classes-db.test.js classes-admin.http.test.js`
Expected: PASS. Ojo: el test de cierre viejo de `classes-admin.http.test.js` puede fallar porque sus rutas se borraron en la Task 1. Si es así, borrar ese test (`test('cierre del gimnasio: …')`): la Task 4 lo reemplaza.

- [ ] **Step 5: Commit**

```bash
git add api/closures-db.js api/closures-db.test.js api/classes-db.js api/classes-admin.http.test.js
git commit -m "feat(closures): closure storage with announcement and due-date extension records"
```

---

### Task 4: Rutas de cierres, push y auditoría

**Files:**
- Create: `api/closures-routes.js`
- Modify:
  - `api/classes-routes.js` (exportar `closureImpact`; sacar `closures` de la respuesta de `GET /api/classes`; importar `validateClosure` de `./closures.js` si hiciera falta);
  - `api/push-messages.js` (`closureAnnouncePush`, `closureReopenPush`);
  - `api/server.js` (sumar `closureRoutes`; `closures` en `GET /api/admin/user`);
  - `api/audit-categories.js` (categoría `classes` también para `gym.closure.*`);
  - `api/classes-member.http.test.js` (el test "día cerrado");
  - `scripts/demo/seed-demo.test.mjs` (URL de la lista).
- Test: `api/closures.http.test.js`, `api/push-messages.test.js`

**Interfaces:**
- Consumes:
  - de las Tasks 2 y 3, todo lo de `closures.js` y `closures-db.js`;
  - de server.js (por `deps`): `json`, `readBody`, `readSession`, `requireAdmin`, `audit`, `sendPush`, `can`, `isFeeExempt`, `gymTz`.
- Produces:
  - `closureRoutes(deps) → { [route]: handler }`
  - `sendAnnouncement(closure, { send, today }) → number` (destinatarios)
  - `sendPendingAnnouncements({ send, nowMs }) → void`
  - `closureNotifyHour() → 'HH:MM'`
  - `CLOSURE_NOTIFY_HOUR_SETTING = 'closure_notify_hour'`
  - la respuesta de `GET /api/closures`: `{ today, closures: [{ id, from, to, reason }] }`
  - la respuesta de `GET /api/admin/closures`: `{ today, closures: [{ id, from, to, reason, notifyAll, announceAt, announcedAt, notified, extendDays, extended }] }`, con cierres que terminan desde hace 7 días en adelante
  - la respuesta de `GET /api/admin/closures/preview`: `{ days, classes, booked, appMembers, announceAt, extend?: { members, trials } }`
  - la respuesta de `POST /api/admin/closures`: `{ closure, notified, classes, extended, announceAt }`
  - `GET /api/admin/user` suma `closures: [{ from, to, reason }]` (de 7 días atrás a 7 adelante)

- [ ] **Step 1: Mensajes push, primero en test**

En `api/push-messages.test.js`, agregar:

```js
test('closureAnnouncePush y closureReopenPush', () => {
  const one = closureAnnouncePush({ from: '2026-10-12', to: '2026-10-12', today: '2026-10-09', reason: 'Feriado' });
  assert.equal(one.title, 'El lunes 12 el gimnasio cierra');
  assert.equal(one.body, 'Feriado. Podés seguir usando la app para entrenar en casa o cargar tus comidas.');
  assert.equal(one.tag, 'gym-closure-2026-10-12');
  assert.equal(one.data.redirectUrl, '/#/home');
  const today = closureAnnouncePush({ from: '2026-10-09', to: '2026-10-09', today: '2026-10-09', reason: '' });
  assert.equal(today.title, 'Hoy el gimnasio está cerrado');
  const range = closureAnnouncePush({ from: '2026-12-24', to: '2027-01-02', today: '2026-10-09', reason: 'Vacaciones' });
  assert.equal(range.title, 'El gimnasio cierra del 24/12 al 2/1');
  const reopen = closureReopenPush({ from: '2026-10-10', today: '2026-10-09' });
  assert.equal(reopen.title, 'Al final el gimnasio abre mañana');
  assert.equal(reopen.tag, 'gym-closure-2026-10-10');
});
```

Sumar `closureAnnouncePush` y `closureReopenPush` al `import` de `./push-messages.js` del archivo.

Run: `cd api && node --test push-messages.test.js`
Expected: FAIL.

Implementar en `api/push-messages.js`, debajo de `closurePush`, usando `dayRef` y `MONTH_DAY` que ya existen ahí:

```js
// Aviso general de un cierre (a todos, a la hora de avisos). Un mismo tag por cierre: el de reabrir lo reemplaza.
const WEEKDAY = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const dayName = date => `${WEEKDAY[new Date(date + 'T12:00:00Z').getUTCDay()]} ${Number(date.slice(8, 10))}`;
export function closureAnnouncePush({ from, to, today, reason }) {
  const title = from !== to ? `El gimnasio cierra del ${MONTH_DAY(from)} al ${MONTH_DAY(to)}`
    : from === today ? 'Hoy el gimnasio está cerrado'
    : `El ${dayName(from)} el gimnasio cierra`;
  const rest = 'Podés seguir usando la app para entrenar en casa o cargar tus comidas.';
  return { title, body: reason ? `${reason}. ${rest}` : rest, tag: `gym-closure-${from}`, data: { redirectUrl: '/#/home' } };
}

// Se reabrió un cierre que era de hoy o mañana y ya se había avisado.
export function closureReopenPush({ from, today }) {
  const when = from === today ? 'hoy' : 'mañana';
  return { title: `Al final el gimnasio abre ${when}`, body: 'Se canceló el cierre.', tag: `gym-closure-${from}`, data: { redirectUrl: '/#/home' } };
}
```

Run: `cd api && node --test push-messages.test.js`
Expected: PASS.

- [ ] **Step 2: Tests HTTP que fallan**

Crear `api/closures.http.test.js`. Copiar el armado de `api/classes-admin.http.test.js:1-60` (directorio temporal, `cookie`, `call`, `before`/`after` que levantan `server.js`). Cambiar el prefijo del directorio a `'lauyim-closures-'` y el rango de puertos a `51000 + Math.floor(Math.random() * 900)` ("Puertos 51000–51900" en el comentario). Usuarios:

```js
db.createUser({ id: 'owner', name: 'Dueña', created: Date.now() });
for (const id of ['recep', 'jefa', 'ana', 'beto']) db.createUser({ id, name: id, created: Date.now() });
db.setUserRole('recep', 'reception');                 // fees.manage, sin gym.closures
const jefa = db.saveRole({ name: 'Jefa', color: '#123456', permissions: ['gym.closures'] });
db.setUserRole('jefa', jefa.id);                       // gym.closures, sin fees.manage
db.getDatabase().prepare("INSERT INTO plans (id, name, price, duration_days, active, created_at, updated_at) VALUES (1, 'Mensual', 100, 30, 1, 0, 0)").run();
```

Tests (con `today` del servidor, sacado de `GET /api/closures`):

```js
const dayAfter = (date, n) => new Date(Date.parse(date + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
let today;

test('socio: GET /api/closures da hoy y la lista pública, sin módulo de clases', async () => {
  const r = await call('ana', 'GET', '/api/closures');
  assert.equal(r.status, 200);
  assert.match(r.body.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(r.body.closures, []);
  today = r.body.today;
  assert.equal((await call(null, 'GET', '/api/closures')).status, 401);
});

test('permisos: sin gym.closures no cierra; extender pide fees.manage', async () => {
  const day = dayAfter(today, 10);
  assert.equal((await call('recep', 'POST', '/api/admin/closures', { from: day })).status, 403);
  assert.equal((await call('ana', 'GET', '/api/admin/closures')).status, 403);
  // Cuotas apagado: la vista previa no ofrece extender.
  const pv = await call('jefa', 'GET', `/api/admin/closures/preview?from=${day}&to=${day}`);
  assert.equal(pv.status, 200);
  assert.equal(pv.body.days, 1);
  assert.equal(pv.body.extend, undefined);
  assert.equal((await call('jefa', 'POST', '/api/admin/closures', { from: day, extendDays: 1 })).status, 403);
});

test('cerrar: sin clases, con aviso general programado; la lista del socio lo trae; reabrir lo borra', async () => {
  const day = dayAfter(today, 5);
  const made = await call('jefa', 'POST', '/api/admin/closures', { from: day, to: day, reason: 'Feriado' });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  assert.deepEqual([made.body.notified, made.body.classes, made.body.extended], [0, 0, 0]);
  assert.ok(made.body.announceAt > Date.now() - 1000);
  const list = await call('owner', 'GET', '/api/admin/closures');
  assert.deepEqual(list.body.closures.map(c => [c.from, c.notifyAll, c.announcedAt]), [[day, true, null]]);
  const pub = await call('ana', 'GET', '/api/closures');
  assert.deepEqual(pub.body.closures, [{ id: made.body.closure.id, from: day, to: day, reason: 'Feriado' }]);
  assert.equal((await call('owner', 'POST', '/api/admin/closures', { from: day })).body.error, 'closure_overlap');
  assert.equal((await call('jefa', 'POST', '/api/admin/closures/delete', { id: made.body.closure.id })).status, 200);
  assert.deepEqual((await call('ana', 'GET', '/api/closures')).body.closures, []);
});

test('extender: con cuotas prendido corre vencimientos y prueba; reabrir los devuelve', async () => {
  assert.equal((await call('owner', 'PUT', '/api/owner/billing/enabled', { enabled: true })).status, 200);
  const sql = await import('./database.js');
  // ana al día; beto en prueba.
  sql.initDatabase();
  sql.getDatabase().prepare("INSERT OR REPLACE INTO member_billing (user_id, plan_id, due_date, trial_until, updated_at) VALUES ('ana', 1, ?, NULL, 0)").run(dayAfter(today, 25));
  sql.getDatabase().prepare("INSERT OR REPLACE INTO member_billing (user_id, plan_id, due_date, trial_until, updated_at) VALUES ('beto', NULL, NULL, ?, 0)").run(dayAfter(today, 4));
  const from = dayAfter(today, 2), to = dayAfter(today, 4);
  const pv = await call('owner', 'GET', `/api/admin/closures/preview?from=${from}&to=${to}`);
  assert.deepEqual([pv.body.days, pv.body.extend], [3, { members: 1, trials: 1 }]);
  const made = await call('owner', 'POST', '/api/admin/closures', { from, to, reason: 'Vacaciones', notifyAll: false, extendDays: 3 });
  assert.equal(made.body.extended, 2);
  assert.equal(sql.getMemberBilling('ana').dueDate, dayAfter(today, 28));
  assert.equal(sql.getMemberBilling('beto').trialUntil, dayAfter(today, 7));
  assert.equal((await call('jefa', 'POST', '/api/admin/closures/delete', { id: made.body.closure.id, revert: true })).status, 403);
  assert.equal((await call('owner', 'POST', '/api/admin/closures/delete', { id: made.body.closure.id, revert: true })).status, 200);
  assert.equal(sql.getMemberBilling('ana').dueDate, dayAfter(today, 25));
  assert.equal(sql.getMemberBilling('beto').trialUntil, dayAfter(today, 4));
  sql.closeDatabase();
});

test('GET /api/admin/user trae los cierres de alrededor de hoy (para la adherencia)', async () => {
  const made = await call('owner', 'POST', '/api/admin/closures', { from: today, to: today, reason: 'Feriado', notifyAll: false });
  const u = await call('owner', 'GET', '/api/admin/user?id=ana');
  assert.deepEqual(u.body.closures, [{ from: today, to: today, reason: 'Feriado' }]);
  await call('owner', 'POST', '/api/admin/closures/delete', { id: made.body.closure.id });
});
```

Abrir la base desde el test mientras corre el servidor ya se hace en otros tests HTTP (WAL). Si da `database is locked`, armar los datos de cuotas con las rutas de Admin: `PUT /api/admin/users/:userId/billing` para ana y `POST /api/admin/users/:userId/trial` para beto. Para ver sus cuerpos: `grep -n "'PUT /api/admin/users/:userId/billing'\|'POST /api/admin/users/:userId/trial'" -A 12 api/server.js`.

Run: `cd api && node --test closures.http.test.js`
Expected: FAIL (404 en `/api/closures`).

- [ ] **Step 3: Implementar `api/closures-routes.js`**

```js
// Rutas de cierres del gimnasio (docs/superpowers/specs/2026-10-09-cierres-gym-design.md). server.js
// las suma con closureRoutes({ ... }). El scheduler usa sendPendingAnnouncements.
import { closureDays, validateClosure, closureOptions, announceAtFor, extensionTargets } from './closures.js';
import * as kdb from './closures-db.js';
import { addDays } from './classes.js';
import { getAdminSetting, getDatabase, getAllMemberBilling } from './database.js';
import { gymClock, getBillingSettings, isBillingEnabled } from './billing.js';
import { closurePush, closureAnnouncePush, closureReopenPush } from './push-messages.js';
import { classSettingsNow, closureImpact } from './classes-routes.js';
import * as cdb from './classes-db.js';

export const CLOSURE_NOTIFY_HOUR_SETTING = 'closure_notify_hour';
export const DEFAULT_CLOSURE_NOTIFY_HOUR = '08:00';
const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const closureNotifyHour = () => { const v = getAdminSetting(CLOSURE_NOTIFY_HOUR_SETTING); return HH_MM.test(v || '') ? v : DEFAULT_CLOSURE_NOTIFY_HOUR; };

const gymTzNow = () => getBillingSettings(getDatabase()).gym_tz;
const todayNow = (ms = Date.now()) => gymClock(ms, gymTzNow()).date;
const AUDIT_DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const auditDay = date => `${AUDIT_DAYS[new Date(date + 'T12:00:00Z').getUTCDay()]} ${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`;
const auditRange = ({ from, to }) => auditDay(from) + (to !== from ? ' al ' + auditDay(to) : '');

// El aviso general: a todos los activos con push, menos los que ya recibieron el de su reserva.
export function sendAnnouncement(closure, { send, today }) {
  const ids = kdb.announcementRecipients(closure.notifiedIds);
  const payload = closureAnnouncePush({ ...closure, today });
  for (const id of ids) send(id, payload);
  return ids.length;
}

// Tick del scheduler: los avisos que ya tocan. Se marcan antes de enviar (un tick lento no repite).
export function sendPendingAnnouncements({ send, nowMs = Date.now() }) {
  const today = todayNow(nowMs);
  for (const closure of kdb.pendingAnnouncements(nowMs, today)) {
    if (kdb.markAnnounced(closure.id, nowMs)) sendAnnouncement(closure, { send, today });
  }
}

export function closureRoutes(d) {
  const { json, readBody } = d;
  const classesOn = () => classSettingsNow().enabled;
  const canExtend = user => isBillingEnabled(getDatabase()) && d.can(user, 'fees.manage');
  const targetsFor = today => extensionTargets(getAllMemberBilling(), today, getBillingSettings(getDatabase()),
    r => d.isFeeExempt({ id: r.userId, owner: r.owner, role_id: r.roleId }));
  const send = (uid, payload) => { d.sendPush(uid, payload).catch(() => {}); };
  const adminView = c => {
    const ext = kdb.getExtensions({ closureId: c.id });
    return { id: c.id, from: c.from, to: c.to, reason: c.reason, notifyAll: c.notifyAll, announceAt: c.announceAt, announcedAt: c.announcedAt,
      notified: c.notifiedIds.length, extendDays: c.extendDays, extended: ext.filter(e => !e.revertedAt).length };
  };

  return {
    // Socio: todos los cierres (la racha mira semanas pasadas), solo lo público.
    'GET /api/closures': async (req, res) => {
      const user = d.readSession(req); if (!user) return json(res, 401, { error: 'unauthorized' });
      json(res, 200, { today: todayNow(), closures: kdb.getClosures().map(c => ({ id: c.id, from: c.from, to: c.to, reason: c.reason })) });
    },
    'GET /api/admin/closures': async (req, res) => {
      const user = d.requireAdmin(req, res); if (!user) return;
      const today = todayNow();
      json(res, 200, { today, closures: kdb.getClosures().filter(c => c.to >= addDays(today, -7)).map(adminView) });
    },
    'GET /api/admin/closures/preview': async (req, res) => {
      const user = d.requireAdmin(req, res); if (!user) return;
      const q = new URL(req.url, 'http://x').searchParams;
      const today = todayNow();
      const v = validateClosure({ from: q.get('from'), to: q.get('to') }, { today });
      if (v.error) return json(res, 400, v);
      const impact = classesOn() ? closureImpact(v.value) : { occs: [], people: new Map() };
      const out = {
        days: closureDays(v.value), classes: impact.occs.length, booked: impact.people.size,
        appMembers: kdb.announcementRecipients([...impact.people.keys()]).length,
        announceAt: announceAtFor({ from: v.value.from, nowMs: Date.now(), notifyHour: closureNotifyHour(), tz: gymTzNow() })
      };
      if (canExtend(user)) {
        const targets = targetsFor(today);
        out.extend = { members: targets.filter(t => t.field === 'due').length, trials: targets.filter(t => t.field === 'trial').length };
      }
      json(res, 200, out);
    },
    'POST /api/admin/closures': async (req, res) => {
      const user = d.requireAdmin(req, res); if (!user) return;
      const body = await readBody(req);
      const nowMs = Date.now();
      const today = todayNow(nowMs);
      const v = validateClosure(body, { today, existing: kdb.getClosures() });
      if (v.error) return json(res, v.error === 'closure_overlap' ? 409 : 400, v);
      const o = closureOptions(body, { days: closureDays(v.value) });
      if (o.error) return json(res, 400, o);
      if (o.value.extendDays && !canExtend(user)) return json(res, 403, { error: 'forbidden' });
      const impact = classesOn() ? closureImpact(v.value) : { occs: [], people: new Map() };
      // Las reservas se cancelan (sin promover a nadie); al reabrir, las fechas vuelven.
      for (const occ of impact.occs) if (occ.sessionId) cdb.cancelSessionBookings(occ.sessionId);
      const announceAt = o.value.notifyAll ? announceAtFor({ from: v.value.from, nowMs, notifyHour: closureNotifyHour(), tz: gymTzNow() }) : null;
      const closure = kdb.addClosure({ ...v.value, createdBy: user.id, notifyAll: o.value.notifyAll, announceAt, notifiedIds: [...impact.people.keys()], extendDays: o.value.extendDays });
      const extended = o.value.extendDays ? kdb.applyExtensions(closure.id, targetsFor(today), o.value.extendDays, nowMs) : 0;
      for (const [uid, items] of impact.people) {
        send(uid, closurePush({ ...v.value, today, items: items.map(x => ({ name: x.type.name, start: x.start, date: x.date })) }));
      }
      if (announceAt != null && announceAt <= nowMs && kdb.markAnnounced(closure.id, nowMs)) sendAnnouncement(closure, { send, today });
      const parts = [`${impact.occs.length} clase${impact.occs.length === 1 ? '' : 's'}`, `${impact.people.size} con reserva`];
      if (o.value.notifyAll) parts.push('aviso a todos');
      if (extended) parts.push(`vencimientos +${o.value.extendDays} día${o.value.extendDays === 1 ? '' : 's'} a ${extended} socio${extended === 1 ? '' : 's'}`);
      d.audit(req, 'gym.closure.add', { user, msg: `${auditRange(v.value)}${v.value.reason ? ' · ' + v.value.reason : ''}: ${parts.join(', ')}` });
      json(res, 200, { closure: adminView(kdb.getClosure(closure.id)), notified: impact.people.size, classes: impact.occs.length, extended, announceAt });
    },
    'POST /api/admin/closures/delete': async (req, res) => {
      const user = d.requireAdmin(req, res); if (!user) return;
      const { id, revert = true } = await readBody(req);
      const closure = kdb.getClosure(id);
      if (!closure) return json(res, 404, { error: 'not_found' });
      const open = kdb.getExtensions({ closureId: id }).filter(e => !e.revertedAt);
      if (open.length && revert && !canExtend(user)) return json(res, 403, { error: 'forbidden' });
      const reverted = open.length && revert ? kdb.revertExtensions(id) : 0;
      const today = todayNow();
      // Ya se había avisado y el cierre era de hoy o mañana: se avisa que al final abre.
      const told = closure.announcedAt ? kdb.announcementRecipients([]) : closure.notifiedIds;
      if (closure.from <= addDays(today, 1) && closure.to >= today && (closure.announcedAt || closure.notifiedIds.length)) {
        const payload = closureReopenPush({ from: closure.from < today ? today : closure.from, today });
        for (const uid of told) send(uid, payload);
      }
      kdb.deleteClosure(id);
      d.audit(req, 'gym.closure.delete', { user, msg: auditRange(closure) + (closure.reason ? ' · ' + closure.reason : '') + (reverted ? ` · vencimientos devueltos a ${reverted}` : '') });
      json(res, 200, { ok: true, reverted });
    }
  };
}
```

En `api/classes-routes.js`:
- `closureImpact` está definida dentro de `classRoutes`. Sacarla a nivel de módulo, como función exportada. Usa `loadOccurrences`, `cdb` y `teachesOcc`, que ya son de módulo:

```js
// Lo que afecta un cierre: las fechas que todavía se dan en esos días y, por persona con reserva
// activa, sus fechas (la profe que da la clase no cuenta).
export function closureImpact({ from, to }) {
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;
  const occs = loadOccurrences(from, days).filter(o => !o.cancelled);
  const bySession = new Map(occs.filter(o => o.sessionId).map(o => [o.sessionId, o]));
  const people = new Map();
  for (const b of cdb.getBookingsForSessions([...bySession.keys()])) {
    const occ = bySession.get(b.sessionId);
    if (!['booked', 'waitlist'].includes(b.status) || teachesOcc(occ, b.userId)) continue;
    if (!people.has(b.userId)) people.set(b.userId, []);
    people.get(b.userId).push(occ);
  }
  return { occs, people };
}
```

- Borrar la copia interna de `closureImpact` (líneas ~240-253).
- En `GET /api/classes` (línea ~789), borrar `closures: cdb.getClosures({ from, to: addDays(from, days - 1) }), ` del `json(res, 200, {...})`.
- Sacar `closurePush` del import de `./push-messages.js` si ya no se usa ahí. Lo mismo con `validateClosure` del import de `./classes.js`.

En `api/server.js`:
- Import: `import { closureRoutes } from './closures-routes.js';` junto al de `classRoutes`. Agregar `import { getClosures } from './closures-db.js';`.
- En la tabla de rutas, después de `...classRoutes({...}),`:

```js
  ...closureRoutes({ json, readBody, readSession, requireAdmin, audit, sendPush, can, isFeeExempt }),
```

  Revisar el nombre real de la función que lee la sesión sin cortar con 401 (`grep -n "^function readSession\|const readSession" api/server.js`). Si el nombre es otro, ajustar `d.readSession` en `closures-routes.js`.
- En `GET /api/admin/user`, después de `today: billingToday(billingSettingsNow()),`:

```js
      // Cierres de alrededor de hoy: la adherencia no cuenta como esperado un día cerrado.
      closures: (() => { const today = billingToday(billingSettingsNow()); return getClosures({ from: addDays(today, -7), to: addDays(today, 7) }).map(c => ({ from: c.from, to: c.to, reason: c.reason })); })(),
```

  Revisar que `addDays` esté importado en server.js (`grep -n "addDays" api/server.js | head -3`). Si no lo está, importarlo de `./billing.js`.

En `api/audit-categories.js`, después de `['classes', /^owner\.classes\./],`:

```js
  ['classes', /^gym\.closure\./],
```

En `api/classes-member.http.test.js`, test `'día cerrado: no se reserva y la lista trae el cierre'`:
- Cambiar la ruta a `/api/admin/closures` con `notifyAll: false`.
- Reemplazar la aserción sobre `data.closures` por una sobre `/api/closures`:

```js
  const made = await call('owner', 'POST', '/api/admin/closures', { from: closed, to: closed, reason: 'Feriado', notifyAll: false });
  assert.equal(made.status, 200, JSON.stringify(made.body));
  const data = await list('ana', closed, 1);
  assert.equal(data.closures, undefined);
  assert.deepEqual((await call('ana', 'GET', '/api/closures')).body.closures.map(c => [c.from, c.reason]), [[closed, 'Feriado']]);
```

En `scripts/demo/seed-demo.test.mjs`, cambiar `'/api/admin/classes/closures'` por `'/api/admin/closures'`.

- [ ] **Step 4: Verificar que pasan**

Run: `cd api && node --test closures.http.test.js classes-member.http.test.js classes-admin.http.test.js route-permissions.test.js audit-categories.test.js push-messages.test.js`
Expected: PASS.

Run: `cd api && npm test`
Expected: PASS (toda la suite).

- [ ] **Step 5: Commit**

```bash
git add api/closures-routes.js api/closures.http.test.js api/classes-routes.js api/push-messages.js api/push-messages.test.js api/server.js api/audit-categories.js api/classes-member.http.test.js scripts/demo/seed-demo.test.mjs
git commit -m "feat(closures): gym-wide closure routes, general push and member endpoint"
```

---

### Task 5: Hora de avisos de cierre y envío en el scheduler

**Files:**
- Modify: `api/server.js` (`GET/PUT /api/admin/notifications/settings`)
- Modify: `api/scheduler.js` (tick)
- Test: `api/scheduler-closures.test.js`; agregar un caso en el test HTTP de notificaciones si existe (`grep -ln "notifications/settings" api/*.test.js`), o si no en `api/closures.http.test.js`

**Interfaces:**
- Consumes: `CLOSURE_NOTIFY_HOUR_SETTING`, `closureNotifyHour` y `sendPendingAnnouncements` de la Task 4.
- Produces: `GET /api/admin/notifications/settings` devuelve además `closure_notify_hour`. `PUT` acepta `billing_notify_hour` o `closure_notify_hour`, o las dos (al menos una).

- [ ] **Step 1: Tests que fallan**

Crear `api/scheduler-closures.test.js`:

```js
// Aviso general de un cierre en el tick: sale una vez, cuando toca, sin los avisados por reserva y
// nunca para un cierre que ya terminó.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-scheduler-closures-'));
process.env.DATA_DIR = dataDir;
const db = await import('./database.js');
const kdb = await import('./closures-db.js');
const { runSchedulerTick } = await import('./scheduler.js');
const { gymClock } = await import('./billing.js');
const { addDays } = await import('./classes.js');
db.initDatabase();
after(() => { db.closeDatabase(); fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

for (const id of ['ana', 'beto', 'caro']) {
  db.createUser({ id, name: id, created: Date.now() });
  db.getDatabase().prepare('INSERT INTO subscriptions (user_id, endpoint, keys) VALUES (?, ?, ?)').run(id, 'https://push/' + id, '{}');
}
const today = gymClock(Date.now(), db.getAdminSetting('gym_tz') || 'America/Argentina/Buenos_Aires').date;

async function tick(now = Date.now()) {
  const sent = [];
  runSchedulerTick({ now, sendToUser: async (userId, payload) => { sent.push({ userId, payload }); return { sent: 1 }; } });
  await new Promise(r => setTimeout(r, 50));
  return sent.filter(s => s.payload.tag?.startsWith('gym-closure-'));
}

test('sale una vez a su hora, sin los avisados por reserva', async () => {
  const k = kdb.addClosure({ from: addDays(today, 2), to: addDays(today, 2), reason: 'Feriado', notifyAll: true, announceAt: Date.now() + 3600000, notifiedIds: ['caro'] });
  assert.deepEqual(await tick(), []);
  const first = await tick(Date.now() + 3600001);
  assert.deepEqual(first.map(s => s.userId).sort(), ['ana', 'beto']);
  assert.deepEqual(await tick(Date.now() + 3700000), []);
  kdb.deleteClosure(k.id);
});

test('un cierre que ya terminó no se avisa', async () => {
  const k = kdb.addClosure({ from: addDays(today, -3), to: addDays(today, -2), notifyAll: true, announceAt: 1 });
  assert.deepEqual(await tick(), []);
  kdb.deleteClosure(k.id);
});
```

Revisar las columnas de `subscriptions` en `api/schema.sql` y ajustar el `INSERT`, igual que en la Task 3.

En el test HTTP de notificaciones (o al final de `api/closures.http.test.js`):

```js
test('hora de avisos de cierre: 08:00 por defecto, se cambia sola sin tocar la de cuotas', async () => {
  const g = await call('owner', 'GET', '/api/admin/notifications/settings');
  assert.equal(g.body.closure_notify_hour, '08:00');
  const before = g.body.billing_notify_hour;
  const p = await call('owner', 'PUT', '/api/admin/notifications/settings', { closure_notify_hour: '07:30' });
  assert.equal(p.status, 200);
  assert.deepEqual([p.body.closure_notify_hour, p.body.billing_notify_hour], ['07:30', before]);
  assert.equal((await call('owner', 'PUT', '/api/admin/notifications/settings', { closure_notify_hour: '7:30' })).status, 400);
  assert.equal((await call('owner', 'PUT', '/api/admin/notifications/settings', {})).status, 400);
});
```

Run: `cd api && node --test scheduler-closures.test.js closures.http.test.js`
Expected: FAIL.

- [ ] **Step 2: Implementar**

En `api/scheduler.js`:
- Import: `import { sendPendingAnnouncements } from './closures-routes.js';`.
- Al final de `runSchedulerTick`, después del bloque `try { … } catch (err) { console.error('[Scheduler] Error en clases:', err); }`:

```js
  // Cierres del gimnasio: el aviso general que ya toca (una vez por cierre).
  try {
    sendPendingAnnouncements({
      nowMs: now,
      send: (userId, payload) => { sendToUser(userId, payload).catch(err => console.error(`[Scheduler] Error al enviar aviso de cierre a user_id=${userId}:`, err)); }
    });
  } catch (err) {
    console.error('[Scheduler] Error en cierres:', err);
  }
```

En `api/server.js`, reemplazar los dos handlers de `/api/admin/notifications/settings`:

```js
  /* ---------- horarios de avisos (cuota y cierre) ---------- */
  // Hora del gym (gym_tz) desde la que salen el aviso de vencimiento y el recordatorio manual, y la
  // del aviso general de un cierre del gimnasio.
  'GET /api/admin/notifications/settings': async (req, res) => {
    if (!requireAdmin(req, res)) return;
    json(res, 200, { billing_notify_hour: getBillingNotifyHour(getDatabase()), closure_notify_hour: closureNotifyHour(), gym_tz: billingSettingsNow().gym_tz });
  },

  'PUT /api/admin/notifications/settings': async (req, res) => {
    const admin = requireAdmin(req, res); if (!admin) return;
    const body = await readBody(req);
    const keys = ['billing_notify_hour', 'closure_notify_hour'].filter(k => body[k] !== undefined);
    if (!keys.length) return json(res, 400, { error: 'Mandá billing_notify_hour o closure_notify_hour' });
    for (const k of keys) if (!isValidNotifyHour(body[k])) return json(res, 400, { error: `${k} debe tener el formato HH:MM` });
    if (body.billing_notify_hour !== undefined) setAdminSetting(BILLING_NOTIFY_HOUR_SETTING, body.billing_notify_hour);
    if (body.closure_notify_hour !== undefined) setAdminSetting(CLOSURE_NOTIFY_HOUR_SETTING, body.closure_notify_hour);
    const summary = [body.billing_notify_hour && `Avisos de cuota desde las ${body.billing_notify_hour}`, body.closure_notify_hour && `Avisos de cierre a las ${body.closure_notify_hour}`].filter(Boolean).join(' · ');
    audit(req, 'admin.notifications.settings', { user: admin, summary });
    json(res, 200, { billing_notify_hour: getBillingNotifyHour(getDatabase()), closure_notify_hour: closureNotifyHour(), gym_tz: billingSettingsNow().gym_tz });
  },
```

Sumar `CLOSURE_NOTIFY_HOUR_SETTING` y `closureNotifyHour` al import de `./closures-routes.js` en server.js.

- [ ] **Step 3: Verificar que pasan**

Run: `cd api && node --test scheduler-closures.test.js scheduler.test.js scheduler-billing.test.js scheduler-classes.test.js closures.http.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add api/scheduler.js api/scheduler-closures.test.js api/server.js api/closures.http.test.js
git commit -m "feat(closures): configurable announce hour and scheduled general push"
```

---

### Task 6: Anular un pago respeta la extensión

**Files:**
- Modify: `api/server.js` (ruta `POST /api/admin/users/:userId/payments/:paymentId/void`, líneas ~3743-3753)
- Test: `api/closures.http.test.js`

**Interfaces:**
- Consumes: `getExtensions({ userId })` (Task 3) y `extensionDaysSince(extensions, sinceMs)` (Task 2).

- [ ] **Step 1: Test que falla**

Al final de `api/closures.http.test.js`:

```js
test('anular el último pago después de correr vencimientos: se acepta y vuelve al anterior + los días', async () => {
  // ana con plan y un pago registrado.
  const pay = await call('owner', 'POST', '/api/admin/users/ana/payments', { planId: 1, amount: 100, method: 'efectivo' });
  assert.equal(pay.status, 200, JSON.stringify(pay.body));
  const billing = await call('owner', 'GET', '/api/admin/users/ana/billing');
  const dueAfterPay = billing.body.billing.dueDate;
  const paymentId = billing.body.payments[0].id;
  const previous = billing.body.payments[0].previousDueDate;
  const from = dayAfter(today, 20);
  const made = await call('owner', 'POST', '/api/admin/closures', { from, to: dayAfter(from, 1), notifyAll: false, extendDays: 2 });
  assert.equal(made.body.extended >= 1, true);
  assert.equal((await call('owner', 'GET', '/api/admin/users/ana/billing')).body.billing.dueDate, dayAfter(dueAfterPay, 2));
  const v = await call('owner', 'POST', `/api/admin/users/ana/payments/${paymentId}/void`, { reason: 'error' });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const back = (await call('owner', 'GET', '/api/admin/users/ana/billing')).body.billing;
  assert.equal(back.dueDate, previous ? dayAfter(previous, 2) : null);
  await call('owner', 'POST', '/api/admin/closures/delete', { id: made.body.closure.id, revert: false });
});
```

Antes de escribirlo, revisar el cuerpo que piden y devuelven `POST /api/admin/users/:userId/payments` y `GET /api/admin/users/:userId/billing` (`grep -n "'POST /api/admin/users/:userId/payments'\|'GET /api/admin/users/:userId/billing'" -A 25 api/server.js`). Ajustar los nombres de campo (`billing`, `payments`, `previousDueDate`) a los reales.

Run: `cd api && node --test closures.http.test.js`
Expected: FAIL con 409, "El vencimiento cambió después de este pago".

- [ ] **Step 2: Implementar**

En `api/server.js`, ruta de anular:
- Sumar `import { extensionDaysSince } from './closures.js';` y `getExtensions` al import de `./closures-db.js`.
- Reemplazar desde `const current = getMemberBilling(userId);` hasta `const backToTrial = …;` por:

```js
    const current = getMemberBilling(userId);
    // Cierres que corrieron el vencimiento después de este pago (y no se devolvieron): el pago sigue
    // siendo el último, solo que su vencimiento quedó corrido esos días.
    const shifted = extensionDaysSince(getExtensions({ userId }), payment.created || 0);
    const expectedDue = shifted && payment.periodEnd ? addDays(payment.periodEnd, shifted) : payment.periodEnd;
    if (current.dueDate !== expectedDue || current.planId !== payment.planId) {
      return json(res, 409, { error: 'El vencimiento cambió después de este pago; no se puede anular' });
    }
    // Se puede volver a un vencimiento anterior o a la prueba que el pago cerró, con los días corridos.
    const backTo = payment.previousDueDate ? addDays(payment.previousDueDate, shifted) : null;
    const backToTrial = payment.previousTrialUntil ? addDays(payment.previousTrialUntil, shifted) : null;
```

- [ ] **Step 3: Verificar que pasan**

Run: `cd api && node --test closures.http.test.js billing.http.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add api/server.js api/closures.http.test.js
git commit -m "fix(billing): voiding a payment keeps due-date days added by a closure"
```

---

### Task 7: Cierres en el cliente (`lib/closures.js` y `useClosures`)

**Files:**
- Create: `frontend/src/lib/closures.js`, `frontend/src/store/useClosures.js`
- Modify: `frontend/src/lib/classes.js:240-247` (re-exportar `closureOn` y `closureLabel`; borrar `closures`, `closurePreview`, `addClosure` y `deleteClosure` de `classesApi`)
- Test: `frontend/src/lib/closures.test.js`

**Interfaces:**
- Produces:
  - `closuresApi = { member(), list(), preview(from, to), add(body), remove(id, revert) }`
  - `closureOn(closures, date) → Closure|null`
  - `closureLabel(c) → string` (igual que hoy: `"Lun 12/10"` o `"2/1 al 15/1"`)
  - `closureLongLabel(c, today) → string` (`"el lunes 12"`, `"hoy"`, `"mañana"` o `"del 24/12 al 2/1"`)
  - `upcomingClosure(closures, today, aheadDays = 7) → Closure|null`
  - `weekClosedDays(closures, mondayIso) → string[]`
  - `useClosures` (Zustand): `{ today: string|null, closures: Closure[] }`
  - `loadClosures() → Promise`
  - `useClosuresToday() → string` (`today` del servidor o `todayISO()` mientras no llega)

- [ ] **Step 1: Tests que fallan**

Crear `frontend/src/lib/closures.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { closureOn, closureLabel, closureLongLabel, upcomingClosure, weekClosedDays } from './closures.js'

const feriado = { id: 'k1', from: '2026-10-12', to: '2026-10-12', reason: 'Feriado' }
const vacas = { id: 'k2', from: '2026-12-24', to: '2027-01-02', reason: 'Vacaciones' }

describe('cierres', () => {
  it('closureOn y closureLabel como antes', () => {
    expect(closureOn([feriado], '2026-10-12')).toBe(feriado)
    expect(closureOn([feriado], '2026-10-13')).toBe(null)
    expect(closureLabel(feriado)).toBe('Lun 12/10')
    expect(closureLabel(vacas)).toBe('24/12 al 2/1')
  })
  it('closureLongLabel: hoy, mañana, el día con nombre o el rango', () => {
    expect(closureLongLabel(feriado, '2026-10-12')).toBe('hoy')
    expect(closureLongLabel(feriado, '2026-10-11')).toBe('mañana')
    expect(closureLongLabel(feriado, '2026-10-09')).toBe('el lunes 12')
    expect(closureLongLabel(vacas, '2026-12-20')).toBe('del 24/12 al 2/1')
  })
  it('upcomingClosure: desde 7 días antes hasta el último día; el más próximo', () => {
    expect(upcomingClosure([vacas, feriado], '2026-10-04')).toBe(null)
    expect(upcomingClosure([vacas, feriado], '2026-10-05')).toBe(feriado)
    expect(upcomingClosure([vacas, feriado], '2026-10-12')).toBe(feriado)
    expect(upcomingClosure([vacas, feriado], '2026-10-13')).toBe(null)
    expect(upcomingClosure([vacas], '2027-01-02')).toBe(vacas)
  })
  it('weekClosedDays: las fechas cerradas de la semana que empieza ese lunes', () => {
    expect(weekClosedDays([feriado], '2026-10-12')).toEqual(['2026-10-12'])
    expect(weekClosedDays([vacas], '2026-12-21')).toEqual(['2026-12-24', '2026-12-25', '2026-12-26', '2026-12-27'])
    expect(weekClosedDays([], '2026-10-12')).toEqual([])
  })
})
```

Run: `cd frontend && npx vitest run src/lib/closures.test.js`
Expected: FAIL (no existe el módulo).

- [ ] **Step 2: Implementar**

Crear `frontend/src/lib/closures.js`:

```js
// Cierres del gimnasio en el cliente (docs/superpowers/specs/2026-10-09-cierres-gym-design.md): la API
// y los helpers de fechas. Sin imports de classes.js (classes.js re-exporta closureOn y closureLabel).
import { api } from './api.js'

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) })
export const closuresApi = {
  member: () => api('/api/closures'),
  list: () => api('/api/admin/closures'),
  preview: (from, to) => api(`/api/admin/closures/preview?from=${from}&to=${to}`),
  add: body => post('/api/admin/closures', body),
  remove: (id, revert = true) => post('/api/admin/closures/delete', { id, revert }),
}

const dayNum = date => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86400000
const addDays = (date, n) => new Date((dayNum(date) + n) * 86400000).toISOString().slice(0, 10)
const weekday = date => new Date(dayNum(date) * 86400000).getUTCDay()
const SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
const LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const dm = date => `${Number(date.slice(8, 10))}/${Number(date.slice(5, 7))}`

// "Lun 12/10" o "2/1 al 15/1".
export const closureLabel = c => c.from === c.to ? `${SHORT[weekday(c.from)]} ${Number(c.from.slice(8, 10))}/${Number(c.from.slice(5, 7))}` : `${dm(c.from)} al ${dm(c.to)}`
// El cierre que toca una fecha (o null).
export const closureOn = (closures, date) => (closures || []).find(c => c.from <= date && date <= c.to) || null
// Para frases: "hoy", "mañana", "el lunes 12" o "del 24/12 al 2/1".
export function closureLongLabel(c, today) {
  if (c.from !== c.to) return `del ${dm(c.from)} al ${dm(c.to)}`
  if (c.from === today) return 'hoy'
  if (c.from === addDays(today, 1)) return 'mañana'
  return `el ${LONG[weekday(c.from)]} ${Number(c.from.slice(8, 10))}`
}
// El cierre para el banner de Inicio: empieza dentro de `aheadDays` o está en curso. El más próximo.
export const upcomingClosure = (closures, today, aheadDays = 7) => [...(closures || [])]
  .filter(c => c.to >= today && c.from <= addDays(today, aheadDays))
  .sort((a, b) => a.from.localeCompare(b.from))[0] || null
// Las fechas cerradas de la semana que empieza el lunes `mondayIso`.
export function weekClosedDays(closures, mondayIso) {
  const out = []
  for (let i = 0; i < 7; i++) { const iso = addDays(mondayIso, i); if (closureOn(closures, iso)) out.push(iso) }
  return out
}
```

Crear `frontend/src/store/useClosures.js`:

```js
// Los cierres del gimnasio para el socio: fuera de S (no se sube con PUT /api/data). Se guardan en el
// dispositivo para que la racha y la semana los tengan apenas abre la app; `today` es la fecha del
// gimnasio que manda el servidor (la que decide "hoy está cerrado").
import { create } from 'zustand'
import { useStore } from './useStore.js'
import { closuresApi } from '../lib/closures.js'
import { todayISO } from '../lib/format.js'

const KEY = 'lauyim_closures'
const userId = () => useStore.getState().user?.id || null
function readSaved() {
  try { const s = JSON.parse(localStorage.getItem(KEY) || 'null'); return s && s.userId === userId() ? s.data : null } catch { return null }
}

export const useClosures = create(() => ({ today: null, closures: readSaved()?.closures || [] }))

export async function loadClosures() {
  try {
    const d = await closuresApi.member()
    const data = { today: d.today || null, closures: Array.isArray(d.closures) ? d.closures : [] }
    useClosures.setState(data)
    try { localStorage.setItem(KEY, JSON.stringify({ userId: userId(), data })) } catch { /* sin storage */ }
    return data
  } catch { return null }
}

// "Hoy" del gimnasio (mientras no llegó, el del dispositivo: solo para dibujar, nunca para el cartel).
export const useClosuresToday = () => useClosures(s => s.today) || todayISO()
```

En `frontend/src/lib/classes.js`:
- Reemplazar el bloque `// ---- cierres del gimnasio ----` (líneas 240-247) por:

```js
// Los cierres pasaron a closures.js.
export { closureOn, closureLabel } from './closures.js'
```

- Borrar de `classesApi` las cuatro líneas `closures`, `closurePreview`, `addClosure` y `deleteClosure` (líneas 92-95). Si `dm` quedó sin usar, borrarlo también.

- [ ] **Step 3: Verificar que pasan**

Run: `cd frontend && npx vitest run src/lib/closures.test.js src/lib/classes.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/closures.js frontend/src/lib/closures.test.js frontend/src/store/useClosures.js frontend/src/lib/classes.js
git commit -m "feat(closures): client closures API, date helpers and store"
```

---

### Task 8: La racha descuenta los días cerrados

**Files:**
- Modify: `frontend/src/lib/history.js:620-735` (`evalWeek`, `streakWeeks`, `bestStreak`, `streakSummary`)
- Modify: `frontend/src/lib/workout-history.js:151-170` (`weekAdherence`)
- Test: `frontend/src/lib/streak.test.js`, `frontend/src/lib/history.test.js` (si `weekAdherence` tiene tests ahí; si no, en `streak.test.js`)

**Interfaces:**
- Consumes: nada de las tasks anteriores (recibe `closures` como `[{ from, to }]`).
- Produces:
  - `evalWeek(S, mondayDate, closures = [])` devuelve además `objetivoBase: number`, `cerradosPlanificados: number` y `congelada: boolean`. `objetivoSemanal` pasa a ser el objetivo ajustado.
  - `streakWeeks(S, now = new Date(), closures = [])`
  - `bestStreak(S, now = new Date(), closures = [])`
  - `streakSummary(S, now, classDays = {}, closures = [])`: `current` suma `frozen: boolean`, `closedPlanned: number` y `baseTarget: number`; cada día de `current.days` suma `closed: boolean`.
  - `weekAdherence({ workouts, week, dayPlan, closures = [] }, today)`: los días tienen además el estado `'closed'`, que no cuenta en `planned`; el resultado suma `closed: number`.

- [ ] **Step 1: Tests que fallan**

Al final de `frontend/src/lib/streak.test.js` (usa sus helpers `W`, `mon`, `state`, `PLAN3`, `NOW`):

```js
describe('cierres del gimnasio', () => {
  // Plan de 4 días: lunes, martes, jueves y viernes.
  const PLAN4 = { 1: 'a', 2: 'b', 4: 'c', 5: 'a' }
  const feriadoLun = [{ from: '2026-09-28', to: '2026-09-28' }]
  const lunAVie = [{ from: '2026-09-28', to: '2026-10-02' }]
  const sabado = [{ from: '2026-10-03', to: '2026-10-03' }]

  it('feriado en día planificado: objetivo 4 → 3; con 3 días cumple', () => {
    const S = state({ week: PLAN4, workouts: [W('2026-09-29'), W('2026-10-01'), W('2026-10-02')] })
    const w = evalWeek(S, mon('2026-09-28'), feriadoLun)
    expect([w.objetivoBase, w.cerradosPlanificados, w.objetivoSemanal, w.completa, w.congelada]).toEqual([4, 1, 3, true, false])
    expect(evalWeek(S, mon('2026-09-28')).completa).toBe(false)
  })

  it('feriado con 2 días: no cumple', () => {
    const S = state({ week: PLAN4, workouts: [W('2026-09-29'), W('2026-10-01')] })
    expect(evalWeek(S, mon('2026-09-28'), feriadoLun).completa).toBe(false)
  })

  it('todos los días planificados cerrados y sin entrenar: congelada, no corta la racha', () => {
    // Semanas del 14 y del 21 cumplidas, la del 28 cerrada, la actual (5/10) cumplida.
    const ws = ['2026-09-14', '2026-09-15', '2026-09-17', '2026-09-18', '2026-09-21', '2026-09-22', '2026-09-24', '2026-09-25', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'].map(d => W(d))
    const S = state({ week: PLAN4, workouts: ws })
    const w = evalWeek(S, mon('2026-09-28'), lunAVie)
    expect([w.objetivoSemanal, w.congelada, w.completa]).toEqual([0, true, false])
    const now = new Date('2026-10-08T12:00:00')
    expect(streakWeeks(S, now)).toBe(1)
    expect(streakWeeks(S, now, lunAVie)).toBe(3)
    expect(bestStreak(S, now, lunAVie)).toBe(3)
  })

  it('congelada pero entrenó un día (en casa): cuenta como cumplida', () => {
    const S = state({ week: PLAN4, workouts: [W('2026-09-30')] })
    const w = evalWeek(S, mon('2026-09-28'), lunAVie)
    expect([w.congelada, w.completa]).toEqual([true, true])
  })

  it('cierre en un día no planificado: igual que siempre', () => {
    const S = state({ week: PLAN4 })
    const w = evalWeek(S, mon('2026-09-28'), sabado)
    expect([w.objetivoSemanal, w.cerradosPlanificados, w.congelada]).toEqual([4, 0, false])
  })

  it('sin plan: los cierres no cambian nada', () => {
    const S = state({ workouts: [W('2026-09-30')] })
    expect(evalWeek(S, mon('2026-09-28'), lunAVie)).toMatchObject({ objetivoSemanal: 0, congelada: false, completa: true })
  })

  it('semana actual congelada sin entrenar: muestra la racha de antes', () => {
    const ws = ['2026-09-28', '2026-09-29', '2026-10-01', '2026-10-02'].map(d => W(d))
    const S = state({ week: PLAN4, workouts: ws })
    const now = new Date('2026-10-07T12:00:00')
    expect(streakWeeks(S, now, [{ from: '2026-10-05', to: '2026-10-09' }])).toBe(1)
  })

  it('streakSummary: días cerrados marcados y no planeados; objetivo reducido o pausa', () => {
    const S = state({ week: PLAN4 })
    const now = new Date('2026-10-05T12:00:00')
    const r = streakSummary(S, now, {}, [{ from: '2026-10-05', to: '2026-10-05' }])
    expect(r.current).toMatchObject({ target: 3, baseTarget: 4, closedPlanned: 1, frozen: false })
    expect(r.current.days[0]).toMatchObject({ iso: '2026-10-05', closed: true, planned: false })
    const f = streakSummary(S, now, {}, [{ from: '2026-10-05', to: '2026-10-09' }])
    expect(f.current).toMatchObject({ frozen: true, target: 0 })
  })
})

describe('weekAdherence con cierres', () => {
  it('un día cerrado no es "planeado, no entrenó"', async () => {
    const { weekAdherence } = await import('./workout-history.js')
    const a = weekAdherence({ workouts: [], week: { 1: 'a', 3: 'b' }, dayPlan: {}, closures: [{ from: '2026-10-05', to: '2026-10-05' }] }, '2026-10-07')
    expect(a.days[0].state).toBe('closed')
    expect([a.planned, a.closed]).toEqual([1, 1])
    expect(a.days[2].state).toBe('pending')
  })
})
```

Las fechas de ejemplo: el 28/9/2026 es lunes y el 5/10/2026 es lunes (`NOW` del archivo es el miércoles 7/10). Si algún test con `NOW` choca, usar el `now` local de cada test, como arriba.

Run: `cd frontend && npx vitest run src/lib/streak.test.js`
Expected: FAIL.

- [ ] **Step 2: Implementar en `lib/history.js`**

Agregar arriba de `evalWeek`:

```js
// Días con rutina en el plan de la semana (`weekPlan`, por día de la semana) que caen en un cierre
// del gimnasio. closures: [{ from, to }] (YYYY-MM-DD, extremos incluidos).
export function closedPlannedDays(weekPlan, mondayDate, closures) {
  if (!closures?.length) return []
  const out = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(mondayDate)
    d.setDate(mondayDate.getDate() + i)
    const iso = isoOf(d)
    const planned = weekPlan[d.getDay()]
    if (planned && planned !== 'rest' && closures.some(c => c.from <= iso && iso <= c.to)) out.push(iso)
  }
  return out
}
```

En `evalWeek(S, mondayDate)`:
- Cambiar la firma a `evalWeek(S, mondayDate, closures = [])`.
- Reemplazar desde `const target = weeklyTarget(S, mondayDate)` hasta el `return` por:

```js
  // Once the first session identifies a group, later group switches cannot change this week.
  const base = weeklyTarget(S, mondayDate)
  // Cierres del gimnasio: los días planificados que cayeron cerrados se descuentan del objetivo. Si
  // no queda ninguno, la semana queda congelada (no suma ni corta, salvo que se haya entrenado igual).
  const cerrados = base > 0 ? closedPlannedDays(weekPlan, mondayDate, closures).length : 0
  const target = Math.max(0, base - cerrados)
  const congelada = base > 0 && target === 0
  // Días entrenados (no entrenos): rutina y clase el mismo día, o dos entrenos, suman uno.
  const rutinasCompletadas = new Set(workouts.map(w => w.d)).size

  const completa = target > 0
    ? rutinasCompletadas >= target
    : rutinasCompletadas > 0

  return {
    semanaId: weekKey(isoOf(mondayDate)),
    diasProgramados,
    diasCompletados,
    rutinasCompletadas,
    objetivoSemanal: target,
    objetivoBase: base,
    cerradosPlanificados: cerrados,
    congelada,
    completa,
  }
```

`streakWeeks`: cambiar la firma a `streakWeeks(S, now = new Date(), closures = [])` y el cuerpo del cálculo a:

```js
  const curWeek = evalWeek(S, checkDate, closures)
  if (curWeek.completa) streak++

  checkDate.setDate(checkDate.getDate() - 7)
  for (let w = 0; w < 520; w++) {
    const weekInfo = evalWeek(S, checkDate, closures)
    // Una semana congelada por un cierre (sin entrenar) no suma ni corta: se sigue mirando atrás.
    if (weekInfo.completa) streak++
    else if (!weekInfo.congelada) break
    checkDate.setDate(checkDate.getDate() - 7)
  }
```

`bestStreak`: cambiar la firma a `bestStreak(S, now = new Date(), closures = [])` y el cuerpo:

```js
    const wk = evalWeek(S, m, closures)
    run = wk.completa ? run + 1 : wk.congelada ? run : 0
```

Y al final: `return Math.max(best, streakWeeks(S, now, closures))`.

`streakSummary`: cambiar la firma a `streakSummary(S, now = new Date(), classDays = {}, closures = [])`:
- `const week = evalWeek(S, monday, closures)`.
- Dentro del `for`: `const closed = (closures || []).some(c => c.from <= iso && iso <= c.to)` y `const planned = !done && !closed && iso >= today && !!(routineId || classes.length)`. En el objeto del día, sumar `closed`.
- `const streak = streakWeeks(S, now, closures)` y `best: bestStreak(S, now, closures)`.
- `const target = week.congelada ? 0 : (week.objetivoSemanal || 1)`.
- En `current`, sumar `frozen: week.congelada, closedPlanned: week.cerradosPlanificados, baseTarget: week.objetivoBase`.

- [ ] **Step 3: Implementar en `lib/workout-history.js`**

`weekAdherence({ workouts, week, dayPlan, closures = [] }, today)`. Dentro del `for`, antes de `if (isPlanned) planned++`:

```js
    const isClosed = (closures || []).some(c => c.from <= iso && iso <= c.to)
    if (isClosed && !didTrain) { closed++; days.push({ iso, state: 'closed', extra: false, today: iso === today }); continue }
```

- `didTrain` tiene que estar definido antes de ese bloque: mover `const didTrain = trained.has(iso)` arriba.
- Declarar `let planned = 0, done = 0, pending = 0, closed = 0`.
- Devolver `{ hasPlan, planned, done, pending, closed, days }`.
- Actualizar el comentario de la función con el estado `'closed'` (día cerrado sin entrenar; no cuenta como planeado).

- [ ] **Step 4: Verificar que pasan**

Run: `cd frontend && npx vitest run src/lib/streak.test.js src/lib/history.test.js`
Expected: PASS. Los tests viejos de racha siguen pasando: sin `closures`, todo queda igual.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/history.js frontend/src/lib/workout-history.js frontend/src/lib/streak.test.js
git commit -m "feat(streak): closed gym days lower the weekly target; fully closed weeks freeze"
```

---

### Task 9: Avisos al socio (cartel del día y banner de Inicio)

**Files:**
- Create: `frontend/src/components/closures/ClosureNotice.jsx`, `frontend/src/components/closures/ClosureBanner.jsx`
- Modify:
  - `frontend/src/App.jsx` (montar `<ClosureNotice />` al lado de `<ClassAfterPrompt />`);
  - `frontend/src/views/Home.jsx` (montar `<ClosureBanner />` arriba de la tarjeta de la semana);
  - `frontend/src/index.css`.
- Test: `frontend/src/components/closures/ClosureNotice.test.jsx`

**Interfaces:**
- Consumes:
  - de la Task 7: `useClosures`, `loadClosures`, `closureOn`, `closureLongLabel`, `upcomingClosure`;
  - `ui().openSheet(render, { kind: 'center' })` (`store/useUI.js`).
- Produces:
  - `ClosureNotice` (default export, sin props);
  - `shouldShowNotice({ today, closures, seen }) → Closure|null` (exportada, pura);
  - `ClosureBanner` (default export, sin props).

- [ ] **Step 1: Tests que fallan**

Crear `frontend/src/components/closures/ClosureNotice.test.jsx`, con el armado de `views/HomeClasses.test.jsx:1-40` (`apiMock`, `mount`, `tick`):

```jsx
// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))

const { useStore } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { useClosures } = await import('../../store/useClosures.js')
const { default: ClosureNotice, shouldShowNotice } = await import('./ClosureNotice.jsx')

const K = { id: 'k1', from: '2026-10-12', to: '2026-10-13', reason: 'Feriado' }
let container, root
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 10)) })

beforeEach(() => {
  localStorage.clear()
  useUI.setState({ sheets: [] })
  useStore.setState({ user: { id: 'ana' }, pulled: true, S: { ...useStore.getState().S, active: null } })
})
afterEach(() => { act(() => root?.unmount()); container?.remove() })

describe('shouldShowNotice', () => {
  it('solo el día cerrado, según el today del servidor, y una vez por día', () => {
    expect(shouldShowNotice({ today: '2026-10-11', closures: [K], seen: () => false })).toBe(null)
    expect(shouldShowNotice({ today: '2026-10-12', closures: [K], seen: () => false })).toBe(K)
    expect(shouldShowNotice({ today: '2026-10-12', closures: [K], seen: key => key === 'closure-seen:k1:2026-10-12' })).toBe(null)
    expect(shouldShowNotice({ today: '2026-10-13', closures: [K], seen: key => key === 'closure-seen:k1:2026-10-12' })).toBe(K)
    expect(shouldShowNotice({ today: null, closures: [K], seen: () => false })).toBe(null)
  })
})

describe('ClosureNotice', () => {
  it('abre el cartel con el today del servidor (no el reloj) y Aceptar lo recuerda', async () => {
    vi.useFakeTimers({ now: new Date('2026-10-20T12:00:00'), shouldAdvanceTime: true })   // el reloj del celular dice otra fecha
    apiMock.mockImplementation(url => url === '/api/closures' ? Promise.resolve({ today: '2026-10-12', closures: [K] }) : Promise.resolve({}))
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root.render(<ClosureNotice />) })
    await tick(); await tick()
    const sheets = useUI.getState().sheets
    expect(sheets).toHaveLength(1)
    expect(sheets[0].kind).toBe('center')
    expect(localStorage.getItem('closure-seen:k1:2026-10-12')).toBe(null)
    vi.useRealTimers()
  })

  it('no abre nada con un entreno en curso', async () => {
    useStore.setState({ S: { ...useStore.getState().S, active: { name: 'Push' } } })
    apiMock.mockImplementation(() => Promise.resolve({ today: '2026-10-12', closures: [K] }))
    container = document.createElement('div'); document.body.appendChild(container)
    root = createRoot(container)
    await act(async () => { root.render(<ClosureNotice />) })
    await tick(); await tick()
    expect(useUI.getState().sheets).toHaveLength(0)
  })
})
```

Run: `cd frontend && npx vitest run src/components/closures/ClosureNotice.test.jsx`
Expected: FAIL.

- [ ] **Step 2: Implementar `ClosureNotice.jsx`**

```jsx
// El día que el gimnasio está cerrado, al abrir la app (y al volver a primer plano): un cartel con
// "Aceptar", una vez por cierre y por día. "Hoy" es la fecha del gimnasio que manda el servidor,
// nunca el reloj del celular. No interrumpe un entreno en curso. Carga los cierres (useClosures).
import { useEffect } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { useClosures, loadClosures } from '../../store/useClosures.js'
import { closureOn } from '../../lib/closures.js'
import { t } from '../../lib/i18n.js'
import { Button } from '../ui.jsx'
import Icon from '../Icon.jsx'

const ui = () => useUI.getState()
const seenKey = (c, today) => `closure-seen:${c.id}:${today}`
const readSeen = key => { try { return localStorage.getItem(key) === '1' } catch { return false } }
const markSeen = key => { try { localStorage.setItem(key, '1') } catch { /* sin storage: puede volver a salir */ } }

export function shouldShowNotice({ today, closures, seen }) {
  if (!today) return null
  const c = closureOn(closures, today)
  return c && !seen(seenKey(c, today)) ? c : null
}

const LONG = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const dayLabel = iso => { const d = new Date(iso + 'T12:00:00'); return `${LONG[d.getDay()]} ${d.getDate()}` }

function Notice({ closure, today, close }) {
  const classes = useStore(s => !!s.config?.classes_available)
  const ok = () => { markSeen(seenKey(closure, today)); close() }
  return <div className="closure-notice">
    <div className="closure-notice-icon" aria-hidden="true"><Icon name="lock" /></div>
    <h3>{t('Hoy el gimnasio está cerrado')}</h3>
    <div className="muted">{[closure.reason, dayLabel(today)].filter(Boolean).join(' · ')}</div>
    <p className="small muted">{classes ? t('Las clases de hoy se suspendieron. ') : ''}{t('Podés seguir usando la app: entrenar en casa o cargar tus comidas.')}</p>
    <Button variant="primary" onClick={ok}>{t('Aceptar')}</Button>
  </div>
}

function check() {
  const { today, closures } = useClosures.getState()
  const st = useStore.getState()
  if (st.S?.active || ui().sheets.length) return
  const c = shouldShowNotice({ today, closures, seen: readSeen })
  if (c) ui().openSheet(close => <Notice closure={c} today={today} close={close} />, { kind: 'center' })
}

export default function ClosureNotice() {
  const on = useStore(s => !!s.user && s.pulled)
  const active = useStore(s => !!s.S?.active)
  useEffect(() => {
    if (!on) return
    let alive = true
    const run = () => loadClosures().then(() => { if (alive) check() })
    run()
    const onVisible = () => { if (document.visibilityState === 'visible') run() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { alive = false; document.removeEventListener('visibilitychange', onVisible) }
  }, [on])
  // Terminó el entreno: si hoy está cerrado y no se vio, ahora sí.
  useEffect(() => { if (on && !active) check() }, [on, active])
  return null
}
```

Revisar que exista el ícono `lock` (`grep -n "lock" frontend/src/components/Icon.jsx | head -3`); ClosureSheet ya lo usa. Revisar también que `useStore` tenga `pulled`, como lo usa `ClassAfterPrompt`.

En el test, el primer caso solo verifica que el cartel se abre, sin tocar "Aceptar", porque el sheet se dibuja en `Modals`. Si se quiere probar "Aceptar", renderizar `useUI.getState().sheets[0].render(() => {})` en un root aparte y hacer click en el botón.

- [ ] **Step 3: Implementar `ClosureBanner.jsx`**

```jsx
// Inicio: aviso de un cierre desde 7 días antes hasta el último día. Con ✕ se oculta; durante los días
// del cierre vuelve como "Hoy el gimnasio está cerrado".
import { useState } from 'react'
import { useClosures, useClosuresToday } from '../../store/useClosures.js'
import { upcomingClosure, closureLongLabel } from '../../lib/closures.js'
import { t } from '../../lib/i18n.js'
import Icon from '../Icon.jsx'

const hiddenKey = c => `closure-banner-hidden:${c.id}`
const isHidden = c => { try { return localStorage.getItem(hiddenKey(c)) === '1' } catch { return false } }

export default function ClosureBanner() {
  const closures = useClosures(s => s.closures)
  const today = useClosuresToday()
  const [, force] = useState(0)
  const c = upcomingClosure(closures, today)
  if (!c) return null
  const now = c.from <= today
  if (!now && isHidden(c)) return null
  const hide = () => { try { localStorage.setItem(hiddenKey(c), '1') } catch { /* sin storage */ } force(n => n + 1) }
  const label = closureLongLabel(c, today)
  const title = now ? t('Hoy el gimnasio está cerrado')
    : c.from === c.to ? t('{0} el gimnasio cierra', label.charAt(0).toUpperCase() + label.slice(1)) : t('El gimnasio cierra {0}', label)
  return <div className="closure-banner" role="status">
    <Icon name="lock" />
    <div className="grow"><b>{title}</b>{c.reason && <div className="small muted">{c.reason}</div>}</div>
    {!now && <button type="button" className="iconbtn" onClick={hide} aria-label={t('Ocultar aviso')}><Icon name="xmark" /></button>}
  </div>
}
```

En `frontend/src/views/Home.jsx`:
- Import: `import ClosureBanner from '../components/closures/ClosureBanner.jsx'`.
- Justo antes de `{/* Tu semana: progreso, … */}`, agregar `<ClosureBanner />`.

En `frontend/src/App.jsx`:
- Import: `import ClosureNotice from './components/closures/ClosureNotice.jsx'`.
- Después de la línea de `<ClassAfterPrompt />`:

```jsx
      {!isCheckin && !accountEnded && !licenseExpired && !blocked && <ClosureNotice />}
```

En `frontend/src/index.css`, al final:

```css
/* Cierres del gimnasio: aviso del día (cartel), banner de Inicio */
.closure-notice{text-align:center;display:flex;flex-direction:column;gap:8px;align-items:stretch}
.closure-notice-icon{font-size:34px;color:var(--orange)}
.closure-notice h3{margin:4px 0 0}
.closure-banner{display:flex;align-items:center;gap:10px;padding:10px 12px;margin:0 0 12px;border-radius:12px;
  background:color-mix(in srgb,var(--orange) 14%,transparent);border:1px solid color-mix(in srgb,var(--orange) 45%,transparent)}
.closure-banner>svg,.closure-banner>.icon{color:var(--orange);font-size:18px}
.closure-banner b{color:var(--orange)}
```

Revisar cómo dibuja `Icon` (¿`<svg>` o `<span class="icon">`?) y dejar el selector que corresponda.

- [ ] **Step 4: Verificar que pasan**

Run: `cd frontend && npx vitest run src/components/closures src/views/HomeClasses.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/closures frontend/src/App.jsx frontend/src/views/Home.jsx frontend/src/index.css
git commit -m "feat(closures): closed-day notice and Home banner for members"
```

---

### Task 10: Semana, calendario, racha y hoja del día con días cerrados

**Files:**
- Modify:
  - `frontend/src/views/Home.jsx` (tira, línea de la semana, fila de hoy, racha);
  - `frontend/src/sheets.jsx:1361-1423` (`Calendar`);
  - `frontend/src/components/StreakSheet.jsx` (`streakSummary` con cierres; `weekLine`);
  - `frontend/src/components/day/DaySheet.jsx:187` (cierres desde `useClosures`);
  - `frontend/src/views/Stats.jsx:400` (racha);
  - `frontend/src/views/Clases.jsx:53-60` (cierres desde `useClosures`);
  - `frontend/src/index.css`.
- Test: `frontend/src/views/HomeClosures.test.jsx` (nuevo); actualizar `frontend/src/views/Clases.test.jsx:97` y `frontend/src/components/day/DaySheet.test.jsx:255`.

**Interfaces:**
- Consumes:
  - de la Task 7: `useClosures`, `useClosuresToday`, `closureOn`, `weekClosedDays`, `closureLabel`;
  - de la Task 8: `evalWeek(S, monday, closures)`, `streakWeeks(S, now, closures)`, `streakSummary(S, now, classDays, closures)`.

- [ ] **Step 1: Tests que fallan**

Crear `frontend/src/views/HomeClosures.test.jsx`, copiando el armado de `views/HomeClasses.test.jsx:1-60` (mocks, `mount`, `tick`). Dejar `TODAY = '2026-10-05'` (lunes), fijar el reloj con `vi.useFakeTimers({ now: new Date(TODAY + 'T12:00:00'), shouldAdvanceTime: true })` en `beforeEach`, y armar el estado con `week: { 1: 'r1', 3: 'r1' }`. Tests:

```jsx
describe('Inicio con días cerrados', () => {
  it('el día cerrado de la tira no tiene punto de planificado y lleva candado', async () => {
    useClosures.setState({ today: TODAY, closures: [{ id: 'k', from: TODAY, to: TODAY, reason: 'Feriado' }] })
    await mount(<Home />)
    const mon = container.querySelectorAll('.week .wday')[0]
    expect(mon.classList.contains('closed')).toBe(true)
    expect(mon.querySelector('.dot.plan')).toBe(null)
    expect(mon.getAttribute('aria-label')).toContain('cerrado')
  })

  it('la línea de la semana explica el objetivo reducido', async () => {
    useClosures.setState({ today: TODAY, closures: [{ id: 'k', from: TODAY, to: TODAY, reason: 'Feriado' }] })
    await mount(<Home />)
    expect(container.querySelector('.week-closed').textContent).toContain('Esta semana tu objetivo es 1')
  })

  it('semana congelada: la línea dice que la racha queda en pausa', async () => {
    useClosures.setState({ today: TODAY, closures: [{ id: 'k', from: TODAY, to: '2026-10-09', reason: 'Vacaciones' }] })
    await mount(<Home />)
    expect(container.querySelector('.week-closed').textContent).toContain('tu racha queda en pausa')
  })

  it('calendario: día cerrado con clase closed y semana congelada con candado', async () => {
    useClosures.setState({ today: TODAY, closures: [{ id: 'k', from: TODAY, to: '2026-10-09', reason: 'Vacaciones' }] })
    calendarSheet(TODAY)
    const host = await openLastSheet()
    expect(host.querySelector('.cal-d.closed')).not.toBe(null)
    expect(host.querySelector('.cal-wk.frozen')).not.toBe(null)
  })
})
```

Importar `useClosures` de `../store/useClosures.js` y `calendarSheet` de `../sheets.jsx`. `openLastSheet` se copia de `HomeClasses.test.jsx`.

Run: `cd frontend && npx vitest run src/views/HomeClosures.test.jsx`
Expected: FAIL.

- [ ] **Step 2: Implementar en `Home.jsx`**

- Imports: `import { useClosures } from '../store/useClosures.js'` y `import { closureOn, weekClosedDays, closureLabel } from '../lib/closures.js'`.
- Después de `const myClasses = useMyClasses()`: `const closures = useClosures(s => s.closures)`.
- En el `for` de la tira, después de `const iso = isoOf(d)`: `const closed = closureOn(closures, iso)`.
  - En el `className` del botón, sumar `+ (closed && !trained ? ' closed' : '')`.
  - El punto de rutina pasa a `{(doneW || (eff && !closed)) && <div className={…} />}`.
  - En el `aria-label`, agregar `${closed ? ' · ' + t('cerrado') : ''}`.
  - Dentro de `.dots`, cuando `closed && !trained`, agregar `<div className="lock-mini" aria-hidden="true"><Icon name="lock" /></div>`.
- `const shownWeek = evalWeek(S, monday, closures)` y `const streak = streakWeeks(S, new Date(), closures)`.
- Después del `<div className="week-progress">…</div>`:

```jsx
      {(() => {
        const days = weekClosedDays(closures, isoOf(monday))
        if (!days.length) return null
        const c = closureOn(closures, days[0])
        const text = shownWeek.congelada ? t('Semana cerrada: tu racha queda en pausa.')
          : t('{0} cerrado{1}.', closureLabel(c), c.reason ? ' · ' + c.reason : '') + (shownWeek.cerradosPlanificados ? ' ' + t('Esta semana tu objetivo es {0}.', shownWeek.objetivoSemanal) : '')
        return <div className="week-closed small" role="status"><Icon name="lock" /> {text}</div>
      })()}
```

- En la fila de hoy, dentro de `<div style={{ minWidth: 0 }}>` y antes de `<div className="lbl2">`, agregar: `{closureOn(closures, todayISO()) && <div className="today-closed small">{t('Hoy el gimnasio está cerrado')}</div>}`.
- En el texto de progreso, cuando `shownWeek.congelada`, mostrar `t('Semana en pausa')` en lugar de `'{0} de {1} días'`.

- [ ] **Step 3: Calendario, racha, hoja del día, Stats y Clases**

`sheets.jsx`, `Calendar`:
- Import: `import { useClosures } from './store/useClosures.js'` y `import { closureOn } from './lib/closures.js'`. Si `closureOn` ya llega desde `./lib/classes.js`, usar ese.
- `const closures = useClosures(s => s.closures)`.
- En cada día: `const closed = !ws && closureOn(closures, iso)`. `dotCls` pasa a `ws || closed ? '' : …`. El `className` suma `+ (closed ? ' closed' : '')` y el `aria-label`, `+ (closed ? ' · ' + t('cerrado') : '')`.
- En el cierre de semana: `const wk = begun && evalWeek(st, mondayDate, closures)`, `const done = wk && wk.completa`, `const frozen = wk && wk.congelada && !wk.completa`. Si `frozen`: `<div key={'w' + i} className="cal-wk frozen" aria-label={t('Semana en pausa (gimnasio cerrado)')}><Icon name="lock" /></div>`.
- En la leyenda, si `closures.length`: `<span className="cal-legend-closed"><Icon name="lock" />{t('Cerrado')}</span>`.

`StreakSheet.jsx`:
- `const closures = useClosures(s => s.closures)` (con su import).
- `streakSummary(S, now, classesByDate(…), closures)`.
- En `weekLine(cur, today)`, como primera línea: `if (cur.frozen) return t('Semana cerrada: tu racha queda en pausa.')`.
- Después de `if (cur.complete) …`, agregar: `const note = cur.closedPlanned ? ' ' + t('(objetivo {0} por días cerrados)', cur.target) : ''`. Sumar `note` al final de los dos `return` que siguen.
- En los días: `className` suma `+ (d.closed ? ' closed' : '')`; si `d.closed && !d.done`, el contenido de `.streak-dot` pasa a `<Icon name="lock" />`.
- En `streak-now-head`, si `current.frozen`: `t('Esta semana') + ' · ' + t('en pausa')`.

`DaySheet.jsx:187`:
- Reemplazar `closureOn(myClasses?.closures, iso)` por `closureOn(closures, iso)`, con `const closures = useClosures(s => s.closures)` y su import.
- Cambiar el import de `closureOn` a `../../lib/closures.js`.

`Stats.jsx:400`: `streakWeeks(S, new Date(), useClosures.getState().closures)`. Si el componente es funcional y se puede usar el hook, mejor `const closures = useClosures(s => s.closures)` arriba y pasarlo.

`Clases.jsx` (vista del socio):
- Reemplazar `data.closures` por `closures`, con `const closures = useClosures(s => s.closures)`.
- Al montar la vista, llamar `loadClosures()` para que esté fresco.

Tests a actualizar:
- `views/Clases.test.jsx:97`: el mock ya no pone `closures` en `/api/classes`. Responder `/api/closures` con `{ today: '2026-10-06', closures: [...] }`, o `useClosures.setState({ closures: [...] })` antes de montar.
- `components/day/DaySheet.test.jsx:255`: si arma `closures` dentro de la respuesta de `/api/classes`, cambiar a `useClosures.setState({ closures: [...] })`.

`index.css`, al final:

```css
.wday.closed{background:repeating-linear-gradient(135deg,var(--surface-2) 0 5px,var(--surface) 5px 10px)}
.lock-mini{font-size:9px;line-height:1;color:var(--orange)}
.week-closed{display:flex;align-items:center;gap:6px;margin:6px 0 2px;padding:6px 8px;border-radius:8px;color:var(--orange);background:color-mix(in srgb,var(--orange) 12%,transparent)}
.today-closed{color:var(--orange)}
.cal-d.closed{background:repeating-linear-gradient(135deg,var(--surface) 0 5px,var(--surface-2) 5px 10px);color:var(--orange)}
.cal-wk.frozen{color:var(--orange)}
.streak-day.closed .streak-dot{color:var(--orange)}
.cal-legend-closed{color:var(--orange)}
```

- [ ] **Step 4: Verificar que pasan**

Run: `cd frontend && npx vitest run src/views src/components src/lib`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/Home.jsx frontend/src/views/HomeClosures.test.jsx frontend/src/sheets.jsx frontend/src/components/StreakSheet.jsx frontend/src/components/day/DaySheet.jsx frontend/src/components/day/DaySheet.test.jsx frontend/src/views/Stats.jsx frontend/src/views/Clases.jsx frontend/src/views/Clases.test.jsx frontend/src/index.css
git commit -m "feat(closures): closed days in week strip, calendar, streak sheet and day sheet"
```

---

### Task 11: Admin (tarjeta en Resumen, hoja de cierre, reabrir, hora de avisos, adherencia)

**Files:**
- Create: `frontend/src/views/admin/closures/ClosureSheet.jsx`, que reemplaza a `views/admin/clases/ClosureSheet.jsx` (borrar el viejo). Create: `frontend/src/views/admin/closures/ClosuresCard.jsx`.
- Modify:
  - `frontend/src/views/admin/Resumen.jsx` (montar la tarjeta);
  - `frontend/src/views/admin/Clases.jsx` (botón e import desde `closures/`; sacar `ClosureList`);
  - `frontend/src/views/admin/Notificaciones.jsx` (tarjeta de hora de cierre);
  - `frontend/src/views/admin/shared.jsx:723-746` (`AdherenceStrip` con el estado `closed`);
  - `frontend/src/lib/audit.js:132-133` (etiquetas `gym.closure.*`);
  - `frontend/src/index.css`.
- Test: `frontend/src/views/admin/Closures.test.jsx` (nuevo); actualizar `frontend/src/views/admin/Clases.test.jsx:300-340`.

**Interfaces:**
- Consumes:
  - de la Task 7: `closuresApi`, `closureLabel`;
  - `can(user, code)` de `lib/permissions.js`;
  - la respuesta de `GET /api/admin/closures` (Task 4), `preview` y `add`.
- Produces:
  - `closureSheet({ today, onChange })`;
  - `reopenClosure(c, { canRevert, onChange })`;
  - `ClosuresCard` (default export).

- [ ] **Step 1: Tests que fallan**

Crear `frontend/src/views/admin/Closures.test.jsx`, con el armado de `views/admin/Clases.test.jsx` (`apiMock`, montar con `MemoryRouter`, `openLastSheet`). Revisar sus primeras 60 líneas y copiar el patrón de `useStore.setState({ user: … })`.

```jsx
describe('Admin → cierres', () => {
  const list = { today: '2026-10-09', closures: [
    { id: 'k1', from: '2026-10-12', to: '2026-10-12', reason: 'Feriado', notifyAll: true, announceAt: Date.parse('2026-10-10T11:00:00Z'), announcedAt: null, notified: 0, extendDays: 1, extended: 48 },
    { id: 'k0', from: '2026-10-03', to: '2026-10-03', reason: 'Viejo', notifyAll: false, announceAt: null, announcedAt: null, notified: 0, extendDays: 0, extended: 0 }
  ] }

  it('la tarjeta muestra solo en curso y futuros, con su estado; sin permiso, sin botones', async () => {
    useStore.setState({ user: { id: 'u', permissions: ['stats.view'] } })
    apiMock.mockImplementation(url => url === '/api/admin/closures' ? Promise.resolve(list) : Promise.resolve({}))
    await mount(<ClosuresCard />)
    expect(container.textContent).toContain('Lun 12/10')
    expect(container.textContent).not.toContain('Viejo')
    expect(container.textContent).toContain('vencimientos +1 día')
    expect(container.querySelector('[data-action="close-gym"]')).toBe(null)
    expect(container.textContent).not.toContain('Reabrir')
  })

  it('con gym.closures: cerrar abre la hoja; sin fees.manage no hay interruptor de vencimientos', async () => {
    useStore.setState({ user: { id: 'u', permissions: ['gym.closures', 'stats.view'] } })
    apiMock.mockImplementation(url => url === '/api/admin/closures' ? Promise.resolve({ today: '2026-10-09', closures: [] })
      : url.startsWith('/api/admin/closures/preview') ? Promise.resolve({ days: 1, classes: 0, booked: 0, appMembers: 112, announceAt: Date.parse('2026-10-10T11:00:00Z') })
      : Promise.resolve({}))
    await mount(<ClosuresCard />)
    expect(container.textContent).toContain('No hay cierres programados')
    await act(async () => { container.querySelector('[data-action="close-gym"]').click() })
    const host = await openLastSheet()
    await tick()
    expect(host.textContent).toContain('Avisar a todos los socios')
    expect(host.textContent).toContain('112 con la app')
    expect(host.textContent).not.toContain('Correr los vencimientos')
  })

  it('la hoja manda notifyAll y extendDays', async () => {
    useStore.setState({ user: { id: 'u', owner: true } })
    apiMock.mockImplementation((url, opts) => url.startsWith('/api/admin/closures/preview')
      ? Promise.resolve({ days: 1, classes: 0, booked: 0, appMembers: 5, announceAt: Date.now() + 3600000, extend: { members: 48, trials: 3 } })
      : url === '/api/admin/closures' && opts?.method === 'POST' ? Promise.resolve({ closure: { id: 'k9' }, notified: 0, classes: 0, extended: 48 })
      : Promise.resolve({ today: '2026-10-09', closures: [] }))
    closureSheet({ today: '2026-10-09', onChange: () => {} })
    const host = await openLastSheet()
    await tick()
    expect(host.textContent).toContain('48 socios')
    await act(async () => { host.querySelector('[name="closure-extend"]').click() })
    await act(async () => { host.querySelector('[data-action="confirm-closure"]').click() })
    const post = apiMock.mock.calls.find(([u, o]) => u === '/api/admin/closures' && o?.method === 'POST')
    expect(JSON.parse(post[1].body)).toMatchObject({ from: '2026-10-10', to: '2026-10-10', notifyAll: true, extendDays: 1 })
  })
})
```

Imports: `ClosuresCard` de `./closures/ClosuresCard.jsx` y `closureSheet` de `./closures/ClosureSheet.jsx`.

En `views/admin/Clases.test.jsx` (líneas ~300-340, los dos tests de cierre):
- Cambiar los mocks a `/api/admin/closures/preview` y `/api/admin/closures`, con las respuestas nuevas (`{ days, classes, booked, appMembers, announceAt }`).
- Esperar el body `{ from, to, reason, notifyAll: true, extendDays: 0 }`.
- La lista de cierres ya no se dibuja en Clases (está en Resumen): borrar las aserciones de `ClosureList` y dejar las del calendario (`closures` dentro de `/api/admin/classes/calendar`).

Run: `cd frontend && npx vitest run src/views/admin/Closures.test.jsx`
Expected: FAIL.

- [ ] **Step 2: Implementar `closures/ClosureSheet.jsx`**

```jsx
// Cerrar el gimnasio (feriado, vacaciones): fechas, motivo, impacto (clases suspendidas, avisos) y
// las dos decisiones: avisar a todos (a la hora de avisos de cierre) y correr los vencimientos
// (solo con cuotas prendido y permiso de cuotas: lo decide el servidor en la vista previa).
// En PC, dos columnas. Reabrir: devolver los días corridos (prendido por defecto).
import { useEffect, useState } from 'react'
import { useUI } from '../../../store/useUI.js'
import { t } from '../../../lib/i18n.js'
import { errorText } from '../../../lib/errors.js'
import { closuresApi, closureLabel } from '../../../lib/closures.js'
import { addDays } from '../../../lib/classes.js'
import { Button, Segmented, TextField } from '../../../components/ui.jsx'
import Icon from '../../../components/Icon.jsx'

const ui = () => useUI.getState()
const REASONS = ['Feriado', 'Vacaciones', 'Mantenimiento']
const people = n => n === 1 ? t('1 persona') : t('{0} personas', n)
const members = n => n === 1 ? t('1 socio') : t('{0} socios', n)

// "sale ahora", "sale hoy a las 08:00" o "sale mañana a las 08:00" (hora local del navegador del staff).
function whenText(ms) {
  if (!ms || ms <= Date.now() + 60000) return t('sale ahora')
  const d = new Date(ms), now = new Date()
  const hh = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const sameDay = (a, b) => a.toDateString() === b.toDateString()
  const tomorrow = new Date(now); tomorrow.setDate(now.getDate() + 1)
  if (sameDay(d, now)) return t('sale hoy a las {0}', hh)
  if (sameDay(d, tomorrow)) return t('sale mañana a las {0}', hh)
  return t('sale el {0} a las {1}', `${d.getDate()}/${d.getMonth() + 1}`, hh)
}

function Closure({ today, onChange, close }) {
  const [mode, setMode] = useState('one')
  const [from, setFrom] = useState(addDays(today, 1))
  const [to, setTo] = useState(addDays(today, 1))
  const [reason, setReason] = useState('Feriado')
  const [preview, setPreview] = useState(null)   // respuesta de la vista previa | { error }
  const [notifyAll, setNotifyAll] = useState(true)
  const [extendOn, setExtendOn] = useState(false)
  const [extendDays, setExtendDays] = useState(1)
  const [busy, setBusy] = useState(false)
  const end = mode === 'one' ? from : to
  useEffect(() => {
    setPreview(null)
    const id = setTimeout(() => closuresApi.preview(from, end)
      .then(p => { setPreview(p); setExtendDays(p.days) })
      .catch(e => setPreview({ error: errorText(e, t('Revisá las fechas')) })), 250)
    return () => clearTimeout(id)
  }, [from, end])
  const ready = preview && !preview.error
  const notifies = ready && (preview.booked > 0 || (notifyAll && preview.appMembers > 0))
  const save = async () => {
    setBusy(true)
    try {
      const r = await closuresApi.add({ from, to: end, reason: reason.trim(), notifyAll, extendDays: extendOn && preview?.extend ? extendDays : 0 })
      const bits = [r.notified ? t('avisamos a {0} con reserva', people(r.notified)) : null, r.extended ? t('vencimientos corridos a {0}', members(r.extended)) : null].filter(Boolean)
      ui().toast(bits.length ? t('Gimnasio cerrado: {0}', bits.join(' · ')) : t('Gimnasio cerrado'))
      onChange && onChange()
      close()
    } catch (e) { ui().toast(errorText(e, t('No se pudo cerrar'))) }
    setBusy(false)
  }
  return <div className="closure-sheet">
    <h3>{t('Cerrar el gimnasio')}</h3>
    <div className="closure-cols">
      <div>
        <Segmented options={[{ value: 'one', label: t('Un día') }, { value: 'range', label: t('Varios días') }]} value={mode}
          onChange={m => { setMode(m); if (m === 'range' && to < from) setTo(from) }} />
        <div className="class-editor-row">
          <label className="member-field"><span className="member-field-l">{mode === 'one' ? t('Fecha') : t('Desde')}</span>
            <input className="input" type="date" min={today} value={from} onChange={e => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value) }} /></label>
          {mode === 'range' && <label className="member-field"><span className="member-field-l">{t('Hasta')}</span>
            <input className="input" type="date" min={from} value={to} onChange={e => setTo(e.target.value)} /></label>}
        </div>
        <div className="member-field">
          <span className="member-field-l">{t('Motivo')}</span>
          <div className="chips">{REASONS.map(r => <button key={r} type="button" className={'chip nocap' + (reason === r ? ' on' : '')} aria-pressed={reason === r} onClick={() => setReason(r)}>{t(r)}</button>)}</div>
          <TextField name="closure-reason" maxLength={40} value={reason} onChange={e => setReason(e.target.value)} placeholder={t('Otro motivo (opcional)')} />
        </div>
      </div>
      <div>
        <div className={'class-closure-preview small' + (preview?.error ? ' error' : '')} role="status">
          <Icon name="info" />
          <div>{!preview ? t('Calculando…') : preview.error ? preview.error : <>
            <div>{preview.days === 1 ? t('1 día cerrado') : t('{0} días cerrado', preview.days)}{preview.classes ? ' · ' + (preview.classes === 1 ? t('se suspende 1 clase') : t('se suspenden {0} clases', preview.classes)) : ''}</div>
            {preview.booked > 0 && <div>{t('{0} con reserva: se les avisa ahora', people(preview.booked))}</div>}
          </>}</div>
        </div>
        {ready && <label className="closure-toggle">
          <div className="grow">{t('Avisar a todos los socios')}<div className="small muted">{t('{0} con la app', preview.appMembers)} · {whenText(preview.announceAt)}</div></div>
          <input type="checkbox" role="switch" name="closure-notify" checked={notifyAll} onChange={e => setNotifyAll(e.target.checked)} />
        </label>}
        {ready && preview.extend && <label className="closure-toggle">
          <div className="grow">{t('Correr los vencimientos')}
            <div className="small muted">{t('+{0} días a {1} al día o por vencer', extendDays, members(preview.extend.members))}{preview.extend.trials ? ' ' + t('(y {0} en prueba)', preview.extend.trials) : ''}</div>
            {extendOn && <input className="input closure-days" type="number" min={1} max={preview.days} value={extendDays} aria-label={t('Días a correr')}
              onChange={e => setExtendDays(Math.max(1, Math.min(preview.days, Number(e.target.value) || 1)))} />}
          </div>
          <input type="checkbox" role="switch" name="closure-extend" checked={extendOn} onChange={e => setExtendOn(e.target.checked)} />
        </label>}
      </div>
    </div>
    <div className="closure-actions">
      <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
      <Button variant="danger" icon="lock" data-action="confirm-closure" disabled={!ready || busy} onClick={save}>{notifies ? t('Cerrar y avisar') : t('Cerrar')}</Button>
    </div>
  </div>
}

export function closureSheet({ today, onChange }) {
  ui().openSheet(close => <Closure today={today} onChange={onChange} close={close} />, { kind: 'panel' })
}

function Reopen({ c, canRevert, onChange, close }) {
  const [revert, setRevert] = useState(true)
  const go = async () => {
    try {
      const r = await closuresApi.remove(c.id, canRevert && c.extended > 0 ? revert : false)
      ui().toast(r.reverted ? t('Reabierto: devolvimos los días a {0}', members(r.reverted)) : t('Reabierto'))
      onChange && onChange()
    } catch (e) { ui().toast(errorText(e, t('No se pudo reabrir'))) }
    close()
  }
  return <div className="closure-reopen">
    <h3>{t('¿Reabrir {0}?', closureLabel(c))}</h3>
    <p className="small muted">{t('Las clases de esos días vuelven a estar disponibles. Las reservas que se cancelaron no vuelven; las fijas se reservan solas de nuevo.')}</p>
    {c.notifyAll && !c.announcedAt && <p className="small muted">{t('El aviso a los socios todavía no salió: se cancela.')}</p>}
    {canRevert && c.extended > 0 && <label className="closure-toggle">
      <div className="grow">{t('Devolver los {0} días a {1}', c.extendDays, members(c.extended))}</div>
      <input type="checkbox" role="switch" name="closure-revert" checked={revert} onChange={e => setRevert(e.target.checked)} />
    </label>}
    <div className="closure-actions">
      <Button variant="ghost" className="dim" onClick={close}>{t('Cancel')}</Button>
      <Button variant="primary" onClick={go}>{t('Reabrir')}</Button>
    </div>
  </div>
}

export function reopenClosure(c, { canRevert, onChange }) {
  ui().openSheet(close => <Reopen c={c} canRevert={canRevert} onChange={onChange} close={close} />, { kind: 'center' })
}
```

Revisar que `Button` reenvíe props extra al `<button>` (como `data-action`): `grep -n "export function Button" -A 8 frontend/src/components/ui.jsx`. Si no las reenvía, envolver el botón en un `<span data-action="confirm-closure">` y en el test hacer click en `span[data-action] button`. Lo mismo para `close-gym` en la tarjeta.

- [ ] **Step 3: Implementar `closures/ClosuresCard.jsx`**

```jsx
// Admin → Resumen: próximos cierres (y el que está en curso) con su estado, "＋ Cerrar" y "Reabrir"
// para quien tiene gym.closures. El owner no necesita permiso.
import { useEffect, useState } from 'react'
import { useStore } from '../../../store/useStore.js'
import { can } from '../../../lib/permissions.js'
import { t } from '../../../lib/i18n.js'
import { closuresApi, closureLabel } from '../../../lib/closures.js'
import { closureSheet, reopenClosure } from './ClosureSheet.jsx'
import { Button } from '../../../components/ui.jsx'
import Icon from '../../../components/Icon.jsx'

const hhmm = ms => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
function statusLine(c) {
  const bits = []
  if (c.notifyAll) bits.push(c.announcedAt ? t('avisado a todos') : t('aviso: {0} {1}', new Date(c.announceAt).toDateString() === new Date().toDateString() ? t('hoy') : `${new Date(c.announceAt).getDate()}/${new Date(c.announceAt).getMonth() + 1}`, hhmm(c.announceAt)))
  if (c.notified) bits.push(c.notified === 1 ? t('1 con reserva avisado') : t('{0} con reserva avisados', c.notified))
  if (c.extended) bits.push(c.extendDays === 1 ? t('vencimientos +1 día') : t('vencimientos +{0} días', c.extendDays))
  return bits.join(' · ')
}

export default function ClosuresCard() {
  const user = useStore(s => s.user)
  const manage = can(user, 'gym.closures')
  const canRevert = can(user, 'fees.manage')
  const [data, setData] = useState(null)
  const load = () => closuresApi.list().then(setData).catch(() => setData({ today: null, closures: [] }))
  useEffect(() => { load() }, [])
  if (!data) return null
  const list = (data.closures || []).filter(c => !data.today || c.to >= data.today)
  return <div className="card closures-card">
    <div className="row between">
      <h3 style={{ margin: 0 }}><Icon name="lock" /> {t('Cierres')}</h3>
      {manage && <Button size="sm" icon="plus" data-action="close-gym" onClick={() => closureSheet({ today: data.today, onChange: load })}>{t('Cerrar')}</Button>}
    </div>
    {!list.length ? <div className="small muted" style={{ marginTop: 6 }}>{t('No hay cierres programados')}</div>
      : list.map(c => <div key={c.id} className="closure-row">
        <div className="grow"><b>{closureLabel(c)}</b>{c.reason && <span className="small muted"> · {c.reason}</span>}
          {statusLine(c) && <div className="small muted">{statusLine(c)}</div>}</div>
        {manage && <Button size="sm" variant="plain" onClick={() => reopenClosure(c, { canRevert, onChange: load })}>{t('Reabrir')}</Button>}
      </div>)}
  </div>
}
```

En `Resumen.jsx`, import `ClosuresCard from './closures/ClosuresCard.jsx'`, y después del bloque de `tiles` (línea ~97): `<ClosuresCard />`.

En `Clases.jsx`:
- Import `import { closureSheet } from './closures/ClosureSheet.jsx'` (en lugar de `./clases/ClosureSheet.jsx`).
- Borrar `ClosureList`, el estado `closures` y `loadClosures`.
- El botón "Cerrar el gimnasio" se muestra con `can(user, 'gym.closures')` en vez de `canManage`.

Borrar `frontend/src/views/admin/clases/ClosureSheet.jsx`.

- [ ] **Step 4: Notificaciones, adherencia y auditoría**

`Notificaciones.jsx`:
- Generalizar `NotifyHourCard` con props `{ field, title, help, name }`.
- Leer `d[field]` en el `GET`, mandar `{ [field]: value }` en el `PUT` y guardar `d[field]` de la respuesta.
- `export default function Notificaciones()`:

```jsx
  return <div className="admin-cards"><PushNotificationCard />
    <NotifyHourCard field="billing_notify_hour" name="app-admin-billing-notify-hour" title={t('Horario de avisos de cuota')} help={t('Se usa para el aviso de vencimiento y el recordatorio de cuota')} />
    <NotifyHourCard field="closure_notify_hour" name="app-admin-closure-notify-hour" title={t('Horario de avisos de cierre')} help={t('A esta hora sale el aviso a todos los socios cuando cerrás el gimnasio')} />
  </div>
```

`shared.jsx`, `AdherenceStrip`:
- Sumar a `DAY_STATES`: `closed: ['lock', 'Gimnasio cerrado']`.
- `weekAdherence({ workouts: d.workouts, week: d.week, dayPlan: d.dayPlan, closures: d.closures || [] }, d.today)`.
- En el texto, si `a.closed`: `+ ' · ' + t(a.closed === 1 ? '1 día cerrado' : '{0} días cerrados', a.closed)`.

`lib/audit.js`, debajo de las dos de `classes.closure.*`:

```js
  'gym.closure.add': 'Cerró el gimnasio',
  'gym.closure.delete': 'Reabrió el gimnasio',
```

`index.css`:

```css
.closure-sheet .closure-cols{display:grid;gap:12px}
@media (min-width:768px){.closure-sheet{min-width:680px}.closure-sheet .closure-cols{grid-template-columns:1fr 1fr}}
.closure-toggle{display:flex;align-items:center;gap:10px;padding:10px 12px;margin:8px 0;border-radius:12px;background:var(--surface-2)}
.closure-days{width:80px;margin-top:6px}
.closure-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:12px}
.closures-card .closure-row{display:flex;align-items:center;gap:8px;padding-top:10px;margin-top:10px;border-top:1px solid var(--sep)}
.adh-d.closed .adh-i{color:var(--orange)}
```

- [ ] **Step 5: Verificar que pasan**

Run: `cd frontend && npx vitest run src/views/admin src/lib/audit.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/views/admin frontend/src/lib/audit.js frontend/src/index.css
git commit -m "feat(closures): admin closures card, expanded closure sheet, reopen with revert and notify hour"
```

---

### Task 12: Verificación final

**Files:** ninguno nuevo. Solo arreglos si algo falla.

- [ ] **Step 1: Suites completas**

Run: `cd api && npm test`
Expected: PASS.

Run: `cd frontend && npm test && npm run build && node scripts/check-locales.mjs && node scripts/check-source-strings.mjs`
Expected: tests y build en PASS, y locales sin faltantes. `check-source-strings` solo informa: revisar que no aparezcan cadenas nuevas en inglés.

Run: `cd scripts/demo && node --test seed-demo.test.mjs` (si el CI lo corre así; si no, `grep -n "seed-demo" .github/workflows/test.yml` para ver el comando).
Expected: PASS.

- [ ] **Step 2: Prueba en dev (navegador)**

Con el servidor de dev local (`.claude/launch.json`; si no existe, preguntar al usuario cómo levantarlo):
1. Como owner, en Admin → Resumen → "＋ Cerrar": cerrar **hoy**. Ver la vista previa, el aviso ("sale ahora") y la ausencia de "Correr los vencimientos" con cuotas apagado.
2. Recargar la app como socio y ver el **cartel** con Aceptar. Recargar otra vez: no vuelve a salir.
3. Inicio: banner "Hoy el gimnasio está cerrado", tira con el día rayado y 🔒, línea "objetivo es N". Calendario con el día cerrado.
4. Cerrar una semana entera futura y ver en el calendario 🔒 en lugar de la llama. Reabrir.
5. Con cuotas prendido, cerrar 2 días con "Correr los vencimientos". Ver en Cuotas que el vencimiento se corrió. Reabrir con "Devolver" y verlo volver.
6. Admin → Notificaciones: cambiar la hora de avisos de cierre.
7. PC (≥ 768 px): la hoja en dos columnas. Celular: la hoja en una columna. Modo claro y oscuro.

- [ ] **Step 3: Commit de arreglos (si hubo)**

```bash
git add -A
git commit -m "fix(closures): adjustments from dev testing"
```

No hacer push ni merge sin que el usuario lo pida.
