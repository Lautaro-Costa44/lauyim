# Resumen de Claude Code — entregas 0 a 5

Fecha: 26/09/2026. Nada se mergeó a `main`, no se deployó y no se tocó `.env`,
`docker-compose.yml` ni el servidor. Cada entrega tiene su `docs/plan-<entrega>.md` con la
auditoría, el plan y sus PREGUNTAS.

## Ramas

| Rama | Base | Qué tiene |
|---|---|---|
| `claude/entrega-0-verificacion-import` | `main` | Verificación (solo docs) |
| `claude/entrega-1-backup` | `main` | Backup cifrado + restore + runbook |
| `claude/entrega-2-privacidad` | `main` | Aviso de privacidad |
| `claude/entrega-3-aprobacion` | **`claude/entrega-2-privacidad`** | Aprobación de cuentas + registro con datos |
| `claude/entrega-4-notificaciones` | `main` | Paso de notificaciones |
| `claude/entrega-5-backlog` | `main` | Backlog chico |
| `claude/lauyim-gym-management-e40ilu` | `main` | **Integración de prueba**: `main` + todas las entregas mergeadas, con los conflictos resueltos |

- La entrega 3 sale de la 2 (y no de `main`) porque el registro con datos lleva el check "Acepto
  el aviso de privacidad", que vive en la 2. Mergear la 3 trae la 2.
- Entre las ramas hay conflictos previstos (`App.jsx`, `index.css`, `useStore.js`, `server.js`,
  `Usuarios.jsx`, `audit.test.js`). En la rama de integración están resueltos, y además tiene dos
  ajustes que solo tienen sentido con las entregas 3 y 5 juntas: la cuenta pendiente usa el "staff
  de verdad" (`isRealStaff` / `billingExempt`) y el export de socios marca "Pendiente" en Estado.
  **Recomendación:** mergear en este orden: 0, 1, 3 (trae la 2), 4, 5, copiando la resolución de
  la rama de integración; o revisar y mergear directamente la rama de integración.

## Commits

**Entrega 0**
- `db55406` docs: traspaso de la spec y verificación de la entrega 0 (importación)

**Entrega 1**
- `a6d9b94` feat(backup): paquete por instancia a un remote crypt de rclone + restore.sh
- `804e85f` docs(backup): runbook de rclone crypt, restauración de prueba y de producción

**Entrega 2**
- `741de17` feat(privacidad): endpoint público del aviso y datos del responsable (owner)
- `6d4dbf7` feat(privacidad): página pública /#/privacidad con el aviso (borrador legal)
- `c2088c0` feat(privacidad): links desde login, registro, Settings, alta e importación; card en Acceso

**Entrega 3**
- `ebf037f` feat(aprobacion): cuentas pendientes, registro con datos y formulario de una sola vez (API)
- `e92879b` fix(aprobacion): el dry_run de approve devuelve las opciones permitidas
- `8e677c0` feat(aprobacion): registro con datos, pantalla de cuenta pendiente y formulario de una sola vez
- `30ec879` feat(aprobacion): Pendientes en el admin, habilitar según el modo y rechazar
- `c439e01` fix(aprobacion): los datos de invitado se suben cuando habilitan la cuenta

**Entrega 4**
- `060757a` feat(notificaciones): qué ofrecer en el primer ingreso (push o instalar en iOS)
- `8d758d6` feat(notificaciones): paso de notificaciones antes del tour y la encuesta

**Entrega 5**
- `0a97296` fix(cuotas): el bloqueo y el resumen ignoran DEMO_ADMIN_ALL_USERS
- `8e96211` fix(push): hasPush falso si todas las suscripciones están bloqueadas por la allowlist
- `d9a122c` perf(admin): zxing en un chunk propio y cargado recién al dibujar un QR
- `833a1b0` feat(socios): exportar socios a CSV (solo owner)
- `175bdb4` docs: plan y resumen de la entrega 5

## Qué se hizo

- **0. Importación:** los tres ajustes ya estaban en `main` (fila EJEMPLO ignorada con aviso,
  asistente de 960 px con tablas, input del nombre del plan con estilo). Solo se documentó.
- **1. Backup:** `scripts/backup.sh` reescrito: `BACKUP_REMOTE` obligatorio y de tipo `crypt`; un
  `.tar.gz` por instancia con `gym.db` (VACUUM INTO + `integrity_check`), `vapid.json`, `secret`,
  `audit.log` y `MANIFEST.sha256`; rotación por instancia solo después de una subida buena; códigos
  1/2/3 con mensaje claro; `--check`. `scripts/restore.sh` (lista, baja, verifica sha256 +
  integridad y restaura en `./restore-test-data`; nunca en los datos de una instancia en uso).
  `docs/backup-restore.md` con el paso a paso de rclone crypt, el cron, la restauración de prueba
  con `docker-compose.restore-test.yml` y la de producción. Test con stubs:
  `scripts/tests/backup-restore.test.sh` (11/11).
- **2. Privacidad:** página pública `/#/privacidad` (sin sesión, también con la licencia vencida o
  la cuenta bloqueada) con responsable, encargado, datos según la config real, finalidad, quién
  accede, conservación, derechos (Ley 25.326, leyendas de la AAIP) y contacto, marcada como
  **borrador para revisión legal**. El owner carga nombre del gym y contacto en Acceso. Links desde
  login, registro, Settings, alta de ficha e importación (en los sheets, como paso interno).
- **3. Aprobación + registro con datos:** interruptor y modo (Aprobar / Primer pago / Prueba) en
  Acceso. Con aprobación: registro con usuario + passkey y pantalla "Tu cuenta está pendiente,
  acercate a recepción" con Reintentar (mismo mecanismo que el bloqueo por cuota). "Pendientes" en
  Usuarios con contador en Resumen; "Revisar y habilitar" (datos → DNI de una ficha ofrece
  Vincular → confirmación según el modo, todo en una transacción) y "Rechazar" con motivo en Logs.
  Sin aprobación: el registro pide los campos configurados + "Acepto el aviso"; DNI existente →
  "Ya hay un socio con este DNI. Pedí en recepción tu código de vinculación". Socios existentes sin
  datos: formulario una sola vez (con "Ahora no"). Settings usa el mismo registro que el login.
- **4. Notificaciones:** paso en el primer ingreso (antes del tour y la encuesta) con "Activar" /
  "Ahora no"; en iOS sin instalar, instrucciones para agregar a inicio. Nunca obligatorio, una vez
  por dispositivo.
- **5. Backlog:** bloqueo y resumen de Cuotas con el staff real (no `DEMO_ADMIN_ALL_USERS`);
  `hasPush` ignora suscripciones bloqueadas; zxing en su propio chunk y cargado al dibujar un QR
  (el admin ya no baja el chunk de Nutrición); exportar socios a CSV (owner, BOM, `;`, fórmulas
  neutralizadas, audit con el conteo).

## Tests

Suite completa al final de cada entrega y en la integración:

- frontend: 820/820 en la integración (65–68 archivos según la rama), `npm run build` y
  `check-locales` OK.
- api: 245 pasan en la integración; **2 fallan en este contenedor y no por el código**:
  `push-send.test.js` ("PUSH_AGENT solo no frena una IP literal" y "hostname que resuelve a
  loopback") fallan con `listen EAFNOSUPPORT ::` porque el contenedor no tiene IPv6. Fallaban igual
  en `main` antes de tocar nada; en CI (ubuntu-latest) deberían pasar.

## Decisiones propias

- Una rama por entrega salvo la 3 (necesita la 2). Rama designada de la sesión = integración.
- Backup: se niega a subir a un remote que no sea `crypt` (salida: `BACKUP_ALLOW_UNENCRYPTED=1`);
  la ruta remota pasa a `<remote>/<instancia>/`; los backups viejos sin cifrar no se tocan.
- Privacidad: endpoint público con solo lo que el aviso tiene que decir (nombre del gym, contacto,
  qué campos se piden); texto marcado como borrador.
- Aprobación: al apagarla, las pendientes siguen pendientes; en modos pago/prueba, una cuenta ya
  cubierta (plan vigente o prueba, p. ej. tras vincular su ficha) puede solo habilitarse; en modo
  Aprobar el pago y la prueba son opcionales; rechazar = desactivar (si se reactiva, vuelve a
  Pendientes); el formulario de una sola vez tiene "Ahora no". Evento de auditoría del socio:
  `auth.profile.self` (el test de Logs solo admite categorías auth/admin/owner).
- Notificaciones: marca por dispositivo; se ofrece también a staff.
- Export: incluye desactivados y fichas sin app; excluye staff.

## PREGUNTAS pendientes (detalle en cada plan)

1. **Backup:** ¿ok que falle sin crypt? El cron actual (`gdrive-backup:`, sin cifrar) va a fallar
   apenas copies el script nuevo, hasta configurar el crypt.
2. **Privacidad (legal):** datos de salud (lesiones/nutrición), conservación de pagos,
   transferencia internacional (Drive, servicios de push, Cloudflare), inscripción de la base en
   la AAIP. ¿lauyim figura con razón social/CUIT como encargado?
3. **Aprobación:** las 5 decisiones de arriba (pendientes al apagar, "cubierta", opcionales en
   Aprobar, rechazo, "Ahora no").
4. **Notificaciones:** ¿excluir a admins? En iOS, ¿volver a ofrecer el paso la primera vez que
   abre la app instalada?
5. **Export:** el celular `+54…` sale como `'+54…` por la protección de fórmulas. ¿Sin `+`?

## Ojo al deployar (cambios de comportamiento)

- **Registro:** con la aprobación apagada (default) y la config de campos por defecto (nombre,
  DNI y celular obligatorios), **todo registro nuevo va a pedir esos datos** y aceptar el aviso.
  Es lo que pide la spec, pero cambia el registro de las instancias actuales en cuanto se deploya.
- **Socios existentes sin ficha:** la próxima vez que entren van a ver una vez el formulario de
  datos (pueden tocar "Ahora no").
- Antes de encender la aprobación o cargar DNIs reales: backup cifrado andando (entrega 1) y el
  aviso completado en Acceso (entrega 2).

## Qué tenés que probar vos

### En el navegador (dev, con la rama de integración)

1. **Privacidad:** abrir `/#/privacidad` sin sesión y con sesión; completar nombre y contacto en
   Acceso y ver que aparecen; los links desde login, registro (paso interno y volver con lo
   escrito), Settings, Nuevo socio e Importar. Modo oscuro y celular.
2. **Registro sin aprobación:** campos según Acceso → Datos del registro, el check, un DNI que ya
   existe (mensaje de recepción), y el registro bueno (la ficha queda con los datos).
3. **Registro con aprobación:** encender en Acceso, registrarse con solo usuario → pantalla de
   pendiente → Reintentar. Del lado staff: contador en Resumen, chip Pendientes, "Revisar y
   habilitar" en cada modo (pago con vista previa del vencimiento; prueba con DNI; DNI de una ficha
   → Vincular → volver a habilitar), y "Rechazar" (motivo en Logs). En escritorio (panel lateral)
   y celular.
4. **Formulario de una sola vez:** con un socio viejo sin ficha: aparece al entrar, "Ahora no" y
   "Guardar", y que no vuelve.
5. **Notificaciones:** cuenta nueva en Android/Chrome (Activar → prompt nativo → push de prueba
   desde Settings), "Ahora no", y en un iPhone con Safari sin instalar (instrucciones).
6. **Demo (`DEMO_ADMIN_ALL_USERS=1`):** un socio con cuota vencida se bloquea; el staff real no;
   Cuotas muestra el resumen con socios.
7. **Admin:** en DevTools → Network, abrir Acceso y ver que `zxing-*.js` se baja recién cuando se
   dibuja un QR (y que ya no se baja `Nutricion-*.js`). Exportar socios y abrir el CSV en Excel
   (tildes, columnas, fórmulas neutralizadas).

### En el servidor

1. Configurar `gdrive-crypt:` según `docs/backup-restore.md` (contraseñas generadas en tu compu y
   guardadas en el gestor), copiar `scripts/backup.sh`, `--check`, una corrida a mano y actualizar
   el cron con `BACKUP_REMOTE=gdrive-crypt:lauyim`.
2. Restaurar el último paquete de prod con `scripts/restore.sh --instance prod` y levantar
   `docker-compose.restore-test.yml`; verificar `/api/health` y los conteos. Borrar
   `restore-test-data` al terminar.
3. Después del deploy: backup previo (runbook); las columnas nuevas de `users`
   (`approval_status`, `privacy_accepted_at`, `profile_prompted_at`) se agregan solas al arrancar
   (ALTER idempotente).
