# Prompt para Codex — Administración de Nutrición, Rutina y Lesiones por socio (lauyim)

## Contexto

Estás trabajando sobre **lauyim** (siempre en minúscula — nunca "Lauyim App" ni "Lauyim Gym"), un fork de openGym: React + Vite + Zustand en frontend, Node.js nativo (`node:http`, `node:sqlite`) en backend, SQLite como base de datos. Esta feature nace de conversaciones directas con un cliente real y debe respetar exactamente las reglas de abajo.

**Antes de escribir código en cualquier fase: hacé una auditoría del código relevante a esa fase específica y mostrame el plan (archivos a tocar, diffs propuestos) antes de aplicar cambios.** No asumas nombres de funciones/columnas sin verificarlos primero en el repo.

---

## Reglas no negociables (aplican a todas las fases)

1. **Prioridad total del admin**: si un administrador configuró metas nutricionales manuales y/o asignó sugerencias de comida a un socio, esas configuraciones son la única fuente que ve el socio — no hay merge ni fallback automático a sugerencias globales o cálculo automático. Si el admin **no** configuró nada para ese socio, el comportamiento actual (automático/global) sigue exactamente igual que hoy.
2. **No implementar optimistic locking ni campos de versión** para concurrencia — el control de versiones del código se maneja con git, no hace falta a nivel de filas de la base.
3. **El socio no debe ver ningún indicio de que sus metas/sugerencias fueron configuradas por un admin.** No agregues mensajes, badges ni textos tipo "configurado por tu entrenador". El socio hoy no tiene botón de editar sus metas nutricionales — que siga así.
4. **Usuario desactivado**: esta función YA EXISTE (admin y owner pueden desactivar/activar; solo owner elimina una cuenta desactivada) — no la reimplementes ni cambies su UI. Sí asegurate de que **todos los endpoints nuevos** (nutrición admin, rutina admin, lesiones admin) verifiquen que el socio objetivo esté activo antes de permitir modificaciones; si está desactivado, devolvé 409/403 con mensaje claro. Implementá este chequeo como una única función/middleware reutilizable, no repetido copy-paste en cada handler.
5. **Reutilizar, no duplicar sistemas**: usá las tablas, funciones y componentes ya existentes (`plantillas_comida`, `plantillas_ingredientes`, `user_state`, `routines`, `routine_exercises`, `week_plan`, `day_plan`, `requireAdmin()`, `requireOwner()`, `getUserState()`, `saveUserState()`, `calcularMetasNutricionales()`, `generarRutina.js`, `RoutineEdit.jsx`, `BodyMap`, metadata de ejercicios). No crees un catálogo ni una arquitectura paralela.
6. **Permisos**: Admin y Owner tienen los mismos permisos para todo lo de esta feature (nutrición, rutinas, lesiones de un socio). Las diferencias Admin/Owner que ya existen para otras cosas (roles, borrado de cuentas desactivadas) no cambian.
7. **Auditoría**: toda mutación administrativa debe quedar registrada con actor, socio objetivo, acción, entidad, estado antes/después y timestamp. Reutilizá el sistema de auditoría existente si ya hay uno; si no, creá una tabla simple y centralizá el logging en una sola función.
8. Verificá permisos y estado del socio **siempre en el backend**, nunca confíes solo en ocultar botones en el frontend.

---

## Fase 1 — Migración de base de datos

**La migración tiene que aplicarse sola al levantar el contenedor (`docker compose up`), sin ejecutar ningún script manual.** Seguí exactamente el patrón que ya usa el proyecto en `initDatabase()` (`api/database.js`): ALTER TABLE envueltos en try/catch que se auto-aplican al iniciar la API, igual que las migraciones de columnas existentes. No agregues un script nuevo ni un paso de deploy adicional — todo debe entrar dentro de `initDatabase()` (o la función equivalente que corre en el arranque).

Agregar (con migraciones idempotentes, sin romper datos existentes):

- `plantillas_comida.scope` TEXT NOT NULL DEFAULT `'user'` — valores: `user` | `global` | `admin`
- `plantillas_comida.enabled` INTEGER NOT NULL DEFAULT 1
- `plantillas_comida.position` INTEGER NOT NULL DEFAULT 0
- `plantillas_comida.assigned_by` TEXT (nullable) — id del admin que asignó/creó la sugerencia
- `user_state.nutrition_goals` TEXT (JSON, nullable) con esta forma:
  ```json
  {
    "mode": "automatic",
    "calories": null,
    "protein": null,
    "carbs": null,
    "fat": null,
    "updatedAt": null,
    "updatedBy": null
  }
  ```
- Tabla de auditoría (si no existe ya una genérica de admin actions): `admin_audit_log` con columnas `id, actor_user_id, target_user_id, action, entity_id, before_json, after_json, created_at`.

**Criterio de aceptación**: levantar el contenedor (`docker compose up`) sobre una copia de la DB de producción existente no debe alterar ni perder ninguna fila; las columnas/tabla nuevas quedan creadas solas con sus defaults, sin correr nada a mano. Probar dos veces seguidas (arrancar, apagar, arrancar de nuevo) para confirmar que las `ALTER TABLE`/`CREATE TABLE IF NOT EXISTS` son idempotentes y no tiran error en el segundo arranque.

---

## Fase 2 — Backend: endpoints de nutrición

Crear bajo `requireAdmin()` + chequeo de socio activo:

```
GET    /api/admin/users/:userId/nutrition
PUT    /api/admin/users/:userId/nutrition/goals
GET    /api/admin/users/:userId/nutrition/suggestions
POST   /api/admin/users/:userId/nutrition/suggestions            # asignar plantilla existente
POST   /api/admin/users/:userId/nutrition/suggestions/custom     # crear plantilla nueva para ese socio
PUT    /api/admin/users/:userId/nutrition/suggestions/:id
PATCH  /api/admin/users/:userId/nutrition/suggestions/:id        # { enabled: bool }
DELETE /api/admin/users/:userId/nutrition/suggestions/:id        # desasigna, NO borra plantillas global
```

- `PUT .../goals` con `{ mode: "manual", calories, protein, carbs, fat }` o `{ mode: "automatic" }` (limpia el override).
- Validar que los macros sean números positivos razonables antes de guardar.
- `DELETE` de una sugerencia asignada debe quitar la asociación al socio, nunca eliminar una plantilla `scope=global`.
- Cada operación de escritura genera una fila en `admin_audit_log` con la acción correspondiente (ver lista de acciones en Fase 8).

---

## Fase 3 — Motor de precedencia

Modificar el endpoint que hoy sirve `/api/plantillas?categoria=fitness&franja=...` (el que consume `Nutricion.jsx`) para que:

1. Busque primero si el socio tiene plantillas con `scope='admin'` y `enabled=1` asignadas.
2. Si existen → devolver **únicamente esas**, ordenadas por `position`. No mezclar con globales ni con lo automático.
3. Si no existen → comportamiento actual sin cambios (globales + lo que ya hacía).

Esto reemplaza cualquier lógica de cascada de varios niveles: es un simple "¿hay algo asignado por admin? sí → eso y solo eso. No → como hoy".

---

## Fase 4 — UI administrativa: sección Nutrición

En `Admin.jsx`, dentro del detalle de un socio, agregar botón/sección **"Administrar Nutrición/Rutina"** con una pestaña de Nutrición que:

- Reutilice los componentes visuales que ya existen en `Nutricion.jsx` (no rehacer el diseño desde cero).
- Muestre el toggle automático/manual y, si es manual, inputs para calorías/proteína/carbohidratos/grasas.
- Liste las sugerencias asignadas (editar, desactivar, reordenar, quitar) y un selector para agregar desde plantillas globales/existentes o crear una nueva.
- Todo con la estética ya definida de la app (mismos componentes `Button`, `Row`, `SelectRow`, sheets, etc.).

---

## Fase 5 — Integrar metas manuales en el cálculo

Modificar `calcularMetasNutricionales()` (en `nutricion.js`) para que, antes de calcular automáticamente, consulte `user_state.nutrition_goals`:

- Si `mode === 'manual'` → devolver los valores manuales en el mismo shape de salida que hoy usa el resto de la app (no rompas el contrato de la función).
- Si `mode === 'automatic'` o no existe → comportamiento actual, sin cambios.

Verificar que `HistorialNutricion.jsx` y cualquier otra vista que recalcule metas pase por esta misma función (fuente única).

---

## Fase 6 — UI y backend administrativo de rutinas

Extender `Admin.jsx` para permitir, sobre el socio seleccionado:

- Crear / editar / eliminar rutinas.
- Modificar días asignados (`week_plan`, `day_plan`).
- Modificar ejercicios, series, reps, progresiones, intensificadores (reutilizando el modelo de `routine_exercises`).

Backend: endpoints `admin/users/:userId/routines...` equivalentes a los que ya usa el propio socio en `RoutineEdit.jsx`, pero protegidos con `requireAdmin()` y el chequeo de socio activo. **No copiar y pegar la lógica de `RoutineEdit.jsx`** — extraé la lógica compartida a funciones reutilizables si hace falta, y que la UI admin reutilice esos mismos componentes de edición pasándoles el `userId` objetivo.

---

## Fase 7 — Lesiones y advertencias

- Agregar a la UI admin la posibilidad de ver, agregar y quitar lesiones del socio (reutilizando la lista anatómica que ya existe en `SurveyWizard.jsx` y el storage en `respuestasEncuesta.lesiones`).
- Al asignar/modificar manualmente un ejercicio en la rutina de un socio (Fase 6), si el ejercicio afecta un `body-part` marcado como lesionado, mostrar advertencia:
  ```
  ⚠ Este ejercicio trabaja: <músculos/body-parts>
  El socio tiene registrada una lesión relacionada con esta zona.
  [Cancelar]  [Asignar igualmente]
  ```
- Reutilizar `ex.bp`, `ex.mg`, `ex.sm`, `BodyMap`, `MUSCLE_NAME` y la lógica de exclusión ya usada en `generarRutina.js` — no crear un catálogo de músculos paralelo.
- Si el admin fuerza la asignación igual, debe quedar registrado en `admin_audit_log`.
- **No modificar** la lógica preventiva actual del generador automático de rutinas — esta fase solo agrega la advertencia en el flujo manual, no reemplaza nada existente.

---

## Fase 8 — Auditoría

Centralizar el registro de todas las acciones administrativas de esta feature en una sola función helper. Acciones mínimas a loguear:

```
nutrition.goals.update
nutrition.suggestion.create
nutrition.suggestion.update
nutrition.suggestion.assign
nutrition.suggestion.remove
nutrition.suggestion.enable
routine.create
routine.update
routine.delete
routine.exercise.add
routine.exercise.update
routine.exercise.remove
routine.plan.update
injury.update
injury.exercise_warning.override
```

---

## Fase 9 — Tests

- **DB**: migración sobre DB existente sin pérdida de datos; defaults correctos; `nutrition_goals` con JSON válido; plantillas `user/global/admin` conviven sin conflicto; desasignar no borra plantilla global.
- **API**: admin puede modificar; usuario normal recibe 403; usuario no puede modificar a otro usuario; intento de modificar un socio desactivado devuelve error; validación de macros; no se puede asignar plantilla inexistente; cada mutación genera fila de auditoría.
- **Nutrición**: modo automático da exactamente los valores actuales (regresión); modo manual sustituye los valores configurados y nada más; volver a automático restaura el cálculo; con sugerencias admin asignadas, la vista del socio muestra únicamente esas (no mezcla con globales).
- **Rutinas**: creación/edición/eliminación administrativa; reordenamiento; ejercicios; progresiones; plan semanal y diario correctos.
- **Lesiones**: lesión → body-part → ejercicio compatible sin warning; ejercicio incompatible con warning; admin fuerza asignación → permitido y auditado; el generador automático de rutinas mantiene su exclusión preventiva sin cambios.

Corré primero la suite existente (`api/database.test.js`, `api/*.test.js`, tests de frontend) para confirmar que nada se rompió, y después agregá los tests nuevos de arriba.

---

## Fase 10 — Activación gradual

- Agregar `NUTRITION_AUTO_SUGGESTIONS_ENABLED` al `.env` (mismo patrón que `SURVEY_ENABLED`), controlando únicamente el fallback automático cuando el admin no asignó nada — no afecta la prioridad total del admin cuando sí asignó algo.
- Desplegar primero en `dev.lauyim.online`, validar manualmente con un socio de prueba, y recién después promover a producción.

---

## Formato de entrega esperado por fase

Para cada fase: (1) resumen de qué archivos vas a tocar, (2) diff propuesto, (3) cómo lo probaste o cómo debería probarse manualmente. No avances a la fase siguiente sin confirmación.
