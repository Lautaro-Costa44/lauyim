// Permisos del staff en el cliente (el servidor los vuelve a controlar en cada pedido: api/permissions.js).
// user.permissions llega en el login y en /api/me. Un cliente con la sesión guardada de antes de
// los roles no la tiene: ahí manda `admin` (todo o nada) hasta el próximo /api/me.

// code: un permiso o una lista (alcanza con cualquiera).
export const can = (user, code) => !!user && (!!user.owner || (Array.isArray(user.permissions) ? [].concat(code).some(c => user.permissions.includes(c)) : !!user.admin))

// Del staff: entra al panel de admin.
export const isStaffUser = user => !!user && (!!user.owner || (Array.isArray(user.permissions) ? user.permissions.length > 0 : !!user.admin))

// Secciones del panel, en orden, con lo que pide cada una. flag: la sección existe solo con esa
// función del gym encendida (cuotas, ingreso físico, registro). Acceso: invitaciones para quien edita
// socios; el resto de Acceso es del owner.
export const ADMIN_SECTIONS = [
  { path: 'resumen', label: 'Resumen', perm: 'stats.view' },
  { path: 'usuarios', label: 'Usuarios', perm: 'members.view' },
  { path: 'cuotas', label: 'Cuotas', perm: 'fees.view', flag: 'billingEnabled' },
  { path: 'rutinas', label: 'Rutinas', perm: 'training.manage' },
  { path: 'clases', label: 'Clases', perm: ['classes.attendance', 'classes.view_all'], flag: 'classesEnabled', ownerAlways: true },
  { path: 'notificaciones', label: 'Notificaciones', perm: 'notifications.send' },
  { path: 'acceso', label: 'Acceso', perm: 'members.edit' },
  { path: 'roles', label: 'Roles', perm: 'roles.assign' },
  { path: 'personalizacion', label: 'Personalización', ownerOnly: true },
  { path: 'ingreso-fisico', label: 'Ingreso Físico', perm: 'checkin.operate', flag: 'checkinEnabled', ownerAlways: true },
  { path: 'logs', label: 'Logs', perm: 'audit.view', flag: 'auditEnabled' },
]

// Secciones que ve esta persona. flags: { billingEnabled, checkinEnabled, auditEnabled }; un flag
// todavía sin respuesta (null) no esconde la sección. El owner ve Ingreso Físico aunque esté
// apagado (para encenderlo).
export function visibleSections(user, flags = {}) {
  return ADMIN_SECTIONS.filter(s => {
    if (s.ownerOnly) return !!user?.owner
    if (!can(user, s.perm)) return false
    if (s.flag && flags[s.flag] === false) return !!(s.ownerAlways && user?.owner)
    return true
  })
}
