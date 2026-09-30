// Nombre de un socio para mostrar: "Juan Fernández [Juani]" (nombre y apellido de la ficha y,
// entre corchetes, el nombre de usuario). Sin nombre y apellido, solo el usuario; si son iguales
// (sin importar mayúsculas), una sola vez.
export const sameName = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()

export function memberName({ fullName, nick }) {
  if (!fullName) return nick || ''
  return nick && !sameName(nick, fullName) ? `${fullName} [${nick}]` : fullName
}

// Solo el "[Juani]" (para mostrarlo en gris), o null si no corresponde.
export const nickSuffix = ({ fullName, nick }) => (fullName && nick && !sameName(nick, fullName) ? nick : null)
