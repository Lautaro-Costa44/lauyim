/**
 * Scheduler para recordatorios automáticos (entrenamiento y cuota de gym)
 */

import webpush from 'web-push';
import { getDatabase, deleteSubscription } from './database.js';
import { dayReminderPush, gymFeePush } from './push-messages.js';

const PUSH_TIMEOUT_MS = 10000;

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
 *   Si `fee_date` no está definido, se toma por defecto el día 1 del mes actual.
 */

async function sendPushToUser(userId, payload) {
  const db = getDatabase();
  const subsStmt = db.prepare('SELECT endpoint, keys FROM subscriptions WHERE user_id = ?');
  const rawSubs = subsStmt.all(userId);
  if (!rawSubs || rawSubs.length === 0) return;

  const body = JSON.stringify(payload);
  for (const sub of rawSubs) {
    const keys = typeof sub.keys === 'string' ? JSON.parse(sub.keys) : sub.keys;
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys }, body, {
        urgency: 'high',
        timeout: PUSH_TIMEOUT_MS
      });
      console.log(`[Scheduler] Push exitoso (${payload.tag || 'reminder'}) -> user_id=${userId}`);
    } catch (e) {
      console.error(`[Scheduler] Push fallido -> user_id=${userId}, status=${e.statusCode}, error=${e.body || e.message}`);
      if (e.statusCode === 404 || e.statusCode === 410) {
        console.log(`[Scheduler] Suscripción expirada/inválida (${e.statusCode}), eliminando endpoint: ${sub.endpoint}`);
        deleteSubscription(sub.endpoint);
      }
    }
  }
}

function checkGymFeeDue(feeDateStr, feeInterval, localDateStr) {
  if (!feeDateStr) {
    // Si no hay fecha de cuota configurada, por defecto se avisa el día 1 de cada mes
    const [, , day] = localDateStr.split('-');
    return day === '01';
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
  } catch {
    // Fallback a UTC si la zona horaria es inválida
    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10);
    const timeStr = now.toISOString().slice(11, 16);
    return { dateStr, timeStr };
  }
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
        rs.fee_date
      FROM users u
      LEFT JOIN reminder_settings rs ON u.id = rs.user_id
      WHERE u.disabled = 0
    `);

    const users = stmt.all();
    for (const u of users) {
      const tz = u.reminder_tz || 'UTC';
      const { dateStr, timeStr } = getLocalParts(tz);

      // 1. Recordatorio de entrenamiento
      if (u.reminder_on === 1 && u.reminder_time) {
        if (u.reminder_time === timeStr) {
          if (u.last_reminder_sent_date !== dateStr) {
            console.log(`[Scheduler] Disparando recordatorio de entrenamiento para user_id=${u.id} a las ${timeStr} (${tz})`);
            // Buscar idioma del usuario si existe
            let lang = 'es';
            try {
              const stateRow = db.prepare('SELECT lang FROM user_state WHERE user_id = ?').get(u.id);
              if (stateRow && stateRow.lang) lang = stateRow.lang;
            } catch {}

            // Buscar rutina activa de hoy si la hubiera (opcional, dayReminderPush maneja fallback)
            const payload = dayReminderPush(lang, null);
            sendPushToUser(u.id, payload).then(() => {
              db.prepare('UPDATE users SET last_reminder_sent_date = ? WHERE id = ?').run(dateStr, u.id);
            });
          }
        }
      }

      // 2. Recordatorio de cuota de gym
      if (u.fee_on === 1) {
        if (checkGymFeeDue(u.fee_date, u.fee_interval, dateStr)) {
          if (u.last_fee_reminder_sent_date !== dateStr) {
            console.log(`[Scheduler] Disparando recordatorio de cuota de gym para user_id=${u.id} (${u.fee_interval})`);
            let lang = 'es';
            try {
              const stateRow = db.prepare('SELECT lang FROM user_state WHERE user_id = ?').get(u.id);
              if (stateRow && stateRow.lang) lang = stateRow.lang;
            } catch {}

            const payload = gymFeePush(lang, u.fee_interval || 'monthly');
            sendPushToUser(u.id, payload).then(() => {
              db.prepare('UPDATE users SET last_fee_reminder_sent_date = ? WHERE id = ?').run(dateStr, u.id);
            });
          }
        }
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
