# Prompt — Correcciones y ampliación de "Administrar Nutrición/Rutina" (lauyim)

## Contexto

Estás trabajando sobre **lauyim** (siempre minúscula — nunca "Lauyim App" ni "Lauyim Gym"): React + Vite + Zustand en frontend, Node.js nativo (`node:http`, `node:sqlite`) en backend, SQLite.

Las fases 1 a 6 de la feature "Administrar Nutrición/Rutina" **ya están implementadas**. Esta tarea es corregir y completar lo que quedó mal o incompleto según feedback visual del cliente. **No rehagas la feature desde cero: auditá lo que ya existe, reutilizá los componentes y vistas actuales y adaptalos.**

**Antes de escribir código: auditá los archivos involucrados y mostrame el plan (archivos a tocar + diff propuesto). Esperá confirmación antes de aplicar.**

---

## Reglas no negociables (siguen vigentes)

1. **Prioridad total del admin**: lo que el admin configura para un socio es la única fuente de verdad que ve ese socio. Sin merge ni fallback con globales/automático cuando hay algo configurado.
2. **No implementar optimistic locking ni campos de versión** — el versionado se maneja con git.
3. **El socio no debe ver ningún indicio de que su configuración fue cargada por un admin.** Sin badges, sin mensajes tipo "configurado por tu entrenador". El socio no tiene botón de editar sus metas — que siga así.
4. **Usuario desactivado**: la función ya existe, no la toques ni borres sus botones. Todos los endpoints admin de esta feature deben rechazar modificaciones sobre un socio desactivado (chequeo centralizado en una sola función, no copy-paste).
5. **Migraciones automáticas**: cualquier columna/tabla nueva se aplica sola al levantar el contenedor, dentro de `initDatabase()` en `api/database.js`, con el patrón try/catch ALTER TABLE ya usado en el proyecto. Sin scripts manuales, sin pasos de deploy extra, idempotente (arrancar dos veces seguidas no debe fallar).
6. **Reutilizar, no duplicar**: `plantillas_comida`, `plantillas_ingredientes`, `user_state`, `routines`, `routine_exercises`, `week_plan`, `day_plan`, `requireAdmin()`, `requireOwner()`, `calcularMetasNutricionales()`, `generarRutina.js`, `RoutineEdit.jsx`, `BodyMap`, el selector de músculos de `SurveyWizard.jsx`, y los componentes de UI existentes (`Button`, `Row`, `SelectRow`, sheets). Nada de catálogos ni arquitecturas paralelas.
7. **Estética**: todo debe respetar el diseño actual de la app (tema oscuro, acento rojo, mismos componentes y espaciados). No introduzcas estilos nuevos.
8. **Auditoría**: toda mutación administrativa se registra (actor, socio, acción, entidad, antes/después, timestamp) mediante el helper centralizado ya existente.

---

## Parte A — Pestaña NUTRICIÓN

### A.1 Tipografía / jerarquía

- El nombre del socio bajo el título ("santiago miano") debe ser **más grande** y legible — hoy es demasiado chico y de bajo contraste.
- Los títulos de sección ("Metas nutricionales", "Comidas sugeridas personalizadas") deben ser **más grandes**, con jerarquía clara respecto al contenido.

### A.2 Toggle "Modo manual" → reemplazar por lógica controlada por `.env`

El toggle actual **no funciona y hay que sacarlo tal como está**. Se reemplaza por este comportamiento, controlado por una variable nueva en `.env`:

**Crear `NUTRICION_AUTOMATICO`** (mismo patrón de exposición que `SURVEY_ENABLED`: se lee en backend y se entrega al frontend como configuración pública).

- `NUTRICION_AUTOMATICO=0` → **no se muestra ningún toggle**. El modo es siempre manual: los socios dependen de que el admin les cargue las metas. Si el admin no cargó nada, el socio no ve metas calculadas automáticamente.
- `NUTRICION_AUTOMATICO=1` → **aparece el toggle**, etiquetado como cálculo automático, y viene **activado por defecto** (comportamiento actual: las metas se calculan solas). El admin puede desactivarlo para ese socio y cargar valores manuales.

**Esta es la única variable del módulo de nutrición**: controla tanto las metas como las sugerencias automáticas de comida. En una planificación anterior se había mencionado `NUTRITION_AUTO_SUGGESTIONS_ENABLED` — esa variable **nunca llegó a implementarse**. Verificá si quedó algún resto de ella en el código (`.env.example`, backend, frontend) y, si existe, eliminá esos restos y unificá todo bajo `NUTRICION_AUTOMATICO`. Documentala en `.env.example`.

Comportamiento de `NUTRICION_AUTOMATICO` sobre **sugerencias de comida**:
- `=0` → el socio ve únicamente las sugerencias que le asignó el admin. Si no tiene ninguna asignada, no ve sugerencias (no aparecen las plantillas globales).
- `=1` → si el socio no tiene sugerencias asignadas por el admin, sigue viendo las plantillas globales como hoy. Si sí las tiene, prevalecen las del admin (prioridad total, sin merge).

### A.3 Zona de configuración de metas

Debajo de "Metas nutricionales" (donde hoy está el toggle roto) va el formulario de metas. **Todos los campos arrancan vacíos por defecto** (sin valores precargados ni placeholders con números):

| Campo | Tipo |
|---|---|
| Objetivo | select: perder grasa / ganar músculo / ganar fuerza / fitness general |
| Kcalorías a quemar | numérico |
| Kcalorías a consumir | numérico |
| Proteínas a consumir (gramos) | numérico |
| Carbohidratos a consumir (gramos) | numérico |
| Grasas a consumir (gramos) | numérico |

- Los valores se persisten en `user_state.nutrition_goals` (ampliá el JSON con `objetivo` y `caloriesBurn` si aún no existen esos campos — recordá que la migración va en `initDatabase()`).
- Validar en backend que los numéricos sean positivos y razonables; campo vacío = `null`, no `0`.
- Si el socio tiene metas manuales cargadas, `calcularMetasNutricionales()` debe devolverlas en lugar del cálculo automático, respetando el shape de salida actual para no romper `Nutricion.jsx` ni `HistorialNutricion.jsx`.

### A.4 Sección "Comidas sugeridas personalizadas"

Va **después** del bloque de metas, con un separador visual.

**Caso sin sugerencias cargadas:**
```
Comidas sugeridas personalizadas
  Sin sugerencias asignadas
  [+ Agregar sugerencia]
```

**Caso con sugerencias cargadas** — agrupadas por franja (Desayuno, Almuerzo, Merienda, Cena, Extra), mostrando solo las franjas que tengan comidas:
```
Comidas sugeridas personalizadas

  Desayuno:
     X comida            ← apretable: despliega descripción nutricional + ingredientes
     Y comida

  Almuerzo:
     Z comida

  [+ Agregar sugerencia]
```

- Cada comida es un elemento **apretable/expandible** que muestra su información nutricional (kcal, proteína, carbohidratos, grasas) e ingredientes. Reutilizá el componente de detalle que ya usa `Nutricion.jsx` para mostrar plantillas — no dupliques ese render.
- Mantené las acciones de editar / desactivar / reordenar / quitar ya implementadas, pero dentro del elemento expandido o en un menú, para que la lista se lea limpia.
- Quitar el texto actual "Sin sugerencias asignadas. El socio ve las plantillas globales." — el socio no debe tener ese comportamiento implícito documentado en la UI del admin de esa forma; usá simplemente "Sin sugerencias asignadas".

---

## Parte B — Pestaña RUTINA

### B.0 Bug bloqueante

Hoy la pestaña **se queda en "Cargando…" y termina mostrando un toast "not found"**. Antes de cualquier cambio de UI:

1. Reproducí el error y revisá la request que dispara el frontend al abrir la pestaña (path, método, parámetros) contra la ruta realmente registrada en `api/server.js`.
2. Causas probables a verificar: ruta declarada con un patrón distinto al que consume el frontend (`/api/admin/users/:userId/routines` vs `/api/admin/user?id=`), router nativo que no matchea segmentos dinámicos, o el handler devolviendo 404 cuando el socio no tiene rutinas cargadas (caso vacío tratado como "not found").
3. El caso "socio sin rutinas ni grupos" debe devolver `200` con lista vacía, **nunca 404**, y el frontend debe renderizar el estado vacío descrito en B.1 (no un spinner infinito ni un toast de error).
4. Mostrame el diagnóstico antes de arreglarlo.

### B.1 Organización de la pestaña

La pestaña Rutina se organiza en dos bloques separados por un divisor:

**Bloque 1 — Lesiones**

Caso sin lesiones registradas:
```
Lesiones
  Ninguna registrada
  [Agregar]
```

Caso con lesiones ya agregadas:
```
Lesiones
  X músculo                          [Eliminar]
  Y músculo                          [Eliminar]
  [Agregar]
```

- `[Agregar]` despliega **el mismo selector de músculos/zonas anatómicas que ya existe en la encuesta** (`SurveyWizard.jsx`) — reutilizalo, no crees una lista nueva.
- Las lesiones se guardan donde ya se guardan hoy: `respuestasEncuesta.lesiones` dentro de `user_state`.
- `[Eliminar]` quita esa lesión. Toda alta/baja queda auditada (`injury.update`).

**Bloque 2 — Grupos y rutinas**

Caso con grupos/rutinas cargadas:
```
──────────────────────────────
  Grupo 1 | Grupo 2 | Grupo 3 ...     ← tabs
──────────────────────────────
  Rutina 1              [Editar] [Eliminar]
  Rutina 2              [Editar] [Eliminar]
  Rutina 3              [Editar] [Eliminar]
  ...
  [+ Crear rutina]
```

Caso sin ningún grupo ni rutina — **se muestra exactamente la misma pantalla** (mismo layout, con el bloque de Lesiones arriba intacto), y en el bloque 2 va:
```
──────────────────────────────
  Este usuario todavía no tiene ningún plan ni rutina creada

  [Crear grupo]
```

- Los "grupos" son los **grupos de rutinas** que ya existen en el modelo (`user_state`). Usá siempre la palabra **"Grupo"** en la UI, no "Plan". Verificá primero cómo están modelados hoy en `user_state` / `routines` / `week_plan` y reutilizá ese modelo — no inventes una entidad nueva.
- Los grupos se muestran como **tabs horizontales scrolleables**.
- Agregá también la posibilidad de **crear / renombrar / eliminar un grupo**, y de **crear una rutina** dentro del grupo activo (no solo editar las existentes).
- `[Editar]` abre la edición completa de la rutina reutilizando `RoutineEdit.jsx` en modo administrativo (pasándole el `userId` objetivo), no una copia de su lógica.
- `[Eliminar]` pide confirmación antes de borrar.

### B.2 Advertencia por lesión (Fase 7)

Al agregar o modificar un ejercicio en la rutina de un socio desde el panel admin, si ese ejercicio involucra un `body-part` marcado como lesionado:

```
⚠ Este ejercicio trabaja: <músculos / zonas>
El socio tiene registrada una lesión relacionada con esta zona.
[Cancelar]  [Asignar igualmente]
```

- Reutilizá `ex.bp`, `ex.mg`, `ex.sm`, `MUSCLE_NAME`, `BodyMap` y la lógica de exclusión que ya usa `generarRutina.js`. **No crees un catálogo de músculos paralelo.**
- El nivel principal de chequeo es el `body-part`, no asumas que todos los músculos listados de un ejercicio están comprometidos.
- Si el admin fuerza la asignación, registralo en auditoría (`injury.exercise_warning.override`).
- **No modifiques** la exclusión preventiva actual del generador automático de rutinas — esta advertencia es solo para el flujo manual del admin.

---

## Parte C — Verificación

1. La suite existente (`api/database.test.js`, `api/*.test.js`, tests de frontend) debe seguir pasando.
2. Tests nuevos mínimos:
   - `NUTRICION_AUTOMATICO=0` → no se expone el toggle, el modo efectivo es manual, y un socio sin sugerencias asignadas no ve plantillas globales.
   - `NUTRICION_AUTOMATICO=1` → toggle presente y automático por defecto; socio sin sugerencias asignadas sí ve las globales.
   - Con sugerencias asignadas por el admin, prevalecen siempre esas (sin merge), en ambos valores de la variable.
   - No queda ninguna referencia residual a `NUTRITION_AUTO_SUGGESTIONS_ENABLED` en el código ni en `.env.example`.
   - Metas manuales cargadas sustituyen al cálculo automático y vuelven al automático al limpiarse.
   - Campos vacíos se persisten como `null`, no como `0`.
   - `GET` de rutinas de un socio sin grupos ni rutinas → `200` con lista vacía y el frontend muestra el estado vacío con `[Crear grupo]`.
   - Modificar un socio desactivado → error, no mutación.
   - Ejercicio sobre zona lesionada → dispara advertencia; override queda auditado.
3. Probar en `dev.lauyim.online` en un teléfono real (la UI es mobile-first y las capturas del problema son de Android), y recién después promover a producción.

---

## Formato de entrega

Por cada parte: (1) archivos que vas a tocar, (2) diff propuesto, (3) cómo probarlo. Empezá por **B.0** (el bug de "not found"), porque bloquea la validación del resto. No avances a la parte siguiente sin confirmación.
