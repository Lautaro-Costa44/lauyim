// Categorías del registro de actividad (Admin → Logs): cada evento cae en una, y el panel filtra
// por ellas. El evento es "dominio.acción" (auth.login.ok, classes.closure.add, owner.branding…).
export const AUDIT_CATEGORIES = ['auth', 'members', 'billing', 'classes', 'training', 'checkin', 'settings'];

const RULES = [
  // Accesos: ingresos, registros, passkeys, dispositivos y bloqueos al panel.
  ['auth', /^auth\./],
  ['auth', /^(admin|owner)\.denied$/],
  ['classes', /^classes\./],
  ['classes', /^owner\.classes\./],
  ['billing', /^(admin|owner)\.billing\./],
  ['billing', /^admin\.notifications\./],          // la hora de los avisos de cuota
  ['checkin', /^checkin\./],
  ['checkin', /^(admin|owner)\.checkin\./],
  // Entrenamiento y nutrición que el staff le arma al socio, y los programas del gym.
  ['training', /^admin\.(routine|preset|program|injury|nutrition)\./],
  // Socios, cuentas, invitaciones, roles asignados y avisos que el staff les manda.
  ['members', /^admin\.(member|user|invite|push)\./],
  ['members', /^owner\.(member|user)\./],
  // Configuración del gimnasio: personalización, privacidad, aprobación, roles, QR, el registro.
  ['settings', /^owner\./],
  ['settings', /^admin\.(attendance|audit)\./]
];

export function auditCategory(ev) {
  const name = String(ev || '');
  for (const [cat, re] of RULES) if (re.test(name)) return cat;
  return 'other';
}
