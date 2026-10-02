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

// title: el nombre de la app de la instancia (Personalización).
export function testPush(lang, title = 'lauyim') {
  return { title, body: copyFor(lang).testBody, tag: 'test' };
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

// ---- clases (docs/superpowers/specs/2026-10-01-clases-design.md) ----

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const dayNum = date => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86400000;
const classData = (date, sessionId) => ({ tag: `class-${sessionId}`, data: { redirectUrl: `/#/plan/clases?d=${date}` } });
// "de hoy", "de mañana" o "del miércoles 7".
function dayRef(date, today) {
  const diff = dayNum(date) - dayNum(today);
  if (diff === 0) return 'de hoy';
  if (diff === 1) return 'de mañana';
  return `del ${WEEKDAYS[new Date(dayNum(date) * 86400000).getUTCDay()]} ${Number(date.slice(8, 10))}`;
}
const inMinutes = m => m >= 60 ? (m === 60 ? 'en 1 hora' : `en ${m / 60} horas`) : `en ${m} minutos`;

// Recordatorio de una clase reservada: "Spinning · 19:00" / "Hoy con Caro, en Sala 2. Empieza en 1 hora."
export function classReminderPush({ name, date, today, start, movedFrom, teacher, room, minutes, sessionId }) {
  const day = date === today ? 'Hoy' : 'Mañana';
  const where = movedFrom
    ? `${day} cambió a las ${start}.`
    : `${day}${teacher ? ` con ${teacher}` : ''}${room ? `, en ${room}` : ''}.`;
  return { title: `${name} · ${start}`, body: `${where} Empieza ${inMinutes(minutes)}.`, ...classData(date, sessionId) };
}

// Avisos de una fecha de clase: moved | teacher | cancelled | promoted | waitlisted.
export function classChangePush(kind, { name, date, today, start, movedFrom, teacher, sessionId }) {
  const ref = dayRef(date, today);
  const body = {
    moved: `${name} ${ref} pasa a las ${start}${movedFrom ? ` (era a las ${movedFrom})` : ''}.`,
    teacher: `${name} ${ref} lo da ${teacher}.`,
    cancelled: `${name} ${ref} se suspende.`,
    promoted: `Entraste a ${name} ${ref} a las ${start}: se liberó un lugar.`,
    waitlisted: `${name} ${ref} está llena: quedaste en la lista de espera.`
  }[kind];
  return { title: `${name} · ${start}`, body, ...classData(date, sessionId) };
}
