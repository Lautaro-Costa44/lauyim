/* ============================================================
   BACKUP DEL CÓDIGO VIEJO DE db.json
   Guardado como referencia por si hace falta revertir
   ============================================================ */

/* ---------- secret + db ---------- */
const secretFile = path.join(DATA, 'secret');
if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const SECRET = fs.readFileSync(secretFile, 'utf8').trim();

const dbFile = path.join(DATA, 'db.json');
let db = { users: [], creds: [], subs: [], invites: [], presets: [] };
try { db = JSON.parse(fs.readFileSync(dbFile, 'utf8')); } catch {}
db.subs = db.subs || [];
db.invites = db.invites || [];
db.presets = Array.isArray(db.presets) ? db.presets : [];
const isAdmin = user => !!user && (user.admin === true || ADMIN_UIDS.includes(user.id));
function saveDb() { atomicWrite(dbFile, JSON.stringify(db, null, 2)); }
function atomicWrite(file, content) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, file);
}
const stateFile = uid => path.join(DATA, 'state-' + uid.replace(/[^a-zA-Z0-9_-]/g, '') + '.json');
function readState(uid) {
  try { return JSON.parse(fs.readFileSync(stateFile(uid), 'utf8')); } catch { return null; }
}

/* ---------- presets ---------- */
const DEFAULT_PRESETS = [
  { id: 'starter-push', name: 'Push Day', emoji: 'barbell', ex: [['0025', 4, 8], ['0047', 3, 10], ['0426', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 3, 10]] },
  { id: 'starter-pull', name: 'Pull Day', emoji: 'pullup', ex: [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['0031', 3, 10], ['0313', 3, 12]] },
  { id: 'starter-legs', name: 'Leg Day', emoji: 'legs', ex: [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]] }
].map(r => ({ ...r, ex: r.ex.map(([id, sets, reps]) => ({ id, sets, reps, weight: 0 })) }));
if (!db.presets.length) {
  db.presets = DEFAULT_PRESETS.map(r => ({ ...r, ex: r.ex.map(e => ({ ...e })) }));
  saveDb();
}
