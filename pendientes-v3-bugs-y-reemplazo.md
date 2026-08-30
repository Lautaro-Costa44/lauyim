# Pendientes v3 — Bugs urgentes + reemplazo de ejercicios

## Bugs urgentes

### 1. Marcar un día no reemplaza el estado anterior, se acumula
Si marcás un día como "completado" y después lo cambiás a "descanso" (o asignás una rutina distinta), el estado viejo no se borra — queda "completado" pegado. Mismo problema si asignás una rutina a un día y después lo marcás como descanso: no se limpia.

**Causa probable:** el override de un día se está guardando como banderas independientes (`completado: true`, `rutinaId: 'x'`, `descanso: true` conviviendo) en vez de un único campo de estado. Tiene que ser mutuamente excluyente:

```js
// Un solo campo, no tres flags sueltos
diaOverride = {
  fecha: '2026-08-25',
  estado: 'completado' | 'descanso' | 'rutina', // uno solo, nunca combinados
  rutinaId: null, // solo si estado === 'rutina'
}
```

Cualquiera de las 3 opciones del modal ("Marcar como realizado", elegir una rutina, "Descansar/saltar este día") tiene que **sobreescribir por completo** el override anterior de esa fecha, no sumarse.

### 2. Modal de "chequeo rápido" — X invisible y hace lo contrario de lo que debería
- La X no se ve (problema de contraste/CSS, hay que revisar el color del ícono contra el fondo del modal).
- Tocar la X **o** tocar afuera del modal, en vez de cerrar/cancelar, **avanza** — está mal cableado el handler, tiene la acción de confirmar en vez de la de cancelar. Hoy el modal es inservible: no hay forma de cancelarlo.

### 3. Falta el interruptor del header para no pedir peso
Confirmado: no existe todavía en ningún lado. Es el punto 2 del documento anterior (`pendientes-app-general.md`) — seguía pendiente, no se llegó a implementar.

### 4. Error real en el modal de pairing: `api is not defined`
El modal "Iniciar sesión desde el celu" (la feature de device pairing que especificamos) ya está en pantalla pero tira un error de JS visible al usuario: `api is not defined`. Es una referencia rota — falta un import o la variable `api`/cliente HTTP no está definida en el componente del modal. Hay que revisar ese archivo antes de seguir probando el resto del flujo de pairing, porque con este error ni siquiera llega a pegarle al backend.

---

## Ajustes al motor de rutinas

### 5. Sacar "% 1RM" como métrica de esfuerzo
Eliminar `porcentaje_rm` de las opciones de `metricaEsfuerzo` en la encuesta — quedan solo `rir` y `rpe`. Limpiar también el `VALOR_ESFUERZO` y cualquier lógica que todavía contemple ese tercer caso (incluido el bug que habíamos marcado del mapeo silencioso a `rir`, que ahora directamente deja de existir).

### 6. Ejercicios con "fitball" aparecen aunque se pida "máquinas y poleas"
`preferenciaEjercicio` hoy solo pondera (suma puntaje) en vez de filtrar de verdad, así que se cuelan ejercicios con equipamiento que no tiene nada que ver (fitball/stability ball) cuando el usuario pidió específicamente máquinas y poleas. Convertirlo en filtro real para las dos preferencias específicas, con red de seguridad si el pool queda muy chico:

```js
const EQUIPO_POR_PREFERENCIA = {
  maquinas_poleas: ['leverage machine', 'cable', 'smith machine', 'assisted'],
  pesos_libres: ['barbell', 'dumbbell', 'olympic barbell', 'ez barbell', 'kettlebell', 'trap bar'],
  sin_preferencia: null, // sin filtro
}

function filtrarPorPreferenciaEquipo(pool, preferencia) {
  const permitidos = EQUIPO_POR_PREFERENCIA[preferencia]
  if (!permitidos) return pool
  const filtrado = pool.filter(e => permitidos.includes(e.eq))
  return filtrado.length >= 5 ? filtrado : pool // red de seguridad, mismo patrón que esRaro
}
```

Aplicar esto en `prepararPoolSeguro`, no como desempate en el sorting — así "fitball", bandas, y bodyweight quedan afuera cuando corresponde, salvo que no haya suficientes opciones sin ellos.

---

## 7. Feature nueva: modo de reemplazo de ejercicios al terminar la encuesta

Después de generar la rutina (y antes del redirect automático al Dashboard que definimos en la sección 12.1 del spec base), agregar una pantalla de revisión: **"Revisá y ajustá tus ejercicios"**, con la lista completa de ejercicios de todas las rutinas generadas, cada uno con un botón para reemplazarlo.

**Al tocar "reemplazar" en un ejercicio, mostrar 3 alternativas equivalentes**, ej.:
> Press de banca con polea → **Press de banca con barra** / **Press de banca inclinado** / **Cruces de pie con polea**

**Reglas para calcular las 3 alternativas** (reutiliza lo que ya existe, no es lógica nueva desde cero):

```js
function obtenerAlternativas(ejercicioActual, poolSeguro, idsUsadosEnLaSemana, n = 3) {
  // 1. Mismo tg que el ejercicio actual, dentro del pool YA filtrado
  //    (equipamiento + lesión + preferencia de tipo + traducción existente — todos los
  //    filtros de la sección 6 y el nuevo del punto 6 de este documento ya aplicados)
  let candidatos = poolSeguro.filter(e =>
    e.tg === ejercicioActual.tg &&
    e.id !== ejercicioActual.id &&
    !idsUsadosEnLaSemana.has(e.id)
  )

  // 2. Diversidad entre las 3 alternativas entre sí: no repetir patronDeMovimiento
  //    (misma función que ya usa seleccionarEjerciciosNormales)
  const elegidos = []
  const patronesVistos = new Set()
  for (const c of candidatos.sort((a, b) => jerarquiaScore(b) - jerarquiaScore(a))) {
    const patron = patronDeMovimiento(c)
    if (patronesVistos.has(patron)) continue
    patronesVistos.add(patron)
    elegidos.push(c)
    if (elegidos.length === n) break
  }

  // 3. Si no llegó a n por poca diversidad de patrones, completar sin ese filtro
  if (elegidos.length < n) {
    for (const c of candidatos) {
      if (elegidos.length === n) break
      if (!elegidos.includes(c)) elegidos.push(c)
    }
  }

  return elegidos
}
```

**Al confirmar un reemplazo:** actualizar el ejercicio en el día correspondiente de la rutina en memoria (todavía no guardada), y sacar el id viejo / meter el id nuevo en `idsUsadosEnLaSemana` para que no se pueda elegir el mismo ejercicio reemplazado en otro lado de la semana.

**Al terminar la revisión** (botón "Confirmar rutina" al final de la lista): recién ahí se guarda la rutina definitiva y se hace el redirect al Dashboard — reemplaza el comportamiento de "sin pantalla intermedia" que habíamos definido antes en la sección 12.1; ahora esta pantalla de revisión **es** el paso intermedio.
