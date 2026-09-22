import { validateWorkouts, RowMetaError } from './row-meta.js';

/**
 * Guardado completo del estado (PUT /api/data), separado del handler HTTP para poder probarlo
 * sin levantar el servidor, igual que processSyncBatch en sync.js.
 *
 * saveUserState() escribe tabla por tabla sin una transacción propia, así que acá se envuelve
 * entero en BEGIN/COMMIT: un error a mitad del guardado no deja el estado a medias. Además los
 * workouts se validan antes de la primera escritura, para responder 400 con el motivo en vez
 * de 500.
 *
 * @returns {{ status: number, body: object }}
 */
export function applyStatePut({ db, userId, state, getUserState, saveUserState }) {
  if (!state || typeof state !== 'object') return { status: 400, body: { error: 'state required' } };
  delete state.active;
  try {
    validateWorkouts(state.workouts);
  } catch (error) {
    if (error instanceof RowMetaError) return { status: 400, body: { error: error.code } };
    throw error;
  }

  db.exec('BEGIN');
  try {
    const currentState = getUserState(userId) || {};
    const stateVersion = Math.max(Date.now(), Number(currentState._ts || 0) + 1);
    state._ts = stateVersion;
    const versions = {};
    for (const key of Object.keys(state)) {
      if (!['_ts', '_syncVersions'].includes(key)) versions[key] = stateVersion;
    }
    state._syncVersions = versions;
    saveUserState(userId, state);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    if (error instanceof RowMetaError) return { status: 400, body: { error: error.code } };
    throw error;
  }
  return { status: 200, body: { ok: true, ts: state._ts || null } };
}
