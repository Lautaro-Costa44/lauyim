# Clases, entrega 4, parte C: plan

Spec: `docs/superpowers/specs/2026-10-02-clases-entrega-4-design.md`, sección Parte C.
Rama: `feat/clases-4`. En cada tarea se escriben los tests primero.

## Tarea 1: el plan guarda el límite

- `database.js`:
  - `ALTER TABLE plans ADD COLUMN class_limit INTEGER` y `class_period TEXT`, con migración
    tolerante.
  - `planFromRow` suma `classLimit` y `classPeriod`.
  - `createPlan` y `updatePlan` los aceptan.
- `server.js`, `parsePlanBody`:
  - `classLimit` es `null` (libre) o un entero de 1 a 31.
  - `classPeriod` es `'week'` o `'month'` y es obligatorio si hay límite.
  - En la edición (parcial) se pueden mandar.
  - `planSummary` suma "· 2 clases por semana".
- Tests: `billing-plans` (HTTP) o el archivo de planes que exista.

## Tarea 2: el límite al reservar (API)

- `classes.js`:
  - `periodRange(date, period)` devuelve `{ from, to }`: lunes a lunes, o del día 1 al día 1 del
    mes siguiente.
  - `PLAN_COUNTED`: los estados que consumen una clase.
  - `planUsed(bookings, range)`.
- `classes-routes.js`:
  - `planLimitOf(userId)`: devuelve el límite si Cuotas está prendido y el socio tiene un plan con
    límite; si no, `null`.
  - `planCheck(userId, date)` devuelve `{ limit, period, used }` o `null`.
  - `book`: si no tiene ya una reserva activa en esa fecha y llegó al límite, `403 plan_limit
    { limit, period, used }`.
  - `book-week`: reserva hasta el límite y devuelve `limited` (cuántas quedaron afuera).
  - `materializeRecurring`: si llegó al límite, no reserva y avisa una vez
    (`noticeOnce(..., 'plan_limit')`) con `classChangePush('plan_limit', { limit, period })`.
  - `sessions/add` (staff): reserva igual y devuelve `overLimit` y `planLimit`.
  - `GET /api/classes`: `planLimit: { limit, period, used: { [inicio del período]: n } }` para los
    períodos de la ventana.
- `push-messages.js`: el texto "plan_limit": "No pudimos anotarte. Tu reserva fija de Spinning del
  lunes 5 no se hizo: tu plan incluye 2 clases por semana y esa semana ya tenés 2."
- Tests:
  - `classes.test.js`: los períodos (domingo y lunes, fin de mes) y el conteo.
  - `classes-member.http.test.js`:
    - el bloqueo;
    - que la cancelación a tiempo devuelve la clase;
    - `planLimit` en la lista;
    - `book-week` parcial;
    - el staff con `overLimit`.
  - `scheduler-classes.test.js`: la reserva fija con aviso.

## Tarea 3: pantallas

- `lib/classes.js`:
  - `periodStart(date, period)`.
  - `markPlanFull(occurrences, planLimit, today)`: marca `planFull` en las fechas abiertas, sin
    reserva propia, de períodos ya completos.
  - `planLine(planLimit, date, today)` devuelve el texto de la línea.
  - `buttonState` da `planFull`, que muestra "Límite del plan" apagado.
  - `weekBookable` excluye las fechas con `planFull`.
- `views/Clases.jsx`: la línea "Te quedan 1 de 2 clases esta semana" arriba de la lista, y los
  botones apagados.
- `ClassSheet.jsx`:
  - El botón principal apagado con "Límite del plan".
  - Al reservar con `plan_limit`, el texto con los números.
  - "Anotarme a todas" avisa las que quedaron afuera.
- `SessionSheet.jsx`: al anotar a mano con `overLimit`, avisa "Anotado. Pasa el límite de su plan
  (2 por semana)".
- `PlansSheet.jsx`:
  - "Clases incluidas" con Libre / Por semana / Por mes y el número.
  - En la lista se lee "· 2 clases por semana".
- `errors.js`: `plan_limit`.
- Tests: lib, Clases (línea y botón apagado), PlansSheet (guardar con límite).

## Cierre

- Suites completas, build y `check-locales`.
- En el navegador: el plan con límite, la línea del socio, el bloqueo y anotar a mano.
- Commit por tarea y push.
