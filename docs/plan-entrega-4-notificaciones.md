# Entrega 4 — Paso de notificaciones en el primer ingreso

Rama: `claude/entrega-4-notificaciones` (desde `main`).

## Auditoría

- Push: `lib/push.js` (`pushSupported`, `enablePush` pide el permiso y suscribe, `disablePush`).
  El único lugar donde se activa hoy es Settings → Notificaciones (`PushCard`).
- Primer ingreso: `Home.jsx` arranca el tour (`startTourA`) mientras `S.onboardingCompletado` sea
  falso; la encuesta se abre desde el cartel de bienvenida de Inicio. No hay paso previo.
- iOS: el push web solo funciona con la app agregada a la pantalla de inicio (iOS/iPadOS 16.4+).
  `lib/api.js` tiene `IS_APPLE` (incluye Mac); no hay detección de "instalada".
- `App.jsx` (`Shell`) ya decide pantallas completas antes de las rutas (licencia, login, bloqueo).

## Plan

1. `lib/notif-step.js`: `isIOS()` (iPhone/iPod/iPad, y iPad que se presenta como Mac),
   `isStandalone()` (`display-mode: standalone` o `navigator.standalone`), `notifStepKind()` →
   `'ios-install'` | `'enable'` | `null` (sin soporte, o el permiso ya se decidió), y la marca
   por dispositivo y cuenta (`gym_notif_step:<uid>` en localStorage).
2. `views/NotificationsStep.jsx`, pantalla completa (mismo patrón que `MembershipBlocked`):
   - `enable`: explicación (qué avisos llegan) + "Activar" (el prompt nativo sale del toque) /
     "Ahora no". Si el permiso se niega o falla, se sigue igual.
   - `ios-install`: instrucciones para agregar la app a la pantalla de inicio (Compartir →
     Agregar a inicio → abrir desde el ícono) + "Entendido".
   - Cualquier botón marca el paso como hecho: **nunca es obligatorio** y no vuelve.
3. `App.jsx`: se muestra a un socio con sesión en su primer ingreso (`!S.onboardingCompletado`,
   o sea antes del tour y de la encuesta), si no se hizo en este dispositivo y si hay algo que
   ofrecer. Sin TabBar mientras está.
4. Tests: `lib/notif-step.test.js` y `views/NotificationsStep.test.jsx`.

Sin librerías nuevas.

## Decisiones propias / PREGUNTAS

- La marca es **por dispositivo** (las suscripciones push también lo son). Un socio que ya
  terminó el onboarding no lo ve en un dispositivo nuevo: queda Settings.
- También se muestra a staff en su primer ingreso (los avisos del gym les sirven igual).
  **PREGUNTA:** ¿excluir a admins?
- **PREGUNTA:** en iOS sin instalar, el paso solo explica cómo instalar (no se puede pedir el
  permiso desde Safari). Al abrir la app instalada ya pasó el primer ingreso: el socio activa desde
  Settings. Alternativa: volver a ofrecer el paso la primera vez que abre la app instalada.
- Orden con la entrega 3 (rama aparte, desde `main`): pendiente → formulario de datos →
  notificaciones → tour/encuesta. Al mergear las dos ramas, en `App.jsx` va primero `askProfile`
  y después `askNotif` (conflicto chico y previsto).
