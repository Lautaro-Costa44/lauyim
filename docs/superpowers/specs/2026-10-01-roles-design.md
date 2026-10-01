# Roles y permisos del staff — diseño

Fecha: 2026-10-01. Estado: aprobado en chat, pendiente de revisión del spec.

## Objetivo

Hoy el staff es binario: `users.admin` (o `ADMIN_UIDS`) da todo el panel de admin y el owner tiene
además 17 rutas propias. El dueño quiere delegar partes concretas: una recepcionista que cobra
cuotas y aprueba cuentas, una nutricionista que ve socios y gestiona su nutrición, una profe que
arma rutinas. Para eso: roles con permisos, uno por usuario, creados y editados por el owner.

Fuera de este spec: el módulo de clases (spec propio). Ese spec agrega los permisos de clases
(`classes.manage`, `classes.attendance`) al catálogo y los suma a Profesor/a.

## Decisiones tomadas

- Granularidad: el catálogo de abajo (≈15 permisos, "ver" separado de "gestionar" donde importa).
- Un solo rol por usuario. Sin rol = "Ninguno" (`role_id` NULL), el valor por defecto.
- Cada rol tiene un interruptor "Exento de cuota", activado por defecto en todos los roles.
- Almacenamiento: tabla `roles` + `users.role_id` (opción A).
- Roles que vienen creados: Administrador (de fábrica, no se borra ni se renombra), Recepción,
  Nutricionista y Profesor/a (editables y borrables). No hay plantillas aparte: los roles de
  ejemplo ya existen.
- El owner no tiene rol: tiene todos los permisos siempre, y además lo que es solo suyo.

## Catálogo de permisos (`api/permissions.js`)

Cada permiso: código, área, nombre visible, explicación de una línea y de qué permisos depende.
"Depende de" significa que activarlo activa también esos, y apagar uno de esos lo apaga.

| Código | Área | Nombre | Depende de | Rutas `/api/admin` que habilita |
|---|---|---|---|---|
| `members.view` | Socios | Ver socios | — | `GET users`, `GET user`, `GET members/lookup`, `GET members/settings`, `GET users/:userId/profile` |
| `members.edit` | Socios | Editar socios | `members.view` | `POST members`, `PUT users/:userId/profile`, `POST user/disable`, `POST/DELETE users/:userId/link-code`, `POST users/:userId/merge`, `GET invites`, `POST invites/new`, `POST invites/revoke`, `PUT members/settings` |
| `members.approve` | Socios | Aprobar cuentas | `members.view` | `GET approval`, `POST users/:userId/approve/check`, `POST users/:userId/approve`, `POST users/:userId/reject` |
| `fees.view` | Cuotas | Ver cuotas | `members.view` | `GET billing`, `GET billing/plans`, `GET billing/settings`, `GET users/:userId/billing` |
| `fees.manage` | Cuotas | Registrar pagos y gestionar cuotas | `fees.view` | `POST billing/plans`, `PUT billing/plans/:id`, `PUT billing/settings`, `POST users/:userId/trial`, `PUT users/:userId/billing`, `POST users/:userId/payments`, `POST users/:userId/payments/:paymentId/void` |
| `training.manage` | Entrenamiento | Rutinas y planes | `members.view` | `GET/PUT users/:userId/routines`, `presets` (todas), `programs` (todas) |
| `exercises.share` | Entrenamiento | Ejercicios públicos | — | `POST public-exercises`, `…/delete`, `…/unshare` |
| `nutrition.manage` | Nutrición | Gestionar nutrición | `members.view` | `users/:userId/nutrition` (todas), `nutrition/templates` (todas) |
| `health.view` | Salud | Ver datos de salud | `members.view` | `PUT users/:userId/injuries`, `POST users/:userId/injuries/exercise-warning-override`; además, ver peso y lesiones en las respuestas (ver "Datos de salud") |
| `checkin.operate` | Operación | Ingreso físico | — | `GET checkin`, `POST checkin/devices`, `DELETE checkin/devices/:id` |
| `notifications.send` | Operación | Enviar notificaciones | — | `POST push`, `GET/PUT notifications/settings` |
| `stats.view` | Operación | Resumen y estadísticas | — | `GET attendance-heatmap`, `POST attendance-week-start` |
| `audit.view` | Operación | Registro de actividad | — | `GET audit` |
| `roles.assign` | Staff | Asignar roles | `members.view` | `GET roles`, `POST users/role` |

Cambio respecto de hoy: `POST /api/admin/audit/clear` pasa a ser solo del owner (`/api/owner/audit/clear`):
borrar el registro de actividad no se delega.

### Solo del owner (sin cambios salvo lo indicado)

Personalización, configuración de aprobación (`PUT /api/owner/approval`), habilitar cuotas,
configuración de ingreso físico, privacidad, QR, importar y exportar socios, borrar cuentas,
borrar el registro de actividad, y crear, editar y borrar roles. `POST /api/owner/user/admin` se
elimina (lo reemplaza `POST /api/admin/users/role`).

## Roles de fábrica

Se crean una sola vez, en la migración (marca en `admin_settings`, así borrar uno no lo
recrea al reiniciar). Todos con "Exento de cuota" activado.

| Rol | `builtin` | Color | Permisos |
|---|---|---|---|
| Administrador | 1 | `#ff453a` | todos menos `roles.assign` |
| Recepción | 0 | `#0a84ff` | `members.view`, `members.edit`, `members.approve`, `fees.view`, `fees.manage`, `checkin.operate` |
| Nutricionista | 0 | `#30d158` | `members.view`, `nutrition.manage`, `health.view` |
| Profesor/a | 0 | `#ff9f0a` | `members.view`, `training.manage`, `health.view` |

Administrador: no se borra y no se renombra; sus permisos y su color sí se editan (así el owner
decide si asigna roles).

## Datos

Tabla nueva:

```sql
CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  permissions TEXT NOT NULL DEFAULT '[]',  -- JSON: lista de códigos del catálogo
  fee_exempt INTEGER NOT NULL DEFAULT 1,
  builtin INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
```

Columna nueva: `users.role_id TEXT` (NULL = Ninguno).

Migración al arrancar (idempotente):
1. Crea `roles` y `users.role_id` si no existen.
2. Si la marca `roles_seeded` no está: crea los cuatro roles de fábrica y pone la marca.
3. Todo usuario con `admin = 1` y sin `role_id` pasa a Administrador. La columna `admin` queda
   en la base sin uso (vuelta atrás posible); nada nuevo la escribe.

Validación de un rol (`validateRole`): nombre de 1 a 30 caracteres, sin repetir (sin distinguir
mayúsculas); color `#RRGGBB`; permisos solo del catálogo, con las dependencias completadas;
`fee_exempt` booleano.

## Reglas en la API

Funciones nuevas (en `api/permissions.js`, puras y testeables):

- `permissionsOf(user, role)`: owner o `ADMIN_UIDS` → todos; con rol → los del rol; sin rol → ninguno.
- `can(user, perm)`.
- `isStaff(user)`: owner, `ADMIN_UIDS`, o un rol con al menos un permiso. Reemplaza a `isAdmin`
  donde significa "es del staff" (acceso al panel, aviso de licencia, no pedir completar el perfil,
  una cuenta del staff nunca queda pendiente, no se desactiva a un staff: hay que quitarle el rol
  primero).
- `isFeeExempt(user)`: owner, `ADMIN_UIDS`, o rol con `fee_exempt`. Reemplaza a `isRealStaff` en
  todo lo de cuotas (bloqueos, resumen de Cuotas, ingreso físico, exportación).
- `requirePermission(req, res, perm)`: como `requireAdmin` (401 sin sesión, 403 + auditoría
  `admin.denied` sin el permiso). Reemplaza a `requireAdmin` en cada ruta según la tabla.

Asignar un rol (`POST /api/admin/users/role`, `{ userId, roleId | null }`, permiso `roles.assign`):
- Solo se puede dar un rol cuyos permisos estén todos incluidos en los de quien asigna (el owner
  puede todo). Lo mismo para quitar: no se le quita el rol a alguien con permisos que el que
  asigna no tiene.
- No se asigna a la cuenta del owner, ni a una cuenta pendiente o desactivada (quitar siempre se
  puede).
- Audita `admin.user.role` con el rol anterior y el nuevo.

Roles (owner): `GET /api/admin/roles` (owner o `roles.assign`; cada rol con su cantidad de
personas), `POST /api/owner/roles/save` (crea si no trae `id`), `POST /api/owner/roles/delete`
(no el de fábrica; sus usuarios pasan a Ninguno en la misma transacción). Ambos auditados.

`/api/me` agrega `role: { id, name, color } | null` y `permissions: [...]`. `admin` sigue
viniendo (= `isStaff`) para no romper clientes viejos durante la actualización.

### Datos de salud

Sin `health.view`, las respuestas a staff omiten el peso corporal y las lesiones del socio: se usa
el mismo recorte que hoy se aplica cuando el socio no dio el consentimiento de salud. La regla
existente se mantiene: si el socio no dio el consentimiento, nadie del staff ve ni edita sus
datos de salud ni su nutrición, tenga el permiso que tenga.

## Pantallas

### Admin → Roles (sección nueva, al lado de Usuarios)

Visible para el owner (completa) y para quien tenga `roles.assign` (solo ve el ícono de asignar).

- Arriba: botón "Nuevo rol" (solo owner).
- Lista: una fila por rol con punto de color, nombre y debajo, en gris, "N personas". Administrador
  primero, con un candado chico.
- A la derecha de cada fila, tres íconos de 40 px: lápiz (editar), persona con + (asignar),
  tacho (eliminar). Administrador no tiene tacho.

### Editar / nuevo rol

Hoja desde abajo en el celular, ventana centrada en PC, como las demás del panel.
- Nombre (Administrador: fijo) y color (los de Personalización + selector libre).
- Interruptor "Exento de cuota".
- Permisos agrupados por área: interruptor + nombre + explicación de una línea. Las dependencias
  se aplican al tocar.
- Guardar / Cancelar.

### Asignar (persona con +)

Hoja con buscador y lista de socios activos (sin el owner, sin pendientes ni desactivados). Primero
los que ya tienen el rol, marcados; cada socio muestra su rol actual como etiqueta de color.
Tocar asigna en el acto (reemplaza el rol anterior, toast "Ana: Recepción → Nutricionista");
tocar a alguien que ya lo tiene lo pasa a Ninguno.

### Eliminar (tacho)

Confirmación: "¿Eliminar Recepción? 3 personas quedan sin rol." Botón rojo.

### Ficha y lista de Usuarios

- "Hacer administrador" pasa a "Gestionar roles": lista de opción única con "Ninguno" y los roles
  que quien asigna puede dar. Visible para owner y `roles.assign`.
- El rol se ve como etiqueta de color en la ficha y en cada fila de Usuarios.

### El panel según el rol

- Entra al panel quien sea `isStaff`.
- Cada sección se muestra si se tiene su permiso: Resumen (`stats.view`), Usuarios
  (`members.view`), Cuotas (`fees.view` y cuotas habilitadas), Rutinas (`training.manage`),
  Acceso (`members.approve`), Ingreso físico (`checkin.operate`), Notificaciones
  (`notifications.send`), Registro (`audit.view`), Roles (owner o `roles.assign`),
  Personalización (owner).
- Dentro de la ficha de un socio, cada bloque (cuotas, rutina, nutrición, lesiones) se muestra
  según su permiso.
- La primera sección visible es la de entrada (hoy es Resumen fijo).

## Pruebas

- `permissions.test.js`: dependencias, `permissionsOf`, `can`, `isStaff`, `isFeeExempt`,
  `validateRole`.
- Test de cobertura: cada ruta `/api/admin/*` declara un permiso del catálogo (ninguna queda con
  el `requireAdmin` viejo ni sin permiso).
- HTTP sobre `server.js`: migración (admin viejo → Administrador; los cuatro roles; reiniciar no
  los duplica ni recrea uno borrado), owner crea/edita/borra roles, staff no; asignar respeta
  "solo roles incluidos en los tuyos"; una recepcionista cobra pero no edita nutrición; sin
  `health.view` no llega el peso; borrar un rol deja a sus usuarios en Ninguno.
- Frontend: lista de roles (íconos según quién mira), editor (dependencias), asignar, "Gestionar
  roles" en la ficha, navegación del panel según permisos.
- Verificación en navegador en celular y PC.

## Fuera de alcance

- Permisos por socio asignado ("la nutricionista ve solo a sus socios").
- Más de un rol por usuario.
- Permisos de clases (llegan con el spec de clases).
