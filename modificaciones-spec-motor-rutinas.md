# Modificaciones al spec — Motor de rutinas openGym (v2)

Este documento es un **changelog** sobre `spec-motor-rutinas.md` (documento base). No reemplaza el spec original — lo modifica puntualmente en los ítems detallados abajo. Pasale ambos documentos a Antigravity: el base para lo que no cambió, este para lo que sí.

---

## 1. Split ya no se fuerza — pasa a ser 100% elección del usuario, con aviso no bloqueante

**Elimina** la lógica de override forzado de la sección 4 y el campo `splitAjustado` (boolean) de la sección 9.1 del spec base.

**Reemplaza por:**

- La matriz de la sección 4 pasa a ser solo el **default recomendado** (lo que se pre-selecciona en la encuesta si el usuario no toca nada), no una regla que se imponga.
- **Única excepción mecánica que se mantiene:** si el usuario selecciona **1 solo día**, forzar `fullbody` — no es una recomendación científica, es que "Push/Pull/Legs" o "Torso/Pierna" no tienen sentido estructural con un solo día disponible (dejarían el resto del cuerpo sin ningún estímulo esa semana).
- Para cualquier otra combinación (ej. PPL con 3 días), **respetar la elección del usuario tal cual**, y calcular un campo `avisoFrecuencia` (string, opcional) con un mensaje informativo si la combinación implica baja frecuencia por grupo muscular (ej. PPL con 3 días → "Con 3 días, cada grupo muscular se entrena 1 vez por semana. Si buscás más frecuencia, probá Full Body."). Este aviso **se muestra en la UI, pero no bloquea ni cambia nada automáticamente.**

**Actualización a la interfaz `RutinaGenerada` (sección 9.1 del spec base):**

```ts
interface RutinaGenerada {
  splitAsignado: "fullbody" | "torso_pierna" | "ppl";
  avisoFrecuencia?: string; // reemplaza a splitAjustado + mensajeAjuste específico de split
  dias: DiaRutina[];
  disclaimer: string;
}
```

**Test obligatorio (por el bug reportado — nunca se vio el aviso):** el `avisoFrecuencia` no puede quedar solo calculado en el backend; hay que verificar explícitamente que el frontend lo renderiza como un banner o tooltip visible en la pantalla de resultado de la encuesta. Agregar un test end-to-end que genere una combinación de baja frecuencia (ej. PPL + 3 días) y confirme que el texto aparece en el DOM.

---

## 2. Nueva pregunta: ¿incluir ejercicios de movilidad/estiramiento?

Modifica la sección 6.2 del spec base (que excluía estiramientos de forma rígida). Ahora es **opcional y elegido por el usuario**, no una exclusión fija.

**Nuevo campo en `EncuestaInput`:**
```ts
incluirMovilidad: boolean; // pregunta directa en la encuesta: "¿Querés incluir ejercicios de movilidad/estiramiento?"
```

- Si `incluirMovilidad === false` (default): se mantiene la exclusión de la sección 6.2 del spec base tal cual (los estiramientos no entran al pool ni se cuentan como ejercicios de la sesión).
- Si `incluirMovilidad === true`: los ejercicios de estiramiento (identificados por la misma heurística de nombre/instrucciones de 6.2) se agregan como un **bloque separado** al final de cada día (después del bloque de cardio si lo hay), con su propio label ("Movilidad") y su propio formato de visualización — nunca mezclados como si fueran series de fuerza "3x8". Reutilizar el mismo patrón de bloque separado que ya se define para cardio (sección 6.3 del spec base).

---

## 3. Selector de días: de número a barra de 7 botones (días específicos de la semana)

**Reemplaza** el campo `diasPorSemana: 1|2|3|4|5|6|7` de la sección 3 del spec base.

**Nuevo campo en `EncuestaInput`:**
```ts
diasSeleccionados: ("domingo" | "lunes" | "martes" | "miercoles" | "jueves" | "viernes" | "sabado")[];
// diasPorSemana ya no se pregunta directo — se deriva: diasPorSemana = diasSeleccionados.length
// esa cantidad sigue alimentando la matriz de la sección 4 (como default) y los cálculos de volumen de la sección 7.
```

**UI:** barra horizontal de 7 botones tipo toggle (Domingo, Lunes, Martes, Miércoles, Jueves, Viernes, Sábado — mismo orden y mismos labels que ya usa el "Horario semanal" del dashboard, ver `Plan.jsx` o el componente equivalente), multi-selección, sin mínimo ni máximo forzado más allá de exigir al menos 1 día marcado para poder avanzar al siguiente paso del wizard.

**Impacto en la generación:** los días de la rutina generada ya no son genéricos ("Día 1", "Día 2"); se asignan directamente a los días de la semana que el usuario marcó, y esos son los que se guardan y se muestran en el "Horario semanal" del dashboard (sección 12 y la card de la captura de referencia) — sin necesidad de un paso extra de mapeo manual por parte del usuario.

**Heurística de orden (no bloqueante, best-effort):** si el split es PPL o Torso/Pierna y los días seleccionados no son consecutivos, asignar el orden Push→Pull→Legs (o Torso→Pierna) siguiendo el orden cronológico de los días marcados, priorizando que el mismo grupo muscular no caiga en días consecutivos cuando el espaciado elegido por el usuario lo permita.

---

## 4. Nombres personalizados para cada rutina del día

Modifica la sección 9.1 del spec base (`diaLabel`). Actualmente todas las rutinas de un split Full Body se llaman igual ("Full Body") sin diferenciarse, lo cual es confuso en la lista de "Rutinas" del dashboard (ver captura: 3 cards idénticas que dicen "Full Body").

**Regla de nombrado por tipo de split:**

| Split | Nombres asignados en orden |
|---|---|
| Full Body | Full Body 1, Full Body 2, Full Body 3, Full Body 4... (según cantidad de días) |
| Torso/Pierna | Torso A, Pierna A, Torso B, Pierna B... (alternando y numerando cada vuelta completa) |
| PPL | Push, Pull, Legs (y si hay una 4ta+ sesión en la semana: Push 2, Pull 2, Legs 2...) |

**Actualización a `RutinaGenerada.dias[].diaLabel`:** pasa a mostrar el día de semana real + el nombre de split, ej. `"Lunes — Push"`, `"Miércoles — Full Body 2"`.

---

## 5. Nuevas preguntas en la encuesta

Agregar a `EncuestaInput` (sección 3 del spec base):

```ts
interface EncuestaInput {
  // ...todos los campos existentes del spec base, más:
  edad: number;
  pesoActualKg: number; // pre-carga el widget "Peso corporal" del dashboard con este valor como primer registro
  tiempoDescansoEntreEjercicios: "30-60s" | "60-90s" | "90-120s" | "120-180s";
  tipoProgresion: "lineal" | "doble_progresion" | "ondulante"; // alimenta el selector "Progresión" que ya existe en la UI (ver captura, hoy fijo en "Progresión lineal")
  metricaEsfuerzo: {
    tipo: "RIR" | "RPE";
    objetivo: string; // ej. "1-3" si es RIR, "7-9" si es RPE
  };
}
```

**Notas de implementación:**
- `pesoActualKg`: si el usuario ya tiene registros en el tracker de peso corporal, no pisar el historial — solo usar este valor si no hay ningún registro previo.
- `tipoProgresion`: este valor pasa a ser el default del selector "Progresión" que ya está en la pantalla de rutina (captura: "Progresión lineal ›"); el usuario lo puede seguir cambiando manualmente después, esto solo define el valor inicial.
- `metricaEsfuerzo`: se usa para mostrar la referencia de esfuerzo junto a cada ejercicio generado (ej. "3x8 @ RIR 2"), no cambia la lógica de series/reps definida en la sección 7 del spec base, solo la anota.
- No hay lógica adicional automática ligada a `edad` por ahora (no se usa para excluir ejercicios ni cambiar el algoritmo) — se captura como dato para uso futuro del producto.

---

## 6. Resumen de campos deprecados/renombrados

| Antes (spec base) | Ahora |
|---|---|
| `diasPorSemana: number` | `diasSeleccionados: string[]` (se deriva `diasPorSemana` de su longitud) |
| `splitAjustado: boolean` + `mensajeAjuste` (para split) | `avisoFrecuencia?: string` (no bloqueante) |
| Exclusión rígida de estiramientos (6.2) | Condicionada a `incluirMovilidad` (ver punto 2 de este documento) |
