# Módulo de clases — diseño

Fecha: 2026-10-01. Estado: aprobado en chat, pendiente de revisión del spec.

## Objetivo

Que el gimnasio publique sus clases grupales (spinning, GAP, pilates, yoga…) con un horario
semanal, que los socios se anoten desde la app con cupo y lista de espera, reciban recordatorios
y, después de la clase, la sumen a su historial y a la fatiga. El staff las arma, toma lista y ve
cómo se usan.

Referencias revisadas: Mindbody, Glofox, Wodify, Zen Planner, Fitco y AgendaPro (lista de espera
que se llena sola, ventanas de reserva y cancelación, penalización por ausencias sin multa, alta
manual del staff, reservas recurrentes, estadísticas de ocupación).

## Entregas

1. **Clases, horarios y reservas:** clases, horario semanal, cambios de una fecha, superposición,
   reservas, lista de espera, reserva fija semanal, recordatorios, calendario del staff, ajustes,
   "Agregar a mi calendario" (.ics).
2. **Después de la clase:** asistencia (lista de la profe, ingreso físico, respuesta del socio),
   "¿Fuiste?", entrenamiento de tipo Clase en el historial y en la fatiga, calificación 1 a 5,
   filtro Todo / Entrenamientos / Clases en el historial.
3. **Números:** estadísticas de clases y penalización por ausencias.

Cada entrega se prueba en dev antes de la siguiente. Cada una tiene su propio plan.

## Decisiones tomadas

- Datos de una clase: nombre, color, ícono, descripción, duración, cupo, profe y sala opcional.
  Sin nivel.
- Profe: una persona con cuenta (elegida entre los usuarios con rol) o solo un nombre (profe
  externa sin cuenta). Con cuenta, ve sus clases en el panel; con nombre, solo aparece en la clase.
- Cómo se registra la clase, a elección de quien la crea: **músculos e intensidad** (opción de
  entrada) o **ejercicios** con series y repeticiones. Al socio le aparece lo que cargó la profe
  como un entrenamiento hecho.
- Horario semanal con un bloque por día, cada uno con su propia hora.
- Cambios de una sola fecha: horario, profe o cancelación; y clases sueltas.
- Interruptor del owner "Permitir clases en el mismo horario", apagado de entrada.
- Socio: pestaña "Clases" en Plan y tarjeta en Inicio.
- Recordatorios por reserva, configurables: 5 h, 2 h, 1 h, 30 min, 15 min antes.
- Se implementan "Agregar a mi calendario" y la calificación de 1 a 5. Elegir lugar (número de
  bici) y racha de clases quedan fuera.
- Todo lo demás según las recomendaciones aceptadas (ver "Reglas").

## Datos

Todas las fechas y horas son del gimnasio (`gymClock`, zona horaria de la configuración de
cuotas), en formato `YYYY-MM-DD` y `HH:MM`.

```sql
-- Una clase del gimnasio.
CREATE TABLE class_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                  -- 1 a 40 caracteres, sin repetir entre las activas
  color TEXT NOT NULL,                 -- #RRGGBB
  icon TEXT NOT NULL DEFAULT 'dumbbell',  -- de components/Icon.jsx
  description TEXT NOT NULL DEFAULT '',   -- hasta 500
  duration_min INTEGER NOT NULL,       -- 15 a 240
  capacity INTEGER NOT NULL,           -- 1 a 200
  teacher_user_id TEXT,                -- profe con cuenta, o NULL
  teacher_name TEXT NOT NULL DEFAULT '',  -- profe sin cuenta (si no hay teacher_user_id)
  room TEXT NOT NULL DEFAULT '',       -- sala, hasta 30; vacía = sin sala
  log_mode TEXT NOT NULL DEFAULT 'muscles',  -- 'muscles' | 'exercises'
  log TEXT NOT NULL DEFAULT '{}',      -- JSON: { muscles: [slug], intensity: 'low'|'medium'|'high' }
                                       --    o { exercises: [{ id, sets, reps }] }
  archived INTEGER NOT NULL DEFAULT 0, -- archivada: sin horario ni reservas nuevas; el historial queda
  created_at TEXT NOT NULL
);

-- Horario semanal: un bloque por día y hora.
CREATE TABLE class_slots (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES class_types(id),
  weekday INTEGER NOT NULL,            -- 0 domingo … 6 sábado
  start TEXT NOT NULL,                 -- HH:MM
  created_at TEXT NOT NULL
);

-- Una fecha concreta. Se crea al reservar o al cambiar algo de esa fecha; las demás fechas del
-- horario se calculan al vuelo a partir de class_slots.
CREATE TABLE class_sessions (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES class_types(id),
  slot_id TEXT,                        -- NULL = clase suelta
  date TEXT NOT NULL,                  -- YYYY-MM-DD
  start TEXT NOT NULL,                 -- HH:MM (la del bloque, o la del cambio de ese día)
  moved_from TEXT,                     -- HH:MM original si se cambió el horario ese día
  teacher_user_id TEXT,                -- cambio de profe de ese día (NULL = la de la clase)
  teacher_name TEXT,
  cancelled INTEGER NOT NULL DEFAULT 0,
  attendance_taken INTEGER NOT NULL DEFAULT 0,   -- entrega 2
  UNIQUE (slot_id, date)
);

-- Reserva de un socio para una fecha.
CREATE TABLE class_bookings (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES class_sessions(id),
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,                -- booked | waitlist | cancelled | late_cancel | attended | absent
  waitlist_pos INTEGER,                -- orden en la lista de espera
  reminders TEXT NOT NULL DEFAULT '[60]',  -- minutos antes, de [300,120,60,30,15]
  reminders_sent TEXT NOT NULL DEFAULT '[]',
  recurring_id TEXT,                   -- si nació de una reserva fija
  added_by TEXT,                       -- staff que la anotó a mano
  attendance_source TEXT,              -- entrega 2: teacher | checkin | member | timeout
  rating INTEGER,                      -- entrega 2: 1 a 5
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (session_id, user_id)
);

-- Reserva fija semanal de un socio en un bloque.
CREATE TABLE class_recurring (
  id TEXT PRIMARY KEY,
  slot_id TEXT NOT NULL REFERENCES class_slots(id),
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (slot_id, user_id)
);
```

Ajustes en `admin_settings`, clave `classes` (los edita el owner):

| Campo | Defecto | Qué es |
|---|---|---|
| `enabled` | `true` | Módulo prendido. Apagado: sin pestaña, tarjeta ni sección. |
| `bookAheadDays` | 7 | Desde cuántos días antes se puede reservar (1 a 30). |
| `cancelHours` | 2 | Hasta cuántas horas antes se cancela sin que cuente como tardía (0 a 48). |
| `waitlistCutoffMin` | 60 | Hasta cuántos minutos antes la lista de espera sube gente (0 a 720). |
| `allowOverlap` | `false` | Permitir dos clases en el mismo horario y sala. |
| `penalty` | `{ on: false, absences: 3, windowDays: 30, blockDays: 7 }` | Entrega 3. |

Preferencia del socio (en su estado sincronizado): `classReminders`, los recordatorios de
entrada para reservas nuevas. Defecto `[60]`.

## Permisos

Cinco permisos en `api/permissions.js`, área "Clases" (revisado tras la prueba en dev):

- `classes.view_all` — "Ver todas las clases": el calendario completo con los anotados, sin cambiar nada.
- `classes.book_members` — "Anotar socios a mano" en cualquier clase (requiere ver socios y ver todas).
- `classes.attendance` — "Tomar lista en sus clases": ver los anotados de las que da y anotar a mano en ellas.
- `classes.own` — "Crear y editar sus clases": la profe es siempre esa persona; cambia horario, fechas y suspende las suyas; no elige ni cambia profes (requiere tomar lista).
- `classes.manage` — "Todas las clases y horarios": cualquier clase, elige la profe (requiere los otros cuatro).

Roles de fábrica: Administrador todos; Profesor/a `classes.own`; Recepción `classes.book_members`.
Migraciones únicas en `admin_settings`: `classes_perms_seeded` y `classes_perms_v2` (Profesor/a con
la primera versión, que tenía todas las clases, pasa a las suyas). Una ruta `/api/admin` puede
pedir cualquiera de varios permisos (lista en `ROUTE_PERMISSIONS`).

Una fecha suspendida se puede quitar de la vista (`class_sessions.hidden`): deja de aparecer para
el staff y para los socios.

Los ajustes de clases (`/api/owner/classes/settings`) son solo del owner.

## Reglas

### Fechas de una clase

Las fechas se calculan de los bloques (`class_slots`) más las sesiones guardadas: una sesión
guardada pisa a la calculada del mismo bloque y fecha. Una clase suelta es una sesión sin bloque.
Borrar un bloque no toca las sesiones con reservas ya guardadas; las futuras sin reservas dejan
de aparecer y las que tienen reservas se cancelan con aviso.

### Superposición

Dos fechas se superponen si comparten la fecha, sus horarios se pisan
(`inicio1 < fin2 && inicio2 < fin1`) y están en la misma sala o alguna no tiene sala. Se revisa
al guardar un bloque (contra los demás bloques y las clases sueltas), un cambio de horario de una
fecha y una clase suelta.

- `allowOverlap` apagado: no se guarda. Responde 409 `class_overlap` con el detalle de la clase
  con la que choca.
- `allowOverlap` encendido: se guarda y la respuesta trae `warnings` con el mismo detalle.
- La misma profe (misma cuenta, o mismo nombre sin cuenta) en dos clases a la vez: siempre
  `warnings`, sin bloquear.

El editor muestra el aviso debajo del horario: "Ya hay Pilates el martes de 19:00 a 20:00 en
Sala 1, con Ana." Con el interruptor apagado, el botón Guardar queda deshabilitado mientras
choque (el editor pregunta a la API al cambiar día u hora).

### Reservas

- Reserva quien tiene la cuota al día (misma regla que el resto de la app) y la cuenta activa.
- Abre `bookAheadDays` días antes y cierra al empezar la clase. Una fecha cancelada no se reserva.
- Con lugar: `booked`. Sin lugar: `waitlist`, al final de la lista.
- El staff con `classes.attendance` anota a mano aunque esté llena (`added_by`).
- Cancelar hasta `cancelHours` antes: `cancelled`. Después: `late_cancel` (cuenta como ausencia
  en la entrega 3). El lugar se libera igual.
- Al liberarse un lugar, si faltan más de `waitlistCutoffMin`, el primero de la lista pasa a
  `booked` y recibe un aviso. Después de ese corte la lista no sube a nadie.
- Reserva fija: "Todas las semanas" en un bloque crea `class_recurring`. Cada fecha se reserva
  sola cuando entra en la ventana (`bookAheadDays`), con las mismas reglas (si está llena, va a la
  lista de espera y se avisa). El socio cancela una fecha suelta sin tocar el fijo, o da de baja
  el fijo (no cancela las fechas ya reservadas; las cancela una por una si quiere).
- El socio ve solo cuántos van ("8/12") y su lugar en la lista de espera, nunca quiénes.

### Cambios de una fecha

- Cambiar horario: guarda `start` y `moved_from`. Las reservas siguen; cada anotado (y la lista de
  espera) recibe "Spinning de hoy pasa a las 20:00". Los recordatorios se recalculan con la hora
  nueva.
- Cambiar profe: aviso "Hoy Spinning lo da Juli".
- Cancelar: todas las reservas pasan a `cancelled` (sin contar como tardías) y aviso "Spinning de
  hoy se suspende".
- Clase suelta: aparece como una fecha más, reservable.

### Recordatorios

- Cada reserva guarda sus recordatorios (minutos antes). Al reservar se copian los de entrada del
  socio (`classReminders`).
- Hoja "Recordatorios para esta clase": chips 5 h, 2 h, 1 h, 30 min, 15 min (varios a la vez) y
  "Sin recordatorio". Abajo, "Cambiar los de entrada en Ajustes".
- Los manda `api/scheduler.js` en su tick de cada minuto: por cada reserva `booked` de hoy y
  mañana, el recordatorio cuya hora ya llegó y no está en `reminders_sent`. Un recordatorio cuya
  hora ya pasó al reservar no se manda.
- Texto (`api/push-messages.js`):
  - título: "Spinning · 19:00";
  - cuerpo: "Hoy con Caro, en Sala 2. Empieza en 1 hora." (sin sala: sin "en Sala 2"; sin profe:
    sin "con Caro"; si cambió el horario ese día: "Hoy cambió a las 20:00. Empieza en 1 hora.");
  - al tocarlo abre Plan → Clases en esa fecha.

### Agregar a mi calendario

`GET /api/classes/bookings/:id/ics` devuelve un evento iCalendar (nombre de la clase, inicio y fin
con la zona del gym, sala y profe en la descripción, alarma de 1 hora). Botón en la reserva.

## API

Socio (sesión activa, módulo prendido):

- `GET /api/classes?from=YYYY-MM-DD&days=7` — fechas de clases del rango (calculadas + guardadas)
  con cupo usado, estado de mi reserva y si puedo reservar.
- `POST /api/classes/book` `{ classId, slotId?, date, start? }` — crea la sesión si hace falta y
  reserva (o lista de espera).
- `POST /api/classes/cancel` `{ bookingId }`.
- `PUT /api/classes/bookings/:id/reminders` `{ reminders: [minutos] }`.
- `POST /api/classes/recurring` `{ slotId }` y `POST /api/classes/recurring/delete` `{ slotId }`.
- `GET /api/classes/bookings/:id/ics`.

Staff (`/api/admin/classes/*`, en `ROUTE_PERMISSIONS`):

- `GET types`, `POST types/save`, `POST types/archive` — `classes.manage`.
- `POST slots/save`, `POST slots/delete` — `classes.manage`. Validan superposición.
- `GET calendar?from&days` — `classes.attendance` (solo sus clases sin `classes.manage`).
- `POST sessions/change` `{ classId, slotId?, date, start?, teacher?, cancelled? }` — cambios de
  una fecha y clase suelta; `classes.manage`.
- `GET sessions/:id` — anotados y lista de espera; `classes.attendance`.
- `POST sessions/:id/add` `{ userId }` — anotar a mano; `classes.attendance`.
- `POST overlap-check` `{ … }` — lo que usa el editor para avisar antes de guardar;
  `classes.manage`.

Owner: `GET/PUT /api/owner/classes/settings`.

Todas las escrituras se auditan (`classes.*`).

## Pantallas

### Socio — Plan → Clases

- Tercera pestaña de Plan: Rutina · Ejercicios · Clases (ruta `/plan/clases`). No aparece con el
  módulo apagado o sin clases cargadas.
- Arriba, los próximos `bookAheadDays` días como chips (hoy marcado). Abajo, las clases del día:
  color, hora, nombre, profe, sala y "8/12". Botón según el estado: Anotarme · Lista de espera ·
  Anotado ✓ · En espera (n.º 2) · Cancelada · Llena (sin lista).
- Tocar una clase abre su hoja: descripción, qué se trabaja (mapa de músculos o lista de
  ejercicios), Anotarme / Cancelar, "Todas las semanas", campanita de recordatorios y "Agregar a
  mi calendario".
- Cancelar después del límite pide confirmación: "Faltan menos de 2 horas: cuenta como
  cancelación tardía."

### Socio — Inicio

Tarjeta "Clases": la próxima reservada ("Spinning · hoy 19:00 · con Caro") con acceso a la hoja;
sin reservas, "Ver clases". No aparece con el módulo apagado o sin clases.

### Socio — Ajustes

En Notificaciones: "Recordatorios de clases" con los mismos chips (los de entrada).

### Staff — Admin → Clases

- Sección visible con `classes.attendance` o `classes.manage`.
- PC: semana en columnas (lunes a domingo), horas en filas, bloques del color de la clase con
  hora, nombre y "8/12"; flechas de semana y "Hoy". Celular: un día por vez con flechas, lista de
  bloques.
- Arriba, cuatro números de la semana visible: clases, ocupación promedio, ausencias (entrega 3;
  hasta entonces, cancelaciones tardías), personas en lista de espera.
- Tocar un bloque abre la fecha: anotados, lista de espera, "Anotar a mano", y con
  `classes.manage` "Cambiar horario este día", "Cambiar profe este día", "Cancelar este día".
- Botones arriba (con `classes.manage`): "Nueva clase", "Clase suelta", "Clases" (lista para
  editar o archivar). El owner ve además "Ajustes".

### Staff — editor de clase

Hoja (celular) o ventana (PC):
- Nombre, color, ícono, descripción, duración, cupo, sala.
- Profe: lista de usuarios con rol, o "Otra persona" con un campo de nombre.
- "¿Cómo se registra la clase?": segmentado **Músculos e intensidad** / **Ejercicios**.
  - Músculos: el mapa del cuerpo de los ejercicios propios (tocar para marcar) e intensidad
    baja / media / alta.
  - Ejercicios: el selector del editor de rutinas, con series y repeticiones.
- Horario: una fila por bloque (día + hora) y "Agregar día". El aviso de superposición aparece
  debajo de la fila que choca.

### Owner — ajustes de clases

Módulo prendido, los cuatro números de reserva y "Permitir clases en el mismo horario" (con la
explicación de qué cuenta como superposición). La penalización se suma en la entrega 3.

## Entrega 2 — después de la clase

- Asistencia, en este orden: lista de la profe (`attendance_taken`) → ingreso físico registrado
  ese día por el socio → respuesta del socio en "¿Fuiste?" → sin nada, a las 24 h `absent`
  (`attendance_source = 'timeout'`).
- "¿Fuiste a Spinning?" aparece al abrir la app después del fin de la clase (si su reserva sigue
  `booked` y no hay lista tomada). Sí: `attended` + calificación opcional de 1 a 5 + se agrega a
  su historial. No: `absent`.
- Si la profe toma lista, a los presentes se les agrega igual al historial al abrir la app (sin
  preguntar) y se les ofrece calificar.
- Entrenamiento de tipo Clase en el estado del socio: `{ kind: 'class', classId, sessionId,
  name, teacher, start, d, duration }` más, según el modo, `muscleLoad: { muscles, intensity }` o
  `entries` con series hechas (como un entrenamiento normal). El detalle del historial lo muestra
  como cualquier entrenamiento, con una etiqueta "Clase".
- Fatiga (`frontend/src/lib/recovery.js`): `muscleLoad` cuenta como series equivalentes por
  músculo según la intensidad (baja 2, media 4, alta 6; se ajusta con tests contra una sesión de
  fuerza comparable).
- Historial: segmentado Todo / Entrenamientos / Clases, en Todo de entrada.

## Entrega 3 — números

- Estadísticas en Admin → Clases: ocupación por clase y por horario, ausencias, cancelaciones
  tardías, calificación promedio por clase y por profe, horarios con lista de espera.
- Penalización (si `penalty.on`): ausencias + cancelaciones tardías en los últimos `windowDays`
  días ≥ `absences` → no puede reservar por `blockDays` días desde la última. La app explica por
  qué y hasta cuándo. El staff puede anotarlo a mano igual.

## Pruebas

- API, puras: cálculo de fechas (bloques + sesiones guardadas, cambios, sueltas, zona horaria),
  superposición (sala, sin sala, misma profe, `allowOverlap`), ventana de reserva, cancelación
  tardía, lista de espera y su corte, reserva fija, texto de recordatorios, `.ics`.
- API, HTTP sobre `server.js`: reservar con cupo y sin cupo, cancelar sube al primero de la lista,
  cuota vencida no reserva, profe con `classes.attendance` solo ve sus clases, owner cambia
  ajustes y nadie más, cambio de horario avisa y recalcula recordatorios, migración de permisos.
- Scheduler: recordatorios a la hora justa, una sola vez, no para canceladas.
- Frontend: Plan → Clases (estados del botón), hoja de la clase, recordatorios, tarjeta de
  Inicio, calendario del staff (semana y día), editor (modos de registro, bloques, aviso de
  superposición).
- Verificación en navegador en celular y PC.

## Fuera de alcance

- Elegir lugar dentro de la clase (número de bici o colchoneta).
- Racha de clases.
- Planes de cuota por cantidad de clases.
- Nivel de la clase.
