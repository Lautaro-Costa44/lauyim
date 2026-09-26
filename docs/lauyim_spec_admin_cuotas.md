# lauyim — Especificación: rediseño del panel admin + módulo de Cuotas

> Documento de traspaso. Está escrito para que otro chat (u otra IA) pueda retomar el trabajo sin contexto previo. Estado: **plan aprobado, decisiones resueltas, auditoría del Paso 1 hecha (ver sección 11), Pasos 1–4 (Cuotas v1) implementados y probados; siguiente: roadmap de la sección 12**. Fecha: 24/09/2026.

---

## 0. Contexto mínimo del proyecto

**Qué es lauyim:** plataforma de seguimiento de entrenamiento para gimnasios, en formato SaaS marca blanca. Cada gimnasio tiene su propia instancia (contenedor Docker + base SQLite aislada), su subdominio (`<gym>.lauyim.online`) y su marca. Es un fork de openGym, licencia AGPL-3.0, repo público: https://github.com/Lautaro-Costa44/lauyim

**Stack real (auditado):**
- Frontend: React + Vite, PWA con Service Worker (precache atómico, estrategias separadas para API / assets / navegación)
- Backend: Node.js 22 (fijado en `.nvmrc` y Dockerfiles `node:22-alpine`) con `node:sqlite`
- Persistencia: SQLite (`data/gym.db`) en modo WAL, montado como `/data` en el contenedor de la API
- Auth: WebAuthn/Passkeys, sesiones firmadas, CSRF, rate limiting, límites de tamaño de request
- Roles: Owner + Admin (vía `ADMIN_UIDS`)
- Infra: Docker Compose, Nginx (sirve el frontend y hace proxy de `/api`), Cloudflare Tunnels
- Backups: `VACUUM INTO`, retención local y remota, scripts de backup/restore
- Push: Web Push / VAPID

**Forma de trabajo (obligatoria):**
- El código lo escribe **Codex**, que tiene acceso al repo. Claude planifica, arma los prompts y revisa.
- Siempre: **plan → aprobación de Lautaro → código**.
- Siempre: **auditoría del código actual antes de modificar**, y **mostrar el diff antes de commitear**. Nada de push sin revisión.
- Migraciones de SQLite: backup antes de migrar, migraciones idempotentes, seguir el runbook de deploy existente.
- Probar todo en la instancia **demo** (`demo.lauyim.online`) antes de ofrecerlo a un gimnasio.

---

## 1. Por qué se hace esto (motivación comercial)

- Se visitó un gimnasio (nombre no registrado todavía) que ya usa un sistema llamado **"Gestión Gym"**. El dueño pidió igual la propuesta de lauyim y preguntó si se podía incluir **gestión de cuotas** como la que tiene.
- Es la **segunda vez** que aparece un sistema de gestión ya instalado (Fitness Park también tenía uno). Conclusión: **la cobranza/gestión de cuotas es algo que los gimnasios ya pagan**. Sin eso, lauyim obliga al gym a pagar dos sistemas.
- El sistema de ese gym se usa en **notebook, instalado como app en ventana propia** (muy probablemente una PWA instalada desde Chrome/Edge). lauyim hoy **se ve "raro" en computadora**, no está pensado para pantalla grande.

### Qué tiene "Gestión Gym" (referencia de la competencia, por captura)
- Menú superior: Home, Panel Profesor, Videoteca, Cuotas, Registro, Reservas, Tienda, Gestión, Ajustes. Chat "Asistente del Profe".
- Pantalla "Gestión de Cuotas":
  - Tarjetas: **Vigentes** (112, cuotas al día), **Por vencer**, **Vencen en 5 días** (aviso puntual), **Vencidos** (requieren cobro), **Con deuda** (pagos incompletos), **Sin cuota** (47, sin plan asignado), **Deuda total** ($225.000, monto pendiente).
  - Acciones: Crear alumno, Crear plan, Ver descuentos, Crear descuento, Métodos de pago, Ver planes, Importar alumnos, Reportes, Avisos.
  - Tabla "Alumnos y cuotas" con buscador, filtro por plan y filtros por estado (Todos, Vigentes, Por vencer, Vencen en 5 días, Vencidos, Con deuda, Sin cuota, Inactivos). Columnas: alumno, plan, vence, estado, deuda, acción. 165 alumnos cargados.
- Si el alumno no pagó, **no puede ver sus entrenamientos**.

### Estado actual de lauyim en cuotas
- **Recordatorio de cuota:** existe, pero **lo habilita el propio socio**.
- **Bloqueo de acceso:** existe, pero **lo hace manualmente un admin**.
- No hay planes, pagos, vencimientos, estados, deuda ni tablero.

---

## 2. Plan aprobado y orden de ejecución

El orden importa: primero la estructura del admin, después el módulo nuevo adentro. Si se agrega Cuotas sobre el admin actual, después hay que moverlo.

| Paso | Qué | Resultado |
|---|---|---|
| 1 | Reestructurar el panel admin en secciones con navegación | Admin ordenado, cada módulo en su lugar |
| 2 | Vista de escritorio del admin | Se usa cómodo en notebook |
| 3 | Ajustes de instalación (manifest, accesos directos) | Se instala y abre como app en la notebook |
| 4 | Módulo de Cuotas v1 | Compite con la gestión de cuotas básica |
| 4.1 | Importar socios desde CSV/Excel | Permite migrar un gym con cientos de socios |

Cada paso se hace con este ciclo: **prompt de auditoría → reporte → prompt de implementación → diff → prueba en demo → commit**.

---

## 3. Paso 1 — Admin con secciones (pestañas)

**Problema:** el panel admin es una sola pantalla y con un módulo más se vuelve muy abultado.

**Secciones pedidas por Lautaro:**
- **Usuarios** (lista de socios, detalle de cada socio; ahí vive la edición manual de lesiones, rutinas y metas nutricionales por socio, feature que ya existe y está probada)
- **Cuotas** (nueva, se llena en el paso 4)
- **Rutinas** (rutinas preestablecidas / plantillas, organizadas por grupo y nivel; ya existe)
- **Notificaciones** (envío de push a los socios; ya existe)
- **QR** (acceso controlado por QR; ya existe)
- **Logs**

- **Resumen** (confirmada): pantalla inicial del admin, con lo que hoy está arriba del admin: usuarios, entrenando ahora, activos 7 días, desactivados y el gráfico de asistencia de las últimas 4 semanas.

**Navegación:**
- Notebook / pantallas anchas (sugerido ≥ 1024 px): **menú lateral fijo a la izquierda**.
- Celular: **pestañas deslizables horizontales arriba**.
- Cada sección con **ruta propia** dentro del `HashRouter` actual: `/#/admin/resumen`, `/#/admin/usuarios`, `/#/admin/cuotas`, `/#/admin/rutinas`, `/#/admin/notificaciones`, `/#/admin/qr`, `/#/admin/logs`. `/admin` y cualquier subruta inválida redirigen a `/admin/resumen`.
- **Se mantiene `HashRouter`** (decisión post-auditoría): Nginx y Service Worker no se tocan. Pasar a `BrowserRouter` exigiría cambiar `base: './'` de Vite y todas las rutas relativas.
- Reparto: **Resumen** (tiles, entrenando ahora, heatmap) · **Usuarios** (lista, detalle, sheet nutrición/rutina/lesiones, **invitaciones**) · **Cuotas** (placeholder "Próximamente") · **Rutinas** (presets) · **Notificaciones** (push) · **QR** (**solo owner**, pestaña oculta al resto) · **Logs** (oculta si `AUDIT_LOG=0`).
- `TabBar` de la app: oculta en admin en escritorio (el menú lateral tiene "Volver a la app"); visible en celular.
- El breakpoint de escritorio es el existente, `min-width: 1000px`.
- Idealmente cada sección se carga de forma diferida (lazy) para no agrandar más el bundle (hoy ~1,6 MB).
- Permisos: solo Owner/Admin, igual que el admin actual.

**Criterios de aceptación:**
- Todas las funciones actuales del admin siguen funcionando, solo cambian de lugar.
- Recargar en cualquier `/admin/<sección>` abre esa sección.
- En celular y en notebook la navegación es usable sin scroll horizontal del body.

---

## 4. Paso 2 — Vista de escritorio del admin

- Aprovechar el ancho: tarjetas de resumen en varias columnas, tablas anchas con columnas completas, formularios y listas lado a lado cuando tenga sentido.
- Contenedor principal con ancho máximo razonable para que no se estire en monitores muy grandes.
- Tablas anchas con scroll horizontal **dentro de su contenedor**, nunca de la página.
- **App del socio en escritorio:** no se rediseña (se usa desde el celular), pero se **centra con un ancho máximo** tipo celular/tablet para que no se vea estirada.

**Criterio de aceptación:** en una notebook de 1366×768 el admin se ve como una aplicación de escritorio prolija, sin zonas vacías enormes ni elementos estirados.

---

## 5. Paso 3 — Instalación como app en la notebook

- lauyim **ya es PWA**: en Chrome y Edge de escritorio aparece "Instalar" en la barra de direcciones y la app abre en ventana propia. **No hace falta construir una app de escritorio.**
- Revisar el `manifest`: nombre, íconos en todos los tamaños, `display: standalone`, `start_url`, colores de tema. **Cambiar `orientation: portrait` → `any`.**
- Agregar `shortcuts` en el manifest con un acceso directo **"Panel admin"** → `/admin`, para que el recepcionista lo abra directo desde el ícono.
- Documentar para la venta: funciona en **Chrome y Edge**; **Firefox de escritorio no instala PWAs**.

---

## 6. Paso 4 — Módulo de Cuotas v1

### 6.1 Alcance v1
1. **Planes:** crear, editar y desactivar planes con nombre, precio y duración en días (ej. "Mensual — $30.000 — 30 días").
2. **Asignar plan a un socio** y cambiarlo.
3. **Registrar pago** (manual, lo carga el staff): socio, plan, monto, fecha, método (efectivo / transferencia / otro) y nota opcional.
4. **Vencimiento por socio**, calculado a partir de los pagos.
5. **Estados automáticos** de cada socio.
6. **Tablero** con tarjetas resumen + tabla con buscador y filtros.
7. **Historial de pagos** de cada socio.
8. **Bloqueo automático** por vencimiento + tolerancia, y **desbloqueo automático** al pagar.
9. **Aviso push automático** al socio antes del vencimiento.

### 6.2 Fuera de alcance en v1
Pagos online (Mercado Pago), descuentos, reportes exportables, reservas, tienda, facturación. **Pagos parciales / estado "Con deuda" → v2.** Rol separado de entrenador/nutricionista (no existe: son admins).

### 6.3 Modelo de datos (propuesta — adaptar a las convenciones reales que muestre la auditoría)
- `plans`: `id`, `name`, `price` (entero, **pesos enteros**), `duration_days`, `active`, `created_at`, `updated_at`
- `member_billing` (1 fila por socio): `user_id` (PK/FK), `plan_id`, `due_date`, `updated_at`
- `payments`: `id`, `user_id`, `plan_id`, `amount`, `method` (`efectivo` | `transferencia` | `otro`), `paid_at`, `period_start`, `period_end`, `note`, `created_by` (uid del staff), `created_at`
- Montos siempre como **enteros en pesos** (nunca float, sin centavos). `payments.amount` igual.
- Configuración global en **`admin_settings`** (clave/valor, ya existe): `due_soon_days` (default 5), `push_days_before` (default 3), `grace_days` (default 5), `payment_methods`.
- Convención de migraciones (no hay versionado): tablas nuevas en `schema.sql` con `IF NOT EXISTS`; columnas nuevas como `ALTER TABLE … ADD COLUMN` en `try/catch` al inicio de `initDatabase()` en `database.js`.
- Migración idempotente, con backup previo, siguiendo el runbook.

### 6.4 Reglas de negocio
- **Registrar pago** (aprobado 24/09/2026):
  - **Primer pago / sin vencimiento previo:** `nuevo_vencimiento = hoy + duration_days`.
  - **Al día, por vencer o vencido dentro de la tolerancia** (`hoy <= vencimiento + grace_days`): `nuevo_vencimiento = vencimiento_actual + duration_days`. Mantiene su fecha: los días de tolerancia no se regalan ni corren el vencimiento.
  - **Bloqueado por vencimiento** (`hoy > vencimiento + grace_days`): `nuevo_vencimiento = hoy + duration_days`.
  - Guardar en `payments` el `period_start` (vencimiento anterior o hoy, según el caso) y el `period_end` (nuevo vencimiento).
- **Estados** (derivados, no guardados, o recalculados al leer):
  - **Sin plan:** no tiene plan asignado.
  - **Al día:** vence dentro de más de N días (N = `due_soon_days`, default 5).
  - **Por vencer:** vence dentro de N días o menos.
  - **Vencido:** la fecha de vencimiento ya pasó.
  - **Bloqueado:** vencido y pasaron además los días de tolerancia, o bloqueo manual.
- **Deuda total:** suma del precio de los planes adeudados = precio del plan de cada socio Vencido o Bloqueado por vencimiento (un período por socio).
- **Bloqueo:**
  - Automático cuando `hoy > vencimiento + tolerancia` (`grace_days`, **default 5, configurable, opción global** del gym).
  - Se desbloquea solo al registrar el pago.
  - **No reutiliza `users.disabled`:** un desactivado no tiene sesión y no vería el cartel. El bloqueo por cuota es un estado aparte: el socio conserva sesión y ve el cartel; el servidor rechaza los endpoints de entrenamiento/sync y permite los de sesión y estado de cuota.
  - El **bloqueo manual actual (`users.disabled`) se mantiene** como excepción y tiene prioridad (un socio bloqueado a mano no se desbloquea por pagar).
  - Lo que ve el socio bloqueado: igual que el bloqueo manual actual (no puede ver/usar los entrenamientos), con el cartel: **"Tu cuota está vencida, renovala en recepción para poder seguir usando la app"**.
  - Chequeo del lado del servidor (no solo en el frontend).
- **Aviso push:** `push_days_before` días antes del vencimiento (default 3, configurable), solo si el socio tiene notificaciones activadas. Se implementa como un bloque nuevo en `runSchedulerTick` (`api/scheduler.js`, tick cada 60 s), con columna propia `last_billing_push_*` para no mandar dos veces el mismo aviso por vencimiento. Los backups no sirven: son cron del host.
- **Recordatorio actual del socio** (`reminder_settings`, `checkGymFeeDue`): para socios **con plan asignado** el aviso automático lo reemplaza (no se envía el manual); socios sin plan lo siguen usando. `feeDueDate()` de `server.js` está sin usar: reutilizar o borrar.

### 6.5 Pantalla "Cuotas" (dentro del admin)
- **Tarjetas:** Al día, Por vencer, Vencidos, Bloqueados, Sin plan, Deuda total.
- **Acciones:** Nuevo plan, Ver planes, Registrar pago.
- **Tabla:** socio, plan, vence, estado, deuda, acción (Registrar pago / Ver historial / Asignar plan). Buscador por nombre y filtros por estado y por plan.
- **Ficha del socio:** plan actual, vencimiento, estado e historial de pagos.
- **Configuración** (dentro de la sección o en ajustes): días de aviso, días de tolerancia, métodos de pago habilitados.

### 6.6 Permisos
Solo Owner/Admin pueden ver y usar Cuotas. Entrenadores y nutricionistas **son admins** (no se crea rol nuevo), así que registran pagos igual que cualquier admin. Cada pago guarda quién lo registró (`created_by`). Registrar en Logs las acciones de cuotas (pago registrado, plan cambiado, bloqueo/desbloqueo).

### 6.7 Criterios de aceptación
- Crear un plan, asignarlo, registrar un pago y ver el vencimiento correcto.
- Cambiar la fecha del sistema (o datos de prueba) y ver pasar al socio por Al día → Por vencer → Vencido → Bloqueado.
- Registrar pago de un socio bloqueado por vencimiento lo desbloquea; uno bloqueado manualmente no.
- Socio que vence el día 1 y paga el día 4 (dentro de la tolerancia) queda con vencimiento día 1 + duración; uno que paga ya bloqueado queda con hoy + duración.
- El socio bloqueado no puede acceder a los entrenamientos aunque llame a la API directo.
- El aviso push se envía una sola vez por vencimiento.
- Backup previo y migración funcionan en la demo sin perder datos existentes.

---

## 7. Paso 4.1 — Importar socios (CSV/Excel)

No es necesario para construir v1, pero sí para **vender**: un gym con 165 alumnos no va a cargarlos a mano para cambiarse de sistema.
- Importar desde CSV (y Excel si es simple): nombre, contacto, plan, fecha de vencimiento.
- Vista previa antes de confirmar, reporte de filas con errores.
- Definir cómo se vinculan con cuentas (los socios importados todavía no tienen passkey: probablemente quedan como invitación pendiente).

---

## 8. Decisiones (resueltas por Lautaro, 24/09/2026)
1. **Resumen:** sí, es la sección inicial del admin (`/admin` → `/admin/resumen`).
2. **Días:** 5 para "Por vencer", 3 para el push, **5 de tolerancia**. Todos configurables como opción **global** del gym.
3. **Deuda total:** suma de los planes adeudados (precio del plan de cada socio vencido/bloqueado por vencimiento). Siempre un período por socio (ver punto 8).
4. **Pagos parciales / "Con deuda":** v2.
5. **Entrenadores/nutricionistas:** son los admins; no hay rol nuevo.
6. **Montos:** pesos enteros.
7. **Socio bloqueado:** cartel "Tu cuota está vencida, renovala en recepción para poder seguir usando la app".
8. **Pagos:** siempre en recepción (los carga el staff). Un socio nunca acumula más de un período adeudado: queda bloqueado antes y tiene que abonar el vencido para seguir. Por eso la deuda es un período por socio. Quien paga dentro de la tolerancia conserva su fecha de vencimiento (ver 6.4).

---

## 9. Primer prompt listo para Codex (Paso 1, auditoría)

```
Contexto: vamos a reestructurar el panel de administración de lauyim en
secciones con navegación propia (menú lateral en escritorio, pestañas en
celular) y después agregar un módulo nuevo de gestión de cuotas.

Antes de modificar nada, necesito un reporte del estado actual:

1. Panel admin:
   - Archivo(s) y componente(s) que lo implementan, y cómo se decide quién
     accede (Owner / ADMIN_UIDS).
   - Lista de TODAS las funciones que muestra hoy (métricas, gráfico de
     asistencia, usuarios, rutinas preestablecidas, notificaciones, QR,
     logs, edición de lesiones/rutinas/metas por socio, etc.) y en qué
     componente está cada una.
   - Cómo se maneja hoy el ruteo del frontend (librería, rutas existentes)
     y si /admin tiene subrutas.
2. Rutas profundas:
   - Configuración de Nginx para el fallback SPA.
   - Cómo trata el Service Worker las navegaciones a rutas como
     /admin/algo (¿las sirve bien al recargar?).
3. Cuotas actuales:
   - Cómo está implementado el recordatorio de cuota del socio (dónde se
     configura, cómo se dispara, si usa tareas programadas).
   - Cómo está implementado el bloqueo manual de acceso: tabla/columna,
     endpoint, y en qué lugares del backend se verifica.
   - Si existe algún mecanismo de tareas programadas (ej. backups) que
     podamos reutilizar para avisos diarios.
4. Base de datos:
   - Esquema actual de la tabla de usuarios/socios y convenciones de
     migraciones (dónde están, cómo se versionan).
5. PWA:
   - Contenido actual del manifest (name, icons, display, start_url,
     shortcuts si hay).
6. Layout:
   - Si existe algún breakpoint o layout de escritorio hoy, o si todo está
     pensado solo para celular.

No modifiques ningún archivo. Solo reportá, con rutas de archivo y
líneas cuando sea útil.
```

---

## 10. Pendiente comercial vinculado
- Al gym que usa "Gestión Gym" hay que mandarle la propuesta. Mensaje honesto sugerido: lauyim hoy se enfoca en la experiencia de entrenamiento y el seguimiento; la gestión de cuotas está en desarrollo y se le avisa cuando esté lista. **No prometer cuotas como algo ya disponible** hasta que esté probado en la demo.
- Cuando esté listo, actualizar la presentación comercial (PDF de Canva) con una línea sobre gestión de cuotas y la vista de escritorio.

---

## 11. Resultado de la auditoría del Paso 1 (resumen)
- Admin entero en `frontend/src/views/Admin.jsx` (1239 líneas). Guard frontend `user?.admin` (App.jsx) y backend `requireAdmin` / `requireOwner` (`api/server.js`).
- Ruteo `HashRouter`; `/admin` sin subrutas. `App.jsx` aplica `key={loc.pathname}` a `#app` → ajustar para que `/admin/*` comparta key.
- Bug: `useEffect` después de un `return null` condicional en `Admin.jsx` (~1184).
- Polling de `/api/admin/users` cada 15 s → sube al layout del admin.
- Layout mobile-first (`#app` 560px) con breakpoint `min-width:1000px`; el admin usa `.narrow` (640px).
- Manifest sin `shortcuts`, `orientation: portrait`.
- Bloqueo manual = `users.disabled` (sin sesión en todo endpoint). Scheduler in-app en `api/scheduler.js`. Config global en `admin_settings`.

---

## 12. Roadmap post-Cuotas v1 (aprobado 24/09/2026)

Orden de ejecución (actualizado):
1. ✅ **PUSH_AGENT** + allowlist de hosts de push.
2. ✅ **Fichas, entrega 1:** arreglos previos y rate limit con IP real.
3. **Fichas, entrega 2:** backend (`member_profile`, `link_codes`, endpoints, merge).
4. **Cuotas activable + horario de avisos:**
   - interruptor del owner (ver 12.5);
   - el aviso de vencimiento y el recordatorio manual de cuota salen a una hora fija del gym, configurable (default 12:00), y no a la hora del recordatorio de entrenamiento.
5. **Fichas, entrega 3:** frontend.
   - Incluye la sección **"Acceso"**, que reemplaza a "QR", con el QR (solo owner) y los códigos de invitación (admins).
   - Incluye el panel de Notificaciones con la lista de quién tiene los push activados.
6. **Paso 4.1, importar socios por CSV/Excel.**
7. **Onboarding básico + aprobación de cuentas + pedido de notificaciones** (ver 12.3 y 12.6).
8. **Avisos por WhatsApp** con links `wa.me`.
9. **Backlog:** bloqueo que ignore `DEMO_ADMIN_ALL_USERS`, rendimiento de `/api/admin/users`, heatmap con zonas horarias mezcladas, helpers de fecha sin uso, `zxing` en el admin, `hasPush` con suscripciones bloqueadas por la allowlist.
- **Antes de cargar DNIs reales de un gym:** cifrar los backups que se suben a Drive y agregar el aviso de privacidad.

### 12.1 Fichas de socio (socio sin app)
- El staff crea una ficha con nombre, DNI, celular, mail opcional y plan. Técnicamente es una fila de `users` sin passkey, así que cuotas y pagos funcionan igual que para cualquier socio.
- **Camino principal:** el staff genera un código o QR de vinculación y la persona crea su passkey sobre esa misma ficha, conservando su historial.
- **Camino de rescate:** si la persona ya se creó otra cuenta, el staff usa "Vincular con ficha". La cuota y los pagos pasan de la ficha a la cuenta y la ficha se borra. Se reutiliza la lógica de `scripts/admin/common.py`.
- **DNI único por gym:** si alguien se registra con un DNI que ya tiene ficha, se le avisa al staff para vincularlos.

### 12.2 Datos de contacto
- DNI y celular obligatorios; mail opcional. Cada gym decide qué campos pide.
- Los carga el staff al crear la ficha o al habilitar la cuenta. El socio los completa en el onboarding si se registró solo.
- Solo los ven los admins. Son datos personales (Ley 25.326): hay que mencionarlos en el aviso de privacidad, y van incluidos en los backups.

### 12.3 Aprobación de cuentas (diagrama de Lautaro, 24/09/2026)
- **Interruptor del owner:** "Requerir aprobación del staff".
- **Campos configurables por el owner:**
  - nombre de usuario: siempre obligatorio; no tiene que ser el nombre real;
  - nombre y apellido, DNI, teléfono y mail: cada uno se puede activar y marcar como obligatorio u opcional.
  - La misma configuración se usa en el registro, en el formulario del staff y en las fichas.
- **Con la aprobación encendida:**
  1. Al registrarse, el socio solo pone su nombre de usuario y la passkey.
  2. Queda en "pendiente" hasta que el staff confirma, con el botón Reintentar.
  3. El staff abre la cuenta en "Pendientes" y completa los campos configurados.
  4. Si el DNI ya existe, el staff verifica y hace el merge antes de confirmar.
  5. Recién al confirmar la cuenta queda habilitada.
  - La confirmación depende del modo:
    - **Aprobar:** con plan opcional si cuotas está activo.
    - **Registrar primer pago:** requiere cuotas.
    - **Iniciar prueba de N días:** requiere cuotas y el DNI activo. La prueba **arranca cuando el staff la inicia** y hay una por DNI.
- **Con la aprobación apagada:**
  1. El socio completa en el registro los campos configurados más la passkey.
  2. Si se pidió DNI y ese DNI ya existe (ficha o cuenta), el registro se frena con "Ya hay un socio con este DNI. Pedí en recepción tu código de vinculación". Nunca se vincula solo.
- Aplica solo a las cuentas creadas después de encender el interruptor. Una ficha vinculada llega ya habilitada.

### 12.4 Canales de aviso
- **v1:** push, que ya existe, y WhatsApp con links `wa.me` con el mensaje prearmado, que el staff envía desde el celular del gym. No tiene costo ni requiere aprobación de Meta.
- **Más adelante:**
  - mail con un proveedor transaccional (Resend, Brevo);
  - API oficial de WhatsApp Business: requiere verificar la empresa, plantillas aprobadas y pago por conversación.
- **No usar** librerías no oficiales de WhatsApp: hay riesgo de que bloqueen el número.

### 12.5 Cuotas activable
- Interruptor global **solo del owner**. Por defecto queda encendido en las instancias que ya existen.
- Con cuotas apagado:
  - no hay bloqueo por cuota ni aviso push de vencimiento;
  - se oculta la sección Cuotas y la card de cuota en UserDetail;
  - `/api/me` no devuelve `billing`;
  - el recordatorio manual del socio vuelve a funcionar;
  - los modos de aprobación "Primer pago" y "Prueba" no están disponibles.
- Los datos no se borran: al volver a encenderlo, todo queda como estaba.
- Las fichas siguen funcionando sin plan.

### 12.6 Onboarding y notificaciones
- **Los datos se piden en el registro** (ver 12.3), no en un onboarding después del login.
- **Socios existentes sin datos:** con la aprobación apagada, ven **una sola vez** el mismo formulario la próxima vez que entran.
- **Después del login y antes de la encuesta:** un paso de notificaciones con una explicación y los botones "Activar" / "Ahora no".
  - El prompt nativo necesita un gesto del usuario.
  - En iOS, primero se muestran las instrucciones para instalar la app, porque el push web no funciona sin eso.
  - No puede ser obligatorio.
- **Aviso de privacidad:** con el check "Acepto", en el registro cuando se piden datos, y en el formulario del staff.
- **Después del alta,** el DNI solo lo edita el staff.
- **Flujo completo:** registro (con datos o solo usuario) → pendiente, si hay aprobación → notificaciones → encuesta → tutorial de Inicio.

### 12.7 Prueba (adelantada, aprobada 25/09/2026)
- **Alta de socio:** al crear un socio se elige cómo arranca su cuota: "Registrar pago", "Iniciar prueba" o "Solo ficha".
- **Duración:** N días (`trial_days` en la configuración de Cuotas, default 1). El estado es "En prueba".
- **Al terminar:** bloqueo inmediato, **sin tolerancia**. El cartel dice que la prueba terminó.
- **Límite:** una prueba por DNI (queda `trial_used_at` en el perfil y se conserva en un merge). Requiere que el DNI esté activo en la configuración y cargado en la ficha.
- **Cuando paga:** se registra el pago normal (vence hoy + duración) y la prueba se cierra.
- **Con cuotas apagado:** la prueba no aplica.
- **DNI:** 6 a 8 dígitos.
- **Pendiente: prueba en el historial de pagos.**
  - En el historial de la ficha de cuota, la prueba aparece como una entrada más: "Prueba gratis · N días · dd/mm–dd/mm", con quién la inició. Monto $0.
  - No suma a la recaudación ni a la deuda, y no se puede anular.
  - Se guarda en una tabla propia, `member_trials` (user_id, started_at, trial_until, created_by), y no en `payments`: ahí `amount > 0` es un CHECK, y cambiarlo obliga a reconstruir la tabla en SQLite.
  - El historial combina las dos tablas ordenadas por fecha, y se registra también en las altas con prueba. Las pruebas anteriores al cambio se reconstruyen desde `trial_used_at`, si alcanza el dato.
