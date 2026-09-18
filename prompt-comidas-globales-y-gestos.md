# Prompt — Dos features nuevas: comidas globales y gestos de retroceso (lauyim)

## Contexto

Trabajás sobre **lauyim** (siempre minúscula): React + Vite + Zustand (PWA), backend Node.js nativo (`node:http`, `node:sqlite`), SQLite.

La feature "Administrar Nutrición/Rutina" está implementada y estable tras tres rondas de correcciones. Esta tarea agrega **dos cosas nuevas e independientes entre sí**.

**Antes de escribir código: auditá lo que ya existe y mostrame el plan (archivos a tocar + diff propuesto). Esperá confirmación.**

### Reglas que siguen vigentes
- Prioridad total del admin sobre lo que ve el socio; sin merge con globales cuando hay algo asignado.
- El socio no ve ningún indicio de que su configuración la cargó un admin.
- Nada de optimistic locking ni campos de versión.
- Cualquier migración se autoaplica al levantar el contenedor dentro de `initDatabase()`, con el patrón try/catch ALTER TABLE, idempotente (arrancar dos veces seguidas no debe fallar).
- Usuario desactivado no se puede modificar (chequeo centralizado ya existente).
- Reutilizar componentes y estilos existentes. Tema oscuro, acento rojo. Sin librerías nuevas.
- Toda mutación administrativa queda auditada con el helper centralizado.

---

# FEATURE 1 — Comida compuesta global creada por el admin

## 1.1 Qué se pide

Un administrador debe poder **crear una comida compuesta (plantilla con ingredientes) que quede guardada globalmente en la instancia** y que a partir de ahí aparezca en la lista de plantillas disponibles, igual que las plantillas globales que vienen precargadas.

No es una comida asignada a un socio puntual: es una plantilla del catálogo de la instancia, reutilizable para cualquier socio.

## 1.2 Distinción clave (no confundir con lo ya implementado)

Ya existen tres scopes en `plantillas_comida`:

| scope | Qué es | Dónde se crea hoy |
|---|---|---|
| `user` | Plantilla personal de un socio | La crea el propio socio en `Nutricion.jsx` |
| `admin` | Plantilla asignada por el admin a **un socio puntual** | `POST /api/admin/users/:userId/nutrition/suggestions/custom` |
| `global` | Catálogo de la instancia, disponible para todos | Hoy **solo** se siembra con el script `plantillas_globales.js` |

**Lo nuevo es poder crear plantillas `scope = 'global'` desde la UI de administración.** No modifiques el comportamiento de los otros dos scopes.

## 1.3 Punto de entrada en la UI

En la pantalla **"Elegir plantilla existente"** (la que se abre desde `+ Agregar sugerencia`), agregá arriba de la lista un botón:

```
[+ Crear comida global]
```

- Abre el formulario de creación de comida compuesta.
- Al guardar, la comida queda en el catálogo global y **aparece inmediatamente en esa misma lista**, sin necesidad de recargar ni reiniciar el contenedor.
- Después de crearla, el admin vuelve a la lista y puede asignarla a un socio con el flujo de 3 pasos ya implementado (tocar plantilla → ver detalle → `[Agregar]` → elegir franjas → `Confirmar`). **Crear una comida global NO la asigna automáticamente a ningún socio.** Son dos acciones separadas.

## 1.4 Formulario de creación

**Reutilizá el editor de comida compuesta que ya existe** (el que usa el socio para armar sus plantillas con ingredientes en `Nutricion.jsx`, y/o el que usa el flujo `/suggestions/custom`). No construyas un editor de ingredientes nuevo desde cero: auditá cuál existe y adaptalo pasándole el scope objetivo.

Campos:
- **Nombre** (obligatorio)
- **Ingredientes**: los mismos que ya maneja `plantillas_ingredientes` (alimento, gramos), con el cálculo de macros que ya hace el editor existente.
- **Franjas**: selección múltiple de las 5 franjas válidas (desayuno, almuerzo, merienda, cena, extra), usando las mismas claves/constantes del sistema. **Obligatorio marcar al menos una.** Esto es importante: hoy las plantillas globales derivan su franja de `inferirFranjasPlantilla()`, que adivina; para las creadas por el admin la franja debe ser explícita y esa asignación explícita tiene prioridad sobre la inferencia.
- **Categoría**: reusá el valor que ya usan las plantillas globales del catálogo (`fitness` / `tradicional` — verificá cuáles existen realmente antes de hardcodear).

## 1.5 Backend

Endpoints nuevos, **fuera** del namespace por socio (porque no pertenecen a ningún socio):

```
GET    /api/admin/nutrition/templates          # lista de plantillas globales
POST   /api/admin/nutrition/templates          # crear comida global
PUT    /api/admin/nutrition/templates/:id      # editar
DELETE /api/admin/nutrition/templates/:id      # eliminar
```

Reglas:
- Protegidos con `requireAdmin()`. Admin y Owner tienen los mismos permisos acá.
- Se crean con `scope = 'global'`, `user_id = NULL`, `enabled = 1`, `assigned_by` = id del admin que la creó.
- Validar nombre no vacío, al menos un ingrediente, y que cada franja recibida sea una de las 5 válidas. No confiar en el frontend.
- **`DELETE` de una plantilla global que ya fue asignada a socios**: no la borres en silencio. Definí y avisá el comportamiento — mi recomendación es impedir el borrado si hay asignaciones activas y devolver un error claro indicando a cuántos socios afecta, para que el admin las desasigne primero. Si preferís otro comportamiento, proponelo antes de implementarlo.
- Auditar: `nutrition.template.create`, `nutrition.template.update`, `nutrition.template.delete`.

## 1.6 Gotcha importante: el script `plantillas_globales.js`

El script de siembra `plantillas_globales.js` corre manualmente después de cada deploy y es idempotente, **deduplicando por `nombre + categoria`**.

Verificá que ese script **no pise, duplique ni borre** las plantillas globales creadas por un admin desde la UI:
- Si un admin crea una comida global con el mismo nombre y categoría que una del seed, decidí y documentá qué gana (mi recomendación: el script no sobrescribe lo que ya está en la base, que es su comportamiento actual — confirmalo leyendo el código, no lo asumas).
- El script nunca debe eliminar filas que él no creó.

Reportame qué encontraste al revisarlo.

---

# FEATURE 2 — Gestos nativos de retroceso

## 2.1 Qué se pide

En **todo el menú de gestión de nutrición y rutinas**, el gesto nativo de retroceso del sistema debe funcionar:
- **Android**: botón/gesto de atrás.
- **iOS**: swipe desde el borde izquierdo.

Hoy estos gestos no retroceden un paso dentro del menú: cierran toda la vista o sacan al usuario de la sección (o de la PWA), perdiendo el contexto.

## 2.2 Comportamiento esperado

El gesto de atrás debe **cerrar la capa superior abierta y volver exactamente al paso anterior**, una capa por vez. Ejemplo con el flujo de asignación de sugerencias:

```
Panel admin
  └─ Administrar Nutrición/Rutina  (modal)
       └─ Elegir plantilla existente
            └─ Detalle de la plantilla
                 └─ Selector de franjas

atrás  →  cierra el selector de franjas, queda el detalle
atrás  →  vuelve a la lista de plantillas
atrás  →  vuelve a Administrar Nutrición/Rutina
atrás  →  cierra el modal y vuelve al panel admin
```

Lo mismo aplica a las capas de la pestaña Rutina: editor de rutina, selector de músculos/lesiones, diálogos de crear/renombrar/eliminar grupo, confirmaciones.

## 2.3 Cómo implementarlo

Esto es una PWA sin router con historial por modal, así que el gesto de atrás del sistema se traduce en un evento `popstate`. La implementación tiene que ser **una sola** y compartida, no parcheada modal por modal:

1. Cada vez que se abre una capa (modal, sheet, diálogo, sub-vista), se hace un `history.pushState()` con un identificador de esa capa.
2. Un listener global de `popstate` cierra **únicamente la capa que está arriba del stack**, no todas.
3. Cerrar una capa con el botón `X` o `Cancelar` debe consumir esa entrada del historial (`history.back()` programático), para que el historial no quede con entradas huérfanas que obliguen a apretar atrás dos veces.
4. Cuidado con el doble disparo: cerrar por gesto no debe volver a llamar `history.back()` y provocar un doble retroceso.
5. Con todas las capas cerradas, el gesto de atrás debe comportarse como siempre (salir de la sección), no atrapar al usuario en un loop del que no pueda salir.

Recomendación: implementalo como un **hook reutilizable** (por ejemplo `useBackGesture(isOpen, onClose)`) que cada capa consuma, más un stack central en el store. Auditá primero si en el proyecto ya hay algún manejo parcial de `popstate` o de historial en otros modales, para no duplicar mecanismos ni romper los que ya funcionen.

## 2.4 Alcance

- **Obligatorio**: todas las capas del menú de gestión de nutrición y rutinas.
- Si el hook queda genérico y se puede aplicar a otros modales de la app sin riesgo, decímelo, pero **no lo apliques fuera del alcance de esta tarea sin confirmarlo** — no quiero regresiones en pantallas que hoy andan bien.

---

# FEATURE 3 — Toggle "Limitar comidas sugeridas" por socio

## 3.1 Qué se pide

En la pestaña **Nutrición**, dentro de la sección "Comidas sugeridas personalizadas", agregar un **toggle con el mismo estilo visual que el de "Cálculo automático"** (misma tarjeta, mismo switch, mismo tratamiento tipográfico), etiquetado:

```
Limitar comidas sugeridas
```

**El valor por defecto lo define la variable `NUTRICION_AUTOMATICO`** (ver 3.4). Con la configuración habitual (`NUTRICION_AUTOMATICO=1`) viene **desactivado**.

## 3.2 Lógica exacta

| Estado del toggle | Qué ve el ADMIN en esta pantalla | Qué ve el SOCIO en su app |
|---|---|---|
| **Desactivado** (default) | La sección de sugerencias asignadas queda **inhabilitada**: no se puede agregar ninguna sugerencia al socio (el botón `+ Agregar sugerencia` no está disponible) | Comportamiento actual de sugerencias, sin restricción por asignación |
| **Activado** | Aparece la lista de sugerencias asignadas y el botón `+ Agregar sugerencia`, **con exactamente la misma lógica ya implementada** (flujo de 3 pasos, agrupado por franja, acciones ↑ ↓ / editar / eliminar) | **Solo** las sugerencias que el admin le asignó. Si el admin no le asignó ninguna, el socio **no ve ninguna sugerencia en ninguna franja** — ni globales ni inferidas |

El punto central: activar el toggle convierte al socio en "modo restringido", donde la única fuente de sugerencias es lo que el admin cargó. Cero sugerencias asignadas con el toggle activado = pantalla de sugerencias vacía para el socio, y eso es el comportamiento correcto, no un bug.

## 3.3 Detalles de implementación

- **Persistencia**: el estado es **por socio**. Guardalo junto a la configuración nutricional del socio que ya existe (`user_state.nutrition_goals` o donde corresponda según el modelo actual — auditalo primero). Si hace falta un campo nuevo, la migración se autoaplica en `initDatabase()`, como siempre.
- **Desactivar el toggle NO borra las sugerencias asignadas.** Se conservan tal cual y vuelven a aparecer si el admin lo reactiva. Nunca ejecutes un borrado en cascada al cambiar el toggle.
- Cuando el toggle está desactivado, el admin ve la sección inhabilitada pero con una indicación clara de por qué (por ejemplo, la sección atenuada con una leyenda breve), no un bloque vacío sin explicación.
- El backend debe **rechazar** intentos de asignar sugerencias a un socio con el toggle desactivado, aunque el frontend lo permita por error. La UI no es la validación.
- La consulta que arma las sugerencias que ve el socio debe respetar este flag: con el flag activo, devuelve exclusivamente las asignadas por el admin (aunque el resultado sea vacío) y nunca cae a globales ni a inferencia por franja.
- Auditar el cambio de estado: `nutrition.suggestions.limit.update`.

## 3.4 Relación con `NUTRICION_AUTOMATICO` — decisión ya tomada

La variable `NUTRICION_AUTOMATICO` ya define a nivel de instancia un comportamiento parecido para las sugerencias. Este toggle nuevo define lo mismo pero **por socio**, así que hay que resolver el solapamiento. **La decisión ya está tomada, implementá exactamente esto:**

> `NUTRICION_AUTOMATICO` pasa a ser **únicamente el valor por defecto** del toggle "Limitar comidas sugeridas" para los socios que todavía no tienen una preferencia explícita guardada. Una vez que un admin toca el toggle de un socio, **ese valor por socio gana siempre** y la variable de entorno deja de influir sobre ese socio.

Reglas concretas:

- `NUTRICION_AUTOMATICO=0` → el toggle viene **activado** por defecto (socio restringido a lo que le asigne el admin).
- `NUTRICION_AUTOMATICO=1` → el toggle viene **desactivado** por defecto (comportamiento actual de sugerencias).
- El estado por socio necesita **tres valores posibles**, no dos: `sin definir` (usa el default de la env var), `activado`, `desactivado`. Guardalo como `null` / `true` / `false` — **no uses un booleano con default `false`**, porque entonces sería imposible distinguir "el admin lo apagó" de "nunca lo tocó", y cambiar la env var dejaría de tener efecto sobre los socios nuevos.
- La resolución del estado efectivo debe estar en **una sola función** compartida por backend y por la vista del socio, del tipo: `si (preferenciaDelSocio !== null) usar preferenciaDelSocio; si no, derivar de NUTRICION_AUTOMATICO`. No repliques esta lógica en varios lugares.
- Cambiar `NUTRICION_AUTOMATICO` en el `.env` y reiniciar **no debe alterar** a los socios que ya tienen preferencia explícita guardada.
- En la UI del admin, si el socio está en `sin definir`, el toggle se muestra en la posición que corresponde al default vigente. No hace falta indicar visualmente que es un default heredado.

Antes de escribir código, auditá cómo quedó implementada `NUTRICION_AUTOMATICO` hoy y reportame si en algún lugar quedó asumida como booleano de dos estados, porque eso es lo que hay que corregir para que esto funcione.

---

## Verificación

1. La suite existente debe seguir pasando.
2. Feature 1:
   - Crear una comida global la deja visible en la lista al instante, sin recargar.
   - La comida creada NO queda asignada a ningún socio hasta que se use el flujo de asignación.
   - Se guarda con `scope = 'global'` y `user_id = NULL`.
   - Las franjas elegidas explícitamente se respetan (no se sobrescriben con la inferencia).
   - Backend rechaza nombre vacío, cero ingredientes y franjas inválidas.
   - Correr `plantillas_globales.js` después de crear comidas globales desde la UI no las duplica ni las borra.
3. Feature 2, probado en **dispositivo real** (Android con gesto de atrás, e iPhone con swipe desde el borde, en Safari y en modo PWA standalone):
   - Cada gesto cierra exactamente una capa.
   - Cerrar con `X` y después usar el gesto no produce un doble retroceso ni deja entradas huérfanas.
   - Recorrer el flujo completo de 4 niveles y volver con gestos hasta el panel admin funciona sin saltos.
4. Feature 3:
   - Socio nuevo sin preferencia guardada: el toggle refleja el default derivado de `NUTRICION_AUTOMATICO` (con `=1` desactivado, con `=0` activado).
   - Un socio con preferencia explícita guardada **no cambia** al modificar `NUTRICION_AUTOMATICO` y reiniciar el contenedor.
   - El estado por socio distingue los tres casos (`sin definir` / `activado` / `desactivado`).
   - Desactivado: el backend rechaza una asignación de sugerencia aunque se fuerce la request.
   - Activado sin sugerencias asignadas: el socio no ve ninguna sugerencia en ninguna franja (ni globales ni inferidas).
   - Activado con sugerencias asignadas: el socio ve exactamente esas, en las franjas correspondientes.
   - Alternar el toggle activado → desactivado → activado conserva las sugerencias asignadas intactas.
5. Desplegar primero en `dev.lauyim.online` y validar ahí antes de producción.

---

## Formato de entrega

Por cada feature: (1) archivos que vas a tocar, (2) diff propuesto, (3) cómo probarlo. Son independientes entre sí: empezá por la **Feature 1**, seguí con la **3** y dejá la **2** (gestos) para el final, porque toca el manejo de historial de todas las capas y conviene hacerlo cuando la estructura de pantallas ya no cambia más.

No avances de una feature a la siguiente sin confirmación.
