# Pasar el rol de dueño: plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el dueño pueda pasarle su rol a otra cuenta activa con app, confirmando con su passkey. Él queda como Administrador.

**Architecture:**
- La base cambia el dueño en una transacción (`transferOwnership`).
- Dos rutas `/api/owner/transfer/*` verifican una passkey del dueño, con el mismo patrón que la salida de Ingreso Físico.
- En el panel, "Gestionar roles" suma una sección al final con un cartel de confirmación que pide la passkey.

**Tech Stack:**
- Backend: Node `node:http` + `node:sqlite` + `@simplewebauthn/server`; tests con `node --test` y passkeys simuladas.
- Frontend: React 19 + Vitest.

**Spec:** `docs/superpowers/specs/2026-10-09-pasar-dueno-design.md`

## Global Constraints

- Textos de la UI en español rioplatense con voseo. `lauyim` siempre en minúscula.
- **Interruptor:** `OWNER_TRANSFER_ENABLED`, prendido salvo `0`, `false`, `no` u `off` (sin distinguir mayúsculas).
- **Passkey:** `userVerification: 'required'` en las opciones y `requireUserVerification: true` al verificar. Solo valen las credenciales del dueño.
- **Sin push.** Auditoría `owner.transfer`.
- **Ex dueño:** `owner = 0, admin = 0, role_id = 'admin'` (igual que `setUserRole`).
- **Dueño nuevo:** `owner = 1, admin = 1, role_id = NULL`.
- **Tests:** backend con `cd api && node --test <archivo>`; frontend con `cd frontend && npx vitest run <archivo>`. Antes del último commit, todo: `cd api && npm test` y `cd frontend && npm test && npm run build && node scripts/check-locales.mjs`.
- **Commits:** en inglés, Conventional Commits, terminados en `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Rama `feat/pasar-dueno`.

---

### Task 1: `transferOwnership` en la base

**Files:**
- Modify: `api/database.js` (después de `setUserRole`, ~línea 569)
- Test: `api/roles-db.test.js`

**Interfaces:**
- Produces: `transferOwnership(fromId: string, toId: string) → true`. Tira `Error('not_owner')` si `fromId` no es el dueño y `Error('target_not_found')` si `toId` no existe.

- [ ] **Step 1: Test que falla.** Al final de `api/roles-db.test.js` (usa `db` del archivo):

```js
test('transferOwnership: el dueño pasa a Administrador y el otro a dueño sin rol, todo junto', () => {
  db.createUser({ id: 'nueva', name: 'Nueva' });
  db.setUserRole('nueva', 'coach');
  const owner = db.getDatabase().prepare('SELECT id FROM users WHERE owner = 1').get().id;
  assert.equal(db.transferOwnership(owner, 'nueva'), true);
  const before = db.getUserById(owner), after = db.getUserById('nueva');
  assert.deepEqual([before.owner, before.admin, before.role_id], [0, 0, 'admin']);
  assert.deepEqual([after.owner, after.admin, after.role_id], [1, 1, null]);
  assert.equal(db.getDatabase().prepare('SELECT COUNT(*) AS n FROM users WHERE owner = 1').get().n, 1);
  assert.throws(() => db.transferOwnership(owner, 'nueva'), /not_owner/);
  assert.throws(() => db.transferOwnership('nueva', 'nadie'), /target_not_found/);
  assert.equal(db.getUserById('nueva').owner, 1);          // el fallo no tocó nada
  db.transferOwnership('nueva', owner);                    // deja la base como estaba
});
```

- [ ] **Step 2:** `cd api && node --test roles-db.test.js`. Esperado: FAIL (`transferOwnership is not a function`).

- [ ] **Step 3: Implementar** en `api/database.js`, después de `setUserRole`:

```js
// Pasar el rol de dueño (ver docs/superpowers/specs/2026-10-09-pasar-dueno-design.md): el dueño
// actual pasa a Administrador y `toId` a dueño sin rol (tiene todos los permisos). En ese orden por
// el índice único de un solo dueño, y todo o nada.
export function transferOwnership(fromId, toId) {
  const db = getDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    if (!db.prepare('SELECT 1 FROM users WHERE id = ? AND owner = 1').get(fromId)) throw new Error('not_owner');
    if (!db.prepare('SELECT 1 FROM users WHERE id = ?').get(toId)) throw new Error('target_not_found');
    db.prepare('UPDATE users SET owner = 0, admin = 0, role_id = ? WHERE id = ?').run(ADMIN_ROLE_ID, fromId);
    db.prepare('UPDATE users SET owner = 1, admin = 1, role_id = NULL WHERE id = ?').run(toId);
    db.exec('COMMIT');
    return true;
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
}
```

- [ ] **Step 4:** `cd api && node --test roles-db.test.js`. Esperado: PASS.

- [ ] **Step 5: Commit.**

```bash
git add api/database.js api/roles-db.test.js
git commit -m "feat(owner): transferOwnership in one transaction"
```

---

### Task 2: Rutas de transferencia y el interruptor

**Files:**
- Modify: `api/server.js`:
  - constante junto a `SURVEY_ENABLED` (~l.224);
  - `/api/config` (~l.2435);
  - las rutas nuevas, después de `'POST /api/owner/user/delete'` (~l.3542).
- Test: `api/owner-transfer.http.test.js` (nuevo).

**Interfaces:**
- Consumes: `transferOwnership(fromId, toId)` (Task 1).
- Produces:
  - `/api/config` suma `owner_transfer_enabled: boolean`;
  - `POST /api/owner/transfer/options { userId }` → `{ cid, options }`;
  - `POST /api/owner/transfer/verify { cid, credential }` → `{ ok: true, owner: { id, name } }`;
  - errores: `owner_transfer_disabled` (403), `not_found` (404), `already_owner`, `inactive` y `no_passkey` (400), `challenge_expired` (400), `passkey_verify_failed` (400), `forbidden` (403).

- [ ] **Step 1: Test que falla.** Crear `api/owner-transfer.http.test.js`:
  - copiar de `api/checkin.http.test.js` las líneas 1-50: imports, `ORIGIN`, `RP_ID`, `cbor`, `newPasskey`, `assertion`;
  - copiar también `cookie`, `call` y `before`/`after`, que levantan `server.js` con `ORIGIN` y `RP_ID` en el env;
  - prefijo de directorio `'lauyim-owner-transfer-'` y puerto `52000 + Math.floor(Math.random() * 900)`;
  - pasar `OWNER_TRANSFER_ENABLED` por env con una variable del test (ver el último test).

  Datos y tests:

```js
const db = await import('./database.js');
db.initDatabase();
const keys = { owner: newPasskey(), owner2: newPasskey(), ana: newPasskey(), adm: newPasskey() };
db.createUser({ id: 'owner', name: 'Dueña' });
db.createCredential({ id: keys.owner.id, userId: 'owner', publicKey: keys.owner.cose });
db.createCredential({ id: keys.owner2.id, userId: 'owner', publicKey: keys.owner2.cose });
db.createUser({ id: 'ana', name: 'Ana' });
db.createCredential({ id: keys.ana.id, userId: 'ana', publicKey: keys.ana.cose });
db.setUserRole('ana', 'coach');
db.createUser({ id: 'adm', name: 'Admin', admin: true });
db.createCredential({ id: keys.adm.id, userId: 'adm', publicKey: keys.adm.cose });
db.createUser({ id: 'ficha', name: 'Ficha', member: true });
db.createUser({ id: 'off', name: 'Off' }); db.createCredential({ id: 'c-off', userId: 'off', publicKey: 'x' }); db.updateUser('off', { disabled: true });
db.createUser({ id: 'pend', name: 'Pend', pending: true }); db.createCredential({ id: 'c-pend', userId: 'pend', publicKey: 'x' });
db.closeDatabase();

const start = async (who, userId) => call(who, 'POST', '/api/owner/transfer/options', { userId });
const finish = (who, cid, credential) => call(who, 'POST', '/api/owner/transfer/verify', { cid, credential });

test('config avisa que está prendido', async () => {
  assert.equal((await call(null, 'GET', '/api/config')).body.owner_transfer_enabled, true);
});

test('solo el dueño; destinos que no pueden ser dueños', async () => {
  assert.equal((await start('adm', 'ana')).status, 403);
  assert.equal((await start('owner', 'nadie')).status, 404);
  for (const [id, err] of [['owner', 'already_owner'], ['ficha', 'no_passkey'], ['off', 'inactive'], ['pend', 'inactive']]) {
    const r = await start('owner', id);
    assert.deepEqual([r.status, r.body.error], [400, err], id);
  }
});

test('las opciones piden verificación y solo las passkeys del dueño', async () => {
  const r = await start('owner', 'ana');
  assert.equal(r.status, 200);
  assert.equal(r.body.options.userVerification, 'required');
  assert.deepEqual(r.body.options.allowCredentials.map(c => c.id).sort(), [keys.owner.id, keys.owner2.id].sort());
});

test('passkey de otro, desafío reusado o de otra sesión: no cambia nada', async () => {
  let r = await start('owner', 'ana');
  assert.equal((await finish('owner', r.body.cid, assertion(keys.adm, r.body.options.challenge))).status, 403);
  r = await start('owner', 'ana');
  assert.equal((await finish('adm', r.body.cid, assertion(keys.owner, r.body.options.challenge))).status, 403);   // adm no es dueño
  r = await start('owner', 'ana');
  const cred = assertion(keys.owner, r.body.options.challenge);
  assert.equal((await finish('owner', 'otro-cid', cred)).body.error, 'challenge_expired');
  assert.equal((await call('ana', 'GET', '/api/owner/branding')).status, 403);   // ana sigue sin ser dueña
});

test('el cambio: ana dueña sin rol, la ex dueña Administrador; queda en el registro', async () => {
  const r = await start('owner', 'ana');
  const v = await finish('owner', r.body.cid, assertion(keys.owner, r.body.options.challenge));
  assert.equal(v.status, 200, JSON.stringify(v.body));
  assert.deepEqual(v.body, { ok: true, owner: { id: 'ana', name: 'Ana' } });
  const meAna = (await call('ana', 'GET', '/api/me')).body.user;
  const meOld = (await call('owner', 'GET', '/api/me')).body.user;
  assert.deepEqual([meAna.owner, meAna.role], [true, null]);
  assert.deepEqual([meOld.owner, meOld.role?.id], [false, 'admin']);
  assert.equal((await call('owner', 'PUT', '/api/owner/branding', {})).status, 403);
  assert.notEqual((await call('ana', 'GET', '/api/owner/branding')).status, 403);
  const reused = await finish('owner', r.body.cid, assertion(keys.owner, r.body.options.challenge));
  assert.equal(reused.body.error, 'challenge_expired');
  assert.match(fs.readFileSync(path.join(dataDir, 'audit.log'), 'utf8'), /owner\.transfer/);
});
```

Antes de escribirlo, revisar estas tres cosas:
- Cómo serializa `roleView(u)` en `/api/me`: si `role` es `{ id, name, … }`, el test usa `.role?.id`; si no, ajustar.
- Si existe `GET /api/owner/branding` (`grep -n "'GET /api/owner/branding'" api/server.js`); si no, usar otra ruta `/api/owner/*` de lectura.
- Si `createUser` acepta `pending` y `member` (`grep -n "user.pending\|user.member" api/database.js`).

Para el interruptor apagado: un segundo archivo chico, `api/owner-transfer-off.http.test.js`, que levanta el servidor con `OWNER_TRANSFER_ENABLED: 'false'` y verifica dos cosas: `owner_transfer_enabled === false` en `/api/config`, y que `start('owner', 'ana')` dé 403 `owner_transfer_disabled`. Copiar el mismo armado, con un puerto distinto (`52900 + Math.floor(Math.random() * 90)`).

- [ ] **Step 2:** `cd api && node --test owner-transfer.http.test.js owner-transfer-off.http.test.js`. Esperado: FAIL (404 en las rutas).

- [ ] **Step 3: Implementar en `api/server.js`.**

Junto a `SURVEY_ENABLED`:

```js
// Pasar el rol de dueño (Gestionar roles → "Dueño del gimnasio"). Prendido salvo que el .env lo apague.
const OWNER_TRANSFER_ENABLED = !/^(0|false|no|off)$/i.test(process.env.OWNER_TRANSFER_ENABLED || 'true');
```

En `/api/config`, después de `classes_available: classesAvailable()`, agregar `,` y:

```js
      // Pasar el rol de dueño (OWNER_TRANSFER_ENABLED): el panel muestra la opción solo prendido.
      owner_transfer_enabled: OWNER_TRANSFER_ENABLED
```

Importar `transferOwnership` en el import de `./database.js` de server.js. Después de `'POST /api/owner/user/delete'`:

```js
  // Pasar el rol de dueño: a una cuenta activa con app, confirmando con una passkey del dueño (con
  // huella, cara o PIN). El dueño pasa a Administrador. Sin push; queda en el registro.
  'POST /api/owner/transfer/options': async (req, res) => {
    const owner = requireOwner(req, res); if (!owner) return;
    if (!OWNER_TRANSFER_ENABLED) return json(res, 403, { error: 'owner_transfer_disabled' });
    const { userId } = await readBody(req);
    const target = getUserById(String(userId || ''));
    const blocker = ownerTransferBlocker(target);
    if (blocker) return json(res, blocker === 'not_found' ? 404 : 400, { error: blocker });
    const options = await generateAuthenticationOptions({
      rpID: RP_ID, userVerification: 'required',
      allowCredentials: getCredentialsByUserId(owner.id).map(c => ({ id: c.id, transports: typeof c.transports === 'string' ? JSON.parse(c.transports) : c.transports || undefined }))
    });
    const cid = putChallenge({ challenge: options.challenge, ownerTransfer: { ownerId: owner.id, targetId: target.id } });
    json(res, 200, { cid, options });
  },

  'POST /api/owner/transfer/verify': async (req, res) => {
    const owner = requireOwner(req, res); if (!owner) return;
    if (!OWNER_TRANSFER_ENABLED) return json(res, 403, { error: 'owner_transfer_disabled' });
    const body = await readBody(req);
    const c = takeChallenge(body.cid);
    if (!c?.ownerTransfer || c.ownerTransfer.ownerId !== owner.id) return json(res, 400, { error: 'challenge_expired' });
    const cred = getCredentialById(body.credential?.id);
    if (!cred || (cred.user_id || cred.userId) !== owner.id) {
      audit(req, 'owner.transfer.denied', { ok: false, user: owner, msg: 'passkey ajena' });
      return json(res, 403, { error: 'forbidden' });
    }
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: body.credential, expectedChallenge: c.challenge, expectedOrigin: ORIGIN, expectedRPID: RP_ID,
        requireUserVerification: true,
        credential: { id: cred.id, publicKey: b64uToBuf(cred.public_key || cred.publicKey), counter: cred.counter, transports: typeof cred.transports === 'string' ? JSON.parse(cred.transports) : cred.transports }
      });
    } catch {
      return json(res, 400, { error: 'passkey_verify_failed' });
    }
    if (!verification.verified) return json(res, 400, { error: 'passkey_verify_failed' });
    updateCredentialCounter(cred.id, verification.authenticationInfo.newCounter);
    const target = getUserById(c.ownerTransfer.targetId);
    const blocker = ownerTransferBlocker(target);
    if (blocker) return json(res, blocker === 'not_found' ? 404 : 400, { error: blocker });
    transferOwnership(owner.id, target.id);
    audit(req, 'owner.transfer', { user: owner, target, summary: `${owner.name} → ${target.name}` });
    json(res, 200, { ok: true, owner: { id: target.id, name: target.name } });
  },
```

Y la función auxiliar, junto a `isInactiveAccount` (~l.804):

```js
// ¿Puede recibir el rol de dueño? null si sí; si no, el código: not_found, already_owner, inactive o
// no_passkey (una ficha sin app no puede iniciar sesión para usarlo).
const ownerTransferBlocker = target => !target ? 'not_found' : isOwner(target) ? 'already_owner'
  : isInactiveAccount(target) ? 'inactive' : countCredentials(target.id) === 0 ? 'no_passkey' : null;
```

Revisar que `getCredentialsByUserId`, `countCredentials`, `getCredentialById`, `updateCredentialCounter` y `b64uToBuf` ya estén importados o definidos en server.js (`grep -n "getCredentialsByUserId\|countCredentials\|b64uToBuf" api/server.js | head`). Sumar los que falten al import de `./database.js`.

`route-permissions.test.js` solo mira las rutas `/api/admin`, así que no hace falta tocarlo.

- [ ] **Step 4:** `cd api && node --test owner-transfer.http.test.js owner-transfer-off.http.test.js route-permissions.test.js checkin.http.test.js`. Esperado: PASS.

- [ ] **Step 5: Commit.**

```bash
git add api/server.js api/owner-transfer.http.test.js api/owner-transfer-off.http.test.js
git commit -m "feat(owner): transfer ownership with a fresh owner passkey"
```

---

### Task 3: "Dueño del gimnasio" en Gestionar roles

**Files:**
- Modify: `frontend/src/views/admin/roles-common.jsx` (`RolePickSheet`)
- Modify: `frontend/src/lib/errors.js` (códigos nuevos), `frontend/src/lib/audit.js` (etiquetas `owner.transfer` y `owner.transfer.denied`), `frontend/src/index.css`
- Test: `frontend/src/views/admin/Roles.test.jsx`

**Interfaces:**
- Consumes:
  - las rutas y `owner_transfer_enabled` de la Task 2;
  - `passkeyAssertion(options)` de `lib/api.js`;
  - `useStore.getState().verifySession()`.
- Produces: `canReceiveOwnership(member) → boolean` (exportada) y `ownerTransferDialog({ member, onDone })`.

- [ ] **Step 1: Tests que fallan.** En `frontend/src/views/admin/Roles.test.jsx`, junto al test de `RolePickSheet` (línea ~130):
  - si el archivo no mockea `passkeyAssertion`, agregar en el `vi.mock('../../lib/api.js', …)` que ya existe: `passkeyAssertion: passkeyMock`, con `const passkeyMock = vi.hoisted(() => vi.fn())`;
  - importar `canReceiveOwnership` de `./roles-common.jsx`.

```jsx
describe('Dueño del gimnasio', () => {
  const ana = { id: 'ana', name: 'Ana', role: null, hasApp: true, disabled: false, pending: false, owner: false }
  const renderPick = async member => {
    const host = document.createElement('div'); document.body.appendChild(host)
    const r = createRoot(host)
    await act(async () => { r.render(<RolePickSheet user={member} close={() => {}} onChanged={() => {}} />) })
    for (let i = 0; i < 3; i++) await act(async () => { await new Promise(res => setTimeout(res, 10)) })
    return { host, done: () => { act(() => r.unmount()); host.remove() } }
  }

  it('canReceiveOwnership: con app, activa, aprobada y no dueña', () => {
    expect(canReceiveOwnership(ana)).toBe(true)
    for (const extra of [{ hasApp: false }, { disabled: true }, { pending: true }, { owner: true }]) expect(canReceiveOwnership({ ...ana, ...extra })).toBe(false)
  })

  it('solo el dueño la ve, y solo con el interruptor prendido', async () => {
    apiMock.mockImplementation(url => url === '/api/admin/roles' ? Promise.resolve({ roles: [] }) : Promise.resolve({}))
    useStore.setState({ user: { id: 'owner', owner: true }, config: { owner_transfer_enabled: true } })
    let v = await renderPick(ana)
    expect(v.host.textContent).toContain('Dueño del gimnasio')
    expect(v.host.textContent).toContain('Pasarle el rol de dueño a Ana')
    v.done()
    useStore.setState({ config: { owner_transfer_enabled: false } })
    v = await renderPick(ana); expect(v.host.textContent).not.toContain('Dueño del gimnasio'); v.done()
    useStore.setState({ user: { id: 'adm', permissions: ['roles.assign', 'members.view'] }, config: { owner_transfer_enabled: true } })
    v = await renderPick(ana); expect(v.host.textContent).not.toContain('Dueño del gimnasio'); v.done()
  })

  it('confirmar: options → passkey → verify y refresca la sesión', async () => {
    useStore.setState({ user: { id: 'owner', owner: true }, config: { owner_transfer_enabled: true } })
    const verifySession = vi.fn(() => Promise.resolve())
    useStore.setState({ verifySession })
    apiMock.mockImplementation((url, opts) => url === '/api/admin/roles' ? Promise.resolve({ roles: [] })
      : url === '/api/owner/transfer/options' ? Promise.resolve({ cid: 'c1', options: { challenge: 'x' } })
      : url === '/api/owner/transfer/verify' ? Promise.resolve({ ok: true, owner: { id: 'ana', name: 'Ana' } })
      : Promise.resolve({}))
    passkeyMock.mockResolvedValue({ id: 'cred' })
    const v = await renderPick(ana)
    await act(async () => { [...v.host.querySelectorAll('button')].find(b => b.textContent.includes('Pasarle el rol de dueño')).click() })
    const sheet = useUI.getState().sheets.at(-1)
    expect(sheet.kind).toBe('center')
    const host = document.createElement('div'); document.body.appendChild(host)
    const r = createRoot(host)
    await act(async () => { r.render(sheet.render(() => {})) })
    expect(host.textContent).toContain('¿Pasarle el rol de dueño a Ana?')
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent.includes('Confirmar con mi passkey')).click() })
    await act(async () => { await new Promise(res => setTimeout(res, 20)) })
    expect(apiMock).toHaveBeenCalledWith('/api/owner/transfer/options', { method: 'POST', body: JSON.stringify({ userId: 'ana' }) })
    expect(passkeyMock).toHaveBeenCalledWith({ challenge: 'x' })
    expect(apiMock).toHaveBeenCalledWith('/api/owner/transfer/verify', { method: 'POST', body: JSON.stringify({ cid: 'c1', credential: { id: 'cred' } }) })
    expect(verifySession).toHaveBeenCalled()
    expect(useUI.getState().toastMsg).toBe('Ana ahora es dueño/a del gimnasio')
    act(() => r.unmount()); host.remove(); v.done()
  })

  it('cancelar la passkey no llama a verify', async () => {
    useStore.setState({ user: { id: 'owner', owner: true }, config: { owner_transfer_enabled: true } })
    apiMock.mockImplementation(url => url === '/api/owner/transfer/options' ? Promise.resolve({ cid: 'c1', options: {} }) : Promise.resolve({ roles: [] }))
    passkeyMock.mockRejectedValue(Object.assign(new Error('x'), { name: 'NotAllowedError' }))
    const { ownerTransferDialog } = await import('./roles-common.jsx')
    ownerTransferDialog({ member: ana, onDone: () => {} })
    const sheet = useUI.getState().sheets.at(-1)
    const host = document.createElement('div'); document.body.appendChild(host)
    const r = createRoot(host)
    await act(async () => { r.render(sheet.render(() => {})) })
    await act(async () => { [...host.querySelectorAll('button')].find(b => b.textContent.includes('Confirmar con mi passkey')).click() })
    await act(async () => { await new Promise(res => setTimeout(res, 20)) })
    expect(apiMock).not.toHaveBeenCalledWith('/api/owner/transfer/verify', expect.anything())
    expect(useUI.getState().toastMsg).toBe('Se canceló la passkey')
    act(() => r.unmount()); host.remove()
  })
})
```

`api()` puede recibir `opts` con más campos (por ejemplo headers). Si `toHaveBeenCalledWith` falla por eso, comparar con `expect.objectContaining({ method: 'POST', body: … })`.

- [ ] **Step 2:** `cd frontend && npx vitest run src/views/admin/Roles.test.jsx`. Esperado: FAIL.

- [ ] **Step 3: Implementar en `roles-common.jsx`.**

Imports: `import { api, passkeyAssertion } from '../../lib/api.js'` (reemplaza el import de `api`).

```jsx
// ¿Puede recibir el rol de dueño? Cuenta con app, activa, aprobada y que no sea la dueña (el servidor
// lo vuelve a controlar al pedir la passkey y al confirmar).
export const canReceiveOwnership = m => !!m && !!m.hasApp && !m.disabled && !m.pending && !m.owner

// Cartel de confirmación: qué cambia y "Confirmar con mi passkey" (passkey del dueño, con huella o cara).
function OwnerTransfer({ member, onDone, close }) {
  const toast = useUI(s => s.toast)
  const [busy, setBusy] = useState(false)
  const go = async () => {
    setBusy(true)
    try {
      const { cid, options } = await api('/api/owner/transfer/options', { method: 'POST', body: JSON.stringify({ userId: member.id }) })
      let credential
      try { credential = await passkeyAssertion(options) } catch (e) {
        toast(e?.name === 'NotAllowedError' || e?.name === 'AbortError' ? t('Se canceló la passkey') : errorText(e, t('No se pudo verificar la passkey. Intentá de nuevo.')))
        setBusy(false); return
      }
      await api('/api/owner/transfer/verify', { method: 'POST', body: JSON.stringify({ cid, credential }) })
      close()
      onDone && onDone()
      toast(t('{0} ahora es dueño/a del gimnasio', member.name))
      await useStore.getState().verifySession()
    } catch (e) { toast(errorText(e, t('No se pudo pasar el rol de dueño'))); setBusy(false) }
  }
  return <div className="owner-transfer">
    <div className="owner-transfer-icon" aria-hidden="true">👑</div>
    <h3>{t('¿Pasarle el rol de dueño a {0}?', member.name)}</h3>
    <ul className="owner-transfer-list small">
      <li>{t('{0} va a poder todo: cuotas, roles, personalización, borrar cuentas.', member.name)}</li>
      <li>{t('Vos pasás a Administrador. {0} te lo puede cambiar o quitar.', member.name)}</li>
      <li>{t('Para deshacerlo, {0} tiene que devolvértelo.', member.name)}</li>
    </ul>
    <button type="button" className="btn primary owner-transfer-go" disabled={busy} onClick={go}>🔑 {t('Confirmar con mi passkey')}</button>
    <button type="button" className="btn plain" disabled={busy} onClick={close}>{t('Cancel')}</button>
  </div>
}
export const ownerTransferDialog = ({ member, onDone }) =>
  useUI.getState().openSheet(close => <OwnerTransfer member={member} onDone={onDone} close={close} />, { kind: 'center' })
```

En `RolePickSheet`:
- Sumar `const transferOn = useStore(s => !!s.config?.owner_transfer_enabled)` y `const showOwner = !!me?.owner && transferOn && canReceiveOwnership(member)`.
- Después del `</div>}` del radiogroup, antes del `</div>` final:

```jsx
    {showOwner && <div className="owner-section">
      <h4 className="sec">{t('Dueño del gimnasio')}</h4>
      <p className="small muted">{t('Solo puede haber uno. Pide tu passkey y vos pasás a Administrador.')}</p>
      <button type="button" className="lrow tap owner-row" disabled={busy} onClick={() => ownerTransferDialog({ member, onDone: () => { onChanged(); close() } })}>
        <span className="owner-crown" aria-hidden="true">👑</span>
        <span className="lrow-m"><span className="lrow-t">{t('Pasarle el rol de dueño a {0}', member.name)}</span></span>
        <Icon name="chevronRight" className="lrow-k" />
      </button>
    </div>}
```

En `lib/errors.js` (junto a los demás):

```js
  owner_transfer_disabled: 'Pasar el rol de dueño está desactivado en esta instancia.',
  already_owner: 'Esa persona ya es la dueña.',
  inactive: 'La cuenta está desactivada o pendiente de aprobación.',
  no_passkey: 'Esa persona todavía no usa la app: no puede ser dueña.',
```

En `lib/audit.js`, en el mapa de etiquetas:

```js
  'owner.transfer': 'Pasó el rol de dueño',
  'owner.transfer.denied': 'Intentó pasar el rol de dueño con una passkey ajena',
```

En `index.css`:

```css
/* Gestionar roles → Dueño del gimnasio, y el cartel para confirmarlo */
.owner-section{margin-top:16px}
.owner-section .sec{margin:0 2px 4px}
.owner-section p{margin:0 2px 8px}
.owner-row{border:1px solid color-mix(in srgb,var(--orange) 40%,transparent);border-radius:12px}
.owner-crown{font-size:18px;width:22px;text-align:center}
.owner-transfer{display:flex;flex-direction:column;gap:8px;text-align:center}
.owner-transfer-icon{font-size:30px}
.owner-transfer h3{margin:0}
.owner-transfer-list{text-align:left;margin:4px 0 6px;padding-left:18px;color:var(--label-2);display:flex;flex-direction:column;gap:4px}
```

- [ ] **Step 4:** `cd frontend && npx vitest run src/views/admin/Roles.test.jsx src/lib/errors.test.js src/lib/audit.test.js`. Esperado: PASS. `audit.test.js` y `errors.test.js` cruzan con el backend y piden texto para `owner.transfer`, `owner.transfer.denied` y los códigos nuevos.

- [ ] **Step 5: Commit.**

```bash
git add frontend/src/views/admin/roles-common.jsx frontend/src/views/admin/Roles.test.jsx frontend/src/lib/errors.js frontend/src/lib/audit.js frontend/src/index.css
git commit -m "feat(owner): pass the owner role from Gestionar roles with a passkey"
```

---

### Task 4: Verificación

- [ ] **Suites:**
  - `cd api && npm test`: PASS (si alguna corrida se cuelga en `checkin.http.test.js`, cortarla y correr ese archivo solo);
  - `cd frontend && npm test && npm run build && node scripts/check-locales.mjs`: PASS.
- [ ] **Vista en el navegador:** con una página temporal que monte `RolePickSheet` y el cartel sin login, verlos en PC (1280) y celular (375), con tema claro y oscuro. Borrar la página antes del commit.
- [ ] **Documentar el interruptor:** `OWNER_TRANSFER_ENABLED` en `.env.example`, si existe (`ls .env.example api/.env.example 2>/dev/null`), comentado como prendido por defecto.
- [ ] **Commit de ajustes**, si hubo. No subir ni mergear sin que el usuario lo pida.
