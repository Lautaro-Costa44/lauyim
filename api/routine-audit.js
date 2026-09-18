const routineComparable = routine => {
  const value = { ...routine, id: String(routine.id), emoji: routine.emoji || 'dumbbell', ex: routine.ex || [] }
  for (const field of ['user_id', 'created_at', 'created', 'progression', 'progressionType', 'progressionConfig', 'progression_type', 'progression_config']) delete value[field]
  return value
}

const progressionOf = routine => ({
  progression: routine.progression ?? null,
  progressionType: routine.progressionType ?? routine.progression_type ?? null,
  progressionConfig: routine.progressionConfig ?? routine.progression_config ?? null
})

const groupComparable = group => {
  const value = { ...group, id: String(group.id), name: String(group.name || '').trim() }
  for (const field of ['routines', 'week', 'createdAt', 'created_at', 'activeGroupId', 'progression', 'progressionType', 'progressionConfig', 'progression_type', 'progression_config']) delete value[field]
  return value
}

const groupProgressionOf = group => ({
  progression: group.progression ?? null,
  progressionType: group.progressionType ?? group.progression_type ?? null,
  progressionConfig: group.progressionConfig ?? group.progression_config ?? null
})

export function alignActiveGroupForAudit(state, routines, week) {
  return {
    ...state,
    routineGroups: (state.routineGroups || []).map(group => String(group.id) === String(state.activeGroupId)
      ? { ...group, routines, week }
      : group)
  }
}

export function detectRoutineAuditChanges(before, after) {
  const summaries = []
  const routineLogs = []
  const beforeGroups = new Map((before.routineGroups || []).map(group => [String(group.id), group]))
  const afterGroups = new Map((after.routineGroups || []).map(group => [String(group.id), group]))
  const newGroupIds = new Set([...afterGroups.keys()].filter(id => !beforeGroups.has(id)))
  let changed = false
  let planChanged = false

  if (before.activeGroupId !== after.activeGroupId && after.activeGroupId && !newGroupIds.has(String(after.activeGroupId))) {
    const activeGroup = afterGroups.get(String(after.activeGroupId))
    changed = true
    planChanged = true
    summaries.push(`Grupo activo: '${activeGroup?.name || after.activeGroupId}'`)
  }

  for (const [groupId, group] of afterGroups) {
    if (!beforeGroups.has(groupId)) {
      changed = true
      planChanged = true
      summaries.push(`Grupo '${group.name}' creado`)
      continue
    }
    const previous = beforeGroups.get(groupId)
    const beforeRoutines = new Map((previous.routines || []).map(routine => [String(routine.id), routine]))
    const afterRoutines = new Map((group.routines || []).map(routine => [String(routine.id), routine]))
    const common = new Set([...beforeRoutines.keys()].filter(id => afterRoutines.has(id)))
    const beforeOrder = [...beforeRoutines.keys()].filter(id => common.has(id))
    const afterOrder = [...afterRoutines.keys()].filter(id => common.has(id))
    if (JSON.stringify(beforeOrder) !== JSON.stringify(afterOrder)) {
      changed = true
      planChanged = true
      summaries.push('Grupo actualizado')
    }
    if (JSON.stringify(groupProgressionOf(previous)) !== JSON.stringify(groupProgressionOf(group))) {
      changed = true
      planChanged = true
      summaries.push('Progresión actualizada')
    }
    for (const [routineId, routine] of afterRoutines) {
      const previousRoutine = beforeRoutines.get(routineId)
      if (!previousRoutine) {
        changed = true
        summaries.push(`Rutina '${routine.name}' creada`)
        routineLogs.push({ action: 'create', entityId: routineId, after: routine })
        continue
      }
      const progressionChanged = JSON.stringify(progressionOf(previousRoutine)) !== JSON.stringify(progressionOf(routine))
      const contentChanged = JSON.stringify(routineComparable(previousRoutine)) !== JSON.stringify(routineComparable(routine))
      if (contentChanged || progressionChanged) {
        changed = true
        if (progressionChanged) summaries.push('Progresión actualizada')
        if (contentChanged) summaries.push(`Rutina '${routine.name}' actualizada`)
        routineLogs.push({ action: 'update', entityId: routineId, before: previousRoutine, after: routine })
      }
    }
    for (const [routineId, routine] of beforeRoutines) {
      if (!afterRoutines.has(routineId)) {
        changed = true
        summaries.push(`Rutina '${routine.name}' eliminada`)
        routineLogs.push({ action: 'delete', entityId: routineId, before: routine })
      }
    }
    if (JSON.stringify(groupComparable(previous)) !== JSON.stringify(groupComparable(group))) {
      changed = true
      planChanged = true
      if (!summaries.includes('Grupo actualizado')) summaries.push('Grupo actualizado')
    }
  }
  for (const [groupId, group] of beforeGroups) {
    if (!afterGroups.has(groupId)) {
      changed = true
      planChanged = true
      summaries.push(`Grupo '${group.name}' eliminado`)
    }
  }
  return { changed, planChanged, summaries, routineLogs }
}
