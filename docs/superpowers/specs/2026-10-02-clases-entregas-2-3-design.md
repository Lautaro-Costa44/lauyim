# Clases, entregas 2 y 3 — diseño

Fecha: 2026-10-02. Estado: aprobado en chat, pendiente de revisión del spec.
Sigue a `2026-10-01-clases-design.md` (la entrega 1 está en `main`, f7c6f87).

## Decisiones tomadas

- La reserva fija no aplica a clases sueltas (pasan una sola vez). Queda como está.
- Asistencia, en este orden: lista de la profe → respuesta del socio → ingreso físico del día →
  ausente a las 24 h. La respuesta del socio dice si fue; las estrellas son su opinión de la clase
  (cómo estuvo), no del esfuerzo, y no cambian cómo cuenta para la fatiga.
- "¿Fuiste?" dentro de la app siempre. Además, el owner elige en Ajustes de clases si se manda un
  push después de la clase y cuántos minutos después (30 por defecto, prendido de entrada).
- Penalización: apagada de entrada; 3 ausencias en 30 días bloquean 7 días; las cancelaciones
  tardías cuentan como ausencias.
- La profe ve el promedio de sus calificaciones. Quien no calificó no cuenta para el promedio; se
  muestra cuántos calificaron.

## Antes de la entrega 2 (misma rama)

1. **Anotado a mano:** el socio recibe un aviso "Te anotaron a Spinning de mañana a las 19:00"
   (`classChangePush('added', …)`). Sus recordatorios ya aplican (la reserva toma los de entrada).
2. **Reserva fija con la cuota vencida:** esa fecha no se reserva y el socio recibe una sola vez
   "No te anotamos a Spinning del viernes: tu cuota está vencida. Regularizala en recepción."
   (`classChangePush('fee_blocked', …)`). Para no repetirlo, se guarda en una tabla
   `class_notices (user_id, session_key, kind, sent_at)` con clave única.

## Entrega 2 — después de la clase

### Datos

- `class_bookings`: columnas nuevas `answered_at TEXT` (el socio contestó "¿Fuiste?") y
  `logged INTEGER DEFAULT 0` (ya está en su historial). `attendance_source` y `rating` ya existen.
- Ajustes de clases (`admin_settings.classes`): `afterPush: { on: true, minutes: 30 }` (0 a 180).
- Entrenamiento de tipo clase en el estado del socio (lo arma la app; viaja por la sync normal; los
  campos extra van a `meta` de `workouts`, ver `api/row-meta.js`):
  ```js
  { id, d: 'YYYY-MM-DD', start: ms, end: ms, name: 'Spinning', kind: 'class',
    classBookingId, classId, teacher: 'Caro',
    // modo músculos:
    entries: [], muscleLoad: { muscles: ['quadriceps', 'calves'], intensity: 'high' },
    // modo ejercicios:
    entries: [{ id, sets: [{ r: 12, done: true }, …] }] }
  ```
  `start`/`end`: inicio y fin de la clase en la zona del gym. Sin peso en las series.

### Reglas de asistencia

Estados finales de una reserva `booked`: `attended` o `absent`, con `attendance_source`:

| Fuente | Cuándo | Efecto |
|---|---|---|
| `teacher` | La profe guarda la lista (desde el inicio hasta 7 días después; se puede corregir) | Pisa todo lo anterior |
| `member` | El socio contesta "¿Fuiste?" (hasta 48 h después del fin) | Solo si no hay lista de la profe |
| `checkin` | A las 24 h del fin, sin lista ni respuesta, si tiene ingreso físico ese día | Presente |
| `timeout` | A las 24 h, sin nada de lo anterior | Ausente |

- Lo resuelve el tick del scheduler (`checkin` y `timeout`), una vez por reserva.
- Una corrección de la profe de presente a ausente no borra la clase del historial del socio (es
  suyo); solo cambia los números del gimnasio.

### "¿Fuiste?" y el historial

- `GET /api/classes/pending` (socio): `{ ask: [...], log: [...] }`.
  - `ask`: reservas `booked`, sin respuesta ni lista, cuya clase terminó hace menos de 48 h.
  - `log`: reservas `attended` con `logged = 0` (lista de la profe, ingreso físico o su "sí"), con
    los datos para armar el entrenamiento y si ya calificó.
- Al abrir la app (y al volver a primer plano), si hay `ask`, una hoja por clase, la más vieja
  primero: "¿Fuiste a Spinning?" (hoy 19:00, con Caro) → **Sí** / **No**. Con Sí aparece "¿Qué te
  pareció la clase?" con 1 a 5 estrellas (opcional, "Saltear").
- `POST /api/classes/attendance` `{ bookingId, attended, rating? }`: guarda respuesta y calificación
  (si no hay lista de la profe); devuelve el entrenamiento a sumar si fue.
- La app suma al historial cada `log` (y el "sí" recién contestado) y avisa
  `POST /api/classes/logged { bookingId }`. Una reserva nunca se suma dos veces (`logged` en el
  servidor y `classBookingId` en el estado).
- Presente por la lista de la profe o por ingreso físico: se suma sin preguntar; si no calificó, la
  hoja ofrece solo las estrellas ("Estuviste en Spinning: ¿qué te pareció?").
- `POST /api/classes/rating { bookingId, rating }`: calificar después (hasta 7 días).

### Push después de la clase

Con `afterPush.on`, el scheduler manda a cada reserva `booked` sin respuesta ni lista, `minutes`
después del fin: título "¿Fuiste a Spinning?", cuerpo "Contanos y sumala a tu historial." Al
tocarlo abre la app, que muestra la hoja. Una sola vez (`class_notices`, kind `after`).

### Tomar lista (staff)

- En la hoja de la fecha (Admin → Clases), con `classes.attendance` en la propia o
  `classes.manage`: botón "Tomar lista" desde el inicio hasta 7 días después.
- Lista de anotados con interruptor Presente / Ausente (de entrada, lo que ya se sabe: respuesta o
  ingreso), "Todos presentes" y "Guardar lista".
- `POST /api/admin/classes/sessions/attendance { sessionId, present: [userId], absent: [userId] }`
  → `attendance_taken = 1`, estados con fuente `teacher`. Auditado.

### Fatiga y estadísticas del socio

- `frontend/src/lib/recovery.js` (`sessionStimulus`): un entrenamiento con `muscleLoad` suma por
  cada músculo series equivalentes de esfuerzo medio (RIR 2): baja 2, media 4, alta 6. Test:
  una clase alta de cuádriceps queda en el mismo orden que 6 series de sentadilla a RIR 2.
- Series sin peso (modo ejercicios): cuentan para la fatiga como las de peso corporal; no generan
  récords ni 1RM.
- Cuenta para la racha y los días entrenados; volumen 0.

### Historial

- `lib/workout-history.js`: `filterWorkouts` suma `kind: 'all' | 'workouts' | 'classes'`.
- `WorkoutHistoryList`: segmentado Todo / Entrenamientos / Clases, en Todo de entrada; aparece si
  el gimnasio tiene clases o el socio tiene alguna en su historial.
- Fila y detalle de una clase: etiqueta "Clase", profe; el detalle muestra el mapa con la
  intensidad (modo músculos) o la lista de ejercicios. Sin "Repetir este entreno".

### Ajustes de clases (owner)

Suma "Aviso después de la clase": interruptor y minutos (0 a 180, 30 de entrada).

## Entrega 3 — números

### Estadísticas

- `GET /api/admin/classes/stats?weeks=4|12` (`classes.view_all` o `classes.attendance`; con solo
  tomar lista, únicamente sus clases).
- Cuenta fechas pasadas no suspendidas del período:
  - **Por clase:** fechas, ocupación promedio (anotados / cupo), presentes, ausentes,
    cancelaciones tardías, calificación promedio y cuántos calificaron.
  - **Por profe:** clases dadas, ocupación promedio, calificación promedio y cuántos calificaron.
  - **Por día y hora:** ocupación promedio por bloque (día de la semana × hora de inicio) y en
    cuántas fechas hubo lista de espera.
- Calificaciones: solo promedios; nunca quién puso cuánto. Sin calificaciones: "Sin
  calificaciones".
- Admin → Clases: botón "Estadísticas" (hoja en celular, ventana en PC) con selector 4 / 12
  semanas, tabla por clase, tabla por profe y la grilla día × hora coloreada por ocupación.

### Penalización por ausencias

- Ajustes de clases: `penalty: { on: false, absences: 3, windowDays: 30, blockDays: 7 }` (1–10,
  7–90, 1–30), con su explicación.
- Cuentan `absent` y `late_cancel` de los últimos `windowDays`. Con `absences` o más, el socio no
  puede reservar hasta `blockDays` días después de la última.
- `POST /api/classes/book` responde 403 `booking_penalty` con `until` y `count`. `GET /api/classes`
  trae `penalty: { until, count } | null` para el cartel de Plan → Clases: "Por 3 ausencias en el
  último mes no podés reservar hasta el 12/10."
- La reserva fija se pausa mientras dure (aviso una vez por bloqueo, `class_notices`).
- El staff puede anotarlo a mano igual.
- Ficha del socio (staff con `classes.view_all` o `members.view`): "Clases: 8 presentes, 2
  ausentes en 30 días" y el bloqueo si lo hay.

## Pruebas

- API puras (`classes.js`): resolución de asistencia (orden de fuentes, ventanas de 24 h, 48 h y 7
  días), entrenamiento de una clase en los dos modos, estadísticas (promedios sin los que no
  calificaron, ocupación, grilla), penalización (ventana, conteo, hasta cuándo).
- API HTTP: pending/attendance/logged/rating del socio, tomar lista (permisos, ventana,
  corrección), push después de la clase una sola vez, ingreso físico y timeout en el tick, avisos
  de anotado a mano y de cuota vencida una sola vez, stats por permiso, booking_penalty.
- Frontend: hoja "¿Fuiste?" con estrellas, suma al historial una sola vez, filtro del historial,
  detalle de una clase, fatiga con `muscleLoad`, tomar lista, estadísticas, cartel de
  penalización, ajustes nuevos.
- Navegador en celular y PC.

## Ramas y entregas

- `feat/clases-2`: los dos arreglos de arriba + entrega 2.
- `feat/clases-3`: entrega 3.
Cada una con su plan, tests primero y prueba en dev antes de mergear.

## Fuera de alcance

- Elegir lugar en la clase, racha de clases, planes de cuota por cantidad de clases.
- Comentarios escritos en la calificación.
