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
      if (el) { observer.disconnect(); resolve(el) }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    setTimeout(() => { observer.disconnect(); resolve(null) }, timeoutMs)
  })
}

export { esperarElemento }

const POPOVER_CLASS = 'gym-tour-pop'

export function startTourA(nav, force = false) {
  const S = useStore.getState().S
  if (!force && S.onboardingCompletado) return

  const steps = [
    {
      element: '[data-tour="welcome"]',
      popover: {
        title: t('Paso 1 de 5 · Tu plan'),
        description: t('Desde acá podés generar tu plan personalizado respondiendo la encuesta, cargar la rutina predeterminada o diseñar una propia manualmente.'),
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="bw-card"]',
      popover: {
        title: t('Paso 2 de 5 · Peso corporal'),
        description: t('Llevá el seguimiento periódico de tu peso corporal para visualizar cambios a lo largo del tiempo.'),
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '#tabbar button:nth-child(2)',
      popover: {
        title: t('Paso 3 de 5 · Tu semana'),
        description: t('Organizá tu semana distribuyendo los días de entrenamiento y editando tus rutinas como prefieras.'),
        side: 'top',
        align: 'center',
      },
    },
    {
      element: '#tabbar button.start',
      popover: {
        title: t('Paso 4 de 5 · Empezar a entrenar'),
        description: t('Esta es tu pantalla de entrenamiento — anotás peso, repeticiones y series de cada ejercicio sobre la marcha. El pedido de peso previo es opcional, lo podés apagar.'),
        side: 'top',
        align: 'center',
      },
    },
    {
      element: '[data-tour="settings-btn"]',
      popover: {
        title: t('Paso 5 de 5 · Ajustes y perfil'),
        description: t('Ajustá tu perfil, rehacé la encuesta para recalcular tu plan y activá recordatorios para tus días de entrenamiento o pago de cuota.'),
        side: 'bottom',
        align: 'end',
      },
    },
  ]

  let driverObj = null

  const finish = () => {
    useStore.getState().update(s => { s.onboardingCompletado = true })
    if (driverObj) driverObj.destroy()
  }

  driverObj = driver({
    popoverClass: POPOVER_CLASS,
    showProgress: false,
    animate: true,
    allowClose: true,
    overlayColor: 'rgba(0,0,0,0.72)',
    nextBtnText: t('Siguiente →'),
    prevBtnText: t('← Atrás'),
    doneBtnText: t('¡Listo!'),
    closeBtnText: t('Saltar'),
    steps,
    onCloseClick: finish,
    onDestroyed: finish,
  })

  driverObj.drive()
}

export function startTourB(force = false) {
  const S = useStore.getState().S
  if (!force && S.onboardingStatsCompletado) return

  const steps = [
    {
      element: '[data-tour="activity-card"]',
      popover: {
        title: t('Paso 1 de 3 · Consistencia'),
        description: t('Revisá tu nivel de consistencia a través de los bloques de actividad de los últimos 12 meses.'),
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="muscle-card"]',
      popover: {
        title: t('Paso 2 de 3 · Rendimiento & Balance'),
        description: t('Evaluá el balance entre grupos musculares, tu nivel de fatiga acumulada y el crecimiento de tu fuerza.'),
        side: 'bottom',
        align: 'start',
      },
    },
    {
      element: '[data-tour="progress-card"]',
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
    if (driverObj) driverObj.destroy()
  }

  driverObj = driver({
    popoverClass: POPOVER_CLASS,
    showProgress: false,
    animate: true,
    allowClose: true,
    overlayColor: 'rgba(0,0,0,0.72)',
    nextBtnText: t('Siguiente →'),
    prevBtnText: t('← Atrás'),
    doneBtnText: t('¡Listo!'),
    closeBtnText: t('Saltar'),
    steps,
    onCloseClick: finish,
    onDestroyed: finish,
  })

  driverObj.drive()
}
