# Marcar un día como realizado: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar la hoja del día por una que registra sin borrar nunca nada, con un editor opcional de series (acordeón en el celular, lista + detalle en PC) y workouts marcados con `marked: true` en vez de series inventadas.

**Architecture:**
- La lógica pura vive en un archivo nuevo, `frontend/src/lib/marked-workout.js`: arma el workout, el borrador del editor, el resumen y la inserción ordenada.
- La hoja del día sale de `sheets.jsx` a `frontend/src/components/day/DaySheet.jsx`. El editor de series va en `frontend/src/components/day/MarkedWorkoutEditor.jsx`.
- `sheets.jsx` sigue exportando `dayOverrideSheet` con la misma firma.
- El servidor no cambia: `marked` y `muscleLoad` viajan en la columna `meta`.

**Tech Stack:** React 18 + Zustand (`useStore.update` con mutación sobre un clon), Vitest + happy-dom, CSS plano en `frontend/src/index.css`.

**Spec:** `docs/superpowers/specs/2026-10-08-marcar-realizado-design.md`

## Global Constraints

- Producto siempre "lauyim" en minúscula.
- Textos de UI en español rioplatense (voseo: "Elegí", "Agregá"), con `t('…')`. Una clave en español que no está en `locales/es.js` se muestra tal cual (`i18n-core.js:27`), así que **no hace falta tocar `es.js`**. Reusar claves en inglés existentes cuando ya están (`t('Cancel')`, `t('Freestyle')`, `t('{0} sets', n)`).
- Comentarios en español, con la densidad del código de alrededor.
- Sin dependencias nuevas. Sin cambios en `api/`.
- Un día pasado **nunca** borra workouts desde la hoja del día. Planificar (`dayPlan`) **nunca** toca `workouts`.
- Corte de PC: `(min-width: 700px)`, el mismo del panel centrado (`Modals.jsx:11`, `index.css:1888`).
- Tests: `cd frontend && npx vitest run <archivo>`. Suite completa: `cd frontend && npm test`.
- Commits en inglés, Conventional Commits, terminados con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- No hacer push ni merge: lo pide el usuario.

## Mapa de archivos

| Archivo | Qué hace |
|---|---|
| `frontend/src/lib/marked-workout.js` (nuevo) | Lógica pura: `dayMode`, `columnsFor`, `markedSetOf`, `markedRowOf`, `buildMarkedWorkout`, `markedDraft`, `itemSummary`, `putWorkout`, `modeTag` |
| `frontend/src/lib/marked-workout.test.js` (nuevo) | Tests unitarios de lo anterior |
| `frontend/src/components/day/DaySheet.jsx` (nuevo) | Hoja del día: registrar (pasado/hoy), planificar (hoy/futuro), clases |
| `frontend/src/components/day/DaySheet.test.jsx` (nuevo) | Tests de la hoja, del calendario, de la fila del historial y del detalle |
| `frontend/src/components/day/MarkedWorkoutEditor.jsx` (nuevo) | Editor de series + `markedEditorSheet` |
| `frontend/src/components/day/MarkedWorkoutEditor.test.jsx` (nuevo) | Tests del editor |
| `frontend/src/sheets.jsx` | Saca `DayOverride`; `dayOverrideSheet` usa `DaySheet`; el calendario abre siempre la hoja; `WorkoutRow` y `TrainingDetail` conocen el marcado |
| `frontend/src/lib/history.js` | Se borra `markedDoneWorkout` (Task 4) |
| `frontend/src/lib/history.test.js`, `frontend/src/lib/recovery.test.js` | Se adaptan al borrar `markedDoneWorkout` |
| `frontend/src/views/HomeClasses.test.jsx` | Se corrige el test que fijaba el bug (descanso borraba el entreno) |
| `frontend/src/index.css` | Estilos `.mwe-*` (editor) y `.day-*` (hoja) |

---

### Task 1: Lógica pura del día marcado

**Files:**
- Create: `frontend/src/lib/marked-workout.js`
- Test: `frontend/src/lib/marked-workout.test.js`

**Interfaces:**
- Consumes: `modeOf`, `isBw`, `isEmptySet`, `workoutVolume`, `setLabel`, `EFFORT`, `capEffort` (de `lib/history.js`); `loadOfRoutine` (de `lib/muscles.js`); `localDayStartOf`, `localNoonOf`, `workoutTime` (de `lib/format.js`).
- Produces:
  - `dayMode(iso: string, today: string): 'past'|'today'|'future'`
  - `columnsFor(cfg: object, effort: 'none'|'rir'|'rpe'): string[]`: campos de set en orden de columna.
  - `markedSetOf(row: object, cfg: object, effort: string): object|null`: fila del editor (valores string) a set `{ done: true, … }`, o null si quedó vacía.
  - `markedRowOf(set: object): object`: set guardado a fila del editor (valores string).
  - `buildMarkedWorkout(iso, { routine?, routineId?, name, items?, effort? }, { id, now?, start? }): object`, donde `items` es `[{ id, cfg, rows }]`.
  - `markedDraft({ routine?, workout? }): Array<{ key, id, cfg, rows }>`
  - `itemSummary(item, effort): { count: number, text: string }`
  - `putWorkout(list: object[], w: object): object[]`: reemplaza por id (conserva `note`) o inserta en orden por `workoutTime`. Muta `list`.
  - `modeTag(cfg): 'peso corporal'|'tiempo'|'cardio'|null`, sin traducir. El llamador hace `t()`.

- [ ] **Step 1: Write the failing tests**

Crear `frontend/src/lib/marked-workout.test.js`:

```js
import { describe, expect, it } from 'vitest'
import { localDayStartOf, localNoonOf } from './format.js'
import { buildMarkedWorkout, columnsFor, dayMode, itemSummary, markedDraft, markedRowOf, markedSetOf, modeTag, putWorkout } from './marked-workout.js'

const HOUR = 3600000
const localAt = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime()
const bench = { id: '0025', sets: 2, reps: 8, weight: 60 }
const routine = { id: 'push', name: 'Push A', ex: [bench, { id: '0024', sets: 3 }] }

describe('dayMode', () => {
  it('pasado, hoy o futuro respecto de hoy', () => {
    expect(dayMode('2026-10-04', '2026-10-05')).toBe('past')
    expect(dayMode('2026-10-05', '2026-10-05')).toBe('today')
    expect(dayMode('2026-10-06', '2026-10-05')).toBe('future')
  })
})

describe('columnsFor', () => {
  it('reps: kg y reps; con esfuerzo, la columna al final', () => {
    expect(columnsFor({ id: '0025' }, 'none')).toEqual(['w', 'r'])
    expect(columnsFor({ id: '0025' }, 'rir')).toEqual(['w', 'r', 'rir'])
    expect(columnsFor({ id: '0025' }, 'rpe')).toEqual(['w', 'r', 'rpe'])
  })
  it('tiempo: segundos y kg; cardio: minutos y velocidad, sin esfuerzo', () => {
    expect(columnsFor({ id: '0025', mode: 'time' }, 'rir')).toEqual(['sec', 'w', 'rir'])
    expect(columnsFor({ id: '0025', mode: 'cardio' }, 'rir')).toEqual(['min', 'speed'])
  })
})

describe('markedSetOf / markedRowOf', () => {
  it('pasa la fila a números, con coma decimal', () => {
    expect(markedSetOf({ w: '62,5', r: '8' }, { id: '0025' }, 'none')).toEqual({ done: true, w: 62.5, r: 8 })
  })
  it('una fila vacía o incompleta no es una serie', () => {
    expect(markedSetOf({}, { id: '0025' }, 'none')).toBeNull()
    expect(markedSetOf({ r: '8' }, { id: '0025' }, 'none')).toBeNull()            // reps con carga: falta el peso
    expect(markedSetOf({ w: 'abc', r: '8' }, { id: '0025' }, 'none')).toBeNull()
  })
  it('peso corporal: alcanzan las reps (w queda en 0)', () => {
    expect(markedSetOf({ r: '12' }, { id: '0025', bodyweight: true }, 'none')).toEqual({ done: true, r: 12, w: 0 })
  })
  it('el esfuerzo se guarda solo con el ajuste, y se topea', () => {
    expect(markedSetOf({ w: '60', r: '8', rir: '2' }, { id: '0025' }, 'rir')).toEqual({ done: true, w: 60, r: 8, rir: 2 })
    expect(markedSetOf({ w: '60', r: '8', rir: '2' }, { id: '0025' }, 'none')).toEqual({ done: true, w: 60, r: 8 })
    expect(markedSetOf({ w: '60', r: '8', rir: '14' }, { id: '0025' }, 'rir').rir).toBe(10)
  })
  it('tiempo y cardio', () => {
    expect(markedSetOf({ sec: '45' }, { id: '0025', mode: 'time' }, 'none')).toEqual({ done: true, sec: 45 })
    expect(markedSetOf({ min: '20', speed: '9,5' }, { id: '0025', mode: 'cardio' }, 'none')).toEqual({ done: true, min: 20, speed: 9.5 })
  })
  it('markedRowOf vuelve a texto solo lo que tiene valor', () => {
    expect(markedRowOf({ done: true, w: 62.5, r: 8 })).toEqual({ w: '62.5', r: '8' })
  })
})

describe('buildMarkedWorkout', () => {
  const now = localAt(2026, 3, 14, 15)

  it('sin series: marca el día, sin inventar series ni duración', () => {
    const w = buildMarkedWorkout('2026-03-10', { routine, name: 'Push A' }, { id: 'x', now })
    expect(w).toMatchObject({ id: 'x', d: '2026-03-10', name: 'Push A', routineId: 'push', marked: true, entries: [], vol: 0 })
    expect(w.end).toBe(w.start)
    expect(w.muscleLoad.intensity).toBe('medium')
    expect(w.muscleLoad.muscles.length).toBeGreaterThan(0)
  })

  it('"Otra cosa": sin rutina ni carga muscular', () => {
    const w = buildMarkedWorkout('2026-03-10', { routine: null, name: 'Libre' }, { id: 'x', now })
    expect(w.routineId).toBeNull()
    expect(w.muscleLoad).toBeUndefined()
  })

  it('con series: guarda solo las cargadas, con su volumen, y no lleva muscleLoad', () => {
    const items = [
      { id: '0025', cfg: bench, rows: [{ w: '60', r: '8' }, {}, { w: '60', r: '7' }] },
      { id: '0024', cfg: { id: '0024', sets: 3 }, rows: [{}, {}] },
    ]
    const w = buildMarkedWorkout('2026-03-10', { routine, name: 'Push A', items }, { id: 'x', now })
    expect(w.entries).toEqual([{ id: '0025', target: { ...bench, id: '0025' }, sets: [{ done: true, w: 60, r: 8 }, { done: true, w: 60, r: 7 }] }])
    expect(w.vol).toBe(60 * 8 + 60 * 7)
    expect(w.muscleLoad).toBeUndefined()
  })

  it('la hora: mediodía; hoy antes del mediodía, una hora antes de ahora; nunca antes de medianoche', () => {
    expect(buildMarkedWorkout('2026-03-10', { name: 'x' }, { id: 'x', now }).start).toBe(localNoonOf('2026-03-10'))
    expect(buildMarkedWorkout('2026-03-14', { name: 'x' }, { id: 'x', now: localAt(2026, 3, 14, 9) }).start).toBe(localAt(2026, 3, 14, 8))
    expect(buildMarkedWorkout('2026-03-14', { name: 'x' }, { id: 'x', now: localAt(2026, 3, 14, 0, 30) }).start).toBe(localDayStartOf('2026-03-14'))
  })

  it('al editar un marcado: respeta la hora y la rutina que ya tenía', () => {
    const w = buildMarkedWorkout('2026-03-10', { routine: null, routineId: 'borrada', name: 'x' }, { id: 'x', now, start: 123 })
    expect(w.start).toBe(123)
    expect(w.end).toBe(123)
    expect(w.routineId).toBe('borrada')
  })
})

describe('markedDraft', () => {
  it('de una rutina: sus ejercicios con filas vacías, una por serie (mínimo una)', () => {
    const d = markedDraft({ routine: { id: 'r', ex: [{ id: '0025', sets: 2 }, { id: '0024' }] } })
    expect(d.map(i => [i.id, i.rows.length])).toEqual([['0025', 2], ['0024', 1]])
    expect(d[0].rows[0]).toEqual({})
    expect(new Set(d.map(i => i.key)).size).toBe(2)
  })
  it('de un marcado con series: lo que ya tenía, como texto', () => {
    const workout = { entries: [{ id: '0025', target: { id: '0025', sets: 3 }, sets: [{ done: true, w: 60, r: 8 }] }] }
    const d = markedDraft({ routine: { id: 'r', ex: [{ id: '0024', sets: 2 }] }, workout })
    expect(d.map(i => i.id)).toEqual(['0025'])
    expect(d[0].rows).toEqual([{ w: '60', r: '8' }])
  })
  it('sin rutina ni series: vacío', () => {
    expect(markedDraft({})).toEqual([])
  })
})

describe('itemSummary', () => {
  it('cuenta y describe solo las series completas', () => {
    expect(itemSummary({ id: '0025', cfg: { id: '0025' }, rows: [{ w: '80', r: '8' }, { w: '80' }, {}] }, 'none')).toEqual({ count: 1, text: '80×8' })
    expect(itemSummary({ id: '0025', cfg: { id: '0025' }, rows: [{}] }, 'none')).toEqual({ count: 0, text: '' })
  })
})

describe('putWorkout', () => {
  it('inserta en orden por hora, no al final', () => {
    const list = [{ id: 'a', d: '2026-03-01', start: localNoonOf('2026-03-01') }, { id: 'c', d: '2026-03-20', start: localNoonOf('2026-03-20') }]
    putWorkout(list, { id: 'b', d: '2026-03-10', start: localNoonOf('2026-03-10') })
    expect(list.map(w => w.id)).toEqual(['a', 'b', 'c'])
  })
  it('reemplaza el mismo id y conserva la nota', () => {
    const list = [{ id: 'm', d: '2026-03-10', start: 1, note: 'pesado', muscleLoad: { muscles: ['chest'] } }]
    putWorkout(list, { id: 'm', d: '2026-03-10', start: 1, entries: [] })
    expect(list).toEqual([{ id: 'm', d: '2026-03-10', start: 1, entries: [], note: 'pesado' }])
  })
})

describe('modeTag', () => {
  it('etiqueta del tipo de ejercicio, nada para reps con carga', () => {
    expect(modeTag({ id: '0025' })).toBeNull()
    expect(modeTag({ id: '0025', bodyweight: true })).toBe('peso corporal')
    expect(modeTag({ id: '0025', mode: 'time' })).toBe('tiempo')
    expect(modeTag({ id: '0025', mode: 'cardio' })).toBe('cardio')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/lib/marked-workout.test.js`
Expected: FAIL. Vite does not resolve `./marked-workout.js`.

- [ ] **Step 3: Write the implementation**

Crear `frontend/src/lib/marked-workout.js`:

```js
// Un día marcado como entrenado después del hecho (la hoja del día): el workout que se guarda y
// el borrador del editor de series. Puro: sin store ni React.
//
// Un marcado lleva `marked: true` y solo las series que la persona cargó de verdad. Sin series no
// se inventa nada (antes se copiaban las metas de la rutina como hechas, y la sesión siguiente
// arrancaba en 0 kg): cuenta para la racha porque es un workout en ese día, y la recuperación usa
// `muscleLoad`, igual que una clase. El servidor guarda `marked` y `muscleLoad` en `meta`.
import { localDayStartOf, localNoonOf, workoutTime } from './format.js'
import { modeOf, isBw, isEmptySet, workoutVolume, setLabel, EFFORT, capEffort } from './history.js'
import { loadOfRoutine } from './muscles.js'

/** 'past' | 'today' | 'future': qué ofrece la hoja de ese día. */
export const dayMode = (iso, today) => (iso < today ? 'past' : iso === today ? 'today' : 'future')

/** Columnas de la tabla de un ejercicio, en orden: según su modo y el esfuerzo del perfil. */
export function columnsFor(cfg, effort = 'none') {
  const mode = modeOf(cfg)
  if (mode === 'cardio') return ['min', 'speed']
  const cols = mode === 'time' ? ['sec', 'w'] : ['w', 'r']
  return EFFORT[effort] ? [...cols, effort] : cols
}

// '' o un texto que no es un número no positivo-o-cero: nada. Acepta coma decimal.
const num = v => {
  if (v == null || v === '') return null
  const n = Number(String(v).trim().replace(',', '.'))
  return Number.isFinite(n) && n >= 0 ? n : null
}

/** Una fila del editor como serie guardable, o null si quedó vacía (no se guarda). */
export function markedSetOf(row, cfg, effort = 'none') {
  const set = { done: true }
  for (const f of columnsFor(cfg, effort)) {
    const n = num(row?.[f])
    if (n != null) set[f] = f === effort ? capEffort(effort, n) : n
  }
  if (modeOf(cfg) === 'reps' && isBw(cfg) && set.w == null) set.w = 0
  return isEmptySet(set, cfg) ? null : set
}

const FIELDS = ['w', 'r', 'sec', 'min', 'speed', 'rir', 'rpe']
/** Una serie guardada como fila del editor: solo los campos con valor, como texto. */
export const markedRowOf = set => Object.fromEntries(FIELDS.filter(f => set?.[f] != null).map(f => [f, String(set[f])]))

/**
 * Workout de un día marcado.
 * items: [{ id, cfg, rows }] del editor ([] = marcar sin series). `start` (al editar uno que ya
 * existía) conserva su hora; si no, mediodía del día, o una hora antes de ahora si es hoy y todavía
 * no es mediodía, nunca antes de la medianoche local. Sin duración inventada: end = start.
 */
export function buildMarkedWorkout(iso, { routine = null, routineId = routine ? routine.id : null, name, items = [], effort = 'none' } = {}, { id, now = Date.now(), start } = {}) {
  const entries = []
  for (const it of items) {
    const sets = (it.rows || []).map(r => markedSetOf(r, it.cfg, effort)).filter(Boolean)
    if (sets.length) entries.push({ id: it.id, target: { ...it.cfg, id: it.id }, sets })
  }
  const at = start ?? Math.max(localDayStartOf(iso), Math.min(localNoonOf(iso), now - 3600000))
  const w = { id, d: iso, start: at, end: at, name, routineId, marked: true, entries, vol: 0 }
  w.vol = workoutVolume(w)
  if (!entries.length && routine) {
    const load = loadOfRoutine(routine)
    const muscles = Object.keys(load).filter(s => load[s] > 0).sort((a, b) => load[b] - load[a])
    if (muscles.length) w.muscleLoad = { muscles, intensity: 'medium' }
  }
  return w
}

let seq = 0
const keyOf = () => 'mi' + (++seq)
const emptyRows = n => Array.from({ length: Math.max(1, n || 1) }, () => ({}))

/** Borrador del editor: las series de un marcado que ya las tiene, o la rutina con filas vacías. */
export function markedDraft({ routine = null, workout = null } = {}) {
  if (workout?.entries?.length) {
    return workout.entries.map(e => ({ key: keyOf(), id: e.id, cfg: { ...(e.target || {}), id: e.id }, rows: (e.sets || []).map(markedRowOf) }))
  }
  return (routine?.ex || []).map(c => ({ key: keyOf(), id: c.id, cfg: { ...c }, rows: emptyRows(c.sets) }))
}

/** Lo que dice la fila cerrada de un ejercicio: cuántas series completas y cuáles. */
export function itemSummary(item, effort = 'none') {
  const sets = (item.rows || []).map(r => markedSetOf(r, item.cfg, effort)).filter(Boolean)
  return { count: sets.length, text: sets.map(s => setLabel(item.id, s, item.cfg)).join(', ') }
}

/**
 * Guarda `w` en la lista de workouts: si ya está (mismo id) lo reemplaza, conservando su nota;
 * si no, lo inserta en orden por hora (un día pasado no va al final: "la última vez" lee la
 * lista en orden). Muta `list`.
 */
export function putWorkout(list, w) {
  const i = list.findIndex(x => x.id === w.id)
  if (i >= 0) {
    const note = list[i].note
    list[i] = note && !w.note ? { ...w, note } : w
    return list
  }
  const at = list.findIndex(x => workoutTime(x) > workoutTime(w))
  list.splice(at < 0 ? list.length : at, 0, w)
  return list
}

/** Etiqueta del tipo de ejercicio en la lista del editor (sin traducir), o null. */
export function modeTag(cfg) {
  const mode = modeOf(cfg)
  if (mode === 'cardio') return 'cardio'
  if (mode === 'time') return 'tiempo'
  return isBw(cfg) ? 'peso corporal' : null
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/lib/marked-workout.test.js`
Expected: PASS, todos los tests.

`setLabel` formatea con `fmtNum` (`toLocaleString`). Si el test de `itemSummary` falla por el formato del número (`80×8`), ver qué devuelve `setLabel('0025', { w: 80, r: 8 }, { id: '0025' })` en `history.test.js` y usar exactamente eso. No cambiar `setLabel`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/marked-workout.js frontend/src/lib/marked-workout.test.js
git commit -m "feat(day): pure helpers for a day marked as done

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Hoja del día en su archivo; planificar no borra entrenos

**Files:**
- Create: `frontend/src/components/day/DaySheet.jsx`
- Create: `frontend/src/components/day/DaySheet.test.jsx`
- Modify: `frontend/src/sheets.jsx:1227-1314` (se saca `DayOverride` y `keepClasses`)
- Modify: `frontend/src/views/HomeClasses.test.jsx:101-109`

**Interfaces:**
- Consumes: `markedDoneWorkout` (sigue en `lib/history.js` hasta Task 4).
- Produces:
  - `DaySheet({ iso, close })`, el componente.
  - `DayPlanSection({ iso, close, heading })`.
  - `DayClasses({ classes, myClasses, close })`.
  - `dayOverrideSheet(iso)` sigue exportado desde `sheets.jsx`.

- [ ] **Step 1: Write the failing test (and fix the one that pinned the bug)**

En `frontend/src/views/HomeClasses.test.jsx`, reemplazar el test de las líneas 101-109 por:

```jsx
  it('hoja del día: muestra las clases y elegir descanso no borra nada', async () => {
    setS({ workouts: [classWorkout('w1', TODAY, { classBookingId: 'b1' }), { id: 't1', d: TODAY, start: 1, end: 2, name: 'Piernas', routineId: 'r1', entries: [] }] })
    dayOverrideSheet(TODAY)
    const { host, unmount } = await openLastSheet()
    expect(host.querySelector('.day-classes').textContent).toContain('Spinning')
    await act(async () => { [...host.querySelectorAll('.item')].find(i => i.textContent.includes('Descansar / saltar este día')).click() })
    expect(useStore.getState().S.workouts.map(w => w.id)).toEqual(['w1', 't1'])
    expect(useStore.getState().S.dayPlan[TODAY].estado).toBe('descanso')
    await unmount()
  })
```

Crear `frontend/src/components/day/DaySheet.test.jsx`:

```jsx
// @vitest-environment happy-dom
// La hoja del día: qué ofrece según la fecha, que nunca borra un entreno, y cómo se llega a ella.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))
vi.mock('../../lib/onboarding.js', () => ({ startTourA: () => {} }))

const { useStore } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { setLang } = await import('../../lib/i18n.js')
const { dayOverrideSheet } = await import('../../sheets.jsx')

const TODAY = '2026-10-05'   // lunes
const PAST = '2026-09-28'    // lunes anterior: tocaba Piernas
const FUTURE = '2026-10-12'  // lunes que viene
const piernas = { id: 'r1', name: 'Piernas', emoji: 'legs', ex: [{ id: '0024', sets: 3 }] }
const live = (id, d) => ({ id, d, start: Date.parse(d + 'T15:00:00Z'), end: Date.parse(d + 'T16:00:00Z'), name: 'Piernas', routineId: 'r1', vol: 1200, entries: [{ id: '0024', sets: [{ done: true, w: 100, r: 5 }] }] })

const tick = () => act(async () => { await new Promise(r => setTimeout(r, 10)) })
async function openLastSheet() {
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div'); document.body.appendChild(host)
  const r = createRoot(host)
  await act(async () => { r.render(<MemoryRouter>{sheet.render(() => useUI.getState().closeSheet(sheet.id))}</MemoryRouter>) })
  for (let i = 0; i < 4; i++) await tick()
  return { host, unmount: async () => { await act(async () => r.unmount()); host.remove() } }
}
const btn = (host, text) => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const item = (host, text) => [...host.querySelectorAll('.item')].find(i => i.textContent.includes(text))
const setS = patch => useStore.setState({ S: { ...useStore.getState().S, routines: [piernas], week: { 1: 'r1' }, dayPlan: {}, workouts: [], effort: 'none', onboardingCompletado: true, planIniciado: true, ...patch } })

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 5, 12, 0))
  apiMock.mockReset()
  apiMock.mockImplementation(() => Promise.resolve({}))
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ config: { classes_available: false }, user: { id: 'socio' }, healthConsent: 'declined' })
  setS()
})
afterEach(() => { vi.useRealTimers(); useStore.setState({ config: null }) })

describe('hoja del día: planificar', () => {
  it('hoy: elegir otra rutina o descanso solo cambia el plan, no borra el entreno', async () => {
    setS({ workouts: [live('t1', TODAY)] })
    dayOverrideSheet(TODAY)
    const { host, unmount } = await openLastSheet()
    await act(async () => { item(host, 'Descansar / saltar este día').click() })
    expect(useStore.getState().S.workouts.map(w => w.id)).toEqual(['t1'])
    await unmount()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/views/HomeClasses.test.jsx src/components/day/DaySheet.test.jsx`
Expected: FAIL. Los dos tests nuevos ven `['w1']` y `[]`, porque hoy "Descanso" borra el entreno.

- [ ] **Step 3: Create `DaySheet.jsx` (move + non-destructive planning)**

Crear `frontend/src/components/day/DaySheet.jsx`:

```jsx
// La hoja de un día (semana de Inicio y calendario): las clases de ese día y qué rutina toca.
// Planificar (rutina, descanso, volver al plan) solo cambia dayPlan: nunca borra un entreno.
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { fmtDate, uid, exCount } from '../../lib/format.js'
import { effectiveRoutineId, markedDoneWorkout } from '../../lib/history.js'
import { isClassWorkout } from '../../lib/workout-history.js'
import { useMyClasses } from '../useMyClasses.js'
import { classesByDate } from '../../lib/classes.js'
import { classSheet } from '../ClassSheet.jsx'
import { glyphOf } from '../../lib/glyphs.js'
import Icon from '../Icon.jsx'

const update = (...a) => useStore.getState().update(...a)
const toast = m => useUI.getState().toast(m)
// sheets.jsx importa este archivo: el detalle de un entreno se trae al usarlo, sin ciclo.
export const openWorkout = w => import('../../sheets.jsx').then(({ workoutDetailSheet }) => workoutDetailSheet(w))

// Las clases de ese día (hechas o reservadas): tocar una abre su detalle.
export function DayClasses({ classes, myClasses, close }) {
  if (!classes.length) return null
  const open = c => {
    close()
    if (c.workout) openWorkout(c.workout)
    else classSheet(c.occ, { today: myClasses?.today, tz: myClasses?.tz, cancelHours: myClasses?.settings?.cancelHours ?? 2 })
  }
  return <div className="list day-classes">{classes.map(c => <div key={c.key} className="item" role="button" tabIndex={0} onClick={() => open(c)}>
    <span className="class-bar" style={{ background: c.color || 'var(--acc)' }} aria-hidden="true" />
    <div className="grow"><div className="tt">{c.name}</div>
      <div className="ss">{[c.start, c.done ? t('Hecha') : c.waitlist ? t('En espera') : t('Anotado')].filter(Boolean).join(' · ')}</div></div>
    {c.done && <Icon name="checkCircle" className="accent" />}
    <Icon name="chevronRight" className="chev" />
  </div>)}</div>
}

// Qué rutina toca ese día. Elegir rutina, descanso o volver al plan solo cambia dayPlan.
export function DayPlanSection({ iso, close, heading = null }) {
  const st = useStore(s => s.S)
  const wd = new Date(iso + 'T12:00:00').getDay()
  const weeklyR = st.routines.find(r => r.id === st.week[wd])
  const ovVal = st.dayPlan[iso]
  const ovr = ovVal !== undefined
  const effId = effectiveRoutineId(st, iso)
  const trainedThatDay = st.workouts.some(w => w.d === iso && !isClassWorkout(w))
  const currentStatus = typeof ovVal === 'object' && ovVal ? ovVal.estado : (ovVal === 'rest' ? 'descanso' : (typeof ovVal === 'string' && ovVal ? 'rutina' : (trainedThatDay ? 'completado' : null)))
  const currentRoutineId = typeof ovVal === 'object' && ovVal ? ovVal.rutinaId : (typeof ovVal === 'string' && ovVal !== 'rest' ? ovVal : effId)

  const setEstado = (nuevoEstado, rutinaId = null) => {
    update(s => {
      if (!nuevoEstado) delete s.dayPlan[iso]
      else s.dayPlan[iso] = { fecha: iso, estado: nuevoEstado, rutinaId: nuevoEstado === 'rutina' ? rutinaId : null }
    })
    close()
    if (!nuevoEstado) toast(t('Back to weekly plan'))
    else if (nuevoEstado === 'descanso') toast(t('{0} set to rest', fmtDate(iso)))
    else if (nuevoEstado === 'rutina') toast(t('{0} planned for {1}', (st.routines.find(r => r.id === rutinaId) || {}).name, fmtDate(iso)))
  }

  // Provisorio hasta la hoja de registrar (Task 4): ya no borra lo que había ese día.
  const markDone = routine => {
    update(s => {
      s.workouts.push(markedDoneWorkout(iso, routine, { id: uid(), name: routine ? routine.name : t('Freestyle') }))
      s.dayPlan[iso] = { fecha: iso, estado: 'completado', rutinaId: null }
    })
    close()
    toast(t('Entrenamiento marcado como realizado'))
  }

  return <div className="day-plan">
    {heading && <h4 className="sec">{heading}</h4>}
    <div className="muted small" style={{ marginBottom: 12 }}>{t('Weekly plan:')} {weeklyR ? weeklyR.name : t('Rest')}{ovr && <span style={{ color: 'var(--orange)' }}> · {t('changed for this day')}</span>}<br />{t('Sick, missed a day or want a different session? Pick what to train instead.')}</div>
    <div className="list">
      <div className="item" onClick={() => markDone(st.routines.find(r => r.id === effId) || st.routines[0])}>
        <span className="lrow-i" style={{ background: 'var(--acc)', color: '#000' }}><Icon name="checkCircle" /></span>
        <div className="grow"><div className="tt">{t('Marcar como realizado en esta fecha')}</div></div>
        {currentStatus === 'completado' && <Icon name="check" className="accent" />}
      </div>
      {st.routines.map(r => <div key={r.id} className="item" onClick={() => setEstado('rutina', r.id)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        {currentStatus === 'rutina' && currentRoutineId === r.id && <Icon name="check" className="accent" />}</div>)}
      <div className="item" onClick={() => setEstado('descanso')}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="moon" /></span><div className="grow"><div className="tt">{t('Rest / skip this day')}</div></div>{currentStatus === 'descanso' && <Icon name="check" className="accent" />}</div>
      {ovr && <div className="item" onClick={() => setEstado(null)}><span className="lrow-i" style={{ background: 'var(--surface-3)' }}><Icon name="reset" /></span><div className="grow"><div className="tt">{t('Back to weekly plan')}</div></div></div>}
    </div>
  </div>
}

export function DaySheet({ iso, close }) {
  const st = useStore(s => s.S)
  const myClasses = useMyClasses()
  const dayClasses = classesByDate(myClasses?.occurrences, st.workouts)[iso] || []
  return <div className="day-sheet">
    <h3>{fmtDate(iso, true)}</h3>
    {dayClasses.length > 0 && <h4 className="sec" style={{ marginTop: 0 }}>{t('Clases de este día')}</h4>}
    <DayClasses classes={dayClasses} myClasses={myClasses} close={close} />
    <DayPlanSection iso={iso} close={close} heading={dayClasses.length ? t('Rutina de este día') : null} />
  </div>
}
```

- [ ] **Step 4: Wire it into `sheets.jsx`**

En `frontend/src/sheets.jsx`:

1. Borrar el bloque completo de las líneas 1227-1314: el comentario `/* ============================ day override / assign ============================ */` en adelante hasta `export const dayOverrideSheet = …`, inclusive. Eso saca `keepClasses`, `DayOverride` y la exportación vieja. **No** borrar `DayAssign` (empieza en `function DayAssign`). Sobre él dejar el separador:

```jsx
/* ============================ day override / assign ============================ */
// La hoja de un día vive en components/day/DaySheet.jsx.
export const dayOverrideSheet = iso => ui().openSheet(close => <DaySheet iso={iso} close={close} />)

function DayAssign({ day, close }) {
```

2. Agregar el import, al lado de los demás de `./components/…`:

```jsx
import { DaySheet } from './components/day/DaySheet.jsx'
```

3. En el import de `./lib/history.js` (línea 7), sacar `markedDoneWorkout` de la lista. Ya no se usa en `sheets.jsx`.

4. Comprobar que `useMyClasses`, `classesByDate`, `classSheet` e `isClassWorkout` siguen usándose en `sheets.jsx` (el calendario y `WorkoutRow` los usan). Si alguno quedó sin uso, sacarlo del import:

Run: `cd frontend && npx eslint src/sheets.jsx` (si el proyecto no tiene eslint configurado, buscar cada nombre con Grep en `sheets.jsx`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/views/HomeClasses.test.jsx src/components/day/DaySheet.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/day/DaySheet.jsx frontend/src/components/day/DaySheet.test.jsx frontend/src/sheets.jsx frontend/src/views/HomeClasses.test.jsx
git commit -m "fix(day): planning a day never deletes its workouts

Move the day sheet to components/day/DaySheet.jsx. Picking a routine,
rest or 'back to plan' now only changes dayPlan; before, it removed
every non-class workout logged that day without asking.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Editor de series (celular y PC)

**Files:**
- Create: `frontend/src/components/day/MarkedWorkoutEditor.jsx`
- Create: `frontend/src/components/day/MarkedWorkoutEditor.test.jsx`
- Modify: `frontend/src/index.css` (al final del archivo)

**Interfaces:**
- Consumes (Task 1): `buildMarkedWorkout`, `columnsFor`, `itemSummary`, `markedDraft`, `markedRowOf`, `modeTag`, `putWorkout`. De `sheets.jsx`, por import dinámico: `exercisePicker(onPick) → { close }`.
- Produces:
  - `markedEditorSheet({ iso: string, routine?: object|null, workout?: object|null })`: abre el editor. Es un panel: pantalla completa en el celular y centrado desde 700 px.
  - `MarkedWorkoutEditor` (default export) con props `{ iso, routine, workout, close }`.

- [ ] **Step 1: Write the failing tests**

Crear `frontend/src/components/day/MarkedWorkoutEditor.test.jsx`:

```jsx
// @vitest-environment happy-dom
// Cargar series de un día marcado: acordeón en el celular, lista + detalle en PC, confirmaciones,
// teclado, y lo que se guarda.
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const picks = vi.hoisted(() => ({ onPick: null }))
vi.mock('../../sheets.jsx', () => ({ exercisePicker: vi.fn(onPick => { picks.onPick = onPick; return { close: vi.fn() } }) }))

const { useStore } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { setLang } = await import('../../lib/i18n.js')
const { markedEditorSheet } = await import('./MarkedWorkoutEditor.jsx')

const ISO = '2026-10-01'
const push = { id: 'r1', name: 'Push A', emoji: 'chest', ex: [{ id: '0025', sets: 2, reps: 8, weight: 60 }, { id: '0024', sets: 1 }] }
const realMatchMedia = window.matchMedia
const setWide = v => { window.matchMedia = q => ({ matches: !!v && q.includes('min-width'), media: q, addEventListener() {}, removeEventListener() {} }) }
const wait = ms => act(async () => { await new Promise(r => setTimeout(r, ms)) })

let host, root
async function open(opts = {}) {
  markedEditorSheet({ iso: ISO, routine: push, ...opts })
  const sheet = useUI.getState().sheets.at(-1)
  host = document.createElement('div'); document.body.appendChild(host)
  root = createRoot(host)
  await act(async () => { root.render(sheet.render(() => useUI.getState().closeSheet(sheet.id))) })
  await wait(10)
  return sheet
}
const btn = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
const items = () => [...host.querySelectorAll('.mwe-item')]
const cells = (scope = host) => [...scope.querySelectorAll('input.mwe-cell')]
const typeIn = async (input, v) => act(async () => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, v)
  input.dispatchEvent(new Event('input', { bubbles: true }))
})
const click = async el => act(async () => { el.click() })
const setS = patch => useStore.setState({ S: { ...useStore.getState().S, routines: [push], week: {}, dayPlan: {}, workouts: [], effort: 'none', ...patch } })

beforeEach(async () => {
  await setLang('es')
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  setWide(false)
  useUI.setState({ sheets: [], toastMsg: '' })
  setS()
  picks.onPick = null
})
afterEach(async () => {
  if (root) await act(async () => root.unmount())
  host?.remove()
  window.matchMedia = realMatchMedia
})

describe('editor de series: celular', () => {
  it('se abre a pantalla completa con los ejercicios de la rutina, sin series', async () => {
    const sheet = await open()
    expect(sheet).toMatchObject({ kind: 'panel', fullScreen: true })
    expect(items()).toHaveLength(2)
    expect(items().map(i => i.querySelector('.mwe-sum').textContent)).toEqual(['Sin series', 'Sin series'])
    expect(host.querySelector('.mwe-table')).toBeNull()   // ninguno abierto
  })

  it('cargar kg y reps y guardar crea un marcado solo con lo cargado', async () => {
    await open()
    await click(items()[0].querySelector('.mwe-item-main'))
    const [w1, r1] = cells(items()[0])
    await typeIn(w1, '62,5'); await typeIn(r1, '8')
    expect(items()[0].querySelector('.mwe-sum').textContent).toContain('1 serie')
    await click(btn('Guardar entrenamiento'))
    const [w] = useStore.getState().S.workouts
    expect(w).toMatchObject({ d: ISO, routineId: 'r1', name: 'Push A', marked: true, vol: 500 })
    expect(w.entries).toEqual([{ id: '0025', target: { ...push.ex[0], id: '0025' }, sets: [{ done: true, w: 62.5, r: 8 }] }])
    expect(useUI.getState().sheets).toHaveLength(0)
  })

  it('guardar sin cargar nada marca el día sin series', async () => {
    await open()
    await click(btn('Guardar entrenamiento'))
    const [w] = useStore.getState().S.workouts
    expect(w.entries).toEqual([])
    expect(w.muscleLoad.intensity).toBe('medium')
  })

  it('quitar pide confirmación en la fila; cancelar no cambia nada', async () => {
    await open()
    await click(items()[1].querySelector('[aria-label^="Quitar"]'))
    expect(host.querySelector('.mwe-confirm.danger').textContent).toContain('La rutina no cambia.')
    await click(btn('Cancelar'))
    expect(items()).toHaveLength(2)
    await click(items()[1].querySelector('[aria-label^="Quitar"]'))
    await click(btn('Quitar'))
    expect(items()).toHaveLength(1)
  })

  it('cambiar abre la biblioteca; al elegir, confirma en la fila y borra las series', async () => {
    await open()
    await click(items()[0].querySelector('.mwe-item-main'))
    const [w1, r1] = cells(items()[0])
    await typeIn(w1, '60'); await typeIn(r1, '8')
    await click(items()[0].querySelector('[aria-label^="Cambiar"]'))
    await wait(10)                                   // el import dinámico de la biblioteca
    await act(async () => { picks.onPick({ id: '0025' }) })
    expect(host.querySelector('.mwe-confirm')).toBeNull()   // el mismo ejercicio: nada
    await click(items()[0].querySelector('[aria-label^="Cambiar"]'))
    await wait(10)
    await act(async () => { picks.onPick({ id: '0024' }) })
    expect(host.querySelector('.mwe-confirm').textContent).toContain('La serie que cargaste se borra')
    await click(btn('Cambiar'))
    expect(items()[0].querySelector('.mwe-sum').textContent).toBe('Sin series')
    expect(items()).toHaveLength(2)
  })

  it('agregar ejercicio: biblioteca, va al final y queda abierto', async () => {
    await open()
    await click(btn('Agregar ejercicio'))
    await wait(10)
    await act(async () => { picks.onPick({ id: '0024' }) })
    await wait(10)
    expect(items()).toHaveLength(3)
    expect(items()[2].classList.contains('open')).toBe(true)
  })

  it('la columna de esfuerzo aparece solo con el ajuste', async () => {
    setS({ effort: 'rir' })
    await open()
    await click(items()[0].querySelector('.mwe-item-main'))
    expect([...host.querySelectorAll('.mwe-th')].map(h => h.textContent)).toEqual(['kg', 'reps', 'RIR'])
  })

  it('"Igual que la última vez" copia las series de la última vez', async () => {
    setS({ workouts: [{ id: 'p', d: '2026-09-20', start: Date.parse('2026-09-20T15:00:00Z'), end: Date.parse('2026-09-20T16:00:00Z'), name: 'Push A', entries: [{ id: '0025', sets: [{ done: true, w: 60, r: 8 }, { done: true, w: 60, r: 7 }] }] }] })
    await open()
    await click(items()[0].querySelector('.mwe-item-main'))
    expect(cells(items()[0])[0].placeholder).toBe('60')
    await click(btn('Igual que la última vez'))
    expect(cells(items()[0]).map(c => c.value)).toEqual(['60', '8', '60', '7'])
  })

  it('abrir un ejercicio lo sube arriba de todo (la tabla queda sobre el teclado)', async () => {
    const spy = vi.fn()
    Element.prototype.scrollIntoView = spy
    await open()
    await click(items()[1].querySelector('.mwe-item-main'))
    await wait(50)
    expect(spy).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
  })

  it('Enter pasa a la celda siguiente; la última cierra el teclado', async () => {
    await open()
    await click(items()[0].querySelector('.mwe-item-main'))
    const cs = cells(items()[0])
    expect(cs.map(c => c.getAttribute('enterkeyhint'))).toEqual(['next', 'next', 'next', 'done'])
    cs[0].focus()
    await act(async () => { cs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(document.activeElement).toBe(cs[1])
  })

  it('mientras se escribe se oculta Guardar', async () => {
    await open()
    await click(items()[0].querySelector('.mwe-item-main'))
    await act(async () => { cells(items()[0])[0].dispatchEvent(new FocusEvent('focusin', { bubbles: true })) })
    expect(host.querySelector('.mwe-foot').classList.contains('hidden')).toBe(true)
    await act(async () => { cells(items()[0])[0].dispatchEvent(new FocusEvent('focusout', { bubbles: true })) })
    expect(host.querySelector('.mwe-foot').classList.contains('hidden')).toBe(false)
  })

  it('editar un marcado conserva id, hora y nota, y saca la carga muscular', async () => {
    const start = Date.parse('2026-10-01T15:00:00Z')
    setS({ workouts: [{ id: 'm1', d: ISO, start, end: start, name: 'Push A', routineId: 'r1', marked: true, entries: [], vol: 0, note: 'pesado', muscleLoad: { muscles: ['chest'], intensity: 'medium' } }] })
    await open({ workout: useStore.getState().S.workouts[0] })
    await click(items()[0].querySelector('.mwe-item-main'))
    const [w1, r1] = cells(items()[0])
    await typeIn(w1, '60'); await typeIn(r1, '8')
    await click(btn('Guardar entrenamiento'))
    const ws = useStore.getState().S.workouts
    expect(ws).toHaveLength(1)
    expect(ws[0]).toMatchObject({ id: 'm1', start, end: start, note: 'pesado', marked: true })
    expect(ws[0].muscleLoad).toBeUndefined()
  })
})

describe('editor de series: PC', () => {
  it('panel centrado con lista + detalle; el primero elegido; quitar confirma en el detalle', async () => {
    setWide(true)
    const sheet = await open()
    expect(sheet.fullScreen).toBe(false)
    expect(host.querySelector('.mwe.wide')).toBeTruthy()
    expect(host.querySelector('.mwe-detail .mwe-table')).toBeTruthy()
    expect(items()[0].classList.contains('open')).toBe(true)
    expect(host.querySelector('.mwe-list [aria-label^="Quitar"]')).toBeNull()   // las acciones están en el detalle
    await click(host.querySelector('.mwe-detail').querySelector('[aria-label^="Quitar"]'))
    expect(host.querySelector('.mwe-detail .mwe-confirm.danger')).toBeTruthy()
    await click(items()[1].querySelector('.mwe-item-main'))
    expect(items()[1].classList.contains('open')).toBe(true)
    expect(host.querySelector('.mwe-foot').textContent).toContain('Cancelar')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/day/MarkedWorkoutEditor.test.jsx`
Expected: FAIL. Vite does not resolve `./MarkedWorkoutEditor.jsx`.

- [ ] **Step 3: Write the component**

Crear `frontend/src/components/day/MarkedWorkoutEditor.jsx`:

```jsx
// Cargar series de un día marcado (la hoja del día y el detalle de un marcado). Celular: acordeón
// a pantalla completa, un ejercicio abierto a la vez; abrir uno lo sube arriba de todo para que su
// tabla quede sobre el teclado. Desde 700px: panel centrado con lista + detalle. Nada es
// obligatorio: un ejercicio sin series no se guarda, y guardar todo vacío es marcar el día.
import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { t, exerciseNameFor } from '../../lib/i18n.js'
import { exOr } from '../../lib/exercises.js'
import { fmtDate, uid } from '../../lib/format.js'
import { defaultConfig, effortOf, lastEntryFor, isBw, setLabel, EFFORT } from '../../lib/history.js'
import { buildMarkedWorkout, columnsFor, itemSummary, markedDraft, markedRowOf, modeTag, putWorkout } from '../../lib/marked-workout.js'
import { Button } from '../ui.jsx'
import Icon from '../Icon.jsx'

// El mismo corte que el panel centrado (Modals.jsx).
const WIDE = '(min-width: 700px)'
const isWide = () => !!window.matchMedia?.(WIDE).matches
function useWide() {
  const [wide, setWide] = useState(isWide)
  useEffect(() => {
    const mql = window.matchMedia?.(WIDE)
    if (!mql) return
    const on = () => setWide(mql.matches)
    mql.addEventListener?.('change', on)
    return () => mql.removeEventListener?.('change', on)
  }, [])
  return wide
}

const HEAD = { w: 'kg', r: 'reps', sec: 'seg', min: 'min', speed: 'km/h' }
const DECIMAL = new Set(['w', 'speed', 'rir', 'rpe'])
const nameOf = id => exerciseNameFor(exOr(id))
const emptyRows = n => Array.from({ length: Math.max(1, n || 1) }, () => ({}))
const newItem = id => { const cfg = { ...defaultConfig(id), id }; return { key: uid(), id, cfg, rows: emptyRows(cfg.sets) } }
// sheets.jsx importa este archivo (detalle de un marcado): la biblioteca se trae al usarla. Al
// elegir se cierra, como al reemplazar un ejercicio en el entreno en vivo (Workout.jsx).
const pickExercise = onPick => import('../../sheets.jsx').then(({ exercisePicker }) => {
  const picker = exercisePicker(ex => { picker?.close(); onPick(ex) })
})

export default function MarkedWorkoutEditor({ iso, routine = null, workout = null, close }) {
  const st = useStore(s => s.S)
  const wide = useWide()
  const effort = effortOf(st)
  const effortHd = EFFORT[effort]?.hd
  const [initial] = useState(() => { const draft = markedDraft({ routine, workout }); return { draft, open: isWide() ? draft[0]?.key ?? null : null } })
  const [items, setItems] = useState(initial.draft)
  const [openKey, setOpenKey] = useState(initial.open)
  const [confirm, setConfirm] = useState(null)   // { key, type: 'remove' } | { key, type: 'swap', to }
  const [typing, setTyping] = useState(false)
  const listRef = useRef(null)
  const name = workout?.name || routine?.name || t('Freestyle')

  const patch = (key, fn) => setItems(list => list.map(it => (it.key === key ? fn(it) : it)))
  const setRows = (key, fn) => patch(key, it => ({ ...it, rows: fn(it.rows) }))
  const open = key => {
    setConfirm(null)
    const next = !wide && openKey === key ? null : key
    setOpenKey(next)
    if (next && !wide) requestAnimationFrame(() => listRef.current?.querySelector(`[data-key="${next}"]`)?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }))
  }
  const remove = key => {
    const rest = items.filter(it => it.key !== key)
    setItems(rest)
    setConfirm(null)
    if (openKey === key) setOpenKey(wide ? rest[0]?.key ?? null : null)
  }
  const swap = (key, to) => {
    patch(key, it => ({ ...newItem(to.id), key, rows: emptyRows(it.rows.length) }))
    setConfirm(null)
  }
  const askSwap = it => pickExercise(ex => { if (ex.id !== it.id) setConfirm({ key: it.key, type: 'swap', to: ex }) })
  const add = () => pickExercise(ex => { const it = newItem(ex.id); setItems(list => [...list, it]); open(it.key) })
  const save = () => {
    const w = buildMarkedWorkout(iso, { routine, routineId: workout ? workout.routineId ?? null : undefined, name, items, effort },
      { id: workout?.id || uid(), start: workout?.start })
    useStore.getState().update(s => { putWorkout(s.workouts, w) })
    close()
    useUI.getState().toast(workout ? t('Series guardadas') : t('Marcado como entrenado'))
  }
  // Enter: la celda siguiente (kg → reps → esfuerzo → serie siguiente); en la última, cerrar el teclado.
  const onKey = e => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const all = [...e.currentTarget.closest('.mwe-table').querySelectorAll('input')]
    const next = all[all.indexOf(e.currentTarget) + 1]
    if (next) next.focus(); else e.currentTarget.blur()
  }

  const table = it => {
    const cols = columnsFor(it.cfg, effort)
    const last = lastEntryFor(st, it.id)
    const total = it.rows.length * cols.length
    const head = f => (f === effort ? effortHd : f === 'w' && cols.includes('r') && isBw(it.cfg) ? '+kg' : HEAD[f])
    return <div className="mwe-table" style={{ '--cols': cols.length }}>
      {last && <div className="mwe-last">{t('Última vez: {0}', last.sets.map(s => setLabel(it.id, s, it.cfg)).join(', '))}</div>}
      <div className="mwe-tr"><span />{cols.map(f => <span key={f} className="mwe-th">{head(f)}</span>)}<span /></div>
      {it.rows.map((row, i) => <div key={i} className="mwe-tr">
        <span className="mwe-n">{i + 1}</span>
        {cols.map((f, j) => <input key={f} className="input mwe-cell" data-f={f} type="text"
          inputMode={DECIMAL.has(f) ? 'decimal' : 'numeric'} enterKeyHint={i * cols.length + j === total - 1 ? 'done' : 'next'}
          aria-label={t('Serie {0} · {1}', i + 1, head(f))} value={row[f] ?? ''}
          placeholder={last?.sets[i]?.[f] != null ? String(last.sets[i][f]) : ''}
          onChange={e => { const v = e.target.value; setRows(it.key, rows => rows.map((r, k) => (k === i ? { ...r, [f]: v } : r))) }}
          onKeyDown={onKey} />)}
        <button type="button" className="iconbtn mwe-x" aria-label={t('Borrar serie {0}', i + 1)}
          onClick={() => setRows(it.key, rows => rows.filter((_, k) => k !== i))}><Icon name="trash" /></button>
      </div>)}
      <div className="mwe-tools">
        <Button size="sm" variant="plain" icon="plus" onClick={() => setRows(it.key, rows => [...rows, {}])}>{t('Serie')}</Button>
        {last && <Button size="sm" variant="plain" icon="copy" onClick={() => setRows(it.key, () => last.sets.map(markedRowOf))}>{t('Igual que la última vez')}</Button>}
      </div>
    </div>
  }

  const confirmBox = it => {
    if (confirm?.key !== it.key) return null
    const n = itemSummary(it, effort).count
    if (confirm.type === 'remove') {
      const lost = n === 1 ? t('Se pierde la serie que cargaste.') : n > 1 ? t('Se pierden las {0} series que cargaste.', n) : null
      return <div className="mwe-confirm danger" role="alert">
        <b>{t('¿Quitar {0}?', nameOf(it.id))}</b>
        <div className="small muted">{[lost, t('La rutina no cambia.')].filter(Boolean).join(' ')}</div>
        <div className="row"><Button size="sm" onClick={() => setConfirm(null)}>{t('Cancelar')}</Button><Button size="sm" variant="danger" onClick={() => remove(it.key)}>{t('Quitar')}</Button></div>
      </div>
    }
    return <div className="mwe-confirm" role="alert">
      <b>{t('¿Cambiar {0} por {1}?', nameOf(it.id), nameOf(confirm.to.id))}</b>
      <div className="small muted">{n === 1 ? t('La serie que cargaste se borra: era de otro ejercicio.') : n > 1 ? t('Las {0} series que cargaste se borran: eran de otro ejercicio.', n) : t('La rutina no cambia.')}</div>
      <div className="row"><Button size="sm" onClick={() => setConfirm(null)}>{t('Cancelar')}</Button><Button size="sm" variant="primary" onClick={() => swap(it.key, confirm.to)}>{t('Cambiar')}</Button></div>
    </div>
  }

  const actions = it => <>
    <button type="button" className="iconbtn" aria-label={t('Cambiar {0}', nameOf(it.id))} onClick={() => askSwap(it)}><Icon name="reset" /></button>
    <button type="button" className="iconbtn" aria-label={t('Quitar {0}', nameOf(it.id))} onClick={() => setConfirm({ key: it.key, type: 'remove' })}><Icon name="trash" /></button>
  </>

  const row = it => {
    const sum = itemSummary(it, effort)
    const tag = modeTag(it.cfg)
    const isOpen = openKey === it.key
    return <div key={it.key} data-key={it.key} className={'mwe-item' + (isOpen ? ' open' : '')}>
      <div className="mwe-item-head">
        <button type="button" className="mwe-item-main" aria-expanded={isOpen} onClick={() => open(it.key)}>
          <span className="tt capitalize">{nameOf(it.id)}</span>
          {tag && <span className="tag nocap">{t(tag)}</span>}
          <span className={'mwe-sum' + (sum.count ? ' ok' : '')}>{sum.count ? `✓ ${sum.count === 1 ? t('1 serie') : t('{0} series', sum.count)} · ${sum.text}` : t('Sin series')}</span>
        </button>
        {!wide && actions(it)}
      </div>
      {!wide && confirmBox(it)}
      {!wide && isOpen && table(it)}
    </div>
  }

  const current = items.find(it => it.key === openKey)
  return <div className={'mwe' + (wide ? ' wide' : '')}
    onFocus={e => { if (e.target.matches?.('input')) setTyping(true) }}
    onBlur={e => { if (e.target.matches?.('input')) setTyping(false) }}>
    <div className="mwe-head">
      {!wide && <button type="button" className="iconbtn" aria-label={t('Volver')} onClick={close}><Icon name="chevronLeft" /></button>}
      <div className="grow">
        <h3>{name} · {fmtDate(iso)}</h3>
        <div className="small muted">{effortHd ? t('Series opcionales · {0} según tus ajustes', effortHd) : t('Series opcionales')}</div>
      </div>
    </div>
    <div className="mwe-body">
      <div className="mwe-list" ref={listRef}>
        {items.map(row)}
        {!items.length && <div className="empty small">{t('Sin ejercicios. Agregá uno, o guardá así: cuenta para tu racha.')}</div>}
        <Button variant="plain" icon="plus" className="mwe-add" onClick={add}>{t('Agregar ejercicio')}</Button>
      </div>
      {wide && <div className="mwe-detail">{current ? <>
        <div className="mwe-detail-head">
          <b className="grow capitalize">{nameOf(current.id)}</b>
          {actions(current)}
        </div>
        {confirmBox(current)}
        {table(current)}
        <div className="small muted mwe-keys">{t('Tab: celda siguiente · Enter: serie siguiente')}</div>
      </> : <div className="empty small">{t('Elegí un ejercicio de la lista.')}</div>}</div>}
    </div>
    {!wide && <div className="mwe-spacer" aria-hidden="true" />}
    <div className={'mwe-foot' + (typing && !wide ? ' hidden' : '')}>
      {wide && <Button variant="ghost" className="dim" onClick={close}>{t('Cancelar')}</Button>}
      <Button variant="primary" onClick={save}>{t('Guardar entrenamiento')}</Button>
    </div>
  </div>
}

/** Abre el editor: pantalla completa en el celular, panel centrado desde 700px. */
export function markedEditorSheet({ iso, routine = null, workout = null }) {
  // locked: un deslizón no tira lo cargado; atrás del sistema y la X del panel siguen cerrando.
  return useUI.getState().openSheet(close => <MarkedWorkoutEditor iso={iso} routine={routine} workout={workout} close={close} />,
    { kind: 'panel', fullScreen: !isWide(), locked: true, backGesture: true })
}
```

Nota: en PC las acciones (Cambiar, Quitar) aparecen **solo** en el detalle, por eso el test busca `.mwe-list [aria-label^="Quitar"]` y espera `null`.

- [ ] **Step 4: Add the styles**

Agregar al final de `frontend/src/index.css`:

```css
/* Cargar series de un día marcado (components/day/MarkedWorkoutEditor.jsx). Celular: acordeón a
   pantalla completa; el relleno de abajo deja que hasta el último ejercicio suba sobre el teclado. */
.mwe-head{display:flex;align-items:flex-start;gap:6px;margin-bottom:10px}
.mwe-head h3{margin-bottom:2px}
.mwe-item{background:var(--surface);border-radius:var(--r);margin:6px 0;scroll-margin-top:8px}
.mwe-item.open{box-shadow:inset 0 0 0 1.5px var(--acc)}
.mwe-item-head{display:flex;align-items:center;gap:2px;padding:2px 6px 2px 0}
.mwe-item-main{flex:1;min-width:0;display:flex;flex-wrap:wrap;align-items:center;gap:2px 6px;padding:9px 12px;background:none;border:0;color:inherit;font:inherit;text-align:left;cursor:pointer}
.mwe-sum{flex-basis:100%;font-size:12.5px;color:var(--label-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mwe-sum.ok{color:var(--acc)}
.mwe-table{padding:0 12px 12px}
.mwe-last{font-size:12px;color:var(--label-2);margin-bottom:6px}
.mwe-tr{display:grid;grid-template-columns:22px repeat(var(--cols),minmax(0,1fr)) 32px;gap:6px;align-items:center;margin:5px 0}
.mwe-th{font-size:11px;color:var(--label-3);text-transform:uppercase;text-align:center}
.mwe-n{font-size:12px;color:var(--label-2);text-align:center}
.mwe-cell{text-align:center;padding:8px 4px;min-width:0}
.mwe-x{color:var(--label-3)}
.mwe-tools{display:flex;justify-content:space-between;flex-wrap:wrap;gap:6px;margin-top:6px}
.mwe-confirm{margin:0 12px 12px;padding:10px 12px;border-radius:var(--r-sm);background:var(--surface-2)}
.mwe-confirm.danger{box-shadow:inset 0 0 0 1px var(--red)}
.mwe-confirm .row{gap:8px;margin-top:8px}
.mwe-add{margin-top:6px}
.mwe-spacer{height:55vh}
.mwe-foot{position:sticky;bottom:0;display:flex;gap:10px;padding:10px 0 2px;background:var(--bg-el)}
:root[data-theme="light"] .mwe-foot{background:var(--bg)}
.mwe-foot > .btn{flex:1}
.mwe-foot.hidden{display:none}
@media (min-width:700px){
  .sheet.panel:has(.mwe.wide){width:min(780px,calc(100vw - 48px))}
  .mwe.wide .mwe-body{display:grid;grid-template-columns:240px minmax(0,1fr);gap:14px;align-items:start}
  .mwe.wide .mwe-detail{background:var(--surface);border-radius:var(--r);padding:12px 0 8px;position:sticky;top:0}
  .mwe.wide .mwe-detail-head{display:flex;align-items:center;gap:4px;padding:0 8px 8px 12px}
  .mwe.wide .mwe-keys{padding:0 12px}
  .mwe.wide .mwe-foot{justify-content:flex-end}
  .mwe.wide .mwe-foot > .btn{flex:0 0 auto}
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/day/MarkedWorkoutEditor.test.jsx`
Expected: PASS, todos.

Si falla "abrir un ejercicio lo sube…" porque happy-dom no corrió el `requestAnimationFrame` en 50 ms, subir la espera a 100 ms en el test. No sacar el `requestAnimationFrame`: sin él, el elemento todavía no existe cuando se busca.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/day/MarkedWorkoutEditor.jsx frontend/src/components/day/MarkedWorkoutEditor.test.jsx frontend/src/index.css
git commit -m "feat(day): optional set entry for a marked day

Accordion on phones (full screen, opened exercise scrolls to the top so
its table stays above the keyboard, Enter walks the cells, Save hides
while typing) and list + detail on tablets and desktop. Removing or
swapping an exercise confirms inline; swap uses the exercise library
like the live workout. Effort column follows the RIR/RPE setting.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Hoja del día según la fecha (registrar en pasado y hoy)

**Files:**
- Modify: `frontend/src/components/day/DaySheet.jsx`
- Modify: `frontend/src/components/day/DaySheet.test.jsx`
- Modify: `frontend/src/lib/history.js:505-531` (borrar `markedDoneWorkout`)
- Modify: `frontend/src/lib/history.test.js:992-1031` (borrar su `describe`, y sacar `markedDoneWorkout` del import de la línea 2)
- Modify: `frontend/src/lib/recovery.test.js:24,232-239,667`
- Modify: `frontend/src/index.css` (al final)

**Interfaces:**
- Consumes: `markedEditorSheet` (Task 3); `buildMarkedWorkout`, `dayMode`, `putWorkout` (Task 1); `DayClasses`, `DayPlanSection`, `openWorkout` (Task 2).
- Produces: `DaySheet` con secciones por modo. `DayPlanSection` pierde la fila "Marcar como realizado".

- [ ] **Step 1: Write the failing tests**

Agregar en `frontend/src/components/day/DaySheet.test.jsx`, después del `describe` existente:

```jsx
describe('hoja del día: registrar', () => {
  it('pasado con un entreno: lo muestra y no ofrece nada que lo borre ni planificar', async () => {
    setS({ workouts: [live('t1', PAST)] })
    dayOverrideSheet(PAST)
    const { host, unmount } = await openLastSheet()
    expect(host.querySelector('.day-workouts').textContent).toContain('Piernas')
    expect(host.querySelector('.day-plan')).toBeNull()
    expect(item(host, 'Descansar / saltar este día')).toBeUndefined()
    expect(btn(host, 'Agregar otro entrenamiento')).toBeTruthy()
    expect(btn(host, 'Entrené')).toBeUndefined()
    await act(async () => { btn(host, 'Agregar otro entrenamiento').click() })
    expect(btn(host, 'Entrené')).toBeTruthy()
    await unmount()
  })

  it('pasado sin nada: "Entrené" con la rutina planificada elegida; marcar agrega un marcado sin series', async () => {
    dayOverrideSheet(PAST)
    const { host, unmount } = await openLastSheet()
    expect(host.querySelector('.day-tocaba').textContent).toBe('Tocaba: Piernas')
    await act(async () => { btn(host, 'Entrené').click() })
    expect(btn(host, 'Piernas').getAttribute('aria-pressed')).toBe('true')
    await act(async () => { btn(host, 'Marcar como entrenado').click() })
    const [w] = useStore.getState().S.workouts
    expect(w).toMatchObject({ d: PAST, routineId: 'r1', name: 'Piernas', marked: true, entries: [], vol: 0 })
    expect(w.end).toBe(w.start)
    expect(useStore.getState().S.dayPlan[PAST]).toBeUndefined()   // el workout es lo que vale
    await unmount()
  })

  it('un día que no tenía rutina: no hay nada elegido y no se puede marcar hasta elegir', async () => {
    const sunday = '2026-09-27'
    dayOverrideSheet(sunday)
    const { host, unmount } = await openLastSheet()
    expect(host.querySelector('.day-tocaba').textContent).toBe('Tocaba: descanso')
    await act(async () => { btn(host, 'Entrené').click() })
    expect(host.querySelectorAll('.chip[aria-pressed="true"]')).toHaveLength(0)
    expect(btn(host, 'Marcar como entrenado').disabled).toBe(true)
    await act(async () => { btn(host, 'Otra cosa').click() })
    await act(async () => { btn(host, 'Marcar como entrenado').click() })
    expect(useStore.getState().S.workouts[0].routineId).toBeNull()
    await unmount()
  })

  it('"No entrené" cierra sin escribir nada', async () => {
    dayOverrideSheet(PAST)
    const { host, unmount } = await openLastSheet()
    await act(async () => { btn(host, 'No entrené').click() })
    expect(useStore.getState().S.workouts).toEqual([])
    expect(useUI.getState().sheets).toHaveLength(0)
    await unmount()
  })

  it('"Cargar series" abre el editor con la rutina elegida', async () => {
    dayOverrideSheet(PAST)
    const { host, unmount } = await openLastSheet()
    await act(async () => { btn(host, 'Entrené').click() })
    await act(async () => { btn(host, 'Cargar series (opcional)').click() })
    const sheets = useUI.getState().sheets
    expect(sheets).toHaveLength(1)
    expect(sheets[0].kind).toBe('panel')
    await unmount()
  })

  it('un marcado del día ofrece cargar series', async () => {
    setS({ workouts: [{ id: 'm1', d: PAST, start: Date.parse(PAST + 'T15:00:00Z'), end: Date.parse(PAST + 'T15:00:00Z'), name: 'Piernas', routineId: 'r1', marked: true, entries: [], vol: 0 }] })
    dayOverrideSheet(PAST)
    const { host, unmount } = await openLastSheet()
    expect(host.querySelector('.day-workouts').textContent).toContain('Marcado')
    expect(host.querySelector('.day-workouts').textContent).toContain('Sin series · cuenta para tu racha')
    expect(btn(host, 'Cargar series')).toBeTruthy()
    await unmount()
  })

  it('futuro: solo planificar, sin marcar', async () => {
    dayOverrideSheet(FUTURE)
    const { host, unmount } = await openLastSheet()
    expect(btn(host, 'Entrené')).toBeUndefined()
    expect(host.querySelector('.day-tocaba')).toBeNull()
    expect(host.querySelector('.day-plan')).toBeTruthy()
    expect(item(host, 'Marcar como realizado en esta fecha')).toBeUndefined()
    await unmount()
  })

  it('hoy: registrar y planificar', async () => {
    dayOverrideSheet(TODAY)
    const { host, unmount } = await openLastSheet()
    expect(btn(host, 'Entrené')).toBeTruthy()
    expect(host.querySelector('.day-plan')).toBeTruthy()
    await unmount()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/day/DaySheet.test.jsx`
Expected: FAIL. No hay `.day-workouts`, `.day-tocaba` ni el botón "Entrené".

- [ ] **Step 3: Rewrite `DaySheet.jsx`**

En `frontend/src/components/day/DaySheet.jsx`:

1. Reemplazar el comentario de cabecera y los imports por:

```jsx
// La hoja de un día (semana de Inicio y calendario). Pasado: registrar lo que se hizo, sin borrar
// nunca nada (para borrar, el detalle del entreno, que confirma). Hoy: registrar y planificar.
// Futuro: solo planificar. Planificar (rutina, descanso, volver al plan) solo cambia dayPlan.
import { useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { fmtDate, fmtVol, durPart, todayISO, uid, exCount } from '../../lib/format.js'
import { effectiveRoutineId, setsDone } from '../../lib/history.js'
import { isClassWorkout } from '../../lib/workout-history.js'
import { buildMarkedWorkout, dayMode, putWorkout } from '../../lib/marked-workout.js'
import { useMyClasses } from '../useMyClasses.js'
import { classesByDate } from '../../lib/classes.js'
import { classSheet } from '../ClassSheet.jsx'
import { glyphOf } from '../../lib/glyphs.js'
import { Button } from '../ui.jsx'
import Icon from '../Icon.jsx'
import { markedEditorSheet } from './MarkedWorkoutEditor.jsx'
```

2. En `DayPlanSection`, borrar la función `markDone` (con su comentario "Provisorio…") y el primer `<div className="item" …>` de la lista, el de "Marcar como realizado en esta fecha". El resto queda igual.

3. Reemplazar la función `DaySheet` entera por:

```jsx
const FREE = '__free'
// Lo que tocaba ese día según el plan. Un "completado" viejo (antes el marcado lo escribía en
// dayPlan) no dice qué tocaba: se mira la semana.
function plannedRoutine(S, iso) {
  const ov = S.dayPlan[iso]
  const id = ov && typeof ov === 'object' && ov.estado === 'completado'
    ? S.week[new Date(iso + 'T12:00:00').getDay()]
    : effectiveRoutineId(S, iso)
  return S.routines.find(r => r.id === id) || null
}

// "¿Entrenaste?": marcar el día (sin series) o pasar a cargarlas. "No entrené" no escribe nada.
function MarkStep({ iso, planned, close }) {
  const st = useStore(s => s.S)
  const [did, setDid] = useState(false)
  const [pick, setPick] = useState(planned ? planned.id : null)   // id de rutina | FREE | null
  const routine = pick && pick !== FREE ? st.routines.find(r => r.id === pick) || null : null
  const mark = () => {
    const w = buildMarkedWorkout(iso, { routine, name: routine ? routine.name : t('Freestyle') }, { id: uid() })
    update(s => { putWorkout(s.workouts, w) })
    close()
    toast(t('Marcado como entrenado'))
  }
  const loadSets = () => { close(); markedEditorSheet({ iso, routine }) }
  const options = [...st.routines.map(r => ({ id: r.id, name: r.name })), { id: FREE, name: t('Otra cosa') }]
  return <div className="day-mark">
    <div className="day-mark-q">
      <button type="button" className={'day-mark-btn' + (did ? ' on' : '')} aria-pressed={did} onClick={() => setDid(true)}><Icon name="check" />{t('Entrené')}</button>
      <button type="button" className="day-mark-btn" onClick={close}>{t('No entrené')}</button>
    </div>
    {did && <>
      <h4 className="sec">{t('¿Qué entrenaste?')}</h4>
      <div className="chips">{options.map(o => <button key={o.id} type="button" className={'chip nocap' + (pick === o.id ? ' on' : '')}
        aria-pressed={pick === o.id} onClick={() => setPick(o.id)}>{o.name}</button>)}</div>
      {pick && <div className="day-mark-card"><b>{routine ? routine.name : t('Otra cosa')}</b>
        <div className="small muted">{[routine ? exCount(routine.ex.length) : null, t('cuenta para tu racha')].filter(Boolean).join(' · ')}</div></div>}
      <Button variant="primary" disabled={!pick} onClick={mark}>{t('Marcar como entrenado')}</Button>
      <Button variant="plain" icon="plus" disabled={!pick} onClick={loadSets}>{t('Cargar series (opcional)')}</Button>
    </>}
  </div>
}

// Un entreno del día: tocarlo abre su detalle. Uno marcado ofrece cargar (o editar) sus series.
function DayWorkoutCard({ w, close }) {
  const st = useStore(s => s.S)
  const n = setsDone(w)
  const sub = w.marked
    ? (n ? (n === 1 ? t('1 serie') : t('{0} series', n)) : t('Sin series · cuenta para tu racha'))
    : [...durPart(w.end - w.start), t('{0} sets', n), fmtVol(w.vol, st.unit)].join(' · ')
  const routine = st.routines.find(r => r.id === w.routineId) || null
  return <div className="item day-workout">
    <div className="grow" role="button" tabIndex={0} onClick={() => { close(); openWorkout(w) }}>
      <div className="tt">{w.name} <span className={'tag nocap' + (w.marked ? '' : ' acc')}>{w.marked ? t('Marcado') : t('Entrenado')}</span></div>
      <div className="ss">{sub}</div>
    </div>
    {w.marked && <Button size="sm" variant="plain" icon="plus" onClick={() => { close(); markedEditorSheet({ iso: w.d, routine, workout: w }) }}>{n ? t('Editar series') : t('Cargar series')}</Button>}
    <Icon name="chevronRight" className="chev" />
  </div>
}

export function DaySheet({ iso, close }) {
  const st = useStore(s => s.S)
  const myClasses = useMyClasses()
  const mode = dayMode(iso, todayISO())
  const dayClasses = classesByDate(myClasses?.occurrences, st.workouts)[iso] || []
  const dayWorkouts = st.workouts.filter(w => w.d === iso && !isClassWorkout(w))
  const planned = plannedRoutine(st, iso)
  const [adding, setAdding] = useState(false)
  const nothing = !dayWorkouts.length && !dayClasses.length
  return <div className="day-sheet">
    <h3>{fmtDate(iso, true)}</h3>
    {mode !== 'future' && <>
      <div className="muted small day-tocaba">{planned ? t('Tocaba: {0}', planned.name) : t('Tocaba: descanso')}</div>
      {!nothing && <>
        <h4 className="sec" style={{ marginTop: 0 }}>{mode === 'today' ? t('Hoy') : t('Ese día')}</h4>
        {dayWorkouts.length > 0 && <div className="list day-workouts">{dayWorkouts.map(w => <DayWorkoutCard key={w.id} w={w} close={close} />)}</div>}
        <DayClasses classes={dayClasses} myClasses={myClasses} close={close} />
      </>}
      {nothing || adding
        ? <MarkStep iso={iso} planned={planned} close={close} />
        : <Button variant="plain" icon="plus" className="day-add" onClick={() => setAdding(true)}>{t('Agregar otro entrenamiento')}</Button>}
    </>}
    {mode === 'future' && dayClasses.length > 0 && <>
      <h4 className="sec" style={{ marginTop: 0 }}>{t('Clases de este día')}</h4>
      <DayClasses classes={dayClasses} myClasses={myClasses} close={close} />
    </>}
    {mode !== 'past' && <DayPlanSection iso={iso} close={close}
      heading={mode === 'today' ? t('Planificar hoy') : dayClasses.length ? t('Rutina de este día') : null} />}
  </div>
}
```

- [ ] **Step 4: Remove `markedDoneWorkout`**

1. `frontend/src/lib/history.js`: borrar el JSDoc y la función `markedDoneWorkout` (líneas 505-531, desde `/**` hasta la `}` que la cierra). Si `localDayStartOf` y `localNoonOf` quedan sin uso en `history.js`, sacarlos del import de la línea 2. Buscarlos con Grep en el archivo antes de sacarlos.
2. `frontend/src/lib/history.test.js`: borrar el bloque `describe('markedDoneWorkout', …)` (líneas 992-1031). Sacar `markedDoneWorkout` del import de la línea 2. Lo que cubría está ahora en `marked-workout.test.js`.
3. `frontend/src/lib/recovery.test.js`:
   - Línea 23: `import { isoOf, localDayStartOf, localNoonOf, workoutTime } from './format.js'`
   - Línea 24: `import { buildMarkedWorkout } from './marked-workout.js'`
   - El test de las líneas 232-239 queda así:

```js
  it('reads an old markDone record (w 0, r 10) as RIR 2 sets', () => {
    const iso = isoOf(new Date(NOW))
    // Lo que guardaba el "marcar como realizado" viejo: cada serie de la rutina, hecha, 0 kg × 10.
    const start = Math.max(localDayStartOf(iso), Math.min(localNoonOf(iso), NOW + HOUR))
    const marked = { id: 'm', d: iso, start, end: start + HOUR, name: 'r', routineId: 'r', vol: 0,
      entries: [{ id: 'fx-chest', sets: Array.from({ length: 3 }, () => ({ done: true, w: 0, r: 10 })) }] }
    const at = workoutTime(marked)
    const history = [prior(at - DAY), marked]
    expect(setsOf(fatigueOf(history, at).chest)).toBeCloseTo(3 * FALLBACK_SETS, 10)
  })
```

   - En la línea 667, reemplazar la construcción de `marked` por:

```js
    const marked = buildMarkedWorkout(iso, { routine: { id: 'r', ex: [{ id: WEIGHTED.id, sets: 2 }] }, name: 'r',
      items: [{ id: WEIGHTED.id, cfg: { id: WEIGHTED.id }, rows: [{ w: '80', r: '8' }, { w: '80', r: '8' }] }] }, { id: 'm', now })
```

   - En el comentario de la línea 666, poner `// lo que guarda hoy el marcado con las series cargadas, para el mismo día`.

- [ ] **Step 5: Add the styles**

Agregar al final de `frontend/src/index.css`:

```css
/* Hoja del día (components/day/DaySheet.jsx). */
.day-tocaba{margin:-8px 0 12px}
.day-mark-q{display:flex;gap:8px;margin:4px 0 12px}
.day-mark-btn{flex:1;display:flex;align-items:center;justify-content:center;gap:6px;padding:14px 8px;border-radius:var(--r);border:0;background:var(--surface);color:var(--label);font:inherit;font-weight:600;cursor:pointer}
.day-mark-btn.on{background:var(--acc);color:#000}
.day-mark-card{background:var(--surface);border-radius:var(--r);padding:10px 12px;margin:10px 0}
.day-mark > .btn{width:100%;margin-top:8px}
.day-workout > .grow{cursor:pointer}
.day-add{margin-top:10px}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/day src/lib/history.test.js src/lib/recovery.test.js src/lib/marked-workout.test.js src/views/HomeClasses.test.jsx`
Expected: PASS, todos.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/day frontend/src/lib/history.js frontend/src/lib/history.test.js frontend/src/lib/recovery.test.js frontend/src/index.css
git commit -m "feat(day): record a past day without inventing or deleting data

Past days only record (trained / didn't train, pick the routine, mark
or load sets) and list what was logged; today records and plans; future
only plans. Marked days are saved with marked: true and no invented
sets, so the next session no longer starts at 0 kg. Drops
markedDoneWorkout.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Calendario, historial y detalle de un marcado

**Files:**
- Modify: `frontend/src/sheets.jsx`: `openDay` del calendario (línea ~1452 antes de Task 2), `WorkoutRow` (~1505) y `TrainingDetail` (~1351).
- Modify: `frontend/src/components/day/DaySheet.test.jsx`

**Interfaces:**
- Consumes: `markedEditorSheet` (Task 3); `dayOverrideSheet` (Task 2).
- Produces: nada nuevo.

- [ ] **Step 1: Write the failing tests**

En `frontend/src/components/day/DaySheet.test.jsx`, cambiar el import de `sheets.jsx` a:

```jsx
const { dayOverrideSheet, calendarSheet, workoutDetailSheet, WorkoutRow } = await import('../../sheets.jsx')
```

y agregar al final del archivo:

```jsx
describe('el marcado en el calendario, el historial y el detalle', () => {
  const marked = { id: 'm1', d: PAST, start: Date.parse(PAST + 'T15:00:00Z'), end: Date.parse(PAST + 'T15:00:00Z'), name: 'Piernas', routineId: 'r1', marked: true, entries: [], vol: 0 }

  it('el calendario abre siempre la hoja del día, aunque el día tenga un entreno', async () => {
    setS({ workouts: [live('t1', PAST)] })
    calendarSheet(PAST)
    const cal = await openLastSheet()
    const day = [...cal.host.querySelectorAll('.cal-d')].find(b => b.querySelector('span')?.textContent === '28')
    await act(async () => { day.click() })
    await cal.unmount()
    const sheet = await openLastSheet()
    expect(sheet.host.querySelector('.day-sheet')).toBeTruthy()
    await sheet.unmount()
  })

  it('el historial etiqueta el marcado', async () => {
    setS({ workouts: [marked] })
    const host = document.createElement('div'); document.body.appendChild(host)
    const r = createRoot(host)
    await act(async () => { r.render(<WorkoutRow w={marked} onClick={() => {}} />) })
    expect(host.querySelector('.tt').textContent).toContain('Marcado')
    await act(async () => r.unmount()); host.remove()
  })

  it('el detalle de un marcado sin series ofrece cargarlas y no "Repetir"', async () => {
    setS({ workouts: [marked] })
    workoutDetailSheet(marked)
    const { host, unmount } = await openLastSheet()
    expect(btn(host, 'Cargar series')).toBeTruthy()
    expect(btn(host, 'Repetir este entreno')).toBeUndefined()
    await act(async () => { btn(host, 'Cargar series').click() })
    expect(useUI.getState().sheets.at(-1).kind).toBe('panel')
    await unmount()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/components/day/DaySheet.test.jsx`
Expected: FAIL. El calendario abre el detalle, no la hoja. La fila no dice "Marcado". El detalle no tiene "Cargar series".

- [ ] **Step 3: Implement**

En `frontend/src/sheets.jsx`:

1. Import, junto al de `DaySheet`:

```jsx
import { markedEditorSheet } from './components/day/MarkedWorkoutEditor.jsx'
```

2. En `Calendar`, reemplazar la función `openDay` (las 5 líneas que empiezan con `const openDay = (iso, ws, cls) => {`) por:

```jsx
  // Siempre la hoja del día: ahí están los entrenos de ese día, agregar otro y cargar series de
  // uno marcado (lo mismo que desde la semana de Inicio).
  const openDay = iso => { close(); dayOverrideSheet(iso) }
```

   En el `onClick` de la celda, cambiar `onClick={() => openDay(iso, ws, cls)}` por `onClick={() => openDay(iso)}`.

3. En `WorkoutRow`, en la rama de entreno (no clase), cambiar la línea del título:

```jsx
    <div className="grow"><div className="tt">{w.name}{w.marked && <> <span className="tag nocap">{t('Marcado')}</span></>}</div>
```

4. En `TrainingDetail`, reemplazar la definición de `footer` por:

```jsx
  const done = setsDone(w)
  const routine = st.routines.find(r => r.id === w.routineId) || null
  const footer = <>
    {w.marked && <div className="marked-note" style={{ marginBottom: 12 }}>
      <div className="small muted" style={{ marginBottom: 6 }}>{done ? t('Marcado a mano: estas series las cargaste después.') : t('Marcado a mano, sin series: cuenta para tu racha.')}</div>
      <Button variant="plain" icon="plus" onClick={() => { close?.(); markedEditorSheet({ iso: w.d, routine, workout: w }) }}>{done ? t('Editar series') : t('Cargar series')}</Button>
    </div>}
    <div className="small muted" style={{ margin: '4px 0 6px' }}>{t('Session note')}</div>
    <textarea {...NO_AUTOFILL} name="app-session-note-history" className="input" rows={2} maxLength={NOTE_MAX} value={note}
      placeholder={t('How the session went as a whole.')}
      onChange={e => setNote(e.target.value)} onBlur={saveNote} />
    <div style={{ height: 14 }} />
    {done > 0 && <><Button variant="primary" icon="reset" onClick={() => { if (repeatWorkout(w)) close?.() }}>{t('Repetir este entreno')}</Button>
      <div style={{ height: 8 }} /></>}
    <Button variant="danger" onClick={() => confirmSheet({ title: t('Delete workout?'), message: t('This removes it from your history for good.'), confirmText: t('Delete'), danger: true, onConfirm: () => { update(s => { s.workouts = s.workouts.filter(x => x.id !== w.id) }); close?.(); toast(t('Workout deleted')) } })}>{t('Delete workout')}</Button>
  </>
```

   (`setsDone` ya está importado en `sheets.jsx`. Un entreno en vivo siempre tiene series, así que "Repetir" sigue igual para él.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/components/day src/views/HomeClasses.test.jsx src/components/workout`
Expected: PASS.

- [ ] **Step 5: Run the whole frontend suite**

Run: `cd frontend && npm test`
Expected: PASS. Si un test viejo abría el detalle desde el calendario (`openDay`), corregirlo para que pase por la hoja del día. Ese cambio de comportamiento está en la spec ("Desde el calendario").

- [ ] **Step 6: Commit**

```bash
git add frontend/src/sheets.jsx frontend/src/components/day/DaySheet.test.jsx
git commit -m "feat(day): calendar opens the day sheet; marked workouts in history

The calendar always opens the day sheet, like the home week strip. The
history row tags marked workouts, and their detail offers loading or
editing sets; 'repeat' only shows when there are sets to repeat.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Verificación en el navegador

**Files:** ninguno, salvo los arreglos que salgan.

- [ ] **Step 1: Levantar el dev server**

Si existe `.claude/launch.json` con una configuración del frontend, usar `preview_start` con su `name`. Si no existe, crearlo con el script `dev` de `frontend/package.json`, que es el que levanta Vite:

```json
{
  "version": "0.0.1",
  "configurations": [
    { "name": "frontend", "runtimeExecutable": "npm", "runtimeArgs": ["--prefix", "frontend", "run", "dev"], "port": 5173 }
  ]
}
```

(Ajustar el puerto al de `frontend/vite.config.js` si es otro.)

- [ ] **Step 2: Celular (375×812)**

`resize_window` preset `mobile`. Con un usuario de prueba con al menos una rutina de 5 o más ejercicios:
1. Inicio, tocar un día pasado sin nada: "Tocaba: …", "Entrené / No entrené". Elegir "Entrené" y luego "Marcar como entrenado". El punto del día queda verde y la racha cuenta.
2. Otro día pasado: "Entrené", luego "Cargar series (opcional)". La hoja ocupa toda la pantalla.
3. Tocar el **último** ejercicio: sube arriba de todo y se ve la tabla completa. Tocar kg: Guardar se oculta. Enter recorre kg → reps → serie 2.
4. Quitar y cambiar con confirmación en la fila; "Cambiar" abre la biblioteca y se cierra al elegir.
5. Guardar. En el historial aparece "Marcado"; su detalle tiene "Editar series".
6. Un día pasado con un entreno en vivo: no aparece "Descanso" ni "Volver al plan".
7. `read_console_messages` con `onlyErrors`: vacío.

- [ ] **Step 3: PC (desktop) y tema claro**

`resize_window` preset `desktop`. Calendario, día pasado, "Cargar series": panel centrado de unos 780 px con lista + detalle, Tab recorre las celdas. Repetir con `colorScheme: 'light'`. Volver a `preset: 'desktop'` al terminar.

- [ ] **Step 4: Screenshot de prueba**

`computer { action: 'screenshot' }` del editor en el celular y en PC, para mostrarle al usuario.

- [ ] **Step 5: Commit de arreglos (si hubo)**

```bash
git add -A frontend/src
git commit -m "fix(day): adjustments from browser testing

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
