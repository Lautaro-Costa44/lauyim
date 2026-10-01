// Definición de un ejercicio creado por un socio o por el staff (propio o compartido con todo el
// gym). Un solo lugar con los campos que se aceptan y sus límites: el endpoint de ejercicios
// compartidos guarda solo esto, y las columnas de custom_exercises salen de la misma lista.
import { isPlainObject } from './row-meta.js';

export const MAX_STEPS = 15;
export const MAX_STEP_LENGTH = 300;
export const MAX_DESC = 1000;

const TIPOS = new Set(['fuerza', 'cardio', 'estiramiento']);

// Claves con columna propia en custom_exercises (más las que arma el servidor al leer: custom,
// shared, origin). El resto viaja en la columna meta.
export const CUSTOM_EXERCISE_COLUMNS = Object.freeze([
  'id', 'n', 'tipo', 'equipamiento', 'grupo_muscular', 'bp', 'eq', 'tg', 'mg', 'sm', 'st', 'created',
  'custom', 'shared', 'origin'
]);

const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const list = (value, maxItems, maxLength) => Array.isArray(value)
  ? value.filter(v => typeof v === 'string').map(v => v.trim().slice(0, maxLength)).filter(Boolean).slice(0, maxItems)
  : [];

// → { value } con solo los campos conocidos y recortados, o { error } si falta el id o el nombre.
// Las listas opcionales de músculos y la descripción se omiten vacías: un array vacío no es lo
// mismo que "sin dato" para lib/muscles.js del frontend.
export function sanitizeExerciseDef(ex) {
  if (!isPlainObject(ex)) return { error: 'validation_error' };
  const id = text(ex.id, 64);
  const n = text(ex.n, 200);
  if (!id || !n) return { error: 'validation_error' };
  const value = {
    id, n,
    tipo: TIPOS.has(ex.tipo) ? ex.tipo : 'fuerza',
    equipamiento: list(ex.equipamiento, 10, 60),
    grupo_muscular: text(ex.grupo_muscular, 60),
    bp: text(ex.bp, 60),
    eq: text(ex.eq, 60),
    tg: text(ex.tg, 60),
    mg: text(ex.mg, 60),
    sm: list(ex.sm, 20, 60),
  };
  for (const key of ['primaries', 'secondaries', 'muscleGroups']) {
    const muscles = list(ex[key], 20, 60);
    if (muscles.length) value[key] = muscles;
  }
  value.st = list(ex.st, MAX_STEPS, MAX_STEP_LENGTH);
  const desc = text(ex.desc, MAX_DESC);
  if (desc) value.desc = desc;
  if (typeof ex.map === 'boolean') value.map = ex.map;
  return { value };
}
