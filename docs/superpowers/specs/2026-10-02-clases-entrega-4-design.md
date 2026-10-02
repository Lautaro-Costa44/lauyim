# Clases, entrega 4 — diseño

Fecha: 2026-10-02. Estado: aprobado en chat; este spec espera la revisión del usuario.
Sigue a `2026-10-02-clases-entregas-2-3-design.md`, que está en la rama `feat/clases-2` y se mergea
antes de empezar. Rama: `feat/clases-4`.

Seis agregados al módulo de clases. Criterio de siempre: que se vea bien en celular y en PC, que
sea simple de usar, y que lo que cambia de un gimnasio a otro se pueda configurar.

## Decisiones tomadas

- Se entrega en tres partes, de menor a mayor riesgo:
  - **A:** historial, aviso a la profe y compartir la lista.
  - **B:** cierre del gimnasio y clases en la ficha del socio.
  - **C:** límite de clases por plan.
- **Límite por plan:**
  - La semana va de lunes a domingo y el mes es el mes calendario (del 1 al último día). No se
    usa el ciclo de cada cuota.
  - Consumen una clase las reservas anotadas, en lista de espera, presentes, ausentes y las
    cancelaciones tardías.
  - Una cancelación a tiempo devuelve la clase.
- **Lista compartida:** por defecto con nombre e inicial ("Ana P."), porque se comparte en grupos
  con otros socios. Se puede cambiar a nombre completo en el momento de compartir.
- **Aviso a la profe:** prendido de entrada, 1 hora antes. Cada profe lo cambia en sus Ajustes.

## Parte A

### 6. La clase en el historial

Al tocar una clase en el historial (filtro Todo o Clases) se abre `ClassWorkoutDetail` en lugar
del detalle de un entreno. En PC aparece en el panel de al lado, igual que un entreno.

- **Encabezado:** punto del color de la clase, nombre, día y hora, "con Caro" y la sala. Debajo,
  una etiqueta que dice cómo quedó presente:
  - "Tomaste la lista", si fue la profe.
  - "Ingresaste al gimnasio", si fue por el ingreso físico.
  - "Dijiste que fuiste", si contestó el socio.
- **Qué se trabajó:**
  - En modo músculos: el mapa del cuerpo con la intensidad.
  - En modo ejercicios: la lista de ejercicios con series y repeticiones.
- **Calificación:** las estrellas, editables mientras se pueda calificar (`canRate`). Cuando ya no
  se puede, se ven sin poder cambiarlas. Si no calificó: "No la calificaste".
- **Nota:** igual que en un entreno: se guarda al salir, en `workouts.note`.
- **Borrar:** "Borrar del historial". Borra el entrenamiento, no la reserva ni la asistencia: la
  asistencia sigue contando para el gimnasio.
- **Datos que faltan:**
  - El entrenamiento ya trae `classBookingId`, `teacher`, `muscleLoad` y `entries`.
  - Para la fuente de asistencia, la calificación, si todavía se puede calificar, la sala y el color
    se agrega `GET /api/classes/booking?id=` (solo la reserva propia).
  - Sin conexión se muestra lo que trae el entrenamiento, sin las estrellas.
- **Ficha del socio (staff):** el mismo detalle en modo solo lectura, sin nota editable ni
  "Borrar". Los datos los trae `GET /api/admin/classes/booking?id=`, con permiso
  `classes.view_all` o el de la profe de esa fecha.

### 4. Aviso a la profe antes de su clase

- **Push:** título "Spinning en 1 hora", texto "8 anotados · 2 en espera". Sin cupo: "8 anotados".
  Si no hay nadie: "Todavía no se anotó nadie".
- **Al tocarlo** abre `/#/plan/clases?d=FECHA`, donde está su clase con la rueda.
- **A quién:** a la profe con cuenta de cada fecha (`teacherUserId`), si la fecha no está suspendida
  ni cerrada.
- **Una sola vez por fecha:** `noticeOnce(profe, clave de la fecha, 'teacher_reminder')`. Si
  cambian el horario después, no se repite.
- **Configuración** en `class_prefs`, columna nueva `teacher_reminder INTEGER`: minutos antes, o
  0 para apagado. Si no hay nada guardado vale 60.
  - Ajustes → Recordatorios de clases suma la fila "Antes de las clases que doy", con las opciones
    No, 30 min, 1 h y 2 h. Solo aparece para quien tiene `classes.attendance`.
  - `PUT /api/classes/teacher-reminder { minutes }` acepta solo 0, 30, 60 o 120.
- **Envío:** `sendTeacherReminders` en el tick del scheduler, junto a los recordatorios del socio.
  Mira las fechas de hoy y mañana.

### 5. Compartir la lista

- **Dónde:** en la hoja de la fecha (la rueda o el panel), un botón "Compartir lista" al lado de
  "Mandar un mensaje a los anotados". Abre una hoja chica con:
  - Un selector de nombres: Nombre e inicial (por defecto) o Nombre completo. Se recuerda en el
    dispositivo.
  - La vista previa del texto.
  - El botón **Compartir**. Usa `navigator.share` donde existe (celular: WhatsApp, Telegram,
    etc.). Donde no existe, copia el texto y muestra "Copiado" y "Abrir WhatsApp"
    (`https://wa.me/?text=…`).
- **Texto:**
  ```
  Spinning · Lun 5/10 · 19:00 · Sala 2
  Profe: Caro

  Anotados (8/12):
  1. Ana P.
  2. Beto R.
  …

  En espera:
  1. Cami L.
  ```
- **Variantes:** sin cupo dice "Anotados (8)"; después de tomar lista agrega ✓ o ✗ a cada nombre.
- Arma el texto la app, con los datos que ya trae la hoja (`booked`, `waitlist`). No hace falta API.

## Parte B

### 1. Cierre del gimnasio

- **Datos:** tabla `class_closures`:
  ```sql
  CREATE TABLE class_closures (
    id TEXT PRIMARY KEY,
    from_date TEXT NOT NULL,
    to_date TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_by TEXT,
    created_at TEXT NOT NULL
  );
  ```
- **Reglas:**
  - Un rango va de 1 a 31 días y no se superpone con otro cierre.
  - Una fecha dentro de un cierre es una fecha suspendida, con el motivo.
  - `occurrencesBetween` las marca `cancelled: true, closed: 'Feriado'` aunque no tengan sesión
    guardada. Así no se reservan, no se crean solas con "Fija" y no mandan recordatorios.
- **Crear un cierre:** `POST /api/admin/classes/closures { from, to, reason }`, con
  `classes.manage`.
  - Suspende las fechas guardadas que caen adentro y cancela sus reservas (sin promover a nadie).
  - Manda **un solo aviso por persona**, con todas sus clases afectadas:
    - Un día: título "El lunes 12 no hay clases", texto "Feriado. Se suspendieron Spinning 19:00
      y GAP 20:30; tu lugar quedó liberado."
    - Un rango: título "Sin clases del 2/1 al 15/1", texto "Vacaciones. Se suspendieron tus 6
      reservas."
- **Vista previa:** `GET /api/admin/classes/closures/preview?from&to` devuelve
  `{ classes, people }` para la confirmación.
- **Reabrir:** `POST /api/admin/classes/closures/delete { id }`.
  - Las fechas vuelven a estar disponibles, pero las reservas canceladas no se recuperan.
  - Las reservas fijas se vuelven a crear solas en el siguiente tick.
  - Las fechas que se suspendieron una por una antes del cierre siguen suspendidas.
- **Panel (Admin → Clases):**
  - Botón "Cerrar el gimnasio" en la cabecera.
  - Hoja con "Un día / Varios días", la fecha o el rango, el motivo con chips rápidos (Feriado,
    Vacaciones, Mantenimiento) y texto libre.
  - Vista previa en vivo y confirmación en rojo: "Cerrar y avisar".
  - En el calendario, los días cerrados aparecen con una franja "Cerrado · Feriado". Tocarla abre
    el cierre con "Reabrir".
  - Debajo de la cabecera, la lista de próximos cierres.
- **Socio (Plan → Clases):**
  - El chip del día cerrado muestra un candado.
  - Ese día, en lugar de la lista: "El gimnasio está cerrado · Feriado".
  - La fila de Inicio saltea los días cerrados.

### 2. Clases en la ficha del socio

Una tarjeta "Clases" en `UserDetail`, entre la cuota y el historial. Se ve con `classes.view_all`
o `classes.book_members`, cuando el módulo está prendido. Los datos los trae
`GET /api/admin/classes/member?userId=`.

- **Próximas reservas:** hasta 5, con día, hora y estado (anotado o en espera n.º). Cada una tiene
  "Cancelar":
  - Requiere `classes.book_members`.
  - Es una cancelación a tiempo, sin penalización, y sube a la primera de la lista de espera.
  - Le avisa al socio: "Recepción canceló tu lugar en Spinning del lunes 5."
  - Si hay más reservas: "Ver todas (8)".
- **Días fijos:** chips "Lun 19:00 Spinning".
- **Último mes:** cuatro números (presentes, ausentes, tardías y % de asistencia). La asistencia es
  presentes / (presentes + ausentes).
- **Penalización vigente:**
  - Aviso en naranja: "No puede reservar hasta el 12/10 · 3 ausencias".
  - Botón "Levantar penalización", con `classes.manage`.
  - Al levantarla se guarda `class_prefs.penalty_reset_at` con la fecha de hoy, y `penaltyOf`
    ignora las ausencias de esa fecha o anteriores.
  - Queda en la auditoría (`classes.penalty.reset`) y le avisa al socio: "Ya podés volver a
    reservar clases."
- **Sin reservas ni historial:** "Todavía no fue a ninguna clase."

## Parte C

### 3. Límite de clases por plan

- **Datos:** `plans` suma dos columnas, `class_limit INTEGER` (null es libre) y `class_period TEXT`
  ('week' o 'month').
- **Planes (Cuotas → Planes):** el campo "Clases incluidas" tiene un selector (Libre / Por semana
  / Por mes) y un número de 1 a 31. En la lista de planes se lee "Mensual · 2 clases por semana".
- **Cuándo aplica:** solo con Cuotas prendido y el socio con un plan con límite. Sin eso no cambia
  nada.
- **Cuenta:** reservas del socio cuya fecha cae en la misma semana (de lunes a domingo) o el mismo
  mes que la fecha a reservar, con estado `booked`, `waitlist`, `attended`, `absent` o
  `late_cancel`. No cuentan las reservas de clases que da la persona.
- **Dónde se controla:**
  - `book` y `book-week`: en `book-week` se reserva por orden hasta llegar al límite y el resto se
    informa.
  - `materializeRecurring`: la fecha no se reserva y se avisa una sola vez
    (`noticeOnce(..., 'plan_limit')`): "No pudimos anotarte. Tu plan incluye 2 clases por semana
    y esa semana ya tenés 2."
- **Error:** `403 plan_limit { limit, period, used }`. El socio ve "Tu plan incluye 2 clases por
  semana y ya tenés 2 esa semana."
- **Anotar a mano (staff):** se puede pasar el límite. La API devuelve `overLimit: true` y el panel
  avisa "Pasa el límite de su plan (2 por semana)".
- **Socio (Plan → Clases):**
  - Arriba, una línea discreta: "Te quedan 1 de 2 clases esta semana". Se calcula para la semana
    (o el mes) del día elegido.
  - Al llegar a 0, los botones "Anotarme" de esa semana quedan apagados con el texto "Límite del
    plan".
  - `GET /api/classes` suma `planLimit: { limit, period, used: { 'YYYY-MM-DD lunes o mes': n } }`.

## Pruebas

- **API (`node --test`):**
  - Cierres: que suspenda y avise una vez por persona, que reabrir funcione, que una fecha cerrada
    sin sesión no se reserve y que "Fija" la saltee.
  - Ficha: que cancelar desde el staff promueva a la lista de espera, y que levantar la
    penalización permita reservar.
  - Límite: semana y mes en los bordes (domingo/lunes, fin de mes), que una cancelación a tiempo
    devuelva la clase y que una tardía no; `book-week` parcial; "Fija" con aviso; el staff con
    `overLimit`.
  - Aviso a la profe: que salga una vez, que respete la configuración y que no salga si la fecha
    está suspendida.
  - Reserva propia: `GET /api/classes/booking` solo para su dueño.
- **Frontend (vitest):**
  - Detalle de la clase en el historial: estrellas editables o no, nota, borrar, vista del staff.
  - Texto de la lista compartida: inicial, sin cupo, después de tomar lista.
  - Hoja de cierre con la vista previa.
  - Tarjeta de la ficha.
  - Línea del límite y botón apagado.
  - Ajuste de la profe.
- **Navegador:** cada parte en celular y PC, con la API local y datos de prueba.

## Fuera de alcance

- Feriados nacionales cargados solos. Más adelante podría sugerirse la lista del año.
- Límite por tipo de clase (por ejemplo, "2 de Spinning y libre el resto") y paquetes de clases
  sueltas pagas.
- Recuperar las reservas al reabrir un cierre.
