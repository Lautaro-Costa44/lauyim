# Marcar un día como realizado: rediseño

Fecha: 2026-10-08 · Rama: `feat/marcar-realizado`

## Por qué

La hoja de un día (`DayOverride`, `frontend/src/sheets.jsx`) se abre desde la semana de Inicio y desde el calendario. Es la misma para cualquier fecha y mezcla planificar (qué toca) con registrar (qué hice). Auditoría:

1. **Pérdida de datos.** `keepClasses` borra los entrenamientos del día que no son clases al tocar "Marcar como realizado", "Descanso", otra rutina o "Volver al plan", sin confirmación. La tira de Inicio abre esta hoja aunque el día ya esté entrenado.
2. **Datos inventados.** `markedDoneWorkout` carga todas las series de la rutina como hechas con las metas del plan. Como `defaultConfig` deja `weight: 0`, `lastEntryFor` toma esas series y la sesión siguiente arranca en 0 kg. La progresión, el 1RM, el esfuerzo y la recuperación leen éxitos que no existieron.
3. **Forma incorrecta.** Ejercicios de tiempo y cardio quedan como `r: 10`, sin `sec`/`min`.
4. **Rutina equivocada.** En un día sin rutina toma `routines[0]` sin preguntar.
5. **Sin límite de fecha.** Se puede "realizar" un día futuro.
6. **Duración inventada.** Siempre una hora: ensucia el total del mes y las horas promedio.

## Qué se construye

### Reglas según la fecha

| Día | Hoja |
|---|---|
| Pasado | Registrar (nueva). Nunca borra nada. |
| Hoy | Registrar + planificar. |
| Futuro | Solo planificar. Sin "marcar como realizado". |

Planificar (`setEstado`) deja de tocar `workouts`: solo cambia `dayPlan`. Así el bug de pérdida de datos queda cerrado también en hoy y futuro.

### Día pasado sin nada registrado (paso 1)

- Título con la fecha y "Tocaba: \<rutina del plan\>" (o "Descanso").
- Elección grande: **Entrené** / **No entrené**.
  - "No entrené" solo cierra la hoja: no escribe nada (no hay nada que borrar).
- Con "Entrené": chips con las rutinas del socio, la planificada preseleccionada, más **Otra cosa** (libre, sin rutina). En un día sin rutina planificada no hay preselección: hay que elegir.
- Tarjeta resumen de la elección: nombre, cantidad de ejercicios, "cuenta para tu racha".
- Botón **Marcar como entrenado**: guarda el workout marcado sin series y cierra.
- Enlace **＋ Cargar series (opcional)**: va al paso 2 con la rutina elegida.

### Cargar series (paso 2)

- **Celular:** la hoja pasa a pantalla completa. Lista de ejercicios en **acordeón**, con uno abierto a la vez.
  - Fila cerrada: nombre, etiqueta de tipo (peso corporal / tiempo / cardio) y resumen: "Sin series" o "✓ 3 series · 80 kg × 8, 8, 7".
  - Fila abierta: "Última vez: …" y una tabla con una fila por serie. Las columnas dependen del modo (`modeOf`):
    - reps: **kg · reps**; peso corporal: **+kg · reps** (`isBw`);
    - tiempo: **seg** (+kg opcional); cardio: **min · km/h**.
  - Columna de esfuerzo **RIR o RPE** solo si `effortOf(S) !== 'none'`. Usa los rangos de `EFFORT`.
  - Arranca con tantas filas vacías como series tiene la rutina. Si no hay rutina ("Otra cosa"), con una.
  - Los valores de la última vez (`lastEntryFor`) se muestran como placeholder gris, no como valor. **Igual que la última vez** los copia como valores.
  - **＋ Serie** agrega una fila. **✕** en la fila la quita, sin confirmación porque es una fila.
  - **⇄ Cambiar**: abre la biblioteca (`exercisePicker`) encima. Al tocar un ejercicio, la biblioteca se cierra (como en el entreno en vivo, `Workout.jsx:586`). Después aparece la confirmación dentro de la fila: "¿Cambiar X por Y?". Si tenía series: "Las N series que cargaste se borran: eran de otro ejercicio." Elegir el mismo ejercicio no hace nada.
  - **✕ Quitar ejercicio**: confirmación dentro de la fila, siempre. "¿Quitar X?" + "Se pierden las N series que cargaste." (si las hay) + "La rutina no cambia."
  - **＋ Agregar ejercicio**: `exercisePicker`, que se cierra al elegir. Se agrega al final, abierto.
  - **Guardar entrenamiento**: guarda y cierra. Con todo vacío equivale a "Marcar como entrenado".
- **Teclado (celular):**
  - Abrir un ejercicio lo desplaza **arriba de todo** en el área con scroll (`block: 'start'`), así la tabla completa queda sobre el teclado.
  - Al final de la lista hay un espacio de relleno para que el último ejercicio también pueda subir.
  - Abrir un ejercicio **no** enfoca ninguna celda: el teclado aparece cuando se toca una.
  - `inputMode="decimal"` en kg y km/h; `inputMode="numeric"` en reps, seg, min y esfuerzo. `enterKeyHint="next"`: Enter pasa a la celda siguiente y, al final de la fila, a la serie siguiente. En la última celda, `enterKeyHint="done"` cierra el teclado.
  - El botón Guardar se oculta mientras hay un campo enfocado y el teclado está abierto (`--keyboard-offset > 0`).
  - Se apoya en lo que ya existe en `lib/keyboard.js` (`--keyboard-offset`, `keepFocusedFieldVisible`).
- **PC / tablet (≥ 700 px, el mismo corte que el panel centrado):** panel centrado de unos 780 px (`kind: 'panel'`) con **lista + detalle**.
  - Izquierda: la lista de ejercicios y "＋ Agregar ejercicio".
  - Derecha: la tabla del ejercicio elegido, con "⇄ Cambiar" y "✕ Quitar" como botones con texto.
  - Tab recorre las celdas; Enter pasa a la serie siguiente.
  - Abajo a la derecha: Cancelar / Guardar entrenamiento.

### Día pasado ya entrenado

- Sección "Ese día": una tarjeta por workout y por clase (`classesByDate`).
  - Registrado en vivo: "✓ Entrenado", con duración, series y volumen. Toca → `workoutDetailSheet`.
  - Marcado: etiqueta "Marcado", "Sin series · cuenta para tu racha" o el resumen, y botón **＋ Cargar series**, que abre el paso 2 con lo que ya tenga. Toca la tarjeta → detalle.
  - Clase: como hoy.
- **＋ Agregar otro entrenamiento**: abre el paso 1.
- No hay ninguna acción que borre. Para borrar se abre el detalle, que ya pide confirmación.
- Un workout registrado en vivo no se edita desde acá.

### Desde el calendario

Hoy `openDay` (`CalendarSheet`) abre el detalle directo si el día tiene un solo workout, y una lista si tiene varios. Con este cambio, **el calendario abre siempre la hoja del día**, igual que la tira de Inicio. Es un toque más para ver el detalle, pero se llega a "＋ Agregar otro entrenamiento" y "＋ Cargar series", y los dos lugares se comportan igual.

### Hoy

Arriba, lo de "registrar" (igual que un día pasado). Abajo, las opciones de planificar de hoy: rutinas, descanso, volver al plan. Planificar no toca los workouts.

### Futuro

La hoja de planificar actual, sin "Marcar como realizado".

## Datos

Un día marcado es un workout común con `marked: true`:

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

- **Servidor:** sin cambios ni migración. `marked` y `muscleLoad` viajan en la columna `meta` (`api/row-meta.js`, `WORKOUT_COLUMNS` no los incluye).
- `start`: la regla actual de `markedDoneWorkout`. Mediodía del día; si es hoy y todavía no es mediodía, una hora antes de ahora, nunca antes de la medianoche local.
- Series vacías (`isEmptySet` con la config del ejercicio) no se guardan. Un ejercicio sin series no va a `entries`.
- `target`: la config del ejercicio en la rutina (modo, reps, etc.), como en un workout en vivo, para que `modeOf` y las etiquetas lean bien la sesión.
- `muscleLoad`: para la recuperación de un marcado sin series. Son los músculos con carga de `loadOfRoutine(routine)`, con la misma forma que el `muscleLoad` de las clases (`recovery.js:307`). Con series cargadas no se escribe: la recuperación usa las series.
- Marcar ya no escribe `dayPlan[iso] = { estado: 'completado' }`. Los valores viejos se siguen leyendo igual (`effectiveRoutineId`).
- Editar un marcado existente (paso 2 desde "＋ Cargar series") reemplaza sus `entries`, `vol` y `muscleLoad`, y mantiene `id`, `d`, `start` y `routineId`.

### Qué cuenta y dónde

| Consumidor | Marcado sin series | Marcado con series |
|---|---|---|
| Racha, semana, calendario, adherencia del profe | cuenta (día con workout) | cuenta |
| Récords, 1RM, progresión, "última vez", esfuerzo | nada (no hay series) | las series cargadas (datos reales) |
| Recuperación muscular | `muscleLoad` de la rutina | las series |
| Total del mes (tiempo) | 0 | 0 |
| Historial | etiqueta "Marcado" | etiqueta "Marcado" |

No hace falta filtrar en cada consumidor: todos leen series, y un marcado sin series no tiene.

### Datos viejos

Los workouts marcados antes de este cambio tienen series inventadas y no llevan marca. No se tocan: no hay forma segura de distinguirlos de uno real. Es una limitación conocida.

## Detalle de un marcado

`TrainingDetail` muestra la etiqueta "Marcado" y "＋ Cargar series" (abre el paso 2). Borrar sigue igual, con confirmación. "Repetir este entreno" solo aparece si tiene series.

## Archivos

- `frontend/src/components/day/DaySheet.jsx` (nuevo): hoja del día; elige el modo según la fecha. Reemplaza a `DayOverride`. `dayOverrideSheet` sigue exportado desde `sheets.jsx` con la misma firma, así los llamadores (`Home.jsx`, `CalendarSheet`) no cambian.
- `frontend/src/components/day/MarkedWorkoutEditor.jsx` (nuevo): paso 2, el acordeón en celular y lista + detalle en PC.
- `frontend/src/lib/marked-workout.js` (nuevo, puro): `buildMarkedWorkout`, el borrador del editor, el resumen de una fila y la inserción ordenada. Reemplaza a `markedDoneWorkout`, que se borra de `lib/history.js`. Va en un archivo propio porque `history.js` ya es muy grande.
- `frontend/src/sheets.jsx`: se saca `DayOverride`; `setEstado` deja de tocar `workouts`; `TrainingDetail` suma lo del marcado.
- Lista del historial: etiqueta "Marcado".
- `frontend/src/index.css`: estilos de la hoja y del editor.
- Textos: claves en español con `t('…')`. No hace falta tocar `locales/es.js`, porque una clave que no está se muestra tal cual.

## Pruebas

- **Unitarias** (`history.test.js`), sobre `buildMarkedWorkout`:
  - sin series: `entries: []`, `vol: 0`, `end === start`, `muscleLoad` presente;
  - series vacías descartadas;
  - modos reps, peso corporal, tiempo y cardio;
  - RIR o RPE según el ajuste;
  - `routineId` null en "Otra cosa";
  - `start` con la regla actual.
- **Unitarias:** `lastEntryFor` y `bestWeightFor` no leen un marcado sin series; sí leen uno con series.
- **Componente** (`DaySheet`):
  - un día pasado con un workout en vivo no ofrece nada que lo borre;
  - "Entrené" + "Marcar como entrenado" agrega un workout `marked` sin tocar los existentes;
  - un día futuro no ofrece marcar;
  - planificar hoy no borra workouts;
  - sin rutina planificada no hay preselección.
- **Componente** (editor):
  - las confirmaciones de quitar y cambiar, y cancelar no cambia nada;
  - cambiar borra las series;
  - la columna de esfuerzo aparece solo con el ajuste;
  - "Igual que la última vez" copia los valores;
  - guardar con todo vacío equivale a marcar.
- **Navegador** (dev):
  - celular con el ejercicio de abajo y el teclado;
  - PC lista + detalle con Tab y Enter;
  - modo claro y oscuro.

## Fuera de alcance

- "Deshacer" en el aviso (`toast` no admite acciones; se borra desde el detalle).
- Editar workouts registrados en vivo.
- Sugerencias de reemplazo (`ExerciseReplacementSheet`): solo la biblioteca.
- Corregir los marcados viejos.
- Calcular `prs` (los récords de la sesión) para un marcado: no hay festejo. Los récords derivados de series igual los cuentan.
