// Importar socios: lectura del archivo y mapeo de columnas, sin React. La tz del proceso es la
// de Argentina (UTC-3): ahí es donde toISOString() corre las fechas un día.
process.env.TZ = 'America/Argentina/Buenos_Aires'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  autodetectColumns, buildRows, cellToString, csvCell, dateCellToIso, decodeText, detectDelimiter, distinctPlans,
  errorsCsv, mappingProblems, normHeader, readImportFile, tableToSheet, templateCsv, toCsv
} from './import-parse.js'

const fixture = name => {
  const buf = readFileSync(new URL('./__fixtures__/' + name, import.meta.url))
  return new File([buf], name)
}

describe('autodetección de columnas', () => {
  it('reconoce los sinónimos sin tildes ni mayúsculas', () => {
    expect(autodetectColumns(['Nombre y Apellido', 'N° Documento', 'Teléfono', 'E-mail', 'Membresía', 'Próximo pago', 'Fecha de pago', 'Importe'])).toEqual(
      ['fullName', 'dni', 'phone', 'email', 'planValue', 'dueDate', 'lastPaymentDate', 'lastPaymentAmount'])
    expect(autodetectColumns(['SOCIO', 'doc', 'WhatsApp', 'Correo', 'Abono', 'Vence', 'Último pago', 'Pagado'])).toEqual(
      ['fullName', 'dni', 'phone', 'email', 'planValue', 'dueDate', 'lastPaymentDate', 'lastPaymentAmount'])
    expect(autodetectColumns(['Alumno', 'Cliente'])).toEqual(['fullName', 'ignore'])        // un campo por columna
    expect(autodetectColumns(['Nombres', 'Apellidos', 'Nro de documento', 'Móvil', 'Actividad', 'Cuota'])).toEqual(
      ['firstName', 'lastName', 'dni', 'phone', 'planValue', 'ignore'])
  })

  it('por palabras: el monto gana a la fecha y "fecha de vencimiento" no es un pago', () => {
    expect(autodetectColumns(['Monto último pago', 'Fecha último pago', 'Fecha de vencimiento', 'Precio del plan', 'Observaciones'])).toEqual(
      ['lastPaymentAmount', 'lastPaymentDate', 'dueDate', 'ignore', 'ignore'])    // "Precio del plan": el monto ya estaba
    expect(normHeader('  Teléfono / Móvil ')).toBe('telefono movil')
  })

  it('problemas del mapeo: sin nombre, sin DNI (si está activo), columnas repetidas', () => {
    expect(mappingProblems(['dni'], { dniEnabled: true })[0]).toMatch(/nombre/)
    expect(mappingProblems(['fullName'], { dniEnabled: true })[0]).toMatch(/DNI/)
    expect(mappingProblems(['fullName'], { dniEnabled: false })).toEqual([])
    expect(mappingProblems(['firstName', 'lastName', 'dni', 'phone', 'phone'], { dniEnabled: true })[0]).toMatch(/Celular/)
  })
})

describe('filas', () => {
  it('combina Nombre + Apellido cuando no hay "Nombre y apellido" y saltea filas vacías', () => {
    const data = [
      { rowNumber: 2, cells: ['', 'Martín', ' Pérez ', '28111222'] },
      { rowNumber: 3, cells: ['Lucía  Gómez', 'x', 'y', '30.123.456'] },
      { rowNumber: 5, cells: ['', '', '', ''] },
    ]
    expect(buildRows(data, ['fullName', 'firstName', 'lastName', 'dni'])).toEqual([
      { rowNumber: 2, fullName: 'Martín Pérez', dni: '28111222', phone: '', email: '', planValue: '', dueDate: '', lastPaymentDate: '', lastPaymentAmount: '' },
      { rowNumber: 3, fullName: 'Lucía Gómez', dni: '30.123.456', phone: '', email: '', planValue: '', dueDate: '', lastPaymentDate: '', lastPaymentAmount: '' },
    ])
  })

  it('números de fila de la planilla, con filas vacías en el medio', () => {
    const sheet = tableToSheet([[], ['Nombre', 'DNI'], ['Ana', 1], [], [null, null], ['Beto', '2']])
    expect(sheet.headers).toEqual(['Nombre', 'DNI'])
    expect(sheet.data.map(r => r.rowNumber)).toEqual([3, 6])
    expect(tableToSheet([['Nombre']]).error).toMatch(/no tiene filas/)
  })

  it('valores de plan distintos con cantidad, agrupados sin tildes ni mayúsculas', () => {
    const rows = ['Musculación', 'musculacion ', 'Mensual', 'MUSCULACIÓN', '', 'Mensual', 'Pase libre'].map((planValue, i) => ({ rowNumber: i + 2, planValue }))
    expect(distinctPlans(rows)).toEqual([
      { key: 'musculacion', value: 'Musculación', count: 3 },
      { key: 'mensual', value: 'Mensual', count: 2 },
      { key: 'pase libre', value: 'Pase libre', count: 1 },
    ])
  })
})

describe('fechas de Excel sin corrimiento', () => {
  it('Date a medianoche UTC (read-excel-file) o local → el mismo día, en UTC-3', () => {
    const utc = new Date(Date.UTC(2026, 2, 5))
    const local = new Date(2026, 2, 5)
    expect(local.toISOString().slice(0, 10)).toBe('2026-03-05')           // medianoche local = 03:00 UTC
    expect(new Date(2026, 2, 5, 0, 0, 0).getTimezoneOffset()).toBe(180)
    expect(utc.getDate()).toBe(4)                                          // los componentes locales corren el día…
    expect(dateCellToIso(utc)).toBe('2026-03-05')                          // …acá no
    expect(dateCellToIso(local)).toBe('2026-03-05')
    expect(dateCellToIso(new Date(2026, 11, 31, 23, 30))).toBe('2026-12-31')  // toISOString daría 2027-01-01
    expect(dateCellToIso(new Date('x'))).toBe('')
    expect(cellToString(utc)).toBe('2026-03-05')
    expect(cellToString(46310)).toBe('46310')
    expect(cellToString(null)).toBe('')
  })
})

describe('CSV', () => {
  it('separador ; o , (fuera de comillas) y UTF-8 con o sin BOM; si no es UTF-8, windows-1252', () => {
    expect(detectDelimiter('\uFEFFNombre;DNI;Mail\nA;1;x')).toBe(';')
    expect(detectDelimiter('"Pérez; Ana",DNI,Mail')).toBe(',')
    expect(detectDelimiter('Nombre')).toBe(',')
    const utf8 = new TextEncoder().encode('\uFEFFMartínez')
    expect(decodeText(utf8.buffer)).toBe('Martínez')
    expect(decodeText(new Uint8Array([0x4d, 0x61, 0x72, 0x74, 0xed, 0x6e, 0x65, 0x7a]).buffer)).toBe('Martínez')
  })

  it('plantilla: BOM, ";" y una fila de ejemplo', () => {
    const csv = templateCsv()
    expect(csv.startsWith('\uFEFFNombre y apellido;DNI;Celular;Mail;Plan;Vencimiento;Fecha último pago;Monto último pago\r\n')).toBe(true)
    expect(csv.trim().split('\r\n')).toHaveLength(2)
    expect(csv.trim().split('\r\n')[1]).toMatch(/^EJEMPLO – borrá esta fila;99\.999\.999;/)
  })

  it('errores descargables: escapa lo que Excel tomaría como fórmula', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(['+1', '-2', '@SUM', '\tx'].map(csvCell)).toEqual(["'+1", "'-2", "'@SUM", "'\tx"])
    expect(csvCell('a;b')).toBe('"a;b"')
    const out = errorsCsv(
      [{ rowNumber: 5, status: 'error', messages: [{ level: 'error', text: 'Falta el DNI' }, { level: 'warning', text: 'no va' }] }, { rowNumber: 6, status: 'nuevo', messages: [] }],
      [{ rowNumber: 5, fullName: '=Pedro Test', dni: '' }, { rowNumber: 6, fullName: 'Ok' }])
    expect(out).toBe(toCsv([['Fila', 'Nombre y apellido', 'DNI', 'Motivo'], [5, '=Pedro Test', '', 'Falta el DNI']]))
    expect(out).toContain("5;'=Pedro Test;;Falta el DNI")
  })
})

describe('archivo de ejemplo (__fixtures__)', () => {
  const expectRows = rows => {
    const by = n => rows.find(r => r.rowNumber === n)
    expect(rows).toHaveLength(25)
    expect(by(2)).toMatchObject({ fullName: 'Lucía Gómez', dni: '30.123.456', dueDate: expect.stringMatching(/^(2026-10-10|10\/10\/2026)$/), lastPaymentAmount: '$30.000' })
    expect(by(3).fullName).toBe('Martín Pérez')
    expect(by(3).dni).toBe('28111222')
    expect(by(4).dueDate).toBe('15/10/26')
    expect(by(15).fullName).toBe('')
    expect(by(25).fullName).toBe('=Pedro Test')
  }

  it('CSV: detecta ";" y las columnas, y combina Nombre + Apellido', async () => {
    const sheet = await readImportFile(fixture('import-ejemplo.csv'))
    const mapping = autodetectColumns(sheet.headers)
    expect(mapping).toEqual(['fullName', 'firstName', 'lastName', 'dni', 'phone', 'email', 'planValue', 'dueDate', 'lastPaymentDate', 'lastPaymentAmount'])
    const rows = buildRows(sheet.data, mapping)
    expectRows(rows)
    expect(rows.find(r => r.rowNumber === 10).dueDate).toBe('46310')
  })

  it('XLSX: fechas con formato → aaaa-mm-dd sin correr el día; números sin formato quedan como serie', async () => {
    const sheet = await readImportFile(fixture('import-ejemplo.xlsx'))
    const rows = buildRows(sheet.data, autodetectColumns(sheet.headers))
    expectRows(rows)
    const by = n => rows.find(r => r.rowNumber === n)
    expect(by(2).dueDate).toBe('2026-10-10')
    expect(by(12).lastPaymentDate).toBe('2026-09-05')
    expect(by(10).dueDate).toBe('46310')
    expect(by(3).lastPaymentAmount).toBe('30000')
  })

  it('rechaza .xls viejo y otros formatos', async () => {
    expect((await readImportFile(new File(['x'], 'socios.xls'))).error).toMatch(/\.xls viejo/)
    expect((await readImportFile(new File(['x'], 'socios.pdf'))).error).toMatch(/\.xlsx o \.csv/)
  })
})
