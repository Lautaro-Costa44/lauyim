# HANDOFF.md

## Objetivo

Documentar el estado de `lauyim` y dejar preparado el proyecto para continuar la feature de administración por socio.

La feature buscada es un punto único en el panel Admin, **“Administrar Nutrición/Rutina”**, desde el que un administrador pueda gestionar, por usuario:

- metas nutricionales manuales: calorías, proteínas, grasas y carbohidratos;
- sugerencias de comida que recibe ese socio;
- días planificados, planes y rutinas;
- ejercicios, progresiones e intensificadores;
- lesiones y restricciones;
- advertencias al asignar manualmente ejercicios relacionados con una lesión.

También debe existir un control de activación de usuarios: un usuario desactivado no puede ser modificado en nutrición ni rutina; Admin/Owner puede desactivar y activar; solo Owner puede eliminar una cuenta previamente desactivada.

La intención es extender la arquitectura actual y mantener la estética y experiencia de la app.

## Estado

Auditoría y especificación conceptual completadas. **No se implementó todavía la nueva feature de Administración Nutrición/Rutina.** El árbol de trabajo estaba limpio al comenzar este handoff.

Ya existe infraestructura importante que debe reutilizarse:

- Perfil y estado persistente del socio en `user_state`; identidad/roles en `users`.
- Rutinas normalizadas mediante `routines`, `routine_exercises`, `week_plan` y `day_plan`.
- Nutrición existente, incluyendo cálculo TMB/TDEE, metas y registro de comidas.
- `plantillas_comida` y `plantillas_ingredientes` para las sugerencias/comidas.
- Sugerencias de comida ya visibles en `Nutricion.jsx`; la necesidad nueva es administrarlas por socio desde Admin.
- Lesiones ya recogidas por la encuesta y usadas por `generarRutina.js` para filtrar ejercicios.
- Metadatos anatómicos existentes: body part, target/muscle groups y `BodyMap`.
- Roles `Admin`/`Owner`, `requireAdmin()` y `requireOwner()`.
- Auditoría administrativa existente.
- SQLite con migraciones defensivas en `api/database.js`.

### Ciclo de vida de cuentas

Esta parte **ya está implementada** y debe conservarse:

- `users.disabled` existe.
- Un usuario desactivado no puede iniciar sesión/sincronizar.
- Admin puede desactivar/activar usuarios no administrativos mediante `POST /api/admin/user/disable`.
- Owner puede hacer lo mismo por ser administrador.
- Solo Owner puede eliminar una cuenta y el backend exige que esté desactivada.
- La eliminación permanente pasa por `deleteUser()` y mantiene la operación transaccional.
- El frontend ya muestra `Disable account`, `Enable account` y, para Owner, `Delete account permanently`.

La nueva administración de nutrición/rutina debe rechazar modificaciones sobre usuarios desactivados, incluso si el actor tiene permisos administrativos.

## Archivos

### Backend / persistencia

- `api/schema.sql` — esquema SQLite: `users`, `user_state`, rutinas, planes, comidas y plantillas.
- `api/database.js` — inicialización/migraciones SQLite, lectura/escritura de estado, usuarios, rutinas, planes y borrado de cuentas.
- `api/server.js` — autenticación/autorización, endpoints de Admin/Owner y endpoints de nutrición/comidas.
- `api/plantillas_globales.js` — plantillas globales de comida y mantenimiento de sus datos.
- `api/sync.js` — sincronización de comidas y plantillas del usuario.
- `api/scheduler.js` — procesos/notificaciones que pueden consumir estado del usuario.

### Frontend

- `frontend/src/views/Admin.jsx` — panel administrativo; punto de entrada para `Administrar Nutrición/Rutina`.
- `frontend/src/views/Nutricion.jsx` — UI nutricional actual que debe mantenerse como referencia visual y funcional.
- `frontend/src/views/RoutineEdit.jsx` — editor de rutinas existente; reutilizar su lógica/modelo, evitando duplicarlo.
- `frontend/src/lib/nutricion.js` — cálculo actual de metas nutricionales.
- `frontend/src/lib/calories.js` — TMB/TDEE.
- `frontend/src/lib/generarRutina.js` — generación y exclusión por lesiones.
- `frontend/src/lib/exercises.js` — catálogo, body parts y metadatos de ejercicios.
- `frontend/src/lib/muscles.js` — resolución/carga muscular.
- `frontend/src/lib/body-paths.js` — anatomía del `BodyMap`.
- `frontend/src/locales/body-parts-es.js` — traducciones/alias anatómicos.
- `frontend/src/components/BodyMap.jsx` — visualización anatómica.
- `frontend/src/lib/audit.js` — etiquetas/eventos de auditoría del frontend.

## Reglas

### Nutrición

Separar dos conceptos: **metas nutricionales** y **sugerencias de comida**.

Para metas, mantener un único cálculo automático y añadir un override explícito, conceptualmente:

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

En `manual`, los valores administrados prevalecen sobre el cálculo automático. Volver a `automatic` restaura el cálculo existente.

Para sugerencias, no crear otro sistema de comidas. Extender `plantillas_comida`/su asociación para distinguir alcance, activación, orden y quién realizó una asignación. La prioridad propuesta es:

```text
administradas al socio
        ↓
personalizadas del socio
        ↓
globales
        ↓
automáticas
```

La configuración de fallback automático debe ser controlable por `.env`, siguiendo el patrón ya existente para la encuesta. Variable propuesta:

```text
NUTRITION_AUTO_SUGGESTIONS_ENABLED=false
```

Si las sugerencias están administradas manualmente, no deben aparecer globales/automáticas por accidente cuando el fallback esté desactivado.

### Rutinas

Reutilizar el modelo existente:

```text
routines
routine_exercises
week_plan
day_plan
```

El panel administrativo debe permitir modificar días planeados, crear/editar/eliminar planes y rutinas, y ajustar ejercicios, progresiones e intensificadores sin copiar una segunda implementación de `RoutineEdit.jsx`.

### Lesiones

Mantener el flujo existente de generación automática y agregar una capa de advertencia para la edición administrativa manual:

```text
lesión → body part → músculos/metadatos → ejercicio → advertencia
```

No crear un catálogo anatómico paralelo. Reutilizar `ex.bp`, `ex.mg`, `ex.sm`, `tg`, `BodyMap`, `muscles.js` y la lógica existente de `generarRutina.js`.

Al asignar manualmente un ejercicio relacionado con una lesión, mostrar advertencia y permitir una confirmación explícita. Una asignación forzada debe quedar auditada.

### Permisos

- Admin: administrar contenido de socios según las reglas administrativas existentes.
- Owner: conserva capacidades de Admin y las operaciones exclusivas de Owner.
- Usuario normal: no puede administrar a otro usuario.
- No usar un `PUT /api/data` genérico para estas operaciones administrativas; preferir endpoints específicos y validados.
- Usuario desactivado: no puede ser modificado en nutrición ni rutina.
- Admin/Owner: pueden desactivar y activar usuarios permitidos.
- Solo Owner: puede eliminar una cuenta desactivada.

### Auditoría

Las mutaciones administrativas deben registrar actor, usuario objetivo, acción, entidad y cambio relevante (`before`/`after`) cuando corresponda. Acciones esperadas incluyen metas nutricionales, sugerencias, rutinas, ejercicios, planes y lesiones.

## Siguiente paso

Convertir esta especificación en una implementación incremental y verificable, en este orden:

1. Revisar/migrar el esquema para `nutrition_goals` y metadatos de asignación de sugerencias.
2. Implementar endpoints administrativos específicos de nutrición y sugerencias, con permisos y bloqueo de usuarios desactivados.
3. Integrar la precedencia de sugerencias y `NUTRITION_AUTO_SUGGESTIONS_ENABLED` sin romper `Nutricion.jsx`.
4. Integrar metas manuales en `calcularMetasNutricionales()` manteniendo el cálculo automático intacto.
5. Añadir `Administrar Nutrición/Rutina` a `Admin.jsx`, reutilizando componentes y estilos existentes.
6. Extender la edición administrativa de rutinas sobre el modelo actual.
7. Añadir edición administrativa de lesiones y advertencias ejercicio↔lesión.
8. Completar auditoría de todas las mutaciones.
9. Añadir tests de DB, API, nutrición, rutinas, permisos, usuarios desactivados y lesiones.
10. Probar con la configuración automática de sugerencias desactivada y activar progresivamente después de validar el flujo administrado.

### Criterios de aceptación clave

- Un Admin puede abrir un socio y entrar a `Administrar Nutrición/Rutina`.
- Puede fijar/revertir metas nutricionales manuales.
- Puede elegir, crear, editar, ordenar, activar/desactivar y quitar sugerencias de ese socio.
- Las sugerencias mostradas al socio respetan la precedencia y el flag de `.env`.
- Puede administrar planes/rutinas/días/ejercicios/progresiones/intensificadores usando el modelo existente.
- Puede agregar/quitar lesiones y recibe advertencia al intentar asignar ejercicios relacionados.
- Un socio desactivado no puede ser modificado desde estas herramientas.
- Admin/Owner pueden activar/desactivar; solo Owner puede eliminar una cuenta desactivada.
- Las operaciones administrativas importantes quedan auditadas.
- La vista del socio mantiene la estética y el flujo actual de `Nutricion`/entrenamiento.
