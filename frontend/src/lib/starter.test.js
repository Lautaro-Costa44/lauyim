import { describe, expect, it } from 'vitest'
import { addProgramToState, addPresetCustomExercises, pickProgram, presetSourceFor, presetsOfGroup } from './starter.js'

const PRESETS = [
  { id: 'p1', name: 'Push', emoji: 'barbell', group_name: 'PPL', planned_day: 1, ex: [{ id: '0025', sets: 4, reps: 8 }] },
  { id: 'p2', name: 'Pull', emoji: 'pullup', group_name: 'PPL', planned_day: 3, ex: [{ id: '0027', sets: 4, reps: 8 }] },
  { id: 't1', name: 'Torso', emoji: 'barbell', group_name: 'Torso / Pierna', planned_day: 1, ex: [] },
]
const SOURCE = { kind: 'preset', programId: 'gppl', at: 1 }

describe('presetSourceFor', () => {
  it('finds the program by name, ignoring case; null for a server without programs', () => {
    expect(presetSourceFor({ programs: [{ id: 'gppl', name: 'PPL' }] }, 'ppl')).toMatchObject({ kind: 'preset', programId: 'gppl' })
    expect(presetSourceFor({ presets: [] }, 'PPL')).toBeNull()
  })
})

describe('addProgramToState', () => {
  it('adds the program as a new active group with fresh ids, its planned days and its source', () => {
    const state = { routines: [], week: {}, routineGroups: [], activeGroupId: null }
    const result = addProgramToState(state, { name: 'PPL', presets: presetsOfGroup(PRESETS, 'PPL'), source: SOURCE })
    expect(result.ok).toBe(true)
    expect(state.routineGroups).toHaveLength(1)
    expect(state.routineGroups[0].source).toEqual(SOURCE)
    expect(state.activeGroupId).toBe(result.group.id)
    expect(state.routines.map(r => r.name)).toEqual(['Push', 'Pull'])
    expect(state.routines.map(r => r.id)).not.toContain('p1')
    expect(state.week).toEqual({ 1: state.routines[0].id, 3: state.routines[1].id })
  })

  it('keeps the member\'s current plan: legacy routines are wrapped in a group first; not activating leaves them active', () => {
    const state = { routines: [{ id: 'old', name: 'Mine', ex: [] }], week: { 2: 'old' }, routineGroups: [], activeGroupId: null }
    const result = addProgramToState(state, { name: 'PPL', presets: presetsOfGroup(PRESETS, 'PPL'), source: SOURCE, activate: false })
    expect(result.ok).toBe(true)
    expect(state.routineGroups).toHaveLength(2)
    expect(state.routineGroups[0].routines.map(r => r.id)).toEqual(['old'])
    expect(state.routines.map(r => r.id)).toEqual(['old'])
    expect(state.week).toEqual({ 2: 'old' })
    expect(state.activeGroupId).toBe(state.routineGroups[0].id)
  })

  it('refuses a group name the member already has, and a sixth group', () => {
    const group = (id, name) => ({ id, name, routines: [], week: {} })
    const taken = { routines: [], week: {}, routineGroups: [group('g1', 'ppl')], activeGroupId: 'g1' }
    expect(addProgramToState(taken, { name: 'PPL', presets: PRESETS.slice(0, 2) })).toMatchObject({ ok: false, error: 'exists' })
    const full = { routines: [], week: {}, routineGroups: [1, 2, 3, 4, 5].map(i => group('g' + i, 'G' + i)), activeGroupId: 'g1' }
    expect(addProgramToState(full, { name: 'PPL', presets: PRESETS.slice(0, 2) })).toMatchObject({ ok: false, error: 'limit' })
    expect(full.routineGroups).toHaveLength(5)
  })
})

describe('ejercicios custom del gym en un programa', () => {
  const DEF = { id: 'cx-remo', n: 'Remo del gym', tg: 'upper back', bp: 'back', mg: 'lats', sm: [], custom: true, shared: true }
  const WITH_CUSTOM = [{ id: 'q1', name: 'Espalda', group_name: 'Gym', planned_day: 2, ex: [{ id: 'cx-remo', sets: 3, reps: 10 }, { id: '0027', sets: 3, reps: 8 }] }]

  it('agrega solo los que usa el programa, con origin, y no duplica al aplicar dos veces', () => {
    const state = { customEx: [{ id: 'mine', n: 'Mío' }] }
    const other = { id: 'cx-otro', n: 'No usado' }
    expect(addPresetCustomExercises(state, WITH_CUSTOM, [DEF, other])).toBe(1)
    expect(addPresetCustomExercises(state, WITH_CUSTOM, [DEF, other])).toBe(0)
    expect(state.customEx.map(e => e.id)).toEqual(['mine', 'cx-remo'])
    expect(state.customEx[1]).toMatchObject({ origin: 'cx-remo', n: 'Remo del gym', custom: true })
    expect(state.customEx[1].shared).toBeUndefined()
  })

  it('una copia que ya vino del servidor (mismo id / origin) cuenta como tenida', () => {
    const state = { customEx: [{ id: 'cx-remo', origin: 'cx-remo', n: 'Mi remo' }] }
    expect(addPresetCustomExercises(state, WITH_CUSTOM, [DEF])).toBe(0)
    expect(state.customEx[0].n).toBe('Mi remo')
  })

  it('addProgramToState los suma junto con el grupo', () => {
    const state = { routines: [], week: {}, routineGroups: [], activeGroupId: null, customEx: [] }
    expect(addProgramToState(state, { name: 'Gym', presets: WITH_CUSTOM, customDefs: [DEF] }).ok).toBe(true)
    expect(state.customEx.map(e => e.id)).toEqual(['cx-remo'])
    expect(state.routines[0].ex.map(e => e.id)).toEqual(['cx-remo', '0027'])
  })
})

describe('pickProgram', () => {
  const ppl = presetsOfGroup(PRESETS, 'PPL')
  it('sin rutinas y con el grupo vacío por defecto: lo llena y le pone el nombre del programa', () => {
    const state = { routines: [], week: { 4: 'viejo' }, routineGroups: [{ id: 'g1', name: 'Mi Plan', routines: [], week: {} }], activeGroupId: 'g1', customEx: [] }
    expect(pickProgram(state, { name: 'PPL', presets: ppl, source: SOURCE }).ok).toBe(true)
    expect(state.routineGroups).toHaveLength(1)
    expect(state.routineGroups[0]).toMatchObject({ id: 'g1', name: 'PPL', source: SOURCE })
    expect(state.routineGroups[0].routines.map(r => r.name)).toEqual(['Push', 'Pull'])
    expect(state.week).toEqual({ 1: state.routines[0].id, 3: state.routines[1].id })
    expect(state.estadoInicial).toBe('plan_predeterminado')
  })

  it('con rutinas: suma el programa como grupo nuevo activo y no pisa nada', () => {
    const mine = { id: 'm', name: 'Mía', ex: [] }
    const state = { routines: [mine], week: { 2: 'm' }, routineGroups: [{ id: 'g1', name: 'Mi Plan', routines: [mine], week: { 2: 'm' } }], activeGroupId: 'g1', customEx: [] }
    expect(pickProgram(state, { name: 'PPL', presets: ppl, source: SOURCE }).ok).toBe(true)
    expect(state.routineGroups.map(g => g.name)).toEqual(['Mi Plan', 'PPL'])
    expect(state.routineGroups[0].routines.map(r => r.id)).toEqual(['m'])
    expect(state.routines.map(r => r.name)).toEqual(['Push', 'Pull'])
  })
})
