// The Push/Pull/Legs routines of the demo build, which seeds a history on top of exactly these.
// The member app never offers them as a plan: a new gym gets the same PPL as its first program
// from the server (DEFAULT_PRESETS in api/server.js), and "Cargar un plan" only lists programs.
import { uid } from './format.js'
import { addGroupToState, applyPlannedDays, canAddGroup, createRoutineGroup, syncActiveGroupInState, validateGroupName } from './routineGroups.js'

const SPEC = [
  ['Push Day', 'barbell', 1, [['0025', 4, 8], ['0047', 3, 10], ['0426', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 3, 10]]],
  ['Pull Day', 'pullup', 3, [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['0031', 3, 10], ['0313', 3, 12]]],
  ['Leg Day', 'legs', 5, [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]]]
]

// Fresh routine objects (new ids) — [push, pull, legs].
export const starterRoutines = () =>
  SPEC.map(([name, emoji, plannedDay, list]) => ({ id: uid(), name, emoji, plannedDay, ex: list.map(([id, sets, reps]) => ({ id, sets, reps, weight: 0 })) }))

export const routinesFromPresets = presets => (presets || []).map(p => ({
  id: uid(), name: p.name, emoji: p.emoji || 'dumbbell', plannedDay: Number.isInteger(p.planned_day) ? p.planned_day : null,
  ex: (p.ex || []).map(e => ({ ...e }))
}))

/**
 * Custom exercises (the gym's own, created by an admin) used by these presets, added to the
 * member's S.customEx when missing — so they show by name and count in the muscle/fatigue maps
 * right away. Each keeps the original id (what the routines reference) plus `origin`, which the
 * server stores as the member's own copy. `defs` is GET /api/presets' customExercises. Mutates
 * `state`; returns how many were added. Applying the same program twice adds nothing.
 */
export function addPresetCustomExercises(state, presets, defs) {
  const used = new Set((presets || []).flatMap(p => (p.ex || []).map(e => String(e.id))))
  const have = new Set((state.customEx || []).flatMap(ex => [String(ex.id), ex.origin && String(ex.origin)]).filter(Boolean))
  let added = 0
  for (const def of defs || []) {
    const id = String(def?.id || '')
    if (!id || !used.has(id) || have.has(id)) continue
    state.customEx = [...(state.customEx || []), { ...def, id, origin: id, custom: true, shared: undefined }]
    have.add(id)
    added++
  }
  return added
}

/**
 * The member picks one of the gym's programs as their plan (first login, or "Load starter plan"
 * in Plan). Without routines, the program fills the active group (or a new one) and becomes the
 * week; with routines already there, it is added as a new active group and nothing is replaced.
 * Mutates `state`; returns { ok: true } or addProgramToState's { ok: false, error, … }.
 */
export function pickProgram(state, { name, presets, source, customDefs }) {
  if ((state.routines || []).length) return addProgramToState(state, { name, presets, source, customDefs, activate: true })
  const routines = routinesFromPresets(presets)
  const result = applyPlannedDays(routines, {}, { groupRoutines: routines })
  if (!result.ok) return { ok: false, error: 'day', conflict: result.conflict }
  const groups = state.routineGroups || []
  const active = groups.find(g => g.id === state.activeGroupId) || groups[0]
  if (!active) {
    const group = createRoutineGroup(name, routines, result.week, source ? { source } : {})
    state.routineGroups = [group]
    state.activeGroupId = group.id
  } else {
    // An empty group ("Mi Plan" by default) takes the program's name, unless another group has it.
    state.activeGroupId = active.id
    if (validateGroupName(name, groups, active.id).valid) active.name = String(name).trim()
    if (source) active.source = source
    else delete active.source
  }
  state.routines = routines
  state.week = result.week
  syncActiveGroupInState(state)
  addPresetCustomExercises(state, presets, customDefs)
  state.estadoInicial = 'plan_predeterminado'
  return { ok: true }
}

// Group name of a preset as the member app reads it.
export const presetGroupOf = p => String(p?.group_name || p?.groupName || 'General').trim() || 'General'

// The presets of one program (by name), in the program's day order (the server sends them so).
export const presetsOfGroup = (presets, name) => (presets || []).filter(p => presetGroupOf(p) === name)

// `source` for a routine group loaded from a program, from a GET /api/presets answer. Null
// when the server predates programs: the group still loads, it just isn't counted.
export function presetSourceFor(data, name) {
  const key = String(name || '').trim().toLowerCase()
  const program = (data?.programs || []).find(p => String(p.name).trim().toLowerCase() === key)
  return program ? { kind: 'preset', programId: program.id, at: Date.now() } : null
}

/**
 * Adds a program as a new routine group to a member's routine state ({ routines, week,
 * routineGroups, activeGroupId }), the same way "Load pre-built plans" does in Settings: the
 * member's other groups stay, the new one gets fresh routine ids and its planned days.
 * Mutates `state`. Returns { ok: true, group } or { ok: false, error: 'limit'|'exists'|'day', … }.
 */
export function addProgramToState(state, { name, presets, source, activate = true, customDefs }) {
  const groups = state.routineGroups || []
  // A member with routines but no groups yet (from before groups existed) gets them wrapped
  // in a default group first, as the app itself does on load.
  if (!groups.length && ((state.routines || []).length || Object.keys(state.week || {}).length)) syncActiveGroupInState(state)
  if (!canAddGroup(state.routineGroups)) return { ok: false, error: 'limit' }
  if (!validateGroupName(name, state.routineGroups || []).valid) return { ok: false, error: 'exists' }
  const routines = routinesFromPresets(presets)
  const result = applyPlannedDays(routines, {}, { groupRoutines: routines })
  if (!result.ok) return { ok: false, error: 'day', conflict: result.conflict }
  const group = addGroupToState(state, name, routines, result.week, activate, source ? { source } : {})
  addPresetCustomExercises(state, presets, customDefs)
  return { ok: true, group }
}
