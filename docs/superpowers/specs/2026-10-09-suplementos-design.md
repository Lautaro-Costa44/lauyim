# Suplementos: guía basada en evidencia y seguimiento

Fecha: 2026-10-09 · Rama: `feat/suplementos` · Dos etapas (esta spec cubre las dos; la etapa 1 se implementa primero y se puede mergear sola).

## Por qué

Los socios toman suplementos (creatina, proteína, pre-entrenos, mate antes de entrenar) y se informan por redes y por el vendedor. La app ya tiene Nutrición con meta de proteína (`calcularMetaProteina`, `frontend/src/lib/nutricion.js`). Falta:

1. Una **guía práctica y honesta**: qué funciona según la ciencia, cuánto, cómo prepararlo (agua, scoops) y qué no conviene.
2. Un **seguimiento** simple de lo que toma cada uno, con racha propia y recordatorio.

Todo sin convertirse en consejo médico: información general con fuentes, nada de marcas y un aviso legal claro.

## Base científica

Cada afirmación de las fichas sale de una de estas fuentes, en este orden de prioridad:

| Uso | Fuente |
|---|---|
| Qué funciona y qué no (clasificación) | **IOC Consensus Statement: Dietary Supplements and the High-Performance Athlete** (Maughan et al., *Br J Sports Med* 2018) |
| Etiqueta de nivel de evidencia | **AIS Sports Supplement Framework** (grupos A/B/C/D), versión vigente al escribir el contenido |
| Protocolos (dosis, momento) | **Posturas de la ISSN**: creatina (Kreider et al. 2017), cafeína (Guest et al. 2021), proteína (Jäger et al. 2017), beta-alanina (Trexler et al. 2015) |
| Seguridad, interacciones, quién no debe | **NIH Office of Dietary Supplements** (fichas para profesionales) y **EFSA** (cafeína: tomas de hasta 200 mg y hasta 400 mg/día en adultos sanos; 200 mg/día en embarazo; Scientific Opinion 2015) |
| Hidratación | **EFSA** (ingesta adecuada de agua total: 2,0 L/día mujeres, 2,5 L/día hombres, 2010) |
| Cafeína y sueño | Drake et al., *J Clin Sleep Med* 2013 (400 mg hasta 6 h antes de dormir alteran el sueño) |
| Cafeína e hidratación | Maughan & Griffin, *J Hum Nutr Diet* 2003; Killer et al., *PLoS One* 2014 (en dosis habituales la cafeína no deshidrata) |
| Regulación local | **ANMAT / Código Alimentario Argentino, art. 1381** (suplementos dietarios = alimentos) |

Regla de uso: la ISSN se usa solo para protocolos, nunca para decidir si algo "funciona" (tiene vínculos con la industria). Cada ficha lista sus fuentes y una fecha de revisión. **Toda cifra se verifica contra el documento original al escribir el contenido** (tarea propia del plan). Donde la evidencia es variable (cafeína del mate), se muestra como rango y con la etiqueta "estimado".

No hay profesional que revise el contenido: la app dice explícitamente en qué instituciones se basa ("Basado en IOC, AIS, ISSN, NIH y EFSA"), y el abogado revisa el aviso, la privacidad y los términos antes de producción.

## Catálogo

Niveles, con color propio en la guía:

| Nivel (UI) | Equivale a | Suplementos | Seguimiento |
|---|---|---|---|
| **Funciona** | AIS A (rendimiento y alimentos deportivos) | Creatina, cafeína, beta-alanina, proteína en polvo, electrolitos | Sí |
| **Funciona en situaciones puntuales** (solo guía) | AIS A con uso muy específico | Bicarbonato de sodio, nitrato (jugo de remolacha) | No |
| **Evidencia en desarrollo** | AIS B | Colágeno | Sí, con aviso permanente "evidencia en desarrollo" |
| **Con indicación profesional** | AIS A, suplementos médicos | Vitamina D, hierro, omega-3, magnesio, multivitamínico | Sí, **sin dosis sugerida**: el socio carga la que le indicaron |
| **No recomendado** | AIS C/D o sin evidencia útil para gym | Quemadores de grasa, BCAA, glutamina, "boosters" de testosterona, prohormonas y SARMs | No. La ficha explica por qué |
| **Propio** | — | Cualquier otro: nombre, dosis, unidad | Sí, sin consejos |

Notas por suplemento (contenido a verificar contra fuente en la tarea de contenido):

- **Creatina monohidrato**: la app sugiere **3–5 g/día**, todos los días (incluidos los de descanso). La fase de carga (≈20 g/día en 4 tomas, 5–7 días) **solo se explica en la guía**, y aclara que es **para cuando recién empezás** (o retomás después de semanas sin tomarla) y que es opcional (a las 3–4 semanas el resultado es el mismo). Al agregar creatina por primera vez, el formulario de alta muestra arriba un cartel: "¿Recién empezás? Mirá la fase de carga en la guía" (enlace a la sección).
- **Cafeína**: rango calculado con el peso, **3–6 mg/kg**, con techo de **400 mg/día** en total. Consejo: empezar por lo bajo; tomas de más de 200 mg superan la referencia de EFSA para una sola toma. Momento: 30–60 min antes. No dentro de las 6 h previas a dormir. Fuentes de cafeína del día (ver "Cafeína del día").
- **Beta-alanina**: dosis diaria y tamaño máximo de toma según ISSN 2015 (a verificar), varias tomas por día con comida, mínimo 4 semanas para notar efecto; el hormigueo (parestesia) es esperable e inofensivo.
- **Proteína en polvo**: no tiene dosis propia; la meta es la de Nutrición. Registrar una toma la carga como comida (ver "Proteína").
- **Electrolitos**: útiles en sesiones largas (>60–90 min), con calor o mucho sudor; para una hora de pesas con hidratación normal no hacen falta. Seguimiento opcional, sugerido "solo días de entreno".
- **Colágeno**: evidencia en desarrollo (tendones y articulaciones). Protocolo de los estudios (≈10–15 g con vitamina C, 30–60 min antes de la actividad; a verificar). Aviso permanente "evidencia en desarrollo".
- **Mate** (no es suplemento, pero entra en la cafeína): ver "Cafeína del día".

## Guía (contenido)

Hoja completa con, arriba de todo, un **consejo de agua**:

> 💧 Recordá tomar agua: alrededor de **2 L (mujeres) a 2,5 L (hombres)** por día entre bebidas y comidas, más lo que transpirás entrenando. (EFSA)

Se elige el valor según `S.genero`; si no hay dato, se muestran los dos.

Después, la lista por nivel, con color por nivel y "✓ la tomás" en los suplementos activos del socio. Cada **ficha** es **una sola página con scroll** (sin pestañas), con lo práctico primero y las precauciones siempre a la vista. Arriba: nombre, etiqueta de nivel ("FUNCIONA · AIS A") y una frase de qué es y qué logra. Después, siempre en este orden:

1. **Cómo tomarlo**, práctico y concreto (incluye el recuadro de fase de carga en la creatina):
   - Dosis (rango general; con el peso en cafeína; "la que te indicaron" en los de indicación profesional).
   - **Scoops**: "Fijate en la etiqueta cuántos gramos trae tu scoop" + equivalencia aproximada sin scoop (ej. creatina: 1 cucharadita de té al ras ≈ 3–5 g; aproximado, mejor scoop o balanza).
   - **Con qué**: cantidad de líquido y alternativas (agua, jugo, leche, yogur, batido, mezclado en una comida), según el suplemento. Ej. creatina: 1 scoop en 200–300 ml; disolver en el momento (disuelta por días se degrada); tibio se disuelve mejor.
   - **Cuándo**: momento del día o respecto del entreno.
   - **Si te olvidaste**: qué hacer (creatina: seguí al día siguiente, no dupliques).
2. **Qué dice la evidencia**: nivel + una frase honesta ("mejora fuerza y masa muscular en entrenamiento de fuerza").
3. **Para quién sirve / para quién no hace falta.**
4. **Qué podés notar** (efectos esperables: creatina +1–2 kg de agua intramuscular las primeras semanas; beta-alanina hormigueo).
5. **Precauciones y quién no debería tomarlo** (embarazo, lactancia, riñón, presión, medicación, menores), propias de cada suplemento.
6. **Comprar con criterio**: sin marcas; buscar sello de control de terceros (Informed Sport / NSF Certified for Sport) y registro ANMAT.
7. **Fuentes** y fecha de revisión.

En PC/tablet la guía es un panel centrado con la lista a la izquierda y la ficha a la derecha (la ficha reparte sus secciones en dos columnas).

Botón **"Agregar a mis suplementos"** en las fichas con seguimiento.

Los de "No recomendado" tienen: qué prometen, qué muestra la evidencia, riesgos (estimulantes ocultos, contaminación, sustancias prohibidas) y "en qué gastar en cambio".

Tono: voseo argentino como el resto de la app, frases cortas, amigable. Contenido solo en español (no pasa por `t()`; los textos de interfaz sí).

## Vista en Nutrición

Nueva tarjeta **"Suplementos"** entre **Peso corporal** y **Resumen nutricional de hoy** (`frontend/src/views/Nutricion.jsx`, entre las tarjetas `nutrition-weight` y `nutrition-summary`).

- **Sin suplementos**: estado vacío con llamado a la guía ("¿Tomás suplementos? Mirá qué dice la ciencia") y un acceso "Guía".
- **Con suplementos** (lista por momento del día, elegida en maquetas): "Hoy" con una fila por suplemento activo que toca hoy, agrupadas por momento (mañana / antes de entrenar / después de entrenar / con las comidas / noche / cualquier momento).
  - Cada fila: nombre, etiqueta "indicación" si corresponde, dosis en la unidad del usuario ("1 scoop · 5 g"), racha (🔥 12) y un botón por toma (una toma = un check; varias = varios puntos).
  - Progreso del día "2 de 3" y botón **Marcar todos**.
  - Sección "Cafeína del día": total contra el techo ("180 de 400 mg · estimado") con barra y los botones rápidos (ver "Cafeína del día"). La barra pasa a rojo al superar el techo, con el aviso de exceso.
  - Accesos: **Guía**, **Mis suplementos** (configurar), **＋ Agregar**.
- **Aviso sin aceptar**: la tarjeta muestra solo "🔒 Para ver la guía y registrar suplementos, leé y aceptá el aviso" y el botón **Leer el aviso**. El resto de Nutrición funciona normal.
- **PC/tablet**: la tarjeta ocupa el mismo lugar y reparte en dos columnas (momentos a la izquierda, cafeína a la derecha); la guía y el alta abren como panel centrado (`kind: 'panel'`): la guía con lista + ficha, el alta en dos columnas.

Toda la vista (tarjeta, guía, seguimiento) existe solo si el socio dio el consentimiento de salud: sin consentimiento, Nutrición ya no se muestra (`App.jsx`, ruta `/nutricion`), y por lo tanto tampoco esto. Se mantiene así.

## Alta y configuración de un suplemento

**Un solo formulario** (elegido en maquetas) con todo precargado; la mayoría solo revisa el scoop y toca "Agregar". Siempre de a uno: desde la ficha ("Agregar a mis suplementos") o desde "＋" (abre la guía para elegir, con "Otro suplemento" al final). Varios a la vez se manejan como una lista de suplementos activos, cada uno con su configuración; la tarjeta los junta.

Configuración por suplemento:

| Campo | Detalle |
|---|---|
| Dosis | Número + unidad (g, mg, ml, cápsulas, UI). Precargada con el valor sugerido de la ficha (creatina 5 g, cafeína el piso del rango con el peso); editable dentro del rango, con aviso si sale del rango |
| **Mi scoop** | "1 scoop de mi marca = X g". Un campo grande y simple, con el texto "Mirá la etiqueta". Opcional; si está, la tarjeta muestra "1 scoop · 5 g" |
| Tomas por día | 1 a 6. Beta-alanina sugiere varias |
| Momento | mañana / antes de entrenar / después de entrenar / con las comidas / noche / cualquier momento |
| Días | todos los días / solo días de entreno. "Día de entreno" = el plan semanal le asigna rutina (`effectiveRoutineId`) **o** ese día hay un workout registrado (sirve para quien no tiene plan) |
| Recordatorio | apagado / hora (HH:MM) |

Acciones: **Dejar de tomar** (archiva; conserva el historial y la racha pasada) y **Eliminar** (borra configuración e historial, con confirmación).

## Seguimiento

- Se marca **hoy y hasta 7 días atrás**, nunca el futuro (desde el historial del suplemento).
- **Racha propia** por suplemento: días seguidos cumplidos entre los días que le tocaban (un "solo días de entreno" no corta la racha los días sin entreno). No suma a la racha de entrenamiento de la app.
- **Cumplimiento 30 días** por suplemento (%).
- **Heatmap tipo GitHub** por suplemento (y uno combinado en "Mis suplementos"), reutilizando el de Stats (`components/Heatmap.jsx`). Intensidad:
  - 0: no tocaba / sin registro
  - 1: registró algo pero menos de la mitad de las tomas
  - 2: la mitad o más
  - 3: cumplió todas las tomas
  - 4: cumplió y además el suplemento está en racha ≥ 7 días (refuerzo visual)
  Para esto `Heatmap.jsx` se separa en una grilla genérica (`HeatmapGrid`: días → nivel y título) y el uso actual de Stats, sin cambiar lo que Stats muestra.
- **Pasarse de la dosis**: si lo marcado en el día supera el máximo de la ficha (ej. cafeína > 400 mg), aviso amigable en la tarjeta ("Hoy vas 450 mg de cafeína: más de lo recomendado para un día"). El registro se guarda igual (es lo que pasó).

### Cafeína del día

Total de cafeína = suplementos de cafeína y pre-entrenos + **fuentes rápidas**. Se toma varias veces por día, así que **cada toque suma un consumo** (el botón muestra "×3"). Debajo de los botones: **"↶ Eliminar último consumo"** (dice cuál borra) y la lista "Consumos de hoy" con hora, mg y **Eliminar** en cada uno.

| Botón | mg (estimado, a verificar contra fuente) |
|---|---|
| Café (taza) | ≈ 80–100 mg |
| Espresso | ≈ 60–80 mg |
| Mate (**½ termo** por toque, ≈ 500 ml de agua) | rango variable según yerba y cebadas; mostrado como "estimado". Un termo entero = dos toques |
| Energizante (lata) | ≈ 80 mg (250 ml) / ≈ 160 mg (500 ml) |
| Pre-entreno | mg por scoop configurables (de la etiqueta) |
| Otro | mg a mano |

**Consejos del mate**, amigables y con fuente:
- El mate cuenta como líquido: en las cantidades habituales la cafeína no deshidrata.
- Tomar mate antes o durante el entreno está bien; si además usás pre-entreno, sumá la cafeína de los dos.
- La cafeína del mate varía mucho (cantidad de yerba, cebadas): por eso el número es estimado. El valor por ½ termo se fija en la tarea de verificación de fuentes (los estudios miden mg por gramo de yerba; se convierte con una cantidad típica de yerba por termo y se documenta la cuenta).
- Evitá cafeína (mate incluido) en las 6 h previas a dormir si te cuesta dormir.
- Si le ponés azúcar, suma calorías (lo cargás en Nutrición si querés).

### Proteína

Registrar una toma de proteína **la carga como comida** en Nutrición (`POST /api/comidas`, franja según la hora), así suma a macros y a la meta de proteína. Los valores por scoop vienen del catálogo (whey ≈ 30 g de polvo, ≈ 20–25 g de proteína) y se editan **desde la etiqueta** en la configuración del suplemento ("por scoop: proteína, calorías, carbos, grasas"), con el mismo campo "Mi scoop". Desmarcar la toma borra esa comida.

## Recordatorios (push)

- Por suplemento, a la hora configurada, en la zona horaria del socio (la de `reminder_settings.tz`).
- Solo si ese día le toca y **todavía no lo marcó**. Un aviso por suplemento y día.
- Si el socio no tiene notificaciones activas, al prender un recordatorio se usa el pedido en contexto de la mejora de notificaciones (`frontend/src/lib/notif-ask.js`, `askInContext`).
- Texto: "Creatina: te falta la de hoy (5 g)". Toca → abre Nutrición.

## Primer uso: aviso legal y chequeos

Al abrir la guía o agregar el primer suplemento, una hoja **sin "Ahora no"**: el único botón es **"Leí y acepto"** (sin textos aclaratorios debajo). Sin aceptar no se guarda nada y la próxima vez vuelve a aparecer (también si salió de la app en esa vista). El gesto atrás del sistema puede cerrar la hoja (no se traba al usuario), pero nada de suplementos se abre hasta aceptar. Contenido:

1. **Aviso** (una vez por versión del texto):
   > Esta guía es información general basada en IOC, AIS, ISSN, NIH y EFSA. No es consejo médico ni reemplaza a un profesional de la salud. Si tenés una condición de salud o tomás medicación, consultá antes de usar suplementos.
2. **Lista de chequeo (no se guarda)**: "Si te aplica alguna, consultá a un profesional antes: embarazo o lactancia · enfermedad renal o hepática · presión alta o problemas cardíacos · medicación crónica · trastornos de ansiedad o del sueño (cafeína)". Debajo: "No guardamos cuál te aplica: solo que leíste esto." Solo se guarda la aceptación y la versión.
3. **Edad**: si `S.edad` existe y es < 18, o si no existe y el socio responde "No" a "¿Tenés 18 años o más?" (se pregunta una vez y se guarda solo la respuesta): ve la guía con el aviso "No recomendado para menores de 18 sin supervisión profesional", **sin dosis ni seguimiento**.

## Interruptor del gimnasio

El owner lo maneja en Admin (junto a los otros ajustes del owner), en `admin_settings` con la clave `supplements_enabled`, **encendido por defecto**. Apagado: la tarjeta, la guía y los recordatorios desaparecen para todos; los datos no se borran. Se expone al socio en la config pública, igual que `nutricion_automatico`.

## Datos (servidor)

`user_state` tiene columnas fijas (`api/database.js`, `saveUserState`): un campo nuevo en `S` no se guardaría. Además el `scheduler` necesita leer configuración y registros para los recordatorios, y la etapa 2 necesita consultas del staff. Por eso: **tablas propias + API**, como las comidas.

```sql
CREATE TABLE IF NOT EXISTS supplement_items (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  catalog_id TEXT,              -- 'creatina', 'cafeina'…; NULL en uno propio
  name TEXT,                    -- solo en uno propio
  dose REAL, unit TEXT,         -- g, mg, ml, caps, ui
  scoop_g REAL,                 -- "mi scoop = X g"
  doses_per_day INTEGER NOT NULL DEFAULT 1,
  slot TEXT NOT NULL DEFAULT 'any',      -- morning | pre | post | meals | night | any
  days TEXT NOT NULL DEFAULT 'daily',    -- daily | training
  reminder_time TEXT,           -- HH:MM o NULL
  meta TEXT,                    -- JSON: macros por scoop (proteína), mg por scoop (pre-entreno)
  status TEXT NOT NULL DEFAULT 'active', -- active | archived
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS supplement_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_id TEXT REFERENCES supplement_items(id) ON DELETE CASCADE,  -- NULL en fuentes rápidas de cafeína
  date TEXT NOT NULL,           -- YYYY-MM-DD local del socio
  source TEXT,                  -- NULL (toma de un item) | cafe | espresso | mate | energizante | otro
  amount REAL,                  -- cantidad de la toma en la unidad del item; mg en cafeína
  comida_id INTEGER,            -- comida creada por una toma de proteína
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_supp_logs_user_date ON supplement_logs(user_id, date);
CREATE TABLE IF NOT EXISTS supplement_profile (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  ack_version TEXT, ack_at TEXT,        -- aviso + lista de chequeo leídos
  adult INTEGER,                        -- respuesta a "¿18 o más?" (solo si falta la edad)
  last_reminder_sent TEXT               -- JSON { itemId: 'YYYY-MM-DD' }
);
```

- **Una toma = una fila** en `supplement_logs`. Varias tomas de un suplemento en un día = varias filas. Desmarcar = borrar la última fila de ese item y día.
- API del socio (todas detrás del gate de membresía y de `supplements_enabled`, y solo para el propio usuario): `GET /api/supplements` (items + logs de los últimos 400 días + perfil), `POST/PUT /api/supplements/items`, `POST /api/supplements/items/archive`, `POST /api/supplements/items/delete`, `POST /api/supplements/log`, `POST /api/supplements/log/delete`, `POST /api/supplements/ack`. Validan rango de fechas (hoy − 7 … hoy en la zona del socio), unidades y tamaños.
- **Offline**: caché local + cola (`enqueueRequest`) como las comidas.
- **Borrar mis datos de salud** (`deleteHealthData`) borra también las tres tablas. Borrar la cuenta: `ON DELETE CASCADE`. El CSV de socios del owner (`api/member-export.js`) **no** las incluye (es un dato de salud y el staff no lo ve en la etapa 1); no existe todavía una exportación de datos para el propio socio.
- El staff **no** tiene endpoints en la etapa 1.

## Legal

- Privacidad (`PrivacyNotice.jsx`): agregar registro de suplementos como dato de salud, solo con consentimiento, no visible para el staff (etapa 1), borrable con "Borrar mis datos de salud".
- Términos (`TermsNotice.jsx`): cláusula de "información general, no consejo médico".
- Subir `LEGAL_VERSION`.
- **Producción solo después de la revisión del abogado.** Dev y demo antes.

## Archivos (etapa 1)

- `frontend/src/lib/suplementos-data.js` (nuevo): catálogo y fichas, con fuentes y fecha de revisión.
- `frontend/src/lib/suplementos.js` (nuevo): lógica pura (rangos con el peso, qué toca hoy, racha, cumplimiento, niveles del heatmap, total de cafeína, exceso).
- `frontend/src/components/suplementos/` (nuevo): `SuplementosCard.jsx`, `GuiaSheet.jsx`, `FichaSuplemento.jsx`, `ConfigSuplemento.jsx`, `AvisoInicial.jsx`, `CafeinaRapida.jsx`.
- `frontend/src/components/Heatmap.jsx`: separar `HeatmapGrid`.
- `frontend/src/views/Nutricion.jsx`: montar la tarjeta.
- `api/supplements.js` + `api/supplements-db.js` + `api/supplements-routes.js` (nuevos), `api/database.js` (migración, `deleteHealthData`), `api/sync.js` (tomas sin conexión), `api/scheduler.js` (recordatorios), `api/push-messages.js`, ajuste del owner.
- Admin: interruptor del owner.
- Legal: `PrivacyNotice.jsx`, `TermsNotice.jsx`, `LEGAL_VERSION`.

## Pruebas (etapa 1)

- **Unitarias** (`suplementos.test.js`): rango de cafeína con el peso y techo 400; qué toca hoy (diario / días de entreno); racha que no se corta en días que no tocaban; cumplimiento 30 días; niveles del heatmap; total de cafeína con fuentes rápidas; exceso; menores.
- **Contenido** (`suplementos-data.test.js`): cada ficha tiene todas las secciones, fuentes y fecha; los "No recomendado" no tienen "Agregar"; los de indicación profesional no tienen dosis sugerida.
- **API** (`supplements.http.test.js`): CRUD de items; logs dentro de hoy−7…hoy y rechazo del futuro y de >7 días; solo el propio usuario; apagado por el owner → 403/404; `deleteHealthData` borra todo; export incluye; toma de proteína crea y borra la comida.
- **Scheduler** (`scheduler-supplements.test.js`): manda si toca y no se marcó; no manda si ya se marcó, si no toca (días de entreno) o si el módulo está apagado; uno por día.
- **Componentes**: tarjeta (vacía, con items, marcar, marcar todos, cafeína), alta con scoop, cartel de fase de carga al agregar creatina por primera vez, aviso inicial y edad, menores sin seguimiento.
- **Navegador (dev)**: celular y PC, claro y oscuro.

## Etapa 2

1. **Rol nutricionista**: permiso nuevo (ej. `supplements.view`) asignable a un rol. Ve, por socio, qué suplementos toma, cumplimiento y heatmap, y los días en que se pasó de la dosis máxima.
2. **Control del staff**: con permiso (ej. `supplements.manage`), deshabilitar a un socio el seguimiento y la guía (por ejemplo, por indicación médica). El socio ve "Tu gimnasio deshabilitó esta sección para tu cuenta".
3. Privacidad y términos actualizados para el acceso del staff (nueva versión legal, el socio la acepta de nuevo).
4. Nuevas fichas que pidan los socios (a evaluar con la misma jerarquía de fuentes).

## Fuera de alcance

- Seguimiento de agua (solo el consejo de la guía).
- Marcas, productos, links de compra.
- Dosis personalizadas más allá de las cuentas por peso que da la fuente (cafeína).
- Marca en el gráfico de peso (reemplazada por el heatmap).
- Traducción del contenido de las fichas.
