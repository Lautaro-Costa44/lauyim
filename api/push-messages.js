const COPY = {
  en: {
    restTitle: 'Rest over 💪',
    restBody: 'Time for your next set.',
    testBody: 'Test notification ✅ — this is what alerts look like.',
    dayFallbackTitle: 'Workout planned today',
    dayRoutineSuffix: 'today',
    dayBody: "It's on your plan — let's go 💪",
  },
  es: {
    restTitle: 'Descanso terminado 💪',
    restBody: 'Es hora de tu siguiente serie.',
    testBody: 'Notificación de prueba ✅ — así se muestran las alertas.',
    dayFallbackTitle: 'Entrenamiento planificado para hoy',
    dayRoutineSuffix: 'hoy',
    dayBody: 'Está en tu plan — vamos 💪',
  },
};

const copyFor = lang => lang === 'en' ? COPY.en : COPY.es;

export function restTimerPush(lang) {
  const copy = copyFor(lang);
  return { title: copy.restTitle, body: copy.restBody, tag: 'rest-timer' };
}

export function testPush(lang) {
  return { title: 'lauyim', body: copyFor(lang).testBody, tag: 'test' };
}

export function dayReminderPush(lang, routine) {
  const copy = copyFor(lang);
  return {
    title: routine
      ? `${routine.emoji || '🏋️'} ${routine.name} ${copy.dayRoutineSuffix}`
      : copy.dayFallbackTitle,
    body: copy.dayBody,
    tag: 'day-reminder',
  };
}

export function gymFeePush(lang, interval) {
  const spanish = lang !== 'en'
  const labels = spanish
    ? { monthly: 'mensual', quarterly: 'trimestral', bimonthly: 'bimensual', annual: 'anual' }
    : { monthly: 'monthly', quarterly: 'quarterly', bimonthly: 'every two months', annual: 'annual' }
  return {
    title: spanish ? 'Cuota del gimnasio' : 'Gym membership fee',
    body: spanish ? `Recuerda pagar tu cuota ${labels[interval] || labels.monthly}.` : `Remember to pay your ${labels[interval] || labels.monthly} gym membership fee.`,
    tag: 'gym-fee'
  }
}

// Aviso automático de Cuotas v1: el vencimiento lo carga el gym, no el socio.
export function billingDuePush(lang, daysLeft) {
  const spanish = lang !== 'en'
  const days = Math.max(0, Math.trunc(Number(daysLeft) || 0))
  const when = spanish
    ? (days === 0 ? 'vence hoy' : days === 1 ? 'vence mañana' : `vence en ${days} días`)
    : (days === 0 ? 'is due today' : days === 1 ? 'is due tomorrow' : `is due in ${days} days`)
  return {
    title: spanish ? 'Tu cuota está por vencer' : 'Your membership is almost due',
    body: spanish ? `Tu cuota ${when}. Renovala en recepción.` : `Your membership ${when}. Renew it at the front desk.`,
    tag: 'billing-due'
  }
}
