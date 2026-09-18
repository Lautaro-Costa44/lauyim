import test from 'node:test';
import assert from 'node:assert/strict';
import { alignActiveGroupForAudit, detectRoutineAuditChanges } from './routine-audit.js';

const routine = (id, name, extra = {}) => ({ id, name, emoji: 'dumbbell', ex: [], ...extra });
const group = (id, name, routines) => ({ id, name, routines, week: {}, createdAt: 1 });

function activeState(routines, groups = [group('g1', 'General', routines)]) {
  return { routines, week: {}, dayPlan: {}, routineGroups: groups, activeGroupId: groups[0]?.id || null };
}

test('putAll editing an existing routine produces an update, not a create', () => {
  const before = activeState([routine('r1', 'Push')]);
  const after = activeState([routine('r1', 'Push', { ex: [{ id: 'bench', sets: 4 }] })]);
  assert.deepEqual(detectRoutineAuditChanges(before, after).summaries, ["Rutina 'Push' actualizada"]);
});

test('putAll renaming an existing routine uses the final name', () => {
  const before = activeState([routine('r1', 'Push')]);
  const after = activeState([routine('r1', 'Nuevo nombre')]);
  assert.deepEqual(detectRoutineAuditChanges(before, after).summaries, ["Rutina 'Nuevo nombre' actualizada"]);
});

test('putAll without changes produces no audit summary', () => {
  const state = activeState([routine('r1', 'Push')]);
  assert.deepEqual(detectRoutineAuditChanges(state, structuredClone(state)).summaries, []);
});

test('putAll aligns stale group data with the active routine table before comparing', () => {
  const table = [routine('r1', 'Push')];
  const staleBefore = activeState([], [group('g1', 'General', [])]);
  const before = alignActiveGroupForAudit(staleBefore, table, {});
  const after = alignActiveGroupForAudit(staleBefore, table, {});
  assert.deepEqual(detectRoutineAuditChanges(before, after).summaries, []);
  assert.equal(before.routineGroups[0].routines[0].id, after.routineGroups[0].routines[0].id);
});

test('group creation, active switch, routine mutations, reorder, and progression have precise summaries', () => {
  const original = [routine('r1', 'Push'), routine('r2', 'Legs')];
  const before = activeState(original, [group('g1', 'Fuerza', original), group('g2', 'Volumen', [])]);
  const createdGroup = { ...before, routineGroups: [...before.routineGroups, group('g3', 'Nuevo', [])], activeGroupId: 'g3', routines: [] };
  assert.deepEqual(detectRoutineAuditChanges(before, createdGroup).summaries, ["Grupo 'Nuevo' creado"]);
  const switched = { ...before, activeGroupId: 'g2', routines: [] };
  assert.deepEqual(detectRoutineAuditChanges(before, switched).summaries, ["Grupo activo: 'Volumen'"]);
  const added = { ...before, routineGroups: [group('g1', 'Fuerza', [...original, routine('r3', 'Pull')]), before.routineGroups[1]] };
  assert.deepEqual(detectRoutineAuditChanges(before, added).summaries, ["Rutina 'Pull' creada"]);
  const removed = { ...before, routineGroups: [group('g1', 'Fuerza', [original[0]]), before.routineGroups[1]] };
  assert.deepEqual(detectRoutineAuditChanges(before, removed).summaries, ["Rutina 'Legs' eliminada"]);
  const reordered = { ...before, routineGroups: [group('g1', 'Fuerza', [original[1], original[0]]), before.routineGroups[1]] };
  assert.deepEqual(detectRoutineAuditChanges(before, reordered).summaries, ['Grupo actualizado']);
  const progressed = { ...before, routineGroups: [{ ...before.routineGroups[0], progressionType: 'linear' }, before.routineGroups[1]] };
  assert.deepEqual(detectRoutineAuditChanges(before, progressed).summaries, ['Progresión actualizada']);
});
