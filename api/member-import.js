// Importación de socios desde Excel/CSV: interpretación de los valores crudos (fechas, montos) y
// análisis fila por fila de lo que haría la importación. Sin acceso a la base: server.js le pasa
// la config, los planes y los perfiles existentes, y database.js (importMembers) escribe el
// resultado en una transacción.
//
// Qué frena una fila (error): falta el nombre, DNI inválido o faltante (con el DNI activo), DNI
// repetido dentro del archivo, fechas o montos que no se pueden interpretar. Lo demás (celular o
// mail inválidos, obligatorios vacíos, vencimiento sin plan) se importa igual con un aviso.

import {
  normalizeDni, normalizePhone, normalizeEmail, normalizeFullName, validateMemberProfile,
  missingRequiredFields, memberFieldLabel, parseMemberFields
} from './members.js';
import { addDays, isIsoDate } from './billing.js';

export const MAX_IMPORT_ROWS = 2000;

// Fila de ejemplo de la plantilla (frontend: members/import-parse.js, mismos valores; un test
// lo verifica). Si el owner no la borra, se ignora con un aviso: no es un socio ni un error.
export const TEMPLATE_EXAMPLE_NAME = 'EJEMPLO – borrá esta fila';
export const TEMPLATE_EXAMPLE_DNI = '99.999.999';
const exampleKey = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const EXAMPLE_NAME_KEY = exampleKey(TEMPLATE_EXAMPLE_NAME);
const EXAMPLE_DNI_NORM = TEMPLATE_EXAMPLE_DNI.replace(/\D/g, '');
export const isTemplateExample = row => exampleKey(row.fullName) === EXAMPLE_NAME_KEY
  || String(row.dni ?? '').replace(/\D/g, '').replace(/^0+/, '') === EXAMPLE_DNI_NORM;
const MAX_CELL = 200;
const MAX_USER_NAME = 40;
const ROW_FIELDS = ['fullName', 'dni', 'phone', 'email', 'planValue', 'dueDate', 'lastPaymentDate', 'lastPaymentAmount'];
const BILLING_FIELDS = ['planValue', 'dueDate', 'lastPaymentDate', 'lastPaymentAmount'];

/* ---------- valores crudos ---------- */

const pad = n => String(n).padStart(2, '0');
const DAY_MS = 86400000;
// Número de serie de Excel: días desde el 30/12/1899 (así ya absorbe el 29/02/1900 que Excel
// cree que existió). Solo 1950–2100: un número fuera de ese rango no es una fecha de socio.
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
const MIN_SERIAL = 18264;   // 01/01/1950
const MAX_SERIAL = 73051;   // 01/01/2100

// dd/mm/aaaa, d/m/aa (aa → 20aa), aaaa-mm-dd o número de serie de Excel → 'YYYY-MM-DD'.
// Vacío → { value: null }. Cualquier otra cosa, o una fecha que no existe (31/02) → { error }.
export function parseImportDate(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { value: null };
  const bad = { error: `Fecha no reconocida: "${s.slice(0, 20)}" (usá dd/mm/aaaa)` };
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(s);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const iso = `${year}-${pad(m[2])}-${pad(m[1])}`;
    return isIsoDate(iso) ? { value: iso } : bad;
  }
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (m) {
    const iso = `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
    return isIsoDate(iso) ? { value: iso } : bad;
  }
  if (/^\d+(\.\d+)?$/.test(s)) {
    const serial = Math.floor(Number(s));
    if (serial >= MIN_SERIAL && serial <= MAX_SERIAL) return { value: new Date(EXCEL_EPOCH + serial * DAY_MS).toISOString().slice(0, 10) };
  }
  return bad;
}

const MAX_AMOUNT = 100000000;

// Pesos enteros: "$30.000", "30000", "30.000,00", "30,000" o "30000.00" (lo que deja Excel en
// una celda numérica). Centavos distintos de cero → error. Vacío → { value: null }.
export function parseImportAmount(raw) {
  const s = String(raw ?? '').trim().replace(/^\$/, '').replace(/\s+/g, '');
  if (!s) return { value: null };
  let int, dec = '';
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) [int, dec = ''] = s.split(',').map((x, i) => i ? x : x.replace(/\./g, ''));
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) [int, dec = ''] = s.split('.').map((x, i) => i ? x : x.replace(/,/g, ''));
  else if (/^\d+(,\d{1,2})?$/.test(s)) [int, dec = ''] = s.split(',');
  else if (/^\d+(\.\d{1,2})?$/.test(s)) [int, dec = ''] = s.split('.');
  else return { error: `Monto no reconocido: "${String(raw).trim().slice(0, 20)}"` };
  if (dec && Number(dec) !== 0) return { error: 'El monto tiene centavos: usá pesos enteros' };
  const value = Number(int);
  if (!Number.isSafeInteger(value) || value > MAX_AMOUNT) return { error: 'Monto fuera de rango' };
  return { value };
}

// Clave para agrupar valores de plan: sin tildes, mayúsculas ni espacios de más. El frontend
// agrupa con la misma regla (members/import-parse.js).
export const planKey = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .trim().replace(/\s+/g, ' ').toLowerCase();

// Mediodía UTC del día: cae en ese mismo día calendario en cualquier tz de -12 a +11.
const noonOf = iso => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)), 12);

/* ---------- validación del body ---------- */

const isCell = v => v == null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v));

// → { value: { rows, planMap, options, dryRun } } o { error } (400).
// checkNewPlan(body) valida un plan a crear igual que POST /billing/plans.
export function parseImportBody(body, checkNewPlan) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Body inválido' };
  const { rows, planMap = [], options = {} } = body;
  if (!Array.isArray(rows) || !rows.length) return { error: 'rows debe ser una lista no vacía' };
  if (rows.length > MAX_IMPORT_ROWS) return { error: `Máximo ${MAX_IMPORT_ROWS} filas por importación` };
  const seen = new Set();
  const clean = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return { error: 'Cada fila debe ser un objeto' };
    if (!Number.isInteger(row.rowNumber) || row.rowNumber < 1 || seen.has(row.rowNumber)) return { error: 'rowNumber debe ser un entero positivo y único' };
    seen.add(row.rowNumber);
    const out = { rowNumber: row.rowNumber };
    for (const key of ROW_FIELDS) {
      if (!isCell(row[key])) return { error: `Fila ${row.rowNumber}: ${key} debe ser texto` };
      out[key] = row[key] == null ? '' : String(row[key]).trim();
    }
    clean.push(out);
  }
  if (!Array.isArray(planMap)) return { error: 'planMap debe ser una lista' };
  const plans = new Map();
  for (const entry of planMap) {
    if (!entry || typeof entry !== 'object' || typeof entry.value !== 'string') return { error: 'Cada planMap necesita value (texto)' };
    const key = planKey(entry.value);
    if (!key || plans.has(key)) return { error: `planMap: valor vacío o repetido ("${entry.value.slice(0, 40)}")` };
    if (entry.action === 'existing') {
      if (!Number.isInteger(entry.planId) || entry.planId < 1) return { error: `planMap "${entry.value.slice(0, 40)}": planId inválido` };
      plans.set(key, { action: 'existing', planId: entry.planId, value: entry.value });
    } else if (entry.action === 'create') {
      const checked = checkNewPlan({ name: entry.name, price: entry.price, durationDays: entry.durationDays });
      if (checked.error) return { error: `Plan nuevo "${String(entry.name ?? entry.value).slice(0, 40)}": ${checked.error}` };
      plans.set(key, { action: 'create', ...checked.value, key, value: entry.value });
    } else if (entry.action === 'none') {
      plans.set(key, { action: 'none', value: entry.value });
    } else return { error: "planMap.action debe ser 'existing', 'create' o 'none'" };
  }
  if (!options || typeof options !== 'object' || Array.isArray(options)) return { error: 'options inválido' };
  const duplicates = options.duplicates ?? 'skip';
  if (duplicates !== 'skip' && duplicates !== 'fill_empty') return { error: "options.duplicates debe ser 'skip' o 'fill_empty'" };
  if (options.paymentMethod != null && typeof options.paymentMethod !== 'string') return { error: 'options.paymentMethod inválido' };
  return { value: { rows: clean, planMap: plans, options: { duplicates, paymentMethod: options.paymentMethod ?? null }, dryRun: body.dry_run === true } };
}

/* ---------- análisis ---------- */

const label = key => memberFieldLabel(key).toLowerCase();

// Qué haría la importación, fila por fila, sin escribir nada.
//   input  lo que devuelve parseImportBody().value
//   ctx    { fields, billingEnabled, paymentMethods, today, plans: [plan], existingProfiles: [perfil + name] }
// → { error } (400: plan inexistente, método inválido, plan sin decidir) o
//   { summary, rows, warnings, write: { plans, members, fills } } con members sin id (lo pone
//   quien escribe).
export function analyzeImport({ rows: allRows, planMap, options }, ctx) {
  const fields = parseMemberFields(ctx.fields);
  const rows = allRows.filter(r => !isTemplateExample(r));
  const dniOn = fields.dni.enabled;
  const billingOn = !!ctx.billingEnabled;
  const warnings = [];
  const plansById = new Map((ctx.plans || []).map(p => [p.id, p]));

  // Planes: los existentes tienen que existir y estar activos.
  const resolved = new Map();
  for (const [key, entry] of planMap) {
    if (entry.action === 'existing') {
      const plan = plansById.get(entry.planId);
      if (!plan) return { error: `El plan elegido para "${entry.value.slice(0, 40)}" no existe` };
      if (!plan.active) return { error: `El plan "${plan.name}" está inactivo` };
      resolved.set(key, { ref: { planId: plan.id }, name: plan.name, price: plan.price, durationDays: plan.durationDays });
    } else if (entry.action === 'create') {
      resolved.set(key, { ref: { planKey: key }, name: entry.name, price: entry.price, durationDays: entry.durationDays, create: true });
    } else resolved.set(key, null);
  }

  if (rows.length < allRows.length) warnings.push('Se ignoró la fila de ejemplo de la plantilla.');
  const hasBillingData = rows.some(r => BILLING_FIELDS.some(k => r[k]));
  if (!billingOn && hasBillingData) warnings.push('Cuotas está apagado: se ignoran plan, vencimiento y pagos del archivo.');
  if (!dniOn) warnings.push('El DNI está desactivado: no se detectan socios que ya existen ni repetidos, todas las filas se cargan como nuevas.');
  if (billingOn) {
    for (const r of rows) {
      if (r.planValue && !planMap.has(planKey(r.planValue))) return { error: `Falta elegir qué hacer con el plan "${r.planValue.slice(0, 40)}"` };
    }
    if (rows.some(r => r.lastPaymentDate) && !(ctx.paymentMethods || []).includes(options.paymentMethod)) {
      return { error: `options.paymentMethod debe ser uno de: ${(ctx.paymentMethods || []).join(', ')}` };
    }
  }

  // DNI: normalizado por fila y repetidos dentro del archivo.
  const dniOf = new Map();
  const rowsByDni = new Map();
  if (dniOn) {
    for (const r of rows) {
      if (!r.dni) continue;
      const d = normalizeDni(r.dni);
      if (d.error) continue;
      dniOf.set(r.rowNumber, d.value);
      rowsByDni.set(d.value.dniNorm, [...(rowsByDni.get(d.value.dniNorm) || []), r.rowNumber]);
    }
  }
  const existingByDni = new Map((ctx.existingProfiles || []).filter(p => p.dniNorm).map(p => [p.dniNorm, p]));

  const report = [];
  const members = [];
  const fills = [];
  const usedPlanKeys = new Set();
  for (const r of rows) {
    const messages = [];
    const error = text => messages.push({ level: 'error', text });
    const warn = text => messages.push({ level: 'warning', text });
    const info = text => messages.push({ level: 'info', text });
    for (const key of ROW_FIELDS) if (r[key].length > MAX_CELL) error(`Valor demasiado largo (máx. ${MAX_CELL} caracteres)`);

    let dni = null;
    if (dniOn) {
      if (!r.dni) error('Falta el DNI');
      else {
        dni = dniOf.get(r.rowNumber) || null;
        if (!dni) error(normalizeDni(r.dni).error);
        else if (rowsByDni.get(dni.dniNorm).length > 1) error(`DNI repetido en el archivo (filas ${rowsByDni.get(dni.dniNorm).join(', ')})`);
      }
    }
    const existing = !messages.length && dni ? existingByDni.get(dni.dniNorm) : null;

    // Celular y mail: uno inválido no frena la fila, queda vacío con un aviso.
    const optional = {};
    for (const [prop, key, normalize] of [['phone', 'phone', normalizePhone], ['email', 'email', normalizeEmail]]) {
      if (!r[prop] || !fields[key].enabled) continue;
      const checked = normalize(r[prop]);
      if (checked.error) warn(`${checked.error}: queda vacío`);
      else optional[prop] = r[prop];
    }

    if (existing) {
      info(`Ya existe: ${existing.name}`);
      if (options.duplicates === 'fill_empty') {
        const values = {};
        const filled = [];
        const name = fields.full_name.enabled && r.fullName ? normalizeFullName(r.fullName) : null;
        if (name?.value && !existing.fullName) { values.fullName = name.value; filled.push('full_name'); }
        if (optional.phone && !existing.phone) {
          const p = normalizePhone(optional.phone).value;
          values.phone = p.phone; values.phoneNorm = p.phoneNorm; filled.push('phone');
        }
        if (optional.email && !existing.email) { values.email = normalizeEmail(optional.email).value; filled.push('email'); }
        if (filled.length) {
          info(`Se completa: ${filled.map(label).join(', ')}`);
          fills.push({ userId: existing.userId, values });
        } else info('No tiene datos vacíos para completar: se saltea');
      } else info('Se saltea');
      if (billingOn && BILLING_FIELDS.some(k => r[k])) info('La cuota de un socio existente no se toca');
      report.push({ rowNumber: r.rowNumber, status: 'existente', messages });
      continue;
    }

    // Socio nuevo.
    let fullName = null;
    if (!r.fullName) error('Falta el nombre');
    else {
      const n = normalizeFullName(r.fullName);
      if (n.error) error(n.error); else fullName = n.value;
    }
    let billing = null;
    let payment = null;
    if (billingOn) {
      const due = parseImportDate(r.dueDate);
      const paid = parseImportDate(r.lastPaymentDate);
      const amount = parseImportAmount(r.lastPaymentAmount);
      if (due.error) error(`Vencimiento: ${due.error}`);
      if (paid.error) error(`Fecha último pago: ${paid.error}`);
      else if (paid.value && paid.value > ctx.today) error('Fecha último pago: no puede ser futura');
      if (amount.error) error(`Monto último pago: ${amount.error}`);
      if (!messages.some(m => m.level === 'error')) {
        const plan = r.planValue ? resolved.get(planKey(r.planValue)) : null;
        if (!plan) {
          if (due.value || paid.value || amount.value != null) warn(r.planValue ? 'Sin plan: se ignoran vencimiento y pago' : 'Vencimiento o pago sin plan: se ignora la cuota');
        } else {
          const dueDate = due.value ?? (paid.value ? addDays(paid.value, plan.durationDays) : null);
          if (!dueDate) warn('Plan sin vencimiento ni fecha de pago: se importa sin cuota');
          else {
            billing = { ...plan.ref, dueDate };
            if (plan.create) usedPlanKeys.add(plan.ref.planKey);
            info(`${plan.name} · vence ${dueDate.split('-').reverse().join('/')}`);
          }
          if (paid.value) {
            const value = amount.value ?? plan.price;
            if (!value) warn('Pago sin monto (y el plan es gratis): no se importa el pago');
            else {
              payment = {
                ...plan.ref, planName: plan.name, amount: value, method: options.paymentMethod,
                paidAt: noonOf(paid.value), periodStart: paid.value, periodEnd: addDays(paid.value, plan.durationDays)
              };
            }
          } else if (amount.value != null) warn('Monto sin fecha de pago: se ignora');
        }
      }
    }
    if (messages.some(m => m.level === 'error')) {
      report.push({ rowNumber: r.rowNumber, status: 'error', messages });
      continue;
    }
    const body = { fullName, ...optional, ...(dni ? { dni: r.dni } : {}) };
    const checked = validateMemberProfile(body, fields, { enforceRequired: false });
    if (checked.error) {
      error(checked.error);
      report.push({ rowNumber: r.rowNumber, status: 'error', messages });
      continue;
    }
    const missing = missingRequiredFields(checked.value, fields);
    if (missing.length) warn(`Datos incompletos: falta ${missing.map(label).join(', ')}`);
    members.push({ rowNumber: r.rowNumber, name: fullName.slice(0, MAX_USER_NAME).trim(), profile: checked.value, billing, payment });
    report.push({ rowNumber: r.rowNumber, status: 'nuevo', messages });
  }

  const count = status => report.filter(r => r.status === status).length;
  const summary = {
    nuevos: count('nuevo'),
    existentes: count('existente'),
    errores: count('error'),
    warnings: report.filter(r => r.messages.some(m => m.level === 'warning')).length,
    completar: fills.length
  };
  return {
    summary,
    warnings,
    rows: report,
    write: {
      // Solo los planes nuevos que usa alguna fila que se importa.
      plans: [...planMap.values()].filter(e => e.action === 'create' && usedPlanKeys.has(e.key))
        .map(e => ({ key: e.key, name: e.name, price: e.price, durationDays: e.durationDays })),
      members,
      fills
    }
  };
}
