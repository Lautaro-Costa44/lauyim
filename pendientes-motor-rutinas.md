# Pendientes — Motor de rutinas openGym

Dos temas en este documento: (1) el nuevo split "Piernas y glúteos" como distribución de días, (2) 5 fixes técnicos detectados en la revisión de `generarRutina.js` / `SurveyWizard.jsx` / `exercises.js`.

---

## 1. Nuevo split: "Piernas y glúteos" (pierna_prioridad)

Hoy `enfoque: piernas_gluteos` solo suma +30% de series a `quads`/`glutes` dentro del split ya elegido. Pasa a ser, además, una distribución de **días completos**: una porción de la semana es 100% pierna, el resto es torso de mantenimiento.

**Distribución: 60% días de pierna / 40% días de torso.**

| Días totales | Días de pierna | Días de torso |
|---|---|---|
| 2 | 1 | 1 |
| 3 | 2 | 1 |
| 4 | 2 | 2 |
| 5 | 3 | 2 |
| 6 | 4 | 2 |
| 7 | 4 | 3 |

```js
function diasPiernaTorso(totalDias) {
  const diasPierna = Math.max(1, Math.min(totalDias - 1, Math.round(totalDias * 0.6)))
  return { diasPierna, diasTorso: totalDias - diasPierna }
}
```

Con 1 solo día, sigue rigiendo la regla existente (fuerza `fullbody`, sin excepción).

**Rotación entre los días de pierna** (para no repetir la misma sesión si `diasPierna > 1`):
1. Cuádriceps-dominante (sentadilla / prensa / extensión)
2. Bisagra de cadera / isquios (peso muerto rumano, curl femoral)
3. Glúteo aislado / unilateral (hip thrust, zancadas, abducción)

Si `diasPierna` supera 3, repetir el ciclo desde el punto 1.

**Implementación sugerida:**
- Nuevo valor de `split` interno: `'pierna_prioridad'`, generado solo cuando `enfoque === 'piernas_gluteos'` (en `derivarSplit` o como capa aparte antes de `buildRoutineNames`).
- `buildRoutineNames` nuevo caso: nombres `"Pierna — Cuádriceps"`, `"Pierna — Isquios/Glúteo"`, `"Pierna — Unilateral"`, `"Torso"`.
- `calcularDistribucionMuscular` nuevo caso por cada tipo de día de pierna (cuotas de `quads`/`hamstrings`/`glutes`/`calves`/`adductors`/`abductors` variando el énfasis según el tipo), y un caso `torso` de mantenimiento balanceado (`pectorals`/`lats`/`delts`/`biceps`/`triceps` parejo, sin el +30% — la priorización ya está dada por la cantidad de días, no por más series).
- El enfoque `torso_brazos` y `balance` **no cambian** — siguen siendo el modificador +30% de siempre, dentro del split que el usuario haya elegido.

---

## 2. Cantidad de ejercicios según tiempo — hoy ignora `descansoSegundos`

`SLOTS_POR_TIEMPO` es una tabla fija (4/5/6/7 ejercicios) que no cambia con el descanso elegido. Reemplazar por fórmula:

```js
const SERIES_POR_TIEMPO   = { '30-40': 3, '40-60': 3, '60-90': 4, '90+': 4 }
const MINUTOS_POR_TIEMPO  = { '30-40': 35, '40-60': 50, '60-90': 75, '90+': 100 }
const DESCANSO_SEG        = { '60': 60, '90-120': 105, '180+': 180 }
const CALENTAMIENTO_SEG = 300
const TRABAJO_SERIE_SEG = 40
const TRANSICION_SEG    = 60

function calcularCantidadEjercicios(tiempoPorSesion, descansoSegundos) {
  const series      = SERIES_POR_TIEMPO[tiempoPorSesion] || 3
  const sesionMin   = MINUTOS_POR_TIEMPO[tiempoPorSesion] || 50
  const descanso    = DESCANSO_SEG[descansoSegundos] || 90
  const disponible  = sesionMin * 60 - CALENTAMIENTO_SEG
  const porEjercicio = series * (TRABAJO_SERIE_SEG + descanso) + TRANSICION_SEG
  return Math.max(3, Math.min(10, Math.floor(disponible / porEjercicio)))
}
```

Resultado esperado (cantidad de ejercicios de fuerza, cardio/movilidad se agregan aparte):

| Tiempo/sesión | 60s descanso | 90-120s descanso | 180+s descanso |
|---|---|---|---|
| 30-40 min | 5 | 3 | 3 |
| 40-60 min | 7 | 5 | 3 |
| 60-90 min | 9 | 6 | 4 |
| 90+ min | 10 | 8 | 6 |

Reemplaza el uso de `SLOTS_POR_TIEMPO[tiempoPorSesion].ejercicios` en `generarRutina()`; `series` sigue saliendo de `SERIES_POR_TIEMPO` (mismo valor que ya usaba la tabla vieja).

---

## 3. Fallback de pool vacío por `tg` — no usa sustitución anatómica

En `seleccionarEjerciciosNormales`, cuando `candidatos` (filtrado por `tg`) da 0, cae directo a "cualquier ejercicio del pool sin usar", ignorando el músculo. Agregar tabla de sustitución y probarla antes del fallback genérico:

```js
const TG_SUSTITUTO = {
  quads: ['hamstrings', 'glutes', 'calves'],
  hamstrings: ['glutes', 'quads', 'calves'],
  glutes: ['hamstrings', 'adductors', 'abductors', 'quads'],
  adductors: ['abductors', 'glutes'],
  abductors: ['adductors', 'glutes'],
  calves: ['quads', 'hamstrings'],
  pectorals: ['delts', 'triceps'],
  lats: ['upper back', 'traps', 'biceps'],
  'upper back': ['lats', 'traps', 'delts'],
  traps: ['upper back', 'delts'],
  delts: ['pectorals', 'upper back', 'traps'],
  biceps: ['forearms', 'lats'],
  triceps: ['pectorals', 'delts'],
  forearms: ['biceps'],
  abs: ['spine'],
  spine: ['abs'],
  'serratus anterior': ['abs', 'upper back'],
  'levator scapulae': ['traps'],
}

function candidatosConSustitucion(poolSeguro, tg, usadosEsteDia) {
  let candidatos = poolSeguro.filter(e => e.tg === tg && !usadosEsteDia.has(e.id))
  if (candidatos.length > 0) return candidatos

  for (const sustituto of TG_SUSTITUTO[tg] || []) {
    candidatos = poolSeguro.filter(e => e.tg === sustituto && !usadosEsteDia.has(e.id))
    if (candidatos.length > 0) return candidatos
  }

  // último recurso: cualquier ejercicio no usado (como está hoy)
  return poolSeguro.filter(e => !usadosEsteDia.has(e.id))
}
```

Reemplaza las líneas 254-255 actuales de `generarRutina.js`.

---

## 4. `metricaEsfuerzo` y `tipoProgresion` no llegan al ejercicio generado

Los objetos en `normales.map(...)` no incluyen esfuerzo ni progresión, a pesar de pedirse en la encuesta. Agregar:

```js
const VALOR_ESFUERZO = {
  rir: '1-2',
  rpe: '8-9',
  porcentaje_rm: '70-80%',
}

// dentro del map de `normales`:
{
  id: ex.id,
  sets: nSeries,
  reps: parseInt(reps.split('-')[0], 10) || 10,
  weight: 0,
  exerciseId: ex.id,
  series: nSeries,
  repeticiones: reps,
  isNormal: true,
  metrica: respuestas.metricaEsfuerzo,
  valorEsfuerzo: VALOR_ESFUERZO[respuestas.metricaEsfuerzo] || null,
  progresion: respuestas.tipoProgresion,
}
```

**Además, corregir el bug de `st.effort` en `SurveyWizard.jsx`:** hoy `metricaEsfuerzo.startsWith('rpe') ? 'rpe' : 'rir'` manda `porcentaje_rm` a `'rir'` de forma silenciosa. Cambiar a un mapeo explícito de los 3 valores (`rir` / `rpe` / `porcentaje_rm`) sin default incorrecto.

---

## 5. Traducciones ES faltantes para los 3 ids de cardio custom

`CUSTOM_CARDIO_EXERCISES` (en `exercises.js`) no tiene entradas en `exercise-names-es.js`, así que se muestran en inglés. Agregar:

```js
// en exercise-names-es.js
cardio_treadmill: 'Caminadora / Cinta de correr',
cardio_bike: 'Bicicleta fija',
cardio_stairmaster: 'Escaladora / Stairmaster',
```

(Mismas cadenas ya usadas en `MOCK_DICT_ES` de `generarRutina.test.js` — usar esas exactas para consistencia con los tests existentes.)

---

## 6. Usar `CATALOGUE` en vez de `EXDB` crudo como input de `generarRutina()`

`SurveyWizard.jsx` importa `EXDB` (dataset crudo, sin las correcciones de músculo de `exercise-muscle-batch-1.js`) y se lo pasa a `generarRutina()`. El motor filtra y selecciona por `tg`/`bp`, así que cualquier corrección de tag que exista en `CATALOGUE` no se está aplicando en la generación.

```js
// SurveyWizard.jsx
- import { EXDB } from '../lib/exercises.js'
+ import { CATALOGUE } from '../lib/exercises.js'
...
- const rutinaGenerada = generarRutina(respuestas, EXDB)
+ const rutinaGenerada = generarRutina(respuestas, CATALOGUE)
```

Y en `generarRutina.js`, la línea `const dbCompleta = [...exerciseDB, ...CUSTOM_CARDIO_EXERCISES]` queda redundante (CATALOGUE ya incluye el cardio custom) — se puede simplificar a `const dbCompleta = exerciseDB` una vez hecho el cambio de arriba.
