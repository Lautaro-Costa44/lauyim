# Auditoría y plan — sistema de entrenamiento (botón "Entrenar")

> Estado: **plan aprobado y verificado contra el código (§7), sin implementar**. Fecha: 2026-10-06.
> Origen: chat de auditoría con Claude (lauyim project). Este doc es la fuente de verdad para implementarlo
> (Claude Code / Codex / a mano). Ejecutar fase por fase, tests verdes en cada commit.

## 0. Alcance y archivos

Flujo auditado: tocar "Entrenar"/"Start" → `startFlow` → hoja de peso → `beginWorkout` → `ActiveWorkout` → marcar series / timers / supersets → `finishWorkout` → `doFinishWorkout` → `FinishSummary`.

| Archivo | Rol |
|---|---|
| `frontend/src/views/Workout.jsx` | `StartChooser`, `Elapsed`, `ExerciseBlock`, `ActiveWorkout`, `removeActiveExercise` |
| `frontend/src/sheets.jsx` (~L1387–1766) | `repeatWorkout`, `startFlow`, `beginWorkout`, `TopWeight`, notas, `WorkoutComplete`, `FinishSummary`, `finishWorkout`, `doFinishWorkout` |
| `frontend/src/store/useStore.js` (L354) | `update()` = `clone()` JSON de todo `S` + diff + persist + sync |
| `frontend/src/store/useUI.js` | rest timer (`startRest/stopRest/addRest`) y work timer (`startWork/stopWork`) |
| `frontend/src/components/RestTimer.jsx` | barra de descanso / trabajo |
| `frontend/src/lib/supersetFlow.js` | `setProgressHighWater`, `restAfterSet`, `restOnRecheck`, `supersetFlowStep` |
| `frontend/src/lib/history.js` | `lastEntryFor`, `bestWeightFor`, `pinnedNoteFor`, `buildSets`, `cascadeWeight`, `supersetUnits`, etc. |
| `frontend/src/components/TabBar.jsx` | botón central Start/Resume |
| `frontend/src/components/Media.jsx` | `Media` (gif/mapa) y `Thumb` (img estática, `loading="lazy"`) |
| `frontend/src/components/ExerciseReplacementSheet.jsx` | existe, hoy solo usado en `SurveyWizard` |
| `frontend/src/components/useDragReorder.js` | drag-reorder reutilizable |
| `frontend/public/sw.js` | `MEDIA_CACHE` (`lauyim-media-v1`, cache-first, máx 400 entradas) para `/img` y `/gif` |
| `frontend/src/index.css` (~L751–823) | `.wprog`, `.sethead`, `.setrow`, `.stp`, `.subrow` |

---

## 1. Hallazgos

### 🔴 Bugs graves

**B1 — Auto-cierre a las 2 h crashea** (`Workout.jsx` L311–329, llamada en L317)
- El efecto de montaje llama `doFinishWorkout(true)`, pero `doFinishWorkout` NO está exportado de `sheets.jsx` (L1732) ni importado en `Workout.jsx` → `ReferenceError` → ErrorBoundary.
- `S.active` no se limpia, así que vuelve a crashear cada vez que se monta `/workout`. Usuario trabado.
- Sin test que lo cubra.

**B2 — `lastActivity` nunca se persiste** (`Workout.jsx` L424)
- `A.lastActivity = Date.now()` se escribe sobre `A` (el `S.active` del render), no sobre el draft `s`. `update()` clona `S`, así que se pierde.
- Efecto: la regla de 2 h siempre mide desde `A.start`. El efecto corre en CADA montaje de `ActiveWorkout` (ir a Home y volver lo remonta) → sesiones activas de >2 h se auto-cierran (y por B1, crashean).

**B3 — El sheet "¡Es todo el entreno!" casi nunca aparece** (`Workout.jsx` L427)
- `allExercisesDone` se calcula con `A.entries` (estado viejo) dentro del mutador → la serie recién marcada todavía figura `done:false` → `workoutDone` siempre `false` al marcar la última serie.
- Solo "funciona" de rebote si el último ejercicio es con carga y abre `TopWeight` (que llama `workoutCompleteSheet` en `commit(true)`). Con cardio / isométrico / peso corporal al final, o si `e.asked` ya era true, nunca aparece.
- `Workout.test.jsx` mockea `workoutCompleteSheet` pero nunca lo asserta.

**B4 — Copy falso del aviso "Entrenamiento parcial"** (`Workout.jsx` L318–327)
- Si no había series hechas, el entreno se DESCARTA (`s.active = null`), pero igual dice "Se marcó tu entrenamiento como completado parcialmente…".
- Cuando sí finaliza, este sheet se abre después de `FinishSummary` y lo pisa (se pierde el resumen).

### 🟠 Bugs medios

**M1 — Work timer huérfano al descartar/terminar**
- Descartar (`Workout.jsx` L517) llama `stopRest()` pero no `stopWork()`. `doFinishWorkout` tampoco.
- Si un isométrico está corriendo, al terminar el callback (`startTimed`, L411–414) hace `useStore.getState().S.active.entries[idx]` con `active = null` → crash. `mutEntry` también asume `s.active`.

**M2 — "Quitar serie" borra datos sin confirmar** (`Workout.jsx` L358)
- `removeSet` hace `e.sets.pop()` aunque esa última fila esté `done` → se pierde lo registrado.

**M3 — Presencia en dashboard admin parpadea** (`Workout.jsx` L490–513)
- El cleanup del heartbeat manda `active:false` (sendBeacon + fetch) en cada unmount, y `ActiveWorkout` se desmonta al cambiar de pestaña con el entreno todavía activo → el socio aparece/desaparece de "entrenando ahora".

**M4 — Se puede marcar una serie vacía**
- `toggle` no valida: una serie con 0 kg / 0 reps (o sin reps) se guarda como hecha y ensucia historial y progresión.

### 🟡 Mejoras internas

**I1 — Rendimiento**
- Cada tap en un stepper → `update()` hace `clone(get().S)` + `clone(S)` (JSON de TODO el estado, historial incluido) + `diffState` + `persist` a localStorage.
- `ExerciseBlock` recalcula en cada render `bestWeightFor` (recorre todos los workouts), `lastEntryFor`, `pinnedNoteFor`.
- Con ~1 año de historial se nota lag en Android gama baja.
- Fix inmediato: memoizar esas lecturas por `[S.workouts, entry.id]`. A mediano plazo (fuera de este plan): slice propio para el entreno activo.

**I2 — Side effects dentro del mutador**: `beep`, `vibrate` y la mutación de `A` (L424–426) viven dentro de `update(s => …)`. Sacarlos afuera.

**I3 — Descanso único**: todo usa `S.restSec`. Falta descanso por ejercicio y descanso más corto tras warm-up.

**I4 — i18n mezclado**: `'Entrenamiento parcial'`, `'Se marcó tu entrenamiento…'`, `'Okey'` son claves en español mientras el resto son claves en inglés. Pasar a claves en inglés + traducciones en `locales/*`.

### 🎨 Visual / UX

- **V1** Con RIR/RPE activo (`.eff3`) los botones del stepper quedan en 20–23 px (`index.css` L814–815). Muy chicos para el gym. Objetivo ≥ 40 px.
- **V2** "+ Drop / + Burst" se dibujan bajo CADA serie de trabajo → mucho ruido visual.
- **V3** La ✕ arriba a la izquierda DESCARTA el entreno; la mayoría la lee como "cerrar/minimizar".
- **V4** No hay vista general: solo "Exercise 3/7" y Prev/Next al fondo de la tarjeta (hay que scrollear).
- **V5** No se puede reemplazar ni reordenar un ejercicio a mitad de sesión. `ExerciseReplacementSheet` existe pero no se usa en Workout.
- **V6** Al terminar cardio/isométrico solo sale un toast; las pesas avanzan vía `TopWeight` ("Save & next exercise"). Inconsistente.
- **V7** Las filas de warm-up tienen un ✕ extra que no está en `.sethead` → steppers desalineados respecto del header.
- **V8** Series hechas con `opacity: .45` (`.setrow.done`) → se lee mal lo que hiciste.

---

## 2. Decisiones tomadas (Lautaro)

1. **Switch "Pedir peso"**: se queda como está (aparece al tocar Entrenar). NO tocar.
2. **Peso corporal**: se sigue pidiendo en CADA entreno; el switch sigue visible; debe existir la opción de **no pesarse esta vez** (saltear solo esta sesión, sin apagar el switch). Verificar si `BwSheet` ya lo permite con `required: true`; si no, agregar botón "Ahora no" que llama `beginWorkout(routineId, null)` sin registrar pesaje.
3. **Tira de ejercicios**: **cerrada por defecto**.
4. **RIR/RPE**: se carga **tocando el número → selector rápido** (no tercer stepper).
5. **Miniaturas de la tira**: imagen estática (primer frame), ver §4.
6. Implementar en una **rama git** propia, un commit por fase.
7. Todo lo de §1 entra (bugs graves, medios, internas, visual/UX), excepto el switch.

---

## 3. Swipe para cambiar de ejercicio

**Comportamiento**
- Deslizar horizontal sobre la tarjeta del ejercicio → anterior / siguiente **unidad** (`supersetUnits`): un superset A+B es una sola página.
- La tarjeta sigue al dedo (`translateX`); al soltar: cambia si `|dx| > 25%` del ancho o velocidad > ~0.5 px/ms; si no, vuelve con animación.
- Resistencia elástica en el primer y último ejercicio (dx × 0.3).
- `vibrate(10)` al cambiar.
- `prefers-reduced-motion`: cambio instantáneo, sin animación de seguimiento.

**Cuándo NO se activa**
- Gesto más vertical que horizontal (decidir en los primeros ~10 px: `|dy| > |dx|` → es scroll, soltar el gesto).
- Si el pointerdown arranca sobre `button, input, textarea, select, .stp, .chip, [role=checkbox], .setrow` (o `closest('[data-noswipe]')`).
- Si arranca a < 20 px del borde izquierdo (gesto "atrás" de iOS).
- Si hay un work timer (isométrico) corriendo.
- Si hay un sheet abierto.

**Implementación**
- Hook nuevo `frontend/src/lib/useSwipeNav.js` con Pointer Events, sin dependencias. API sugerida: `useSwipeNav(ref, { canPrev, canNext, onPrev, onNext, disabled })` → devuelve `dx` / estado para el style.
- CSS: `touch-action: pan-y` en el contenedor; `will-change: transform` solo durante el drag.
- Prev/Next se mantienen como botones (accesibilidad), más chicos y **fijos abajo** (sticky, por encima del `#timer`, respetando `body.resting`).
- Tests: lógica pura de decisión (umbral, ángulo, elementos excluidos, bordes) separada del hook para testearla sin DOM.

## 4. Tira de ejercicios (desplegable)

**Cerrada (default)**
- La `.wprog` actual pasa a ser **segmentada: un segmento por unidad** (hecho = acento, actual = acento con borde/pulso suave, pendiente = surface-2). Mismos ~4 px de alto → no agrega ruido.
- Debajo, el texto "Ejercicio 3/7 ▾" (o "Superset 2/5 ▾") tocable.
- Tocar la barra o el texto → abre la tira.

**Abierta**
- Fila horizontal scrolleable de miniaturas + nombre corto, con estado (✓ hecho, ● actual, pendiente). Superset = miniaturas agrupadas con el ícono de link.
- Tap en miniatura → salta a esa unidad y la tira se cierra sola.
- Long-press + arrastrar → **reordenar** (reusar `useDragReorder`). Debe respetar supersets (mover la unidad entera) y ajustar `s.active.cur` + `cleanupSg`.
- Botón "⋯" por miniatura → **Reemplazar** (`ExerciseReplacementSheet`, conserva sets/target razonables del nuevo ejercicio vía `buildSets`) y **Quitar** (`confirmRemoveExercise`).
- La tira auto-scrollea para mantener visible la unidad actual y se sincroniza con el swipe.
- Componente nuevo: `frontend/src/components/ExerciseStrip.jsx`.

**Miniaturas — decisión: imagen estática (primer frame), nunca gif animado en la tira**
- Motivo: N gifs animados a la vez = muchos MB, CPU/batería y ruido visual; el gif ya se reproduce en la tarjeta principal.
- Usar `Thumb` de `Media.jsx` (`imgSrc(ex)`, `loading="lazy"`, `decoding="async"`); fallback al ícono (`thumb-x`) si no hay img, gifs apagados (`EXERCISE_GIFS`) o falla la carga (`onError`).
- Ejercicios custom (sin img): ícono o mini mapa muscular simplificado (ícono por defecto; mapa solo si es barato).
- Por situación de red:
  - **Offline**: el SW sirve `/img` desde `MEDIA_CACHE` si ya se vio; si no está cacheada → `onError` → ícono. Nunca spinner infinito.
  - **Datos móviles / `navigator.connection.saveData` / `effectiveType` 2g–3g**: solo miniaturas estáticas al abrir la tira, sin precarga.
  - **Wi-Fi / 4g sin saveData**: al iniciar el entreno, precargar en idle (`requestIdleCallback`) las `img` de todas las unidades y el **gif de la siguiente unidad**, para que el swipe se sienta instantáneo.
- Helper sugerido: `lib/net.js` → `canPrefetch()` (online && !saveData && effectiveType ∉ {slow-2g, 2g, 3g}; si la API no existe → true).

**Futuro (fuera de este plan)**: abrir la tira tirando la pantalla hacia abajo (requiere `overscroll-behavior: contain` y choca con pull-to-refresh de Android).

---

## 5. Plan de implementación por fases

Rama: `feat/workout-audit`, creada desde `main` (que ya contiene `feat/demo-seed`). Un commit por fase. `vitest` verde antes de cada commit. **Ver §7: ajustes de la verificación, que pisan lo que diga esta sección.**

### Fase 1 — Bugs graves (B1–B4 + M1)
- Exportar `doFinishWorkout` de `sheets.jsx` (o exponer `finishWorkout({ silent, partial })`) e importarlo en `Workout.jsx`.
- Mover `lastActivity` al draft: dentro de `mutEntry`/`toggle` usar `s.active.lastActivity = Date.now()`. Actualizar también en `setField`, `addSet`, etc. (cualquier interacción cuenta como actividad).
- Calcular `allExercisesDone` sobre `s.active.entries` (draft) o sobre `useStore.getState().S.active` después del update.
- Auto-cierre 2 h: si hay series hechas → finalizar como parcial y mostrar UN solo sheet (el resumen con una línea "Se cerró por inactividad"); si no hay series → descartar y mostrar copy correcto ("Se descartó el entreno: no había series registradas y pasaron más de 2 h sin actividad"). No abrir dos sheets.
- `stopWork()` en descartar y en `doFinishWorkout`. En el callback de `startTimed` y en `mutEntry`: guard `if (!s.active?.entries?.[idx]) return`.
- Tests de regresión: auto-cierre con series (no crashea, guarda workout), auto-cierre sin series (descarta, copy correcto), `lastActivity` persistido, `workoutCompleteSheet` llamado al marcar la última serie de un ejercicio cardio/isométrico/peso corporal, descartar con work timer corriendo no crashea.

### Fase 2 — Bugs medios (M2–M4)
- `removeSet`: si la última fila está `done` → `confirmSheet` antes de borrar.
- Validación al marcar: reps-mode con `r` vacío/0 (o carga requerida y `w` 0 en ejercicio no-bodyweight) → `confirmSheet` "Esta serie está vacía. ¿Marcar igual?". Cardio: `min` 0. Time: `sec` 0.
- Heartbeat: el cleanup del effect solo detiene el intervalo; `active:false` se envía únicamente al descartar o terminar (y el `sendBeacon` en `pagehide`, no en unmount).
- Tests para cada uno.

### Fase 3 — Internas (I1, I2, I4)
- `useMemo` para `bestWeightFor`, `lastEntryFor`, `pinnedNoteFor`, `exNoteFor` con deps `[S.workouts, S.exNotes, entry.id]`.
- Sacar `beep`/`vibrate`/cualquier side effect fuera de los mutadores de `update`.
- Claves i18n en inglés + entradas en `locales/*` para los textos nuevos y los de B4.

### Fase 4 — Descanso (I3)
- Campo opcional `restSec` por ejercicio en `ExConfig` (`sheets.jsx`), con Stepper; vacío = usa `S.restSec`.
- Helper `restFor(entry, set, S)`: `entry.target.restSec ?? S.restSec`; si la serie recién hecha es warm-up → 50% (mínimo 15 s, respetando "Off" si `S.restSec` es 0).
- Reemplazar todos los `startRest(S.restSec)` de `toggle` por `startRest(restFor(...))`.
- Tests del helper.

### Fase 5 — UX de filas (V1, V2, V7, V8)
- Steppers con área táctil ≥ 40 px (aunque el ícono sea chico). Revisar layout a 360 px.
- RIR/RPE: la columna muestra el número (o "–"); al tocar abre un popover/sheet compacto con chips (RIR 0–5, RPE 6–10 con medios si `EFFORT` lo define) + "Borrar". Reusar `capEffort`/`EFFORT`.
- Drop/Burst: mover a un menú "⋯" por fila (o mostrar solo en la última serie hecha / la actual). Las filas que ya tienen drops/bursts los siguen mostrando.
- Columna fija para el ✕ de warm-up (placeholder del mismo ancho en filas de trabajo y en `.sethead`).
- Serie hecha: sin opacidad; número con fondo acento + tilde, fondo de fila tenue de acento, texto legible.

### Fase 6 — Encabezado y navegación (V3, V4) + §3 + §4
- Header: la ✕ se reemplaza por botón "⋯" con menú: Descartar entreno (rojo, con confirm), Nota de la sesión (opcional), etc. El ✓ de terminar se queda.
- `.wprog` segmentada + "Ejercicio N/M ▾" → `ExerciseStrip` (cerrada por defecto).
- `useSwipeNav` sobre la tarjeta.
- Prev/Next sticky abajo.
- Precarga según red (`lib/net.js`).

### Fase 7 — Reemplazar y reordenar (V5)
- Desde la tira: Reemplazar (`ExerciseReplacementSheet`) y Reordenar (`useDragReorder`), manteniendo supersets, `cur` y `progressHighWater` (re-baseline como ya se hace al cambiar el largo).
- Lógica pura en `history.js` (`moveUnit`, `replaceEntry`) con tests.

### Fase 8 — Avance uniforme (V6)
- Al completar la última serie de una unidad singleton que NO abre `TopWeight` (cardio, isométrico, peso corporal, o ya `asked`) y no es la última → avanzar a la siguiente unidad automáticamente (con el descanso corriendo), igual que "Save & next exercise".
- Mantener el toast ("Cardio logged" / "Hold logged") como confirmación.

### Fase 9 — Peso corporal "esta vez no"
- Según decisión §2.2: en `BwSheet` (cuando viene de `startFlow`) agregar "Ahora no / no pesarme esta vez" → `beginWorkout(routineId, null)` sin registrar pesaje ni apagar el switch.

### Cierre
- Correr toda la suite (`frontend`: vitest).
- Probar en dev (`dev.lauyim.online`) en un teléfono real: swipe, tira, offline (modo avión), RIR selector, supersets, isométrico + descartar, sesión > 2 h (simular cambiando `start`/`lastActivity`).
- Actualizar este doc con el estado de cada fase.

---

## 6. Notas de entorno / git (importante)

- El repo en Windows tiene finales de línea CRLF; desde Linux/WSL `git status` muestra ~398 archivos "modificados" con inserciones = borrados (solo EOL). Usar `git -c core.autocrlf=true …` desde Linux o trabajar desde Windows. **No commitear esos cambios de EOL.**
- Durante la auditoría quedó un **`.git/index.lock` vacío** (creado por un `git status` desde la sesión remota que no tenía permiso de borrado). Si git dice "index.lock exists", borrarlo a mano: `Remove-Item .git\index.lock` (PowerShell), verificando antes que no haya otro proceso git corriendo.
- `CLAUDE.md`: respuestas ultra breves; no hacer escaneos globales (`find`, `ls -R`).
- Preferencias de trabajo: plan → aprobación → código; cambios quirúrgicos, comentarios mínimos; decir cómo probar.

---

## 7. Verificación contra el código (2026-10-06, Claude Code, rama `feat/workout-audit`)

Se releyó cada hallazgo en `main` @ `6bb0502`. Los números de línea de §1 siguen siendo correctos.

### Confirmados sin cambios
B1, B2, B3, B4, M1, M2, M4, V1–V8: confirmados tal cual están descritos.

### Correcciones al plan

**C1 — Fase 9 ya está hecha.** `BwSheet` (`sheets.jsx` L166, L201) ya tiene el botón "Start without weighing in", que llama `finish(null)` → `beginWorkout(routineId, null)` sin registrar pesaje ni tocar el switch. La fase 9 se reduce a un test de regresión que lo cubra.

**C2 — M3: el servidor ya expira la presencia sola.** `api/server.js` L1081: `PRESENCE_TTL = 70000`. Solo quitar el `active:false` del cleanup no alcanza: al ir a Home se dejan de mandar pings y el socio desaparece a los 70 s igual. Fix correcto: sacar el heartbeat de `ActiveWorkout` a un hook de nivel app (`useWorkoutPresence`, montado en el layout) que corre mientras exista `S.active`, sin importar la pestaña. `active:false` solo al descartar / terminar.

**C3 — I1: `useMemo` con `[S.workouts]` no sirve.** `update()` clona todo `S` por JSON, así que `S.workouts` es un array nuevo en CADA tap y el memo se invalida siempre. Usar una clave estable: `S.workouts.length + ':' + (último workout).id` (más `S.exWeights[id]?.w` y `S.exNotes?.[id]` para lo que dependa de eso).

**C4 — I4: no hacer barrido global de claves.** El código ya usa muchas claves en español (`repeatWorkout`, `BwSheet`, `StartChooser`) y solo existe `locales/es.js`. Regla: los textos nuevos o reescritos en este plan usan clave en inglés + entrada en `es.js`. Los de B4 entran porque se reescriben. Nada más.

### Hallazgos nuevos

**N1 — El auto-cierre registra una duración falsa.** `doFinishWorkout` usa `end: Date.now()`. Si el socio vuelve al día siguiente, el entreno queda con ~14 h de duración. Fix (fase 1): `doFinishWorkout(partial, { end, reason })`; en el auto-cierre, `end = A.lastActivity || A.start`. Sesiones viejas sin `lastActivity` (todas hoy, por B2) quedan con duración 0, aceptable.

**N2 — La regla de 2 h solo se evalúa al montar.** Si la app queda abierta en `/workout` (wake lock) y se vuelve horas después, no se cierra hasta un remount. Fix (fase 1): evaluar también en `visibilitychange` → visible.

**N3 — El callback del work timer usa un `toggle` viejo.** `startTimed` cierra sobre el `toggle` del render en que arrancó la serie: `A`, `S.restSec`, `S.sound` son los de ese momento. Fix (fase 1): `toggle` lee `useStore.getState().S` en vez del closure (esto también resuelve B3 de raíz).

**N4 — Reordenar / reemplazar corren índices igual que quitar.** `removeActiveExercise` llama `stopWork()` antes de mover índices. Reordenar y reemplazar (fase 7) tienen que hacer lo mismo (o estar deshabilitados con un isométrico corriendo, como "Remove exercise").

**N5 — `useDragReorder` es solo vertical** (`clientY`, mitades por `top`). En una tira horizontal no funciona sin un parámetro de eje. Además, long-press + arrastrar dentro de un contenedor con scroll horizontal choca con el pan nativo del navegador (Android toma el gesto antes de que el long-press se active). Ver decisión pendiente D1.

**N6 — `ExerciseReplacementSheet` necesita `poolSeguro` y `usadosEnSemana`** y su buscador solo busca en el mismo grupo muscular. En el entreno: `poolSeguro` = biblioteca completa (`EX`), `usadosEnSemana` = ids de la sesión actual, `tipo` = `'cardio'` si el modo es cardio, si no `'normal'`. Si el ejercicio a reemplazar tiene series hechas → confirm ("se pierden las series registradas"), igual que Quitar.

**N7 — Tests.** `Workout.test.jsx` mockea `sheets.jsx`: al importar `doFinishWorkout` hay que agregarlo al mock. Los tests nuevos de fase 1 van en `Workout.test.jsx` (flujo) y `finish-workout.test.js` (duración / razón).

### Decisiones
- **D1 — Reordenar: (b), decidido 2026-10-06.** Botón "Reordenar" en la tira que abre un sheet con la lista vertical y manijas, reusando `useDragReorder` sin cambios. Reemplaza el long-press + arrastrar de §4.

### Estado de fases
| Fase | Estado |
|---|---|
| 1 Bugs graves + N1–N3 | hecho: `closeStaleWorkout` en `sheets.jsx`, `lastActivity` en el draft, `toggle` lee el store, `stopWork` al descartar/terminar. Tests en `Workout.test.jsx`, `stale-workout.test.jsx` y `finish-workout.test.js` |
| 2 Bugs medios (M3 según C2) | pendiente |
| 3 Internas (I1 según C3, I4 según C4) | pendiente |
| 4 Descanso | pendiente |
| 5 UX de filas | pendiente |
| 6 Encabezado, tira, swipe | pendiente |
| 7 Reemplazar / reordenar (N4–N6, D1) | pendiente |
| 8 Avance uniforme | pendiente |
| 9 Peso "esta vez no" | ya implementado (C1); falta test |
