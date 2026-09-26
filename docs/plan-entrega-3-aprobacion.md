# Entrega 3 — Aprobación de cuentas + registro con datos (spec 12.3 y 12.6)

Rama: `claude/entrega-3-aprobacion`, **desde `claude/entrega-2-privacidad`** (no desde `main`):
el registro con datos lleva el check "Acepto" del aviso de privacidad, que vive en la entrega 2.

## Auditoría

- Registro: `POST /api/register/options` (nombre + invite/QR) → challenge en memoria →
  `POST /api/register/verify` crea `users` + `credentials` (+ invite usado) en una transacción.
  No pide datos de ficha.
- Sesión: `readSession` descarta `users.disabled`. `/api/me` devuelve `user`, `billingEnabled`,
  `billing` (con `blocked`).
- Bloqueo por cuota: `isMembershipBlocked` + `MEMBERSHIP_GATED` en el dispatcher → `403
  membership_blocked`. Frontend: flag persistido (`gym_membership_blocked`), evento
  `gym:membership_blocked` desde `api.js`, `MembershipBlocked.jsx` con Reintentar
  (`retryMembership` → `/api/me`) y Cerrar sesión; el sync se corta sin backoff.
- Fichas: `member_profile` + config de campos (`member_fields`, `validateMemberProfile`,
  `missingRequiredFields`), DNI único (`findMemberByDni`, índice parcial), `dniDuplicate()` →
  `409 dni_duplicado {userId,name,hasApp}`. Merge ficha → cuenta (`MergeSheet`, `mergeMember`).
- Alta con cuota inicial: `POST /api/admin/members` (`checkPayment`, `trialEndDate`,
  `createMember` con `insertPayment` / `beginTrial` en una transacción). Frontend `InitialFee`.
- `users` no tiene estado de aprobación ni marca de "ya se le pidió el formulario".

## Plan

### Datos
- `users.approval_status` (`'pending'` | NULL), `users.privacy_accepted_at` (ISO),
  `users.profile_prompted_at` (ISO). `ALTER TABLE … ADD COLUMN` en `try/catch` (convención).
- `admin_settings`: `approval_required` (`0`/`1`, default 0) y `approval_mode`
  (`approve` | `payment` | `trial`, default `approve`).

### API
- `GET /api/admin/approval` (admins) y `PUT /api/owner/approval` (owner, audit
  `owner.approval.settings`). `payment`/`trial` → 409 con cuotas apagado; `trial` → 409 sin DNI.
- `/api/config` suma `registration: { approval, fields }` (lo lee el registro sin sesión).
- Registro:
  - **Con aprobación:** solo nombre + passkey; la cuenta nace `approval_status='pending'`.
  - **Sin aprobación:** si hay campos pedidos, `register/options` exige el perfil (obligatorios
    según config) y `privacyAccepted: true`; DNI existente → `409 dni_exists` ("Ya hay un socio con
    este DNI. Pedí en recepción tu código de vinculación"), nunca vincula. `register/verify`
    guarda perfil + `privacy_accepted_at` en la misma transacción (índice único → mismo 409).
- Pendiente = mismo mecanismo que el bloqueo por cuota con otro motivo: `403 account_pending` en
  las rutas de `MEMBERSHIP_GATED`; `/api/me` suma `pending: true`. Staff nunca queda pendiente.
- `POST /api/admin/users/:id/approve` (admins): perfil completo según la config + `start`
  (`none` | `payment` | `trial`) según el modo, en **una transacción** (perfil, pago o prueba,
  `approval_status = NULL`). DNI de otro → `409 dni_duplicado` (el front ofrece vincular con la
  ficha: merge existente). `dry_run` para la vista previa del vencimiento. Audit
  `admin.member.approve` (+ `admin.billing.payment` / `admin.billing.trial_start`).
- `POST /api/admin/users/:id/reject` (admins): desactiva (`disabled = 1`) y deja el motivo en
  Logs (`admin.member.reject`). Solo cuentas pendientes.
- Socios existentes sin datos: `/api/me` suma `profilePrompt: { fields }` una sola vez (aprobación
  apagada, no staff, no pendiente, algún campo pedido, sin datos cargados, sin
  `profile_prompted_at`). `POST /api/me/profile` guarda (con "Acepto") o `{ skip: true }`; las dos
  marcan `profile_prompted_at`. Después, el DNI solo lo edita el staff (409 `profile_locked`).
- `GET /api/admin/users` y `GET /api/admin/user` suman `pending`.

### Frontend
- Store: flag `accountPending` persistido (igual que el de cuota), evento `gym:account_pending`,
  el sync se corta igual. `MembershipBlocked` con variante "Tu cuenta está pendiente, acercate a
  recepción" (Reintentar / Cerrar sesión).
- Registro (`Login.jsx`): con campos pedidos y sin aprobación, formulario con los campos, check
  "Acepto el aviso de privacidad" (abre el aviso como paso interno) y el error de DNI existente.
- `ProfileOnce` (pantalla completa, una sola vez): mismo formulario + "Acepto" + "Ahora no".
- Acceso (owner): card "Aprobación de cuentas" con el interruptor y el modo (Aprobar / Registrar
  primer pago / Iniciar prueba), deshabilitando los que no aplican con el motivo.
- Usuarios: chip "Pendientes (N)" y badge "Pendiente". Resumen: tile "Pendientes" (link a
  Usuarios filtrado) cuando hay alguno.
- UserDetail de una cuenta pendiente: card con "Revisar y habilitar" y "Rechazar" (motivo).
  `ApproveSheet` (pasos internos): datos (config de campos, DNI duplicado → Vincular con la
  ficha) → confirmación según el modo (reusa `InitialFee` con las opciones permitidas).

## Decisiones propias / PREGUNTAS

- **PREGUNTA:** al **apagar** la aprobación, las cuentas que ya estaban pendientes **siguen
  pendientes** (hay que aprobarlas o rechazarlas). Lo conservador es no habilitar a nadie solo.
- **PREGUNTA:** en los modos "Registrar primer pago" / "Iniciar prueba", si la cuenta ya tiene un
  plan vigente o una prueba en curso (típico después de vincularla con su ficha), se permite
  "Solo aprobar". Si no, quedaría obligada a pagar dos veces.
- **PREGUNTA:** en modo "Aprobar" se ofrecen igual "Registrar pago" e "Iniciar prueba" como
  opcionales (la spec dice "con plan opcional si cuotas está activo").
- **PREGUNTA:** "Rechazar" desactiva la cuenta y la deja fuera de Pendientes. Si se vuelve a
  activar desde UserDetail, vuelve a Pendientes (no queda habilitada sola).
- **PREGUNTA:** el formulario de "socios existentes sin datos" tiene "Ahora no" (no bloquea el
  uso de la app) y se muestra una sola vez aunque lo salteen. Si hay obligatorios, el staff los
  ve como "Datos incompletos".
- Chequear el DNI en `register/options` (sin sesión) permite saber si un DNI está cargado en el
  gym. Lo pide la spec; queda limitado por el rate limit de registro (30/IP) y el mensaje no dice
  a quién pertenece.
- Con cuotas apagado, el modo guardado se conserva pero se aplica como "Aprobar".
