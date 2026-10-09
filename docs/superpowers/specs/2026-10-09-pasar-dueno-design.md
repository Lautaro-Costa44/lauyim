# Pasar el rol de dueño

Fecha: 2026-10-09 · Rama: `feat/pasar-dueno` · Ítem 3 de la lista de mejoras

## Por qué

El dueño (owner) de una instancia es **la primera cuenta que se registra** (`isFirstUser`, `api/database.js`). Hay un solo dueño (índice único `idx_users_single_owner`) y no hay forma de cambiarlo salvo tocando la base a mano.

El dueño es el único que puede:
- usar las rutas `/api/owner/*`: personalización, privacidad, aprobación, campos de la ficha, importar y exportar socios, roles, borrar usuarios, encender cuotas, check-in y clases, QR, limpiar el registro;
- no pagar cuota, y no se le puede quitar el rol ni borrarlo.

Casos reales:
- el operador arma la instancia, se registra primero para probarla y queda como dueño de un gimnasio ajeno;
- el gimnasio cambia de dueño;
- el dueño quiere dejar la gestión a otra persona.

## Qué se construye

### Quién puede recibirlo

Cualquier cuenta que cumpla todo esto:
- existe y no es el dueño actual;
- no está desactivada ni pendiente de aprobación (`isInactiveAccount`);
- tiene al menos una passkey: usa la app. Una ficha sin app no puede ser dueña.

### Qué cambia

En **una sola transacción**, en este orden (por el índice único):
1. El dueño actual pasa a **Administrador**: `owner = 0`, `admin = 1`, `role_id = 'admin'`. Como cualquier rol, el dueño nuevo se lo puede cambiar o quitar después. Si el rol Administrador es exento de cuota (Roles), el ex dueño sigue sin pagar.
2. La persona elegida pasa a **dueña**: `owner = 1`, `admin = 1`, `role_id = NULL`. El dueño no lleva rol porque tiene todos los permisos; si tenía uno (por ejemplo Profesor/a), se le quita.

Queda registrado en la auditoría como `owner.transfer`, con el dueño anterior y el nuevo. **No se manda push.**

### Seguridad

- Solo el dueño puede iniciar el cambio (`requireOwner`).
- Pide **una passkey del dueño en el momento**:
  - `allowCredentials` lleva solo las credenciales del dueño;
  - `userVerification: 'required'` y `requireUserVerification: true`: huella, cara o PIN siempre;
  - la credencial que firma tiene que ser del dueño (`cred.user_id === owner.id`).
- El desafío dura 5 minutos (`putChallenge`), es de un solo uso (`takeChallenge`) y queda atado al dueño y a la persona elegida. Si al verificar la sesión es de otro, o la persona elegida es otra, se rechaza.
- Al verificar se vuelve a comprobar que la persona elegida pueda recibirlo, por si cambió en el medio.
- La verificación **no crea sesión nueva**: usa la del dueño. Mismo patrón que la salida de Ingreso Físico.

### Interruptor por instancia

`OWNER_TRANSFER_ENABLED` en el `.env`. Está **prendido por defecto** y se apaga con `0`, `false`, `no` u `off`, igual que `SURVEY_ENABLED`. Con el interruptor apagado, las rutas responden 403 `owner_transfer_disabled` y la opción no aparece. Va en `/api/config` como `owner_transfer_enabled`.

## Interfaz

Desde la ficha de la persona en Admin → Usuarios → **Gestionar roles** (`RolePickSheet`, `views/admin/roles-common.jsx`):
- Abajo de todo, separada por el título **"Dueño del gimnasio"**, la descripción: "Solo puede haber uno. Pide tu passkey y vos pasás a Administrador."
- Debajo, la opción **"👑 Pasarle el rol de dueño a {nombre}"**.
- Se muestra solo si:
  - quien mira es el dueño;
  - `owner_transfer_enabled` está prendido;
  - la persona puede recibirlo: `hasApp`, no `disabled`, no `pending` y no es dueña. Los datos salen de la ficha (`GET /api/admin/user`).

Al tocar la opción se abre un **cartel centrado** (`kind: 'center'`):
- **"¿Pasarle el rol de dueño a {nombre}?"**
- • {nombre} va a poder todo: cuotas, roles, personalización, borrar cuentas.
- • Vos pasás a Administrador. {nombre} te lo puede cambiar o quitar.
- • Para deshacerlo, {nombre} tiene que devolvértelo.
- Botón **"🔑 Confirmar con mi passkey"**, que llama a `options`, después a `passkeyAssertion` (`lib/api.js`, ya existe) y después a `verify`. Abajo, **Cancelar**.

Resultados:
- **Bien:** se cierran el cartel y la hoja, aparece el aviso "{nombre} ahora es dueño/a del gimnasio" y se ejecuta `verifySession()`. La app toma el rol nuevo: Administrador.
- **Passkey cancelada** (`NotAllowedError`): aviso "Se canceló la passkey" y nada cambia.
- **Error del servidor:** su texto (`errorText`).

El botón "Gestionar roles" hoy se oculta en la ficha del dueño (`!u.owner`). Eso no cambia.

## Datos y API

- `api/database.js`: `transferOwnership(fromId, toId)` en una transacción. Devuelve `true` si cambió, o tira un error si `fromId` ya no es el dueño.
- `api/server.js`:
  - `OWNER_TRANSFER_ENABLED` y `owner_transfer_enabled` en `/api/config`;
  - `ownerTransferBlocker(target)`, que devuelve `null` o un código: `not_found`, `already_owner`, `inactive` o `no_passkey`;
  - `POST /api/owner/transfer/options { userId }`, que devuelve `{ cid, options }`;
  - `POST /api/owner/transfer/verify { cid, credential }`, que devuelve `{ ok: true, owner: { id, name } }`.
- **Errores:** `owner_transfer_disabled` (403), `not_found` (404), `already_owner`, `inactive` y `no_passkey` (400), `challenge_expired` (400), `passkey_verify_failed` (400), `forbidden` (403). Los que el frontend no tenga traducidos se suman a `frontend/src/lib/errors.js`.

## Pruebas

- **API** (`api/owner-transfer.http.test.js`, con passkeys simuladas como `checkin.http.test.js`):
  - un no dueño recibe 403 en options;
  - destino no válido: ficha sin app, desactivado, pendiente, inexistente o el propio dueño;
  - desafío vencido, de otra persona o reusado;
  - una passkey que no es del dueño;
  - el cambio real: el dueño nuevo, el ex dueño como Administrador y el rol anterior del destino quitado;
  - el registro de actividad;
  - el interruptor apagado;
  - después del cambio, el ex dueño ya no puede usar `/api/owner/*` y el nuevo sí.
- **DB:** `transferOwnership` respeta el índice único y es todo o nada.
- **Frontend:**
  - la sección aparece solo en los casos válidos;
  - el flujo completo con la passkey simulada (`passkeyAssertion` mockeado): llama a options y verify y refresca la sesión;
  - cancelar la passkey no cambia nada.

## Fuera de alcance

- Que el destinatario tenga que aceptar.
- Push al destinatario.
- Cambiar el operador u OPERATOR_* (contrato): el contrato con el gimnasio es un tema legal aparte.
