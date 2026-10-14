# Suplementos, etapa 2: el staff ve y puede deshabilitar

Fecha: 2026-10-13 · Rama: `feat/suplementos` (sale junto con la etapa 1) · Parte de `docs/superpowers/specs/2026-10-09-suplementos-design.md`.

## Por qué

En la etapa 1 los suplementos solo los ve el socio. El nutricionista del gimnasio necesita ver qué toma cada socio, si lo cumple y **si se pasó de la dosis**, y poder **deshabilitarle la sección** a un socio (por ejemplo, por indicación médica).

## Decisiones

| Tema | Decisión |
|---|---|
| Permisos | Dos nuevos: **Ver suplementos** (`supplements.view`) y **Deshabilitar suplementos** (`supplements.manage`, incluye ver) |
| De fábrica | **Nutricionista** los dos. **Administrador** ninguno. El owner tiene todo; cualquier rol se los puede sumar |
| Dónde | Sección **"Suplementos" en la pestaña Nutrición** de "Administrar nutrición / rutina" (ficha del socio) |
| Qué muestra | Activos (dosis, momento, racha, % 30 días), heatmap combinado de 26 semanas, **días con exceso** de los últimos 30 (lista + aviso arriba), cantidad de archivados. **No** muestra si aceptó el aviso |
| Cafeína | Solo el **total por día** cuando se pasa de 400 mg; nunca cada mate ni la hora |
| Avisos al staff | No (ni push ni indicador en la lista de socios); el aviso "⚠️ N días con exceso" está en la sección |
| Editar por el socio | No: el staff solo mira y deshabilita |
| Deshabilitar | Interruptor + motivo opcional que ve el socio. No borra nada; los recordatorios dejan de salir. Auditoría |
| Push al socio | No |
| Opt-out del socio | No: lo cubre el consentimiento de salud (como peso y lesiones), con aviso y privacidad actualizados |
| Legal | Aviso de suplementos, privacidad e interruptor del owner dicen que el staff con permiso lo ve. Sale junto con la etapa 1: una revisión del abogado y una aceptación |

## Permisos

En `api/permissions.js`, después de `health.view`:

```js
{ code: 'supplements.view', area: 'Salud', name: 'Ver suplementos', help: 'Qué suplementos toma cada socio, si los cumple y los días en que se pasó de la dosis (datos sensibles).', requires: ['members.view', 'health.view'] },
{ code: 'supplements.manage', area: 'Salud', name: 'Deshabilitar suplementos', help: 'Deshabilitarle a un socio la guía y el seguimiento de suplementos (por ejemplo, por indicación médica).', requires: ['supplements.view'] },
```

- `DEFAULT_ROLES`: Nutricionista suma los dos.
- Instancias existentes: `migrateRolePerms('supplements_perms_seeded', { nutrition: add(['supplements.manage']) })` (una sola vez; si el owner se lo saca, no vuelve).
- `ROUTE_PERMISSIONS`: las dos rutas nuevas (abajo).

## Dónde se ve (staff)

`UserDetail` (`frontend/src/views/admin/shared.jsx`) arma las pestañas de "Administrar": hoy `nutrition` con `nutrition.manage`. Pasa a: **`nutrition` si tiene `nutrition.manage` o `supplements.view`**. En la pestaña Nutrición de `AdminManageSheet`:

- Metas y sugerencias (`AdminNutritionCard`): solo con `nutrition.manage` (como hoy).
- **Sección "Suplementos"** (`AdminSupplementsCard`, nueva): con `supplements.view` y el módulo prendido por el owner (`config.supplements_enabled !== false`). Va **debajo** de lo de nutrición.
- Sin consentimiento de salud: la pestaña ya muestra "Sin consentimiento de datos de salud" y nada más (igual que hoy).
- El título del botón y del sheet ("Administrar nutrición / rutina") no cambia.

### La sección

Título "Suplementos" y, si hubo excesos en los últimos 30 días, el aviso **"⚠️ N días con exceso"** a la derecha (N = días distintos).

1. **Heatmap combinado de 26 semanas** (`HeatmapGrid`, el mismo nivel que en "Mis suplementos" del socio).
2. **Activos**: nombre, racha 🔥 (al lado del nombre), dosis (`doseLabel`, con gramos de proteína si corresponde) · momento, y a la derecha el **% de cumplimiento de 30 días** (o "—" sin días). Debajo: "% = cumplimiento de los últimos 30 días · N archivados" (sin archivados, sin esa parte).
3. **Días con exceso (últimos 30)**: una fila por día y suplemento, de más nuevo a más viejo: fecha ("vie 3/10") · nombre · **cantidad** / máximo (de la ficha: `dayMax`). La cafeína es una fila por día con el total si pasó de 400 mg. Sin excesos, la sección no aparece.
4. **Acceso**: "Guía y seguimiento" con el interruptor (solo con `supplements.manage`; sin el permiso, el estado como texto: "Habilitado" / "Deshabilitado · motivo").
5. Sin nada cargado: "No registra suplementos." y el bloque Acceso.

PC/tablet (≥ 768 px): dos columnas (activos y acceso a la izquierda; heatmap y excesos a la derecha).

### Deshabilitar

Apagar el interruptor abre una confirmación (hoja de la app): "¿Deshabilitar suplementos para {nombre}?" + "No va a ver la guía ni el seguimiento, y los recordatorios dejan de salir. No se borra nada: al volver a habilitarlo, todo sigue como estaba." + campo **Motivo (opcional, lo ve el socio)**, máx. 120 caracteres + botón **Deshabilitar** (rojo). Prender el interruptor no pide confirmación. Toast "Suplementos deshabilitados" / "Suplementos habilitados".

## Lo que ve el socio deshabilitado

En Nutrición, la tarjeta "Suplementos" muestra solo: "🔒 Tu gimnasio deshabilitó la sección de suplementos para tu cuenta." + "Motivo: …" (si hay) + "Si tenés dudas, consultá en recepción." Nada abre la guía ni el seguimiento. Los recordatorios no salen. Las tomas encoladas sin conexión se rechazan (quedan como conflicto en la cola, como cualquier escritura no permitida).

## Servidor

### Datos

`supplement_profile` suma columnas (migración con `ALTER TABLE ... ADD COLUMN`):

```sql
staff_disabled INTEGER NOT NULL DEFAULT 0,
staff_reason TEXT,          -- motivo que ve el socio (máx. 120)
staff_by TEXT,              -- quién lo deshabilitó (user id)
staff_at TEXT               -- cuándo
```

`sdb.getProfile` devuelve además `staffDisabled`, `staffReason`, `staffBy`, `staffAt`; `sdb.setStaffAccess(userId, { disabled, reason, by })`.

### Reglas

- `writeGuard` (etapa 1) suma: deshabilitado por el staff → `403 { error: 'supplements_disabled' }`. Como el scheduler y la cola de sync ya pasan por `writeGuard`, los recordatorios dejan de salir y las tomas encoladas se rechazan sin código extra.
- `GET /api/supplements` devuelve `disabled: { reason } | null`.
- `deleteHealthData` ya borra `supplement_profile` (también el estado de deshabilitado). Es correcto: sin datos de salud no queda nada que restringir.

### Rutas (en `api/supplements-routes.js`)

| Ruta | Permiso | Respuesta |
|---|---|---|
| `GET /api/admin/users/:userId/supplements` | `supplements.view` | `{ enabled, access: { disabled, reason, at }, items, logs, caffeine, plan }` |
| `PUT /api/admin/users/:userId/supplements/access` | `supplements.manage` | `{ access }` |

- `logs`: las tomas de items de los últimos 182 días, **sin** hora ni fuente (`{ itemId, date, amount }`).
- `caffeine`: total de cafeína por día de los últimos 30 días, solo los días que pasaron de 400 mg (`[{ date, mg }]`); nunca cada consumo.
- `plan`: `{ week, dayPlan, workoutDates }` del socio, para calcular días de entreno con la misma lógica del cliente.
- `enabled`: el interruptor del owner. Apagado: `enabled: false` y nada más (la sección no se muestra).
- Validación: `enabled` booleano, `reason` string ≤ 120 (se guarda solo al deshabilitar; al habilitar se borra).
- Auditoría: `admin.supplements.disabled` (con el motivo) / `admin.supplements.enabled`, con el socio como `target`. Categoría: **Entrenamiento** (`audit-categories.js`: sumar `supplements` a la regla `admin.(routine|preset|program|injury|nutrition)`), textos en `frontend/src/lib/audit.js` y `locales/es.js`.
- Gate de salud del dispatcher (`server.js`): la regla `/ \/api\/admin\/users\/:userId\/(nutrition|injuries)/` suma `supplements` → `409 no_health_consent`.
- Dispatcher: las dos rutas con `:userId` se agregan a la traducción de path → routeKey, como las de nutrición.
- `api/route-permissions.test.js`: sumar `./supplements-routes.js` a los archivos que escanea.

## Legal

- **Aviso de suplementos** (`AvisoInicial.jsx`): agrega "El staff del gimnasio con permiso (por ejemplo, nutricionistas) puede ver lo que registrás." `SUPP_ACK_VERSION` sube (cliente y servidor) → los socios lo vuelven a aceptar.
- **Privacidad** (`PrivacyNotice.jsx`): "Los suplementos que registres son un dato de salud: los ves vos y el staff con permiso (por ejemplo, nutricionistas), y se borran con "Borrar mis datos de salud"."
- **Interruptor del owner** (`Acceso.jsx`): "…Lo ve cada socio y el staff con permiso de ver suplementos."
- `LEGAL_VERSION` sube. Como la etapa 1 todavía no está en producción, sale todo junto: una revisión del abogado, una aceptación de términos y una del aviso.

## Archivos

- `api/permissions.js`, `api/database.js` (migración de permisos), `api/supplements-db.js` (columnas, `setStaffAccess`), `api/supplements-routes.js` (rutas staff, `writeGuard`, `disabled` en el GET), `api/server.js` (dispatcher y gate de salud), `api/audit-categories.js`, `api/legal.js`, `api/supplements.js` (`SUPP_ACK_VERSION`).
- `frontend/src/components/suplementos/AdminSupplementsCard.jsx` (nuevo), `frontend/src/views/admin/shared.jsx` (pestaña y montaje), `frontend/src/components/suplementos/SuplementosCard.jsx` (estado deshabilitado), `frontend/src/store/useSupplements.js` (`disabled`), `frontend/src/lib/suplementos.js` (`excessDays`), `frontend/src/lib/suplementos-data.js` (`SUPP_ACK_VERSION`), `AvisoInicial.jsx`, `PrivacyNotice.jsx`, `Acceso.jsx`, `frontend/src/lib/audit.js`, `frontend/src/lib/errors.js` (`supplements_disabled`), `locales/es.js`, `index.css`.

## Pruebas

- **Unitarias** (`suplementos.test.js`): `excessDays(items, logs, caffeine, today)` → filas `{ date, name, amount, max, unit }` de 30 días, ordenadas, cafeína incluida; cantidad de días distintos.
- **Permisos** (`permissions.test.js`, `roles-db.test.js`): dependencias de los dos códigos; Nutricionista los tiene de fábrica y por la migración; Administrador no.
- **HTTP** (`supplements-staff.http.test.js`): Nutricionista ve y deshabilita; un rol sin el permiso → 403; sin consentimiento → 409 `no_health_consent`; la respuesta no trae horas ni fuentes de cafeína; deshabilitado → el socio recibe `disabled`, sus escrituras 403 `supplements_disabled`; habilitar borra el motivo; auditoría.
- **Scheduler**: deshabilitado → sin recordatorios.
- **Componentes**: sección con activos, %, excesos y aviso; sin permiso de gestionar → sin interruptor; confirmación con motivo; tarjeta del socio deshabilitada con motivo; pestaña Nutrición visible con solo `supplements.view` (sin metas).
- **Navegador**: ficha del socio (celular y PC), deshabilitar y ver la tarjeta del socio.

## Fuera de alcance

- Lista del gimnasio de "socios que se pasaron esta semana".
- Push o indicadores al staff.
- Que el staff agregue o configure suplementos del socio.
- Que el socio elija no compartir con el staff.
