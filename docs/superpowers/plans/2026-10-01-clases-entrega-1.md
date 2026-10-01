# Clases, entrega 1 (clases, horarios y reservas) — plan de implementación

> Se ejecuta en esta sesión, tarea por tarea, con TDD (node --test en la API, vitest en el
> frontend). Cada tarea termina con sus tests en verde y un commit en `feat/clases`.

**Objetivo:** el gimnasio carga clases con horario semanal y los socios se anotan desde la app,
con cupo, lista de espera, reserva fija y recordatorios; el staff ve el calendario y opera cada
fecha.

**Arquitectura:** la lógica pura (validación, fechas de las clases, superposición, reglas de
reserva, `.ics`) vive en `api/classes.js`, sin base ni HTTP, y se testea sola. `database.js` guarda
las cinco tablas; `server.js` arma las rutas con esas piezas; `scheduler.js` manda los
recordatorios y materializa las reservas fijas. En el frontend, `lib/classes.js` es puro
(etiquetas, estados del botón, textos) y las vistas lo usan.

**Spec:** `docs/superpowers/specs/2026-10-01-clases-design.md` (secciones de la entrega 1).

## Restricciones globales

- Node `node:http` + `node:sqlite`, sin dependencias nuevas. React + Zustand en el frontend.
- Textos en español con `t()`, "lauyim" en minúscula. Fechas y horas del gimnasio con `gymClock`
  (`api/billing.js`), formato `YYYY-MM-DD` / `HH:MM`.
- Cada ruta `/api/admin/classes/*` entra en `ROUTE_PERMISSIONS` (el test de cobertura lo exige).
- Reserva solo quien tiene la cuota al día y la cuenta activa (mismo criterio que
  `MEMBERSHIP_GATED`).
- Archivos con CRLF en Windows: editar sin cambiar los finales de línea.
- Fuera de esta entrega: asistencia, "¿Fuiste?", fatiga, calificación, filtro del historial,
  estadísticas y penalización.

---

### Tarea 1: `api/classes.js` — lógica pura

**Archivos:** crear `api/classes.js`, `api/classes.test.js`.

**Produce:**
- `CLASS_DEFAULTS = { enabled: true, bookAheadDays: 7, cancelHours: 2, waitlistCutoffMin: 60, allowOverlap: false }`
  y `REMINDER_OPTIONS = [300, 120, 60, 30, 15]`.
- `classSettingsOf(stored) → settings` (JSON guardado o nada → con defectos) y
  `validateClassSettings(body) → { value } | { error, field }` (rangos del spec).
- `validateClassType(body, { activeNames }) → { value } | { error, field }`: nombre 1–40 sin
  repetir entre activas (sin distinguir mayúsculas), color `#RRGGBB`, ícono texto, descripción
  ≤ 500, `durationMin` 15–240, `capacity` 1–200, profe (`teacherUserId` o `teacherName` ≤ 40, o
  ninguno), sala ≤ 30, `logMode` `muscles|exercises` con `log`:
  `{ muscles: [slug], intensity: 'low'|'medium'|'high' }` (al menos un músculo de `MUSCLE_SLUGS`)
  o `{ exercises: [{ id, sets 1–10, reps 1–100 }] }` (al menos uno, hasta 30).
- `MUSCLE_SLUGS`: copia de `MUSCLES` de `frontend/src/lib/muscles.js` (la API no importa el
  frontend); un test lee ese archivo y verifica que coincidan.
- `validateSlot(body) → { value: { weekday 0–6, start 'HH:MM' } } | { error, field }`.
- `addMinutes('HH:MM', n) → 'HH:MM'`, `endOf(occ)`.
- `occurrencesBetween({ types, slots, sessions, from, days }) → occ[]` ordenadas por fecha y hora.
  `occ = { key, classId, slotId|null, sessionId|null, date, start, end, movedFrom|null,
  teacherUserId|null, teacherName, room, cancelled, type }`. `key` = `slotId:date` o el id de la
  sesión suelta. Las sesiones guardadas pisan a la calculada del mismo bloque y fecha; las clases
  archivadas no generan fechas nuevas (sus sesiones guardadas sí aparecen).
- `overlapConflicts(candidate, occurrences, { allowOverlap }) → { blocking: [], warnings: [] }`:
  misma fecha, horarios que se pisan, misma sala o alguna sin sala → `blocking` si
  `!allowOverlap`, si no `warnings`; misma profe a la vez → siempre `warnings`. Ignora la propia
  fecha (`candidate.key`) y las canceladas. Cada conflicto: `{ name, date, start, end, room, teacher }`.
- `conflictText(c, weekdayName) → 'Ya hay Pilates el martes de 19:00 a 20:00 en Sala 1, con Ana.'`.
- `bookingState({ occ, nowDate, nowTime, settings }) → 'open' | 'not_yet' | 'started' | 'cancelled'`.
- `cancelKind({ occ, nowDate, nowTime, settings }) → 'cancelled' | 'late_cancel'`.
- `canPromote({ occ, nowDate, nowTime, settings }) → boolean` (faltan más de `waitlistCutoffMin`).
- `remindersDue({ occ, reminders, sent, nowDate, nowTime }) → minutos[]` a mandar ahora (hora
  alcanzada, no mandados, sin los que ya habían pasado al reservar: el scheduler pasa
  `bookedAt`).
- `buildIcs({ occ, gymTz, uid }) → string` (VCALENDAR con VEVENT, `DTSTART;TZID=`, `DTEND`,
  `SUMMARY`, `LOCATION` = sala, `DESCRIPTION` = profe, `VALARM` -PT1H, CRLF).

Tests (`classes.test.js`): defectos y rangos de ajustes; validación de clase en los dos modos
(músculo desconocido, sin ejercicios, profe con cuenta y sin cuenta, nombre repetido); fechas de
una semana con dos bloques, sesión guardada que cambia hora, cancelada, suelta, archivada;
superposición (misma sala, salas distintas, sin sala, `allowOverlap`, misma profe, propia fecha
ignorada); ventana de reserva (antes de abrir, abierta, empezada); cancelación a tiempo y tardía;
corte de lista de espera; recordatorios (hora alcanzada, ya mandado, pasado al reservar); `.ics`
con zona del gym.

Commit: `feat(clases): lógica pura de clases, fechas, superposición y reservas`.

### Tarea 2: permisos

**Archivos:** `api/permissions.js`, `api/permissions.test.js`, `api/database.js`,
`frontend/src/lib/permissions.js` (+ test).

- Catálogo: `classes.attendance` ("Tomar lista", área Clases) y `classes.manage` ("Clases y
  horarios", `requires: ['classes.attendance']`), después de `training.manage`.
- `DEFAULT_ROLES`: Administrador ya los toma (todo menos `roles.assign`); `coach` suma los dos.
- `ROUTE_PERMISSIONS`: las rutas de la tarea 4.
- `database.js`, `migrateRoles`: marca `classes_perms_seeded` → suma los dos a `admin` y a
  `coach` si existe.
- Frontend: `ADMIN_SECTIONS` suma `{ path: 'clases', label: 'Clases', perm: 'classes.attendance', flag: 'classesEnabled' }`
  después de Rutinas.

Tests: dependencias, roles de fábrica, migración única (borrar el permiso de `coach` y reiniciar
no lo vuelve a poner), sección visible según permiso y flag.

Commit: `feat(clases): permisos de clases y su migración`.

### Tarea 3: base de datos

**Archivos:** `api/database.js`, `api/classes-db.test.js`.

Tablas del spec (`class_types`, `class_slots`, `class_sessions`, `class_bookings`,
`class_recurring`) en `migrateClasses(db)`, llamada desde `initDatabase`.

**Produce** (filas en camelCase, JSON ya parseado):
- Clases: `getClassTypes({ includeArchived })`, `getClassType(id)`, `saveClassType(value) → type`,
  `archiveClassType(id)`.
- Bloques: `getClassSlots()`, `saveClassSlot({ id?, classId, weekday, start }) → slot`,
  `deleteClassSlot(id)`.
- Sesiones: `getClassSessions({ from, to })`, `getClassSession(id)`,
  `ensureClassSession({ classId, slotId, date, start }) → session` (crea si no existe; UNIQUE
  slot+fecha), `updateClassSession(id, patch)`.
- Reservas: `getBookingsForSessions(ids)`, `getUserBookings(userId, { from })`,
  `getBooking(id)`, `createBooking({ sessionId, userId, status, waitlistPos, reminders, recurringId, addedBy })`,
  `updateBooking(id, patch)`, `countBooked(sessionId)`, `firstInWaitlist(sessionId)`,
  `nextWaitlistPos(sessionId)`.
- Fijas: `getRecurring({ slotId?, userId? })`, `addRecurring(slotId, userId)`,
  `removeRecurring(slotId, userId)`.
- `bookOrWaitlist({ sessionId, userId, capacity, reminders, recurringId, addedBy, force })` en
  una transacción: si ya tiene reserva activa la devuelve; con lugar (o `force`) `booked`, si no
  `waitlist` con la posición siguiente.
- `cancelAndPromote({ bookingId, kind, promote }) → { booking, promoted|null }` en una
  transacción.

Tests: crear y leer cada cosa, archivar, UNIQUE de sesión, `bookOrWaitlist` con cupo lleno y
`force`, reserva repetida idempotente, `cancelAndPromote` con y sin `promote`.

Commit: `feat(clases): tablas y acceso a datos de clases`.

### Tarea 4: API del staff y ajustes del owner

**Archivos:** `api/server.js`, `api/classes-admin.http.test.js`.

Rutas (permiso entre paréntesis):
- `GET /api/admin/classes/types` (`classes.attendance`), `POST …/types/save`,
  `POST …/types/archive` (`classes.manage`). Guardar con `teacherUserId` exige un usuario con rol.
- `POST /api/admin/classes/slots/save`, `POST …/slots/delete` (`classes.manage`). Guardar corre
  `overlapConflicts` contra las fechas de las próximas 8 semanas: con `blocking`, 409
  `class_overlap` + `conflicts`; si no, 200 + `warnings`. Borrar cancela (con aviso) las fechas
  futuras de ese bloque con reservas.
- `POST /api/admin/classes/overlap-check` (`classes.manage`) → `{ blocking, warnings }` sin
  guardar.
- `GET /api/admin/classes/calendar?from&days` (`classes.attendance`): `occurrencesBetween` con
  `booked`, `waitlist` por fecha; sin `classes.manage`, solo las fechas cuya profe es la persona.
  Además `summary: { classes, occupancy, lateCancels, waitlist }` de la semana.
- `POST /api/admin/classes/sessions/change` (`classes.manage`): `{ classId, slotId?, date, start?, teacherUserId?, teacherName?, cancelled? }`.
  Sin `slotId` crea una clase suelta. Cambio de hora valida superposición. Avisa a los anotados y
  a la lista de espera (`pushes` de la tarea 6). Cancelar pasa las reservas a `cancelled`.
- `GET /api/admin/classes/sessions/:id` (`classes.attendance`, solo sus clases sin
  `classes.manage`): anotados y lista de espera con nombre.
- `POST /api/admin/classes/sessions/:id/add` (`classes.attendance`) `{ userId }`: `force` sobre
  el cupo, `addedBy`.
- `GET/PUT /api/owner/classes/settings` (owner).
- `/api/config` suma `classes_enabled`.
- Auditoría: `classes.type.save`, `classes.type.archive`, `classes.slot.save`,
  `classes.slot.delete`, `classes.session.change`, `classes.booking.add`,
  `owner.classes.settings`.

Tests: owner y Administrador crean clase y bloques; recepción (sin permiso) 403; superposición
bloquea y con `allowOverlap` avisa; misma profe avisa; profe solo con `classes.attendance` ve solo
sus fechas y no edita; cambio de hora y cancelación; anotar a mano sobre el cupo; ajustes solo
owner; cobertura de `ROUTE_PERMISSIONS` sigue en verde.

Commit: `feat(clases): API del staff y ajustes de clases`.

### Tarea 5: API del socio

**Archivos:** `api/server.js`, `api/classes-member.http.test.js`.

Rutas (sesión, cuenta activa, módulo prendido; las de reservar en `MEMBERSHIP_GATED`):
- `GET /api/classes?from&days`: fechas de la ventana con `{ booked, capacity, myBooking:
  { id, status, waitlistPos, reminders } | null, state: bookingState, recurring: bool }`. Sin
  nombres de otros socios.
- `POST /api/classes/book` `{ classId, slotId?, date, sessionId? }`: valida `bookingState ===
  'open'`, `ensureClassSession`, `bookOrWaitlist` con los recordatorios de entrada del socio
  (`state.classReminders`, defecto `[60]`).
- `POST /api/classes/cancel` `{ bookingId }`: solo la propia; `cancelKind`;
  `cancelAndPromote` con `promote = canPromote`; el promovido recibe aviso.
- `PUT /api/classes/bookings/:id/reminders` `{ reminders }` (solo valores de
  `REMINDER_OPTIONS`).
- `POST /api/classes/recurring` / `POST /api/classes/recurring/delete` `{ slotId }`: alta reserva
  enseguida las fechas ya dentro de la ventana.
- `GET /api/classes/bookings/:id/ics`: `text/calendar`, `Content-Disposition: attachment`.

Tests: reservar con lugar y lleno (lista), cuota vencida 403, fecha fuera de ventana 409,
cancelar a tiempo y tarde, cancelar sube al primero (y no después del corte), recordatorios
válidos e inválidos, fija reserva las fechas abiertas, `.ics` del propio y 404 de otro, la
respuesta no trae nombres.

Commit: `feat(clases): reservas del socio, lista de espera y reserva fija`.

### Tarea 6: avisos y scheduler

**Archivos:** `api/push-messages.js`, `api/scheduler.js`, `api/push-messages.test.js`,
`api/scheduler.test.js` (o el test existente del scheduler).

- `classReminderPush({ name, start, movedFrom, teacher, room, minutes, isToday })` →
  `{ title: 'Spinning · 19:00', body: 'Hoy con Caro, en Sala 2. Empieza en 1 hora.', url: '/#/plan/clases?d=YYYY-MM-DD' }`
  (sin sala, sin profe, "mañana", "Hoy cambió a las 20:00.", minutos → "en 15 minutos" / "en 2 horas").
- `classChangePush(kind, …)` para `moved` ("Spinning de hoy pasa a las 20:00"), `teacher`
  ("Hoy Spinning lo da Juli"), `cancelled` ("Spinning de hoy se suspende"), `promoted`
  ("Entraste a Spinning de hoy 19:00: se liberó un lugar"), `slot_removed`.
- `runSchedulerTick`: (a) recordatorios: reservas `booked` de hoy y mañana con `remindersDue`,
  marca `reminders_sent` antes de mandar (como `billingPushInFlight`); (b) reservas fijas: para
  cada `class_recurring` y cada fecha del bloque que entró en la ventana, `bookOrWaitlist` (una
  vez por fecha: si ya hay reserva, nada); si quedó en lista, aviso.

Tests: textos (todas las variantes); tick manda el recordatorio a la hora justa una sola vez, no
para canceladas ni lista de espera; tick reserva las fijas una sola vez por fecha.

Commit: `feat(clases): recordatorios de clase y reservas fijas automáticas`.

### Tarea 7: frontend, base

**Archivos:** crear `frontend/src/lib/classes.js` (+ `classes.test.js`); `store/useStore.js`
(`classReminders` en el estado por defecto `[60]`).

**Produce:**
- `REMINDER_OPTIONS`, `reminderLabel(min) → '5 h' | '1 h' | '30 min'`.
- `buttonState({ state, myBooking, booked, capacity }) → { key, label, variant, disabled }` con
  las claves `book | waitlist | booked | waiting | cancelled | full | started`.
- `capacityText(booked, capacity) → '8/12'`, `timeRange(occ) → '19:00–20:00'`,
  `dayChips(today, days) → [{ date, label: 'Hoy' | 'Mañana' | 'Mié 3' }]`.
- `conflictMessages({ blocking, warnings }) → string[]`.
- `classesApi`: funciones que llaman a las rutas de las tareas 4 y 5 con `api()`.

Tests: cada estado del botón, etiquetas de días, rangos de hora, textos de recordatorio.

Commit: `feat(clases): lógica de clases del frontend`.

### Tarea 8: frontend, socio

**Archivos:** `views/Plan.jsx`, crear `views/Clases.jsx` (+ test), `components/ClassSheet.jsx`,
`components/ClassRemindersSheet.jsx`, `views/Home.jsx`, `views/Settings.jsx`, `App.jsx` (ruta
`/plan/clases`), `index.css`.

- Plan: tercera pestaña "Clases" (`/plan/clases`) si `classes_enabled` y hay clases; lee `?d=`.
- `Clases.jsx`: chips de días, lista del día (color, hora, nombre, profe, sala, `8/12`, botón
  según `buttonState`), vacío "No hay clases este día".
- `ClassSheet`: descripción, qué se trabaja (`BodyMap` con los músculos y la intensidad, o la
  lista de ejercicios), Anotarme / Cancelar (confirmación si es tardía), "Todas las semanas",
  campanita, "Agregar a mi calendario" (descarga del `.ics`).
- `ClassRemindersSheet`: título "Recordatorios para esta clase", chips de `REMINDER_OPTIONS`
  (varios), "Sin recordatorio", enlace "Cambiar los de entrada en Ajustes".
- Inicio: tarjeta con la próxima reserva o "Ver clases".
- Ajustes → Notificaciones: "Recordatorios de clases" (los de entrada).

Tests: pestaña visible solo con módulo y clases; estados del botón en la lista; reservar y
cancelar llaman a la API; hoja de recordatorios guarda la selección; tarjeta de Inicio en sus dos
variantes.

Commit: `feat(clases): clases para el socio en Plan, Inicio y Ajustes`.

### Tarea 9: frontend, staff

**Archivos:** crear `views/admin/Clases.jsx` (+ test), `views/admin/clases/ClassEditor.jsx`,
`views/admin/clases/SessionSheet.jsx`, `views/admin/clases/ClassSettings.jsx`;
`AdminLayout.jsx` (ruta `clases`, flag `classesEnabled`), `index.css`.

- Calendario: en PC (`useDesktop`) semana en columnas con horas en filas y bloques del color de la
  clase; en celular un día por vez con flechas. Arriba los cuatro números de `summary`. Flechas
  de semana y "Hoy".
- Botones (con `classes.manage`): "Nueva clase", "Clase suelta", "Clases" (lista para editar o
  archivar); owner: "Ajustes".
- `SessionSheet`: anotados, lista de espera, "Anotar a mano" (buscador de socios activos), y con
  `classes.manage`: cambiar horario este día, cambiar profe este día, cancelar este día
  (confirmación).
- `ClassEditor`: datos, profe (usuarios con rol u "Otra persona"), segmentado "Músculos e
  intensidad" / "Ejercicios" (`BodyMap` con `onMuscle`/`selected` + intensidad, o
  `exercisePicker` + series y repeticiones), filas de horario con "Agregar día"; al cambiar día u
  hora llama a `overlap-check` y muestra los avisos debajo de la fila; Guardar deshabilitado con
  `blocking`.
- `ClassSettings` (owner): módulo prendido, los tres números, "Permitir clases en el mismo
  horario" con su explicación.

Tests: calendario semana y día, bloques según permisos (profe solo ve sus clases, sin botones de
edición), editor en los dos modos, aviso de superposición deshabilita Guardar, sesión: anotar a
mano y cancelar este día, ajustes solo owner.

Commit: `feat(clases): calendario, editor y ajustes de clases en el panel`.

### Tarea 10: verificación

Suites completas (API y frontend), build, `node scripts/check-locales.mjs`. En navegador, en
celular y PC: owner crea Spinning (músculos) y Funcional (ejercicios) con dos días distintos;
superposición bloqueada y permitida; socio reserva, lista de espera, cancela tarde, reserva fija,
recordatorios, `.ics`; profe solo ve sus clases; cambio de horario de un día con aviso.
Pasos para probar en dev.
