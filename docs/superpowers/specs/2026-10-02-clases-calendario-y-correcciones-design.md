# Clases: correcciones de dev, y calendario, semana y racha con clases

Fecha: 2026-10-02. Estado: aprobado en chat. Rama: `feat/clases-4`, sobre la entrega 4.

## Decisiones del usuario

- Una clase a la que el socio fue cuenta como un entreno: suma a la racha y al objetivo de la
  semana.
- Si un día hay una rutina planeada y una clase reservada, Inicio muestra las dos. La rutina sigue
  pendiente aunque la clase ya se haya hecho. Si las dos cargan los mismos músculos, aparece un
  aviso suave.

## 1. Correcciones de lo probado en dev

### 1.1 "Estuviste en…" mientras la clase está en curso

La profe puede tomar lista desde que la clase empieza. En ese momento la reserva queda
`attended` y `GET /api/classes/pending` ya la devolvía en `log`. Eso sumaba el entreno al
historial y abría "Estuviste en Spinning: ¿qué te pareció?" con la clase sin terminar.

**Arreglo:** `pending` devuelve en `log` solo las fechas que ya terminaron.

### 1.2 La clase en curso en el historial

El historial (filtros Todo y Clases) suma arriba de todo un renglón "Ahora" por cada clase
reservada que está en curso. Muestra color, nombre, la etiqueta **En curso**, el horario y la
profe. Al tocarlo se abre la hoja de la clase.

Cuando la clase termina y queda presente, entra como siempre: por la lista de la profe, el
ingreso al gimnasio o la respuesta del socio.

- Los datos salen de `classesApi.list()` de hoy y se recargan cada minuto mientras se ve el
  historial.
- Lo arma la función pura `liveClasses(occurrences, now, tz)`.

### 1.3 Corregir la lista (presente y después ausente)

Si la profe marca presente, el socio suma la clase al historial (`logged`). Si después la corrige
a ausente, la reserva cambia pero el entreno seguía en el historial del socio, y "Dijo que fue"
seguía leyendo el estado nuevo.

**Arreglo:**
- **API:** al pasar a ausente desde la lista, la calificación se borra. `pending` devuelve
  `unlog: [bookingId]`, que son las reservas ya sumadas (`logged`) que ahora no están `attended`
  (de los últimos 8 días).
- **App del socio:** `checkClassesAfter` saca del historial los entrenos con ese
  `classBookingId` y avisa con `POST /api/classes/logged { bookingId, logged: false }`. Si la
  profe la vuelve a marcar presente, entra de nuevo, porque `logged` vuelve a 0.
- **Lista de la profe:** "Dijo que fue / no fue" solo aparece cuando la fuente es el socio
  (`source === 'member'`).

## 2. Calendario, semana y racha con clases

### 2.1 Elegir rutina o descanso ya no borra las clases (bug)

`DayOverride` y `markDone` borraban todos los entrenos del día al elegir una rutina, descanso o
"marcar como realizado". Ahora no tocan las clases (`kind: 'class'`).

### 2.2 La hoja del día

Al tocar un día de la semana o del calendario, la hoja suma arriba "Clases de este día": las que
hizo (con el detalle) y las reservadas (abren la hoja de la clase). El resto de la hoja sigue
igual.

### 2.3 La semana de Inicio

- **Punto de clase:** debajo de cada día, junto al punto de siempre (planeado, reprogramado,
  hecho), un punto chico del color de la clase si hay una clase reservada o hecha ese día.
- **"Hoy":**
  - Si hay rutina planeada, sigue pendiente aunque hoy se haya hecho una clase. La rutina solo
    cuenta como hecha con un entreno que no sea clase.
  - Debajo, una línea "También hoy: Spinning 19:00", y si ya terminó, "Spinning ✓".
  - Si la clase trabaja músculos que la rutina carga fuerte (la intersección entre los músculos de
    la clase y `loadOfRoutine(rutina)`), se agrega: "Spinning también trabaja cuádriceps y
    glúteos."
- **Racha:**
  - El objetivo usa `weeklyTarget` (con grupos de rutinas), igual que la racha. Antes Inicio
    contaba `S.week` aparte.
  - El texto dice cuántas fueron clases: "3 / 4 esta semana · 1 clase".
- **Recordatorio del día (scheduler):** una clase hecha ese día no apaga el aviso de la rutina,
  porque la rutina sigue pendiente.

### 2.4 Calendario del mes

- Los días con clase hecha o reservada llevan el punto de clase.
- La leyenda suma "Clase".
- Tocar un día con clases abre la hoja del día. Si ese día solo hay entrenos de rutina, se
  mantiene lo de antes: el detalle directo o la lista.

### 2.5 Listas de entrenos

`WorkoutRow` (últimos entrenos en Progreso y la lista de un día) muestra las clases con el ícono de
calendario en su color, "Clase", la profe y la duración, en lugar de "0 series · 0 kg".

## Datos

- **Reservas para la semana, el calendario y la hoja del día:** `useMyClasses()`, sobre
  `classesApi.list()` con caché de 30 segundos. Devuelve las fechas con reserva propia activa o
  presente.
- **Clases hechas:** salen de los entrenos de tipo clase (`kind: 'class'`, con `classId`). Para el
  color se usa la reserva del listado cuando está.

## Pruebas

- **API:**
  - `pending` no devuelve una clase en curso;
  - `unlog` aparece al corregir a ausente;
  - `logged: false`;
  - la calificación se borra al pasar a ausente.
- **Frontend:**
  - `liveClasses` y el renglón "Ahora";
  - `checkClassesAfter` saca el entreno corregido;
  - la hoja del día con clases, sin borrarlas al elegir una rutina;
  - "Hoy" con rutina y clase, y el aviso de músculos;
  - el punto de clase en la semana;
  - `WorkoutRow` de una clase;
  - el objetivo con `weeklyTarget`;
  - el scheduler ignora las clases en `hasWorkoutOnDate`.
- **Navegador:** celular y PC.
