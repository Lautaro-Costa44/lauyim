# lauyim — Registro de cambios: admin, Cuotas, Fichas, Importación y Rutinas

Período: 24/09/2026 – 25/09/2026. Todo se implementó con Codex, se probó en `lauyim-dev` y se commiteó por entrega salvo que diga lo contrario.

---

## Dónde estamos

**Terminado:** la entrega de presets (sección 14) y sus ajustes, commiteados por separado.

**Después:**
1. **Backup cifrado** (rclone `crypt`) + **aviso de privacidad**. Es obligatorio antes de importar datos reales de un gym en producción.
2. **Aprobación de cuentas + registro con datos + paso de notificaciones** (diagrama de Lautaro, spec 12.3 y 12.6).
3. **Avisos por WhatsApp** (links `wa.me`).
4. **Backlog** (al final).

---

## 1. Spec del módulo de Cuotas

Decisiones de Lautaro:
- **Resumen** es la sección inicial del admin.
- **Días:** 5 para "por vencer", 3 para el push y 5 de tolerancia (configurable, global).
- **Deuda:** un período por socio, porque un socio nunca acumula dos meses.
- **Pagos:** siempre en recepción, en pesos enteros.
- **Staff:** entrenadores y nutricionistas son admins.
- **Pago dentro de la tolerancia:** el socio conserva su fecha de vencimiento. Si paga ya bloqueado, el vencimiento es hoy + duración.
- **Cartel:** "Tu cuota está vencida, renovala en recepción para poder seguir usando la app".

## 2. Paso 1 — Admin en secciones

- `Admin.jsx`, un único archivo de 1239 líneas, se partió en `AdminLayout` + una sección por archivo (lazy): Resumen, Usuarios, Cuotas, Rutinas, Notificaciones, QR (hoy Acceso) y Logs.
- **Rutas:** `/#/admin/<sección>` dentro del `HashRouter`, sin cambios en Nginx ni en el Service Worker. `#app` no se remonta al cambiar de sección.
- **Navegación:** menú lateral a partir de 1000 px y pestañas deslizables en celular. La TabBar se oculta en escritorio.
- Se arregló el bug de hooks de `Admin.jsx`.
- Test permanente de rutas: redirecciones, guard, QR solo owner, Logs oculto.

## 3. Pasos 2 y 3 — Escritorio y PWA

- **Contenedor del admin:** hasta ~1200 px. Usuarios usa panel lado a lado (lista + detalle), y Resumen y el resto de las secciones, grillas.
- **Manifest:** shortcut "Panel admin", `icon-192`, `orientation: portrait` (sin cambio) y `manifest.json?v=4`.
- Resumen se carga estático (sin parpadeo al entrar a `/admin`).

## 4. Paso 4a — Cuotas (backend)

- **Tablas:** `plans`, `member_billing` y `payments`. `payments` no tiene FK y guarda un snapshot del nombre, así se conserva al borrar un socio.
- **`api/billing.js`**, con funciones puras:
  - `gymToday`
  - `billingStatus` (sin plan / al día / por vencer / vencido / bloqueado)
  - `nextDueDate`
  - `debtTotal`
  - `shouldSendDuePush`
- **Endpoints admin:** planes, asignar plan con vencimiento, registrar pago (en una transacción), historial, tablero y settings.
- **Bloqueo** en el dispatcher: `403 membership_blocked` sin tocar `readSession` ni `disabled`. Sesión, `/api/me` y push quedan abiertos. Los admins están exentos.
- **Scheduler:** aviso de vencimiento con dedupe por vencimiento. El recordatorio manual no sale si el socio tiene plan.
- **Config** en `admin_settings`, incluida `gym_tz` (default `America/Argentina/Buenos_Aires`).
- **Auditoría:** `admin.billing.*`.
- **CI:** se agregaron los tests de `api/`. Se unificó en **npm**: se borraron `pnpm-lock.yaml`/`pnpm-workspace.yaml` y el Dockerfile usa `npm ci --omit=dev`.

## 5. Paso 4b — Cuotas (frontend) + anular pago

- **Sección Cuotas:** tarjetas por estado y deuda total, buscador, filtros y staff oculto por defecto. Tabla en escritorio y cards en celular.
- **Ficha de cuota** del socio: registrar pago con vista previa (`dry_run`), asignar o quitar plan, historial, gestión de planes y configuración.
- **Anular último pago:** restaura el vencimiento y el plan anteriores. Solo el último y en orden inverso.
- **Socio bloqueado:** pantalla completa `MembershipBlocked` (flag persistido, funciona offline, con Reintentar y Cerrar sesión). El sync se corta sin backoff y nutrición encola en vez de descartar.
- **Settings:** con plan asignado, fila de solo lectura en vez del recordatorio manual.

## 6. Seguridad del push

- Un único helper de envío con `PUSH_AGENT` (protección SSRF), usado también por el scheduler.
- **Allowlist de hosts de push:** FCM, Mozilla, `*.notify.windows.com` y `*.push.apple.com`, ampliable con `PUSH_HOST_ALLOWLIST`. Solo `https` y puerto 443.
- Las suscripciones bloqueadas no se borran.

## 7. Fichas — Entrega 1: arreglos previos + IP real

**Arreglos:**
- **`users.sv`:** "Cerrar todas las sesiones" daba 500. Ahora cierra todas, incluida la actual.
- **`created_at`:** se normaliza a ISO.
- **Pairing:** el contador de intentos ahora funciona y `confirm` exige un `claim` previo.
- **Invitaciones:** se persisten `used_at`, `invited_by` y `note`.
- **Scheduler:** saltea a los socios sin suscripción, `SCHEDULER_DEBUG` para el log detallado y tick inicial a los 5 s.
- **`QrCanvas`:** pasó a ser un componente reutilizable.

**IP real (bug confirmado):** el `.env` tenía `CF_CONNECTING_IP` con un solo `$`, compose lo vaciaba y todos los socios compartían un único cupo de rate limit.
- **Nginx:** realip (`set_real_ip_from` 127.0.0.1 y 172.16.0.0/12, `real_ip_header CF-Connecting-IP`).
- **API:** `clientIpFrom` confía en los headers solo si el socket viene de loopback o de la red privada.
- **Rate limit** por IP con segunda clave según la ruta:

  | Ruta | Por IP | Clave adicional |
  |---|---|---|
  | `login/options` | 60 | — |
  | `login/verify` | 60 | 10 por credencial |
  | `register/*` | 30 | — |
  | `device/claim`, `device/confirm` | 60 | 10 por usuario |

- **Servidor:** se borró `CF_CONNECTING_IP` de los `.env`. En compose, `${WEB_BIND:-127.0.0.1}:${WEB_PORT}:80`. En cloudflared, el ingress apunta a `127.0.0.1`.

## 8. Fichas — Entrega 2 (backend)

- **`member_profile`:** `full_name`, `dni` / `dni_norm` (índice único parcial), `phone` / `phone_norm` (E.164 AR) y `email`.
- **Configuración de campos** (solo owner): para nombre y apellido, DNI, celular y mail, se elige si se piden y si son obligatorios.
- **Endpoints:**
  - alta de ficha (socio sin app)
  - lookup por DNI
  - perfil (409 si el DNI está duplicado)
  - `hasApp` / `hasProfile` en los listados, sin DNI
- **Código de vinculación:** `XXXX-XXXX`, guardado hasheado, vence a las 72 h, de un solo uso, se revoca al quinto fallo.
- **Vinculación pública:** `/api/link/options` y `/api/link/verify`.
- **Merge** ficha → cuenta, con `dry_run`, en una transacción y a cargo de cualquier admin. Resolución de conflictos:
  - **plan:** si la cuenta no tiene, gana la ficha; si los dos tienen, se elige;
  - **perfil:** se completan los vacíos;
  - **DNI distinto en los dos:** 409.
- **Auditoría** con el DNI enmascarado. Las fichas no cuentan en `totalUsers`.

## 9. Acceso + cuotas activable + horario de avisos

- **Sección "Acceso"** (reemplaza QR):
  - Invitaciones (admins)
  - QR (owner)
  - Datos del registro (owner, grilla de campos)
  - Cobro de cuotas (owner)
- **`billing_enabled`** (interruptor del owner). Apagado: sin bloqueo ni aviso de vencimiento, sin sección Cuotas ni card de cuota, escrituras con 409 y el recordatorio manual vuelve. Al encenderlo, `enable-preview` muestra cuántos quedarían bloqueados.
- **`billing_notify_hour`** (default 12:00, en la tz del gym) para el aviso de vencimiento y el recordatorio manual, configurable desde Notificaciones.
- Resumen cuenta solo usuarios con app.
- **Ajustes:** la pestaña activa se centra en celular y la card de campos pasó a grilla.

## 10. Fichas — Entrega 3 (frontend)

- **Alta** "Nuevo socio (sin app)" según la configuración de campos. Detecta el DNI duplicado y ofrece "Abrir".
- **Lista:** badge "Sin app", chips Todos / Con app / Sin app y búsqueda por DNI.
- **UserDetail:** card "Ficha" con edición. Para una ficha: generar código y vincular con una cuenta existente.
- **Código de vinculación:** QR, código grande, vencimiento, copiar, compartir y revocar.
- **Vincular:** selector de cuenta → vista previa → elección de plan si hay conflicto → confirmación.
- **Login:** "Tengo un código del gym" y `?link=CODE`. Crea la passkey sobre la ficha.

## 11. Prueba gratis + ajustes de fichas

- **DNI:** de 6 a 8 dígitos.
- **Selectores como paso interno** (`usePickerStep`): alta, ficha de cuota, configuración, "Objetivo", "Día planeado" y "Franja".
- **Prueba:**
  - Estados y límites: `trial_until`, `trial_used_at` y `trial_days` (default 1). Estado "En prueba" y bloqueo **sin tolerancia** al terminar. Una por DNI, y requiere DNI.
  - Al pagar, la prueba se cierra.
  - Anular ese pago restaura la prueba (`previous_trial_until`).
  - El cartel dice "Prueba terminada".
- **Alta con "Cuota inicial":** Registrar pago / Iniciar prueba / Solo ficha, en una sola transacción.
- **QR:** el sheet se cierra solo cuando el socio se vincula (consulta cada 3 s).

## 12. Paso 4.1 — Importar socios (Excel / CSV)

- Solo el owner. Se usa `read-excel-file` (lazy) y el parser de CSV propio. **No** se usa el paquete `xlsx` de npm, que tiene vulnerabilidades sin parche.
- **Asistente:**
  1. Archivo, con la plantilla descargable (BOM, `;`).
  2. Columnas, con autodetección por sinónimos.
  3. Planes.
  4. Opciones: duplicados y método de pago.
  5. Vista previa (`dry_run`), con descarga de errores protegida contra fórmulas.
  6. Resultado.
- **Reglas:**
  - fechas dd/mm/aaaa, aaaa-mm-dd y número de serie de Excel, con corrección del corrimiento por UTC;
  - montos "$30.000";
  - duplicados por DNI: saltear o "completar vacíos";
  - pagos importados con `source = 'import'`, no anulables;
  - todo en una transacción con rollback;
  - socios con datos faltantes quedan como "Datos incompletos".
- **Historial:** `member_trials`, así la prueba aparece como "Prueba gratis · N días · fechas · quién", con $0.
- **Ajustes enviados** (verificar que estén aplicados):
  - la fila de ejemplo de la plantilla se marca y se ignora al importar;
  - el asistente es más ancho en escritorio, con formato de tabla;
  - el input del nombre del plan tiene el mismo estilo que el resto.

## 13. Rediseño de Rutinas

- **Backend:**
  - `preset_programs`, que agrupa los días en programas con id; migración automática.
  - `presets.position`, para el orden de los días.
  - `preset_exercises.extra`: intensificador, reps, calentamiento, nota, progresión y superset. Antes se perdían al guardar.
  - Endpoints para duplicar, reordenar, renombrar y ver el uso.
- **Admin:**
  - cards por programa en grilla de 3 columnas, con buscador y chips;
  - BodyMap chico con la cobertura semanal;
  - músculos principales y series por semana;
  - uso: cuántos lo tienen y cuántos como plan activo, contado desde el deploy;
  - drag para reordenar (también táctil y con teclado);
  - panel lateral de edición;
  - "Asignar a socio".
- Notificaciones y Acceso pasaron a grilla, con ancho de lectura de ~70 caracteres.
- **App del socio:** el grupo toma el nombre del programa y se registra de qué plantilla salió (`source`, para contar el uso).

## 14. Presets y rutinas del socio ✅

- **"Unknown exercise":** los ejercicios custom del admin se copian al socio por cualquier camino, con reparación de los que ya estaban.
- **Rutinas del socio:** `routine_exercises.extra` se sincroniza.
  - **Bug encontrado:** `api/sync.js` no resolvía por id los arrays anidados, así que editar un ejercicio existente perdía el dato.
  - **Arreglo:** el path se recorre completo, y hay un test con dos dispositivos reales.
- **Primer ingreso:** el socio **elige** el programa, y "Load starter plan" abre el mismo selector.
- **Cartel de bienvenida:** flag persistente en el servidor, con backfill. No vuelve aunque se borren todas las rutinas.
- Se eliminó la duración estimada en todos lados.
- **Ajustes previos al commit:**
  - socio nuevo sin `user_state` puede crear su primera rutina por sync sin conflicto;
  - "Cargar un plan" se oculta si no hay programas visibles;
  - timeouts de `ImportMembers.test.jsx` corregidos;
  - commits separados por punto.
- **"Visible para socios" por programa:** los nuevos y los duplicados arrancan ocultos. Un programa oculto no aparece en Inicio, Configuración ni Plan, y aplicarlo desde el socio da 403. El admin puede asignarlo igual.

---

## Backlog

- **Aprobación de cuentas:**
  - modos manual / primer pago / prueba, con los datos en el registro según el diagrama;
  - "Pendientes" en Usuarios;
  - socios existentes sin datos: formulario una sola vez.
- **Paso de notificaciones** en el primer ingreso, con instrucciones para instalar la app en iOS.
- **Exportar socios** a CSV (solo owner, con auditoría).
- **Bloqueo por cuota que ignore `DEMO_ADMIN_ALL_USERS`**, para poder mostrar cuotas en la demo.
- **Rendimiento de `/api/admin/users`**, que hoy hace `readState` por socio cada 15 s.
- **Heatmap** con zonas horarias mezcladas; helpers de fecha sin uso.
- **`zxing`** se carga en el admin sin necesidad.
- **`hasPush`** figura verdadero con suscripciones bloqueadas por la allowlist.
- **Programas:** reordenarlos (borrar programa está en el working tree, pendiente de commit separado).
- **Datos opcionales:** contacto de emergencia (el apto físico es un dato de salud y requiere consulta legal).

## Recordatorios de operación

- **Antes de cada deploy:** backup según el runbook. `.env` y `docker-compose.yml` no están en git: los cambios se hacen a mano en `~/hub/lauyim` y `~/hub/lauyim-dev`.
- **Variables nuevas del `.env`:** hay que agregarlas en `environment:` del compose. Verificar con `docker exec <contenedor> printenv VAR`.
- **`sqlite3` en el contenedor:** se pierde al recrearlo. Se instala con `apk add sqlite`.
- **cloudflared:** `sudo cloudflared tunnel --config /etc/cloudflared/config.yml ingress validate` (el flag va antes de `ingress`).
- **Antes de cargar DNIs reales:** backup cifrado + aviso de privacidad.
