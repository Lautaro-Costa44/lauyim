// Cada ruta /api/admin de server.js que usa requireAdmin tiene su permiso en ROUTE_PERMISSIONS, y
// el catálogo no nombra rutas que no existen ni permisos desconocidos.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ROUTE_PERMISSIONS, PERMISSION_CODES } from './permissions.js';

const src = fs.readFileSync(new URL('./server.js', import.meta.url), 'utf8');
// Handlers: desde "  'MÉTODO /api/...': async" hasta el próximo.
const handlers = [];
for (const m of src.matchAll(/^ {2}'((?:GET|POST|PUT|PATCH|DELETE) \/api\/[^']+)': async[\s\S]*?(?=^ {2}'(?:GET|POST|PUT|PATCH|DELETE) \/api\/|^};)/gm)) handlers.push([m[1], m[0]]);

test('toda ruta con requireAdmin tiene permiso', () => {
  const missing = handlers.filter(([key, body]) => body.includes('requireAdmin(') && !(key in ROUTE_PERMISSIONS)).map(([k]) => k);
  assert.deepEqual(missing, []);
});

test('el catálogo solo nombra rutas que existen y permisos conocidos', () => {
  const keys = new Set(handlers.map(([k]) => k));
  assert.deepEqual(Object.keys(ROUTE_PERMISSIONS).filter(k => !keys.has(k)), []);
  assert.deepEqual(Object.values(ROUTE_PERMISSIONS).filter(c => !PERMISSION_CODES.includes(c)), []);
});

test('las rutas /api/admin solo se protegen con requireAdmin (las del owner viven en /api/owner)', () => {
  const odd = handlers.filter(([k, body]) => k.includes(' /api/admin/') && !body.includes('requireAdmin(') && !body.includes('requireOwner(')).map(([k]) => k);
  assert.deepEqual(odd, []);
});
