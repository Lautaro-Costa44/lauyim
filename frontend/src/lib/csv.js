// CSV reader shared by the training-history import (import-csv.js) and the member import
// (views/admin/members/import-parse.js). Kept in its own module so the member import doesn't
// pull the exercise database that import-csv.js needs.

/**
 * A real CSV reader: quoted fields, embedded delimiters and newlines, doubled quotes, BOM
 * and CRLF. Splitting on commas breaks on the first exercise named "Bench Press, Close
 * Grip" — and a whole history would import shifted by one column without ever erroring.
 * `delimiter`: ',' by default; Excel in Spanish saves CSV with ';'.
 * `keepEmptyRows`: keep blank records as [] so indexes match the row numbers a spreadsheet shows.
 */
export function parseCSV(text, delimiter = ',', { keepEmptyRows = false } = {}) {
  const rows = []
  let row = [], field = '', quoted = false
  const s = String(text).replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++ } else quoted = false }
      else field += c
    } else if (c === '"') quoted = true
    else if (c === delimiter) { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(x => x !== '')) rows.push(row)
      else if (keepEmptyRows) rows.push([])
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some(x => x !== '')) rows.push(row)
  return rows
}
