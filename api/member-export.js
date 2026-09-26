// Exportar socios a CSV (solo owner): para Excel en español (BOM, separador ';') y protegido
// contra inyección de fórmulas (mismo criterio que la descarga de errores de la importación,
// frontend/src/views/admin/members/import-parse.js).

export function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
export const toCsv = rows => '\uFEFF' + rows.map(r => r.map(csvCell).join(';')).join('\r\n') + '\r\n';

const dmy = iso => /^\d{4}-\d{2}-\d{2}/.test(String(iso || '')) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '';
const STATUS = { sin_plan: 'Sin plan', al_dia: 'Al día', por_vencer: 'Por vencer', vencido: 'Vencido', bloqueado: 'Bloqueado', prueba: 'En prueba' };

// Celular como 549… (sin +): el formato de wa.me y el que la importación entiende, y sin el
// apóstrofo que la protección contra fórmulas le pondría a un "+" adelante. Sin normalizar, lo
// cargado sin el + inicial.
export const exportPhone = p => p?.phoneNorm ? p.phoneNorm.replace(/^\+/, '') : String(p?.phone ?? '').trim().replace(/^\+/, '');

// members: [{ name, created, disabled, hasApp, profile, billing: { planName, dueDate, status } | null }]
// (sin staff: los filtra quien llama). → { csv, count }
export function membersCsv(members, { billingEnabled }) {
  const header = ['Usuario', 'Nombre y apellido', 'DNI', 'Celular', 'Mail', 'Usa la app', 'Estado', 'Alta'];
  if (billingEnabled) header.push('Plan', 'Vence', 'Estado de cuota');
  const rows = members.map(m => {
    const p = m.profile || {};
    const row = [m.name, p.fullName, p.dni, exportPhone(p), p.email, m.hasApp ? 'Sí' : 'No', m.disabled ? 'Desactivado' : 'Activo', dmy(m.created)];
    if (billingEnabled) row.push(m.billing?.planName ?? '', dmy(m.billing?.dueDate), STATUS[m.billing?.status] ?? '');
    return row;
  });
  return { csv: toCsv([header, ...rows]), count: rows.length };
}
