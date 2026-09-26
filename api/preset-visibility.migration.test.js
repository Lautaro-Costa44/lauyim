// preset_programs.visible_to_members sobre una base de antes de la columna: los programas que ya
// existían quedan visibles (nada cambia para los socios); los que se crean después, ocultos.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-visibility-'));
process.env.DATA_DIR = dataDir;

const legacy = new DatabaseSync(path.join(dataDir, 'gym.db'));
legacy.exec(`
  CREATE TABLE preset_programs (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE, position INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);
  INSERT INTO preset_programs (id, name, position, created_at) VALUES ('gold', 'PPL', 0, 1);
`);
legacy.close();

const { initDatabase, closeDatabase, getPresetPrograms, getPresetProgramById, ensurePresetProgram, setPresetProgramVisibility } = await import('./database.js');
initDatabase();

test('un programa que ya existía queda visible; uno nuevo nace oculto', () => {
  assert.equal(getPresetProgramById('gold').visibleToMembers, true);
  const created = ensurePresetProgram('Nuevo');
  assert.equal(getPresetProgramById(created.id).visibleToMembers, false);
  assert.deepEqual(getPresetPrograms().map(p => [p.name, p.visibleToMembers]), [['PPL', true], ['Nuevo', false]]);
  assert.equal(setPresetProgramVisibility(created.id, true).visibleToMembers, true);
  // Volver a abrir la base no pisa lo elegido.
  initDatabase();
  assert.equal(getPresetProgramById(created.id).visibleToMembers, true);
});

after(() => {
  closeDatabase();
  fs.rmSync(dataDir, { recursive: true, force: true });
});
