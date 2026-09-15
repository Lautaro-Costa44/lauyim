import { uid } from './format.js'
import { t } from './i18n.js'

export const MAX_ROUTINE_GROUPS = 5

export const PLANNED_DAYS = new Set([0, 1, 2, 3, 4, 5, 6])

export function plannedDayOf(routine) {
  return Number.isInteger(routine?.plannedDay) && PLANNED_DAYS.has(routine.plannedDay)
    ? routine.plannedDay
    : null
}

export function findPlannedDayConflict(routines = [], { excludeRoutineId = null } = {}) {
  const occupied = new Map()
  for (const routine of routines || []) {
    if (!routine || routine.id === excludeRoutineId) continue
    const day = plannedDayOf(routine)
    if (day === null) continue
    if (occupied.has(day)) return { routine: routine, day, existingRoutine: occupied.get(day) }
    occupied.set(day, routine)
  }
  return null
}

/**
 * Valida y aplica plannedDay sin asignar nunca por posición del array.
 * La función no modifica week si detecta un conflicto.
 */
export function applyPlannedDays(routines = [], week = {}, { groupRoutines = routines, replace = false } = {}) {
  const source = routines || []
  const internal = findPlannedDayConflict(source)
  if (internal) {
    return { ok: false, conflict: { day: internal.day, routine: internal.routine, existingRoutine: internal.existingRoutine } }
  }

  const nextWeek = { ...(week || {}) }
  if (replace) {
    for (const routine of source) {
      const day = plannedDayOf(routine)
      if (day !== null) delete nextWeek[day]
    }
  }

  for (const routine of source) {
    const day = plannedDayOf(routine)
    if (day === null) continue
    const occupiedId = nextWeek[day]
    const occupyingRoutine = (groupRoutines || []).find(r => r?.id === occupiedId)
    if (occupiedId && !source.some(r => r?.id === occupiedId)) {
      return { ok: false, conflict: { day, routine, existingRoutine: occupyingRoutine || { id: occupiedId, name: t('Routine') } } }
    }
    nextWeek[day] = routine.id
  }
  return { ok: true, week: nextWeek }
}

export const PRESET_GROUP_NAMES = [
  'Push / Pull / Legs (PPL)',
  'Torso / Pierna',
  'Full Body',
  'Arnold Split',
  'Weider / Frecuencia 1',
  'Cardio & Fuerza',
  'Tren Superior / Inferior',
]

/**
 * Valida si se puede agregar un nuevo grupo según el límite máximo.
 */
export function canAddGroup(groups = []) {
  return (groups || []).length < MAX_ROUTINE_GROUPS
}

/**
 * Valida el nombre de un grupo.
 * Retorna { valid: boolean, error?: string }
 */
export function validateGroupName(name, existingGroups = [], currentId = null) {
  const trimmed = (name || '').trim()
  if (!trimmed) {
    return { valid: false, error: t('El nombre del grupo no puede estar vacío.') }
  }
  if (trimmed.length > 50) {
    return { valid: false, error: t('El nombre no puede superar los 50 caracteres.') }
  }
  const duplicate = existingGroups.some(g => g.id !== currentId && g.name.trim().toLowerCase() === trimmed.toLowerCase())
  if (duplicate) {
    return { valid: false, error: t('Ya existe un grupo con este nombre.') }
  }
  return { valid: true, error: null }
}

/**
 * Crea un nuevo objeto de grupo de rutinas.
 */
export function createRoutineGroup(name, routines = [], week = {}) {
  return {
    id: uid(),
    name: (name || '').trim() || t('Nuevo Grupo'),
    routines: JSON.parse(JSON.stringify(routines || [])),
    week: JSON.parse(JSON.stringify(week || {})),
    createdAt: Date.now(),
  }
}

/**
 * Sincroniza el grupo activo actual con los datos del estado principal (S.routines y S.week).
 * Retorna la lista actualizada de grupos.
 */
export function syncActiveGroupInState(state) {
  if (!state.routineGroups || state.routineGroups.length === 0) {
    if ((state.routines && state.routines.length > 0) || Object.keys(state.week || {}).length > 0) {
      const defaultGroup = createRoutineGroup(state.rutinaGenerada?.split || t('Mi Plan'), state.routines, state.week)
      state.routineGroups = [defaultGroup]
      state.activeGroupId = defaultGroup.id
    } else {
      state.routineGroups = []
      state.activeGroupId = null
    }
    return state.routineGroups
  }

  const activeId = state.activeGroupId || state.routineGroups[0]?.id
  state.activeGroupId = activeId

  const idx = state.routineGroups.findIndex(g => g.id === activeId)
  if (idx !== -1) {
    state.routineGroups[idx] = {
      ...state.routineGroups[idx],
      routines: JSON.parse(JSON.stringify(state.routines || [])),
      week: JSON.parse(JSON.stringify(state.week || {})),
    }
  }
  return state.routineGroups
}

/**
 * Cambia el grupo activo cargando sus rutinas y calendario semanal en S.routines y S.week.
 */
export function switchActiveGroup(state, targetGroupId) {
  if (!state.routineGroups || state.routineGroups.length === 0) return

  // Primero guardamos el estado actual en el grupo activo que dejamos
  syncActiveGroupInState(state)

  const targetGroup = state.routineGroups.find(g => g.id === targetGroupId)
  if (targetGroup) {
    state.activeGroupId = targetGroup.id
    state.routines = JSON.parse(JSON.stringify(targetGroup.routines || []))
    state.week = JSON.parse(JSON.stringify(targetGroup.week || {}))
  }
}

/**
 * Añade un nuevo grupo al estado y opcionalmente lo activa.
 */
export function addGroupToState(state, name, routines = [], week = {}, setAsActive = true) {
  state.routineGroups = state.routineGroups || []
  if (state.routineGroups.length >= MAX_ROUTINE_GROUPS) {
    throw new Error(t('Límite de {0} grupos alcanzado.', MAX_ROUTINE_GROUPS))
  }

  // Asegurar sincronización previa
  if (state.routineGroups.length === 0 && (state.routines?.length || Object.keys(state.week || {}).length)) {
    syncActiveGroupInState(state)
  }

  const newGroup = createRoutineGroup(name, routines, week)
  state.routineGroups.push(newGroup)

  if (setAsActive) {
    // Si se activa, primero guardamos el actual y luego activamos el nuevo
    if (state.activeGroupId && state.activeGroupId !== newGroup.id) {
      syncActiveGroupInState(state)
    }
    state.activeGroupId = newGroup.id
    state.routines = JSON.parse(JSON.stringify(newGroup.routines || []))
    state.week = JSON.parse(JSON.stringify(newGroup.week || {}))
  }

  return newGroup
}

/**
 * Elimina un grupo de rutinas. Si era el activo, activa el primer grupo restante.
 */
export function removeGroupFromState(state, groupId) {
  if (!state.routineGroups) return
  syncActiveGroupInState(state)

  state.routineGroups = state.routineGroups.filter(g => g.id !== groupId)

  if (state.activeGroupId === groupId) {
    if (state.routineGroups.length > 0) {
      const nextGroup = state.routineGroups[0]
      state.activeGroupId = nextGroup.id
      state.routines = JSON.parse(JSON.stringify(nextGroup.routines || []))
      state.week = JSON.parse(JSON.stringify(nextGroup.week || {}))
    } else {
      state.activeGroupId = null
      state.routines = []
      state.week = {}
    }
  }
}
