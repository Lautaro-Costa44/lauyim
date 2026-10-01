// .env.example es la referencia para configurar una instancia (README.md): toda variable
// que lee la API o el compose de ejemplo tiene que estar ahí, con su explicación. Este test falla
// si el código empieza a leer una variable nueva y nadie la documentó.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

// Las fija el compose (no se configuran en .env) o ya no existen (la API avisa en el log).
const NOT_IN_ENV = new Set(['DATA_DIR', 'DEMO_ADMIN_ALL_USERS']);

function usedByApi() {
  const names = new Set();
  for (const file of fs.readdirSync(here)) {
    if (!file.endsWith('.js') || file.endsWith('.test.js')) continue;
    const src = fs.readFileSync(path.join(here, file), 'utf8');
    for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) names.add(m[1]);
    for (const m of src.matchAll(/envMax\('([A-Z][A-Z0-9_]*)'/g)) names.add(m[1]);
  }
  return names;
}

function usedByCompose() {
  const src = fs.readFileSync(path.join(root, 'docker-compose.example.yml'), 'utf8');
  return new Set([...src.matchAll(/\$\{([A-Z][A-Z0-9_]*)(?::-[^}]*)?\}/g)].map(m => m[1]));
}

function documented() {
  const src = fs.readFileSync(path.join(root, '.env.example'), 'utf8');
  // "X=valor" o, para las opcionales, comentada: "# X=valor".
  return new Set([...src.matchAll(/^#?\s*([A-Z][A-Z0-9_]*)=/gm)].map(m => m[1]));
}

test('.env.example documenta cada variable que leen la API y el compose de ejemplo', () => {
  const docs = documented();
  const missing = [...usedByApi(), ...usedByCompose()].filter(name => !NOT_IN_ENV.has(name) && !docs.has(name));
  assert.deepEqual([...new Set(missing)].sort(), []);
});

test('.env.example no documenta variables que nadie lee', () => {
  const used = new Set([...usedByApi(), ...usedByCompose()]);
  const stale = [...documented()].filter(name => !used.has(name));
  assert.deepEqual(stale.sort(), []);
});
