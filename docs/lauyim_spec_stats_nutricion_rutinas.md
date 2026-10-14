# Spec — Stats, Nutrición, Administrar Nutrición/Rutina y Motor de rutinas por entrevista

Fecha: 2026-10-13 · Base: `main` @ b97c2fb

Surge de dos auditorías:

1. Vista Stats, vista Nutrición (socio) y la hoja "Administrar Nutrición/Rutina" que abre el staff al tocar un socio.
2. Motor de generación de rutinas por entrevista (`SurveyWizard` + `generarRutina.js`). Se simularon 8 perfiles reales y se revisaron las rutinas resultantes.

Se trabaja **un módulo a la vez**. Cada módulo tiene su propia branch, sus tests, una prueba en dev y se mergea a `main` solo cuando se pida. Los IDs (`S-B1`, `N-F2`, …) sirven para seguir cada ítem en commits y PRs.

Severidad: **Alta** = el socio o el staff ve algo incorrecto o pierde datos/acciones. **Media** = incorrecto en casos acotados, o UX que confunde. **Baja** = cosmético, deuda o rendimiento.

---

## 0. Principios transversales (aplican a los 4 módulos)

### 0.1 Visualmente lindo
- Usar solo los componentes y tokens existentes (`card`, `Section`, `Row`, `Segmented`, `Button`, `tiles`, variables `--acc`, `--label-*`, `--sep`). No crear estilos inline nuevos donde ya exista una clase.
- Jerarquía clara: un número grande por tarjeta (el dato principal) y la unidad en `dim`. Los textos secundarios en `small muted`.
- Una sola acción primaria por pantalla u hoja (botón `primary`). El resto, `tinted` o `ghost`.
- Gráficos: mismo `LineChart`, mismos colores semánticos (azul = progreso, amarillo = esfuerzo, rojo solo para errores o peligro, nunca para "te pasaste de proteína").
- Antes de construir una vista nueva, hacer un mockup HTML A/B que incluya el layout de PC. El usuario elige una opción y recién ahí se codea.

### 0.2 Efectivo
- Valores por defecto inteligentes: el caso común no necesita tocar nada.
- Menos toques: las acciones frecuentes quedan a un toque (repetir comida, registrar peso, reemplazar ejercicio).
- Cada número que se muestra dice de dónde sale (período, base de cálculo) cuando no es obvio.

### 0.3 Simple
- Divulgación progresiva: lo avanzado va plegado o detrás de "Ver más".
- Nada de jerga sin explicar (RIR, RPE, TMB, 1RM estimado, split, DUP).
- Textos en español rioplatense (voseo), todos pasando por `t()`. Nada hardcodeado en inglés o español fuera de `t()`.

### 0.4 Explicativo en los puntos clave
Patrón único: botón `helpbtn` (ícono `info`) junto al título, que abre una hoja corta con: qué es, cómo se calcula y qué hacer con el dato. Máximo unas 5 líneas más un botón "Entendido".

Puntos donde es obligatorio:

| Lugar | Qué explicar |
|---|---|
| Stats → Balance muscular | Qué cuenta como serie, qué es "Duras", por qué la ventana "Semana" es de lunes a domingo |
| Stats → Fatiga / Fuerza | Diferencia entre fatiga (descanso) y fuerza retenida; qué hacer si un músculo está en rojo |
| Stats → Esfuerzo | RIR y RPE con un ejemplo concreto |
| Stats → 1RM estimado | Que es una estimación y no un máximo probado |
| Nutrición → Calorías | Fórmula real usada (ver N-B2) y qué datos faltan si se usan valores por defecto |
| Nutrición → Historial | Cómo se calcula el promedio |
| Admin → Metas | Automático vs manual, y que el socio no ve de dónde vienen |
| Admin → Limitar sugerencias | Qué ve el socio con el switch prendido o apagado |
| Admin → Grupos de rutina | Qué es el grupo activo y que cambiarlo cambia el plan del socio |
| Encuesta → cada paso | Por qué se pregunta y qué cambia en la rutina |

- Estados vacíos: siempre con la próxima acción ("Todavía no registraste comidas hoy · [Agregar desayuno]").
- Acciones destructivas: siempre con confirmación. Si es posible, toast con "Deshacer".
- Resultado de cada acción: toast breve en positivo ("Meta guardada", "Rutina actualizada").

---

## Módulo 1 — Stats (vista del socio)

Archivos: `frontend/src/views/Stats.jsx`, `frontend/src/lib/muscles.js`, `frontend/src/lib/history.js`.

### Bugs

**S-B1 · Alta · Tocar un ejercicio en Fuerza tira error**
- `Stats.jsx:195`: `onExercise` no está declarado. Al tocar la fila sale `ReferenceError` y no pasa nada, aunque la fila tiene `cursor: pointer`.
- `Stats.test.js:23` verifica el texto literal del bug, así que no lo detecta.
- Fix: `MuscleBalance` recibe `onExercise` como prop. `Stats` pasa una función que hace `setExId(id)`, `setExMetric('e1rm')` y scrollea a la tarjeta "Progreso por ejercicio" (`data-tour="progress-card"`).
- Aceptación: tocar un ejercicio en Fuerza deja ese ejercicio seleccionado en Progreso, con la vista de 1RM estimado. El test se reescribe sobre comportamiento, no sobre el texto fuente.

**S-B2 · Media · Balance muscular ignora clases y "marcar realizado"**
- `muscles.js:258` (`loadOfWorkouts`) solo suma `entries`. Las clases (`kind: 'class'`) y los entrenos marcados traen `entries: []` con `muscleLoad`.
- Resultado: un socio que solo hace clases ve "No entrenado" en todos los músculos, mientras el mapa de Fatiga (`recovery.js:273`) sí las cuenta.
- Fix: sumar `muscleLoad` usando `CLASS_LOAD_SETS[intensity]` (la misma regla que recovery) repartido entre `muscleLoad.muscles`. Aplicar lo mismo a `latestMuscleTraining` (`Stats.jsx:29`).
- Aceptación: una clase de piernas con intensidad alta suma series a cuádriceps en Balance; Balance y Fatiga quedan coherentes.

**S-B3 · Baja · Volumen sin redondear en Fuerza**
- `Stats.jsx:214` muestra `vol90[slug]` crudo. Los pesos secundarios (0,35, 0,25…) generan "12.649999 series".
- Fix: usar el mismo redondeo que `sets()` (1 decimal).

**S-B4 · Baja · `useMemo` inútiles en MuscleBalance**
- `useNow()` (`Stats.jsx:53`) devuelve `Date.now()` en cada render, así que fatiga, fuerza y ejercicios por músculo se recalculan siempre. Con historial grande, la pantalla anda lenta.
- Fix: que `useNow` devuelva un timestamp guardado en state, actualizado cada 60 s.

**S-B5 · Baja · Textos y restos**
- `Stats.jsx:403`: "Horas promedio" y "h/sesión" hardcodeados. Pasar a `t()` y decir el período: "Duración media · últimos 30 días".
- `Stats.jsx:420`: comentario suelto `// aca targeta de ejercicios`. Borrar.
- `Stats.jsx:299`: `workouts[i].entries.find` sin `|| []`. Si llega un entreno sin `entries`, rompe. Blindar igual que en el resto del archivo.

### Mejoras

- **S-M1** Duración media: usar mediana o descartar sesiones de más de 4 h (sesión olvidada abierta). Mostrar el período.
- **S-M2** Vista Fuerza: el número al lado de la barra hoy es volumen de 90 días y la barra es fuerza. Cambiar el número a "% de fuerza", o etiquetarlo explícitamente ("12 series en 90 días").
- **S-M3** Botones `helpbtn` en Balance, Fatiga, Fuerza, Esfuerzo y 1RM (ver 0.4).

### Features

- **S-F1 · Récords personales.** Tarjeta "Tus récords": mejor peso, mejor 1RM estimado y más reps por ejercicio. Marca "Nuevo" si es de los últimos 7 días. Tocar un récord lo abre en Progreso.
- **S-F2 · Volumen semanal por grupo muscular.** Barras apiladas de las últimas 8 semanas, con la franja recomendada (10–20 series por semana para hipertrofia) marcada suave. Ayuda a ver si falta o sobra volumen.
- **S-F3 · Comparar períodos.** En las tiles, un delta contra el período anterior ("+2 vs. mes pasado").

### Tests del módulo
- MuscleBalance: tocar un ejercicio en Fuerza llama a `onExercise` con su id.
- `loadOfWorkouts` con una clase o un entreno marcado devuelve carga en sus músculos.
- Redondeo de volumen en Fuerza.

---

## Módulo 2 — Nutrición (vista del socio)

Archivos: `frontend/src/views/Nutricion.jsx`, `frontend/src/views/HistorialNutricion.jsx`, `frontend/src/components/ResumenNutricional.jsx`, `frontend/src/lib/nutricion.js`, `frontend/src/lib/calories.js`, `api/server.js` (comidas).

### Bugs

**N-B1 · Alta · Historial siempre divide por 30**
- `HistorialNutricion.jsx:68`. Un socio que registró 6 días ve un cumplimiento cercano al 20%.
- Fix: promedio sobre los días con registros. Mostrar "Promedio de 6 días con registros (de los últimos 30)".
- Aceptación: con 6 días registrados al 100% de la meta, se muestra 100%.

**N-B2 · Alta · "¿Cómo se calcula?" no coincide con el código**
- `Nutricion.jsx:67` dice +12,5% / −17,5%. El código (`nutricion.js:39` y `:111`) usa:
  - +15% para hipertrofia y +8% para fuerza.
  - −15% para bajar grasa, o −25% si la grasa corporal supera el 20%.
  - +12% extra los días de entreno.
- Fix: el texto se genera con las mismas constantes que usa el cálculo (exportarlas de `nutricion.js`), así no vuelve a divergir.

**N-B3 · Alta · Metas manuales parciales muestran 0**
- Si el admin guardó modo manual sin kcal (o sin algún macro), el anillo muestra "x / 0 kcal" y las barras "x / 0.0 g". La tarjeta de arriba, en cambio, dice "sin metas".
- Fix: en `ResumenNutricional`, una meta `null` oculta esa barra o el anillo y muestra "Sin meta". La fuente de verdad sigue siendo el bloqueo del lado admin (A-B5).

**N-B4 · Media · No se puede borrar una comida cargada offline que todavía no sincronizó**
- `Nutricion.jsx:761`: se manda `DELETE /api/comidas/offline:...`, el server responde 404 y el `throw` no se maneja. La comida sigue en caché y se crea igual al sincronizar.
- Fix: si el id empieza con `offline:`, cancelar el pedido pendiente (`cancelPendingRequest` sobre `meal-create` / `meal-group-create` con ese `tempId`) y sacarla de la caché, sin llamar a la API.
- El borrado con error de red real: toast de error, nunca un `throw` sin manejar.

**N-B5 · Media · Borrar una comida no pide confirmación**
- El × borra al toque. Fix: toast "Comida eliminada · Deshacer" (5 s) en lugar de un diálogo, que es más ágil.

**N-B6 · Media · Peso en lb tomado como kg**
- `nutricion.js:127` no convierte. Usar `LB_TO_KG` como en Stats.

**N-B7 · Media · Días de entreno sobrecontados (verificar)**
- `nutricion.js:131` usa `Object.keys(S.week)` sin filtrar `null` (`scheduledCount` en `history.js` sí filtra). Puede subir el factor de actividad a 1,55.
- Además, `resp.diasSeleccionados` de la encuesta tiene prioridad sobre el plan real y queda viejo.
- Fix: contar los días con rutina asignada del plan actual; la encuesta queda solo como fallback.

**N-B8 · Media · Desfase horario del historial**
- `server.js:2299` usa `date('now')` en UTC, pero `fecha` se guarda en hora local. Después de las 21 h la ventana se corre un día.
- Fix: el cliente manda `desde=YYYY-MM-DD` calculado en hora local.

**N-B9 · Baja · Carga manual sin botón volver**
- `Nutricion.jsx:220`: fuera del flujo de ingredientes, el formulario manual no tiene "Volver"; en PC solo se sale cerrando la hoja. Mostrar siempre el botón.

**N-B10 · Baja · Pasarse de proteína se pinta rojo**
- `ResumenNutricional.jsx:11`. Regla nueva:
  - Proteína: pasarse está bien (color de logro).
  - Calorías: rojo suave solo si se pasa más de un 10% y el objetivo es bajar grasa.
  - Carbohidratos y grasas: neutro.

**N-B11 · Baja · Historial: `localStorage.setItem` sin try**
- `HistorialNutricion.jsx:107`. Si se llena el almacenamiento y no había caché, el catch vacía la lista recién cargada.

**N-B12 · Baja · `POST /api/comidas` sin topes**
- `server.js:2224` acepta 1e9 kcal. Topes: 5000 g, 10000 kcal y 1000 g por macro, por ítem.

**N-B13 · Baja · Sugerencias offline sin `tempGroupId` (verificar)**
- `Nutricion.jsx:686` encola `meal-group-create` sin `tempGroupId`. `FoodPicker` (`:290`) sí lo manda. Verificar si la sync reconcilia la caché sin él; si no, se duplica al sincronizar. Unificar.

**N-B14 · Baja · Textos**
- Mezcla inglés/español y muchos strings sin `t()`.
- "Se recomienda quemar X kcal" confunde: es el gasto de mantenimiento, no algo a quemar. Cambiar a "Gastás aprox. X kcal por día".

### Mejoras

- **N-M1** Datos por defecto visibles. Si faltan peso, altura o edad, no mostrar "Calculado para 70 kg, 170 cm…" como si fueran reales. Mostrar un aviso: "Usamos valores estimados. Completá tu peso y altura para un cálculo preciso · [Completar]".
- **N-M2** El historial compara cada día contra su propia meta (día de entreno +12%, descanso sin bonus), no contra la meta de hoy.
- **N-M3** Spinner o esqueleto mientras carga el historial (hoy no muestra nada).
- **N-M4** La meta del día explica el ajuste: "Hoy entrenás: +12% (300 kcal)".

### Features

- **N-F1 · Cargar en otra fecha.** Navegador de fecha (‹ Hoy ›) arriba del resumen, para cargar o corregir el día anterior. Por defecto, hoy.
- **N-F2 · Repetir y favoritos.**
  - "Repetir lo de ayer" por franja (un toque).
  - Lista de "Recientes" (últimos 10 alimentos) y "Favoritos" arriba del buscador.
- **N-F3 · Editar cantidad.** Tocar una comida registrada abre la cantidad para corregirla (hoy solo se puede borrar).
- **N-F4 · Detalle del día en el historial.** Tocar un día muestra sus comidas por franja, en solo lectura, con un botón "Copiar a hoy".
- **N-F5 · Tendencia.** En el historial, gráfico de kcal promedio semanal junto a la curva de peso, para ver la relación.

### Tests del módulo
- Promedio del historial con días parciales.
- Borrado de una comida `offline:` cancela el pedido encolado.
- `calcularMetasNutricionales` con lb, con `week` que tiene `null` y sin biometría.
- `ResumenNutricional` con metas `null`.

---

## Módulo 3 — Administrar Nutrición/Rutina (ficha del socio)

Archivos: `frontend/src/views/admin/shared.jsx`, `api/server.js` (rutas admin), `api/database.js`.

### Bugs

**A-B1 · Alta · El selector de grupos cambia el plan del socio**
- `shared.jsx:571`: el `Segmented` de grupos parece un filtro de vista, pero hace PUT de `activeGroupId`. Si el profe mira otro grupo, al socio le cambia el plan.
- "Nuevo grupo" (`shared.jsx:586`) también lo activa vacío.
- Fix:
  - Separar "ver" de "activar". El selector solo cambia qué grupo se edita (estado local).
  - El grupo activo se marca con un tag "Activo".
  - Un botón explícito "Hacer activo" pide confirmación: "El socio va a ver este plan desde hoy".
  - Las rutinas de un grupo inactivo se editan dentro de `routineGroups[i].routines`, sin tocar las de nivel superior.
  - Crear un grupo no lo activa.
- Aceptación: navegar entre grupos no genera ningún PUT. Editar un grupo inactivo no cambia el plan visible del socio.

**A-B2 · Alta · Sugerencia custom sin franja**
- `shared.jsx:57` y `database.js:1450` guardan `franjas_recomendadas = null`. El server la infiere por regex del nombre (`server.js:1358`) y, si no matchea, cae en "Extra".
- Fix:
  - El editor custom pide franjas (mismos `CheckPill`, al menos 1).
  - `POST .../custom` y `PUT .../suggestions/:id` aceptan y validan `franjas`.
  - Al editar una sugerencia se pueden cambiar sus franjas.

**A-B3 · Alta · Subir/Bajar sugerencias roto**
- `shared.jsx:369` usa el índice de la lista global, pero se dibuja agrupado por franja. Intercambia con un vecino de otra franja, así que parece no hacer nada, y `disabled` queda mal.
- Hace 2 PUT en paralelo sin transacción; si uno falla, las posiciones quedan duplicadas.
- Fix: endpoint nuevo `POST /api/admin/users/:userId/nutrition/suggestions/reorder` con `{ franja, ids: [...] }`, transaccional. El orden es por franja y los botones operan sobre la lista visible de esa franja.

**A-B4 · Alta · El admin pisa el `dayPlan` del socio**
- `shared.jsx:543` y `:446` mandan el `dayPlan` cargado al abrir la hoja. Si el socio marcó "completado" o "descanso" mientras tanto, se revierte.
- Fix:
  - El PUT admin no manda `dayPlan`. El server conserva el actual y solo limpia las referencias a rutinas borradas.
  - `week` se manda solo si el admin la editó (A-F2).
  - Concurrencia optimista: el GET devuelve un `version` (`_ts`); el PUT lo envía y el server responde 409 si cambió, con el mensaje "El socio cambió su plan mientras editabas. Recargá para ver lo último."

**A-B5 · Alta · Metas manuales vacías**
- `shared.jsx:338` permite guardar modo manual con todos los campos vacíos; el socio ve 0 (ver N-B3).
- Fix: en modo manual, "Kcalorías a consumir" es obligatorio. Los macros son opcionales, pero si faltan el socio ve "Sin meta" en esa barra.

**A-B6 · Media · PUT de rutinas no transaccional**
- `server.js:2132` hace delete+insert de rutinas, semana, dayPlan y grupos sin `BEGIN`. Si falla en el medio, las rutinas del socio quedan a medias.
- Fix: envolver todo en una transacción.

**A-B7 · Media · `removeRoutine` deja `dayPlan` colgado**
- `shared.jsx:567` filtra `v !== id`, pero no limpia las entradas tipo objeto `{ estado, rutinaId }`. Se resuelve junto con A-B4: la limpieza la hace el server.

**A-B8 · Media · El editor de rutina del admin no avisa al salir**
- `shared.jsx:469`: con la X o el gesto atrás se pierden los cambios. Agregar confirmación "¿Descartar cambios?", igual que la comida compuesta.

**A-B9 · Media · Asignar a varias franjas puede duplicar**
- `shared.jsx:232` (`Promise.all`): si una franja falla, el reintento usa la lista vieja de "ya asignadas".
- Fix: un solo POST con `franjas: [...]`, transaccional, que ignora las ya asignadas.

**A-B10 · Baja · El GET de rutinas escribe**
- `shared.jsx:531`: auto-crea el grupo por defecto con solo abrir la hoja. Mover esa normalización al server (en el GET, sin persistir) o persistirla solo al primer guardado real.

**A-B11 · Baja · "Crear rutina" deja rutinas vacías**
- Crea "Nueva rutina" en el server antes de editarla; si el admin cancela, queda vacía.
- Fix: la rutina nueva vive en el borrador del editor y se persiste al guardar.

**A-B12 · Baja · `activeGroup` indefinido**
- `shared.jsx:620`: si `activeGroupId` no coincide con ningún grupo, "Renombrar grupo" rompe con `g.name`. Proteger el caso.

### Mejoras

- **A-M1** Al pasar a manual, cada campo muestra el valor automático como referencia ("Auto: 2.350") y hay un botón "Copiar valores automáticos".
- **A-M2** Coherencia de macros: debajo de los campos, "Los macros suman 2.180 kcal (meta: 2.350)". Aviso suave si la diferencia supera el 10%. Botón "Calcular macros desde kcal" (proteína por peso, 30% grasa, resto carbohidratos), con la misma lógica que el automático.
- **A-M3** El picker de plantillas tiene buscador.
- **A-M4** "Crear comida global" queda detrás de un permiso o con una advertencia: afecta el catálogo de todos los socios.
- **A-M5** Helpbtn en Metas, Limitar sugerencias y Grupos (ver 0.4).

### Features

- **A-F1 · Cumplimiento nutricional del socio (solo lectura).** Prioridad comercial número 1 para el rol Nutricionista.
  - Nueva sección "Cumplimiento" en la pestaña Nutrición: últimos 7 y 30 días, promedio de kcal y macros contra la meta, cantidad de días con registros, y lista de días tocable con el detalle de comidas.
  - Endpoint `GET /api/admin/users/:userId/nutrition/log?desde=&hasta=`, con permiso `nutrition.manage` y respetando el consentimiento de salud (409 si `declined`).
  - Auditar el acceso: es dato sensible.
- **A-F2 · Asignar días de la semana.** En la pestaña Rutina, una tira L-M-M-J-V-S-D por grupo para asignar qué rutina va cada día (`week`). Hoy el admin no puede tocar `week`.
- **A-F3 · Asignar preset o programa desde la ficha.** Botón "Asignar programa" que reusa `AssignSheet` de Rutinas, sin salir de la ficha.
- **A-F4 · Duplicar rutina y reordenar rutinas.**
- **A-F5 · Progreso del socio para el profe.** Pestaña o sección "Progreso", en solo lectura, que reusa los componentes de Stats: progreso por ejercicio, balance muscular y adherencia semanal.
- **A-F6 · Aviso push al socio.** "Tu profe actualizó tu rutina" / "Tu nutricionista actualizó tus metas", con un toque que abre la vista. Opcional por gym (Personalización → Notificaciones).
- **A-F7 · Nota del profe o nutricionista.** Texto corto que el socio ve arriba de su rutina o de sus metas ("Esta semana bajá el peso en sentadilla").

### Tests del módulo
- Cambiar de grupo en la UI no hace PUT; "Hacer activo" sí.
- Reorder por franja (endpoint + UI).
- PUT de rutinas sin `dayPlan` conserva el del socio; 409 por versión.
- Metas manuales sin kcal → 400.
- Sugerencia custom con franjas.

---

## Módulo 4 — Motor de generación de rutinas por entrevista

Archivos: `frontend/src/lib/generarRutina.js`, `frontend/src/views/SurveyWizard.jsx`, `frontend/src/components/ExerciseReplacementSheet.jsx`, `frontend/src/lib/progression.js`.

### 4.1 Hallazgo general

Se simularon 8 perfiles: principiante full body, intermedio torso/pierna, avanzado PPL de 5 días, enfoque piernas con máquinas, calistenia, lesión de rodilla y espalda baja, enfoque torso/brazos y pesos libres.

**Las rutinas resultantes no son buenas.** El motor elige ejercicios del catálogo crudo (~1.300 ejercicios, muchos raros o combinados) con un puntaje ingenuo (`jerarquiaScore`, `generarRutina.js:139`). Además fuerza que cada día use ejercicios distintos (`usadosEnSemana`, `:379`), así que del día 2 en adelante empeora la elección.

Ejemplos reales de la simulación:

| Perfil | Lo que salió | Problema |
|---|---|---|
| Principiante 3 días | Press de banca guillotina, Sentadilla a una pierna con barra, Press de banca declinado | Peligroso o inadecuado para principiantes |
| Intermedio torso/pierna | "Clean and press" como ejercicio de cuádriceps, "Sentadilla y curl con polea" como bíceps, "Tirón declinado" como 2º de pecho | Olímpico o combinado en lugar de básicos |
| Avanzado PPL | "Sentadilla remo (cuerda) con polea" como dorsales, "Plancha lateral con posterior fly" como espalda alta, Remo al mentón | Ejercicios raros y de riesgo para el hombro |
| Calistenia | **"Gancho izquierdo de boxeo"** como ejercicio de hombros (los 3 días) | Absurdo |
| Lesión de rodilla | "Tabla de equilibrio" como cuádriceps, cinta a 8 km/h (trote) 30 min | Elección sin sentido; impacto con rodilla lesionada |
| Enfoque torso/brazos | Ningún ejercicio de bíceps, tríceps ni hombros | El enfoque elimina justo lo que promete |
| Todos | Ningún jalón al pecho (lat pulldown); primer tirón "Dominadas arquero" | Falta el básico; el elegido es avanzado |
| Todos | 3×8 para todos los objetivos y niveles | Sin personalización real del volumen |

Conclusión: no alcanza con parchar el puntaje. Se propone rediseñar la selección (4.4), además de corregir los bugs puntuales.

### 4.2 Bugs

**R-B1 · Alta · Estiramientos mal elegidos** (lo que sospechabas)
- `ESTIRAMIENTOS_POR_GRUPO` (`generarRutina.js:458`) tiene IDs que no son estiramientos:
  - `0016` "Curl femoral prono asistido" (un ejercicio de fuerza).
  - `0018` "Extensión de tríceps asistida con toalla" (fuerza).
  - `1368` "Círculos de tobillo" (movilidad, no estiramiento de gemelo).
- Casi todos los demás son **asistidos (requieren compañero)** o con fitball: `1708`, `1709`, `1710`, `1712`, `1713`, `1714`, `1716`. No se pueden hacer solos en el gym.
- No coinciden con lo entrenado:
  - Se calculan sobre los grupos *planeados* (`targetGroups`), no sobre los ejercicios realmente elegidos (que cambian por sustitución).
  - Se toman en orden de ID del catálogo y se corta en 4, así que el orden del catálogo decide. Un día de pierna con isquios entrenados no estira isquios. Un día de tirón da 3 estiramientos con fitball.
  - Dorsales, espalda alta y bíceps comparten un único estiramiento (`1405`). Tríceps recibe un ejercicio de fuerza. Abdominales, trapecio, antebrazo, aductores y abductores no tienen ninguno.
  - Full body en calistenia: solo estiramientos de pierna, aunque se entrenó el tren superior.
- No respetan lesiones ni equipamiento (usan `dbCompleta`, `:602`).
- Fix: ver 4.4.4 (mapa curado de estiramientos derivado de lo entrenado).

**R-B2 · Alta · El cupo de músculos se pasa y se cortan grupos**
- `calcularDistribucionMuscular` (`:287`) redondea cada cuota con `Math.round` y la suma supera los slots; `slice(0, nSlots)` (`:323`) corta los últimos grupos. Con 5 slots:
  - Push: 3 + 2 + 1 = 6, se cae **tríceps**.
  - Legs/Pierna: 2 + 2 + 1 + 1 = 6, se caen **gemelos**.
  - Torso: 2 + 2 + 1 + 1 + 1 = 7, se caen **bíceps y tríceps**.
- Con enfoque `torso_brazos` (×1,3) es peor: torso queda solo con pecho y espalda.
- Fix: reparto por plantilla de slots (4.4.1), no por porcentajes redondeados.

**R-B3 · Alta · Reemplazar cardio o estiramiento no ofrece nada**
- `ExerciseReplacementSheet.jsx:116-200` busca alternativas de cardio y estiramientos dentro de `poolSeguro`, pero `prepararPoolSeguro` (`generarRutina.js:196`) excluye justamente cardio y estiramientos. La lista sale vacía.
- Fix: pools separados (`poolCardio`, `poolEstiramientos`) devueltos por el generador.

**R-B4 · Alta · El rango de reps se pierde y la progresión doble queda mal**
- El generador guarda `reps` = límite inferior (8 de 8–12; 3 de 3–6) (`:583`) y descarta el rango.
- La progresión doble (`progression.js:221`) toma `cfg.reps` como **techo** y `repsMin` como piso. Resultado: rango 6–8 en vez de 8–12, y 1–3 para fuerza.
- Fix: con política `double`, `reps` = techo y `repsMin` = piso. Con `linear`, `reps` = objetivo. Para ejercicios de peso corporal, setear también `repsMax` (`progression.js:207`); si no, sube +1 rep para siempre.
- El paso 6 de la encuesta muestra "3 series × 8 reps" (`SurveyWizard.jsx:705`); debe mostrar el rango "3 × 8–12".

**R-B5 · Alta · El enfoque "Piernas y glúteos" pisa el split en silencio**
- `derivarSplit` (`:52`) devuelve `pierna_prioridad` aunque el socio eligió PPL o Torso/Pierna, sin ningún aviso.
- Además, la encuesta ofrece "Piernas y Glúteos" dos veces: como split y como enfoque. Confunde.
- Fix: dejar una sola pregunta. "Piernas y glúteos" es un enfoque que ajusta el volumen dentro del split elegido; si se mantiene como split, no aparece como enfoque. Si se cambia el split del socio, se avisa.

**R-B6 · Media · La cantidad de ejercicios no coincide con lo prometido**
- La encuesta dice "30–40 min: 4 ejercicios", "40–60: 5"… (`SurveyWizard.jsx:45`). `calcularCantidadEjercicios` (`:224`) calcula según el descanso:
  - 30–40 min con 90–120 s de descanso da **3**.
  - Con 180 s de descanso, 40–60 min da **3**.
- `SERIES_POR_TIEMPO` y `SLOTS_POR_TIEMPO` no se usan (código muerto); `nSeries` siempre es 3 (`:556`).
- Fix: una sola fuente de verdad. El texto de la opción se calcula con la misma función, y cambia en vivo al elegir el descanso.

**R-B7 · Media · El cardio ignora lesiones y el día**
- `seleccionarCardio` (`:405`) no mira lesiones: con rodillas o tobillos da cinta a 8 km/h o escaladora HIIT.
- Se agrega todos los días, incluido HIIT después del día de pierna.
- "Caminar/correr" usa 8 km/h (trote), pero la opción dice "caminata rápida o trote". "Suave" dice 15–20 min y guarda 20.
- Fix: reglas en 4.4.5.

**R-B8 · Media · "Perder grasa" promete más cardio y no lo da**
- `SurveyWizard.jsx:36` dice "Misma base + más cardio", pero el generador solo cambia las reps a 8–15.
- Fix: con perder grasa, el cardio por defecto es "suave al final" (editable), y el texto lo explica.

**R-B9 · Media · 5 días PPL deja piernas 1 vez por semana**
- `defaultSplitRecomendado` (`:29`) recomienda PPL con 5 días: Push, Pull, Legs, Push 2, Pull 2.
- Fix: con 5 días, recomendar "Torso/Pierna + PPL" (T, P, Push, Pull, Legs), o PPL + Full body. Con 6 días, PPL ×2.

**R-B10 · Media · Full body sin glúteos ni espalda alta; abdominales de relleno**
- Las cuotas de full body (`:306`) no tienen glúteos ni remo, y los slots sobrantes van todos a abdominales: con 7 slots salen 2 de abdominales, con barra y raros ("Abdominal con press de barra", "Lateral flexionado v.2").

**R-B11 · Media · Avisos y textos generados que nadie muestra**
- `parametrosGlobales`, `disclaimer` y `mensajeAjuste` no se muestran en ningún lado. Solo `avisoFrecuencia` sale como toast.
- `parametrosGlobales.tipoProgresion` compara con `'lineal'` / `'ondulante'`, pero la encuesta manda `'linear'` / `'dup'`: siempre dice "Doble progresión".
- Fix: mostrarlos en el resumen del paso 6 (R-F1), con los valores correctos.

**R-B12 · Media · Días seguidos sin aviso**
- Full body en lunes, martes y miércoles entrena los mismos músculos 3 días seguidos, sin aviso ni reordenamiento.
- Fix: aviso en el paso 2 ("Con Full Body conviene dejar un día de descanso entre sesiones"), o asignar el tipo de día según la separación (torso/pierna alternados).

**R-B13 · Baja · El nivel solo cambia el split**
- `nivel` no cambia volumen, series ni complejidad de ejercicios. Se resuelve en 4.4.

**R-B14 · Baja · Elegir sexo en el paso 1 escribe el perfil antes de terminar**
- `SurveyWizard.jsx:464` hace `update()` de `genero` y `body` al tocar la opción. Si el socio cancela la encuesta, queda cambiado. Mover al guardado final.

**R-B15 · Baja · Aviso de 2 días Torso/Pierna incorrecto**
- Con 2 días, Torso/Pierna da 1 vez por semana cada mitad, pero el aviso habla de "desbalance". Corregir el texto o recomendar full body con otra razón ("2 estímulos por semana en lugar de 1").

### 4.3 Mejoras

- **R-M1** Mismos ejercicios principales en toda la semana. En full body, rotación A/B (A y B alternados) con los mismos básicos, para poder progresar en carga. La variedad va en los accesorios.
- **R-M2** Orden dentro de la sesión: compuestos primero y aislamiento después, sin importar el orden de las cuotas.
- **R-M3** Calentamiento:
  - `warmupSets: 2` en el primer compuesto de cada sesión y `1` en el segundo (el modelo ya lo soporta, `history.js` `buildSets`).
  - Nota "5 min de entrada en calor general (bici o cinta suave)" al principio.
- **R-M4** Peso inicial guiado: la primera vez, nota "Elegí un peso con el que llegues a las reps dejando 2 en reserva" en lugar de 0 kg sin explicación.
- **R-M5** Lesiones más finas: con hombro lesionado, permitir press con mancuernas en agarre neutro o máquina, y excluir press tras nuca, remo al mentón y fondos. El disclaimer se muestra siempre que haya lesiones.

### 4.4 Rediseño propuesto de la selección

#### 4.4.1 Plantillas de sesión por slots de patrón

Cada tipo de día es una lista ordenada de slots: patrón de movimiento, músculo principal y prioridad. La cantidad de slots según el tiempo toma los de mayor prioridad, pero siempre en el orden de la plantilla.

| Día | Slots (en orden) |
|---|---|
| Full body A | Sentadilla o prensa · Empuje horizontal · Tirón vertical · Bisagra de cadera · Empuje vertical · Remo · Core |
| Full body B | Bisagra de cadera · Empuje inclinado · Remo · Zancada o unilateral · Elevaciones laterales · Jalón · Core |
| Push | Press horizontal · Press inclinado · Press vertical · Elevaciones laterales · Tríceps (polea) · Tríceps sobre la cabeza |
| Pull | Jalón o dominada · Remo · Remo pecho apoyado o con polea · Face pull / deltoide posterior · Bíceps · Martillo |
| Legs / Pierna | Sentadilla o prensa · Bisagra (peso muerto rumano) · Unilateral · Curl femoral · Extensión de cuádriceps · Gemelos |
| Torso | Press horizontal · Remo · Press vertical · Jalón · Bíceps · Tríceps |
| Pierna – cuádriceps | Sentadilla o hack · Prensa · Zancada · Extensión · Gemelos |
| Pierna – isquios/glúteo | Peso muerto rumano · Hip thrust · Curl femoral · Abducción · Gemelos |

- El enfoque suma un slot extra del grupo priorizado; nunca quita grupos.
- Con 30–40 min se recortan slots de baja prioridad, pero nunca un grupo grande completo.

#### 4.4.2 Catálogo base curado

- Nueva constante `CATALOGO_BASE`: por cada patrón, una lista ordenada de ejercicios (IDs del catálogo).
- Cada ejercicio declara su equipamiento y el nivel mínimo (`principiante` / `intermedio` / `avanzado`).
- El generador elige solo de esa lista. El catálogo completo queda para "Reemplazar → Ver más" y la búsqueda.
- Lista negra explícita para el generador: olímpicos (clean, snatch, jerk), combinados (sentadilla + curl, sentadilla + remo), guillotina, tras nuca, remo al mentón, boxeo, tabla de equilibrio y variantes con fitball, bosu o rodillo.
- Ejemplo principiante: jalón al pecho antes que dominadas; prensa o goblet antes que sentadilla frontal; press con mancuernas o máquina antes que con barra.
- Test: todo ID del catálogo existe en `EXDB` y tiene nombre en español.

#### 4.4.3 Volumen y reps según objetivo y nivel

| Objetivo | Reps compuestos | Reps aislamiento | Series por ejercicio |
|---|---|---|---|
| Hipertrofia | 6–10 | 10–15 | Principiante 2–3 · Intermedio 3 · Avanzado 3–4 |
| Fuerza | 3–6 | 8–12 | 3–5 en compuestos |
| Perder grasa | 8–12 | 12–15 | 2–3 |
| Fitness general | 8–12 | 10–15 | 2–3 |

- Objetivo semanal orientativo por músculo grande: principiante 6–10 series, intermedio 10–16, avanzado 12–20.
- El generador valida el total y avisa si queda fuera ("Con 2 días y 30 min, el volumen semanal queda bajo; considerá sumar un día").
- Descanso: compuestos según lo elegido; aislamiento 60–90 s.

#### 4.4.4 Estiramientos derivados de lo entrenado

1. Tomar los músculos principales de los ejercicios **realmente elegidos** del día (`tg` y, con más peso, el `mg` / secundarios), ordenados por series hechas.
2. Elegir **1 estiramiento por músculo**, hasta 4–5, priorizando los más trabajados.
3. Usar solo estiramientos sin asistencia y sin elementos raros, respetando lesiones (no estirar la zona lesionada salvo indicación) y equipamiento.
4. 30–45 s por lado. Nota "Por lado" en los unilaterales.

Mapa curado inicial (IDs verificados en el catálogo, todos de peso corporal):

| Músculo | Estiramiento |
|---|---|
| Pecho / hombro anterior | `1271` Estiramiento de pecho y frente del hombro |
| Dorsales | `1346` Estiramiento de dorsal arrodillado · `1405` Pectoral y espalda |
| Espalda alta / trapecio | `1365` Estiramiento de espalda alta |
| Deltoide posterior | `0669` Estiramiento de deltoide posterior |
| Tríceps | `0643` Estiramiento de tríceps sobre la cabeza · `0817` |
| Bíceps | **No hay en el catálogo**: usar `1271` (estira bíceps y hombro anterior) o crear uno propio |
| Antebrazo / muñeca | `0721` Estiramiento lateral de muñeca |
| Cuádriceps | `0613` Cuádriceps de lado · `1512` Cuádriceps en cuadrupedia |
| Isquiotibiales | `1511` Estiramiento de isquios · `1585` Estiramiento del corredor |
| Glúteos | `1424` Glúteo sentado · `2567` Piriforme sentado |
| Gemelos | `1377` Gemelo contra la pared · `1398` Gemelo de pie |
| Columna / lumbar | `1363` Estiramiento de columna |
| General de cadera | `1604` "El mejor estiramiento del mundo" |

- Faltan en el catálogo estiramientos de bíceps, aductores (sin asistencia), flexores de cadera (sin soga) y abdominales: evaluar agregarlos como ejercicios propios del sistema.
- Aceptación: en cada día generado, todo músculo principal con 3 o más series tiene su estiramiento, y ninguno es `assisted`, de fitball ni de fuerza.

#### 4.4.5 Reglas de cardio

| Situación | Regla |
|---|---|
| Lesión de rodilla o tobillo | Bici o elíptico, nunca cinta en trote ni HIIT con saltos |
| Día de pierna | Nada de HIIT: cardio suave o ninguno |
| HIIT | Máximo 2 por semana, en días de tren superior o descanso |
| Perder grasa | Por defecto, "Suave al final" 20 min |
| Textos | Velocidades coherentes con el nombre: caminata rápida 5,5–6,5 km/h, trote 7,5–9 km/h, siempre explicadas |

### 4.5 Features de la encuesta

- **R-F1 · Resumen del plan en el paso 6.** Antes de la lista de ejercicios, una tarjeta con:
  - Split, días y tipo de día por fecha (L: Torso A, M: Pierna A…).
  - Duración estimada por sesión.
  - Series semanales por músculo, en barras simples.
  - Progresión, esfuerzo (RIR/RPE) y descanso, con su explicación.
  - Avisos (lesiones, frecuencia, volumen).
- **R-F2 · "¿Por qué este ejercicio?"** Al tocar un ejercicio del paso 6, una línea explicativa: "Básico de empuje horizontal · trabaja pecho, hombro anterior y tríceps".
- **R-F3 · Regenerar con un toque.** Botón "Generar otra variante" que mantiene las respuestas y cambia los accesorios, no los básicos.
- **R-F4 · Pasos explicados.** Cada pregunta con una línea "Por qué te lo preguntamos" (0.4). Barra de progreso (Paso 2 de 5) y guardado del avance si se sale.
- **R-F5 · Encuesta para el staff.** El admin genera una rutina para un socio con la misma encuesta desde la ficha (se integra con A-F3).

### 4.6 Herramienta de calidad (obligatoria antes de mergear)

- Script `scripts/sim-rutinas.mjs` que genera una matriz de perfiles (nivel × días × tiempo × equipamiento × enfoque × lesiones) e imprime las rutinas en texto legible, igual que la simulación de esta auditoría. Sirve para revisión humana.
- Tests de propiedades sobre la misma matriz:
  - Ningún ejercicio de la lista negra.
  - Push y Torso con tríceps; Pull y Torso con bíceps, cuando hay 5 o más slots.
  - Día de pierna con gemelos cuando hay 6 o más slots.
  - Compuestos antes que aislamiento.
  - Mismos básicos en sesiones del mismo tipo.
  - Estiramientos que cubren lo entrenado y sin `assisted`.
  - Cardio que respeta lesiones y día de pierna.
  - Rango de reps y `repsMin` coherentes con la progresión.
  - Cantidad de ejercicios igual al texto mostrado en la encuesta.
  - Principiante sin ejercicios de nivel avanzado.

---

## Orden de trabajo propuesto

Un módulo a la vez, cada uno en su branch:

| # | Módulo | Branch | Por qué en este orden |
|---|---|---|---|
| 1 | Motor de rutinas (4) | `feat/motor-rutinas-v6` | Es lo primero que ve un socio nuevo y lo que se muestra en la demo a un gym; hoy da rutinas raras |
| 2 | Administrar Nutrición/Rutina (3) | `fix/admin-nutricion-rutina` | Bugs altos que cambian el plan del socio sin querer, más A-F1 (argumento de venta a nutricionistas) |
| 3 | Nutrición del socio (2) | `fix/nutricion-socio` | Cálculos y textos incorrectos que dañan la confianza |
| 4 | Stats (1) | `fix/stats` | Bugs acotados; features de valor medio |

Dentro de cada módulo: primero bugs Altos, después Medios, después mejoras y features. Los Bajos van juntos al final.

Por módulo:

1. Mockups HTML A/B (con PC) de las vistas nuevas o rediseñadas.
2. Plan de implementación.
3. Tests.
4. Prueba en dev (`dev.lauyim.online`).
5. Merge a `main` solo cuando se pida.

## Decisiones abiertas

1. ¿El orden de módulos de arriba está bien, o se arranca por Stats como en la auditoría original?
2. ¿"Piernas y glúteos" queda como split, como enfoque, o los dos con una sola pregunta (R-B5)?
3. ¿Se agregan ejercicios propios del sistema para cubrir los estiramientos faltantes (bíceps, aductores, flexores de cadera)?
4. ¿A-F6 (push al socio cuando el staff cambia algo) se prende por defecto o queda opcional?
5. ¿A-F1 se audita en el log del gym cada vez que el staff ve las comidas de un socio?
