# Cierre del gimnasio: más allá de las clases

Fecha: 2026-10-09 · Rama: `feat/cierres` · Ítem 2 de la lista de mejoras

## Por qué

El cierre del gimnasio (feriado, vacaciones, mantenimiento) existe desde la entrega 4 de clases, pero vive entero dentro de ese módulo:

- Tabla `class_closures` (`api/classes-db.js`). Rutas `/api/admin/classes/closures*` con el permiso `classes.manage`. Botón en Admin → Clases.
- Al cerrar se suspenden las clases, se cancelan las reservas y se manda push **solo a quien tenía reserva**.

Auditoría:

1. **Un gimnasio sin clases no puede cerrar.** El botón está en Clases. Con el módulo apagado, `/api/classes` responde `enabled: false` sin `closures` (`classes-routes.js:767`), así que el aviso de la hoja del día (`DaySheet`) tampoco aparece.
2. **El socio no se entera.** Sin reserva no recibe push. El Inicio no avisa. La tira de la semana y el calendario muestran el punto de "planificado" en días cerrados.
3. **La racha se corta sin culpa del socio.** `weeklyTarget` cuenta los días planificados y no sabe de cierres. Dos semanas de vacaciones dejan la racha en 0. Un feriado en un plan de 5 días hace imposible cumplir la semana.
4. **Cuotas.** No hay forma de correr los vencimientos. Y si se corrieran a mano, anular el último pago queda bloqueado: el anulador exige `dueDate === payment.periodEnd` (`server.js`, ruta de anular pago).
5. **Check-in.** Registra el ingreso en un día cerrado. Se decidió que **está bien así** (ver más abajo).

## Principio

El cierre **nunca bloquea nada en la app**. El socio sigue entrenando en casa, cargando nutrición, marcando días y reservando otras fechas. Solo recibe avisos, y la racha lo trata con justicia.

## Admin

### Dónde

- Tarjeta **"Cierres"** en **Admin → Resumen**, visible para quien ve Resumen:
  - Lista de próximos cierres y del que está en curso: fecha o rango, motivo y una línea de estado. Ejemplos: "48 avisados", "aviso: mañana 08:00", "vencimientos +1 día".
  - Botón **"＋ Cerrar"** y, en cada cierre, **"Reabrir"**. Los dos solo con el permiso `gym.closures`.
  - Sin cierres próximos: una sola línea, "No hay cierres programados", y el botón.
- En **Admin → Clases** queda el botón "Cerrar el gimnasio" como acceso directo a la misma hoja, y el calendario de clases sigue mostrando los días cerrados.

### Permiso

- Nuevo permiso `gym.closures`, área Operación: "Cerrar el gimnasio · Feriados y vacaciones: cerrar y reabrir, y avisar a los socios." Sin dependencias.
- El owner no lo necesita (tiene todo).
- **Migración** (patrón `migrateRolePerms`, clave `closures_perm_seeded`): los roles que tienen `classes.manage` reciben `gym.closures`, para que nadie pierda lo que ya podía hacer. El rol de fábrica Administrador también lo recibe.
- **Correr vencimientos** toca las cuotas: la casilla aparece solo si la persona además tiene `fees.manage`. El servidor lo vuelve a comprobar.

### Hoja de cierre

Es la `ClosureSheet` actual ampliada. Se mueve a `frontend/src/views/admin/closures/`.

- **Fechas:** "Un día / Varios días", Desde / Hasta. De hoy en adelante, hasta 31 días, sin superponerse con otro cierre (las reglas actuales de `validateClosure`).
- **Motivo:** chips Feriado / Vacaciones / Mantenimiento, más texto libre de hasta 40 letras.
- **Impacto**, con vista previa en vivo:
  - "N días cerrado".
  - "Se suspenden N clases", solo con el módulo de clases prendido.
  - "N con reserva: se les avisa ahora", solo si hay reservas.
- **Avisar a todos los socios** (interruptor, prendido por defecto). Subtítulo: "N con la app · sale \<cuándo\>". Por ejemplo, "sale mañana a las 08:00" o "sale ahora".
- **Correr los vencimientos** (interruptor, apagado por defecto). Solo con cuotas prendido y el permiso `fees.manage`.
  - Campo N días: arranca en los días cerrados y admite de 1 a los días cerrados.
  - Subtítulo: "+N días a X socios al día o por vencer (y Y en prueba)".
- **Botón:** "Cerrar y avisar" si alguien recibe aviso; si no, "Cerrar". Cancelar.
- **PC (≥ 768 px):** panel centrado en dos columnas. A la izquierda fechas y motivo; a la derecha impacto e interruptores. Abajo a la derecha, Cancelar / Cerrar.

### Reabrir

Es la confirmación actual con dos agregados:

- Si se corrieron vencimientos: casilla **"Devolver los N días a X socios"**, prendida por defecto.
- Si el aviso general **todavía no salió**, se cancela. Ya no sale.
- Si ya salió y el cierre empezaba **hoy o mañana**: push a los mismos destinatarios, "Al final el gimnasio abre el lunes 12". Si era más adelante, no se avisa.
- Igual que hoy: las reservas canceladas no vuelven y las fijas se vuelven a reservar solas.

### Notificaciones

En **Admin → Notificaciones**, al lado de "Horario de avisos de cuota": **"Horario de avisos de cierre"** (`closure_notify_hour`, HH:MM, por defecto **08:00**). Lo cambia quien tiene `notifications.send`, igual que el de cuotas.

## Avisos al socio

### Push

- **Con reserva:** como hoy. `closurePush` sale **en el momento** de crear el cierre, porque se le cancela la reserva.
- **Aviso general** (si el interruptor está prendido). Va a todos los socios activos con suscripción push, **menos** los que ya recibieron el de reserva. Texto: "El gimnasio cierra el lunes 12" / "El gimnasio cierra del 24/12 al 2/1", con el motivo en el cuerpo. Al tocarlo abre el Inicio.
- **Cuándo sale el aviso general** (hora y fechas en `gym_tz`):
  - `announceAt` = la próxima vez que el reloj del gimnasio marque `closure_notify_hour` después de crear el cierre.
  - Si la fecha de `announceAt` es **posterior** al primer día del cierre, sale **en el momento**. Así un cierre para hoy no se avisa mañana.
  - Ejemplo: creado a las 23:00 para mañana, sale mañana a las 08:00. Creado a las 10:00 para hoy, sale en el momento.
- El scheduler (`api/scheduler.js`, en su tick) envía los avisos pendientes con `announceAt <= ahora`, una sola vez (`announced_at`). Si el servidor estuvo caído y el cierre ya terminó, no se envía.

### Cartel del día

- Al abrir la app **un día cerrado** aparece un cartel modal:
  - 🔒 "Hoy el gimnasio está cerrado".
  - "\<motivo\> · \<día\>".
  - "Puedes seguir usando la app: entrenar en casa o cargar tus comidas." Si hay clases: "Las clases de hoy se suspendieron."
  - Botón **Aceptar**.
- **"Ese día" es la fecha del gimnasio que manda el servidor** (`today` en gym_tz), nunca el reloj del celular.
- Sale una vez por cierre y por día. Se recuerda en el celular con la clave `closure-seen:<closureId>:<fecha>` (localStorage, con try/catch). En un cierre de varios días sale cada día.
- Se evalúa al iniciar la app y al volver a primer plano (`visibilitychange`). No sale si el cierre se reabrió. No interrumpe un entreno en curso: con uno activo, espera a que termine.

### Inicio

- **Tarjeta de aviso** arriba (naranja, 🔒).
  - Contenido: "El lunes 12 el gimnasio cierra" / "El gimnasio cierra del 24/12 al 2/1", con el motivo debajo.
  - Aparece desde **7 días antes** del primer día hasta el último día cerrado.
  - Con ✕ se oculta (clave `closure-banner-hidden:<closureId>`). Durante los días del cierre vuelve como "Hoy el gimnasio está cerrado".
  - Si hay dos cierres cerca, se muestra el más próximo.
- **Línea en "Esta semana"**, cuando la semana que se ve tiene días cerrados. Ejemplo: "🔒 Lunes 12 cerrado · Feriado. Esta semana tu objetivo es 3." Si la semana queda congelada: "Semana cerrada: tu racha queda en pausa."
- **Fila de "hoy"** en un día cerrado: la rutina planificada sigue a mano, con "Hoy el gimnasio está cerrado" arriba. Se puede empezar igual.

### Tira de la semana, calendario y hoja del día

- **Día cerrado:** fondo rayado con 🔒 y **sin** el punto de "planificado". Si ese día se entrenó igual, se ve verde como siempre.
- **Calendario:** en la columna de la semana, una semana congelada muestra 🔒 en lugar de la llama.
- **Hoja del día (`DaySheet`):** el aviso "El gimnasio está cerrado · motivo" que ya existe ahora sale también sin el módulo de clases.
- **Hoja de la racha:** explica el objetivo reducido o la pausa de la semana.

## Racha semanal con días cerrados

Lo que se decidió (opción A): **los días cerrados se descuentan del objetivo**.

### Definiciones

- **Objetivo de la semana (sin cierres):** el que ya calcula `weeklyTarget`. Es el estampado en el primer entreno de la semana (`weekTarget`) o, si no hay, el del plan, contando grupos de rutinas.
- **Plan de la semana:** los días de la semana con rutina en el plan que usa `evalWeek`. Es el `week` del grupo de la semana si se identifica; si no, `S.week`.
- **Días planificados cerrados:** las fechas de la semana (lunes a domingo) que están dentro de un cierre **y** cuyo día de la semana tiene rutina en el plan de la semana.

### Regla

```
objetivoAjustado = max(0, objetivo − díasPlanificadosCerrados)
```

- **Semana congelada:** `objetivo > 0` y `objetivoAjustado === 0`, es decir, todos los días planificados de la semana cayeron en días cerrados.
  - Si en esa semana **no** se entrenó: la semana **no suma ni corta** la racha. `streakWeeks` la salta y sigue mirando la semana anterior.
  - Si se entrenó al menos un día (en casa, por ejemplo): **cuenta como cumplida** y suma, igual que hoy una semana con objetivo 0 y algún entreno.
- **Semana con objetivo reducido** (`objetivoAjustado > 0`): se cumple con `díasEntrenados >= objetivoAjustado`. Los días entrenados se cuentan como hoy: días distintos con algún workout, clases incluidas. Un entreno en un día cerrado cuenta normal.
- **Semana sin plan** (`objetivo === 0`): sin cambios. Los cierres no la afectan.
- **Semana actual:**
  - Congelada y sin entrenar: no suma, y la racha muestra la de las semanas anteriores.
  - Con objetivo reducido: se cumple al llegar al objetivo ajustado.

### Ejemplos (plan de 4 días: lunes, martes, jueves y viernes)

| Cierre | Días planificados cerrados | Objetivo | Entrenó | Resultado |
|---|---|---|---|---|
| Lunes feriado | 1 | 3 | 3 días | cumplida, suma |
| Lunes feriado | 1 | 3 | 2 días | no cumplida, corta |
| Lunes a viernes | 4 | 0 | nada | congelada, no suma ni corta |
| Lunes a viernes | 4 | 0 | 1 día en casa | cumplida, suma |
| Sábado (no planificado) | 0 | 4 | — | igual que siempre |

### Dónde se aplica

- `lib/history.js`:
  - `evalWeek`, `streakWeeks` y la mejor racha (`bestStreak`) reciben los cierres (`closures`, lista `{ from, to }`).
  - `evalWeek` devuelve además `objetivoBase`, `cerradosPlanificados` y `congelada`.
  - `streakWeeks` y la mejor racha saltan las semanas congeladas sin entrenos (no reinician la cuenta).
- El descuento se calcula **al evaluar**, no se estampa. Crear o reabrir un cierre corrige la racha al instante, también hacia atrás.
- Se aplica en Inicio, calendario, Stats, hoja de la racha y en la adherencia que ve el profe (`weekAdherence`, `views/admin/shared.jsx`). Ahí los días cerrados no se cuentan como esperados.
- **Limitación aceptada:** para semanas viejas cuyo plan cambió después, los días planificados se toman del plan que `evalWeek` ya usa para esa semana (el del grupo identificado o el `S.week` actual). Puede no coincidir exactamente con el plan de aquel momento. Es la misma aproximación que `evalWeek` hace hoy con los días.

## Cuotas: correr los vencimientos

- **Quiénes entran:**
  - Socios activos, con plan, que no estén exentos de cuota, en estado **al día** o **por vencer** (`billingStatus`) el día que se crea el cierre: se les corre `due_date`.
  - Socios **en prueba** vigente: se les corre `trial_until`.
  - Los vencidos y bloqueados no se tocan: debían antes del cierre.
- Cada extensión queda registrada por socio en la tabla nueva `closure_extensions`: `closure_id`, `user_id`, `field` (`due` | `trial`), `days`, `before`, `after`, `applied_at`, `reverted_at`.
- **Reabrir con "Devolver los días":** a cada extensión no revertida se le resta `days` al valor **actual** del campo (no se restaura `before`). Así se respetan los pagos posteriores. Se omite si el socio ya no tiene plan o prueba. Se marca `reverted_at`.
- **Anular un pago:** extensiones aplicadas **después** del pago y no revertidas = E días.
  - Se acepta la anulación si `current.dueDate === payment.periodEnd + E`. Hoy exige igualdad estricta y la extensión la bloquearía.
  - El vencimiento vuelve a `previousDueDate + E`, o a la prueba `previousTrialUntil + E`.
- Con cuotas apagado, la casilla no aparece y no se escribe nada.
- La auditoría registra cuántos socios y cuántos días: "vencimientos +10 días a 48 socios".

## Check-in

Sin cambios. La pantalla de ingreso **registra normal** en un día cerrado: si hay alguien en la puerta usando el kiosco, el gimnasio está abierto (un feriado en que el dueño abre medio día).

## Datos y API

### Base de datos (sin renombrar tablas)

- `class_closures` suma columnas, cada una con `ALTER TABLE` en try/catch, como el resto de `classes-db.js`:
  - `notify_all INTEGER NOT NULL DEFAULT 0`;
  - `announce_at INTEGER` (epoch ms);
  - `announced_at INTEGER`;
  - `notified_ids TEXT` (JSON de los IDs que recibieron push de reserva, para excluirlos del aviso general y saber a quién avisar al reabrir);
  - `extend_days INTEGER`.
- Tabla nueva `closure_extensions` (arriba).
- Setting `closure_notify_hour` en la tabla de settings de admin, por defecto `08:00`.

### Módulo

- `api/closures.js` (puro):
  - `validateClosure`, que se mueve desde `classes.js` y se re-exporta allí para no romper importaciones;
  - `announceAtFor({ from, createdAt, notifyHour, tz })`;
  - la elegibilidad de extensión;
  - el cálculo de E para anular un pago.
- `api/closures-routes.js`: las rutas, con el patrón de `classes-routes.js`.
- El impacto en clases (`closureImpact`) sigue en `classes-routes.js` y lo usan las rutas nuevas cuando el módulo está prendido.

### Rutas

Reemplazan a `/api/admin/classes/closures*`, que se borran porque el frontend es el mismo repo.

| Ruta | Permiso | Qué hace |
|---|---|---|
| `GET /api/admin/closures` | `gym.closures`, `stats.view`, `classes.view_all` o `classes.attendance` | Cierres en curso y futuros, con su estado: avisados, aviso pendiente y extensión. |
| `GET /api/admin/closures/preview?from&to` | `gym.closures` | `{ days, classes?, booked, appMembers, announceAt, extend? }`. `extend` solo con cuotas prendido y `fees.manage`. |
| `POST /api/admin/closures` | `gym.closures` (+ `fees.manage` si `extendDays`) | Crea el cierre: cancela reservas, manda el push de reserva, programa el aviso general y aplica la extensión. Todo en una transacción, salvo los push. |
| `POST /api/admin/closures/delete` | `gym.closures` (+ `fees.manage` si `revert`) | Reabre: revierte la extensión si se pide, cancela o avisa según el caso. |
| `GET /api/closures` | socio con sesión | `{ today, closures }`: todos los cierres (pasados incluidos, para la racha), sin datos internos (solo `id`, `from`, `to`, `reason`). |

- `/api/classes` deja de mandar `closures`. El frontend los toma de `/api/closures`.
- **Auditoría:** eventos `gym.closure.add` y `gym.closure.delete`. Las etiquetas viejas `classes.closure.*` se conservan en `lib/audit.js` para los registros anteriores.

### Frontend

- `lib/closures.js`:
  - `closuresApi`;
  - `closureOn` y `closureLabel` (se mueven desde `lib/classes.js` y se re-exportan);
  - `plannedClosedDays(week, monday, closures)`;
  - `upcomingClosure(closures, today)`.
- **Estado:** un store chico `useClosures` (no persistido, fuera de `S`, que se sincroniza con el servidor). Se carga al iniciar la app y al volver a primer plano. `today` sale de ahí. No se guarda en `S`, para no subirlo con `PUT /api/data`.
- **Componentes:**
  - `components/closures/ClosureNotice.jsx`: el cartel modal;
  - `ClosureBanner.jsx`: la tarjeta del Inicio;
  - `views/admin/closures/ClosuresCard.jsx`: la tarjeta de Resumen;
  - `ClosureSheet.jsx`: movida y ampliada.
- Se tocan: `Home.jsx` (banner, línea de la semana, fila de hoy, puntos de la tira), `CalendarSheet` en `sheets.jsx` (días y semanas), `DaySheet.jsx` (cierres desde `useClosures`), `Stats.jsx`, la hoja de la racha, `views/admin/Resumen.jsx`, `views/admin/Clases.jsx`, `views/admin/Notificaciones.jsx` y `views/admin/shared.jsx` (adherencia).
- Textos en `locales/es.js`. Estilos en `index.css`: rayado de día cerrado, banner y cartel.

## Pruebas

- **API:**
  - `closures.test.js` (puro):
    - `announceAtFor`: antes y después de la hora, cierre hoy o mañana, cambio de día en gym_tz;
    - la elegibilidad de extensión: al día, por vencer, vencido, bloqueado, prueba y exento;
    - E para anular un pago.
  - `closures.http.test.js`:
    - permisos: sin `gym.closures` → 403; extender sin `fees.manage` → 403;
    - crear con y sin clases prendido;
    - la extensión escribe `closure_extensions` y corre `due_date` / `trial_until`;
    - reabrir revierte restando del valor actual (con un pago en el medio);
    - el aviso pendiente se cancela al reabrir;
    - `GET /api/closures` para socios, sin datos internos;
    - la migración del permiso.
  - `scheduler-closures.test.js`:
    - el aviso general sale una vez a su hora, excluye a los avisados por reserva y no sale para un cierre terminado.
  - Anular un pago con extensión posterior: se acepta y vuelve a `previous + E`.
- **Frontend:**
  - `history.test.js`:
    - los ejemplos de la tabla de racha;
    - semana congelada en medio de una racha (no la corta);
    - semana actual congelada;
    - mejor racha;
    - un entreno en un día cerrado cuenta.
  - Componentes:
    - el cartel sale con `today` del servidor (no del reloj), una vez por día, y no sale reabierto;
    - el banner desde 7 días antes y con ✕;
    - la línea de la semana;
    - la tira y el calendario sin el punto en un día cerrado;
    - la tarjeta de Resumen según el permiso;
    - la hoja con y sin cuotas o clases;
    - reabrir con "Devolver".
- **Navegador (dev):** crear un cierre para hoy y ver el cartel, la tira y el calendario. Un cierre de una semana completa y ver la racha. PC y celular, claro y oscuro.

## Fuera de alcance

- Bloquear o avisar en el check-in.
- Recordatorio push el mismo día del cierre (solo el aviso general).
- Historial de cierres pasados en Admin (la tarjeta muestra en curso y futuros; la auditoría guarda el resto).
- Horarios reducidos o cierres parciales (por ejemplo, "abre de 9 a 13"): un cierre es el día entero.
- Devolver las reservas canceladas al reabrir.
