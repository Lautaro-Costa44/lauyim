// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { ASK_MAX, ASK_SNOOZE_MS, BANNER_WAIT_MS, askInContext, bannerKind, canAsk, notifReasons, pushStatus, snoozeAsk, unblockSteps } from './notif-ask.js'
import { markNotifStepDone } from './notif-step.js'

const DAY = 86400000
const NOW = Date.UTC(2026, 9, 9, 15)

beforeEach(() => localStorage.clear())

describe('canAsk / snoozeAsk', () => {
  it('cada "Ahora no" pausa 14 días; después de 3, nunca más', () => {
    expect(canAsk('u', NOW)).toBe(true)
    snoozeAsk('u', NOW)
    expect(canAsk('u', NOW + ASK_SNOOZE_MS - 1)).toBe(false)
    expect(canAsk('u', NOW + ASK_SNOOZE_MS)).toBe(true)
    snoozeAsk('u', NOW + ASK_SNOOZE_MS)
    snoozeAsk('u', NOW + 2 * ASK_SNOOZE_MS)
    expect(ASK_MAX).toBe(3)
    expect(canAsk('u', NOW + 100 * ASK_SNOOZE_MS)).toBe(false)
  })

  it('es por cuenta', () => {
    snoozeAsk('a', NOW)
    expect(canAsk('a', NOW)).toBe(false)
    expect(canAsk('b', NOW)).toBe(true)
  })

  it('un valor guardado roto no traba: se puede preguntar', () => {
    localStorage.setItem('gym_notif_ask:u', '{no es json')
    expect(canAsk('u', NOW)).toBe(true)
  })
})

describe('bannerKind', () => {
  const base = { uid: 'u', status: 'off', now: NOW }

  it('se ofrece activar con el permiso sin decidir; en iPhone sin instalar, instalar', () => {
    expect(bannerKind(base)).toBe('enable')
    expect(bannerKind({ ...base, status: 'ios-install' })).toBe('ios-install')
  })

  it('nada que hacer desde la página: activas, bloqueadas o sin soporte', () => {
    for (const status of ['on', 'denied', 'unsupported', null]) expect(bannerKind({ ...base, status })).toBe(null)
  })

  it('espera 3 días desde el paso del primer ingreso', () => {
    markNotifStepDone('u', NOW)
    expect(bannerKind({ ...base, now: NOW + BANNER_WAIT_MS - 1 })).toBe(null)
    expect(bannerKind({ ...base, now: NOW + BANNER_WAIT_MS })).toBe('enable')
    expect(BANNER_WAIT_MS).toBe(3 * DAY)
  })

  it('una cuenta de antes (paso sin fecha) no espera', () => {
    localStorage.setItem('gym_notif_step:u', '1')
    expect(bannerKind(base)).toBe('enable')
  })

  it('con otro cartel o un entreno en curso, no aparece', () => {
    expect(bannerKind({ ...base, busy: true })).toBe(null)
  })

  it('respeta la pausa de la ✕', () => {
    snoozeAsk('u', NOW)
    expect(bannerKind(base)).toBe(null)
  })

  it('gym_notif_force=1 lo muestra ya (para probarlo), pero no si no hay nada que hacer', () => {
    markNotifStepDone('u', NOW)
    snoozeAsk('u', NOW)
    localStorage.setItem('gym_notif_force', '1')
    expect(bannerKind(base)).toBe('enable')
    expect(bannerKind({ ...base, status: 'denied' })).toBe(null)
    expect(bannerKind({ ...base, busy: true })).toBe(null)
  })

  it('sin cuenta, nada', () => {
    expect(bannerKind({ ...base, uid: null })).toBe(null)
  })
})

describe('askInContext', () => {
  it('solo con el permiso sin decidir y sin pausa', () => {
    expect(askInContext('u', 'off', NOW)).toBe(true)
    expect(askInContext('u', 'on', NOW)).toBe(false)
    expect(askInContext('u', 'denied', NOW)).toBe(false)
    expect(askInContext('u', 'ios-install', NOW)).toBe(false)
    snoozeAsk('u', NOW)
    expect(askInContext('u', 'off', NOW)).toBe(false)
    expect(askInContext(null, 'off', NOW)).toBe(false)
  })
})

describe('notifReasons', () => {
  it('nombra solo lo que este gym y este socio usan', () => {
    expect(notifReasons({ classes: true, billing: true, routine: true })).toEqual([
      'recordatorios de tus clases y cambios de horario',
      'antes de que venza tu cuota',
      'los días que tenés entrenamiento',
    ])
    expect(notifReasons({ classes: false, billing: false, routine: true })).toEqual(['los días que tenés entrenamiento'])
  })

  it('sin nada de eso, el descanso entre series', () => {
    expect(notifReasons({})).toEqual(['cuando termina el descanso entre series'])
  })
})

describe('unblockSteps', () => {
  const steps = o => unblockSteps({ ios: false, standalone: false, ...o }).join(' ')
  it('según el dispositivo y el navegador', () => {
    expect(steps({ ios: true })).toContain('Ajustes del iPhone')
    expect(steps({ ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/130' })).toContain('Permisos → Notificaciones')
    expect(steps({ ua: 'Mozilla/5.0 (Linux; Android 14) Chrome/130', standalone: true })).toContain('Información de la app')
    expect(steps({ ua: 'Mozilla/5.0 (Windows NT 10.0) Gecko/20100101 Firefox/131.0' })).toContain('Enviar notificaciones')
    expect(steps({ ua: 'Mozilla/5.0 (Macintosh) AppleWebKit/605 Version/18.0 Safari/605' })).toContain('Sitios web')
    expect(steps({ ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/130 Safari/537 Edg/130' })).toContain('En Notificaciones, elegí Permitir')
  })
})

describe('pushStatus', () => {
  const env = (over = {}) => ({ ios: false, standalone: false, supported: true, permission: 'default', subscription: async () => null, ...over })

  it('iPhone sin instalar va antes que el soporte (Safari no tiene PushManager)', async () => {
    expect(await pushStatus(env({ ios: true, supported: false }))).toBe('ios-install')
    expect(await pushStatus(env({ ios: true, standalone: true }))).toBe('off')
  })

  it('sin soporte, bloqueadas, sin decidir', async () => {
    expect(await pushStatus(env({ supported: false }))).toBe('unsupported')
    expect(await pushStatus(env({ permission: 'denied' }))).toBe('denied')
    expect(await pushStatus(env())).toBe('off')
  })

  it('con permiso: activas solo si hay suscripción', async () => {
    expect(await pushStatus(env({ permission: 'granted', subscription: async () => ({ endpoint: 'x' }) }))).toBe('on')
    expect(await pushStatus(env({ permission: 'granted' }))).toBe('off')
  })
})
