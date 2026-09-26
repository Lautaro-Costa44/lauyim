# Entrega 2 — Aviso de privacidad

Rama: `claude/entrega-2-privacidad` (desde `main`).

## Auditoría

- No existe página de privacidad. Solo hay una nota corta en el alta/edición de ficha
  (`MemberSheets.jsx`, `PRIVACY_NOTE`: "Estos datos se usan solo para identificar al socio…").
- El frontend decide todo en `App.jsx` (`Shell`): sin sesión renderiza `<Login />` para cualquier
  ruta; con la licencia vencida, `<LicenseExpired />`; bloqueado por cuota, `<MembershipBlocked />`.
  Una ruta pública tiene que resolverse **antes** de esos tres.
- El backend corta toda `/api/*` con la licencia vencida salvo `/api/health` y `/api/support`
  (`server.js`, antes del dispatcher).
- `admin_settings` (clave/valor) ya guarda la config global; `getAdminSetting/setAdminSetting`.
- Config de campos de la ficha: `member_fields` (`api/members.js`), cambia qué datos se piden.
- Otros datos que guarda la app: cuenta + passkey (clave pública), `member_profile`, cuotas
  (`plans`, `member_billing`, `payments`, `member_trials`), estado de entrenamiento (incluye
  lesiones y nutrición = datos de salud), suscripciones push, `audit.log` (retención `AUDIT_DAYS`,
  default 90; IP según `AUDIT_IP`), backups (7 días).

## Plan

1. **API** (`api/privacy.js` + `server.js`):
   - `GET /api/privacy` público: `gymName`, `contact`, `fields` pedidos, `billingEnabled`,
     `auditDays`. Exento del corte por licencia vencida.
   - `GET/PUT /api/owner/privacy` (solo owner): `privacy_gym_name` (≤80), `privacy_contact` (≤200)
     en `admin_settings`, texto plano sin caracteres de control, audit `owner.privacy.settings`.
2. **Frontend**:
   - `components/PrivacyNotice.jsx`: el texto (responsable, encargado, datos según config,
     finalidad, quién accede, conservación, derechos con plazos de la Ley 25.326, leyendas
     obligatorias de la AAIP — Disp. 10/2008 —, contacto), banner "Borrador para revisión legal",
     `usePrivacyStep()` (paso interno de sheet, mismo contrato que `usePickerStep`) y `PrivacyLink`.
   - `views/Privacy.jsx` (lazy) en `/#/privacidad`, resuelto antes de login/licencia/bloqueo, sin
     TabBar, con "Volver".
   - Links: Login (pie), registro (paso interno), Settings (fila en Cuenta), alta de ficha (paso
     interno, junto a la nota existente) e importación (paso 1, paso interno).
   - Acceso (owner): card "Aviso de privacidad" con nombre del gym + contacto y "Ver aviso".
3. Tests: `api/privacy.http.test.js`, `views/Privacy.test.jsx`, `AdminRoutes.test.jsx`.

Sin librerías nuevas.

## Decisiones propias / PREGUNTAS

- **PREGUNTA (legal):** el texto es un borrador y así lo dice la página. Puntos a revisar con un
  abogado: lesiones/nutrición como datos sensibles (art. 7) y si alcanza el consentimiento en la
  app; conservación de pagos "por obligaciones legales"; transferencia internacional (Google
  Drive, servicios de push de Google/Apple/Mozilla/Microsoft, Cloudflare); inscripción de la base
  en el Registro Nacional de Bases de Datos de la AAIP (la hace el gym como responsable).
- **PREGUNTA:** ¿lauyim quiere figurar con razón social/CUIT como encargado? Hoy dice "lauyim"
  a secas.
- La rotación de backups (7 días) no la conoce la API (es del cron del host): el texto dice
  "a los pocos días (7 por defecto)".
- El aviso es público por diseño (hay que poder leerlo antes de registrarse); expone solo el
  nombre del gym, el contacto y qué campos se piden, que el aviso tiene que decir de todos modos.
- El check "Acepto" en el registro va en la entrega 3 (registro con datos).

## Ronda 2 (decisiones de Lautaro, 26/09/2026)

- **Datos de salud:** peso corporal, edad, género, altura, lesiones y nutrición se tratan como
  datos sensibles (art. 7) y requieren consentimiento expreso. El aviso ya lo dice; el check y el
  retiro del consentimiento van en la entrega 3.
- **Transferencia internacional:** sección propia en el aviso (backups en Drive, Cloudflare,
  servicios de push fuera del país).
- **Encargado:** `OPERATOR_NAME` y `OPERATOR_CUIT` (opcionales, en el `.env` de cada instancia y en
  `environment:` del compose). Con alguno cargado, el aviso dice "lauyim (Nombre, CUIT …)".

### Para la consulta legal
1. **Edad y género:** ¿son datos de salud (sensibles) o solo datos personales? Mientras tanto se
   tratan como sensibles (lo prudente).
2. **Consentimiento de salud:** ¿alcanza con el check en la app (registro / vinculación / Ajustes)
   como consentimiento expreso? ¿Hay que guardar la versión del texto aceptado?
3. **Transferencia internacional:** Drive (backups cifrados), Cloudflare (tránsito) y servicios de
   push de Google/Apple/Mozilla/Microsoft. ¿Alcanza con informarla o hace falta algo más?
4. **Figura de lauyim:** monotributista con CUIT como encargado del tratamiento. ¿Hace falta un
   contrato de encargo con cada gym (art. 25)?
5. Conservación de pagos por obligaciones contables e inscripción de la base en la AAIP (la hace
   el gym como responsable).
