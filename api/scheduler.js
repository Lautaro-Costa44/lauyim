/**
 * Scheduler para recordatorios automáticos (entrenamiento y cuota de gym)
 */

import { getDatabase, getUserState, markDuePushSent } from './database.js';
import { sendPushToSubscription } from './push-send.js';
import { dayReminderPush, gymFeePush, billingDuePush } from './push-messages.js';
import { getBillingSettings, gymClock, shouldSendDuePush, daysBetween } from './billing.js';

// Aviso de cuota (Cuotas v1): no antes de esta hora local del gym.
const BILLING_PUSH_FROM = '10:00';
// Avisos de cuota en vuelo (user_id:due_date). El envío es asíncrono y el tick corre cada
// minuto: sin esto, un push lento se volvería a disparar antes de guardar push_sent_for_due.
const billingPushInFlight = new Set();

/**
 * Lógica documentada para la cuota de gym (fee_interval + fee_date):
 * - `fee_date` se almacena como fecha base (ej. '2026-09-01' o similar).
 * - `fee_interval` puede ser 'monthly' (mensual), 'bimonthly' (bimensual / cada 2 meses),
 *   'quarterly' (trimestral / cada 3 meses), o 'annual' (anual / cada 12 meses).
 * - Regla de cálculo: Tomamos la fecha base `fee_date`. Calculamos si la fecha local actual
 *   coincide con el día de pago calculado sumando N intervalos (meses) desde la fecha base,
 *   o de forma simplificada y robusta para recordatorios recurrentes:
 *   si el día del mes actual coincide con el día del mes de `fee_date`, y han transcurrido
 *   un número entero de meses exacto según `fee_interval` (1 para monthly, 2 para bimonthly,
 *   3 para quarterly, 12 para annual) desde la fecha base, entonces hoy corresponde el aviso de cuota.
 *   Si `fee_date` no está definido, no se envía ningún aviso: falta la fecha de vencimiento.
 */

async function sendPushToUser(userId, payload) {
  const db = getDatabase();
  const subsStmt = db.prepare('SELECT endpoint, keys FROM subscriptions WHERE user_id = ?');
  const rawSubs = subsStmt.all(userId);
  const subCount = rawSubs ? rawSubs.length : 0;
  
  const debugUserId = process.env.DEBUG_USER_ID;
  const isDebug = !debugUserId || debugUserId === userId;

  if (isDebug) {
    console.log(`[Scheduler Diagnostic] user_id=${userId} | suscripciones encontradas=${subCount}`);
  }

  if (!rawSubs || rawSubs.length === 0) return { sent: 0, subCount };

  const body = JSON.stringify(payload);
  let sentCount = 0;
  for (const sub of rawSubs) {
    try {
      await sendPushToSubscription(sub, body);
      sentCount++;
      if (isDebug) {
        console.log(`[Scheduler Diagnostic] Push exitoso (${payload.tag || 'reminder'}) -> user_id=${userId}, endpoint=${sub.endpoint}`);
      }
      console.log(`[Scheduler] Push exitoso (${payload.tag || 'reminder'}) -> user_id=${userId}`);
    } catch (e) {
      if (isDebug) {
        console.log(`[Scheduler Diagnostic] Push fallido -> user_id=${userId}, endpoint=${sub.endpoint}, status=${e.statusCode}, error=${e.body || e.message}`);
      }
      console.error(`[Scheduler] Push fallido -> user_id=${userId}, status=${e.statusCode}, error=${e.body || e.message}`);
      if (e.statusCode === 404 || e.statusCode === 410) {
        console.log(`[Scheduler] Suscripción expirada/inválida (${e.statusCode}), eliminando endpoint: ${sub.endpoint}`);
      }
    }
  }
  return { sent: sentCount, subCount };
}

function checkGymFeeDue(feeDateStr, feeInterval, localDateStr) {
  if (!feeDateStr) {
    return false;
  }

  try {
    const [baseY, baseM, baseD] = feeDateStr.split('-').map(Number);
    const [currY, currM, currD] = localDateStr.split('-').map(Number);

    if (baseD !== currD) return false;

    const totalBaseMonths = baseY * 12 + (baseM - 1);
    const totalCurrMonths = currY * 12 + (currM - 1);
    const diffMonths = totalCurrMonths - totalBaseMonths;

    if (diffMonths < 0) return false;

    let intervalMonths = 1;
    if (feeInterval === 'bimonthly') intervalMonths = 2;
    else if (feeInterval === 'quarterly') intervalMonths = 3;
    else if (feeInterval === 'annual') intervalMonths = 12;

    return diffMonths % intervalMonths === 0;
  } catch (err) {
    console.error('[Scheduler] Error calculando fee due:', err);
    return false;
  }
}

function getLocalParts(tz) {
  try {
    const options = {
      timeZone: tz || 'UTC',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    };
    const formatter = new Intl.DateTimeFormat('en-CA', options);
    const parts = formatter.formatToParts(new Date());
    const map = {};
    for (const p of parts) {
      if (p.type !== 'literal') map[p.type] = p.value;
    }
    const dateStr = `${map.year}-${map.month}-${map.day}`;
    const timeStr = `${map.hour}:${map.minute}`;
    return { dateStr, timeStr };
  } catch (err) {
    console.warn(`[Scheduler Diagnostic WARNING] Zona horaria inválida o fallida '${tz}', usando fallback a UTC. Error:`, err.message);
    // Fallback a UTC si la zona horaria es inválida
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toISOString().slice(11, 16);
    return { dateStr, timeStr };
  }
}

function effectiveRoutineId(state, dateStr) {
  const override = state?.dayPlan?.[dateStr];
  if (override === 'rest' || (override && typeof override === 'object' &&
      ['descanso', 'completado'].includes(override.estado))) return null;
  if (override && typeof override === 'object' && override.estado === 'rutina') {
    return override.rutinaId || null;
  }
  if (typeof override === 'string' && state?.routines?.some(r => r.id === override)) return override;
  const weekday = new Date(`${dateStr}T12:00:00`).getDay();
  return state?.week?.[weekday] || null;
}

function hasWorkoutOnDate(state, dateStr) {
  return (state?.workouts || []).some(workout => workout.d === dateStr);
}

export function runSchedulerTick() {
  try {
    const db = getDatabase();
    const stmt = db.prepare(`
      SELECT 
        u.id as user_id, 
        u.last_reminder_sent_date, 
        u.last_fee_reminder_sent_date,
        rs."on" as reminder_on,
        rs.time as reminder_time,
        rs.tz as reminder_tz,
        rs.fee_on,
        rs.fee_interval,
        rs.fee_date,
        mb.plan_id,
        mb.due_date,
        mb.push_sent_for_due
      FROM users u
      LEFT JOIN reminder_settings rs ON u.id = rs.user_id
      LEFT JOIN member_billing mb ON u.id = mb.user_id
      WHERE u.disabled = 0
    `);

    const users = stmt.all();
    // Cuotas v1: un solo "hoy" y una sola hora del gym por tick, iguales para todos los socios.
    const billingSettings = getBillingSettings(db);
    const gymNow = gymClock(Date.now(), billingSettings.gym_tz);
    const serverUtcIso = new Date().toISOString();
    const debugUserId = process.env.DEBUG_USER_ID;

    for (const u of users) {
      try {
        if (debugUserId && u.user_id !== debugUserId) {
          continue;
        }

        const tz = u.reminder_tz || 'UTC';
        const { dateStr, timeStr } = getLocalParts(tz);

        const rawRowLog = {
          reminder_on: u.reminder_on,
          reminder_time: u.reminder_time,
          reminder_tz: u.reminder_tz,
          last_reminder_sent_date: u.last_reminder_sent_date
        };

        console.log(`[Scheduler Diagnostic Tick] user_id=${u.user_id} | utc_server=${serverUtcIso} | local_tz=${tz} (local_time=${timeStr}, local_date=${dateStr}) | raw_settings=`, JSON.stringify(rawRowLog));

        // 1. Recordatorio de entrenamiento
        if (u.reminder_on === 1 && u.reminder_time) {
          const timeMatch = u.reminder_time === timeStr;
          console.log(`[Scheduler Diagnostic] user_id=${u.user_id} | training reminder check | configured_time=${u.reminder_time} vs local_time=${timeStr} -> match=${timeMatch ? 'MATCH' : 'NO MATCH'}`);

          const state = getUserState(u.user_id) || {};
          const routineId = effectiveRoutineId(state, dateStr);
          const workoutAlreadyLogged = hasWorkoutOnDate(state, dateStr);
          const hasTrainingToday = !!routineId && !workoutAlreadyLogged;
          console.log(`[Scheduler Diagnostic] user_id=${u.user_id} | training plan check | routine=${routineId || 'none'} | workout_today=${workoutAlreadyLogged} -> eligible=${hasTrainingToday}`);

          if (timeMatch && hasTrainingToday) {
            const sentToday = u.last_reminder_sent_date === dateStr;
            console.log(`[Scheduler Diagnostic] user_id=${u.user_id} | training reminder already_sent_today check | last_sent=${u.last_reminder_sent_date}, today=${dateStr} -> status=${sentToday ? 'DESCARTADO (ya enviado hoy)' : 'PASAS (enviar)'}`);

            if (!sentToday) {
              console.log(`[Scheduler] Disparando recordatorio de entrenamiento para user_id=${u.user_id} a las ${timeStr} (${tz})`);
              // Buscar idioma del usuario si existe
              let lang = 'es';
              try {
                const stateRow = db.prepare('SELECT lang FROM user_state WHERE user_id = ?').get(u.user_id);
                if (stateRow && stateRow.lang) lang = stateRow.lang;
              } catch {}

              const payload = dayReminderPush(lang, null);
              sendPushToUser(u.user_id, payload).then(res => {
                // A reminder is considered sent only when at least one subscription
                // accepted it. This keeps a transient push outage retryable.
                if (res.sent < 1) throw new Error('No se entregó el recordatorio a ninguna suscripción');
                db.prepare('UPDATE users SET last_reminder_sent_date = ? WHERE id = ?').run(dateStr, u.user_id);
                console.log(`[Scheduler Diagnostic] Guardado exitoso de last_reminder_sent_date=${dateStr} para user_id=${u.user_id}`);
                console.log(`[Scheduler Diagnostic] user_id=${u.user_id} | training reminder sent result: sent=${res.sent}, subscriptions=${res.subCount}`);
              }).catch(err => {
                console.error(`[Scheduler] Error al enviar/guardar recordatorio de entrenamiento para user_id=${u.user_id}:`, err);
              });
            }
          }
        }

        // 2. Recordatorio de cuota de gym (manual, lo configura el socio). Con un plan asignado
        // por el gym manda el aviso automático de abajo, no este.
        if (u.fee_on === 1 && u.plan_id == null) {
          const feeDue = checkGymFeeDue(u.fee_date, u.fee_interval, dateStr);
          console.log(`[Scheduler Diagnostic] user_id=${u.user_id} | gym fee check | fee_date=${u.fee_date}, interval=${u.fee_interval} -> match=${feeDue ? 'MATCH' : 'NO MATCH'}`);

          if (feeDue) {
            const feeSentToday = u.last_fee_reminder_sent_date === dateStr;
            console.log(`[Scheduler Diagnostic] user_id=${u.user_id} | gym fee already_sent_today check | last_sent=${u.last_fee_reminder_sent_date}, today=${dateStr} -> status=${feeSentToday ? 'DESCARTADO (ya enviado hoy)' : 'PASAS (enviar)'}`);

            if (!feeSentToday) {
              console.log(`[Scheduler] Disparando recordatorio de cuota de gym para user_id=${u.user_id} (${u.fee_interval})`);
              let lang = 'es';
              try {
                const stateRow = db.prepare('SELECT lang FROM user_state WHERE user_id = ?').get(u.user_id);
                if (stateRow && stateRow.lang) lang = stateRow.lang;
              } catch {}

              const payload = gymFeePush(lang, u.fee_interval || 'monthly');
              sendPushToUser(u.user_id, payload).then(res => {
                if (res.sent < 1) throw new Error('No se entregó el recordatorio de cuota a ninguna suscripción');
                db.prepare('UPDATE users SET last_fee_reminder_sent_date = ? WHERE id = ?').run(dateStr, u.user_id);
                console.log(`[Scheduler Diagnostic] Guardado exitoso de last_fee_reminder_sent_date=${dateStr} para user_id=${u.user_id}`);
                console.log(`[Scheduler Diagnostic] user_id=${u.user_id} | gym fee reminder sent result: sent=${res.sent}, subscriptions=${res.subCount}`);
              }).catch(err => {
                console.error(`[Scheduler] Error al enviar/guardar recordatorio de cuota para user_id=${u.user_id}:`, err);
              });
            }
          }
        }

        // 3. Aviso automático de vencimiento (Cuotas v1): socios con plan asignado, una vez por
        // vencimiento, desde BILLING_PUSH_FROM en la hora del gym.
        const billing = { planId: u.plan_id, dueDate: u.due_date, pushSentForDue: u.push_sent_for_due };
        const billingKey = `${u.user_id}:${u.due_date}`;
        if (u.plan_id != null && gymNow.time >= BILLING_PUSH_FROM && !billingPushInFlight.has(billingKey)
            && shouldSendDuePush(billing, gymNow.date, billingSettings)) {
          let lang = 'es';
          try {
            const stateRow = db.prepare('SELECT lang FROM user_state WHERE user_id = ?').get(u.user_id);
            if (stateRow && stateRow.lang) lang = stateRow.lang;
          } catch {}
          const daysLeft = daysBetween(gymNow.date, u.due_date);
          console.log(`[Scheduler] Disparando aviso de vencimiento de cuota para user_id=${u.user_id} (vence ${u.due_date}, faltan ${daysLeft} días)`);
          billingPushInFlight.add(billingKey);
          sendPushToUser(u.user_id, billingDuePush(lang, daysLeft)).then(res => {
            if (res.sent < 1) throw new Error('No se entregó el aviso de vencimiento a ninguna suscripción');
            markDuePushSent(u.user_id, u.due_date);
          }).catch(err => {
            console.error(`[Scheduler] Error al enviar/guardar aviso de vencimiento para user_id=${u.user_id}:`, err);
          }).finally(() => billingPushInFlight.delete(billingKey));
        }
      } catch (userErr) {
        console.error(`[Scheduler] Error procesando usuario user_id=${u.user_id}:`, userErr);
      }
    }
  } catch (err) {
    console.error('[Scheduler] Error en tick del scheduler:', err);
  }
}

export function startScheduler() {
  console.log('[Scheduler] Iniciando loop periódico de recordatorios (cada 1 minuto)...');
  // Ejecutar un tick inicial a los pocos segundos y luego cada 60s
  setInterval(runSchedulerTick, 60 * 1000);
}
