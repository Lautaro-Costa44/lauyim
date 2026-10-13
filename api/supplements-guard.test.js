// writeGuard (etapa 2): deshabilitado por el staff gana sobre el aviso y se puede volver a habilitar.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-supp-guard-'));
process.env.DATA_DIR = dataDir;
const db = await import('./database.js');
const sdb = await import('./supplements-db.js');
const { writeGuard } = await import('./supplements-routes.js');
const { SUPP_ACK_VERSION } = await import('./supplements.js');
db.initDatabase();
after(() => { db.closeDatabase(); fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
db.createUser({ id: 'owner', name: 'o', created: Date.now() });
db.createUser({ id: 'ana', name: 'ana', created: Date.now(), healthConsent: true });

test('writeGuard: deshabilitado por el staff gana sobre el aviso', () => {
  sdb.setAck('ana', SUPP_ACK_VERSION, 1);
  assert.equal(writeGuard({ id: 'ana' }), null);
  sdb.setStaffAccess('ana', { disabled: true, reason: null, by: 'owner' });
  assert.deepEqual(writeGuard({ id: 'ana' }), [403, { error: 'supplements_disabled' }]);
  sdb.setStaffAccess('ana', { disabled: false, reason: null, by: 'owner' });
  assert.equal(writeGuard({ id: 'ana' }), null);
});
