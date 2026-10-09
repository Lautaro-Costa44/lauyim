// Cada ruta /api/admin de server.js (y de classes-routes.js y closures-routes.js) que usa requireAdmin tiene su permiso en ROUTE_PERMISSIONS, y
// el catálogo no nombra rutas que no existen ni permisos desconocidos.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ROUTE_PERMISSIONS, PERMISSION_CODES } from './permissions.js';

// Handlers: desde "  'MÉTODO /api/...': async" hasta el próximo (o el cierre de la tabla de rutas).
const handlers = [];
for (const file of ['./server.js', './classes-routes.js', './closures-routes.js']) {
  const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  for (const m of src.matchAll(/^ {2}'((?:GET|POST|PUT|PATCH|DELETE) \/api\/[^']+)': async[\s\S]*?(?=^ {2}'(?:GET|POST|PUT|PATCH|DELETE) \/api\/|^ {0,2}};|^ {2}\/\/ Clases grupales)/gm)) handlers.push([m[1], m[0]]);
}

test('toda ruta con requireAdmin tiene permiso', () => {
  const missing = handlers.filter(([key, body]) => body.includes('requireAdmin(') && !(key in ROUTE_PERMISSIONS)).map(([k]) => k);
  assert.deepEqual(missing, []);
});

test('el catálogo solo nombra rutas que existen y permisos conocidos', () => {
  const keys = new Set(handlers.map(([k]) => k));
  assert.deepEqual(Object.keys(ROUTE_PERMISSIONS).filter(k => !keys.has(k)), []);
  assert.deepEqual(Object.values(ROUTE_PERMISSIONS).flat().filter(c => !PERMISSION_CODES.includes(c)), []);
});

test('las rutas /api/admin solo se protegen con requireAdmin (las del owner viven en /api/owner)', () => {
  const odd = handlers.filter(([k, body]) => k.includes(' /api/admin/') && !body.includes('requireAdmin(') && !body.includes('requireOwner(')).map(([k]) => k);
  assert.deepEqual(odd, []);
});
