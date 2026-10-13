# Suplementos (etapa 2): plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el staff con permiso vea los suplementos de un socio (activos, cumplimiento, heatmap y días con exceso) dentro de Administrar → Nutrición, y pueda deshabilitarle la sección con un motivo.

**Architecture:** Dos permisos nuevos en el catálogo (`api/permissions.js`) con migración al rol Nutricionista. El estado "deshabilitado por el staff" vive en `supplement_profile` y lo aplica `writeGuard` (rutas del socio, cola de sync y recordatorios). Dos rutas de staff en `api/supplements-routes.js`. En el cliente, `AdminSupplementsCard` se monta en la pestaña Nutrición de `AdminManageSheet`; la tarjeta del socio muestra el estado deshabilitado.

**Tech Stack:** Node 22 `node:http` + `node:sqlite` (`node --test`); React 19 + Zustand + Vitest.

**Spec:** `docs/superpowers/specs/2026-10-13-suplementos-etapa-2-design.md` (y la de la etapa 1, `2026-10-09-suplementos-design.md`).

## Global Constraints

- Voseo, `lauyim` en minúscula. Commits en inglés, Conventional Commits, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, push al terminar cada tarea. Rama `feat/suplementos`.
- Permisos: `supplements.view` (requires `members.view`, `health.view`) y `supplements.manage` (requires `supplements.view`). Nutricionista los dos; Administrador ninguno.
- La sección del staff **no** muestra si aceptó el aviso. La cafeína solo como total del día > 400 mg. Las tomas que se mandan al staff no llevan hora ni fuente.
- Motivo: opcional, máx. 120 caracteres, lo ve el socio; al habilitar se borra.
- Error del socio deshabilitado: `403 { error: 'supplements_disabled' }`.
- Auditoría: `admin.supplements.disabled` / `admin.supplements.enabled`, categoría Entrenamiento.
- Tests: `cd api && node --test <archivo>`; `cd frontend && npx vitest run <archivo>`. Al final: `cd api && npm test`; `cd frontend && npm test && npm run build && node scripts/check-locales.mjs`.

---

### Task 1: Permisos y migración

**Files:** Modify `api/permissions.js`, `api/database.js`; Test `api/permissions.test.js`, `api/roles-db.test.js`.

**Interfaces — Produces:** códigos `supplements.view`, `supplements.manage`; `ROUTE_PERMISSIONS['GET /api/admin/users/:userId/supplements'] = 'supplements.view'`, `ROUTE_PERMISSIONS['PUT /api/admin/users/:userId/supplements/access'] = 'supplements.manage'` (se agregan en la Tarea 3, junto con las rutas, para que `route-permissions.test.js` no falle antes).

- [ ] **Step 1: Tests que fallan**

En `api/permissions.test.js`:

```js
test('suplementos: ver pide salud; deshabilitar pide ver', () => {
  assert.deepEqual(withDependencies(['supplements.manage']), ['members.view', 'health.view', 'supplements.view', 'supplements.manage']);
  assert.deepEqual(withoutDependents(['members.view', 'health.view', 'supplements.view', 'supplements.manage'], 'health.view'), ['members.view']);
  const nutri = DEFAULT_ROLES.find(r => r.id === 'nutrition');
  assert.ok(nutri.permissions.includes('supplements.manage'));
  assert.ok(!DEFAULT_ROLES.find(r => r.id === 'admin').permissions.includes('supplements.view'));
});
```

(sumar `withoutDependents` y `DEFAULT_ROLES` al import si faltan).

En `api/roles-db.test.js`, un test nuevo: una base con el rol `nutrition` creado **sin** los permisos de suplementos (actualizar su fila a `["members.view","nutrition.manage","health.view"]` y borrar la marca `supplements_perms_seeded` de `admin_settings`), `closeDatabase()` + `initDatabase()` → el rol tiene `supplements.view` y `supplements.manage`; sacárselos y reiniciar → no vuelven.

- [ ] **Step 2: Correr y ver que fallan** — `cd api && node --test permissions.test.js roles-db.test.js`.

- [ ] **Step 3: Implementar**

`api/permissions.js`, después de `health.view`:

```js
  { code: 'supplements.view', area: 'Salud', name: 'Ver suplementos', help: 'Qué suplementos toma cada socio, si los cumple y los días en que se pasó de la dosis (datos sensibles).', requires: ['members.view', 'health.view'] },
  { code: 'supplements.manage', area: 'Salud', name: 'Deshabilitar suplementos', help: 'Deshabilitarle a un socio la guía y el seguimiento de suplementos (por ejemplo, por indicación médica).', requires: ['supplements.view'] },
```

`DEFAULT_ROLES` Nutricionista: `withDependencies(['nutrition.manage', 'health.view', 'supplements.manage'])`.

`api/database.js`, después de `migrateRolePerms('classes_perms_v2', …)`:

```js
  // Suplementos (etapa 2): el Nutricionista ve y puede deshabilitar. Una sola vez; si el owner se los
  // saca, no vuelven.
  migrateRolePerms('supplements_perms_seeded', { nutrition: add(['supplements.manage']) });
```

- [ ] **Step 4: Correr y ver que pasan** — mismo comando + `route-permissions.test.js`.
- [ ] **Step 5: Commit** — `feat(supplements): staff permissions to view and disable supplements`.

---

### Task 2: Deshabilitado por el staff (datos y reglas del socio)

**Files:** Modify `api/supplements-db.js`, `api/supplements-routes.js`; Test `api/supplements-db.test.js`, `api/supplements.http.test.js`, `api/scheduler-supplements.test.js`.

**Interfaces — Produces:**
- `sdb.getProfile(userId)` suma `staffDisabled: boolean`, `staffReason: string|null`, `staffBy: string|null`, `staffAt: string|null`.
- `sdb.setStaffAccess(userId, { disabled: boolean, reason: string|null, by: string })`.
- `writeGuard` devuelve `[403, { error: 'supplements_disabled' }]` si está deshabilitado (después del chequeo de módulo y consentimiento, antes del aviso).
- `GET /api/supplements` suma `disabled: { reason } | null`.

- [ ] **Step 1: Tests que fallan**

`supplements-db.test.js`:

```js
test('acceso del staff: deshabilitar con motivo y habilitar lo borra', () => {
  sdb.setStaffAccess('beto', { disabled: true, reason: 'Por indicación médica', by: 'nutri' });
  let p = sdb.getProfile('beto');
  assert.deepEqual([p.staffDisabled, p.staffReason, p.staffBy], [true, 'Por indicación médica', 'nutri']);
  assert.ok(p.staffAt);
  sdb.setStaffAccess('beto', { disabled: false, reason: 'ignorado', by: 'nutri' });
  p = sdb.getProfile('beto');
  assert.deepEqual([p.staffDisabled, p.staffReason], [false, null]);
});
```

`supplements.http.test.js` (antes del test del owner que apaga el módulo): con `db` abierto en el test no se puede (el server corre en otro proceso); hacerlo por la ruta de staff recién en la Tarea 3. En esta tarea, test de `writeGuard` directo en un archivo nuevo `api/supplements-guard.test.js`:

```js
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-supp-guard-'));
process.env.DATA_DIR = dataDir;
const db = await import('./database.js');
const sdb = await import('./supplements-db.js');
const { writeGuard } = await import('./supplements-routes.js');
const { SUPP_ACK_VERSION } = await import('./supplements.js');
db.initDatabase();
after(() => { db.closeDatabase(); fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
db.createUser({ id: 'owner', name: 'o', created: Date.now() });
db.createUser({ id: 'ana', name: 'ana', created: Date.now(), healthConsent: true });

test('writeGuard: deshabilitado por el staff gana sobre el aviso', () => {
  sdb.setAck('ana', SUPP_ACK_VERSION, 1);
  assert.equal(writeGuard({ id: 'ana' }), null);
  sdb.setStaffAccess('ana', { disabled: true, reason: null, by: 'owner' });
  assert.deepEqual(writeGuard({ id: 'ana' }), [403, { error: 'supplements_disabled' }]);
  sdb.setStaffAccess('ana', { disabled: false, reason: null, by: 'owner' });
  assert.equal(writeGuard({ id: 'ana' }), null);
});
```

`scheduler-supplements.test.js`, un test más al final: `sdb.setStaffAccess('ana', { disabled: true, … })` → `tick(at('09:00'))` sin envíos de `ana`; después volver a habilitar.

- [ ] **Step 2: Correr y ver que fallan.**

- [ ] **Step 3: Implementar**

`supplements-db.js`, en `migrateSupplements` (junto a `reminder_times`):

```js
  // Etapa 2: el staff le deshabilita la sección a un socio (motivo opcional que ve el socio).
  for (const col of ['staff_disabled INTEGER NOT NULL DEFAULT 0', 'staff_reason TEXT', 'staff_by TEXT', 'staff_at TEXT']) {
    try { db.exec(`ALTER TABLE supplement_profile ADD COLUMN ${col};`); } catch {}
  }
```

`getProfile` devuelve además `staffDisabled: r?.staff_disabled === 1, staffReason: r?.staff_reason || null, staffBy: r?.staff_by || null, staffAt: r?.staff_at || null` (y el objeto vacío inicial con esos valores en falso/null; actualizar el `deepEqual` existente del perfil vacío en `supplements-db.test.js`).

```js
export function setStaffAccess(userId, { disabled, reason, by }) {
  ensureProfile(userId);
  getDatabase().prepare('UPDATE supplement_profile SET staff_disabled = ?, staff_reason = ?, staff_by = ?, staff_at = ? WHERE user_id = ?')
    .run(disabled ? 1 : 0, disabled ? (reason || null) : null, by || null, nowIso(), userId);
}
```

`supplements-routes.js` `writeGuard`, después del chequeo de consentimiento:

```js
  const profile = sdb.getProfile(user.id);
  if (profile.staffDisabled) return [403, { error: 'supplements_disabled' }];
  if (profile.ackVersion !== SUPP_ACK_VERSION) return [409, { error: 'supplements_ack_required' }];
```

(reemplaza la línea del aviso que leía `sdb.getProfile` de nuevo). En `GET /api/supplements`, sumar `disabled: p.staffDisabled ? { reason: p.staffReason } : null`.

- [ ] **Step 4: Correr y ver que pasan** — `node --test supplements-db.test.js supplements-guard.test.js scheduler-supplements.test.js supplements.http.test.js supplements-sync.test.js`.
- [ ] **Step 5: Commit** — `feat(supplements): staff-disabled state enforced on member writes and reminders`.

---

### Task 3: Rutas del staff

**Files:** Modify `api/supplements-routes.js`, `api/server.js`, `api/permissions.js` (`ROUTE_PERMISSIONS`), `api/audit-categories.js`, `api/route-permissions.test.js`; Test `api/supplements-staff.http.test.js`, `api/audit-categories.test.js`.

**Interfaces — Produces:**
- `GET /api/admin/users/:userId/supplements` → `{ enabled: boolean, access: { disabled, reason, at }, items: Item[], logs: { itemId, date, amount }[], caffeine: { date, mg }[], plan: { week, dayPlan, workoutDates: string[] } }`; módulo apagado → `{ enabled: false }`.
- `PUT /api/admin/users/:userId/supplements/access` body `{ enabled: boolean, reason?: string }` → `{ access: { disabled, reason, at } }`.
- `supplementRoutes(d)` recibe además `requireAdmin` y `requireManageableTarget`.

- [ ] **Step 1: Test HTTP que falla** (`api/supplements-staff.http.test.js`, mismo arnés que `supplements.http.test.js`, puertos `53000–53900`). Datos sembrados antes de arrancar el server: owner; `nutri` con `role_id = 'nutrition'` (rol de fábrica, ya tiene los permisos por la Tarea 1); `recep` con `role_id = 'reception'`; `ana` con consentimiento, aviso aceptado (`sdb.setAck`), creatina y logs: 25 g un día dentro de los últimos 30 (exceso), 5 g otros días; cafeína: un día con mate 130 × 4 (520 mg) y otro con 130 (no exceso); `nosalud` con consentimiento negado.

```js
test('nutricionista: ve items, tomas sin hora ni fuente y cafeína solo de días con exceso', async () => {
  const r = await call('nutri', 'GET', '/api/admin/users/ana/supplements');
  assert.equal(r.status, 200);
  assert.equal(r.body.enabled, true);
  assert.equal(r.body.items[0].catalogId, 'creatina');
  assert.ok(r.body.logs.every(l => Object.keys(l).sort().join() === 'amount,date,itemId'));
  assert.deepEqual(r.body.caffeine.map(c => c.mg), [520]);
  assert.ok(Array.isArray(r.body.plan.workoutDates));
  assert.deepEqual(r.body.access, { disabled: false, reason: null, at: null });
});
test('sin permiso 403; sin consentimiento 409', async () => {
  assert.equal((await call('recep', 'GET', '/api/admin/users/ana/supplements')).status, 403);
  assert.equal((await call('nutri', 'GET', '/api/admin/users/nosalud/supplements')).body.error, 'no_health_consent');
});
test('deshabilitar con motivo: el socio lo ve y no puede escribir; habilitar borra el motivo', async () => {
  const off = await call('nutri', 'PUT', '/api/admin/users/ana/supplements/access', { enabled: false, reason: 'Por indicación médica' });
  assert.equal(off.body.access.disabled, true);
  assert.deepEqual((await call('ana', 'GET', '/api/supplements')).body.disabled, { reason: 'Por indicación médica' });
  assert.equal((await call('ana', 'POST', '/api/supplements/log', { id: 'logoff01', source: 'mate', date: today, amount: 130 })).body.error, 'supplements_disabled');
  assert.equal((await call('nutri', 'PUT', '/api/admin/users/ana/supplements/access', { enabled: false, reason: 'x'.repeat(121) })).status, 400);
  const on = await call('nutri', 'PUT', '/api/admin/users/ana/supplements/access', { enabled: true, reason: 'ignorado' });
  assert.deepEqual([on.body.access.disabled, on.body.access.reason], [false, null]);
  assert.equal((await call('ana', 'GET', '/api/supplements')).body.disabled, null);
  const logs = (await call('owner', 'GET', '/api/admin/audit?limit=20')).body;
  assert.ok(JSON.stringify(logs).includes('admin.supplements.disabled'));
});
test('módulo apagado por el owner: enabled false', async () => {
  await call('owner', 'PUT', '/api/owner/supplements', { enabled: false });
  assert.deepEqual((await call('nutri', 'GET', '/api/admin/users/ana/supplements')).body, { enabled: false });
  await call('owner', 'PUT', '/api/owner/supplements', { enabled: true });
});
```

(revisar la ruta real del registro de actividad con `grep -n "'GET /api/admin/audit" api/server.js` y su forma de respuesta; ajustar la última aserción a esa forma.)

En `audit-categories.test.js`: `assert.equal(auditCategory('admin.supplements.disabled'), 'training')`.

- [ ] **Step 2: Correr y ver que falla.**

- [ ] **Step 3: Implementar**

`supplements-routes.js`, dentro del objeto de rutas:

```js
    // Staff (etapa 2): lo mínimo para el nutricionista. Tomas sin hora ni fuente; cafeína solo el total
    // de los días que pasaron de 400 mg (últimos 30).
    'GET /api/admin/users/:userId/supplements': async (req, res) => {
      const admin = d.requireAdmin(req, res); if (!admin) return;
      const target = d.requireManageableTarget(res, userIdFromReq(req)); if (!target) return;
      if (!supplementsOn()) return json(res, 200, { enabled: false });
      const today = clock().date;
      const p = sdb.getProfile(target.id);
      const items = sdb.listItems(target.id);
      const all = sdb.listLogs(target.id, addDays(today, -182));
      const byDay = new Map();
      for (const l of all) if (l.source && l.date >= addDays(today, -29)) byDay.set(l.date, (byDay.get(l.date) || 0) + (Number(l.amount) || 0));
      const state = getUserState(target.id) || {};
      json(res, 200, {
        enabled: true,
        access: { disabled: p.staffDisabled, reason: p.staffReason, at: p.staffAt },
        items,
        logs: all.filter(l => l.itemId).map(l => ({ itemId: l.itemId, date: l.date, amount: l.amount })),
        caffeine: [...byDay].filter(([, mg]) => mg > 400).map(([date, mg]) => ({ date, mg: Math.round(mg) })).sort((a, b) => b.date.localeCompare(a.date)),
        plan: { week: state.week || {}, dayPlan: state.dayPlan || {}, workoutDates: [...new Set((state.workouts || []).map(w => w.d))] },
      });
    },
    'PUT /api/admin/users/:userId/supplements/access': async (req, res) => {
      const admin = d.requireAdmin(req, res); if (!admin) return;
      const target = d.requireManageableTarget(res, userIdFromReq(req)); if (!target) return;
      const body = await readBody(req);
      if (typeof body.enabled !== 'boolean') return json(res, 400, { error: 'enabled debe ser true o false' });
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      if (reason.length > 120) return json(res, 400, { error: 'El motivo va hasta 120 caracteres' });
      sdb.setStaffAccess(target.id, { disabled: !body.enabled, reason: reason || null, by: admin.id });
      const p = sdb.getProfile(target.id);
      d.audit(req, body.enabled ? 'admin.supplements.enabled' : 'admin.supplements.disabled', { user: admin, target, summary: body.enabled ? 'Suplementos habilitados' : 'Suplementos deshabilitados' + (reason ? `: ${reason}` : '') });
      json(res, 200, { access: { disabled: p.staffDisabled, reason: p.staffReason, at: p.staffAt } });
    },
```

Arriba del archivo: `const userIdFromReq = req => decodeURIComponent(new URL(req.url, 'http://x').pathname.split('/')[4] || '');`. Si el ítem del cliente de cafeína heredada (`catalogId: 'cafeina'`) aparece en `items`, sus tomas cuentan como cafeína del día: sumar también `l.itemId` de items `cafeina` al total `byDay` (filtrar con un `Set` de esos ids).

`server.js`:
1. `...supplementRoutes({ json, readBody, readSession, requireOwner, requireAdmin, requireManageableTarget, audit })`.
2. Dispatcher, junto a las rutas de nutrición:

```js
    : req.method === 'GET' && /^\/api\/admin\/users\/[^/]+\/supplements$/.test(url.pathname)
      ? 'GET /api/admin/users/:userId/supplements'
    : req.method === 'PUT' && /^\/api\/admin\/users\/[^/]+\/supplements\/access$/.test(url.pathname)
      ? 'PUT /api/admin/users/:userId/supplements/access'
```

3. Gate de salud: la regex `/ \/api\/admin\/users\/:userId\/(nutrition|injuries)/` → `(nutrition|injuries|supplements)`.

`permissions.js` `ROUTE_PERMISSIONS`: las dos rutas. `audit-categories.js`: `/^admin\.(routine|preset|program|injury|nutrition|supplements)\./`. `route-permissions.test.js`: sumar `'./supplements-routes.js'` a la lista de archivos.

- [ ] **Step 4: Correr y ver que pasan** — `node --test supplements-staff.http.test.js route-permissions.test.js audit-categories.test.js supplements.http.test.js`.
- [ ] **Step 5: Commit** — `feat(supplements): staff routes to view a member's supplements and disable them`.

---

### Task 4: Días con exceso (lógica pura del cliente)

**Files:** Modify `frontend/src/lib/suplementos.js`; Test `frontend/src/lib/suplementos.test.js`.

**Interfaces — Produces:** `excessDays({ items, logs, caffeine, today })` → `[{ date, name, amount, max, unit }]` de los últimos 30 días, más nuevo primero (empate: por nombre); `amount` = suma del día del ítem si supera `fichaById(catalogId).dayMax`; la cafeína (`caffeine: [{date, mg}]`) entra como `{ name: 'Cafeína', amount: mg, max: 400, unit: 'mg' }`. Y `excessDayCount(rows)` = fechas distintas.

- [ ] **Step 1: Test que falla**

```js
describe('excesos', () => {
  it('suma del día contra el máximo de la ficha, cafeína incluida, 30 días', () => {
    const items = [crea]
    const logs = [log('i1', addDays(TODAY, -2), { amount: 15 }), log('i1', addDays(TODAY, -2), { amount: 10 }), log('i1', addDays(TODAY, -3), { amount: 5 }), log('i1', addDays(TODAY, -40), { amount: 30 })]
    const caffeine = [{ date: addDays(TODAY, -2), mg: 520 }, { date: addDays(TODAY, -5), mg: 450 }]
    const rows = excessDays({ items, logs, caffeine, today: TODAY })
    expect(rows.map(r => [r.date, r.name, r.amount, r.max])).toEqual([
      [addDays(TODAY, -2), 'Cafeína', 520, 400], [addDays(TODAY, -2), 'Creatina monohidrato', 25, 20], [addDays(TODAY, -5), 'Cafeína', 450, 400]])
    expect(excessDayCount(rows)).toBe(2)
  })
})
```

- [ ] **Step 2–4:** implementar en `suplementos.js`:

```js
// Días con exceso de los últimos 30 (vista del staff): cada ítem contra el máximo diario de su ficha,
// y la cafeína (total del día que ya viene filtrado > 400 mg). Más nuevo primero.
export function excessDays({ items, logs, caffeine = [], today }) {
  const from = addDays(today, -29)
  const rows = []
  for (const item of items) {
    const max = fichaById(item.catalogId)?.dayMax
    if (!max) continue
    const byDay = new Map()
    for (const l of logs) if (l.itemId === item.id && l.date >= from && l.date <= today) byDay.set(l.date, (byDay.get(l.date) || 0) + (Number(l.amount) || 0))
    for (const [date, amount] of byDay) if (amount > max) rows.push({ date, name: itemName(item), amount: Math.round(amount * 10) / 10, max, unit: item.unit })
  }
  for (const c of caffeine) if (c.date >= from && c.date <= today && c.mg > 400) rows.push({ date: c.date, name: 'Cafeína', amount: c.mg, max: 400, unit: 'mg' })
  return rows.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name))
}
export const excessDayCount = rows => new Set(rows.map(r => r.date)).size
```

Correr `npx vitest run src/lib/suplementos.test.js` y commit `feat(supplements): excess days for the staff view`.

---

### Task 5: Socio deshabilitado (tarjeta)

**Files:** Modify `frontend/src/store/useSupplements.js` (`DATA_KEYS` y `EMPTY` suman `disabled: null`), `frontend/src/components/suplementos/SuplementosCard.jsx`, `frontend/src/lib/errors.js`; Test `SuplementosCard.test.jsx`, `errors.test.js` (pasa solo con el texto nuevo).

- [ ] **Step 1: Test que falla** (en `SuplementosCard.test.jsx`):

```jsx
  it('deshabilitado por el gimnasio: candado con motivo, sin guía ni seguimiento', async () => {
    await mount({ ...base, items: [crea], disabled: { reason: 'Por indicación médica' } })
    expect(text()).toContain('Tu gimnasio deshabilitó la sección de suplementos para tu cuenta')
    expect(text()).toContain('Por indicación médica')
    expect(text()).not.toContain('Guía'); expect(text()).not.toContain('Hoy:')
  })
```

- [ ] **Step 2–4:** en `SuplementosCard`, después del chequeo de `off/loaded/enabled` y **antes** del aviso:

```jsx
  if (st.disabled) return <div className="card supp-card">
    {header}
    <div className="supp-lock supp-lock-row"><Icon name="lock" /><span>{t('Tu gimnasio deshabilitó la sección de suplementos para tu cuenta.')}
      {st.disabled.reason && <span className="supp-reason">{t('Motivo: {0}', st.disabled.reason)}</span>}</span></div>
    <div className="small dim">{t('Si tenés dudas, consultá en recepción.')}</div>
  </div>
```

CSS: `.supp-reason{display:block;margin-top:6px;font-weight:600}`. `errors.js`: `supplements_disabled: 'Tu gimnasio deshabilitó la sección de suplementos para tu cuenta.'`. `withNotice` no abre nada si `useSupplements.getState().disabled`: en `AvisoInicial.jsx`, `export const withNotice = fn => useSupplements.getState().disabled ? undefined : noticeAccepted(useSupplements.getState()) ? fn() : openNotice(fn)`.

Correr y commit `feat(supplements): member card shows the staff-disabled state`.

---

### Task 6: Sección del staff en Administrar → Nutrición

**Files:** Create `frontend/src/components/suplementos/AdminSupplementsCard.jsx`, `frontend/src/components/suplementos/AdminSupplementsCard.test.jsx`; Modify `frontend/src/views/admin/shared.jsx`, `frontend/src/lib/audit.js`, `frontend/src/locales/es.js`, `frontend/src/index.css`.

**Interfaces — Consumes:** rutas de la Tarea 3; `excessDays`, `excessDayCount` (Tarea 4); `streakOf`, `adherence30`, `dayLevel`, `isDueOn`, `sinceOf`, `doseLabel`, `itemName`, `proteinPerTake` (etapa 1); `HeatmapGrid`; `can` de `lib/permissions.js`; `confirmSheet` de `sheets.jsx`.

Comportamiento (spec, "La sección"):
- Carga `GET /api/admin/users/:userId/supplements`. `enabled: false` → no renderiza nada.
- Día de entreno del socio: `iso => !!(plan.dayPlan?.[iso]?.rutinaId || (typeof plan.dayPlan?.[iso] === 'string' && plan.dayPlan[iso] !== 'rest') || (!plan.dayPlan?.[iso] && plan.week?.[new Date(iso + 'T12:00:00').getDay()])) || plan.workoutDates.includes(iso)` (misma regla que `isTrainingDay`; extraer a una función local `trainingDayFromPlan(plan)`).
- `today`: `todayISO()`.
- Título "Suplementos" + aviso `⚠️ {n} días con exceso` (`excessDayCount`; "1 día con exceso" en singular) si hay.
- Heatmap 26 semanas (nivel = mínimo de los activos que tocaban, como en "Mis suplementos").
- Activos: nombre + `🔥 n` + `doseLabel` (+ gramos de proteína) · momento (`SLOTS`) y a la derecha `adherence30` como "93 %" o "—". Pie "% = cumplimiento de los últimos 30 días" + " · N archivados" si hay.
- "Días con exceso (últimos 30)": filas `excessDays` → "vie 3/10 · Creatina monohidrato · **25 g** / 20".
- "Acceso": "Guía y seguimiento" + "Habilitado para este socio" / "Deshabilitado · {motivo}". Con `can(user, 'supplements.manage')`: `Switch`. Apagar → hoja de confirmación con campo de motivo (máx. 120) y botón "Deshabilitar" (rojo); prender → directo. Toasts "Suplementos deshabilitados" / "Suplementos habilitados".
- Sin items: "No registra suplementos." + Acceso.
- Error al cargar: toast con `errorText`.
- PC ≥ 768 px: dos columnas (`.supp-admin-cols`).

En `shared.jsx`:
- `UserDetail`: `manageTabs = [(allowed('nutrition.manage') || allowed('supplements.view')) && 'nutrition', allowed('training.manage') && 'routine'].filter(Boolean)`.
- `AdminManageSheet`, pestaña Nutrición (rama sin `no-health`): `{canNutrition && <AdminNutritionCard … />}{canSupps && <AdminSupplementsCard userId={userId} userName={userName} />}` con `const me = useStore(s => s.user); const canNutrition = can(me, 'nutrition.manage'); const canSupps = can(me, 'supplements.view')`.

Auditoría en el cliente (`lib/audit.js` + `es.js`): `'admin.supplements.disabled': 'Disabled supplements for a member'` → "Deshabilitó suplementos a un socio"; `'admin.supplements.enabled': 'Enabled supplements for a member'` → "Habilitó suplementos a un socio".

- [ ] **Step 1: Tests que fallan** (`AdminSupplementsCard.test.jsx`, mismo arnés que `SuplementosCard.test.jsx`, `apiMock` por URL):
  - con items y excesos → texto "2 días con exceso", "Creatina monohidrato", "93 %" (o el % calculado con los logs del fixture), "Cafeína" y "520 mg";
  - sin `supplements.manage` (user con `permissions: ['members.view','health.view','supplements.view']`) → sin `[role="switch"]` y con "Habilitado para este socio";
  - con `supplements.manage`: apagar el switch → hoja con "¿Deshabilitar suplementos para Ana?" → escribir motivo → "Deshabilitar" → `apiMock` con `PUT …/supplements/access` y body `{ enabled: false, reason: 'Por indicación médica' }`;
  - `enabled: false` → no renderiza;
  - `shared.jsx`: test en `Admin.suggestions.test.jsx` (o uno nuevo) de que la pestaña Nutrición existe con solo `supplements.view` y no muestra "Metas nutricionales".
- [ ] **Step 2–4:** implementar, estilos (`.supp-admin-cols{display:grid;grid-template-columns:1fr 1fr;gap:0 18px}` en ≥ 768 px; `.supp-warnb`, `.supp-ex-row`), correr `npx vitest run src/components/suplementos src/views/Admin.suggestions.test.jsx src/views/admin`.
- [ ] **Step 5: Commit** — `feat(supplements): staff section in Administrar → Nutrición`.

---

### Task 7: Textos legales y versiones

**Files:** Modify `api/supplements.js` y `frontend/src/lib/suplementos-data.js` (`SUPP_ACK_VERSION = '2026-10-13'`), `frontend/src/lib/suplementos-data.test.js`, `frontend/src/components/suplementos/AvisoInicial.jsx`, `frontend/src/components/PrivacyNotice.jsx`, `frontend/src/views/admin/Acceso.jsx`, `api/legal.js` (`LEGAL_VERSION = '2026-10-13'`), tests que fijan textos (`LegalNotices.test.jsx`, `SupplementsToggle.test.jsx`).

- [ ] **Step 1:** tests: el aviso contiene "El staff del gimnasio con permiso (por ejemplo, nutricionistas) puede ver lo que registrás."; privacidad contiene "los ves vos y el staff con permiso"; `SUPP_ACK_VERSION` = '2026-10-13'.
- [ ] **Step 2–4:** cambiar los textos:
  - Aviso: debajo del recuadro de información general, `<div className="supp-box">El staff del gimnasio con permiso (por ejemplo, nutricionistas) puede ver lo que registrás.</div>` (con `t()`).
  - Privacidad: "Los suplementos que registres son un dato de salud: los ves vos y el staff con permiso (por ejemplo, nutricionistas), y se borran con "Borrar mis datos de salud"."
  - Owner: "En Nutrición: una guía basada en evidencia y el registro de lo que toma cada socio. Lo ve cada socio y el staff con permiso de ver suplementos."
- [ ] **Step 5: Commit** — `feat(supplements): legal texts say the permitted staff can see supplements`.

---

### Task 8: Verificación

- [ ] `cd api && npm test`; `cd frontend && npm test && npm run build && node scripts/check-locales.mjs`.
- [ ] Navegador (dev local, `api-supp` + `frontend`): dueña → ficha de ana → Administrar → Nutrición → sección Suplementos (celular y PC); deshabilitar con motivo → como ana, la tarjeta bloqueada con el motivo; habilitar.
- [ ] Actualizar la spec si algo cambió, memoria, push.
