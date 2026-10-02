// Textos de los avisos push. Estilo: vos, sin rayas, un emoji como mucho y el título dice qué pasó
// (en la pantalla bloqueada se lee primero el título).
const COPY = {
  en: {
    restTitle: 'Rest over 💪',
    restBody: 'Time for your next set.',
    testBody: 'This is how your alerts will look ✅',
    dayFallbackTitle: 'Workout day 🏋️',
    dayRoutineTitle: name => `${name} today 🏋️`,
    dayBody: "It's on your plan. Let's go!",
  },
  es: {
    restTitle: 'Descanso terminado 💪',
    restBody: 'Es hora de tu siguiente serie.',
    testBody: 'Así te van a llegar los avisos ✅',
    dayFallbackTitle: 'Hoy toca entrenar 🏋️',
    dayRoutineTitle: name => `Hoy toca ${name} 🏋️`,
    dayBody: 'Está en tu plan. ¡Vamos!',
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

// routine: la rutina que toca hoy ({ name }) o null. El emoji de la rutina es un ícono de la app,
// no un emoji: no va en el aviso.
export function dayReminderPush(lang, routine) {
  const copy = copyFor(lang);
  return {
    title: routine?.name ? copy.dayRoutineTitle(routine.name) : copy.dayFallbackTitle,
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
    body: spanish ? `Recordá pagar tu cuota ${labels[interval] || labels.monthly}.` : `Remember to pay your ${labels[interval] || labels.monthly} gym membership fee.`,
    tag: 'gym-fee'
  }
}

// Aviso automático de Cuotas v1: el vencimiento lo carga el gym, no el socio.
export function billingDuePush(lang, daysLeft) {
  const spanish = lang !== 'en'
  const days = Math.max(0, Math.trunc(Number(daysLeft) || 0))
  const when = spanish
    ? (days === 0 ? 'hoy' : days === 1 ? 'mañana' : `en ${days} días`)
    : (days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`)
  return {
    title: spanish ? `Tu cuota vence ${when}` : `Your membership is due ${when}`,
    body: spanish ? 'Renovala en recepción para seguir entrenando.' : 'Renew it at the front desk to keep training.',
    tag: 'billing-due'
  }
}

// ---- clases (docs/superpowers/specs/2026-10-01-clases-design.md) ----

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const dayNum = date => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86400000;
const classData = (date, sessionId) => ({ tag: `class-${sessionId}`, data: { redirectUrl: `/#/plan/clases?d=${date}` } });
// "de hoy", "de mañana" o "del miércoles 7" (Spinning de hoy).
function dayRef(date, today) {
  const diff = dayNum(date) - dayNum(today);
  if (diff === 0) return 'de hoy';
  if (diff === 1) return 'de mañana';
  return `del ${WEEKDAYS[new Date(dayNum(date) * 86400000).getUTCDay()]} ${Number(date.slice(8, 10))}`;
}
// "hoy", "mañana" o "el miércoles 7" (un lugar para hoy).
const dayWord = (date, today) => dayRef(date, today).replace(/^de /, '').replace(/^del /, 'el ');
const ddmm = date => `${date.slice(8, 10)}/${date.slice(5, 7)}`;
const inMinutes = m => m < 60 ? `en ${m} minutos`
  : m % 60 ? `en ${Math.floor(m / 60)} h ${m % 60} min`
  : m === 60 ? 'en 1 hora' : `en ${m / 60} horas`;

// Recordatorio de una clase reservada: "Spinning empieza en 1 hora" / "Hoy a las 19:00 con Caro, en Sala 2."
export function classReminderPush({ name, date, today, start, movedFrom, teacher, room, minutes, sessionId }) {
  const day = date === today ? 'Hoy' : 'Mañana';
  const body = `${day} a las ${start}${movedFrom ? ` (cambió, era a las ${movedFrom})` : ''}${teacher ? ` con ${teacher}` : ''}${room ? `, en ${room}` : ''}.`;
  return { title: `${name} empieza ${inMinutes(minutes)}`, body, ...classData(date, sessionId) };
}

// Avisos de una fecha de clase: moved | teacher | cancelled | promoted | waitlisted | added |
// fee_blocked | penalty_blocked. prevTeacher: la profe de antes (teacher); waitlistPos: el lugar en
// la lista de espera (waitlisted); until: desde cuándo puede volver a reservar (penalty_blocked).
export function classChangePush(kind, { name, date, today, start, movedFrom, teacher, prevTeacher, waitlistPos, until, sessionId }) {
  const ref = dayRef(date, today);
  const at = `${name} ${ref} a las ${start}`;
  const teacherBody = teacher
    ? `${at} lo da ${teacher}${prevTeacher && prevTeacher !== teacher ? ` en lugar de ${prevTeacher}` : ''}.`
    : prevTeacher ? `${at} ya no lo da ${prevTeacher}.` : `${at} cambió de profe.`;
  const text = {
    moved: ['Cambio de horario: ' + name, `${name} ${ref} pasa a las ${start}${movedFrom ? ` (era a las ${movedFrom})` : ''}.`],
    teacher: ['Cambio de profe: ' + name, teacherBody],
    cancelled: [`Se suspendió ${name}`, `${at} no se da. Tu lugar quedó liberado.`],
    promoted: [`¡Entraste a ${name}!`, `Se liberó un lugar para ${dayWord(date, today)} a las ${start}. Si no podés ir, cancelala así entra otra persona.`],
    waitlisted: ['Lista de espera: ' + name, `${at} está llena. Quedaste ${waitlistPos ? `n.º ${waitlistPos} ` : ''}en la lista de espera; si se libera un lugar, te avisamos.`],
    added: [`Te anotaron a ${name}`, `Tenés lugar ${dayWord(date, today)} a las ${start}. Si no podés ir, cancelala desde la app.`],
    fee_blocked: ['No pudimos anotarte', `Tu reserva fija de ${name} ${ref} no se hizo porque tu cuota está vencida. Regularizala en recepción.`],
    penalty_blocked: ['No pudimos anotarte', `Tu reserva fija de ${name} ${ref} no se hizo por las ausencias.${until ? ` Podés volver a reservar desde el ${ddmm(until)}.` : ''}`]
  }[kind];
  return { title: text[0], body: text[1], ...classData(date, sessionId) };
}

// Después de una clase sin respuesta: "¿Fuiste a Spinning?".
export function classAfterPush({ name, date, sessionId }) {
  return { title: `¿Fuiste a ${name}?`, body: 'Tocá para sumarla a tu historial y calificarla.', ...classData(date, sessionId) };
}
