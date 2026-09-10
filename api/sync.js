import crypto from 'node:crypto';

const FRANJAS = new Set(['desayuno', 'almuerzo', 'merienda', 'cena', 'extra']);
const validIngredients = value => Array.isArray(value) && value.length > 0 && value.every(item => item && String(item.nombre_alimento || '').trim() &&
  ['cantidad_gramos', 'calorias', 'proteina', 'carbohidratos', 'grasas'].every(key => Number.isFinite(Number(item[key])) && Number(item[key]) >= 0));

const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));

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
    if (!current || !name || !validIngredients(p.ingredientes)) throw new Error('template conflict');
    if (p.expectedUpdatedAt != null && Number(current.updated_at || 0) > Number(p.expectedUpdatedAt || 0)) {
      const error = new Error('resource_conflict');
      error.code = 'resource_conflict';
      throw error;
    }
    db.prepare('UPDATE plantillas_comida SET nombre = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(name, Date.now(), id, userId);
    db.prepare('DELETE FROM plantillas_ingredientes WHERE plantilla_id = ?').run(id);
    const stmt = db.prepare('INSERT INTO plantillas_ingredientes (plantilla_id, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const item of p.ingredientes) stmt.run(id, String(item.nombre_alimento).trim(), item.cantidad_gramos, item.calorias, item.proteina, item.carbohidratos, item.grasas);
    return { updated: id };
  }
  if (request.kind === 'template-delete') {
    const current = db.prepare('SELECT id, updated_at FROM plantillas_comida WHERE id = ? AND user_id = ?').get(p.id, userId);
    if (!current) return { deleted: p.id, missing: true };
    if (p.expectedUpdatedAt != null && Number(current.updated_at || 0) > Number(p.expectedUpdatedAt || 0)) {
      const error = new Error('resource_conflict');
      error.code = 'resource_conflict';
      throw error;
    }
    db.prepare('DELETE FROM plantillas_comida WHERE id = ? AND user_id = ?').run(p.id, userId);
    return { deleted: p.id };
  }
  throw new Error('unsupported sync operation');
}

export function processSyncBatch({ db, userId, operations, getUserState, saveUserState }) {
  const results = [], conflicts = [], appliedIds = [];
  for (const operation of operations) {
    const request = operation?.changes?.find(change => change?.request)?.request;
    const opId = String(request?.opId || operation?.id || '');
    if (!opId || opId.length > 120) { conflicts.push({ id: operation?.id, reason: 'invalid_operation_id' }); continue; }
    const previous = db.prepare('SELECT result_json FROM sync_operations WHERE user_id = ? AND op_id = ?').get(userId, opId);
    if (previous) { results.push({ id: operation.id, opId, result: JSON.parse(previous.result_json || '{}'), replay: true }); appliedIds.push(operation.id); continue; }
    const stateChanges = request ? [] : (operation.changes || []);
    const current = getUserState(userId) || {};
    const createdAt = Number(operation.createdAt || 0);
    if (stateChanges.length && current._ts && createdAt && current._ts > createdAt) { conflicts.push({ id: operation.id, opId, reason: 'server_newer_than_client' }); continue; }
    try {
      db.exec('BEGIN');
      let result = {};
      if (request) result = applyRequest(db, userId, request);
      else {
        for (const change of stateChanges) {
          const key = change?.path?.length === 1 ? String(change.path[0]) : '';
          if (!key || ['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error('invalid state path');
          if (change.op === 'remove') delete current[key];
          else if (change.op === 'replace' && Object.prototype.hasOwnProperty.call(change, 'value')) current[key] = change.value;
        }
        current._ts = Date.now(); saveUserState(userId, current); result = { ts: current._ts };
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
