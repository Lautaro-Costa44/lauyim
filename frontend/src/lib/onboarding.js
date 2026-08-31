import { driver } from 'driver.js'
import 'driver.js/dist/driver.css'
import { useStore } from '../store/useStore.js'
import { t } from './i18n.js'

function esperarElemento(selector, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const existente = document.querySelector(selector)
    if (existente) return resolve(existente)
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector)
      if (el) {
        observer.disconnect()
        resolve(el)
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    setTimeout(() => {
      observer.disconnect()
      resolve(null)
    }, timeoutMs)
  })
}

export function startTourA(nav, force = false) {
  const S = useStore.getState().S
  if (!force && S.onboardingCompletado) return

  const steps = [
    {
      element: '.survey-card, .card, #app .hdr',
      popover: {
        title: t('Paso 1 de 5 · Plan de entrenamiento'),
        description: t('Desde acá podés generar tu plan personalizado respondiendo la encuesta, cargar la rutina predeterminada o diseñar una propia manualmente.'),
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '.bw-tile, .card, .wday',
      popover: {
        title: t('Paso 2 de 5 · Peso corporal'),
        description: t('Llevá el seguimiento periódico de tu peso corporal para visualizar cambios a lo largo del tiempo.'),
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: 'a[href="/plan"], button[aria-label="Plan"], .tabbar a:nth-child(2)',
      popover: {
        title: t('Paso 3 de 5 · Organizar tu semana'),
        description: t('Organizá tu semana distribuyendo los días de entrenamiento y editando tus rutinas como prefieras.'),
        side: 'top',
        align: 'center',
      },
    },
    {
      element: 'a[href="/workout"], button[aria-label="Start"], .tabbar a:nth-child(3)',
      popover: {
        title: t('Paso 4 de 5 · Empezar a entrenar'),
        description: t('Antes de arrancar podés anotar tu peso previo (opción desactivable). Durante la sesión vas a ir registrando series, repeticiones y cargas.'),
        side: 'top',
        align: 'center',
      },
    },
    {
      element: 'a[href="/settings"], button[aria-label="Settings"], .tabbar a:nth-child(5)',
      popover: {
        title: t('Paso 5 de 5 · Ajustes y perfil'),
        description: t('Ajustá tu perfil, rehacé la encuesta para recalcular tu plan y activá recordatorios para tus días de entrenamiento o pago de cuota.'),
        side: 'top',
        align: 'center',
      },
    },
  ]

  let driverObj = null

  const finish = () => {
    useStore.getState().update(s => { s.onboardingCompletado = true })
    if (driverObj) {
      driverObj.destroy()
    }
  }

  driverObj = driver({
    showProgress: false,
    animate: true,
    allowClose: true,
    overlayColor: 'rgba(0, 0, 0, 0.65)',
    nextBtnText: t('Siguiente →'),
    prevBtnText: t('← Atrás'),
    doneBtnText: t('¡Entendido!'),
    closeBtnText: t('Saltar'),
    steps: steps,
    onCloseClick: finish,
    onDestroyed: finish,
    onNextClick: async (element, step, opts) => {
      const idx = opts.state.activeIndex
      if (idx === 0) {
        driverObj.moveNext()
      } else if (idx === 1 && nav) {
        nav('/plan')
        await esperarElemento('a[href="/plan"], .tabbar a')
        driverObj.moveNext()
      } else if (idx === 2 && nav) {
        nav('/workout')
        await esperarElemento('a[href="/workout"], .tabbar a')
        driverObj.moveNext()
      } else if (idx === 3 && nav) {
        nav('/settings')
        await esperarElemento('a[href="/settings"], .tabbar a')
        driverObj.moveNext()
      } else {
        driverObj.moveNext()
      }
    },
  })

  driverObj.drive()
}

export function startTourB(force = false) {
  const S = useStore.getState().S
  if (!force && S.onboardingStatsCompletado) return

  const steps = [
    {
      element: '.card:has(.cal-grid), .card, .hdr',
      popover: {
        title: t('Paso 1 de 3 · Nivel de consistencia'),
        description: t('Revisá tu nivel de consistencia a través de los bloques de actividad de los últimos 2 meses.'),
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '.card:has(svg), .card:nth-of-type(2), .card',
      popover: {
        title: t('Paso 2 de 3 · Rendimiento & Balance'),
        description: t('Evaluá el balance entre grupos musculares, tu nivel de fatiga acumulada y el crecimiento de tu fuerza.'),
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '.card:has(.line-chart), .card:nth-of-type(3), .card',
      popover: {
        title: t('Paso 3 de 3 · Sobrecarga progresiva'),
        description: t('Consultá la gráfica de peso por ejercicio para verificar que estás aplicando sobrecarga progresiva.'),
        side: 'top',
        align: 'start',
      },
    },
  ]

  let driverObj = null

  const finish = () => {
    useStore.getState().update(s => { s.onboardingStatsCompletado = true })
    if (driverObj) {
      driverObj.destroy()
    }
  }

  driverObj = driver({
    showProgress: false,
    animate: true,
    allowClose: true,
    overlayColor: 'rgba(0, 0, 0, 0.65)',
    nextBtnText: t('Siguiente →'),
    prevBtnText: t('← Atrás'),
    doneBtnText: t('¡Entendido!'),
    closeBtnText: t('Saltar'),
    steps: steps,
    onCloseClick: finish,
    onDestroyed: finish,
  })

  driverObj.drive()
}
