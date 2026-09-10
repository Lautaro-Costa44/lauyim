import crypto from 'node:crypto';

const FRANJAS = new Set(['desayuno', 'almuerzo', 'merienda', 'cena', 'extra']);
const validIngredients = value => Array.isArray(value) && value.length > 0 && value.every(item => item && String(item.nombre_alimento || '').trim() &&
  ['cantidad_gramos', 'calorias', 'proteina', 'carbohidratos', 'grasas'].every(key => Number.isFinite(Number(item[key])) && Number(item[key]) >= 0));

const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const nextServerTimestamp = state => Math.max(Date.now(), Number(state?._ts || 0) + 1);
const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function findEntityIndex(array, id) {
  return Array.isArray(array) ? array.findIndex(item => item && typeof item === 'object' && String(item.id) === String(id)) : -1;
}

function applyStateChange(state, change) {
  const path = Array.isArray(change?.path) ? change.path.map(String) : [];
  if (!path.length || path.some(key => RESERVED_KEYS.has(key))) throw new Error('invalid state path');
  const [root, entityId, ...fields] = path;

  if (path.length === 1) {
    if (change.op === 'remove') delete state[root];
    else if ((change.op === 'replace' || change.op === 'add') && Object.prototype.hasOwnProperty.call(change, 'value')) state[root] = change.value;
    else throw new Error('invalid state operation');
    return;
  }

  if (Array.isArray(state[root])) {
    const array = state[root];
    const index = findEntityIndex(array, entityId);
    if (fields.length === 0) {
      if (change.op === 'remove') { if (index >= 0) array.splice(index, 1); }
      else if (change.op === 'add') { if (index < 0) array.push(change.value); else array[index] = change.value; }
      else if (change.op === 'replace' && index >= 0) array[index] = change.value;
      else throw new Error('invalid array entity operation');
      return;
    }
    if (index < 0) return;
    let target = array[index];
    for (let i = 0; i < fields.length - 1; i++) {
      const key = fields[i];
      if (target[key] == null || typeof target[key] !== 'object') target[key] = {};
      target = target[key];
    }
    const key = fields[fields.length - 1];
    if (change.op === 'remove') delete target[key];
    else if ((change.op === 'replace' || change.op === 'add') && Object.prototype.hasOwnProperty.call(change, 'value')) target[key] = change.value;
    else throw new Error('invalid nested state operation');
    return;
  }

  let target = state;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (target[key] == null || typeof target[key] !== 'object') target[key] = {};
    target = target[key];
  }
  const key = path[path.length - 1];
  if (change.op === 'remove') delete target[key];
  else if ((change.op === 'replace' || change.op === 'add') && Object.prototype.hasOwnProperty.call(change, 'value')) target[key] = change.value;
  else throw new Error('invalid nested state operation');
}

function insertTemplate(db, userId, name, ingredients) {
  const now = Date.now();
  const row = db.prepare('INSERT INTO plantillas_comida (user_id, nombre, created_at, updated_at) VALUES (?, ?, ?, ?)').run(userId, name, now, now);
  const id = Number(row.lastInsertRowid);
  const stmt = db.prepare('INSERT INTO plantillas_ingredientes (plantilla_id, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const item of ingredients) stmt.run(id, String(item.nombre_alimento).trim(), item.cantidad_gramos, item.calorias, item.proteina, item.carbohidratos, item.grasas);
  return id;
}

function applyRequest(db, userId, request) {
  const p = request.payload || {};
  if (request.kind === 'meal-create') {
    if (!validDate(p.fecha) || !FRANJAS.has(p.franja) || !validIngredients([p])) throw new Error('invalid meal');
    const row = db.prepare('INSERT INTO comidas_registradas (user_id, fecha, franja, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(userId, p.fecha, p.franja, String(p.nombre_alimento).trim(), p.cantidad_gramos, p.calorias, p.proteina, p.carbohidratos, p.grasas);
    return { id: Number(row.lastInsertRowid), tempId: p.tempId || null };
  }
  if (request.kind === 'meal-delete') { db.prepare('DELETE FROM comidas_registradas WHERE id = ? AND user_id = ?').run(p.id, userId); return { deleted: p.id }; }
  if (request.kind === 'meal-group-delete') { db.prepare('DELETE FROM comidas_registradas WHERE grupo_id = ? AND user_id = ?').run(String(p.grupoId || ''), userId); return { deletedGroup: p.grupoId }; }
  if (request.kind === 'meal-group-create') {
    if (!validDate(p.fecha) || !FRANJAS.has(p.franja) || !String(p.grupo_nombre || '').trim() || !validIngredients(p.ingredientes)) throw new Error('invalid meal group');
    const groupId = 'g' + crypto.randomBytes(16).toString('hex');
    const stmt = db.prepare('INSERT INTO comidas_registradas (user_id, grupo_id, grupo_nombre, fecha, franja, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const item of p.ingredientes) stmt.run(userId, groupId, p.grupo_nombre, p.fecha, p.franja, String(item.nombre_alimento).trim(), item.cantidad_gramos, item.calorias, item.proteina, item.carbohidratos, item.grasas);
    return { grupo_id: groupId, tempGroupId: p.tempGroupId || null };
  }
  if (request.kind === 'template-create') {
    const name = String(p.nombre || '').trim();
    if (!name || !validIngredients(p.ingredientes)) throw new Error('invalid template');
    return { id: insertTemplate(db, userId, name, p.ingredientes), tempId: p.tempId || null };
  }
  if (request.kind === 'compound-create') {
    const name = String(p.nombre || '').trim();
    if (!name || !validDate(p.fecha) || !FRANJAS.has(p.franja) || !validIngredients(p.ingredientes)) throw new Error('invalid compound');
    const templateId = insertTemplate(db, userId, name, p.ingredientes);
    const groupId = 'g' + crypto.randomBytes(16).toString('hex');
    const stmt = db.prepare('INSERT INTO comidas_registradas (user_id, grupo_id, grupo_nombre, fecha, franja, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    for (const item of p.ingredientes) stmt.run(userId, groupId, name, p.fecha, p.franja, String(item.nombre_alimento).trim(), item.cantidad_gramos, item.calorias, item.proteina, item.carbohidratos, item.grasas);
    return { id: templateId, grupo_id: groupId, tempId: p.tempId || null, tempGroupId: p.tempGroupId || null };
  }
  if (request.kind === 'template-update') {
    const id = String(p.id || ''), name = String(p.nombre || '').trim();
    const current = db.prepare('SELECT id, updated_at FROM plantillas_comida WHERE id = ? AND user_id = ?').get(id, userId);
    if (!name || !validIngredients(p.ingredientes)) throw new Error('invalid template');
    const updatedAt = Date.now();
    if (current) {
      db.prepare('UPDATE plantillas_comida SET nombre = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(name, updatedAt, id, userId);
      db.prepare('DELETE FROM plantillas_ingredientes WHERE plantilla_id = ?').run(id);
    } else {
      const numericId = Number(id);
      if (!Number.isInteger(numericId) || numericId <= 0) return { updated: p.id, missing: true };
      db.prepare('INSERT INTO plantillas_comida (id, user_id, nombre, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(numericId, userId, name, updatedAt, updatedAt);
    }
    const stmt = db.prepare('INSERT INTO plantillas_ingredientes (plantilla_id, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const item of p.ingredientes) stmt.run(id, String(item.nombre_alimento).trim(), item.cantidad_gramos, item.calorias, item.proteina, item.carbohidratos, item.grasas);
    return { updated: id };
  }
  if (request.kind === 'template-delete') {
    db.prepare('DELETE FROM plantillas_comida WHERE id = ? AND user_id = ?').run(p.id, userId);
    return { deleted: p.id };
  }
  throw new Error('unsupported sync operation');
}

export function processSyncBatch({ db, userId, operations, getUserState, saveUserState }) {
  const results = [], conflicts = [], appliedIds = [];
  const orderedOperations = [...(operations || [])].sort((a, b) => {
    const byTime = Number(a?.createdAt || 0) - Number(b?.createdAt || 0);
    return byTime || String(a?.id || '').localeCompare(String(b?.id || ''));
  });
  const operationOrder = new Map(orderedOperations.map((operation, index) => [operation.id, index]));
  let currentState = getUserState(userId) || {};
  const syncVersions = currentState._syncVersions && typeof currentState._syncVersions === 'object'
    ? { ...currentState._syncVersions }
    : {};
  currentState._syncVersions = syncVersions;
  const latestStateOperationByPath = new Map();
  for (const operation of orderedOperations) {
    if (operation?.changes?.some(change => change?.request)) continue;
    for (const change of operation?.changes || []) {
      const path = Array.isArray(change?.path) ? change.path.map(String) : [];
      if (path.length) latestStateOperationByPath.set(JSON.stringify(path), operation.id);
    }
  }
  const isLatestStateChange = (change, operationId) => {
    const path = Array.isArray(change?.path) ? change.path.map(String) : [];
    if (!path.length) return false;
    const exact = latestStateOperationByPath.get(JSON.stringify(path));
    if (exact && exact !== operationId) return false;
    // An add/remove/replace of an entity invalidates older field patches for that
    // entity. Different fields of the same entity remain mergeable.
    if (path.length > 2 && Array.isArray(currentState[path[0]])) {
      const entityPath = JSON.stringify(path.slice(0, 2));
      const entityLatest = latestStateOperationByPath.get(entityPath);
      if (entityLatest && entityLatest !== operationId && (operationOrder.get(entityLatest) ?? -1) > (operationOrder.get(operationId) ?? -1)) return false;
    }
    return exact === operationId || (!exact && path.length <= 2) || (path.length > 2 && latestStateOperationByPath.get(JSON.stringify(path.slice(0, 2))) === operationId);
  };
  for (const operation of orderedOperations) {
    const request = operation?.changes?.find(change => change?.request)?.request;
    const opId = String(request?.opId || operation?.id || '');
    if (!opId || opId.length > 120) { conflicts.push({ id: operation?.id, reason: 'invalid_operation_id' }); continue; }
    const previous = db.prepare('SELECT result_json FROM sync_operations WHERE user_id = ? AND op_id = ?').get(userId, opId);
    if (previous) { results.push({ id: operation.id, opId, result: JSON.parse(previous.result_json || '{}'), replay: true }); appliedIds.push(operation.id); continue; }
    const stateChanges = request ? [] : (operation.changes || []).filter(change => isLatestStateChange(change, operation.id));
    const wasSuperseded = !request && stateChanges.length === 0 && (operation.changes || []).length > 0;
    if (wasSuperseded) {
      try {
        db.exec('BEGIN');
        const result = { superseded: true };
        db.prepare('INSERT INTO sync_operations (user_id, op_id, result_json, created_at) VALUES (?, ?, ?, ?)').run(userId, opId, JSON.stringify(result), Date.now());
        db.exec('COMMIT');
        results.push({ id: operation.id, opId, result });
        appliedIds.push(operation.id);
      } catch (error) {
        try { db.exec('ROLLBACK'); } catch {}
        conflicts.push({ id: operation.id, opId, reason: error.code || error.message || 'sync_failed' });
      }
      continue;
    }
    const current = request ? null : currentState;
    try {
      db.exec('BEGIN');
      let result = {};
      if (request) result = applyRequest(db, userId, request);
      else {
        for (const change of stateChanges) {
          applyStateChange(current, change);
        }
        const committedAt = nextServerTimestamp(current);
        for (const change of stateChanges) {
          const key = JSON.stringify(change.path.map(String));
          syncVersions[key] = committedAt;
        }
        current._ts = committedAt;
        current._syncVersions = syncVersions;
        saveUserState(userId, current); result = { ts: current._ts };
      }
      db.prepare('INSERT INTO sync_operations (user_id, op_id, result_json, created_at) VALUES (?, ?, ?, ?)').run(userId, opId, JSON.stringify(result), Date.now());
      db.exec('COMMIT');
      results.push({ id: operation.id, opId, result }); appliedIds.push(operation.id);
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      conflicts.push({ id: operation.id, opId, reason: error.code || error.message || 'sync_failed' });
    }
  }
  db.prepare('DELETE FROM sync_operations WHERE created_at < ?').run(Date.now() - 90 * 86400000);
  return { results, conflicts, appliedIds };
}
