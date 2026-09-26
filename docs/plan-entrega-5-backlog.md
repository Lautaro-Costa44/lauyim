# Entrega 5 — Backlog chico

Rama: `claude/entrega-5-backlog` (desde `main`).

> Nota: este archivo se escribió al cerrar la entrega; la auditoría se hizo punto por punto antes
> de cada commit y queda resumida acá.

## 1. Bloqueo por cuota y resumen de Cuotas sin `DEMO_ADMIN_ALL_USERS`

- Auditoría: `isAdmin()` (`api/server.js`) devuelve `true` para todos con
  `DEMO_ADMIN_ALL_USERS=1`. Lo usaban `isMembershipBlocked`, `/api/me` (`billing.blocked`),
  `enable-preview`, el resumen de `/api/admin/billing` (excluye `admin`) y el audit de bloqueo.
  El frontend además eximía con `user.admin` (store y `App.jsx`).
- Hecho: `isRealStaff()` (admin en la base, `ADMIN_UIDS` u owner) en esos lugares. `/api/me` suma
  `user.staff`; el frontend usa `billingExempt(user)` = `staff ?? admin` (una sesión vieja sin el
  dato se comporta como antes). El acceso al panel sigue con `isAdmin()` (la demo lo necesita).
- Tests: `api/demo-billing.http.test.js`, `frontend/src/store/billing-exempt.test.js`.

## 2. `hasPush` con suscripciones bloqueadas

- Auditoría: `/api/admin/users` contaba cualquier fila de `subscriptions`; las que no pasan
  `pushEndpointError` (allowlist) no se borran a propósito, así que figuraban como push activo.
- Hecho: `hasPush` = alguna suscripción que pasa `pushEndpointError`.
- Test: `api/push-subscribe.http.test.js`.

## 3. zxing fuera del bundle del admin

- Auditoría (build): `QrCanvas.jsx` importaba `html5-qrcode/third_party/zxing-js.umd.js` estático;
  el bundler lo dejó dentro del chunk de **Nutrición** (~410 KB) y `QrCanvas` importaba ese chunk,
  así que abrir Acceso o una ficha bajaba Nutrición entera.
- Hecho: import dinámico en `QrCanvas` (se baja al dibujar un QR) y un grupo `advancedChunks`
  en `vite.config.js` que lo deja en su propio chunk `zxing` (~287 KB). Nutrición bajó a ~126 KB.
  Sin librerías nuevas.
- Test: `frontend/src/components/QrCanvas.test.jsx`.

## 4. Exportar socios a CSV

- Hecho: `GET /api/owner/members/export` (solo owner) arma el CSV en el servidor
  (`api/member-export.js`): BOM, `;`, fórmulas neutralizadas (`= + - @` tab/CR con `'`), sin
  staff, con plan/vence/estado si cuotas está encendido. Audit `owner.member.export` solo con el
  conteo. Botón "Exportar socios" en Usuarios (owner).
- Tests: `api/member-export.test.js`, `api/import.http.test.js`, `Members.test.jsx`.

## Decisiones propias / PREGUNTAS

- **PREGUNTA:** el celular en formato `+54…` sale como `'+54…` (el `'` es la protección contra
  fórmulas; Excel no lo muestra, pero otros programas sí). ¿Preferís exportar el celular sin `+`?
- El export incluye socios desactivados (columna "Estado") y fichas sin app ("Usa la app").
- `DEMO_ADMIN_ALL_USERS`: en la demo el staff sigue viendo el panel; ahora, además, los socios
  demo se bloquean por cuota como en un gym real.
