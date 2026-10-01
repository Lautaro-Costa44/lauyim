import { musclesOf } from './muscles.js'

// Qué se muestra arriba de un ejercicio, donde va el gif: 'gif', 'map' (el mapa muscular) o null.
//
// - Catálogo con gif y gifs encendidos (EXERCISE_GIFS): el gif.
// - Catálogo con los gifs apagados: el mapa muscular en su lugar.
// - Ejercicio creado por un socio o por el staff: el mapa, salvo que lo hayan apagado
//   (map: false). Los de antes no tienen el campo y también lo muestran.
// - Sin músculos que dibujar (cardio sin datos, por ejemplo): nada.
export function mediaKindFor(ex, gifsOn = true) {
  if (!ex) return null
  if (ex.gif && gifsOn && !ex.custom) return 'gif'
  if (ex.custom && ex.map === false) return null
  if (!ex.custom && !ex.gif) return null
  return Object.keys(musclesOf(ex)).length ? 'map' : null
}

// Si los gifs del catálogo están encendidos, según /api/config. Sin config todavía (primer
// arranque sin conexión) usa la última guardada, y si no hay ninguna, encendidos.
let cachedConfig
export function exerciseGifsOn(config) {
  if (config) return config.exercise_gifs !== false
  if (cachedConfig === undefined) {
    try { cachedConfig = JSON.parse(localStorage.getItem('gym_config') || 'null') } catch { cachedConfig = null }
  }
  return cachedConfig?.exercise_gifs !== false
}
