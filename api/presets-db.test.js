// Migración de presets en una base anterior a preset_programs: un programa por group_name sin
// distinguir mayúsculas y los días ordenados por día planeado (lunes primero).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-presets-db-'));
process.env.DATA_DIR = dataDir;
const db = await import('./database.js');

test.after(() => {
  db.closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test('backfill de programas y orden en una base vieja', () => {
  db.initDatabase();
  const raw = db.getDatabase();
  raw.exec('DELETE FROM preset_programs');
  const insert = raw.prepare('INSERT INTO presets (id, name, emoji, group_name, planned_day, position) VALUES (?, ?, ?, ?, ?, 0)');
  insert.run('sun', 'Domingo', 'x', 'ppl', 0);
  insert.run('none', 'Sin día', 'x', ' PPL ', null);
  insert.run('wed', 'Miércoles', 'x', 'PPL', 3);
  insert.run('mon', 'Lunes', 'x', 'ppl', 1);
  insert.run('solo', 'Solo', 'x', 'Full Body', 2);
  db.initDatabase();

  const programs = db.getPresetPrograms();
  assert.deepEqual(programs.map(p => [p.name, p.count]), [['Full Body', 1], ['ppl', 4]]);
  const ppl = db.getAllPresets().filter(p => p.program_id === programs[1].id);
  assert.deepEqual(ppl.map(p => p.id), ['mon', 'wed', 'sun', 'none']);
  assert.ok(ppl.every(p => p.group_name === 'ppl'));

  // idempotente: otra inicialización no crea programas ni reordena
  db.initDatabase();
  assert.equal(db.getPresetPrograms().length, 2);
  assert.deepEqual(db.getAllPresets().filter(p => p.group_name === 'ppl').map(p => p.id), ['mon', 'wed', 'sun', 'none']);
});
