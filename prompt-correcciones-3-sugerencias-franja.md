# Prompt — Correcciones ronda 3: asignación de sugerencias por franja (lauyim)

## Contexto

Trabajás sobre **lauyim** (siempre minúscula): React + Vite + Zustand, backend Node.js nativo (`node:http`, `node:sqlite`), SQLite.

La feature "Administrar Nutrición/Rutina" está implementada y ya se aplicaron dos rondas de correcciones. Esta ronda toca **únicamente la pestaña Nutrición → sección "Comidas sugeridas personalizadas"**: el flujo de asignación de una plantilla a un socio, y la densidad visual de la lista de sugerencias asignadas.

**Antes de escribir código: mostrame el plan (archivos a tocar + diff propuesto) y esperá confirmación.**

### Reglas que siguen vigentes
- Prioridad total del admin sobre lo que ve el socio; sin merge con globales cuando hay algo asignado.
- El socio no ve ningún indicio de que su configuración la cargó un admin.
- Nada de optimistic locking ni campos de versión.
- Cualquier migración se autoaplica al levantar el contenedor dentro de `initDatabase()`, idempotente.
- Usuario desactivado no se puede modificar (chequeo centralizado ya existente).
- Reutilizar componentes y estilos existentes. Tema oscuro, acento rojo. Sin librerías nuevas.
- Toda mutación administrativa queda auditada con el helper centralizado.

---

## Parte A — Rehacer el flujo de asignación de plantillas

### A.0 Comportamiento actual (incorrecto)

En la pantalla **"Elegir plantilla existente"** (la que se abre desde `+ Agregar sugerencia`), al tocar cualquier plantilla de la lista, la asignación se ejecuta **inmediatamente** y la plantilla se agrega **a todas las franjas en las que esa plantilla estaba categorizada** (probablemente vía `inferirFranjasPlantilla()` o equivalente).

Eso está mal por dos motivos: el admin no puede ver qué contiene la plantilla antes de asignarla, y no controla en qué franja(s) se asigna.

### A.1 Flujo nuevo — máquina de estados explícita

El flujo pasa a tener **tres pasos**, sin ninguna escritura hasta el paso 3:

```
PASO 1 — Lista de plantillas
    Toco una plantilla
        └─> NO escribe nada. Solo navega al paso 2.

PASO 2 — Detalle de la plantilla
    Muestra: nombre, ingredientes, e info nutricional (kcal, proteína, carbohidratos, grasas)
    En el header, a la derecha: botón [Agregar]
        └─> Toco [Agregar]  →  NO escribe nada. Abre el paso 3.
        └─> Volver  →  regresa al paso 1 sin cambios.

PASO 3 — Selector de franja (modal / sheet)
    "¿A qué franja querés agregarla?"
    Lista con las 5 franjas, cada una marcable (checkbox / multi-select):
        [ ] Desayuno
        [ ] Almuerzo
        [ ] Merienda
        [ ] Cena
        [ ] Extra
    Se puede marcar de 1 a 5 franjas.
    [Cancelar]                [Confirmar]
        └─> Cancelar   →  cierra sin escribir nada, vuelve al paso 2.
        └─> Confirmar  →  ÚNICO punto donde se escribe. Asigna la plantilla
                          a cada franja marcada y cierra todo el flujo,
                          volviendo a la vista de nutrición del socio con
                          la lista actualizada.
```

### A.2 Reglas de la selección de franjas

- Las 5 franjas son las que ya existen en el sistema: **desayuno, almuerzo, merienda, cena, extra**. Usá las mismas claves/constantes que ya usa el backend y `Nutricion.jsx` — no definas una lista nueva de strings.
- **Nada viene premarcado por inferencia.** No uses `inferirFranjasPlantilla()` ni ninguna categorización automática para preseleccionar franjas. El admin elige explícitamente.
- **Mínimo 1 franja**: si no hay ninguna marcada, el botón `Confirmar` queda deshabilitado.
- Si la plantilla **ya está asignada a ese socio en alguna franja**, esa franja aparece marcada y bloqueada (o con la leyenda "ya asignada") para evitar duplicados. Confirmar solo crea las asignaciones de las franjas nuevas.
- Marcar N franjas genera **N asignaciones independientes** (una fila/registro por franja), no una sola asignación con múltiples franjas. Así el admin puede después eliminar la del almuerzo sin afectar la de la cena.

### A.3 Qué NO tocar

- `inferirFranjasPlantilla()` sigue existiendo y sigue usándose para lo que hace hoy en la vista del socio (clasificar las plantillas globales). **Solo dejás de usarla en el flujo de asignación administrativa.** Verificá sus otros usos antes de tocar nada.
- El catálogo de plantillas globales no se modifica: asignar una plantilla a un socio nunca debe alterar la plantilla global de origen.

### A.4 Backend

- Revisá si el endpoint de asignación actual (`POST /api/admin/users/:userId/nutrition/suggestions`) ya acepta la franja como parámetro. Si no, agregala como campo obligatorio del payload.
- Si el frontend confirma varias franjas de una, mandá **una request por franja** o una sola request con un array de franjas — elegí lo que menos toque el handler actual, pero documentá cuál usaste.
- Validar en backend: la franja recibida debe ser una de las 5 válidas; rechazar cualquier otra. No confiar en el frontend.
- Rechazar la creación de una asignación duplicada (misma plantilla + mismo socio + misma franja).
- Auditar cada asignación creada (`nutrition.suggestion.assign`), una entrada por franja.

---

## Parte B — Lista de sugerencias asignadas

Sobre la lista agrupada por franja que se ve en "Comidas sugeridas personalizadas":

### B.1 Reducir el tamaño ~50%

Hoy la tipografía y los botones son tan grandes que el nombre de una comida ocupa tres líneas y cada ítem usa media pantalla. Reducí aproximadamente a la mitad:
- El nombre de la comida: tamaño de fuente menor, que entre en una o dos líneas.
- La línea de macros (`234 kcal · 20.4 g prot. · 32.2 g carb. · 2.8 g grasas`): más chica, como texto secundario.
- Los íconos de acción (`↑`, `↓`, lápiz, tacho): a la mitad de su tamaño actual, manteniendo un área táctil usable (no bajes del mínimo cómodo para el dedo, ~40px de target aunque el ícono se vea más chico).
- El objetivo es que entren varias comidas por pantalla sin scrollear tanto. Mantené la legibilidad y la estética actual de la app.

### B.2 Eliminar el toggle rojo de activar/desactivar

El switch rojo de cada ítem **no tiene sentido en este contexto y hay que sacarlo de la UI**. Si el admin no quiere que el socio vea una sugerencia, la elimina con el tacho.

- Sacá el toggle del render y cualquier handler asociado en el frontend.
- **No borres la columna `enabled` de la base ni el endpoint `PATCH`**: dejalos intactos para no romper nada existente ni requerir migración. Todas las asignaciones nuevas se crean con `enabled = 1`.
- Verificá que la consulta que arma las sugerencias del socio siga filtrando por `enabled = 1` — al no haber más forma de desactivar desde la UI, en la práctica todas quedan activas, y eso es lo esperado.

Las acciones que quedan por ítem son: **reordenar (↑ ↓), editar (lápiz) y eliminar (tacho)**.

---

## Parte C — Verificación

1. La suite existente debe seguir pasando.
2. Tests / verificación manual mínima:
   - Tocar una plantilla en la lista **no** crea ninguna asignación (verificable en la DB o en la auditoría).
   - Tocar `[Agregar]` tampoco escribe nada.
   - `Cancelar` en el selector de franja no deja rastro.
   - `Confirmar` con 1 franja crea exactamente 1 asignación; con 3 franjas, exactamente 3.
   - `Confirmar` deshabilitado si no hay franjas marcadas.
   - Una franja donde la plantilla ya está asignada aparece bloqueada y no genera duplicado.
   - Backend rechaza una franja inválida aunque el frontend la mande.
   - La lista de sugerencias ya no muestra ningún toggle y las tres acciones restantes funcionan.
3. Probar en un teléfono real (vista mobile-first, Android, modo oscuro) y desplegar primero en `dev.lauyim.online`.

---

## Formato de entrega

Por cada parte: (1) archivos que vas a tocar, (2) diff propuesto, (3) cómo probarlo. Empezá por la **Parte A**. No avances a la parte siguiente sin confirmación.
