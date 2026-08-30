
## 3. Orden y Estructura Recomendada de la Encuesta (UI)

Para maximizar la tasa de finalización y el orden lógico, la encuesta se agrupa en 5 Pasos:

Paso 1: Perfil & Biometría (edad, pesoKg, objetivo, nivel)

Paso 2: Disponibilidad & Tiempo (diasPorSemana, tiempoPorSesion, splitPreferido si aplica)

Paso 3: Equipamiento & Preferencias (equipamiento, preferenciaEjercicio, enfoque)

Paso 4: Parámetros de Entrenamiento (descansoSegundos, metricaEsfuerzo, tipoProgresion, cardio, movilidadEstiramientos)

Paso 5: Lesiones & Salud (tieneLesion, lesiones)

## 4. Matriz Determinista de Splits (Fuente de Verdad)

El split se deriva automáticamente según nivel y diasPorSemana. Si el usuario ingresa un splitPreferido incompatible, se ajusta automáticamente notificándolo en mensajeAjuste.

## 5. Pipeline de Filtrado y Calidad del Pool de Ejercicios

### 5.1 Filtro 1: Equipamiento

gimnasio_completo → Pool completo de EXDB.

solo_mancuernas → eq en ["dumbbell", "body weight"].

calistenia → eq === "body weight".

### 5.2 Filtro 2: Lesiones & Molestias (Lista de Exclusión Acumulativa)

### 5.3 Filtro 3: Validación Estricta de Diccionario ES (FIX BUG QA 6.4)

JavaScript

// Ningún ejercicio sin traducción en exercise-names-es.js puede entrar al pool const poolSeguro = poolFiltrado.filter(ex => { const tieneTraduccion = Boolean(exerciseNamesEs[ex.id]); return tieneTraduccion; });

### 5.4 Filtro 4: Pruning de Ejercicios "Raros" y Duplicados

Excluir variaciones acrobáticas o atípicas: Excluir por keyword en n: male, female, pyramid, wheel, bosu, single leg cable, etc., salvo que el pool sea muy reducido.

Evitar redundancia en la misma sesión: No colocar 2 ejercicios del mismo tg con el mismo tipo de patrón de movimiento (ejemplo: No poner Press de banca con barra Y Press de banca con mancuernas en la misma sesión).

## 6. Distribución de Slots por Tiempo y Métricas de Entrenamiento

### 6.1 Slots por Duración de Sesión (RECALCULADO Y CORREGIDO)

### 6.2 Asignación de Repeticiones y Métricas

Hipertrofia: 8 – 12 reps | RIR 1-2 / RPE 8-9 | Progresión: Doble Progresión

Fuerza: 3 – 6 reps | RIR 2-3 / RPE 7-8 | Progresión: Lineal

Perder Grasa: 8 – 15 reps | RIR 1-2 / RPE 8-9 | Progresión: Doble Progresión

Fitness General: 10 – 12 reps | RIR 2-3 / RPE 7-8 | Progresión: Lineal

## 7. Manejo del Bloque de Cardio y Movilidad (FIX BUG QA 6.3)

El cardio NUNCA se inserta dentro del array ejercicios[] de la sesión. Se genera como una propiedad dedicada:

JavaScript

// Formato del bloque de cardio cardio: respuestas.cardio !== "sin_cardio" ? { tipo: respuestas.cardio, // "suave_final", "hiit", "caminar_correr" duracionMin: respuestas.cardio === "hiit" ? 15 : 20, descripcion: respuestas.cardio === "hiit" ? "15 min de intervalos de alta intensidad (30s trabajo / 30s descanso)" : "15-20 min de cardio suave a ritmo constante (Cinta, Bici o Elíptica)" } : null

Si movilidadEstiramientos === true, agregar al objeto de la sesión:

JavaScript

movilidad: { duracionMin: 8, descripcion: "8 min de estiramientos estáticos de los grupos musculares trabajados y movilidad articular." }

## 8. Estructura Completa del Output (RutinaGenerada)

TypeScript

interface RutinaGeneradaV3 { splitAsignado: "fullbody" | "torso_pierna" | "ppl"; splitAjustado: boolean; mensajeAjuste?: string; // Parámetros Globales Recomendados parametrosGlobales: { descansoRecomendado: string; // "90-120 segundos entre series" tipoProgresion: string; // "Doble progresión: aumenta reps, luego peso" metricaEsfuerzo: string; // "RIR 1-2 (dejar 1 a 2 reps en recámara)" }; dias: { diaLabel: string; // "Día 1 - Full Body A" ejercicios: { exerciseId: string; // id de EXDB, resuelto en ES por el frontend series: number; repeticiones: string; // "8-12" notaEjecucion?: string; }[]; cardio?: { tipo: string; duracionMin: number; descripcion: string; } | null; movilidad?: { duracionMin: number; descripcion: string; } | null; }[]; disclaimer?: string; // Muestra aviso si tieneLesion = true }

## 9. Fallback y Mecanismos de Degradación (Pools Vacíos)

Nivel 1 (Filtro de Preferencia): Si maquinas_poleas o pesos_libres vacía el pool de un tg, ignorar la preferencia y tomar cualquier ejercicio seguro de poolSeguro.

Nivel 2 (Reutilización Segura): Si el pool de un tg tiene 1 solo ejercicio, reutilizarlo en la semana variando rango de repeticiones.

Nivel 3 (Sustitución Anatómica): Si un tg queda en 0 por lesiones + equipamiento (ej. quads en Calistenia + Lesión Rodillas):

Sustituir por ejercicios de cadena posterior seguros (glutes / hamstrings de bajo impacto como Hip Thrust o Curl femoral).

Agregar aviso en mensajeAjuste: "Ajustamos la selección de piernas a cadena posterior debido a la molestia en rodillas y el equipamiento disponible." """

with open("spec-motor-rutinas-v3.md", "w", encoding="utf-8") as f:

f.write(spec_content)

print("File 'spec-motor-rutinas-v3.md' generated successfully.")

```python?code_reference&code_event_index=2 spec_content = """# Spec: Motor de generación de rutinas personalizadas (v3) — openGym ## 1. Resumen de Ajustes y Correcciones de QA (Bugs Resueltos) Esta versión **v3** soluciona los problemas detectados durante las pruebas de QA: 1. **Bug del Bloque de Cardio (Sección 6.3 / 7):** El cardio NUNCA debe aparecer como un ejercicio más en el array `ejercicios[]` con formato de series x reps (ej. "3x8"). Debe ser un objeto independiente `cardio?: { tipo: string, duracionMin: number, intensidad?: string }`. 2. **Bug de Nombres Faltantes / "Ejercicio Desconocido" (Sección 6.4 / 5.3):** Antes de seleccionar cualquier `id` de `EXDB`, se DEBE validar que exista su traducción en `exercise-names-es.js`. Si no tiene traducción, se descarta del pool para evitar fallbacks como `"Ejercicio Desconocido: astride jumps (male)"`. 3. **Validación de Límites Razonables:** Se incorporan validaciones en el input para **Edad** (14 - 90 años) y **Peso** (30 - 250 kg). 4. **Reajuste Estricto de Slots por Tiempo de Sesión:** Para una sesión de 30-40 min, 6 ejercicios es excesivo. Se recalcula a 3-4 ejercicios máximo. 5. **Ampliación de Lesiones/Molestias:** Se expanden las zonas afectadas (codos, isquiotibiales, tobillos, etc.) con sus respectivas reglas de exclusión y sustitución. 6. **Integración de Nuevas Métricas y Parámetros:** Incorporación explícita de descanso entre series, métrica de esfuerzo (RIR / RPE), tipo de progresión (lineal, doble, etc.) y bloque opcional de movilidad/estiramientos. 7. **Filtrado de Ejercicios Raros y Redundantes:** Implementación de reglas de diversidad para evitar seleccionar ejercicios estrambóticos o variaciones casi idénticas dentro de la misma sesión/semana. --- ## 2. Esquema de Entrada (Encuesta Input v3) ```ts interface EncuestaInputV3 { // Datos Biometrics & Validacion edad: number; // min: 14, max: 90 pesoKg: number; // min: 30, max: 250 // Objetivo & Nivel objetivo: "hipertrofia" | "fuerza" | "perder_grasa" | "fitness_general"; nivel: "principiante" | "intermedio" | "avanzado"; // Logistica & Tiempo diasPorSemana: 1 | 2 | 3 | 4 | 5 | 6 | 7; tiempoPorSesion: "30-40" | "40-60" | "60-90" | "90+"; // minutos splitPreferido?: "fullbody" | "torso_pierna" | "ppl"; // Opcional, sujeto a validacion // Equipamiento & Preferencia equipamiento: "gimnasio_completo" | "solo_mancuernas" | "calistenia"; preferenciaEjercicio: "maquinas_poleas" | "pesos_libres" | "sin_preferencia"; // Parametros de Entrenamiento & Recuperacion enfoque: "balance" | "piernas_gluteos" | "torso_brazos"; descansoSegundos: "60" | "90-120" | "180+"; tipoProgresion: "lineal" | "doble_progresion" | "ondulante"; metricaEsfuerzo: "rir" | "rpe" | "porcentaje_rm"; // Complementos cardio: "sin_cardio" | "suave_final" | "hiit" | "caminar_correr"; movilidadEstiramientos: boolean; // agrega bloque de 5-10 min al final // Salud & Lesiones (Multi-select) tieneLesion: boolean; lesiones: ( | "hombros" | "espalda_baja" | "rodillas" | "munecas" | "cuello" | "cuadriceps" | "isquiotibiales" | "codos" | "tobillos" )[]; }

## 3. Orden y Estructura Recomendada de la Encuesta (UI)

Para maximizar la tasa de finalización y el orden lógico, la encuesta se agrupa en 5 Pasos:

Paso 1: Perfil & Biometría (edad, pesoKg, objetivo, nivel)

Paso 2: Disponibilidad & Tiempo (diasPorSemana, tiempoPorSesion, splitPreferido si aplica)

Paso 3: Equipamiento & Preferencias (equipamiento, preferenciaEjercicio, enfoque)

Paso 4: Parámetros de Entrenamiento (descansoSegundos, metricaEsfuerzo, tipoProgresion, cardio, movilidadEstiramientos)

Paso 5: Lesiones & Salud (tieneLesion, lesiones)

## 4. Matriz Determinista de Splits (Fuente de Verdad)

El split se deriva automáticamente según nivel y diasPorSemana. Si el usuario ingresa un splitPreferido incompatible, se ajusta automáticamente notificándolo en mensajeAjuste.

## 5. Pipeline de Filtrado y Calidad del Pool de Ejercicios

### 5.1 Filtro 1: Equipamiento

gimnasio_completo → Pool completo de EXDB.

solo_mancuernas → eq en ["dumbbell", "body weight"].

calistenia → eq === "body weight".

### 5.2 Filtro 2: Lesiones & Molestias (Lista de Exclusión Acumulativa)

### 5.3 Filtro 3: Validación Estricta de Diccionario ES (FIX BUG QA 6.4)

JavaScript

// Ningún ejercicio sin traducción en exercise-names-es.js puede entrar al pool const poolSeguro = poolFiltrado.filter(ex => { const tieneTraduccion = Boolean(exerciseNamesEs[ex.id]); return tieneTraduccion; });

### 5.4 Filtro 4: Pruning de Ejercicios "Raros" y Duplicados

Excluir variaciones acrobáticas o atípicas: Excluir por keyword en n: male, female, pyramid, wheel, bosu, single leg cable, etc., salvo que el pool sea muy reducido.

Evitar redundancia en la misma sesión: No colocar 2 ejercicios del mismo tg con el mismo tipo de patrón de movimiento (ejemplo: No poner Press de banca con barra Y Press de banca con mancuernas en la misma sesión).

## 6. Distribución de Slots por Tiempo y Métricas de Entrenamiento

### 6.1 Slots por Duración de Sesión (RECALCULADO Y CORREGIDO)

### 6.2 Asignación de Repeticiones y Métricas

Hipertrofia: 8 – 12 reps | RIR 1-2 / RPE 8-9 | Progresión: Doble Progresión

Fuerza: 3 – 6 reps | RIR 2-3 / RPE 7-8 | Progresión: Lineal

Perder Grasa: 8 – 15 reps | RIR 1-2 / RPE 8-9 | Progresión: Doble Progresión

Fitness General: 10 – 12 reps | RIR 2-3 / RPE 7-8 | Progresión: Lineal

## 7. Manejo del Bloque de Cardio y Movilidad (FIX BUG QA 6.3)

El cardio NUNCA se inserta dentro del array ejercicios[] de la sesión. Se genera como una propiedad dedicada:

JavaScript

// Formato del bloque de cardio cardio: respuestas.cardio !== "sin_cardio" ? { tipo: respuestas.cardio, // "suave_final", "hiit", "caminar_correr" duracionMin: respuestas.cardio === "hiit" ? 15 : 20, descripcion: respuestas.cardio === "hiit" ? "15 min de intervalos de alta intensidad (30s trabajo / 30s descanso)" : "15-20 min de cardio suave a ritmo constante (Cinta, Bici o Elíptica)" } : null

Si movilidadEstiramientos === true, agregar al objeto de la sesión:

JavaScript

movilidad: { duracionMin: 8, descripcion: "8 min de estiramientos estáticos de los grupos musculares trabajados y movilidad articular." }

## 8. Estructura Completa del Output (RutinaGenerada)

TypeScript

interface RutinaGeneradaV3 { splitAsignado: "fullbody" | "torso_pierna" | "ppl"; splitAjustado: boolean; mensajeAjuste?: string; // Parámetros Globales Recomendados parametrosGlobales: { descansoRecomendado: string; // "90-120 segundos entre series" tipoProgresion: string; // "Doble progresión: aumenta reps, luego peso" metricaEsfuerzo: string; // "RIR 1-2 (dejar 1 a 2 reps en recámara)" }; dias: { diaLabel: string; // "Día 1 - Full Body A" ejercicios: { exerciseId: string; // id de EXDB, resuelto en ES por el frontend series: number; repeticiones: string; // "8-12" notaEjecucion?: string; }[]; cardio?: { tipo: string; duracionMin: number; descripcion: string; } | null; movilidad?: { duracionMin: number; descripcion: string; } | null; }[]; disclaimer?: string; // Muestra aviso si tieneLesion = true }

## 9. Fallback y Mecanismos de Degradación (Pools Vacíos)

Nivel 1 (Filtro de Preferencia): Si maquinas_poleas o pesos_libres vacía el pool de un tg, ignorar la preferencia y tomar cualquier ejercicio seguro de poolSeguro.

Nivel 2 (Reutilización Segura): Si el pool de un tg tiene 1 solo ejercicio, reutilizarlo en la semana variando rango de repeticiones.

Nivel 3 (Sustitución Anatómica): Si un tg queda en 0 por lesiones + equipamiento (ej. quads en Calistenia + Lesión Rodillas):

Sustituir por ejercicios de cadena posterior seguros (glutes / hamstrings de bajo impacto como Hip Thrust o Curl femoral).

Agregar aviso en mensajeAjuste: "Ajustamos la selección de piernas a cadena posterior debido a la molestia en rodillas y el equipamiento disponible." """

file_path = "spec-motor-rutinas-v3.md"

with open(file_path, "w", encoding="utf-8") as f:

f.write(spec_content)

print(f"File {file_path} written successfully.")

```python?code_reference&code_event_index=3 with open("spec-motor-rutinas-v3.md", "w", encoding="utf-8") as f: f.write("# Spec: Motor de generación de rutinas personalizadas (v3) — openGym\n") print("Done")

Python

import os content = """# Spec: Motor de generación de rutinas personalizadas (v3) — openGym ## 1. Resumen de Ajustes y Correcciones de QA (Bugs Resueltos) Esta versión **v3** soluciona todos los problemas detectados en las pruebas de QA: 1. **Bug del Bloque de Cardio (Sección 6.3 / 7):** El cardio NUNCA debe aparecer como un ejercicio más en el array `ejercicios[]` con formato de series x reps (ej. "3x8"). Debe ser un objeto independiente `cardio?: { tipo: string, duracionMin: number, intensidad?: string }`. 2. **Bug de Nombres Faltantes / "Ejercicio Desconocido" (Sección 6.4 / 5.3):** Antes de seleccionar cualquier `id` de `EXDB`, se DEBE validar que exista su traducción en `exercise-names-es.js`. Si no tiene traducción, se descarta del pool para evitar fallbacks como `"Ejercicio Desconocido: astride jumps (male)"`. 3. **Validación de Límites Razonables:** Se incorporan validaciones en el input para **Edad** (14 - 90 años) y **Peso** (30 - 250 kg). 4. **Reajuste Estricto de Slots por Tiempo de Sesión:** Para una sesión de 30-40 min, 6 ejercicios es excesivo. Se recalcula a 3-4 ejercicios máximo. 5. **Ampliación de Lesiones/Molestias:** Se expanden las zonas afectadas (codos, isquiotibiales, tobillos, etc.) con sus respectivas reglas de exclusión y sustitución. 6. **Integración de Nuevas Métricas y Parámetros:** Incorporación explícita de descanso entre series, métrica de esfuerzo (RIR / RPE), tipo de progresión (lineal, doble, etc.) y bloque opcional de movilidad/estiramientos. 7. **Filtrado de Ejercicios Raros y Redundantes:** Implementación de reglas de diversidad para evitar seleccionar ejercicios estrambóticos o variaciones casi idénticas dentro de la misma sesión/semana. --- ## 2. Esquema de Entrada (Encuesta Input v3) ```ts interface EncuestaInputV3 { // Datos Biométricos & Validación edad: number; // min: 14, max: 90 pesoKg: number; // min: 30, max: 250 // Objetivo & Nivel objetivo: "hipertrofia" | "fuerza" | "perder_grasa" | "fitness_general"; nivel: "principiante" | "intermedio" | "avanzado"; // Logística & Tiempo diasPorSemana: 1 | 2 | 3 | 4 | 5 | 6 | 7; tiempoPorSesion: "30-40" | "40-60" | "60-90" | "90+"; // minutos splitPreferido?: "fullbody" | "torso_pierna" | "ppl"; // Opcional, sujeto a validación // Equipamiento & Preferencia equipamiento: "gimnasio_completo" | "solo_mancuernas" | "calistenia"; preferenciaEjercicio: "maquinas_poleas" | "pesos_libres" | "sin_preferencia"; // Parámetros de Entrenamiento & Recuperación enfoque: "balance" | "piernas_gluteos" | "torso_brazos"; descansoSegundos: "60" | "90-120" | "180+"; tipoProgresion: "lineal" | "doble_progresion" | "ondulante"; metricaEsfuerzo: "rir" | "rpe" | "porcentaje_rm"; // Complementos cardio: "sin_cardio" | "suave_final" | "hiit" | "caminar_correr"; movilidadEstiramientos: boolean; // agrega bloque de 5-10 min al final // Salud & Lesiones (Multi-select) tieneLesion: boolean; lesiones: ( | "hombros" | "espalda_baja" | "rodillas" | "munecas" | "cuello" | "cuadriceps" | "isquiotibiales" | "codos" | "tobillos" )[]; }

## 3. Orden y Estructura Recomendada de la Encuesta (UI)

Para maximizar la tasa de finalización y el orden lógico, la encuesta se agrupa en 5 Pasos:

Paso 1: Perfil & Biometría (edad, pesoKg, objetivo, nivel)

Paso 2: Disponibilidad & Tiempo (diasPorSemana, tiempoPorSesion, splitPreferido si aplica)

Paso 3: Equipamiento & Preferencias (equipamiento, preferenciaEjercicio, enfoque)

Paso 4: Parámetros de Entrenamiento (descansoSegundos, metricaEsfuerzo, tipoProgresion, cardio, movilidadEstiramientos)

Paso 5: Lesiones & Salud (tieneLesion, lesiones)

## 4. Matriz Determinista de Splits (Fuente de Verdad)

El split se deriva automáticamente según nivel y diasPorSemana. Si el usuario ingresa un splitPreferido incompatible, se ajusta automáticamente notificándolo en mensajeAjuste.

## 5. Pipeline de Filtrado y Calidad del Pool de Ejercicios

### 5.1 Filtro 1: Equipamiento

gimnasio_completo → Pool completo de EXDB.

solo_mancuernas → eq en ["dumbbell", "body weight"].

calistenia → eq === "body weight".

### 5.2 Filtro 2: Lesiones & Molestias (Lista de Exclusión Acumulativa)

### 5.3 Filtro 3: Validación Estricta de Diccionario ES (FIX BUG QA 6.4)

JavaScript

// Ningún ejercicio sin traducción en exercise-names-es.js puede entrar al pool const poolSeguro = poolFiltrado.filter(ex => { const tieneTraduccion = Boolean(exerciseNamesEs[ex.id]); return tieneTraduccion; });

### 5.4 Filtro 4: Pruning de Ejercicios "Raros" y Duplicados

Excluir variaciones acrobáticas o atípicas: Excluir por keyword en n: male, female, pyramid, wheel, bosu, single leg cable, etc., salvo que el pool sea muy reducido.

Evitar redundancia en la misma sesión: No colocar 2 ejercicios del mismo tg con el mismo tipo de patrón de movimiento (ejemplo: No poner Press de banca con barra Y Press de banca con mancuernas en la misma sesión).

## 6. Distribución de Slots por Tiempo y Métricas de Entrenamiento

### 6.1 Slots por Duración de Sesión (RECALCULADO Y CORREGIDO)

### 6.2 Asignación de Repeticiones y Métricas

Hipertrofia: 8 – 12 reps | RIR 1-2 / RPE 8-9 | Progresión: Doble Progresión

Fuerza: 3 – 6 reps | RIR 2-3 / RPE 7-8 | Progresión: Lineal

Perder Grasa: 8 – 15 reps | RIR 1-2 / RPE 8-9 | Progresión: Doble Progresión

Fitness General: 10 – 12 reps | RIR 2-3 / RPE 7-8 | Progresión: Lineal

## 7. Manejo del Bloque de Cardio y Movilidad (FIX BUG QA 6.3)

El cardio NUNCA se inserta dentro del array ejercicios[] de la sesión. Se genera como una propiedad dedicada:

JavaScript

// Formato del bloque de cardio cardio: respuestas.cardio !== "sin_cardio" ? { tipo: respuestas.cardio, // "suave_final", "hiit", "caminar_correr" duracionMin: respuestas.cardio === "hiit" ? 15 : 20, descripcion: respuestas.cardio === "hiit" ? "15 min de intervalos de alta intensidad (30s trabajo / 30s descanso)" : "15-20 min de cardio suave a ritmo constante (Cinta, Bici o Elíptica)" } : null

Si movilidadEstiramientos === true, agregar al objeto de la sesión:

JavaScript

movilidad: { duracionMin: 8, descripcion: "8 min de estiramientos estáticos de los grupos musculares trabajados y movilidad articular." }

## 8. Estructura Completa del Output (RutinaGenerada)

TypeScript

interface RutinaGeneradaV3 { splitAsignado: "fullbody" | "torso_pierna" | "ppl"; splitAjustado: boolean; mensajeAjuste?: string; // Parámetros Globales Recomendados parametrosGlobales: { descansoRecomendado: string; // "90-120 segundos entre series" tipoProgresion: string; // "Doble progresión: aumenta reps, luego peso" metricaEsfuerzo: string; // "RIR 1-2 (dejar 1 a 2 reps en recámara)" }; dias: { diaLabel: string; // "Día 1 - Full Body A" ejercicios: { exerciseId: string; // id de EXDB, resuelto en ES por el frontend series: number; repeticiones: string; // "8-12" notaEjecucion?: string; }[]; cardio?: { tipo: string; duracionMin: number; descripcion: string; } | null; movilidad?: { duracionMin: number; descripcion: string; } | null; }[]; disclaimer?: string; // Muestra aviso si tieneLesion = true }

## 9. Fallback y Mecanismos de Degradación (Pools Vacíos)

Nivel 1 (Filtro de Preferencia): Si maquinas_poleas o pesos_libres vacía el pool de un tg, ignorar la preferencia y tomar cualquier ejercicio seguro de poolSeguro.

Nivel 2 (Reutilización Segura): Si el pool de un tg tiene 1 solo ejercicio, reutilizarlo en la semana variando rango de repeticiones.

Nivel 3 (Sustitución Anatómica): Si un tg queda en 0 por lesiones + equipamiento (ej. quads en Calistenia + Lesión Rodillas):

Sustituir por ejercicios de cadena posterior seguros (glutes / hamstrings de bajo impacto como Hip Thrust o Curl femoral).

Agregar aviso en mensajeAjuste: "Ajustamos la selección de piernas a cadena posterior debido a la molestia en rodillas y el equipamiento disponible." """

with open("spec-motor-rutinas-v3.md", "w", encoding="utf-8") as f:

f.write(content)

print("FILE_CREATED: spec-motor-rutinas-v3.md")

Acá tenés el documento técnico completo **v3** (`spec-motor-rutinas-v3.md`) listo para copiar y pasarle directamente a Antigravity. Incluye todas las correcciones de los bugs detectados en las pruebas de QA (cardio separado sin formato "3x8", validación de traducción en español para evitar "Ejercicio Desconocido", recálculo de ejercicios por tiempo, límites de edad/peso, lista extendida de lesiones y métricas avanzadas). --- ```markdown # Spec: Motor de generación de rutinas personalizadas (v3) — openGym ## 1. Resumen de Ajustes y Correcciones de QA (Bugs Resueltos) Esta versión **v3** soluciona los problemas detectados durante las pruebas de QA: 1. **Bug del Bloque de Cardio (Sección 6.3 / 7):** El cardio NUNCA debe aparecer como un ejercicio más en el array `ejercicios[]` con formato de series x reps (ej. "3x8"). Debe ser un objeto independiente `cardio?: { tipo: string, duracionMin: number, descripcion: string }`. 2. **Bug de Nombres Faltantes / "Ejercicio Desconocido" (Sección 6.4 / 5.3):** Antes de seleccionar cualquier `id` de `EXDB`, se DEBE validar que exista su traducción en `exercise-names-es.js`. Si no tiene traducción, se descarta del pool para evitar fallbacks como `"Ejercicio Desconocido: astride jumps (male)"`. 3. **Validación de Límites Razonables:** Se incorporan validaciones en el input para **Edad** (14 - 90 años) y **Peso** (30 - 250 kg). 4. **Reajuste Estricto de Slots por Tiempo de Sesión:** Para una sesión de 30-40 min, 6 ejercicios es excesivo. Se recalcula a **3-4 ejercicios máximo**. 5. **Ampliación de Lesiones/Molestias:** Se expanden las zonas afectadas (codos, isquiotibiales, tobillos, etc.) con sus respectivas reglas de exclusión y sustitución. 6. **Integración de Nuevas Métricas y Parámetros:** Incorporación explícita de descanso entre series, métrica de esfuerzo (RIR / RPE), tipo de progresión (lineal, doble, etc.) y bloque opcional de movilidad/estiramientos. 7. **Filtrado de Ejercicios Raros y Redundantes:** Implementación de reglas de diversidad para evitar seleccionar ejercicios estrambóticos o variaciones casi idénticas dentro de la misma sesión/semana. --- ## 2. Esquema de Entrada (Encuesta Input v3) ```ts interface EncuestaInputV3 { // Datos Biométricos & Validación (Límites: edad 14-90, peso 30-250 kg) edad: number; pesoKg: number; // Objetivo & Nivel objetivo: "hipertrofia" | "fuerza" | "perder_grasa" | "fitness_general"; nivel: "principiante" | "intermedio" | "avanzado"; // Logística & Tiempo diasPorSemana: 1 | 2 | 3 | 4 | 5 | 6 | 7; tiempoPorSesion: "30-40" | "40-60" | "60-90" | "90+"; // minutos splitPreferido?: "fullbody" | "torso_pierna" | "ppl"; // Opcional, sujeto a validación de matriz // Equipamiento & Preferencia equipamiento: "gimnasio_completo" | "solo_mancuernas" | "calistenia"; preferenciaEjercicio: "maquinas_poleas" | "pesos_libres" | "sin_preferencia"; // Parámetros de Entrenamiento & Recuperación enfoque: "balance" | "piernas_gluteos" | "torso_brazos"; descansoSegundos: "60" | "90-120" | "180+"; tipoProgresion: "lineal" | "doble_progresion" | "ondulante"; metricaEsfuerzo: "rir" | "rpe" | "porcentaje_rm"; // Complementos cardio: "sin_cardio" | "suave_final" | "hiit" | "caminar_correr"; movilidadEstiramientos: boolean; // agrega bloque de 5-10 min al final // Salud & Lesiones (Multi-select) tieneLesion: boolean; lesiones: ( | "hombros" | "espalda_baja" | "rodillas" | "munecas" | "cuello" | "cuadriceps" | "isquiotibiales" | "codos" | "tobillos" )[]; }

## 3. Orden y Estructura Recomendada de la Encuesta (UI)

Para maximizar la tasa de finalización y el orden lógico, la encuesta se agrupa en 5 Pasos:

Paso 1: Perfil & Biometría (edad, pesoKg, objetivo, nivel)

Paso 2: Disponibilidad & Tiempo (diasPorSemana, tiempoPorSesion, splitPreferido si aplica)

Paso 3: Equipamiento & Preferencias (equipamiento, preferenciaEjercicio, enfoque)

Paso 4: Parámetros de Entrenamiento (descansoSegundos, metricaEsfuerzo, tipoProgresion, cardio, movilidadEstiramientos)

Paso 5: Lesiones & Salud (tieneLesion, lesiones)

## 4. Matriz Determinista de Splits (Fuente de Verdad)

El split se deriva automáticamente según nivel y diasPorSemana. Si el usuario ingresa un splitPreferido incompatible, se ajusta automáticamente notificándolo en mensajeAjuste.

## 5. Pipeline de Filtrado y Calidad del Pool de Ejercicios

### 5.1 Filtro 1: Equipamiento

gimnasio_completo → Pool completo de EXDB.

solo_mancuernas → eq en ["dumbbell", "body weight"].

calistenia → eq === "body weight".

### 5.2 Filtro 2: Lesiones & Molestias (Lista de Exclusión Acumulativa)

### 5.3 Filtro 3: Validación Estricta de Diccionario ES (FIX BUG QA 6.4)

JavaScript

// Ningún ejercicio sin traducción en exercise-names-es.js puede entrar al pool const poolSeguro = poolFiltrado.filter(ex => { const tieneTraduccion = Boolean(exerciseNamesEs[ex.id]); return tieneTraduccion; });

### 5.4 Filtro 4: Pruning de Ejercicios "Raros" y Duplicados

Excluir variaciones acrobáticas o atípicas: Excluir por keyword en n: male, female, pyramid, wheel, bosu, single leg cable, etc., salvo que el pool sea muy reducido.

Evitar redundancia en la misma sesión: No colocar 2 ejercicios del mismo tg con el mismo tipo de patrón de movimiento (ejemplo: No poner Press de banca con barra Y Press de banca con mancuernas en la misma sesión).

## 6. Distribución de Slots por Tiempo y Métricas de Entrenamiento

### 6.1 Slots por Duración de Sesión (RECALCULADO Y CORREGIDO)

### 6.2 Asignación de Repeticiones y Métricas

Hipertrofia: 8 – 12 reps | RIR 1-2 / RPE 8-9 | Progresión: Doble Progresión

Fuerza: 3 – 6 reps | RIR 2-3 / RPE 7-8 | Progresión: Lineal

Perder Grasa: 8 – 15 reps | RIR 1-2 / RPE 8-9 | Progresión: Doble Progresión

Fitness General: 10 – 12 reps | RIR 2-3 / RPE 7-8 | Progresión: Lineal

## 7. Manejo del Bloque de Cardio y Movilidad (FIX BUG QA 6.3)

El cardio NUNCA se inserta dentro del array ejercicios[] de la sesión. Se genera como una propiedad dedicada:

JavaScript

// Formato del bloque de cardio cardio: respuestas.cardio !== "sin_cardio" ? { tipo: respuestas.cardio, // "suave_final", "hiit", "caminar_correr" duracionMin: respuestas.cardio === "hiit" ? 15 : 20, descripcion: respuestas.cardio === "hiit" ? "15 min de intervalos de alta intensidad (30s trabajo / 30s descanso)" : "15-20 min de cardio suave a ritmo constante (Cinta, Bici o Elíptica)" } : null

Si movilidadEstiramientos === true, agregar al objeto de la sesión:

JavaScript

movilidad: { duracionMin: 8, descripcion: "8 min de estiramientos estáticos de los grupos musculares trabajados y movilidad articular." }

## 8. Estructura Completa del Output (RutinaGenerada)

TypeScript

interface RutinaGeneradaV3 { splitAsignado: "fullbody" | "torso_pierna" | "ppl"; splitAjustado: boolean; mensajeAjuste?: string; // Parámetros Globales Recomendados parametrosGlobales: { descansoRecomendado: string; // "90-120 segundos entre series" tipoProgresion: string; // "Doble progresión: aumenta reps, luego peso" metricaEsfuerzo: string; // "RIR 1-2 (dejar 1 a 2 reps en recámara)" }; dias: { diaLabel: string; // "Día 1 - Full Body A" ejercicios: { exerciseId: string; // id de EXDB, resuelto en ES por el frontend series: number; repeticiones: string; // "8-12" notaEjecucion?: string; }[]; cardio?: { tipo: string; duracionMin: number; descripcion: string; } | null; movilidad?: { duracionMin: number; descripcion: string; } | null; }[]; disclaimer?: string; // Muestra aviso si tieneLesion = true }

## 9. Fallback y Mecanismos de Degradación (Pools Vacíos)

Nivel 1 (Filtro de Preferencia): Si maquinas_poleas o pesos_libres vacía el pool de un tg, ignorar la preferencia y tomar cualquier ejercicio seguro de poolSeguro.

Nivel 2 (Reutilización Segura): Si el pool de un tg tiene 1 solo ejercicio, reutilizarlo en la semana variando rango de repeticiones.

Nivel 3 (Sustitución Anatómica): Si un tg queda en 0 por lesiones + equipamiento (ej. quads en Calistenia + Lesión Rodillas):

Sustituir por ejercicios de cadena posterior seguros (glutes / hamstrings de bajo impacto como Hip Thrust o Curl femoral).

Agregar aviso en mensajeAjuste: "Ajustamos la selección de piernas a cadena posterior debido a la molestia en rodillas y el equipamiento disponible."

| Nivel | Días | Split Asignado | Notas / Restricciones |
| --- | --- | --- | --- |
| Todos | 1 | Full Body | Alta densidad, mantenimiento sistémico |
| Principiante | 2 | Full Body A/B | — |
| Principiante | 3 | Full Body A/B/A | Rota a B/A/B la siguiente semana |
| Principiante | 4 | Full Body A/B/A/B | Forzar Full Body, prohibido PPL |
| Principiante | 5-7 | Full Body (Variantes A/B/C) | No forzar aislamientos masivos |
| Intermedio | 2-3 | Full Body | PPL en 3 días deja frecuencia F=1 (insuficiente) |
| Intermedio | 4 | Torso / Pierna x2 | Frecuencia F=2 óptima |
| Intermedio | 5-6 | PPL (Push / Pull / Legs) | Frecuencia F=2 |
| Intermedio | 7 | PPL + 1 día de movilidad/core | Evitar sobreentrenamiento |
| Avanzado | 2-3 | Full Body | Evita desbalance de frecuencia |
| Avanzado | 4 | Torso / Pierna | — |
| Avanzado | 5 | PPL + 1 Torso/Pierna Extra | Según enfoque seleccionado |
| Avanzado | 6-7 | PPL x2 | — |

| Lesión | Exclusión por bp/tg | Exclusión por Keyword en n (English, case-insensitive) |
| --- | --- | --- |
| Hombros | bp === "shoulders" | overhead, military press, behind the neck, dip, upright row, arnold press, handstand |
| Espalda baja | — | deadlift, good morning, hyperextension, bent over row, back squat, clean, snatch, superman |
| Rodillas | — | squat, lunge, leg extension, jump, box jump, step up, pistol |
| Muñecas | — | push-up, push up, plank, handstand, front squat, clean, wrist curl, barbell curl |
| Cuello | bp === "neck" | shrug, behind the neck, neck |
| Cuádriceps | tg === "quads" | squat, lunge, leg extension, sprint, jump |
| Isquiotibiales | tg === "hamstrings" | deadlift, leg curl, good morning, nordic |
| Codos | — | skull crusher, triceps extension, french press, bench press (pesado con barra) |
| Tobillos | bp === "lower legs" | jump, box jump, calf raise (de pie pesado), skip |

| Tiempo / Sesión | N° Ejercicios de Fuerza | Series por Ejercicio | Series Totales |
| --- | --- | --- | --- |
| 30–40 min | 3 – 4 | 3 | 9 – 12 |
| 40–60 min | 5 – 6 | 3 – 4 | 15 – 18 |
| 60–90 min | 6 – 7 | 3 – 4 | 18 – 22 |
| 90+ min | 7 – 8 | 3 – 4 | 22 – 26 |

| Nivel | Días | Split Asignado | Notas / Restricciones |
| --- | --- | --- | --- |
| Todos | 1 | Full Body | Alta densidad, mantenimiento sistémico |
| Principiante | 2 | Full Body A/B | — |
| Principiante | 3 | Full Body A/B/A | Rota a B/A/B la siguiente semana |
| Principiante | 4 | Full Body A/B/A/B | Forzar Full Body, prohibido PPL |
| Principiante | 5-7 | Full Body (Variantes A/B/C) | No forzar aislamientos masivos |
| Intermedio | 2-3 | Full Body | PPL en 3 días deja frecuencia F=1 (insuficiente) |
| Intermedio | 4 | Torso / Pierna x2 | Frecuencia F=2 óptima |
| Intermedio | 5-6 | PPL (Push / Pull / Legs) | Frecuencia F=2 |
| Intermedio | 7 | PPL + 1 día de movilidad/core | Evitar sobreentrenamiento |
| Avanzado | 2-3 | Full Body | Evita desbalance de frecuencia |
| Avanzado | 4 | Torso / Pierna | — |
| Avanzado | 5 | PPL + 1 Torso/Pierna Extra | Según enfoque seleccionado |
| Avanzado | 6-7 | PPL x2 | — |

| Lesión | Exclusión por bp/tg | Exclusión por Keyword en n (English, case-insensitive) |
| --- | --- | --- |
| Hombros | bp === "shoulders" | overhead, military press, behind the neck, dip, upright row, arnold press, handstand |
| Espalda baja | — | deadlift, good morning, hyperextension, bent over row, back squat, clean, snatch, superman |
| Rodillas | — | squat, lunge, leg extension, jump, box jump, step up, pistol |
| Muñecas | — | push-up, push up, plank, handstand, front squat, clean, wrist curl, barbell curl |
| Cuello | bp === "neck" | shrug, behind the neck, neck |
| Cuádriceps | tg === "quads" | squat, lunge, leg extension, sprint, jump |
| Isquiotibiales | tg === "hamstrings" | deadlift, leg curl, good morning, nordic |
| Codos | — | skull crusher, triceps extension, french press, bench press (pesado con barra) |
| Tobillos | bp === "lower legs" | jump, box jump, calf raise (de pie pesado), skip |

| Tiempo / Sesión | N° Ejercicios de Fuerza | Series por Ejercicio | Series Totales |
| --- | --- | --- | --- |
| 30–40 min | 3 – 4 | 3 | 9 – 12 |
| 40–60 min | 5 – 6 | 3 – 4 | 15 – 18 |
| 60–90 min | 6 – 7 | 3 – 4 | 18 – 22 |
| 90+ min | 7 – 8 | 3 – 4 | 22 – 26 |

| Nivel | Días | Split Asignado | Notas / Restricciones |
| --- | --- | --- | --- |
| Todos | 1 | Full Body | Alta densidad, mantenimiento sistémico |
| Principiante | 2 | Full Body A/B | — |
| Principiante | 3 | Full Body A/B/A | Rota a B/A/B la siguiente semana |
| Principiante | 4 | Full Body A/B/A/B | Forzar Full Body, prohibido PPL |
| Principiante | 5-7 | Full Body (Variantes A/B/C) | No forzar aislamientos masivos |
| Intermedio | 2-3 | Full Body | PPL en 3 días deja frecuencia F=1 (insuficiente) |
| Intermedio | 4 | Torso / Pierna x2 | Frecuencia F=2 óptima |
| Intermedio | 5-6 | PPL (Push / Pull / Legs) | Frecuencia F=2 |
| Intermedio | 7 | PPL + 1 día de movilidad/core | Evitar sobreentrenamiento |
| Avanzado | 2-3 | Full Body | Evita desbalance de frecuencia |
| Avanzado | 4 | Torso / Pierna | — |
| Avanzado | 5 | PPL + 1 Torso/Pierna Extra | Según enfoque seleccionado |
| Avanzado | 6-7 | PPL x2 | — |

| Lesión | Exclusión por bp/tg | Exclusión por Keyword en n (English, case-insensitive) |
| --- | --- | --- |
| Hombros | bp === "shoulders" | overhead, military press, behind the neck, dip, upright row, arnold press, handstand |
| Espalda baja | — | deadlift, good morning, hyperextension, bent over row, back squat, clean, snatch, superman |
| Rodillas | — | squat, lunge, leg extension, jump, box jump, step up, pistol |
| Muñecas | — | push-up, push up, plank, handstand, front squat, clean, wrist curl, barbell curl |
| Cuello | bp === "neck" | shrug, behind the neck, neck |
| Cuádriceps | tg === "quads" | squat, lunge, leg extension, sprint, jump |
| Isquiotibiales | tg === "hamstrings" | deadlift, leg curl, good morning, nordic |
| Codos | — | skull crusher, triceps extension, french press, bench press (pesado con barra) |
| Tobillos | bp === "lower legs" | jump, box jump, calf raise (de pie pesado), skip |

| Tiempo / Sesión | N° Ejercicios de Fuerza | Series por Ejercicio | Series Totales |
| --- | --- | --- | --- |
| 30–40 min | 3 – 4 | 3 | 9 – 12 |
| 40–60 min | 5 – 6 | 3 – 4 | 15 – 18 |
| 60–90 min | 6 – 7 | 3 – 4 | 18 – 22 |
| 90+ min | 7 – 8 | 3 – 4 | 22 – 26 |

| Nivel | Días | Split Asignado | Notas / Restricciones |
| --- | --- | --- | --- |
| Todos | 1 | Full Body | Alta densidad, mantenimiento sistémico |
| Principiante | 2 | Full Body A/B | — |
| Principiante | 3 | Full Body A/B/A | Rota a B/A/B la siguiente semana |
| Principiante | 4 | Full Body A/B/A/B | Forzar Full Body, prohibido PPL |
| Principiante | 5-7 | Full Body (Variantes A/B/C) | No forzar aislamientos masivos |
| Intermedio | 2-3 | Full Body | PPL en 3 días deja frecuencia F=1 (insuficiente) |
| Intermedio | 4 | Torso / Pierna x2 | Frecuencia F=2 óptima |
| Intermedio | 5-6 | PPL (Push / Pull / Legs) | Frecuencia F=2 |
| Intermedio | 7 | PPL + 1 día de movilidad/core | Evitar sobreentrenamiento |
| Avanzado | 2-3 | Full Body | Evita desbalance de frecuencia |
| Avanzado | 4 | Torso / Pierna | — |
| Avanzado | 5 | PPL + 1 Torso/Pierna Extra | Según enfoque seleccionado |
| Avanzado | 6-7 | PPL x2 | — |

| Lesión | Exclusión por bp/tg | Exclusión por Keyword en n (English, case-insensitive) |
| --- | --- | --- |
| Hombros | bp === "shoulders" | overhead, military press, behind the neck, dip, upright row, arnold press, handstand |
| Espalda baja | — | deadlift, good morning, hyperextension, bent over row, back squat, clean, snatch, superman |
| Rodillas | — | squat, lunge, leg extension, jump, box jump, step up, pistol |
| Muñecas | — | push-up, push up, plank, handstand, front squat, clean, wrist curl, barbell curl |
| Cuello | bp === "neck" | shrug, behind the neck, neck |
| Cuádriceps | tg === "quads" | squat, lunge, leg extension, sprint, jump |
| Isquiotibiales | tg === "hamstrings" | deadlift, leg curl, good morning, nordic |
| Codos | — | skull crusher, triceps extension, french press, bench press (pesado con barra) |
| Tobillos | bp === "lower legs" | jump, box jump, calf raise (de pie pesado), skip |

| Tiempo / Sesión | N° Ejercicios de Fuerza | Series por Ejercicio | Series Totales |
| --- | --- | --- | --- |
| 30–40 min | 3 – 4 | 3 | 9 – 12 |
| 40–60 min | 5 – 6 | 3 – 4 | 15 – 18 |
| 60–90 min | 6 – 7 | 3 – 4 | 18 – 22 |
| 90+ min | 7 – 8 | 3 – 4 | 22 – 26 |
