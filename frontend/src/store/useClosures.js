// Los cierres del gimnasio para el socio: fuera de S (no se sube con PUT /api/data). Se guardan en el
// dispositivo para que la racha y la semana los tengan apenas abre la app; `today` es la fecha del
// gimnasio que manda el servidor (la que decide "hoy está cerrado") y no se guarda: solo vale la de
// esta apertura.
import { create } from 'zustand'
import { useStore } from './useStore.js'
import { closuresApi } from '../lib/closures.js'
import { todayISO } from '../lib/format.js'

const KEY = 'lauyim_closures'
const userId = () => useStore.getState().user?.id || null
function readSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null')
    return s && s.userId === userId() && Array.isArray(s.closures) ? s.closures : []
  } catch { return [] }
}

export const useClosures = create(() => ({ today: null, closures: readSaved() }))

export async function loadClosures() {
  try {
    const d = await closuresApi.member()
    const data = { today: d?.today || null, closures: Array.isArray(d?.closures) ? d.closures : [] }
    useClosures.setState(data)
    try { localStorage.setItem(KEY, JSON.stringify({ userId: userId(), closures: data.closures })) } catch { /* sin storage */ }
    return data
  } catch { return null }
}

// "Hoy" del gimnasio (mientras no llegó, el del dispositivo: solo para dibujar, nunca para el cartel).
export const useClosuresToday = () => useClosures(s => s.today) || todayISO()
