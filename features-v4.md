# Pendientes v4 — Reemplazo ampliado, onboarding interactivo, gasto calórico

## 1. Botón "Ver más" al reemplazar un ejercicio

Extiende el modo de reemplazo (sección 7 de `pendientes-v3-bugs-y-reemplazo.md`). Hoy muestra 3 alternativas. Se agrega:

- **"Ver más"** → siguientes 5 alternativas (mismo pool ya filtrado por `tg`, sin repetir las 3 ya mostradas ni ids usados en la semana). Acá no hace falta mantener la restricción de diversidad de `patronDeMovimiento` que sí aplica a las 3 iniciales — para "ver más" alcanza con no repetir ejercicio.

```js
function obtenerMasAlternativas(ejercicioActual, poolSeguro, idsUsadosEnLaSemana, yaMostrados, n = 5) {
  return poolSeguro
    .filter(e =>
      e.tg === ejercicioActual.tg &&
      e.id !== ejercicioActual.id &&
      !idsUsadosEnLaSemana.has(e.id) &&
      !yaMostrados.has(e.id)
    )
    .sort((a, b) => jerarquiaScore(b) - jerarquiaScore(a))
    .slice(0, n)
}
```

- **Barra de búsqueda al final**, después de agotar los 8 (3+5): busca **solo dentro del mismo grupo muscular** y dentro del pool ya filtrado — nunca se sale de los límites de equipamiento/lesión/traducción ya aplicados. Reutiliza las funciones de búsqueda que ya existen en `exercises.js` (`matchExercise`, con normalización de acentos y multi-token), no hace falta escribir un buscador nuevo:

```js
function buscarEnGrupoMuscular(query, poolSeguro, tg, idsUsadosEnLaSemana) {
  return poolSeguro.filter(e =>
    e.tg === tg &&
    !idsUsadosEnLaSemana.has(e.id) &&
    matchExercise(e, query)
  )
}
```

---

## 2. Onboarding interactivo (spotlight/tour) — versión de 2 tours

**Librería: Driver.js** (~5kb, agnóstico de framework — alcanza para esto sin la integración React-nativa de Joyride).

Se divide en **2 tours independientes**, cada uno con su propio flag de persistencia — no es un tour de 10 pasos, son dos tours cortos que disparan en momentos distintos.

### Tour A — "Primeros pasos" (dispara en el primer login)

5 pasos, todos con contenido real desde el día 1 (nada de gráficos vacíos):

| # | Elemento con foco | Texto |
|---|---|---|
| 1 | Tarjeta de bienvenida / botones de acción en `/home` | "Desde acá podés generar tu plan personalizado respondiendo la encuesta, cargar la rutina predeterminada o diseñar una propia manualmente." |
| 2 | Widget de peso corporal en `/home` | "Llevá el seguimiento periódico de tu peso corporal para visualizar cambios a lo largo del tiempo." |
| 3 | Pestaña "Plan" en la barra de navegación | "Organizá tu semana distribuyendo los días de entrenamiento y editando tus rutinas como prefieras." |
| 4 | Pestaña/botón "Empezar" | "Antes de arrancar podés anotar tu peso previo (opción desactivable). Durante la sesión vas a ir registrando series, repeticiones y cargas." |
| 5 | Pestaña "Ajustes" | "Ajustá tu perfil, rehacé la encuesta para recalcular tu plan y activá recordatorios para tus días de entrenamiento o pago de cuota." |

Los pasos de biblioteca de ejercicios (catálogo y "crear ejercicio propio") **no van en ningún tour** — no son necesarios para arrancar a entrenar el día 1, se descubren solos navegando.

Flag de persistencia: `onboardingCompletado: boolean` (default `false`), se dispara una sola vez. Opción en Configuración → "Ver el tutorial de nuevo" para repetirlo manualmente.

### Tour B — "Tu progreso" (dispara la primera vez que el usuario entra a `/stats`, nunca en el primer login)

3 pasos:

| # | Elemento con foco | Texto |
|---|---|---|
| 1 | Bloque de constancia / mapa de actividad | "Revisá tu nivel de consistencia a través de los bloques de actividad de los últimos 2 meses." |
| 2 | Gráficos de rendimiento (equilibrio muscular, fatiga, fuerza) | "Evaluá el balance entre grupos musculares, tu nivel de fatiga acumulada y el crecimiento de tu fuerza." |
| 3 | Gráficos de progresión de cargas por ejercicio | "Consultá la gráfica de peso por ejercicio para verificar que estás aplicando sobrecarga progresiva." |

**Por qué separado del Tour A:** un usuario recién registrado tiene estos gráficos vacíos — mostrarlos en el primer login con un globito diciendo "mirá qué buena esta gráfica" sobre un gráfico en blanco resta en vez de sumar. Al disparar este tour recién cuando el usuario entra a `/stats` (probablemente ya con algún entrenamiento registrado), hay más chance de que haya datos reales que mostrar. Si todavía no hay datos en ese momento, el tour igual puede correr — el propio estado vacío de cada gráfico ("Todavía no hay datos, esto se va a ir llenando") ya cumple la función de explicar qué es, sin fingir que hay algo cargado.

Flag de persistencia independiente: `onboardingStatsCompletado: boolean` (default `false`).

### Config común a ambos tours

- **Botón "Saltar" permanente**, visible en todo momento durante el tour (no solo al final), esquina superior derecha del tooltip o de la pantalla.
- **Indicador de avance** en cada tarjeta: "Paso X de N" (N=5 en el Tour A, N=3 en el Tour B — nunca "de 10", son tours separados).
- **Al terminar o saltar cualquiera de los dos**, actualizar su flag correspondiente (`onboardingCompletado` o `onboardingStatsCompletado`) a `true` — cada uno se controla independiente, terminar el Tour A no debe tocar el flag del Tour B ni viceversa.
- **Accesibilidad:** probar navegación por teclado (Tab/Escape) antes de dar por cerrado — es fácil que un overlay de spotlight rompa el foco si no se configura bien.

### ⚠️ Punto técnico crítico — el Tour A cambia de ruta entre pasos 1→2→3→4→5

Driver.js **no tiene integración nativa con `react-router-dom`** — hay que armarlo a mano y con cuidado, porque acá está el riesgo real de que se rompa:

```js
// Patrón obligatorio para cada paso que cambia de ruta (ej. paso 2 → paso 3, /home → /plan)
async function irAlSiguientePasoConRuta(navigate, ruta, selectorDelElemento, driverInstance) {
  navigate(ruta)
  await esperarElemento(selectorDelElemento) // NO usar un setTimeout fijo
  driverInstance.moveNext()
}

function esperarElemento(selector, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const existente = document.querySelector(selector)
    if (existente) return resolve(existente)
    const observer = new MutationObserver(() => {
      const el = document.querySelector(selector)
      if (el) { observer.disconnect(); resolve(el) }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    setTimeout(() => { observer.disconnect(); reject(new Error('timeout esperando ' + selector)) }, timeoutMs)
  })
}
```

**No usar `navigate()` seguido de `moveNext()` inmediato ni un `setTimeout` fijo** — si el componente de la nueva ruta todavía no montó en el DOM, Driver.js va a intentar aplicar el spotlight sobre un elemento que no existe todavía (o sobre lo que quedó de la pantalla anterior). El `MutationObserver` esperando el selector del próximo elemento es el patrón correcto acá, no un timer arbitrario.

El Tour B no tiene este problema — los 3 pasos viven todos dentro de `/stats`, sin cambio de ruta entre ellos.

## 3. Gasto calórico — "Sexo (biológico)" como primera pregunta + altura

**Nuevo campo en `EncuestaInput`, primera pregunta de la encuesta, título "Sexo (biológico)":**
```ts
sexoBiologico: 'masculino' | 'femenino';
altura: number; // cm — se agrega junto a edad/pesoKg en el mismo paso
```

**Sincronización con Configuración:** si el usuario elige `femenino`, actualizar automáticamente el género en Configuración (el que usa el mapa de fatiga) para que coincida — evita pedir el mismo dato dos veces. Sigue siendo editable después desde Configuración por separado, por si alguien quiere un mapa de fatiga distinto a lo que puso en la encuesta.

**Fórmula (Mifflin-St Jeor, la más precisa y la que recomienda ACSM):**
```
Hombres:  TMB = 10×peso(kg) + 6.25×altura(cm) − 5×edad + 5
Mujeres:  TMB = 10×peso(kg) + 6.25×altura(cm) − 5×edad − 161
```

**Alcance de esta iteración:** con TMB (metabolismo basal) alcanza para el número base; para un TDEE (gasto total) real hace falta además un factor de actividad, que hoy no se pregunta. Se aproxima con la cantidad de `diasSeleccionados` como proxy simple (ej. 1.2 si son 1-2 días, 1.375 si son 3-4, 1.55 si son 5+) en vez de agregar una pregunta nueva.

---

## 4. Dónde se muestra y cómo se usa

**Ubicación: pestaña "Progreso"**, junto al gráfico de peso corporal — no en el Dashboard principal, que ya está cargado con la card de bienvenida y el calendario semanal.

**Cálculo dinámico, no un valor fijo guardado:** se recalcula cada vez que se muestra, usando:
- El **último peso registrado** en el tracker de peso corporal (no el peso que puso el día de la encuesta — si subió o bajó, el número tiene que reflejarlo)
- `altura`, `edad`, `sexoBiologico` desde Configuración → Datos (editables ahí)

**Cómo se usa — cruzado con el objetivo de la encuesta, no solo el número de TMB suelto:**

```js
function calcularCaloriasSugeridas(tmb, diasSeleccionados, objetivo) {
  const factorActividad = diasSeleccionados.length >= 5 ? 1.55
    : diasSeleccionados.length >= 3 ? 1.375
    : 1.2
  const mantenimiento = Math.round(tmb * factorActividad)
  const ajuste = {
    hipertrofia: 1.125,      // +12.5% aprox, punto medio de +10/+15%
    fuerza: 1.125,
    perder_grasa: 0.825,     // -17.5% aprox, punto medio de -15/-20%
    fitness_general: 1,
  }[objetivo] || 1
  return { mantenimiento, sugerido: Math.round(mantenimiento * ajuste) }
}
```

**Texto mostrado en la card de Progreso:**
> TMB: 1650 kcal · Mantenimiento estimado: ~2400 kcal/día · Para tu objetivo (ganar músculo): ~2700 kcal/día

Con una aclaración chica de que es una estimación (Mifflin-St Jeor + factor de actividad aproximado por días de entrenamiento), no un valor clínico exacto.

---

## 5. Recordatorio de cuota — agregar opción trimestral

El recordatorio de cuota de gimnasio (ya existe vía push, ver `db.subs`) hoy asume una frecuencia fija. Agregar **trimestral** como opción adicional de frecuencia, junto a la que ya exista (mensual):

```ts
frecuenciaRecordatorioCuota: 'mensual' | 'trimestral';
```

Se configura donde ya esté el resto de la config de notificaciones/cuota (Configuración → Cuenta o similar). El disparo del push (`sendPush`) usa la misma lógica que ya tienen, solo cambia el intervalo de cálculo de la próxima fecha de aviso según la opción elegida.
