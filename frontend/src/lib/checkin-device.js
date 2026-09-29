// Token del dispositivo de Ingreso Físico (recepción). Vive solo en este navegador, con clave
// propia: no tiene nada que ver con la sesión de nadie. Se borra al revocarlo, al salir con la
// passkey de un admin o cuando el servidor responde 401/403 en los endpoints del dispositivo.
import { api } from './api.js'

export const CHECKIN_TOKEN_KEY = 'lauyim_checkin_token'
export const CHECKIN_ROUTE = '/ingreso-fisico'

export const getCheckinToken = () => { try { return localStorage.getItem(CHECKIN_TOKEN_KEY) || null } catch { return null } }
export const setCheckinToken = token => { try { localStorage.setItem(CHECKIN_TOKEN_KEY, token) } catch { /* storage off */ } }
export const clearCheckinToken = () => { try { localStorage.removeItem(CHECKIN_TOKEN_KEY) } catch { /* storage off */ } }

// Pedido de la pantalla de Ingreso Físico: solo con el token, sin sesión. Ante 401 (revocado) o
// 403 (módulo apagado) el token se borra y el error sigue viaje con `ended: true`.
export async function checkinApi(path, body) {
  try {
    return await api(path, { method: 'POST', body: JSON.stringify(body || {}), headers: { 'X-Checkin-Token': getCheckinToken() || '' } })
  } catch (e) {
    if (e?.status === 401 || e?.status === 403) { clearCheckinToken(); e.ended = true }
    throw e
  }
}
