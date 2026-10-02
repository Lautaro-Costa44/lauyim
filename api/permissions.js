// Roles y permisos del staff (docs/superpowers/specs/2026-10-01-roles-design.md). Puro: el catálogo,
// las dependencias entre permisos, el permiso que pide cada ruta /api/admin y los roles de fábrica.
// server.js guarda los roles en la tabla `roles` y le pide acá qué puede hacer cada persona.

// En el orden de la pantalla de roles. requires: los que se activan solos al activar este (y que,
// al apagarse, lo apagan).
export const PERMISSIONS = Object.freeze([
  { code: 'members.view', area: 'Socios', name: 'Ver socios', help: 'La lista de socios y sus fichas.', requires: [] },
  { code: 'members.edit', area: 'Socios', name: 'Editar socios', help: 'Dar de alta, editar datos, desactivar, vincular el celular e invitar.', requires: ['members.view'] },
  { code: 'members.approve', area: 'Socios', name: 'Aprobar cuentas', help: 'Habilitar o rechazar las cuentas nuevas.', requires: ['members.view'] },
  { code: 'fees.view', area: 'Cuotas', name: 'Ver cuotas', help: 'Quién está al día, quién debe y los planes.', requires: ['members.view'] },
  { code: 'fees.manage', area: 'Cuotas', name: 'Registrar pagos y gestionar cuotas', help: 'Cobrar, anular pagos, cambiar planes y vencimientos.', requires: ['fees.view'] },
  { code: 'training.manage', area: 'Entrenamiento', name: 'Rutinas y planes', help: 'Armar las rutinas de los socios y los planes del gimnasio.', requires: ['members.view'] },
  { code: 'classes.attendance', area: 'Clases', name: 'Tomar lista', help: 'Ver los anotados de sus clases, tomar lista y anotar a alguien a mano.', requires: ['members.view'] },
  { code: 'classes.manage', area: 'Clases', name: 'Clases y horarios', help: 'Crear clases, armar el horario y cambiar o cancelar una fecha (de todas las clases).', requires: ['classes.attendance'] },
  { code: 'exercises.share', area: 'Entrenamiento', name: 'Ejercicios públicos', help: 'Compartir ejercicios propios con todo el gimnasio.', requires: [] },
  { code: 'nutrition.manage', area: 'Nutrición', name: 'Gestionar nutrición', help: 'Objetivos, sugerencias y plantillas de nutrición de los socios.', requires: ['members.view'] },
  { code: 'health.view', area: 'Salud', name: 'Ver datos de salud', help: 'Peso corporal y lesiones de los socios (datos sensibles).', requires: ['members.view'] },
  { code: 'checkin.operate', area: 'Operación', name: 'Ingreso físico', help: 'La pantalla de ingreso del mostrador y sus dispositivos.', requires: [] },
  { code: 'notifications.send', area: 'Operación', name: 'Enviar notificaciones', help: 'Avisos a los socios y la configuración de recordatorios.', requires: [] },
  { code: 'stats.view', area: 'Operación', name: 'Resumen y estadísticas', help: 'La asistencia y la actividad del gimnasio.', requires: [] },
  { code: 'audit.view', area: 'Operación', name: 'Registro de actividad', help: 'Quién hizo qué en el panel.', requires: [] },
  { code: 'roles.assign', area: 'Staff', name: 'Asignar roles', help: 'Dar y quitar roles (solo los que tienen permisos que esta persona también tiene).', requires: ['members.view'] }
]);

export const PERMISSION_CODES = Object.freeze(PERMISSIONS.map(p => p.code));
const BY_CODE = new Map(PERMISSIONS.map(p => [p.code, p]));

// Códigos → los mismos más los que necesitan, sin desconocidos, en el orden del catálogo.
export function withDependencies(codes) {
  const out = new Set();
  const add = code => { const p = BY_CODE.get(code); if (!p || out.has(code)) return; out.add(code); p.requires.forEach(add); };
  (Array.isArray(codes) ? codes : []).forEach(add);
  return PERMISSION_CODES.filter(c => out.has(c));
}

// Apagar `removed`: también se apagan los que dependen de él (directa o indirectamente).
export function withoutDependents(codes, removed) {
  const gone = new Set([removed]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of PERMISSIONS) if (!gone.has(p.code) && p.requires.some(r => gone.has(r))) { gone.add(p.code); grew = true; }
  }
  return withDependencies(codes).filter(c => !gone.has(c));
}

// Qué puede hacer una persona: el owner y los de ADMIN_UIDS (demo), todo; con rol, lo del rol.
export function permissionsOf({ owner = false, envAdmin = false, role = null } = {}) {
  if (owner || envAdmin) return [...PERMISSION_CODES];
  return role ? withDependencies(role.permissions) : [];
}
export const can = (perms, code) => Array.isArray(perms) && perms.includes(code);
export const isSubset = (wanted, held) => wanted.every(c => held.includes(c));

// Permiso que pide cada ruta /api/admin (requireAdmin en server.js). Una ruta /api/admin que no
// esté acá se niega a todos menos al owner (route-permissions.test.js lo controla).
export const ROUTE_PERMISSIONS = Object.freeze({
  // Socios
  'GET /api/admin/users': 'members.view',
  'GET /api/admin/user': 'members.view',
  'GET /api/admin/members/lookup': 'members.view',
  'GET /api/admin/members/settings': 'members.view',
  'GET /api/admin/users/:userId/profile': 'members.view',
  'POST /api/admin/members': 'members.edit',
  'PUT /api/admin/users/:userId/profile': 'members.edit',
  'POST /api/admin/user/disable': 'members.edit',
  'POST /api/admin/users/:userId/link-code': 'members.edit',
  'DELETE /api/admin/users/:userId/link-code': 'members.edit',
  'POST /api/admin/users/:userId/merge': 'members.edit',
  'GET /api/admin/invites': 'members.edit',
  'POST /api/admin/invites/new': 'members.edit',
  'POST /api/admin/invites/revoke': 'members.edit',
  'GET /api/admin/approval': 'members.approve',
  'POST /api/admin/users/:userId/approve/check': 'members.approve',
  'POST /api/admin/users/:userId/approve': 'members.approve',
  'POST /api/admin/users/:userId/reject': 'members.approve',
  // Cuotas
  'GET /api/admin/billing': 'fees.view',
  'GET /api/admin/billing/plans': 'fees.view',
  'GET /api/admin/billing/settings': 'fees.view',
  'GET /api/admin/users/:userId/billing': 'fees.view',
  'POST /api/admin/billing/plans': 'fees.manage',
  'PUT /api/admin/billing/plans/:id': 'fees.manage',
  'PUT /api/admin/billing/settings': 'fees.manage',
  'POST /api/admin/users/:userId/trial': 'fees.manage',
  'PUT /api/admin/users/:userId/billing': 'fees.manage',
  'POST /api/admin/users/:userId/payments': 'fees.manage',
  'POST /api/admin/users/:userId/payments/:paymentId/void': 'fees.manage',
  // Entrenamiento
  'GET /api/admin/users/:userId/routines': 'training.manage',
  'PUT /api/admin/users/:userId/routines': 'training.manage',
  'GET /api/admin/presets': 'training.manage',
  'POST /api/admin/presets': 'training.manage',
  'PUT /api/admin/presets': 'training.manage',
  'POST /api/admin/presets/delete': 'training.manage',
  'POST /api/admin/presets/duplicate': 'training.manage',
  'POST /api/admin/presets/reorder': 'training.manage',
  'PUT /api/admin/programs': 'training.manage',
  'POST /api/admin/programs/delete': 'training.manage',
  'POST /api/admin/programs/visibility': 'training.manage',
  'POST /api/admin/programs/duplicate': 'training.manage',
  'GET /api/admin/programs/usage': 'training.manage',
  'POST /api/admin/public-exercises': 'exercises.share',
  'POST /api/admin/public-exercises/delete': 'exercises.share',
  'POST /api/admin/public-exercises/unshare': 'exercises.share',
  // Nutrición
  'GET /api/admin/users/:userId/nutrition': 'nutrition.manage',
  'PUT /api/admin/users/:userId/nutrition/goals': 'nutrition.manage',
  'PUT /api/admin/users/:userId/nutrition/suggestions-limit': 'nutrition.manage',
  'GET /api/admin/users/:userId/nutrition/suggestions': 'nutrition.manage',
  'POST /api/admin/users/:userId/nutrition/suggestions': 'nutrition.manage',
  'POST /api/admin/users/:userId/nutrition/suggestions/custom': 'nutrition.manage',
  'PUT /api/admin/users/:userId/nutrition/suggestions/:id': 'nutrition.manage',
  'PATCH /api/admin/users/:userId/nutrition/suggestions/:id': 'nutrition.manage',
  'DELETE /api/admin/users/:userId/nutrition/suggestions/:id': 'nutrition.manage',
  'GET /api/admin/nutrition/templates': 'nutrition.manage',
  'POST /api/admin/nutrition/templates': 'nutrition.manage',
  'PUT /api/admin/nutrition/templates/:id': 'nutrition.manage',
  'DELETE /api/admin/nutrition/templates/:id': 'nutrition.manage',
  // Salud
  'PUT /api/admin/users/:userId/injuries': 'health.view',
  'POST /api/admin/users/:userId/injuries/exercise-warning-override': 'health.view',
  // Operación
  'GET /api/admin/checkin': 'checkin.operate',
  'POST /api/admin/checkin/devices': 'checkin.operate',
  'DELETE /api/admin/checkin/devices/:id': 'checkin.operate',
  'POST /api/admin/push': 'notifications.send',
  'GET /api/admin/notifications/settings': 'notifications.send',
  'PUT /api/admin/notifications/settings': 'notifications.send',
  'GET /api/admin/attendance-heatmap': 'stats.view',
  'POST /api/admin/attendance-week-start': 'stats.view',
  'GET /api/admin/audit': 'audit.view',
  // Clases (classes-routes.js)
  'GET /api/admin/classes/types': 'classes.attendance',
  'POST /api/admin/classes/types/save': 'classes.manage',
  'POST /api/admin/classes/types/archive': 'classes.manage',
  'POST /api/admin/classes/slots/save': 'classes.manage',
  'POST /api/admin/classes/slots/delete': 'classes.manage',
  'POST /api/admin/classes/overlap-check': 'classes.manage',
  'GET /api/admin/classes/calendar': 'classes.attendance',
  'POST /api/admin/classes/sessions/change': 'classes.manage',
  'GET /api/admin/classes/session': 'classes.attendance',
  'POST /api/admin/classes/sessions/add': 'classes.attendance',
  // Staff
  'GET /api/admin/roles': 'roles.assign',
  'POST /api/admin/users/role': 'roles.assign'
});

export const ADMIN_ROLE_ID = 'admin';

// Roles que trae cada instancia (se crean una vez; el de fábrica no se borra ni se renombra).
export const DEFAULT_ROLES = Object.freeze([
  { id: ADMIN_ROLE_ID, name: 'Administrador', color: '#ff453a', builtin: true, permissions: PERMISSION_CODES.filter(c => c !== 'roles.assign') },
  { id: 'reception', name: 'Recepción', color: '#0a84ff', builtin: false, permissions: withDependencies(['members.edit', 'members.approve', 'fees.manage', 'checkin.operate']) },
  { id: 'nutrition', name: 'Nutricionista', color: '#30d158', builtin: false, permissions: withDependencies(['nutrition.manage', 'health.view']) },
  { id: 'coach', name: 'Profesor/a', color: '#ff9f0a', builtin: false, permissions: withDependencies(['training.manage', 'health.view', 'classes.manage']) }
]);

export const MAX_ROLE_NAME = 30;
const clean = value => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim() : '';
const lower = s => s.toLocaleLowerCase('es');

// body → { value: { name, color, permissions, feeExempt } } o { error, field }. existingNames: los
// nombres de los otros roles (no se repiten, sin distinguir mayúsculas).
export function validateRole(body, { existingNames = [] } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Datos inválidos' };
  const name = clean(body.name);
  if (!name) return { error: 'Poné un nombre para el rol', field: 'name' };
  if (name.length > MAX_ROLE_NAME) return { error: `El nombre admite hasta ${MAX_ROLE_NAME} caracteres`, field: 'name' };
  if (existingNames.some(n => lower(n) === lower(name))) return { error: 'Ya hay un rol con ese nombre', field: 'name' };
  if (typeof body.color !== 'string' || !/^#[0-9a-f]{6}$/i.test(body.color)) return { error: 'El color tiene que ser un código #RRGGBB', field: 'color' };
  if (body.permissions !== undefined && !Array.isArray(body.permissions)) return { error: 'Permisos inválidos', field: 'permissions' };
  return { value: { name, color: body.color.toLowerCase(), permissions: withDependencies(body.permissions || []), feeExempt: body.feeExempt !== false } };
}
