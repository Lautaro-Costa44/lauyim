#!/usr/bin/env node
// Carga el gimnasio de la demo: arma una base nueva con datos de ejemplo, la verifica y la pone en
// lugar de la anterior (que queda como gym.db.antes-demo-<fecha>). No toca `secret` ni `vapid.json`.
// Paso a paso en docs/demo.md.
//
// Uso (con la API de la demo parada):
//   node scripts/demo/seed-demo.mjs --data <carpeta de datos> [--origin https://demo.lauyim.online]
// Opciones:
//   --data <dir>     carpeta de datos de la instancia (la que se monta en /data). Obligatoria.
//   --origin <url>   dirección de la demo, para los links de vinculación.
//   --codigos-perfiles  también da códigos para los 5 perfiles (quedan sin passkey hasta usarlos),
//                    para mostrar la vista de un socio o de la profe en otro celular.
//   --now <ISO>      "ahora" de la demo (solo para pruebas).
//
// Códigos de salida: 0 ok · 1 la verificación encontró problemas (no se reemplazó nada) · 2 uso.

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const opt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const dataDir = opt('--data') && path.resolve(opt('--data'));
const origin = (opt('--origin') || 'https://demo.lauyim.online').replace(/\/+$/, '').replace(/\/#.*$/, '');
const now = opt('--now') ? Date.parse(opt('--now')) : Date.now();
const profileCodes = args.includes('--codigos-perfiles');
if (!dataDir || !Number.isFinite(now)) {
  console.error('uso: node scripts/demo/seed-demo.mjs --data <carpeta de datos> [--origin https://demo.lauyim.online]');
  process.exit(2);
}
if (!fs.existsSync(dataDir)) {
  console.error(`seed-demo: no existe la carpeta ${dataDir}`);
  process.exit(2);
}

// La API de la demo tiene que estar parada: si tiene la base abierta, seguiría usando la vieja.
// Con locking_mode EXCLUSIVE, la primera lectura pide el lock exclusivo y falla si otro proceso la
// tiene abierta.
if (fs.existsSync(path.join(dataDir, 'gym.db'))) {
  const { DatabaseSync } = await import('node:sqlite');
  let open = false;
  try {
    const probe = new DatabaseSync(path.join(dataDir, 'gym.db'), { timeout: 0 });
    try {
      probe.exec('PRAGMA locking_mode = EXCLUSIVE');
      probe.prepare('SELECT COUNT(*) AS n FROM sqlite_master').get();
    } finally { probe.close(); }
  } catch (error) {
    open = /locked|busy/i.test(String(error?.message));
    if (!open) throw error;
  }
  if (open) {
    console.error('seed-demo: la base está abierta: frená la API de la demo antes (docker compose -p lauyim-demo stop api).');
    process.exit(2);
  }
}

// Se arma en una carpeta aparte: si algo falla, la base de la demo queda como estaba.
const stamp = new Date(now).toISOString().slice(0, 19).replace(/[:T]/g, '-');
const work = path.join(dataDir, `.demo-${stamp}`);
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
process.env.DATA_DIR = work;

const { buildDemo } = await import('./build.mjs');
const { checkDemo } = await import('./check.mjs');
const { closeDatabase, getDatabase } = await import('../../api/database.js');

// Si algo falla antes del reemplazo, no queda la carpeta de trabajo.
const abort = code => {
  try { closeDatabase(); } catch {}
  fs.rmSync(work, { recursive: true, force: true });
  process.exit(code);
};

let result;
try {
  console.log('Armando el gimnasio de la demo…');
  result = await buildDemo({ now, profileCodes, log: line => console.log('  ' + line) });
  const problems = checkDemo({ now, today: result.today });
  if (problems.length) {
    console.error(`\nLa verificación encontró ${problems.length} problema(s); no se reemplazó nada:`);
    for (const p of problems.slice(0, 50)) console.error('  - ' + p);
    abort(1);
  }
  // Todo en el archivo principal antes de moverlo (sin -wal ni -shm).
  getDatabase().exec('PRAGMA wal_checkpoint(TRUNCATE)');
  closeDatabase();
} catch (error) {
  console.error('\nNo se pudo armar la demo; no se reemplazó nada.');
  console.error(error);
  abort(1);
}

// Reemplazo: la base y el registro de actividad anteriores quedan con otro nombre.
const hadBase = fs.existsSync(path.join(dataDir, 'gym.db'));
try {
  for (const name of ['gym.db', 'gym.db-wal', 'gym.db-shm', 'audit.log']) {
    const target = path.join(dataDir, name);
    if (fs.existsSync(target)) fs.renameSync(target, `${target}.antes-demo-${stamp}`);
  }
  fs.renameSync(path.join(work, 'gym.db'), path.join(dataDir, 'gym.db'));
  fs.renameSync(path.join(work, 'audit.log'), path.join(dataDir, 'audit.log'));
} catch (error) {
  console.error(`\nNo se pudo poner la base nueva en ${dataDir}. Las anteriores quedaron como *.antes-demo-${stamp}.`);
  console.error(error);
  process.exit(1);
} finally {
  fs.rmSync(work, { recursive: true, force: true });
}

console.log(`\nListo: ${result.people.length} personas. Hoy en la demo es ${result.today}.`);
console.log(`Clase llena con lista de espera: Spinning del ${result.fullOccDate}. Feriado: ${result.closureDate}.`);
console.log(result.linkCodes.length > 1
  ? '\nCódigos para entrar (valen 72 h, uno por persona). Abrí el link en el celular y creá tu passkey:\n'
  : '\nCódigo para entrar como el dueño (vale 72 h). Abrí el link en el celular y creá tu passkey:\n');
for (const c of result.linkCodes) {
  const role = c.role === 'owner' ? 'dueño' : c.role === 'coach' ? 'profe' : c.role === 'reception' ? 'recepción' : 'socio/a';
  console.log(`  ${c.fullName.padEnd(24)} ${role.padEnd(10)} ${c.code}   ${origin}/?link=${c.code}`);
}
console.log(hadBase
  ? `\nLa base anterior quedó como gym.db.antes-demo-${stamp}. Ahora levantá la API de la demo.`
  : '\nAhora levantá la API de la demo.');
