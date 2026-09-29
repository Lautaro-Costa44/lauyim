import { useEffect, useState } from 'react'

// navigator.onLine puede mentir hacia el lado "conectado" (wifi sin salida), nunca hacia el otro:
// si dice sin conexión, no hay red. Alcanza para no mostrar un spinner que nunca termina.
export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine !== false)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off) }
  }, [])
  return online
}
