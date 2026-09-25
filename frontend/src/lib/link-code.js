// Código de vinculación del gym (ficha → passkey): XXXX-XXXX con el mismo alfabeto que
// api/members.js, sin caracteres ambiguos (0/O, 1/I/L).
export const LINK_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

// Lo que se tipea o pega → forma XXXX-XXXX parcial: mayúsculas, solo el alfabeto y el guion
// puesto solo. Nunca más de 8 caracteres.
export function formatLinkCodeInput(raw) {
  const chars = [...String(raw ?? '').toUpperCase()].filter(c => LINK_CODE_ALPHABET.includes(c)).slice(0, 8).join('')
  return chars.length > 4 ? chars.slice(0, 4) + '-' + chars.slice(4) : chars
}

export const isCompleteLinkCode = code => /^[^-]{4}-[^-]{4}$/.test(code || '')
