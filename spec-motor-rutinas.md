# Spec: Motor de generación de rutinas personalizadas — openGym

## 1. Objetivo

Implementar un módulo en Node.js/JavaScript que, a partir de las respuestas de la encuesta de onboarding de un usuario nuevo, genere una rutina de entrenamiento semanal completa, filtrando y seleccionando ejercicios desde el catálogo existente (`exercises-data.js`, 1324 ejercicios). Sin IA, sin base de datos relacional: es un sistema de reglas determinista que opera en memoria sobre el array `EXDB`.

No requiere nuevas dependencias. Corre sobre el stack actual (Node.js + JSON local + Docker).

---

## 2. Datos de entrada existentes

### 2.1 Estructura de un ejercicio en `EXDB`

```js
{
  "id": "0007",
  "n": "alternate lateral pulldown",   // nombre en inglés (usar diccionario ES para mostrar)
  "bp": "back",                        // body part — 10 valores fijos (ver 2.2)
  "eq": "cable",                       // equipamiento — 27 valores fijos (ver 2.2)
  "tg": "lats",                        // target muscle principal — 18 valores fijos (ver 2.2)
  "mg": "biceps",                      // músculo secundario principal
  "sm": ["biceps", "rhomboids"],       // músculos secundarios (array)
  "st": ["paso 1", "paso 2", ...],     // instrucciones (inglés)
  "img": "0007-4IKbhHV.jpg",
  "gif": "0007-4IKbhHV.gif"
}
```

Nombres se resuelven en el frontend vía `exercise-names-es.js` y `body-parts-es.js` (ya existentes) usando el `id`.

### 2.2 Valores fijos de los campos clave

- **`bp` (body part, 10 valores):** `back, cardio, chest, lower arms, lower legs, neck, shoulders, upper arms, upper legs, waist`
- **`tg` (target muscle, 18 valores):** `abductors, abs, adductors, biceps, calves, cardiovascular system, delts, forearms, glutes, hamstrings, lats, levator scapulae, pectorals, quads, serratus anterior, spine, traps, triceps, upper back`
- **`eq` (equipamiento, 27 valores):** `assisted, band, barbell, body weight, bosu ball, cable, dumbbell, elliptical machine, ez barbell, hammer, kettlebell, leverage machine, medicine ball, olympic barbell, resistance band, roller, rope, skierg machine, sled machine, smith machine, stability ball, stationary bike, stepmill machine, tire, trap bar, upper body ergometer, weighted, wheel roller`

---

## 3. Esquema de la encuesta (input)

```ts
interface EncuestaInput {
  objetivo: "hipertrofia" | "fuerza" | "perder_grasa" | "fitness_general";
  tieneLesion: boolean;
  lesiones: ("hombros" | "espalda_baja" | "rodillas" | "munecas" | "cuello" | "cuadriceps")[]; // solo si tieneLesion=true, multi-select
  diasPorSemana: 1 | 2 | 3 | 4 | 5 | 6 | 7;
  tiempoPorSesion: "30-40" | "40-60" | "60-90" | "90+"; // minutos
  nivel: "principiante" | "intermedio" | "avanzado";
  equipamiento: "gimnasio_completo" | "solo_mancuernas" | "calistenia";
  preferenciaEjercicio: "maquinas_poleas" | "pesos_libres" | "sin_preferencia";
  enfoque: "balance" | "piernas_gluteos" | "torso_brazos";
  cardio: "sin_cardio" | "suave_final" | "hiit" | "caminar_correr";
  // split NO se pide directo al usuario si nivel = principiante (se fuerza Full Body).
  // Si nivel = intermedio o avanzado, mostrar selector opcional, pero el sistema
  // igual valida contra la matriz de la sección 4 y corrige si es inconsistente.
  splitPreferido?: "fullbody" | "torso_pierna" | "ppl";
}
```

---

## 4. Lógica de derivación del Split (determinista)

No dejar elegir libremente. Usar esta matriz como fuente de verdad; si `splitPreferido` del usuario no es compatible con nivel+días, ignorarlo y aplicar el default, avisando al usuario en el resultado ("Ajustamos tu split a X porque es lo más efectivo con Y días").

| Nivel | Días | Split asignado | Detalle |
|---|---|---|---|
| Principiante | 2 | Full Body A/B | — |
| Principiante | 3 | Full Body A/B/A | rota semana siguiente B/A/B |
| Principiante | 4 | Full Body A/B/A/B | — |
| Principiante | 5-7 | Full Body (rotando variantes) | no forzar PPL nunca en principiante |
| Intermedio | 2-3 | Full Body | — |
| Intermedio | 4 | Torso/Pierna x2 | — |
| Intermedio | 5-6 | PPL | — |
| Intermedio | 7 | PPL + 1 día de refuerzo débil | — |
| Avanzado | 3 | Full Body | evita desbalance de frecuencia de Torso/Pierna en días impares |
| Avanzado | 4 | Torso/Pierna | — |
| Avanzado | 5 | PPL + 1 extra (torso o pierna según énfasis) | — |
| Avanzado | 6-7 | PPL x2 | — |

---

## 5. Filtro por equipamiento disponible

Filtrar `EXDB` por `eq` antes de cualquier otra selección:

- **`gimnasio_completo`** → sin filtro, pool completo
- **`solo_mancuernas`** → `eq` en `["dumbbell", "body weight"]`
- **`calistenia`** → `eq === "body weight"`

Aplicar esto **primero**, siempre, antes del filtro de lesiones y de la selección por `tg`.

---

## 6. Filtro por lesión/molestia (exclusion list)

Los tags `bp`/`tg` no alcanzan solos para identificar riesgo (ej: "chest" incluye tanto press plano de banco, de bajo riesgo, como fondos, de alto riesgo para hombro). Combinar filtro por tag **+** exclusión por palabra clave en el nombre (`n`, en inglés).

| Lesión | Excluir `bp`/`tg` | Excluir por keyword en `n` (contains, case-insensitive) | Ejercicios permitidos de referencia |
|---|---|---|---|
| **Hombros** | `bp === "shoulders"` | `overhead`, `military press`, `behind the neck`, `dip`, `upright row`, `handstand`, `arnold press` | face pull, band pull-apart, prensa de piernas, remo agarre neutro |
| **Espalda baja** | — (no excluir `bp:"waist"` completo, solo por keyword) | `deadlift`, `good morning`, `hyperextension`, `bent over row`, `back squat`, `clean`, `snatch`, `sit-up` (con peso), `superman` | prensa de piernas, hip thrust, planchas isométricas, remo en máquina sentado, pallof press |
| **Rodillas** | `bp === "upper legs"` con `tg === "quads"` en variantes de alto impacto | `squat`, `lunge`, `leg extension`, `jump`, `box jump`, `step up`, `pistol` | hip thrust, curl femoral, glute bridge, bici estática, aducción/abducción en máquina |
| **Muñecas** | — | `push-up`, `push up`, `plank`, `handstand`, `front squat`, `clean`, `snatch`, `wrist curl`, `barbell curl` (preferir dumbbell/ez bar) | máquinas con agarre neutro, cable con soga, ejercicios de pierna, prensa |
| **Cuello** | `bp === "neck"` | `shrug` (con barra pesada), `behind the neck`, `neck` | máquinas de espalda con soporte, ejercicios de piso |
| **Cuádriceps** | `bp === "upper legs"` con `tg === "quads"` | `squat`, `lunge`, `leg extension`, `sprint`, `jump` | isquios (curl femoral), glúteo (hip thrust), pantorrilla, tren superior sin restricción |

**Regla de aplicación:** si el usuario marca varias lesiones, las exclusiones se acumulan (unión de todas las listas negras, nunca intersección).

**Regla de seguridad no negociable:** los filtros de lesión y de equipamiento son **rígidos** — nunca se relajan, ni siquiera en el mecanismo de fallback de la sección 6.1. Si hay que degradar algo para no dejar un `tg` vacío, se degrada la preferencia de tipo de ejercicio o se sustituye el grupo muscular (6.1), pero jamás se reintroduce un ejercicio excluido por lesión o incompatible con el equipamiento disponible.

**Nota de seguridad para QA:** este mapeo cubre los casos más comunes pero **no reemplaza criterio profesional**; documentar en el resultado de la rutina un disclaimer tipo "si sentís dolor agudo, consultá a un profesional antes de continuar".

### 6.1 Tabla de sustitución por grupo muscular (fallback)

Cuando el `poolSeguro` para un `tg` queda en 0 ejercicios (típicamente por combinación de lesión + equipamiento limitado), sustituir por el/los `tg` sinergista(s) más cercano(s), en este orden de prioridad. Nunca saltar a un grupo anatómicamente no relacionado.

| `tg` sin opciones | Sustituir por (en orden) |
|---|---|
| quads | hamstrings → glutes → calves |
| hamstrings | glutes → quads → calves |
| glutes | hamstrings → adductors → abductors → quads |
| adductors | abductors → glutes |
| abductors | adductors → glutes |
| calves | quads → hamstrings |
| pectorals | delts → triceps |
| lats | upper back → traps → biceps |
| upper back | lats → traps → delts |
| traps | upper back → delts |
| delts | pectorals → upper back → traps |
| biceps | forearms → lats |
| triceps | pectorals → delts |
| forearms | biceps |
| abs | spine |
| spine | abs |
| serratus anterior | abs → upper back |
| levator scapulae | traps (nunca `neck` si el usuario tiene lesión de cuello) |
| cardiovascular system | sin sustituto — si el bloque de cardio no tiene opciones seguras, omitirlo y avisar en `mensajeAjuste` |

Si aun así el sustituto también da 0 (caso extremo, ej. lesión múltiple + calistenia), reutilizar un ejercicio seguro ya usado en otro día de la semana antes que dejar el slot vacío.

---

## 7. Selección de ejercicios por sesión

### 7.1 Slots por duración de sesión

| Tiempo/sesión | Ejercicios por sesión | Series totales aprox. |
|---|---|---|
| 30-40 min | 4-5 | 12-15 |
| 40-60 min | 5-7 | 15-20 |
| 60-90 min | 7-9 | 20-25 |
| 90+ min | 8-10 | 25-30 |

### 7.2 Distribución de volumen por `tg` según objetivo

- **Hipertrofia:** 10-20 series/semana por grupo muscular principal, reps 8-15
- **Fuerza:** priorizar compuestos (`tg`: pectorals, lats, quads, glutes con `eq` barbell/dumbbell), reps 3-6, menos ejercicios de aislamiento
- **Perder grasa:** igual esquema que hipertrofia/fuerza (la composición corporal se maneja por dieta, no por la rutina), sumar bloque de cardio según selección
- **Fitness general:** full body, reps 8-12, distribución pareja entre todos los `tg`

### 7.3 Ajuste por énfasis muscular

- **Balance:** distribución pareja de series entre todos los `tg` mayores
- **Piernas y glúteos:** +30-40% de series a `tg`: quads, hamstrings, glutes, adductors, abductors; recortar proporcionalmente de brazos/hombros
- **Torso y brazos:** +30-40% de series a `tg`: pectorals, lats, delts, biceps, triceps, upper back, traps; recortar de piernas manteniendo un mínimo de mantenimiento (no bajar de 6 series/semana en piernas)

### 7.4 Preferencia de tipo de ejercicio

No es un filtro excluyente (no hay evidencia que respalde superioridad de un tipo sobre otro para resultados generales). Es un peso de ordenamiento:

- `maquinas_poleas` → priorizar `eq` en `["leverage machine", "cable", "smith machine"]` al armar cada slot, cayendo a otros equipos si no hay suficientes opciones
- `pesos_libres` → priorizar `eq` en `["barbell", "dumbbell", "olympic barbell", "kettlebell", "ez barbell"]`
- `sin_preferencia` → sin peso, orden por relevancia del `tg` únicamente

---

## 8. Bloque de cardio

Agregar al final de la sesión (no antes, por el efecto de interferencia en fuerza/hipertrofia — evidencia: Schumann et al. 2022, meta-análisis de 43 estudios, efecto de interferencia significativo solo en fuerza explosiva/potencia, no en hipertrofia ni fuerza máxima):

- `sin_cardio` → no agregar nada
- `suave_final` → 10-15 min, filtrar `bp === "cardio"` con `eq` en `["stationary bike", "elliptical machine", "body weight"]`
- `hiit` → 15-20 min, máximo 1-2 veces por semana (no todos los días de entrenamiento), filtrar `bp === "cardio"`
- `caminar_correr` → sin restricción de tiempo fijo, es libre

---

## 8.1 Resolución de casos borde (actualizado)

- **`diasPorSemana === 1`** (cualquier nivel): forzar `splitAsignado = "fullbody"` automáticamente, sin excepción, sin importar `nivel`.
- **Preferencia de tipo de ejercicio no satisfecha** (ej. pide `maquinas_poleas` pero el pool seguro para ese `tg` solo tiene `barbell`/`dumbbell`): ignorar la preferencia y tomar cualquier ejercicio seguro disponible del pool. Nunca dejar un slot vacío por esto.
- **Pool seguro en 0 para un `tg`**: aplicar la tabla de sustitución (sección 6.1). Nunca lanzar excepción. Registrar el ajuste en `mensajeAjuste`.

## 9. Función principal (firma esperada)

```js
/**
 * @param {EncuestaInput} respuestas
 * @param {Array} exerciseDB - el array EXDB completo
 * @returns {RutinaGenerada}
 */
function generarRutina(respuestas, exerciseDB) { ... }
```

### 9.1 Formato de salida

```ts
interface RutinaGenerada {
  splitAsignado: "fullbody" | "torso_pierna" | "ppl";
  splitAjustado: boolean; // true si se corrigió la preferencia del usuario
  mensajeAjuste?: string; // ej: "Ajustamos tu split a Full Body porque es más efectivo con 3 días"
  dias: {
    diaLabel: string; // "Día 1 - Full Body A"
    ejercicios: {
      exerciseId: string; // id de EXDB, el frontend resuelve el nombre en ES
      series: number;
      repeticiones: string; // ej: "8-12"
    }[];
    cardio?: { tipo: string; duracionMin: number };
  }[];
  disclaimer: string; // texto fijo de seguridad si tieneLesion = true
}
```

---

## 10. Pipeline de ejecución (orden obligatorio)

1. Validar/corregir `splitPreferido` contra la matriz (sección 4)
2. Filtrar `EXDB` por equipamiento (sección 5) → `poolEquipamiento`
3. Aplicar exclusiones por lesión sobre `poolEquipamiento` (sección 6) → `poolSeguro`
4. Calcular distribución de series por `tg` según objetivo + énfasis (secciones 7.2, 7.3)
5. Para cada día del split, seleccionar ejercicios de `poolSeguro` respetando: slots por tiempo (7.1), peso de preferencia de tipo (7.4), y sin repetir el mismo `id` dos veces en la semana salvo que el pool filtrado sea muy chico
6. Agregar bloque de cardio si corresponde (sección 8)
7. Armar el objeto `RutinaGenerada` con disclaimer si `tieneLesion = true`

---

## 12. Flujo de onboarding (primer login)

No es un redirect forzado a pantalla completa. Se integra en la card **"¡Bienvenido!"** que ya existe en el dashboard (ver captura de referencia, sección 15) y que hoy muestra 2 opciones. Pasa a tener 3:

1. **"Recomendarme una rutina"** ← nueva, opción destacada (botón primario), dispara el flujo de encuesta (sección 3-11)
2. **"Cargar plan inicial (PPL)"** ← ya existe
3. **"Crear mi propio plan"** ← ya existe

- **Persistencia:** agregar al registro del usuario en `db.json`:
  ```js
  {
    estadoInicial: "pendiente" | "encuesta_completada" | "plan_predeterminado" | "plan_manual", // default "pendiente"
    respuestasEncuesta: EncuestaInput | null,
    rutinaGenerada: RutinaGenerada | null,
    fechaUltimaEncuesta: string | null // ISO date
  }
  ```
- **Comportamiento:** la card "¡Bienvenido!" se muestra mientras `estadoInicial === "pendiente"`. Al elegir la opción 1, abrir el flujo de encuesta (wizard multi-paso — ver 12.1). Al completar, correr `generarRutina()` (sección 9), guardar `rutinaGenerada`, setear `estadoInicial = "encuesta_completada"`, y la card deja de mostrarse, reemplazada por el estado normal del dashboard (semana + rutina cargada).
- Las opciones 2 y 3 no cambian de comportamiento respecto a lo que ya tiene la app; solo se ajusta el `estadoInicial` correspondiente al elegirlas.
- No hay "obligatoriedad" que resolver: al ser 3 opciones dentro del dashboard, el usuario siempre puede entrenar aunque no haga la encuesta — el valor agregado es que una de las 3 rutas ahora es la personalizada.

### 12.1 Flujo de UX del wizard de encuesta

1. El usuario presiona **"Recomendarme una rutina"**.
2. Se abre el flujo en **pantalla completa**, con barra de progreso arriba tipo "Paso 1 de N" (N = cantidad de preguntas de la sección 3, agrupadas o una por paso según decida el diseño — ej. "Paso 1 de 5" si se agrupan varias preguntas por pantalla).
3. Al finalizar el último paso, el motor (`generarRutina()`, sección 9) corre, genera la rutina y la guarda (`rutinaGenerada`, `estadoInicial = "encuesta_completada"`).
4. La app redirige automáticamente al Dashboard, ya con la rutina cargada (sin pantalla de resumen intermedia salvo que se pida lo contrario).

## 13. Reintento de la encuesta desde Configuración → Datos

- Agregar en la sección "Datos" de Configuración un botón/card: **"Volver a hacer la encuesta"**.
- Al confirmar (mostrar modal de confirmación tipo "esto va a reemplazar tu rutina actual, ¿continuar?"), redirigir al mismo flujo de `/onboarding/encuesta`, pre-cargando las respuestas anteriores como valores default (no vacío) para que el usuario solo edite lo que cambió.
- Al confirmar el reenvío, sobrescribir `respuestasEncuesta` y `rutinaGenerada`, actualizar `fechaUltimaEncuesta` y `estadoInicial = "encuesta_completada"`. No se pide guardar historial de versiones anteriores salvo que se indique lo contrario.

## 14. Feature flag por variable de entorno

Agregar en `.env`:

```
SURVEY_ENABLED=true
```

- `true` (default): se muestra la opción "Recomendarme una rutina" en la card "¡Bienvenido!" (sección 12) y la opción de reintento en Configuración → Datos (sección 13).
- `false`: se desactiva completamente — la card "¡Bienvenido!" queda solo con las 2 opciones que ya existían (plan predeterminado / crear manual), y "Volver a hacer la encuesta" se oculta de Configuración → Datos (no solo se deshabilita, se oculta del DOM). Los usuarios que ya tengan una `rutinaGenerada` guardada la siguen viendo con normalidad; el módulo de generación simplemente deja de invocarse.
- Leer la variable en el arranque del backend (no en cada request) y exponerla al frontend vía el endpoint de configuración que ya use la app para otros feature flags, si existe alguno; si no existe ese patrón, exponerla en el payload de sesión del usuario al loguearse.

## 15. Consistencia visual

La pantalla de encuesta y el resultado de la rutina generada deben reutilizar los componentes, tipografía y paleta ya existentes en el frontend de openGym (React + Vite) — no introducir un sistema de diseño nuevo ni librería de UI adicional.

**Referencia visual (captura del dashboard actual):**
- Tema oscuro: fondo general prácticamente negro, cards en gris oscuro (`#1a1a1a`–`#212121` aprox.), bordes redondeados grandes (~16px)
- **Color de acento: usar la variable/token de tema que ya define la app (el usuario puede elegir su propia paleta) — no hardcodear un color específico.** En la captura de referencia el tema activo usa verde, pero el componente debe tomar el color de acento configurado, cualquiera sea.
- Botón primario: pill/rounded-full, fondo del color de acento del tema, texto en el color de contraste que ya use la app para botones primarios, ícono a la izquierda (✨)
- Botón/link secundario: texto en el color de acento sin relleno, centrado, sin card propia
- Texto: blanco para títulos, gris claro para subtítulos/texto secundario
- Cards con jerarquía por bloques independientes (selector de semana, bienvenida, peso corporal, racha) — cada sección de la encuesta y el resultado deberían mantener ese mismo patrón de "card por bloque"

**Aplicado a la card "¡Bienvenido!" con las 3 opciones:**
- **"Recomendarme una rutina"** → opción destacada, botón primario (pill, color de acento del tema), reemplaza al actual "Cargar plan inicial (PPL)" como CTA principal
- **"Cargar plan predeterminado (PPL)"** → pasa a opción secundaria
- **"Crear rutina manualmente"** → link de texto en color de acento, como está hoy

Antes de implementar, Antigravity debe inspeccionar los componentes/estilos ya usados (botones, cards, selector de fecha) y reutilizarlos tal cual — no hardcodear colores nuevos, usar las variables/clases de tema que ya existan en el proyecto. Si la app ya tiene un wizard/stepper para algún otro flujo multi-paso, reutilizar ese patrón para las ~10 preguntas de la encuesta en vez de un formulario largo de una sola pantalla.

## 16. Casos borde a testear

- Usuario con **calistenia + lesión de rodillas**: verificar que el pool resultante no quede vacío para `tg: quads/glutes` (dejar sentadilla a una pierna con soporte, step-ups bajos, etc. si sobreviven al filtro; si el pool queda en 0 para algún `tg` obligatorio, degradar el énfasis en vez de fallar)
- Usuario **avanzado con 1 día** disponible: no hay franja en la matriz de la sección 4 para "avanzado + 1 día" — definir default (recomendado: Full Body, mismo criterio que 2-3 días)
- Múltiples lesiones simultáneas que dejen el pool de un `tg` en cero ejercicios: el sistema debe avisar en `mensajeAjuste`, no romper
- Objetivo "fuerza" + equipamiento "calistenia": no hay barras/mancuernas, adaptar a variantes de peso corporal más exigentes (unilaterales) en vez de fallar
