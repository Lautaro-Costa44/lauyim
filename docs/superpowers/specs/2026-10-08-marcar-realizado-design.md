# Marcar un día como realizado: rediseño

Fecha: 2026-10-08 · Rama: `feat/marcar-realizado` · Estado: implementado y probado en dev (tres rondas de prueba).

Este documento describe el comportamiento final. Las decisiones que cambiaron durante las pruebas en dev están al final, en "Historial de decisiones".

## Por qué

La hoja de un día (`DayOverride`, `frontend/src/sheets.jsx`) se abría desde la semana de Inicio y desde el calendario. Era la misma para cualquier fecha y mezclaba planificar (qué toca) con registrar (qué hice). Auditoría:

1. **Pérdida de datos.** `keepClasses` borraba los entrenamientos del día que no son clases al tocar "Marcar como realizado", "Descanso", otra rutina o "Volver al plan", sin confirmación. La tira de Inicio abría esta hoja aunque el día ya estuviera entrenado.
2. **Datos inventados.** `markedDoneWorkout` cargaba todas las series de la rutina como hechas con las metas del plan. Como `defaultConfig` deja `weight: 0`, `lastEntryFor` tomaba esas series y la sesión siguiente arrancaba en 0 kg. La progresión, el 1RM, el esfuerzo y la recuperación leían éxitos que no existieron.
3. **Forma incorrecta.** Ejercicios de tiempo y cardio quedaban como `r: 10`, sin `sec`/`min`.
4. **Rutina equivocada.** En un día sin rutina tomaba `routines[0]` sin preguntar.
5. **Sin límite de fecha.** Se podía "realizar" un día futuro.
6. **Duración inventada.** Siempre una hora: ensuciaba el total del mes y las horas promedio.
7. **No se podía corregir** un entreno ya hecho con la app si se cargó algo mal.

## Reglas según la fecha

| Día | Hoja |
|---|---|
| Pasado | Registrar: "Entrené" / "Descansé", y lo que hubo ese día. Nunca borra nada sin confirmar. |
| Hoy, sin entreno | Registrar y "Planificar hoy". |
| Hoy, con entreno | Lo que hubo y "Agregar otro". Sin planificar: ya entrenaste. Una clase sola no cuenta como entreno para esto. |
| Futuro | Solo planificar, más las clases reservadas. |

Planificar (rutina, descanso, volver al plan) solo cambia `dayPlan`: nunca toca `workouts`.

**"Tocaba"** (pasado y hoy) muestra la rutina planificada para esa fecha (un override de rutina) o, si no hay, la del plan semanal. Un descanso puesto después, o un `estado: 'completado'` viejo, no cambian lo que tocaba. En "hoy" no se repite la línea "Plan semanal: …" de la sección de planificar.

**Cierre del gimnasio:** si la fecha cae en un cierre (`closures` de `GET /api/classes`), arriba aparece "El gimnasio está cerrado · \<motivo\>". Ocultar el punto de "planificado" en la semana y el calendario queda para la tarea de cierres más allá de las clases.

## Hoja del día

### Sin nada ese día (pasado u hoy)

- Dos botones grandes: **Entrené** / **Descansé**.
  - **Descansé** guarda `dayPlan[iso] = { estado: 'descanso' }` y cierra.
  - **Entrené** muestra chips con las rutinas del socio, la que tocaba preseleccionada, más **Otra cosa** (libre, sin rutina). Si ese día no tocaba nada, no hay preselección y no se puede marcar hasta elegir.
- Tarjeta con la elección: nombre, cantidad de ejercicios, "cuenta para tu racha".
- **Marcar como entrenado**: guarda un marcado sin series y cierra.
- **＋ Cargar series (opcional)**: abre el editor con la rutina elegida.

### Día pasado marcado como descanso (y sin nada más)

"Descansaste este día" con **Deshacer** (borra el `dayPlan`) y **＋ Al final entrené** (abre el paso anterior; ahí "Descansé" pasa a ser **Cancelar**, que vuelve a la tarjeta de descanso).

### Con entrenos o clases ese día

- Sección "Ese día" (o "Hoy"): una tarjeta por entreno y por clase (`classesByDate`).
  - Entreno con la app: etiqueta "Entrenado", duración, series y volumen.
  - Marcado: etiqueta "Marcado", "Sin series · cuenta para tu racha" o "N series".
  - Clase: como siempre; tocarla abre su detalle.
- Tocar la tarjeta de un entreno abre su detalle.
- Cada entreno tiene **"⋯"**, que abre un menú flotante: **Editar series** (o **Cargar series** en un marcado sin series) y **Borrar**.
  - El menú se dibuja fuera de la hoja (portal en `body`, posición fija desde el botón): flota sobre lo demás sin correr nada y abre hacia arriba si abajo no entra en la pantalla. Tocar afuera lo cierra.
  - **Borrar** confirma con el diálogo de la app (`confirmSheet`).
- **＋ Agregar otro entrenamiento**: abre el paso "Entrené", con **Cancelar** en lugar de "Descansé".

### Desde el calendario

El calendario abre siempre la hoja del día, igual que la tira de Inicio. El texto de ayuda dice "Tocá un día para ver lo que hiciste, marcarlo o planificarlo."

## Editor de series

Uno solo para dos casos:
- **Marcado:** cargar series a un día marcado (o al marcar). Nada es obligatorio; guardar todo vacío es marcar el día.
- **Entreno ya hecho con la app:** corregir lo que se cargó mal. El encabezado dice "Corregí lo que cargaste. Los drop sets y las notas se conservan." y el botón es **Guardar cambios**. No deja guardar si no queda ninguna serie.

Un entreno en curso (el que se está haciendo ahora) no se edita acá.

### Celular

- Pantalla completa (`openSheet` con `kind: 'panel'`, `fullScreen`, `locked` y `backGesture`).
- Lista en **acordeón**, con un ejercicio abierto a la vez.
  - Fila cerrada: nombre, etiqueta de tipo (peso corporal / tiempo / cardio) y resumen ("Sin series" o "✓ 3 series · 80×8, 80×8, 80×7").
  - Encabezado de la fila en grilla: el nombre ocupa lo que sobra y **⇄** (ícono nuevo `swap`) y **🗑** quedan siempre en sus columnas a la derecha.
- Tabla del ejercicio abierto: "Última vez: …" y una fila por serie. Columnas según `modeOf`:
  - reps: **kg · reps**; peso corporal: **+kg · reps**;
  - tiempo: **seg · kg**; cardio: **min · km/h**.
  - Columna **RIR o RPE** solo si `effortOf(S) !== 'none'` (no en cardio).
- Filas iniciales: las series que ya tiene el entreno o, en un marcado nuevo, tantas vacías como series tiene la rutina (mínimo una).
- **"Última vez"** es la sesión anterior a ese día (`w.d < iso`): ni el entreno que se edita ni una posterior. Sus valores se muestran como placeholder y **Igual que la última vez** los copia, con el separador decimal del idioma.
- **＋ Serie** agrega una fila; 🗑 en la fila la borra.
- **⇄ Cambiar**: abre la biblioteca (`exercisePicker`) encima, que se cierra al elegir (como al reemplazar un ejercicio mientras se entrena). Después confirma con el diálogo de la app: "¿Cambiar X por Y?" y cuántas series se pierden. Elegir el mismo ejercicio no hace nada.
- **🗑 Quitar**: confirma con el diálogo de la app, con cuántas series se pierden.
- **＋ Agregar ejercicio**: biblioteca; se agrega al final, abierto.
- **Teclado:**
  - Abrir un ejercicio lo sube arriba de todo (`scrollIntoView({ block: 'start' })` en un efecto después del render), con relleno al final de la lista para que hasta el último pueda subir sobre el teclado.
  - Abrir un ejercicio no enfoca ninguna celda.
  - `inputMode` decimal en kg, km/h y esfuerzo; numérico en reps, seg y min. `enterKeyHint="next"`: Enter pasa a la celda siguiente; en la última, `done` cierra el teclado.
  - "Guardar" se oculta mientras hay un campo enfocado.

### PC / tablet (≥ 700 px, el corte del panel centrado)

Panel centrado de unos 780 px con **lista + detalle**: la lista a la izquierda, la tabla del ejercicio elegido a la derecha con ⇄ y 🗑 en su encabezado. Tab recorre las celdas. Abajo: **Cancelar** / **Guardar**.

## Datos

### Un día marcado

Un workout común con `marked: true`:

```js
{
  id, d: iso, start, end: start,      // sin duración inventada
  name, routineId,                    // null en "Otra cosa"
  marked: true,
  vol,                                // workoutVolume() de las series cargadas; 0 sin series
  entries: [                          // solo ejercicios con al menos una serie no vacía
    { id, target, sets: [{ done: true, w, r, sec, min, speed, rir | rpe }] }
  ],
  muscleLoad,                         // solo sin series y con rutina: { muscles, intensity: 'medium' }
}
```

- **Servidor:** sin cambios ni migración. `marked` y `muscleLoad` viajan en la columna `meta` (`api/row-meta.js`).
- `start`: mediodía del día; si es hoy y todavía no es mediodía, una hora antes de ahora; nunca antes de la medianoche local. Al editar se conserva el que tenía.
- Series vacías (`isEmptySet`) no se guardan. Un ejercicio sin series no va a `entries`.
- Esfuerzo: se guarda en la escala del ajuste. Uno que ya estaba en la otra escala (o con el ajuste apagado) se conserva tal cual: una serie lleva `rir` o `rpe` y nunca se reescribe (`effort.js`).
- `muscleLoad`: para la recuperación de un marcado sin series. Son los músculos **principales** de la rutina (en cada ejercicio, el de más peso según `musclesOf`), con la misma forma que el de las clases (`recovery.js`). Con series no se escribe.
- Marcar no escribe `dayPlan[iso] = { estado: 'completado' }`. Los valores viejos se siguen leyendo.

### Un entreno ya hecho, corregido (`buildEditedWorkout`)

- El borrador muestra solo las series de trabajo hechas. Cada fila guarda su serie original (`orig`); los calentamientos y las series sin completar quedan en `keep`.
- Al guardar, cada serie conserva lo que el editor no muestra (drops, rest-pause, notas) y pisa solo los valores mostrados; un valor vaciado se borra de la serie; una fila vacía se borra.
- Vuelven los calentamientos (adelante) y las series sin completar (al final).
- Un ejercicio cambiado o agregado entra sin nada del anterior. Uno que se queda sin series de trabajo sale.
- El resto del entreno no cambia: hora, duración, nota, récords festejados al terminar, objetivo de la semana. `vol` se recalcula.

### Guardar en la lista (`putWorkout`)

- Mismo id: se pisan los campos que arma el editor y se conserva el resto (la nota, el `weekTarget` que estampó la racha). `muscleLoad` solo queda si el nuevo lo trae.
- Nuevo: se inserta en orden por hora, no al final ("la última vez" lee la lista en orden).

### Qué cuenta y dónde

| Consumidor | Marcado sin series | Marcado con series / entreno corregido |
|---|---|---|
| Racha, semana, calendario, adherencia del profe | cuenta (día con workout) | cuenta |
| Récords, 1RM, progresión, "última vez", esfuerzo | nada (no hay series) | las series cargadas (datos reales) |
| Recuperación muscular | `muscleLoad` (músculos principales) | las series |
| Historial | "Marcado · Sin series" | "Marcado" con series y volumen / igual que antes |

No hace falta filtrar en cada consumidor: todos leen series.

### Datos viejos

Los workouts marcados antes de este cambio tienen series inventadas y no llevan marca. No se tocan: no hay forma segura de distinguirlos de uno real.

## Detalle de un entreno

`TrainingDetail` suma **Editar series** a cualquier entreno ya hecho, y **Cargar series** a un marcado sin series (con la línea "Marcado a mano…"). "Repetir este entreno" solo aparece si tiene series. Borrar sigue igual, con confirmación.

## Historial del navegador (`Modals.jsx`)

Cada hoja abierta agrega una entrada (`pushState`) y cerrarla retrocede (`history.go`), así el "atrás" de Android cierra la hoja. `history.go` es asíncrono: cerrar la biblioteca y abrir enseguida el diálogo de confirmar hacía que el navegador retrocediera contando desde antes del push, y al cerrar todo la app volvía a la página anterior (#/plan, #/progress). Ahora:

- Con un retroceso propio pendiente, la hoja nueva espera ese `popstate` para hacer su `pushState`.
- Una hoja que se abre y se cierra antes de que llegue no toca el historial.
- Los retrocesos pendientes se cuentan (antes era un solo indicador).

Esto también arregla reemplazar un ejercicio mientras se entrena.

## Archivos

- `frontend/src/lib/marked-workout.js`: lógica pura (`dayMode`, `columnsFor`, `markedSetOf`, `markedRowOf`, `buildMarkedWorkout`, `buildEditedWorkout`, `markedDraft`, `markedItem`, `emptyRows`, `itemSummary`, `putWorkout`, `modeTag`). Reemplaza a `markedDoneWorkout`, que se borró de `lib/history.js`.
- `frontend/src/components/day/DaySheet.jsx`: la hoja del día. `dayOverrideSheet` sigue exportado desde `sheets.jsx` con la misma firma.
- `frontend/src/components/day/MarkedWorkoutEditor.jsx`: el editor y `workoutEditorSheet`.
- `frontend/src/components/Modals.jsx`: historial balanceado.
- `frontend/src/components/Icon.jsx`: ícono `swap`.
- `frontend/src/sheets.jsx`: calendario, `WorkoutRow` ("Marcado", "Sin series"), `TrainingDetail`.
- `frontend/src/index.css`: `.mwe-*` (editor) y `.day-*` (hoja, menú, descanso, cierre).
- Textos: claves en español con `t('…')`; no hace falta tocar `locales/es.js`.

## Pruebas

- `lib/marked-workout.test.js`: armado del marcado, edición de un entreno hecho, borrador, resumen, inserción, esfuerzo en la otra escala, músculos principales.
- `components/day/DaySheet.test.jsx`: reglas por fecha, "Tocaba", descanso con deshacer, menú y borrar con confirmación, cierre, calendario, historial y detalle.
- `components/day/MarkedWorkoutEditor.test.jsx`: celular y PC, confirmaciones con el diálogo, cambiar con la biblioteca, esfuerzo, "igual que la última vez", teclado, corregir un entreno hecho.
- `components/Modals.test.jsx`: retroceso pendiente con push diferido, hoja abierta y cerrada antes del popstate, dos retrocesos seguidos.
- Navegador: celular y PC, tema claro y oscuro, con clases activadas (reservas pasadas, de hoy y futuras, una falta y un feriado).

## Fuera de alcance

- "Deshacer" en los avisos (`toast` no admite acciones).
- Sugerencias de reemplazo (`ExerciseReplacementSheet`): solo la biblioteca.
- Corregir los marcados viejos.
- Clases pasadas a las que faltaste o que no respondiste: no aparecen en la hoja del día (ya era así).
- Ocultar el punto "planificado" en la semana y el calendario en un día de cierre (tarea de cierres).

## Historial de decisiones

- **Ronda 1 (diseño):** pasos en dos tiempos (A), editor en acordeón (A), PC con lista + detalle (A), reemplazar con la biblioteca como al entrenar.
- **Ronda 2 (prueba en dev):**
  - Hoy con entreno ya no ofrece planificar.
  - Menú "⋯" flotante en vez de botones a la vista.
  - Confirmar quitar/cambiar con el diálogo de la app en vez de una tarjeta dentro de la fila.
  - Ícono ⇄ en vez del de recargar.
  - Se pueden corregir entrenos ya hechos.
  - "No entrené" pasó a ser "Descansé" y se guarda.
  - Cartel de cierre y texto del calendario.
- **Ronda 3:** historial del navegador balanceado (la vista de fondo saltaba a Plan/Stats) y encabezado del ejercicio en grilla.
