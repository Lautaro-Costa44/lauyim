# Clases, entrega 4, parte A: plan

Spec: `docs/superpowers/specs/2026-10-02-clases-entrega-4-design.md`. Rama: `feat/clases-4`.
En cada tarea se escriben los tests primero, después el código, y se corren las suites completas.

## Tarea 1: API para el historial y el aviso a la profe

- `classes-db.js`:
  - Columna `class_prefs.teacher_reminder INTEGER`, con su `ALTER` tolerante.
  - `getTeacherReminder(userId)` devuelve 60 si no hay nada guardado.
  - `setTeacherReminder(userId, minutes)`.
- `classes.js`:
  - `TEACHER_REMINDER_OPTIONS = [0, 30, 60, 120]`.
  - `teacherReminderDue({ occ, now, minutes })`: es verdadero cuando faltan `minutes` o menos y la
    clase no empezó.
- `push-messages.js`: `teacherReminderPush({ name, date, start, minutes, booked, waitlist, sessionId })`.
  - Título "Spinning en 1 hora".
  - Texto "8 anotados · 2 en espera", "1 anotado" o "Todavía no se anotó nadie.".
- `classes-routes.js`:
  - `sendTeacherReminders({ send, now })`, para hoy y mañana.
    - Va a la profe con cuenta, si la fecha no está suspendida, la profe no está desactivada y el
      aviso no está apagado.
    - Sale una sola vez: `noticeOnce(profe, occ.key, 'teacher_reminder')`.
  - `GET /api/classes` suma `teacherReminder` (los minutos de quien consulta).
  - `PUT /api/classes/teacher-reminder { minutes }`.
  - `GET /api/classes/booking?id=`: devuelve la reserva propia y su fecha (`source`, `rating`,
    `canRate`, el color, la sala y la profe).
  - `GET /api/admin/classes/booking?id=`: lo mismo para el staff. Pide `canSee`, y en
    `ROUTE_PERMISSIONS` va como `['classes.attendance', 'classes.view_all']`.
- `scheduler.js` llama a `sendTeacherReminders`.
- Tests:
  - `push-messages.test.js`;
  - `classes.test.js` (`teacherReminderDue`);
  - `scheduler-classes.test.js` (sale una vez, respeta el apagado, no sale si está suspendida);
  - `classes-member.http.test.js` (el ajuste, la reserva propia, una reserva ajena da 404);
  - `classes-admin.http.test.js` (la reserva vista por el staff);
  - `route-permissions.test.js`.

## Tarea 2: la clase en el historial (frontend)

- `components/workout/ClassWorkoutDetail.jsx` con `{ w, close, staff }`:
  - Pide la reserva con `classesApi.booking` o `classesApi.adminBooking`. Sin conexión muestra lo
    que trae el entrenamiento.
  - Encabezado (color, nombre, día y hora, profe y sala) y la etiqueta de cómo quedó presente.
  - Qué se trabajó: el mapa del cuerpo con la intensidad, o los ejercicios con series y
    repeticiones.
  - Estrellas (el componente `Stars` de `ClassAfterPrompt`). Se pueden cambiar si `canRate` y no es
    el staff; si no, solo se ven, o "No la calificaste".
  - Socio: la nota editable (se guarda al salir, como en un entreno) y "Borrar del historial".
- `sheets.jsx`: el `WorkoutDetail` de hoy pasa a llamarse `TrainingDetail`, y el nuevo
  `WorkoutDetail` elige `ClassWorkoutDetail` cuando la entrada es una clase. Eso cubre el
  historial, el panel de PC, el calendario de Stats y los últimos entrenos.
- `views/admin/shared.jsx`: `openWorkout` usa `ClassWorkoutDetail` con `staff` si es una clase.
- `lib/classes.js`:
  - `classesApi.booking`, `classesApi.adminBooking` y `classesApi.setTeacherReminder`.
  - `attendanceSourceLabel(source)`.
- Tests: `ClassWorkoutDetail.test.jsx` (estrellas editables o no, nota, borrar, staff de solo
  lectura, sin conexión).

## Tarea 3: el ajuste de la profe (frontend)

- `Settings.jsx`: en Recordatorios de clases, una segunda fila "Antes de las clases que doy", con
  los chips No, 30 min, 1 h y 2 h. Solo aparece con `classes.attendance`.
- Test en `Settings` o en `Clases.test.jsx`.

## Tarea 4: compartir la lista (frontend)

- `lib/classes.js`:
  - `shortName(name)`: "Ana Pérez" da "Ana P.".
  - `shareListText({ occ, booked, waitlist, full, taken })`.
- `SessionSheet.jsx`:
  - Botón "Compartir lista" junto al del mensaje.
  - `ShareListSheet` con el selector de nombres (Nombre e inicial / Nombre completo), que se
    recuerda en `localStorage` (`lauyim_share_names`), y la vista previa.
  - El botón Compartir usa `navigator.share`. Donde no está, copia el texto y ofrece "Abrir
    WhatsApp".
- Tests:
  - el texto (inicial, sin cupo, después de tomar lista, lista de espera);
  - la hoja (selector, compartir, copiar si no hay `share`).

## Cierre

- Suites completas, build y `check-locales`.
- En el navegador, en celular y PC: el historial con una clase, el ajuste de la profe y compartir
  la lista.
- Commit por tarea, push de la rama y los comandos para probar en dev.
