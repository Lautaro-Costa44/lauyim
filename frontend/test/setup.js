// Node 26 can disable happy-dom's storage shim unless a localstorage file is supplied.
// Tests only need the Web Storage contract; production always uses the browser storage.
if (typeof globalThis.localStorage === 'undefined') {
  const values = new Map()
  globalThis.localStorage = {
    get length() { return values.size },
    key: index => [...values.keys()][index] ?? null,
    getItem: key => values.has(String(key)) ? values.get(String(key)) : null,
    setItem: (key, value) => values.set(String(key), String(value)),
    removeItem: key => values.delete(String(key)),
    clear: () => values.clear()
  }
}
