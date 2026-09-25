import { parseCSV } from '../../../lib/csv.js'

// Importar socios (owner): leer el archivo, detectar columnas y armar las filas que van a
// POST /api/owner/members/import. Sin React: lo usa ImportMembersSheet.jsx y se testea solo.
// Las reglas de validación (DNI, fechas, montos, planes) son del servidor
// (api/member-import.js); acá solo se leen celdas y se mapean columnas.

export const MAX_ROWS = 2000
export const MAX_FILE_BYTES = 5 * 1024 * 1024

// Destinos posibles de una columna del archivo. firstName/lastName se combinan en fullName.
export const FIELD_OPTIONS = [
  { value: 'fullName', label: 'Nombre y apellido' },
  { value: 'firstName', label: 'Nombre' },
  { value: 'lastName', label: 'Apellido' },
  { value: 'dni', label: 'DNI' },
  { value: 'phone', label: 'Celular' },
  { value: 'email', label: 'Mail' },
  { value: 'planValue', label: 'Plan' },
  { value: 'dueDate', label: 'Vencimiento' },
  { value: 'lastPaymentDate', label: 'Fecha último pago' },
  { value: 'lastPaymentAmount', label: 'Monto último pago' },
  { value: 'ignore', label: 'Ignorar' },
]
export const fieldLabel = value => FIELD_OPTIONS.find(o => o.value === value)?.label || value

// Encabezado → forma comparable: sin tildes, minúsculas, solo letras y números.
export const normHeader = h => String(h ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// Sinónimos por campo. Primero se busca un encabezado igual a un sinónimo; si no, uno que lo
// contenga como palabras enteras, en el orden de CONTAINS_ORDER (el monto antes que las fechas:
// "Monto último pago" es un monto, no una fecha).
const SYNONYMS = {
  fullName: ['nombre y apellido', 'apellido y nombre', 'nombre completo', 'socio', 'alumno', 'cliente', 'nombre y apellidos', 'apellidos y nombres'],
  firstName: ['nombre', 'nombres'],
  lastName: ['apellido', 'apellidos'],
  dni: ['dni', 'documento', 'doc', 'nro documento', 'numero documento', 'numero de documento', 'nro de documento', 'nro doc'],
  phone: ['celular', 'telefono', 'tel', 'movil', 'whatsapp', 'cel'],
  email: ['mail', 'email', 'e mail', 'correo', 'correo electronico'],
  planValue: ['plan', 'abono', 'membresia', 'cuota', 'actividad'],
  dueDate: ['vencimiento', 'vence', 'fecha vencimiento', 'fecha de vencimiento', 'proximo pago', 'fecha proximo pago'],
  lastPaymentDate: ['ultimo pago', 'fecha pago', 'fecha de pago', 'fecha ultimo pago', 'fecha del ultimo pago'],
  lastPaymentAmount: ['monto', 'importe', 'precio', 'pagado', 'monto ultimo pago', 'monto pagado', 'importe pagado'],
}
const CONTAINS_ORDER = ['lastPaymentAmount', 'dueDate', 'lastPaymentDate', 'fullName', 'lastName', 'firstName', 'dni', 'phone', 'email', 'planValue']

function detectField(header) {
  const h = normHeader(header)
  if (!h) return null
  for (const [field, list] of Object.entries(SYNONYMS)) if (list.includes(h)) return field
  const padded = ` ${h} `
  for (const field of CONTAINS_ORDER) if (SYNONYMS[field].some(s => padded.includes(` ${s} `))) return field
  return null
}

// Un campo por columna; si dos columnas apuntan al mismo campo, gana la primera y la otra queda
// en "Ignorar".
export function autodetectColumns(headers) {
  const used = new Set()
  return headers.map(h => {
    const field = detectField(h)
    if (!field || used.has(field)) return 'ignore'
    used.add(field)
    return field
  })
}

const pad = n => String(n).padStart(2, '0')

// Fecha de una celda de Excel → 'YYYY-MM-DD', sin toISOString (en UTC-3 corre el día). Una
// fecha de calendario llega a medianoche: read-excel-file la arma a medianoche UTC y otras
// libs a medianoche local. Medianoche UTC exacta → componentes UTC; cualquier otra hora →
// componentes locales. Así el día es el mismo en cualquier tz.
export function dateCellToIso(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return ''
  const utcMidnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0
  return utcMidnight
    ? `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
    : `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function cellToString(v) {
  if (v == null) return ''
  if (v instanceof Date) return dateCellToIso(v)
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  return String(v).trim()
}

// UTF-8 (con o sin BOM; TextDecoder saca el BOM). Si no es UTF-8 válido, es un CSV guardado
// por Excel en Windows: windows-1252, para que "Martínez" no llegue como "Mart�nez".
export function decodeText(buffer) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buffer) }
  catch { return new TextDecoder('windows-1252').decode(buffer) }
}

// ';' (Excel en español), ',' o tab: el que más aparece en la primera línea con datos, fuera
// de comillas.
export function detectDelimiter(text) {
  const line = String(text).replace(/^\uFEFF/, '').split(/\r?\n/).find(l => l.trim()) || ''
  const counts = { ';': 0, ',': 0, '\t': 0 }
  let quoted = false
  for (const c of line) {
    if (c === '"') quoted = !quoted
    else if (!quoted && c in counts) counts[c]++
  }
  const [best, n] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return n ? best : ','
}

// Tabla (lista de filas, cada una lista de celdas) → { headers, data: [{ rowNumber, cells }] }.
// El encabezado es la primera fila con algo; rowNumber es el número de fila de la planilla.
export function tableToSheet(table) {
  const rows = table.map(r => (r || []).map(cellToString))
  const headerIndex = rows.findIndex(r => r.some(c => c))
  if (headerIndex < 0) return { error: 'El archivo está vacío' }
  const width = Math.max(...rows.map(r => r.length))
  const headers = Array.from({ length: width }, (_, i) => rows[headerIndex][i] || '')
  const data = []
  rows.forEach((cells, i) => {
    if (i <= headerIndex || !cells.some(c => c)) return
    data.push({ rowNumber: i + 1, cells: headers.map((_, j) => cells[j] || '') })
  })
  if (!data.length) return { error: 'El archivo no tiene filas debajo del encabezado' }
  if (data.length > MAX_ROWS) return { error: `El archivo tiene ${data.length} filas: el máximo es ${MAX_ROWS} por importación` }
  return { headers, data }
}

export const fileKind = name => /\.xlsx$/i.test(name) ? 'xlsx' : /\.csv$/i.test(name) ? 'csv' : /\.xls$/i.test(name) ? 'xls' : null

// Lee el archivo elegido. El lector de .xlsx se descarga recién acá (chunk aparte).
export async function readImportFile(file) {
  const kind = fileKind(file.name)
  if (kind === 'xls') return { error: 'Formato .xls viejo: abrilo en Excel y guardalo como .xlsx o .csv' }
  if (!kind) return { error: 'Elegí un archivo .xlsx o .csv' }
  if (file.size > MAX_FILE_BYTES) return { error: 'El archivo pesa más de 5 MB' }
  const buffer = await file.arrayBuffer()
  if (kind === 'csv') {
    const text = decodeText(buffer)
    return tableToSheet(parseCSV(text, detectDelimiter(text), { keepEmptyRows: true }))
  }
  try {
    const { readSheet } = await import('read-excel-file/universal')
    return tableToSheet(await readSheet(buffer))
  } catch {
    return { error: 'No se pudo leer el Excel. Probá guardarlo de nuevo como .xlsx o .csv' }
  }
}

// DNI para mostrar en la vista previa: solo los últimos 3 dígitos (como maskDni del servidor).
export const maskDni = dni => {
  const digits = String(dni ?? '').replace(/\D/g, '')
  return digits ? '***' + digits.slice(-3) : ''
}

// Hasta 3 valores de ejemplo (no vacíos) de una columna.
export const sampleValues = (data, col, n = 3) => data.map(r => r.cells[col]).filter(Boolean).slice(0, n)

// Qué falta en el mapeo para poder seguir. → lista de textos (vacía = listo).
export function mappingProblems(mapping, { dniEnabled }) {
  const problems = []
  const has = f => mapping.includes(f)
  if (!has('fullName') && !has('firstName') && !has('lastName')) problems.push('Elegí la columna del nombre (Nombre y apellido, o Nombre y Apellido por separado).')
  if (dniEnabled && !has('dni')) problems.push('Elegí la columna del DNI: sin DNI no se detectan socios repetidos.')
  const dup = FIELD_OPTIONS.map(o => o.value).filter(f => f !== 'ignore' && mapping.filter(m => m === f).length > 1)
  if (dup.length) problems.push(`Hay más de una columna como ${dup.map(fieldLabel).join(', ')}.`)
  return problems
}

const ROW_FIELDS = ['dni', 'phone', 'email', 'planValue', 'dueDate', 'lastPaymentDate', 'lastPaymentAmount']

// Filas para el servidor: valores crudos como texto; Nombre + Apellido se combinan si no hay
// "Nombre y apellido" (o si viene vacío en esa fila).
export function buildRows(data, mapping) {
  const col = f => mapping.indexOf(f)
  const get = (cells, f) => col(f) < 0 ? '' : String(cells[col(f)] ?? '').trim()
  return data.map(({ rowNumber, cells }) => {
    const full = get(cells, 'fullName') || [get(cells, 'firstName'), get(cells, 'lastName')].filter(Boolean).join(' ')
    const row = { rowNumber, fullName: full.replace(/\s+/g, ' ') }
    for (const f of ROW_FIELDS) row[f] = get(cells, f)
    return row
  }).filter(r => r.fullName || ROW_FIELDS.some(f => r[f]))
}

// Misma clave que el servidor (api/member-import.js planKey).
export const planKey = value => String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .trim().replace(/\s+/g, ' ').toLowerCase()

// Valores distintos de Plan con cuántos socios: [{ key, value, count }], los más usados primero.
export function distinctPlans(rows) {
  const byKey = new Map()
  for (const r of rows) {
    const key = planKey(r.planValue)
    if (!key) continue
    const cur = byKey.get(key) || { key, value: r.planValue.trim(), count: 0 }
    cur.count++
    byKey.set(key, cur)
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))
}

/* ---------- CSV para descargar (plantilla y errores) ---------- */

// Una celda de CSV para Excel en español: separador ';', comillas si hace falta, y un ' adelante
// de lo que Excel tomaría como fórmula (= + - @, tab, CR): inyección de fórmulas.
export function csvCell(value) {
  let s = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}
// Con BOM: sin él, Excel en Windows abre el UTF-8 como ANSI y rompe las tildes.
export const toCsv = rows => '\uFEFF' + rows.map(r => r.map(csvCell).join(';')).join('\r\n') + '\r\n'

// Fila de ejemplo de la plantilla: mismos valores que api/member-import.js (un test del api lo
// verifica). Si el owner no la borra, el servidor la ignora con un aviso.
export const TEMPLATE_EXAMPLE_NAME = 'EJEMPLO – borrá esta fila'
export const TEMPLATE_EXAMPLE_DNI = '99.999.999'
export const TEMPLATE_HEADERS = ['Nombre y apellido', 'DNI', 'Celular', 'Mail', 'Plan', 'Vencimiento', 'Fecha último pago', 'Monto último pago']
export const templateCsv = () => toCsv([
  TEMPLATE_HEADERS,
  [TEMPLATE_EXAMPLE_NAME, TEMPLATE_EXAMPLE_DNI, '11 2345-6789', 'ejemplo@mail.com', 'Mensual', '10/11/2026', '10/10/2026', '$30.000'],
])

// Filas con error de la vista previa, con nombre y DNI del archivo para encontrarlas.
export function errorsCsv(previewRows, rows) {
  const byNumber = new Map(rows.map(r => [r.rowNumber, r]))
  return toCsv([
    ['Fila', 'Nombre y apellido', 'DNI', 'Motivo'],
    ...previewRows.filter(r => r.status === 'error').map(r => {
      const src = byNumber.get(r.rowNumber) || {}
      return [r.rowNumber, src.fullName || '', src.dni || '', r.messages.filter(m => m.level === 'error').map(m => m.text).join(' · ')]
    }),
  ])
}

export function downloadText(filename, text, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
