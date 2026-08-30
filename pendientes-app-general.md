# Pendientes — App general (openGym)

Mezcla de fixes chicos y features nuevas, no relacionadas al motor de rutinas.

---

## 1. Selección de ejercicio de cardio (arrastrado de la conversación anterior)

El mapeo cardio está invertido y no respeta el equipamiento disponible:

```js
// Está así:
suave_final    → cardio_treadmill
hiit           → cardio_stairmaster
caminar_correr → cardio_bike

// Debería ser:
suave_final    → cardio_treadmill  (o bici, es indistinto para "suave")
hiit           → cardio_stairmaster (o bici a intervalos)
caminar_correr → cardio_treadmill  ← corregido, "caminar/correr" es cinta, no bici
```

Agregar además un fallback bodyweight cuando `equipamiento === 'calistenia'` (hoy asigna `cardio_stairmaster` para HIIT sin importar que el usuario no tenga gimnasio) — ej. un cardio custom tipo `cardio_bodyweight_hiit` (jumping jacks / burpees / mountain climbers en intervalos) para ese caso.

---

## 2. Interruptor para no pedir el peso corporal siempre

Hoy, al empezar un entrenamiento, siempre se pide registrar el peso. Agregar:

- Un **toggle en el header** de la pantalla de "Empezar entrenamiento" (visible y accesible en el momento, no escondido en Configuración).
- Nuevo campo persistente por cuenta: `configuracion.pedirPesoAlEntrenar` (boolean, default `true` para no cambiar el comportamiento actual a quien no lo toque).
- Si está en `false`, saltear el prompt de peso por completo al iniciar cualquier entrenamiento — ir directo al chequeo rápido (si está activo) o directo a la rutina.
- Se guarda en `db.json` junto al resto de la configuración del usuario, no en estado local — así se respeta entre dispositivos una vez resuelto el punto 5.

---

## 3. "Chequeo rápido" — cerrar con X o tocando afuera

El cartel de chequeo rápido que aparece al empezar el entrenamiento (cuando el punto 2 está activo) necesita:

- Botón **X en la esquina superior derecha** del cartel, que lo cierra.
- Click/tap en el fondo (fuera del cartel) también lo cierra — mismo handler que la X.
- Cerrar de cualquiera de las dos formas equivale a "omitir" el chequeo — no debe bloquear el inicio del entrenamiento ni pedir confirmación extra.

---

## 4. Modo calendario: completar un día anterior + racha semanal

**Completar retroactivo:** si el usuario marca como hecho un entrenamiento de un día **anterior** (no hoy), ese día pasa a estado "hecho" para esa fecha específica — no se trata como si fuera "hoy".

**Racha semanal:** una semana cuenta para la racha si **todos los días programados de esa semana** (los días que tiene asignados la rutina, ej. Lunes/Miércoles/Viernes) quedaron marcados como hechos — los días de descanso no afectan el cálculo.

**Recalcular en cada cambio**, no solo hacia adelante: al marcar o desmarcar cualquier día (incluyendo retroactivamente uno pasado):
1. Recalcular si la semana que contiene ese día quedó completa o no.
2. Recalcular la racha completa: contar hacia atrás desde la semana completa más reciente, sumando semanas consecutivas completas, y cortar en la primera semana incompleta que aparezca.

Esto implica que completar retroactivamente un día atrasado **puede reparar una semana rota** y reconectar la racha si las semanas quedan consecutivas — es la intención que describiste, no un efecto secundario a evitar.

**Estructura sugerida por semana:**
```js
{
  semanaId: '2026-W35', // año-semana ISO
  diasProgramados: [1, 3, 5], // índices de día de semana con rutina asignada
  diasCompletados: [1, 3],    // cuáles de esos ya están hechos
  completa: false,            // diasCompletados.length === diasProgramados.length
}
```

**Caso borde:** la semana actual (en curso) no cuenta para la racha hasta que se complete — solo las semanas pasadas ya cerradas y completas suman.

---

## 5. Login desde la compu — botón "Iniciar sesión desde el celu"

**Hallazgo en `db.json`:** de los 6 usuarios actuales, 3 tienen `transports: ["hybrid", "internal"]` y 3 (los más nuevos: `test`, `testiiii` x2) tienen solo `["internal"]` — el híbrido nativo de WebAuthn ya está fallando para una parte de las cuentas reales, no es hipotético. Ver el punto de diagnóstico más abajo.

En vez de depender del QR nativo de WebAuthn (que tiene ~29-70% de abandono según el benchmark de Corbado 2026), armar un flujo propio tipo "device pairing" — mismo patrón que WhatsApp Web o el device flow de GitHub CLI. Reutiliza el mismo patrón de generación de código que ya tienen en `invites` (`code` random), pero más corto para tipeo manual.

**Flujo:**
1. Compu (sin sesión): botón "Iniciar sesión desde el celu" → `POST /api/auth/device/start` → genera `{ pairingId, manualCode, expiresAt }`. `pairingId` es un token largo/random para el QR (codifica una URL tipo `https://lauyim.online/pair?id=<pairingId>`); `manualCode` es corto y tipeable (8 caracteres, formato `XXXX-XXXX`, sin caracteres ambiguos como `0/O`, `1/I/l`).
2. Compu muestra las dos opciones lado a lado: el QR, y el código manual con instrucción "o andá a Configuración → Cuenta → Vincular dispositivo e ingresá este código".
3. Celu (ya logueado con passkey): escanea el QR (abre esa URL dentro de la sesión autenticada) **o** el usuario lo ingresa a mano en Configuración → Cuenta → Vincular dispositivo. Ambos caminos llegan al mismo endpoint autenticado: `POST /api/auth/device/claim` con `{ pairingId o manualCode }`.
4. Antes de aprobar, mostrar en el celu una pantalla de confirmación explícita ("¿Confirmás iniciar sesión en [navegador/SO detectado] ahora?") — esto es importante para seguridad: sin esa confirmación visible, alguien podría mostrar su QR/código en un lugar público y que otra persona lo escanee sin darse cuenta de qué está aprobando.
5. Compu hace polling a `GET /api/auth/device/poll?pairingId=...` cada ~2s. Al confirmarse desde el celu, devuelve la sesión real para ese `userId` y loguea.

**Sesión al finalizar el pairing:** el paso 5 tiene que emitir exactamente la misma `sessionCookie(user)` que ya usa `POST /api/login/verify` (línea 710 de `api/server.js`) — nada de un JWT ni mecanismo paralelo, reusar tal cual lo que ya existe.

**Bonus con el endpoint `POST /api/credentials/add` (ver punto 7):** una vez que la compu recibe la sesión vía pairing, ofrecerle "¿registrar una passkey también en esta compu?" usando ese mismo endpoint — así la próxima vez no depende del celu.

**Integración con push (`db.subs`):** en vez de que el usuario tenga que abrir la app y buscar manualmente "Vincular dispositivo", el servidor puede disparar `sendPush(userId, pairingRequestPush())` apenas arranca el pairing (`POST /api/auth/device/start` ya conoce el `userId` porque lo escribe el que INICIA el pairing... salvo que en este flujo el que arranca es la compu SIN sesión, así que el `userId` recién se conoce cuando el celu confirma — el push tendría que dispararse recién ahí, o pedir que el usuario ingrese su nombre en la compu antes de generar el pairing para poder buscarle las subs). Dejar el QR/código manual como fallback para cuando no hay suscripción push activa.

**Seguridad:** `pairingId` y `manualCode` de un solo uso, expiran a los 5 minutos, y el `manualCode` necesita límite de intentos (ej. 5 intentos fallidos y se invalida) porque es corto y se puede tipear a mano. No hace falta guardar esto en `db.json` — al ser de vida tan corta, alcanza con un `Map` en memoria del proceso Node con TTL, sin persistir a disco.

**Sobre el `transports: ["internal"]` de las 3 cuentas de test — cerrado, no es un bug:** confirmado en ambos endpoints. El registro no restringe `authenticatorAttachment` (se lo deja elegir al browser — la diferencia de transports entre cuentas es solo porque en esos registros se eligió "usar este dispositivo" en vez de "usar el celular"). Y `POST /api/login/options` pasa `allowCredentials: []`, el flujo estándar de discoverable credentials — el servidor no le dice al navegador qué credencial usar, así que lo guardado en `transports` no condiciona el login de ninguna cuenta. No hay nada que arreglar en el código de auth existente; el device pairing custom sigue siendo la mejora recomendada, pero por la tasa de abandono inherente al QR nativo, no por ningún bug.

## 6. Perfiles con el mismo nombre — no es un problema con passkey

Con passkey, la cuenta está atada al `user.id` interno que exige WebAuthn (un identificador binario propio, no el nombre visible). Mientras ese `id` sea el que se usa para todo (login, asociar rutinas, etc.) y el nombre sea solo un campo de display, **dos perfiles con el mismo nombre no generan ninguna colisión real** — es como en Discord o Instagram, el nombre se repite pero la cuenta es otra.

Lo único que vale la pena chequear en el código: que ningún lugar de la app busque o identifique al usuario **por nombre** en vez de por `user.id` (ej. al buscar rutinas, progreso, configuración). Si en algún punto se usa el nombre como clave, ahí sí hay que migrarlo al id antes de que sea un problema real.

## 7. Recuperación de cuenta si perdés el celular

Es el punto más importante de los tres, porque con solo passkey y sin ecosystem-sync, perder el dispositivo puede significar perder la cuenta para siempre. Dos escenarios posibles, hoy no sé cuál aplica en openGym:

- **Passkey sincronizada** (guardada en iCloud Keychain, Google Password Manager, o un gestor como 1Password/Bitwarden): si el usuario recupera acceso a esa cuenta de Apple/Google (o instala el gestor en un teléfono nuevo), la passkey reaparece sola — no hace falta nada de parte de openGym.
- **Passkey atada solo al dispositivo** (sin sync): si se pierde el celular, se pierde la passkey para siempre, sin ningún camino de recuperación posible, salvo que openGym ofrezca un método alternativo.

**Recomendación estándar de la industria (y la única forma real de resolver esto):** permitir registrar **más de una passkey por cuenta** desde el arranque — así el usuario puede sumar una segunda passkey en otro dispositivo (o en un gestor de contraseñas) como backup, exactamente como recomienda FIDO Alliance. Confirmado en `db.json`: hoy `creds[]` tiene exactamente 1 registro por `userId`, sin excepción, y `users[]` no tiene ningún campo de email — no hay backup de passkey ni canal de recuperación alternativo. Es el cambio a priorizar antes que el resto de este documento — sin una segunda passkey de respaldo o un canal de recuperación por email, perder el celular hoy significa perder la cuenta sin ningún camino de vuelta.
