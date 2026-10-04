# Clases, entrega 4, parte B: plan

Spec: `docs/superpowers/specs/2026-10-02-clases-entrega-4-design.md`, sección Parte B.
Rama: `feat/clases-4`. En cada tarea se escriben los tests primero.

## Tarea 1: cierres (API)

- **Base de datos** (`classes-db.js`):
  - Tabla `class_closures (id, from_date, to_date, reason, created_by, created_at)`.
  - Funciones `getClosures({ from, to })` (las que tocan el rango), `getClosure(id)`, `addClosure` y
    `deleteClosure`.
- **Fechas** (`classes.js`):
  - `occurrencesBetween` recibe `closures`. Una fecha dentro de un cierre queda
    `cancelled: true, closed: motivo o 'Cerrado'`, aunque no tenga sesión guardada.
  - `validateClosure({ from, to, reason }, { today, existing })`:
    - de 1 a 31 días;
    - desde hoy en adelante;
    - sin superponerse con otro cierre;
    - motivo de hasta 40 letras.
- **Rutas** (`classes-routes.js`):
  - `loadOccurrences` pasa los cierres del rango.
  - `GET /api/admin/classes/closures`: los cierres de hoy en adelante.
  - `GET /api/admin/classes/closures/preview?from&to`: devuelve `{ classes, people }`.
  - `POST /api/admin/classes/closures` crea el cierre:
    - cancela las reservas activas de las fechas afectadas, sin promover a nadie;
    - no suspende las sesiones: así, al reabrir, las fechas vuelven;
    - manda un solo aviso por persona;
    - queda en la auditoría.
  - `POST /api/admin/classes/closures/delete { id }` reabre.
  - `GET /api/admin/classes/calendar` y `GET /api/classes` suman `closures` del rango.
- **Aviso** (`push-messages.js`): `closurePush({ from, to, today, reason, items })`.
  - Un día: "El lunes 12 no hay clases" o "Hoy/Mañana no hay clases". Texto: "Feriado. Se
    suspendieron Spinning 19:00 y GAP 20:30; tu lugar quedó liberado."
  - Varios días: "Sin clases del 2/1 al 15/1". Texto: "Vacaciones. Se suspendieron tus 6 reservas."
- **Permisos** (`ROUTE_PERMISSIONS`):
  - Ver cierres: `['classes.attendance', 'classes.view_all']`.
  - Vista previa, crear y reabrir: `classes.manage`.
- **Tests:**
  - `classes.test.js`: validación y fechas cerradas.
  - `push-messages.test.js`.
  - `classes-admin.http.test.js`:
    - crear, ver la vista previa y reabrir;
    - un aviso por persona;
    - no se superpone con otro cierre;
    - permisos.
  - `classes-member.http.test.js`: una fecha cerrada no se reserva.
  - `scheduler-classes.test.js`: "Fija" saltea la fecha cerrada.

## Tarea 2: ficha del socio (API)

- **Base de datos:**
  - `class_prefs.penalty_reset_at TEXT`, con su `ALTER`.
  - Funciones `getPenaltyReset` y `setPenaltyReset`.
- **Penalización:** `penaltyNow` ignora las ausencias de la fecha del reset o anteriores.
- **`GET /api/admin/classes/member?userId=`** devuelve:
  - `upcoming`: las reservas activas desde hoy;
  - `fixed`: los días fijos;
  - `month`: presentes, ausentes, tardías y el % de los últimos 30 días;
  - `penalty`;
  - `canCancel` (`classes.book_members`) y `canReset` (`classes.manage`).
- **`POST /api/admin/classes/member/cancel { bookingId }`:**
  - Es una cancelación a tiempo: promueve a la lista de espera.
  - Avisa al socio ("staff_cancelled") y a quien entra ("promoted").
  - Queda en la auditoría.
- **`POST /api/admin/classes/member/penalty-reset { userId }`:**
  - Guarda la fecha de hoy.
  - Le avisa al socio: "Ya podés volver a reservar clases".
  - Queda en la auditoría.
- **Avisos** (`push-messages.js`): los textos "staff_cancelled" y "penalty_reset".
- **Tests:** HTTP para los datos, cancelar (con promoción), levantar la penalización y los
  permisos.

## Tarea 3: cierres (frontend)

- `lib/classes.js`: `closuresApi` dentro de `classesApi`, y `closureLabel(closure)`, que da
  "Lun 12/10" o "2/1 al 15/1".
- **Admin → Clases:**
  - Botón "Cerrar el gimnasio" (con `canManage`) que abre `closureSheet`:
    - selector Un día / Varios días;
    - las fechas;
    - chips de motivo (Feriado, Vacaciones, Mantenimiento) y texto libre;
    - vista previa en vivo ("Se suspenden N clases y le avisamos a N personas");
    - botón "Cerrar y avisar" en rojo.
  - Lista de próximos cierres debajo de los números, cada uno con "Reabrir" (que pide
    confirmación).
  - Los días cerrados se marcan:
    - en el encabezado de la semana (PC), con un candado;
    - en el día del celular, con una franja "Cerrado · Feriado";
    - las clases de ese día aparecen tachadas, como las suspendidas.
- **Socio (Plan → Clases):**
  - El chip del día cerrado lleva un candado.
  - Ese día, el aviso "El gimnasio está cerrado · Feriado" en lugar de la lista.
- **Estadísticas:** la ocupación `null` (sin cupo) se muestra como "sin cupo".
- **Tests:** hoja de cierre (vista previa, crear), lista con Reabrir, el día cerrado del socio.

## Tarea 4: ficha del socio (frontend)

- **`ClassesMemberCard`** en `views/admin/members/ClassesCard.jsx`.
  - **Dónde va:** en `UserDetail`, entre la cuota y el historial. Se muestra con `classes.view_all`
    o `book_members` y el módulo disponible.
  - **Contenido:**
    - cuatro números del último mes;
    - el aviso naranja de penalización, con "Levantar penalización" (pide confirmación);
    - las próximas reservas (hasta 5, con "Ver todas") y "Cancelar" (pide confirmación);
    - los fijos como chips;
    - sin datos: "Todavía no fue a ninguna clase."
- **Tests** de la tarjeta.

## Cierre

- Suites completas, build y `check-locales`.
- En el navegador, en celular y PC: crear y reabrir un cierre, el día cerrado del socio, y la
  tarjeta de la ficha con cancelar y levantar la penalización.
- Commit por tarea y push.
