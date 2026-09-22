/**
 * Codec de filas con columna `meta` (catch-all).
 *
 * Las tablas guardan en columnas propias solo los campos que conocen. Cualquier otra clave del
 * registro (la marca de calentamiento de un set, los drops de un drop-set, los PRs de un
 * workout, y cualquier campo que el cliente agregue en el futuro) viaja en `meta` como JSON,
 * para que el ida y vuelta por el servidor devuelva el registro completo. Es el único punto
 * que traduce registros <-> filas: todos los caminos de escritura (PUT /api/data, la
 * aplicación de operaciones de sync y el script de migración) pasan por acá.
 */

/** Claves de un set con columna propia en workout_sets. */
export const SET_COLUMNS = Object.freeze(['w', 'r', 'sec', 'min', 'speed', 'done', 'rir', 'rpe']);

/** Claves de un workout con columna propia en workouts (o tabla hija, en el caso de entries). */
export const WORKOUT_COLUMNS = Object.freeze(['id', 'd', 'start', 'end', 'routineId', 'name', 'bw', 'vol', 'note', 'partial', 'entries']);

/** Tamaño máximo de `meta` por registro, en bytes UTF-8 del JSON. */
export const META_MAX_BYTES = 4096;

/** Registro que el servidor nunca va a aceptar: el PUT responde 400 y el sync lo marca terminal. */
export class RowMetaError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RowMetaError';
    this.code = code;
    this.status = 400;
  }
}

export const isPlainObject = value => {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * JSON de las claves de `record` que no tienen columna propia, o null si no queda ninguna.
 * Las claves con valor undefined se omiten.
 *
 * @param {object} record Set o workout tal como lo envía el cliente.
 * @param {readonly string[]} columns Claves con columna propia en la tabla.
 * @param {'set'|'workout'} kind Prefijo del código de error.
 * @returns {string|null}
 * @throws {RowMetaError} `${kind}_not_object` o `${kind}_meta_too_large`.
 */
export function encodeMeta(record, columns, kind) {
  if (!isPlainObject(record)) throw new RowMetaError(`${kind}_not_object`, `${kind} must be a plain object`);
  const extra = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== undefined && !columns.includes(key)) extra[key] = value;
  }
  if (!Object.keys(extra).length) return null;
  const json = JSON.stringify(extra);
  const bytes = Buffer.byteLength(json, 'utf8');
  if (bytes > META_MAX_BYTES) {
    throw new RowMetaError(`${kind}_meta_too_large`, `${kind} meta is ${bytes} bytes, limit is ${META_MAX_BYTES}`);
  }
  return json;
}

/**
 * Mezcla `meta` debajo de los valores de columna: ante un conflicto gana la columna. Una meta
 * ilegible o que no es un objeto plano se ignora con una advertencia; nunca rompe la lectura.
 *
 * @param {object} columns Valores leídos de las columnas propias.
 * @param {string|null} meta Contenido de la columna meta.
 * @param {string} where Identificación de la fila para la advertencia.
 * @returns {object}
 */
export function decodeMeta(columns, meta, where) {
  if (meta == null || meta === '') return columns;
  let parsed;
  try {
    parsed = JSON.parse(meta);
  } catch {
    console.warn(`${where}: ignoring unreadable meta`);
    return columns;
  }
  if (!isPlainObject(parsed)) {
    console.warn(`${where}: ignoring meta that is not a plain object`);
    return columns;
  }
  return { ...parsed, ...columns };
}

/** Parámetros de INSERT de un set: w, r, sec, min, speed, done, rir, rpe, meta. */
export function setRowValues(set) {
  const meta = encodeMeta(set, SET_COLUMNS, 'set');
  return [
    set.w ?? null,
    set.r ?? null,
    set.sec ?? null,
    set.min ?? null,
    set.speed ?? null,
    set.done ? 1 : 0,
    set.rir ?? null,
    set.rpe ?? null,
    meta
  ];
}

/** Set completo a partir de una fila de workout_sets. */
export function setFromRow(row) {
  return decodeMeta({
    w: row.w,
    r: row.r,
    sec: row.sec,
    min: row.min,
    speed: row.speed,
    done: row.done === 1,
    rir: row.rir,
    rpe: row.rpe
  }, row.meta, `workout_sets#${row.id}`);
}

/** JSON de meta de un workout (prs, routineGroupId y cualquier clave sin columna). */
export const workoutMeta = workout => encodeMeta(workout, WORKOUT_COLUMNS, 'workout');

/**
 * Valida todos los workouts y sus sets sin escribir nada, para rechazar un estado antes de la
 * primera escritura en lugar de dejarlo a medio guardar.
 *
 * @throws {RowMetaError} El primer registro inválido.
 */
export function validateWorkouts(workouts) {
  for (const workout of workouts || []) {
    if (!workout) continue;
    workoutMeta(workout);
    for (const entry of workout.entries || []) {
      for (const set of entry?.sets || []) encodeMeta(set, SET_COLUMNS, 'set');
    }
  }
}
