# Suplementos (etapa 1): plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guía de suplementos basada en evidencia y seguimiento por socio dentro de Nutrición (tarjeta, guía, alta, cafeína con mate, historial con heatmap y recordatorios push), con aviso legal obligatorio e interruptor del owner.

**Architecture:**
- **Servidor:** tablas propias (`supplement_items`, `supplement_logs`, `supplement_profile`) en `api/supplements-db.js`; validación y reglas puras en `api/supplements.js`; rutas en `api/supplements-routes.js`, que `server.js` suma con `supplementRoutes({ ... })` igual que `closureRoutes`. Las tomas sin conexión entran por `POST /api/data/sync` (`api/sync.js`, `applyRequest`). El `scheduler` llama a `sendSupplementReminders`.
- **Cliente:** catálogo y fichas en `frontend/src/lib/suplementos-data.js`; lógica pura en `frontend/src/lib/suplementos.js`; estado en `frontend/src/store/useSupplements.js` (fuera de `S`, con caché local y cola offline); componentes en `frontend/src/components/suplementos/`. La tarjeta se monta en `frontend/src/views/Nutricion.jsx` entre Peso corporal y Resumen nutricional.

**Tech Stack:** Node 22 `node:http` + `node:sqlite` (tests `node --test`); React 19 + Zustand + Vitest (happy-dom).

**Spec:** `docs/superpowers/specs/2026-10-09-suplementos-design.md` (leerla entera antes de empezar: este plan la implementa).

## Global Constraints

- Textos de la UI en español rioplatense con voseo ("Tomá", "Fijate"). `lauyim` siempre en minúscula. Contenido de las fichas solo en español, **sin** `t()`; textos de interfaz con `t('…')` (clave en español, como el resto de las vistas nuevas).
- **Fuentes, en este orden:** IOC Consensus 2018 (Maughan et al., BJSM) → AIS Sports Supplement Framework (grupos A/B/C/D) → posturas ISSN (solo protocolos) → NIH ODS y EFSA (seguridad) → ANMAT/CAA art. 1381. La app dice "Basado en IOC, AIS, ISSN, NIH y EFSA".
- **Cafeína:** rango `3–6 mg/kg` con el peso, techo `400 mg/día`, referencia de una toma `200 mg` (EFSA). Corte sugerido: 6 h antes de dormir.
- **Creatina:** la app sugiere `3–5 g/día`. La fase de carga (≈20 g/día en 4 tomas, 5–7 días) solo en la guía, "para cuando recién empezás (o retomás después de semanas sin tomarla)", opcional.
- **Mate:** un toque = **½ termo**. Valor en mg "estimado", fijado en la Tarea 1 con la cuenta documentada.
- **Agua (EFSA):** 2,0 L/día mujeres, 2,5 L/día hombres (agua total, bebidas + comidas).
- **Momentos:** `morning | pre | post | meals | night | any` → "Mañana", "Antes de entrenar", "Después de entrenar", "Con las comidas", "Noche", "Cuando sea".
- **Días:** `daily | training`. Día de entreno = el plan le asigna rutina (`effectiveRoutineId`) **o** hay un workout ese día.
- **Fechas de registro:** hoy y hasta 7 días atrás, nunca el futuro.
- **Sin consentimiento de salud:** no hay nada (Nutrición ya se oculta). El servidor responde `403 health_consent_required`.
- **Menores de 18:** guía sin dosis ni seguimiento.
- **Aviso:** versión `SUPP_ACK_VERSION = '2026-10-09'`; solo botón "Leí y acepto", sin "Ahora no" ni texto debajo del botón.
- **Interruptor del owner:** `admin_settings.supplements_enabled`, encendido salvo `'0'`.
- **El staff no ve nada de suplementos** en esta etapa. El CSV de socios no los incluye.
- **Tests:** backend `cd api && node --test <archivo>`; frontend `cd frontend && npx vitest run <archivo>`. Antes del último commit, todo: `cd api && npm test` y `cd frontend && npm test && npm run build && node scripts/check-locales.mjs`.
- **Commits:** en inglés, Conventional Commits, terminados en `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Rama `feat/suplementos`. Push al terminar cada tarea (`git push`).

---

## Mapa de archivos

| Archivo | Qué hace |
|---|---|
| `frontend/src/lib/suplementos-data.js` (nuevo) | Catálogo: niveles, fichas, fuentes de cafeína, consejo de agua, versión del aviso |
| `frontend/src/lib/suplementos.js` (nuevo) | Lógica pura: rangos, qué toca, racha, cumplimiento, heatmap, cafeína del día, etiquetas |
| `api/supplements.js` (nuevo) | Validación de items y tomas, ventana de fechas, recordatorios que tocan, franja de la comida de proteína |
| `api/supplements-db.js` (nuevo) | Tablas y acceso a datos |
| `api/supplements-routes.js` (nuevo) | Rutas del socio y del owner + `sendSupplementReminders` |
| `api/database.js` | Llama a `migrateSupplements`; `deleteHealthData` borra las tablas |
| `api/server.js` | Registra rutas, gate de membresía/salud, `/api/config` |
| `api/sync.js` | Pedidos offline `supp-log-add` / `supp-log-delete` |
| `api/push-messages.js` | `supplementReminderPush` |
| `api/scheduler.js` | Llama a `sendSupplementReminders` |
| `api/legal.js` | Sube `LEGAL_VERSION` |
| `frontend/src/store/useSupplements.js` (nuevo) | Estado, caché y cola offline |
| `frontend/src/components/Heatmap.jsx` | Separa `HeatmapGrid` |
| `frontend/src/components/suplementos/*.jsx` (nuevos) | Tarjeta, aviso, guía, ficha, alta, cafeína, mis suplementos |
| `frontend/src/views/Nutricion.jsx` | Monta la tarjeta |
| `frontend/src/views/admin/Acceso.jsx` | Interruptor del owner |
| `frontend/src/components/PrivacyNotice.jsx`, `TermsNotice.jsx` | Textos legales |
| `frontend/src/index.css` | Estilos `.supp-*` |

---

### Task 1: Catálogo y contenido verificado

**Files:**
- Create: `frontend/src/lib/suplementos-data.js`
- Create: `frontend/src/lib/suplementos-data.test.js`
- Create: `docs/suplementos-fuentes.md` (registro de verificación)

**Interfaces:**
- Produces:
  - `SUPP_ACK_VERSION: string` (`'2026-10-09'`)
  - `CATALOG_REVIEWED: string` (`'2026-10'`)
  - `LEVELS: Record<LevelId, { label: string, color: string, order: number }>` con `LevelId = 'funciona' | 'puntual' | 'desarrollo' | 'indicacion' | 'no'`
  - `SUPLEMENTOS: Ficha[]` y `fichaById(id): Ficha | null`
  - `Ficha = { id, name, short, level, ais, trackable, unit, dose?: { min, max, suggested } , dosePerKg?: { min, max }, dayMax?: number, doses?: number, slot?: Slot, days?: 'daily'|'training', loading?: string, macrosPerScoop?: { gramos, proteina, calorias, carbos, grasas }, intro, howTo: { icon, text }[], evidence, forWhom, notice, cautions: string[], buy, sources: string[], reviewed, badge? }`
  - `CAFFEINE_SOURCES: { id: 'mate'|'cafe'|'espresso'|'energizante'|'preentreno'|'otro', label, emoji, unitLabel, mg: number|null }[]` (`mg: null` = se pide a mano)
  - `MATE_TIPS: string[]`, `WATER_TIP: { mujeres: string, hombres: string, ambos: string }`
  - `SLOTS: { id: Slot, label: string }[]` en el orden de los momentos
  - `UNITS: { id: 'g'|'mg'|'ml'|'caps'|'ui'|'dosis', label: string }[]`

- [ ] **Step 1: Verificar las cifras contra las fuentes**

Antes de escribir datos, verificar cada cifra en su documento original (WebSearch/WebFetch; preferir el PDF/PMC del artículo y el sitio del organismo). Volcar el resultado en `docs/suplementos-fuentes.md` con una fila por cifra: suplemento, dato, valor final, fuente (cita + URL), fecha consultada. Valores provisorios a confirmar o corregir:

| Suplemento | Dato | Provisorio | Fuente a consultar |
|---|---|---|---|
| Creatina | mantenimiento | 3–5 g/día | ISSN, Kreider et al. 2017 |
| Creatina | carga | 0,3 g/kg/día (~20 g) en 4 tomas, 5–7 días | ISSN 2017 |
| Creatina | ganancia de agua | 1–2 kg las primeras semanas | ISSN 2017 / IOC 2018 |
| Creatina | se degrada disuelta | creatinina en solución con el tiempo | ISSN 2017 |
| Cafeína | rendimiento | 3–6 mg/kg, 30–60 min antes | ISSN, Guest et al. 2021 |
| Cafeína | límites | 200 mg por toma, 400 mg/día; 200 mg/día embarazo | EFSA 2015 |
| Cafeína | sueño | 400 mg hasta 6 h antes altera el sueño | Drake et al. 2013 |
| Cafeína | hidratación | dosis habituales no deshidratan | Maughan & Griffin 2003; Killer et al. 2014 |
| Café / espresso / energizante | mg por porción | 80–100 / 60–80 / 80 por 250 ml | EFSA 2015 (tabla de fuentes) o NIH/USDA |
| Mate | mg por ½ termo | calcular: mg/g de yerba × g típicos por ½ termo | estudios primarios (p. ej. Najman et al. 2024 *Molecules*; Panzl et al. 2022) — documentar la cuenta |
| Beta-alanina | dosis | 4–6 g/día, tomas ≤ 1,6 g (o liberación lenta), ≥ 2–4 semanas | ISSN, Trexler et al. 2015 |
| Proteína | meta | 1,4–2,0 g/kg/día; 20–40 g por toma | ISSN, Jäger et al. 2017 |
| Electrolitos | cuándo | sesiones > 60–90 min, calor, mucho sudor | AIS (grupo A, sports foods) / ACSM |
| Colágeno | protocolo | 10–15 g + 50 mg vit C, 30–60 min antes | AIS grupo B; Shaw et al. 2017 |
| Bicarbonato | dosis | 0,2–0,3 g/kg, 60–180 min antes | ISSN, Grgic et al. 2021 |
| Nitrato | dosis | ~5–9 mmol (310–560 mg), 2–3 h antes | IOC 2018 |
| Grupos AIS | clasificación de cada uno | ver tabla de la spec | AIS, versión vigente |
| Agua | ingesta adecuada | 2,0 / 2,5 L/día | EFSA 2010 |

Si una cifra no se puede confirmar en una fuente primaria u oficial, se escribe como rango con la palabra "aproximado" o "estimado" y se anota así en el registro.

- [ ] **Step 2: Escribir el test del contenido (falla porque no existe el archivo)**

```js
// frontend/src/lib/suplementos-data.test.js
import { describe, expect, it } from 'vitest'
import { SUPLEMENTOS, LEVELS, CAFFEINE_SOURCES, SLOTS, UNITS, fichaById, SUPP_ACK_VERSION, WATER_TIP, MATE_TIPS } from './suplementos-data.js'

describe('catálogo de suplementos', () => {
  it('tiene los suplementos de la spec en su nivel', () => {
    const byLevel = id => fichaById(id)?.level
    expect(['creatina', 'cafeina', 'betaalanina', 'proteina', 'electrolitos'].map(byLevel)).toEqual(Array(5).fill('funciona'))
    expect(['bicarbonato', 'remolacha'].map(byLevel)).toEqual(['puntual', 'puntual'])
    expect(byLevel('colageno')).toBe('desarrollo')
    expect(['vitaminad', 'hierro', 'omega3', 'magnesio', 'multivitaminico'].map(byLevel)).toEqual(Array(5).fill('indicacion'))
    expect(['quemadores', 'bcaa', 'glutamina', 'boosters', 'prohormonas'].map(byLevel)).toEqual(Array(5).fill('no'))
  })
  it('cada ficha tiene todas las secciones, fuentes y fecha', () => {
    for (const f of SUPLEMENTOS) {
      expect(LEVELS[f.level], f.id).toBeTruthy()
      for (const k of ['name', 'short', 'intro', 'evidence', 'forWhom', 'buy', 'reviewed']) expect(String(f[k] || '').length, `${f.id}.${k}`).toBeGreaterThan(0)
      expect(f.sources.length, f.id).toBeGreaterThan(0)
      expect(f.cautions.length, f.id).toBeGreaterThan(0)
    }
  })
  it('solo se siguen los de funciona, desarrollo e indicación', () => {
    for (const f of SUPLEMENTOS) expect(f.trackable, f.id).toBe(['funciona', 'desarrollo', 'indicacion'].includes(f.level))
  })
  it('los de indicación profesional no sugieren dosis; los demás seguibles sí', () => {
    for (const f of SUPLEMENTOS.filter(x => x.level === 'indicacion')) expect(f.dose, f.id).toBeUndefined()
    for (const f of SUPLEMENTOS.filter(x => x.trackable && x.level !== 'indicacion' && x.id !== 'cafeina' && x.id !== 'proteina')) expect(f.dose?.suggested, f.id).toBeGreaterThan(0)
    expect(fichaById('cafeina').dosePerKg).toEqual({ min: 3, max: 6 })
    expect(fichaById('cafeina').dayMax).toBe(400)
  })
  it('creatina: 3–5 g, fase de carga solo en la guía y "cómo tomarla" con agua y scoop', () => {
    const c = fichaById('creatina')
    expect(c.dose).toEqual({ min: 3, max: 5, suggested: 5 })
    expect(c.loading).toMatch(/recién empezás/)
    const how = c.howTo.map(h => h.text).join(' ')
    expect(how).toMatch(/scoop/); expect(how).toMatch(/ml/); expect(how).toMatch(/No dupliques/)
  })
  it('fuentes de cafeína: el mate es por ½ termo y estimado', () => {
    const mate = CAFFEINE_SOURCES.find(s => s.id === 'mate')
    expect(mate.unitLabel).toBe('½ termo'); expect(mate.mg).toBeGreaterThan(0)
    expect(CAFFEINE_SOURCES.map(s => s.id)).toEqual(['mate', 'cafe', 'espresso', 'energizante', 'preentreno', 'otro'])
    expect(CAFFEINE_SOURCES.find(s => s.id === 'otro').mg).toBeNull()
    expect(MATE_TIPS.join(' ')).toMatch(/no deshidrata/)
  })
  it('momentos, unidades, agua y versión del aviso', () => {
    expect(SLOTS.map(s => s.id)).toEqual(['morning', 'pre', 'post', 'meals', 'night', 'any'])
    expect(UNITS.map(u => u.id)).toEqual(['g', 'mg', 'ml', 'caps', 'ui', 'dosis'])
    expect(WATER_TIP.hombres).toMatch(/2,5 L/); expect(WATER_TIP.mujeres).toMatch(/2 L/)
    expect(SUPP_ACK_VERSION).toBe('2026-10-09')
  })
})
```

- [ ] **Step 3: Correr el test y ver que falla**

Run: `cd frontend && npx vitest run src/lib/suplementos-data.test.js`
Expected: FAIL (no existe `./suplementos-data.js`).

- [ ] **Step 4: Escribir el catálogo**

Estructura del archivo (completar **todas** las fichas con el mismo nivel de detalle que la creatina, usando los valores verificados en el Step 1; tono: voseo, frases cortas):

```js
// frontend/src/lib/suplementos-data.js
// Catálogo de suplementos (docs/superpowers/specs/2026-10-09-suplementos-design.md). Cada cifra está
// verificada en docs/suplementos-fuentes.md. Contenido en español, sin t(): es texto de la guía.
export const SUPP_ACK_VERSION = '2026-10-09'
export const CATALOG_REVIEWED = '2026-10'

export const LEVELS = {
  funciona: { label: 'Funciona', color: 'var(--green)', order: 0 },
  puntual: { label: 'Solo en situaciones puntuales', color: 'var(--teal)', order: 1 },
  desarrollo: { label: 'Evidencia en desarrollo', color: 'var(--purple)', order: 2 },
  indicacion: { label: 'Con indicación profesional', color: 'var(--yellow)', order: 3 },
  no: { label: 'No recomendado', color: 'var(--red)', order: 4 },
}

export const SLOTS = [
  { id: 'morning', label: 'Mañana' }, { id: 'pre', label: 'Antes de entrenar' }, { id: 'post', label: 'Después de entrenar' },
  { id: 'meals', label: 'Con las comidas' }, { id: 'night', label: 'Noche' }, { id: 'any', label: 'Cuando sea' },
]
export const UNITS = [
  { id: 'g', label: 'g' }, { id: 'mg', label: 'mg' }, { id: 'ml', label: 'ml' },
  { id: 'caps', label: 'cápsulas' }, { id: 'ui', label: 'UI' }, { id: 'dosis', label: 'dosis' },
]

export const WATER_TIP = {
  mujeres: 'Recordá tomar agua: alrededor de 2 L por día entre bebidas y comidas, más lo que transpirás entrenando.',
  hombres: 'Recordá tomar agua: alrededor de 2,5 L por día entre bebidas y comidas, más lo que transpirás entrenando.',
  ambos: 'Recordá tomar agua: alrededor de 2 L (mujeres) a 2,5 L (hombres) por día entre bebidas y comidas, más lo que transpirás entrenando.',
}

// mg: valor verificado (Step 1). El mate es por ½ termo y siempre "estimado".
export const CAFFEINE_SOURCES = [
  { id: 'mate', label: 'Mate', emoji: '🧉', unitLabel: '½ termo', mg: 0 /* ← valor del registro */ },
  { id: 'cafe', label: 'Café', emoji: '☕', unitLabel: 'taza', mg: 0 },
  { id: 'espresso', label: 'Espresso', emoji: '☕', unitLabel: 'pocillo', mg: 0 },
  { id: 'energizante', label: 'Energizante', emoji: '⚡', unitLabel: 'lata 250 ml', mg: 0 },
  { id: 'preentreno', label: 'Pre-entreno', emoji: '💊', unitLabel: 'tu etiqueta', mg: null },
  { id: 'otro', label: 'Otro', emoji: '＋', unitLabel: 'mg a mano', mg: null },
]
export const MATE_TIPS = [
  'El mate cuenta como líquido: en cantidades normales la cafeína no deshidrata. Tomarlo antes o durante el entreno está bien.',
  '¿Además usás pre-entreno? Sumá los dos: el total del día es lo que cuenta.',
  'La cafeína del mate varía mucho según la yerba y las cebadas: por eso el número es estimado.',
  'Si te cuesta dormir, cortá la cafeína (mate incluido) unas 6 h antes.',
  'Si le ponés azúcar, suma calorías: lo podés cargar en Nutrición.',
]

const R = CATALOG_REVIEWED
export const SUPLEMENTOS = [
  {
    id: 'creatina', name: 'Creatina monohidrato', short: 'Fuerza y masa muscular', level: 'funciona', ais: 'A', trackable: true,
    unit: 'g', dose: { min: 3, max: 5, suggested: 5 }, dayMax: 20, doses: 1, slot: 'any', days: 'daily',
    intro: 'Mejora la fuerza y la masa muscular cuando entrenás con pesas. Es de los suplementos más estudiados.',
    howTo: [
      { icon: '⚖️', text: '3 a 5 g por día, todos los días (también los de descanso).' },
      { icon: '🥄', text: '1 scoop: fijate en la etiqueta cuántos gramos trae el tuyo (suelen ser 3 o 5 g). Sin scoop: 1 cucharadita de té al ras son unos 3 a 5 g (aproximado: mejor scoop o balanza).' },
      { icon: '💧', text: 'Disolvela en 200 a 300 ml de agua, jugo o leche, o en tu batido o yogur. Tibio se disuelve mejor. Preparala en el momento: disuelta por días se degrada.' },
      { icon: '🕐', text: 'A cualquier hora. Lo que importa es tomarla todos los días. Con una comida está bien.' },
      { icon: '🤷', text: '¿Te olvidaste? Seguí al otro día con lo normal. No dupliques.' },
    ],
    loading: 'Fase de carga, para cuando recién empezás (o retomás después de semanas sin tomarla): unos 20 g por día en 4 tomas de 5 g, durante 5 a 7 días, y después 3 a 5 g. Es opcional: sin carga llegás al mismo punto en 3 a 4 semanas.',
    evidence: 'Funciona: mejora la fuerza y la ganancia de masa muscular en entrenamiento de fuerza.',
    forWhom: 'Para quien entrena fuerza o hace esfuerzos cortos e intensos. No hace falta para caminar o hacer cardio suave.',
    notice: 'Podés subir 1 a 2 kg las primeras semanas: es agua dentro del músculo, no grasa.',
    cautions: ['Si tenés enfermedad renal, consultá antes.', 'Menores de 18: solo con supervisión profesional.'],
    buy: 'Elegí creatina monohidrato. No hacen falta versiones "mejoradas". Buscá registro ANMAT y, si podés, un sello de control de terceros (Informed Sport o NSF Certified for Sport).',
    sources: ['IOC Consensus Statement 2018 (Maughan et al.)', 'AIS Sports Supplement Framework, grupo A', 'ISSN, Kreider et al. 2017', 'NIH Office of Dietary Supplements'],
    reviewed: R,
  },
  // cafeina: unit 'mg', dosePerKg { min: 3, max: 6 }, dayMax 400, doses 1, slot 'pre', days 'training'; sin `dose`.
  //   howTo: cápsula de 100 o 200 mg con agua; pre-entreno: mirá los mg por scoop y empezá con medio; 30–60 min antes;
  //   cortar 6 h antes de dormir; contá también el mate, el café y los energizantes.
  // proteina: unit 'g', macrosPerScoop { gramos: 30, proteina: 24, calorias: 120, carbos: 3, grasas: 1.5 }, dose { min: 20, max: 40, suggested: 30 },
  //   doses 1, slot 'post', days 'daily'; howTo: 1 scoop (~30 g de polvo) en 250–300 ml de agua o leche, o con yogur/avena; suma a tu meta de Nutrición.
  // betaalanina: unit 'g', dose { min, max, suggested } y doses (≥ 2) según el registro; slot 'meals'; days 'daily'; notice: hormigueo inofensivo.
  // electrolitos: unit 'dosis', dose { min: 1, max: 2, suggested: 1 }, slot 'pre', days 'training'; howTo: 1 sobre en 500–750 ml de agua; solo sesiones largas o con calor.
  // colageno: level 'desarrollo', ais 'B', unit 'g', dose según el registro, slot 'pre', days 'training', badge 'Evidencia en desarrollo'.
  // bicarbonato, remolacha: level 'puntual', trackable false (sin unit/dose).
  // vitaminad, hierro, omega3, magnesio, multivitaminico: level 'indicacion', trackable true, unit 'caps' (vitamina D: 'ui'), sin dose;
  //   howTo: "Tomá la dosis que te indicó tu médico o nutricionista"; cautions con interacciones y riesgos de exceso (NIH ODS).
  // quemadores, bcaa, glutamina, boosters, prohormonas: level 'no', trackable false; intro = qué prometen; evidence = qué muestra la
  //   evidencia; cautions = riesgos (estimulantes ocultos, contaminación, sustancias prohibidas: prohormonas/SARMs = AIS grupo D);
  //   buy = "En qué gastar en cambio".
]

export const fichaById = id => SUPLEMENTOS.find(f => f.id === id) || null
```

Las líneas comentadas de arriba son la **especificación** de cada ficha restante: reemplazar cada comentario por su objeto completo (mismo formato que `creatina`), con los textos y cifras del registro. Los `mg: 0` de `CAFFEINE_SOURCES` se reemplazan por los valores verificados. Al terminar, el archivo no tiene comentarios de especificación.

- [ ] **Step 5: Correr el test y ver que pasa**

Run: `cd frontend && npx vitest run src/lib/suplementos-data.test.js`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/suplementos-data.js frontend/src/lib/suplementos-data.test.js docs/suplementos-fuentes.md
git commit -m "feat(supplements): evidence-based catalog with verified sources" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 2: Lógica pura del cliente

**Files:**
- Create: `frontend/src/lib/suplementos.js`
- Create: `frontend/src/lib/suplementos.test.js`

**Interfaces:**
- Consumes: `fichaById`, `CAFFEINE_SOURCES`, `UNITS` (Tarea 1); `effectiveRoutineId(S, iso)` de `./history.js`; `todayISO` de `./format.js`.
- Produces (todas puras; `item` = `{ id, catalogId, name, dose, unit, scoopG, doses, slot, days, reminderTime, meta, status, createdAt }`; `log` = `{ id, itemId, date, source, amount, comidaId, createdAt }`):
  - `addDays(iso, n): string`
  - `canLogDate(iso, today): boolean` (hoy−7 … hoy)
  - `caffeineRange(weightKg): { min, max, dayMax: 400, singleRef: 200 } | null` (redondeo a 10 mg; `max` nunca > 400)
  - `isTrainingDay(S, iso): boolean`
  - `isDueOn(item, iso, trainingDay): boolean`
  - `takenOn(logs, itemId, iso): number`
  - `streakOf(item, logs, today, trainingDayOf): number`
  - `adherence30(item, logs, today, trainingDayOf): number | null` (0–100; null sin días que tocaran)
  - `dayLevel(item, logs, iso, trainingDayOf, streakAt?): 0..4`
  - `caffeineTotal(logs, items, iso): number`
  - `isOverCaffeine(total): boolean`
  - `itemName(item): string`
  - `perTake(item): number`
  - `doseLabel(item): string` (ej. `'1 scoop · 5 g'`, `'2 tomas · 1,6 g c/u'`, `'2 cápsulas'`)
  - `groupBySlot(items): { slot: { id, label }, items }[]`
  - `adultStatus({ edad, adult }): 'adult' | 'minor' | 'unknown'`
  - `overDose(item, logs, iso): number | null` (cantidad del día si supera `fichaById(catalogId).dayMax`; si no, null)

- [ ] **Step 1: Escribir los tests (fallan)**

```js
// frontend/src/lib/suplementos.test.js
import { describe, expect, it } from 'vitest'
import { addDays, canLogDate, caffeineRange, isTrainingDay, isDueOn, takenOn, streakOf, adherence30, dayLevel, caffeineTotal, isOverCaffeine, doseLabel, perTake, groupBySlot, adultStatus, itemName, overDose } from './suplementos.js'

const TODAY = '2026-10-09'
const crea = { id: 'i1', catalogId: 'creatina', dose: 5, unit: 'g', scoopG: 5, doses: 1, slot: 'morning', days: 'daily', status: 'active', createdAt: '2026-09-01T10:00:00Z' }
const beta = { id: 'i2', catalogId: 'betaalanina', dose: 3.2, unit: 'g', scoopG: null, doses: 2, slot: 'meals', days: 'daily', status: 'active', createdAt: '2026-09-01T10:00:00Z' }
const elec = { id: 'i3', catalogId: 'electrolitos', dose: 1, unit: 'dosis', scoopG: null, doses: 1, slot: 'pre', days: 'training', status: 'active', createdAt: '2026-09-01T10:00:00Z' }
const log = (itemId, date, extra = {}) => ({ id: Math.random().toString(36).slice(2), itemId, date, source: null, amount: 0, ...extra })
const always = () => true, never = () => false

describe('fechas', () => {
  it('hoy y hasta 7 días atrás, nunca el futuro', () => {
    expect(canLogDate(TODAY, TODAY)).toBe(true)
    expect(canLogDate(addDays(TODAY, -7), TODAY)).toBe(true)
    expect(canLogDate(addDays(TODAY, -8), TODAY)).toBe(false)
    expect(canLogDate(addDays(TODAY, 1), TODAY)).toBe(false)
  })
})

describe('cafeína', () => {
  it('rango con el peso, con techo de 400', () => {
    expect(caffeineRange(80)).toEqual({ min: 240, max: 400, dayMax: 400, singleRef: 200 })
    expect(caffeineRange(60)).toEqual({ min: 180, max: 360, dayMax: 400, singleRef: 200 })
    expect(caffeineRange(null)).toBeNull()
  })
  it('total del día: fuentes rápidas + items de cafeína', () => {
    const caf = { id: 'c', catalogId: 'cafeina', unit: 'mg', dose: 200, doses: 1, days: 'training', status: 'active' }
    const logs = [log(null, TODAY, { source: 'mate', amount: 80 }), log(null, TODAY, { source: 'cafe', amount: 90 }), log('c', TODAY, { amount: 200 }), log(null, addDays(TODAY, -1), { source: 'mate', amount: 80 })]
    expect(caffeineTotal(logs, [caf], TODAY)).toBe(370)
    expect(isOverCaffeine(400)).toBe(false); expect(isOverCaffeine(401)).toBe(true)
  })
})

describe('qué toca', () => {
  it('días de entreno: plan o workout registrado', () => {
    const S = { routines: [{ id: 'r' }], week: { 5: 'r' }, dayPlan: {}, workouts: [{ d: '2026-10-07', kind: 'class' }] }
    expect(isTrainingDay(S, '2026-10-09')).toBe(true)     // viernes con rutina
    expect(isTrainingDay(S, '2026-10-07')).toBe(true)     // miércoles con una clase hecha
    expect(isTrainingDay(S, '2026-10-08')).toBe(false)
  })
  it('diario siempre; de entreno solo esos días; archivado y antes del alta nunca', () => {
    expect(isDueOn(crea, TODAY, false)).toBe(true)
    expect(isDueOn(elec, TODAY, false)).toBe(false)
    expect(isDueOn(elec, TODAY, true)).toBe(true)
    expect(isDueOn({ ...crea, status: 'archived' }, TODAY, true)).toBe(false)
    expect(isDueOn(crea, '2026-08-31', true)).toBe(false)
  })
})

describe('racha, cumplimiento y heatmap', () => {
  it('racha: días seguidos completos; hoy incompleto no corta; un día de entreno no cuenta si no tocaba', () => {
    const logs = [-1, -2, -3].map(n => log('i1', addDays(TODAY, n)))
    expect(streakOf(crea, logs, TODAY, always)).toBe(3)
    expect(streakOf(crea, [...logs, log('i1', TODAY)], TODAY, always)).toBe(4)
    const trainOnlyOdd = iso => Number(iso.slice(8)) % 2 === 1   // 9, 7, 5…
    const eLogs = [log('i3', '2026-10-07'), log('i3', '2026-10-05')]
    expect(streakOf(elec, eLogs, TODAY, trainOnlyOdd)).toBe(2)
  })
  it('varias tomas: el día cuenta completo con todas', () => {
    const logs = [log('i2', addDays(TODAY, -1)), log('i2', addDays(TODAY, -1)), log('i2', addDays(TODAY, -2))]
    expect(takenOn(logs, 'i2', addDays(TODAY, -1))).toBe(2)
    expect(streakOf(beta, logs, TODAY, always)).toBe(1)
    expect(dayLevel(beta, logs, addDays(TODAY, -2), always)).toBe(2)   // la mitad
    expect(dayLevel(beta, logs, addDays(TODAY, -1), always)).toBe(3)   // todas
    expect(dayLevel(beta, [], addDays(TODAY, -3), always)).toBe(0)
    expect(dayLevel(elec, [], TODAY, never)).toBe(0)
  })
  it('nivel 1: menos de la mitad; nivel 4: completo con racha de 7 o más', () => {
    const tres = { ...beta, doses: 3 }
    expect(dayLevel(tres, [log('i2', TODAY)], TODAY, always)).toBe(1)
    const week = Array.from({ length: 7 }, (_, i) => log('i1', addDays(TODAY, -i)))
    expect(dayLevel(crea, week, TODAY, always)).toBe(4)
  })
  it('cumplimiento 30 días sobre los días que tocaban (sin hoy si está incompleto)', () => {
    const logs = Array.from({ length: 15 }, (_, i) => log('i1', addDays(TODAY, -1 - i)))
    expect(adherence30(crea, logs, TODAY, always)).toBe(52)   // 15 de 29 (hoy incompleto no cuenta)
    expect(adherence30(elec, [], TODAY, never)).toBeNull()
  })
})

describe('etiquetas', () => {
  it('dosis con scoop, varias tomas y unidades', () => {
    expect(doseLabel(crea)).toBe('1 scoop · 5 g')
    expect(doseLabel({ ...crea, scoopG: 3, dose: 4.5 })).toBe('1½ scoop · 4,5 g')
    expect(perTake(beta)).toBe(1.6)
    expect(doseLabel(beta)).toBe('2 tomas · 1,6 g c/u')
    expect(doseLabel({ id: 'x', catalogId: 'omega3', dose: 2, unit: 'caps', doses: 1 })).toBe('2 cápsulas')
  })
  it('nombre: el del catálogo o el propio', () => {
    expect(itemName(crea)).toBe('Creatina monohidrato')
    expect(itemName({ catalogId: null, name: 'Ashwagandha' })).toBe('Ashwagandha')
  })
  it('agrupa por momento en el orden de SLOTS', () => {
    expect(groupBySlot([beta, crea, elec]).map(g => g.slot.id)).toEqual(['morning', 'pre', 'meals'])
  })
  it('exceso: lo marcado en el día supera el máximo de la ficha', () => {
    const logs = [log('i1', TODAY, { amount: 15 }), log('i1', TODAY, { amount: 10 })]
    expect(overDose(crea, logs, TODAY)).toBe(25)
    expect(overDose(crea, logs.slice(0, 1), TODAY)).toBeNull()
  })
  it('edad: la cargada manda; si falta, la respuesta', () => {
    expect(adultStatus({ edad: 17, adult: 1 })).toBe('minor')
    expect(adultStatus({ edad: 30 })).toBe('adult')
    expect(adultStatus({ edad: null, adult: 1 })).toBe('adult')
    expect(adultStatus({ edad: null, adult: 0 })).toBe('minor')
    expect(adultStatus({ edad: null, adult: null })).toBe('unknown')
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `cd frontend && npx vitest run src/lib/suplementos.test.js`
Expected: FAIL (no existe `./suplementos.js`).

- [ ] **Step 3: Implementar**

```js
// frontend/src/lib/suplementos.js
// Lógica pura de suplementos (docs/superpowers/specs/2026-10-09-suplementos-design.md): qué toca
// cada día, racha, cumplimiento, niveles del heatmap, cafeína del día y etiquetas de dosis.
import { fichaById, SLOTS, UNITS } from './suplementos-data.js'
import { effectiveRoutineId } from './history.js'

const dayNum = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 86400000
export const addDays = (iso, n) => new Date((dayNum(iso) + n) * 86400000).toISOString().slice(0, 10)
export const canLogDate = (iso, today) => /^\d{4}-\d{2}-\d{2}$/.test(iso || '') && iso <= today && iso >= addDays(today, -7)

const CAFFEINE_DAY_MAX = 400, CAFFEINE_SINGLE_REF = 200
const round10 = n => Math.round(n / 10) * 10
export function caffeineRange(weightKg) {
  if (!(weightKg > 0)) return null
  return { min: Math.min(CAFFEINE_DAY_MAX, round10(3 * weightKg)), max: Math.min(CAFFEINE_DAY_MAX, round10(6 * weightKg)), dayMax: CAFFEINE_DAY_MAX, singleRef: CAFFEINE_SINGLE_REF }
}
export const isOverCaffeine = total => total > CAFFEINE_DAY_MAX

export const isTrainingDay = (S, iso) => !!effectiveRoutineId(S, iso) || (S?.workouts || []).some(w => w.d === iso)
export const isDueOn = (item, iso, trainingDay) => item.status === 'active'
  && iso >= String(item.createdAt || '').slice(0, 10)
  && (item.days !== 'training' || !!trainingDay)
export const takenOn = (logs, itemId, iso) => logs.reduce((n, l) => n + (l.itemId === itemId && l.date === iso ? 1 : 0), 0)
const doses = item => Math.max(1, item.doses || 1)
const complete = (item, logs, iso) => takenOn(logs, item.id, iso) >= doses(item)

// Días seguidos completos entre los que tocaban. Hoy incompleto no corta (todavía hay tiempo).
export function streakOf(item, logs, today, trainingDayOf) {
  let n = 0
  for (let i = 0; i < 400; i++) {
    const iso = addDays(today, -i)
    if (iso < String(item.createdAt || '').slice(0, 10)) break
    if (!isDueOn({ ...item, status: 'active' }, iso, trainingDayOf(iso))) continue
    if (complete(item, logs, iso)) n++
    else if (i > 0) break
  }
  return n
}

export function adherence30(item, logs, today, trainingDayOf) {
  let due = 0, done = 0
  for (let i = 0; i < 30; i++) {
    const iso = addDays(today, -i)
    if (!isDueOn({ ...item, status: 'active' }, iso, trainingDayOf(iso))) continue
    const ok = complete(item, logs, iso)
    if (i === 0 && !ok) continue
    due++; if (ok) done++
  }
  return due ? Math.round((done / due) * 100) : null
}

export function dayLevel(item, logs, iso, trainingDayOf) {
  if (!isDueOn({ ...item, status: 'active' }, iso, trainingDayOf(iso))) return 0
  const taken = takenOn(logs, item.id, iso), need = doses(item)
  if (!taken) return 0
  if (taken < need) return taken * 2 >= need ? 2 : 1
  return streakOf(item, logs, iso, trainingDayOf) >= 7 ? 4 : 3
}

export function caffeineTotal(logs, items, iso) {
  const caffeineItems = new Set(items.filter(i => i.catalogId === 'cafeina').map(i => i.id))
  return Math.round(logs.filter(l => l.date === iso && (l.source || caffeineItems.has(l.itemId))).reduce((s, l) => s + (Number(l.amount) || 0), 0))
}

export function overDose(item, logs, iso) {
  const max = fichaById(item.catalogId)?.dayMax
  if (!max) return null
  const total = logs.filter(l => l.itemId === item.id && l.date === iso).reduce((s, l) => s + (Number(l.amount) || 0), 0)
  return total > max ? total : null
}

export const itemName = item => item.catalogId ? (fichaById(item.catalogId)?.name || item.name || '') : (item.name || '')
const fmt = n => String(Math.round(n * 100) / 100).replace('.', ',')
export const perTake = item => Math.round(((Number(item.dose) || 0) / doses(item)) * 100) / 100
const unitLabel = (unit, n) => unit === 'caps' ? (n === 1 ? 'cápsula' : 'cápsulas') : unit === 'dosis' ? (n === 1 ? 'dosis' : 'dosis') : (UNITS.find(u => u.id === unit)?.label || unit || '')
const scoops = n => { const halves = Math.round(n * 2); const whole = Math.floor(halves / 2); return (whole ? String(whole) : '') + (halves % 2 ? '½' : '') || '0' }
export function doseLabel(item) {
  const take = perTake(item)
  if (doses(item) > 1) return `${doses(item)} tomas · ${fmt(take)} ${unitLabel(item.unit, take)} c/u`
  if (item.scoopG > 0 && item.unit === 'g') return `${scoops(take / item.scoopG)} scoop · ${fmt(take)} g`
  return `${fmt(take)} ${unitLabel(item.unit, take)}`
}

export const groupBySlot = items => SLOTS
  .map(slot => ({ slot, items: items.filter(i => (i.slot || 'any') === slot.id) }))
  .filter(g => g.items.length)

export function adultStatus({ edad, adult }) {
  if (Number(edad) > 0) return Number(edad) >= 18 ? 'adult' : 'minor'
  if (adult === 1 || adult === true) return 'adult'
  if (adult === 0 || adult === false) return 'minor'
  return 'unknown'
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `cd frontend && npx vitest run src/lib/suplementos.test.js`
Expected: PASS. Si `dayLevel(crea, week, TODAY)` da 3, revisar que `streakOf` cuente hoy completo (i = 0) → 7.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/suplementos.js frontend/src/lib/suplementos.test.js
git commit -m "feat(supplements): pure logic for due days, streaks, heatmap and caffeine" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 3: Tablas y acceso a datos en el servidor

**Files:**
- Create: `api/supplements-db.js`
- Create: `api/supplements-db.test.js`
- Modify: `api/database.js` (import + llamada en `initDatabase` junto a `migrateClasses(db)`; `deleteHealthData`)

**Interfaces:**
- Produces:
  - `migrateSupplements(db): void`
  - `listItems(userId): Item[]` (activos y archivados, por `created_at`)
  - `getItem(userId, id): Item | null`
  - `saveItem(userId, item): Item` (inserta o actualiza por `id`; `updated_at` = ahora)
  - `setItemStatus(userId, id, status): boolean`
  - `deleteItem(userId, id): boolean` (borra sus tomas y las comidas de proteína asociadas)
  - `listLogs(userId, fromDate): Log[]`
  - `addLog(userId, log): Log` (idempotente por `id`: si ya existe, devuelve el existente)
  - `getLog(userId, id): Log | null`
  - `deleteLog(userId, id): Log | null` (devuelve el borrado; borra su `comida_id`)
  - `getProfile(userId): { ackVersion, ackAt, adult, lastReminderSent: Record<string,string> }`
  - `setAck(userId, version, adult): void`
  - `markReminderSent(userId, itemId, date): void`
  - `itemsWithReminders(): (Item & { userId })[]`
  - `deleteSupplementData(db, userId): void`
  - `Item` (forma de salida, camelCase): `{ id, catalogId, name, dose, unit, scoopG, doses, slot, days, reminderTime, meta, status, createdAt, updatedAt }`
  - `Log`: `{ id, itemId, date, source, amount, comidaId, createdAt }`

- [ ] **Step 1: Test que falla**

```js
// api/supplements-db.test.js
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-supp-db-'));
process.env.DATA_DIR = dataDir;
const db = await import('./database.js');
const sdb = await import('./supplements-db.js');
db.initDatabase();
db.createUser({ id: 'ana', name: 'ana', created: Date.now() });
db.createUser({ id: 'beto', name: 'beto', created: Date.now() });
after(() => { db.closeDatabase(); fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

const item = { id: 'it1', catalogId: 'creatina', name: null, dose: 5, unit: 'g', scoopG: 5, doses: 1, slot: 'morning', days: 'daily', reminderTime: '09:00', meta: null };

test('items: alta, edición, archivo y aislamiento por usuario', () => {
  const saved = sdb.saveItem('ana', item);
  assert.equal(saved.status, 'active');
  assert.equal(sdb.saveItem('ana', { ...item, dose: 3 }).dose, 3);
  assert.equal(sdb.listItems('ana').length, 1);
  assert.equal(sdb.listItems('beto').length, 0);
  assert.equal(sdb.getItem('beto', 'it1'), null);
  assert.equal(sdb.setItemStatus('ana', 'it1', 'archived'), true);
  assert.equal(sdb.getItem('ana', 'it1').status, 'archived');
  assert.equal(sdb.setItemStatus('beto', 'it1', 'active'), false);
  sdb.setItemStatus('ana', 'it1', 'active');
});

test('tomas: idempotentes por id, por fecha, y borrar devuelve la fila', () => {
  const l = { id: 'l1', itemId: 'it1', date: '2026-10-09', source: null, amount: 5, comidaId: null };
  sdb.addLog('ana', l);
  sdb.addLog('ana', l);
  sdb.addLog('ana', { id: 'l2', itemId: null, date: '2026-10-09', source: 'mate', amount: 80, comidaId: null });
  assert.equal(sdb.listLogs('ana', '2026-10-01').length, 2);
  assert.equal(sdb.listLogs('ana', '2026-10-10').length, 0);
  assert.equal(sdb.deleteLog('beto', 'l2'), null);
  assert.equal(sdb.deleteLog('ana', 'l2').source, 'mate');
});

test('perfil: aviso, mayoría de edad y recordatorios enviados', () => {
  assert.deepEqual(sdb.getProfile('ana'), { ackVersion: null, ackAt: null, adult: null, lastReminderSent: {} });
  sdb.setAck('ana', '2026-10-09', 1);
  sdb.markReminderSent('ana', 'it1', '2026-10-09');
  const p = sdb.getProfile('ana');
  assert.equal(p.ackVersion, '2026-10-09'); assert.equal(p.adult, 1); assert.deepEqual(p.lastReminderSent, { it1: '2026-10-09' });
  assert.deepEqual(sdb.itemsWithReminders().map(i => [i.userId, i.id]), [['ana', 'it1']]);
});

test('eliminar un item borra sus tomas; borrar datos de salud borra todo', () => {
  sdb.saveItem('ana', { ...item, id: 'it2', reminderTime: null });
  sdb.addLog('ana', { id: 'l3', itemId: 'it2', date: '2026-10-09', source: null, amount: 5, comidaId: null });
  assert.equal(sdb.deleteItem('ana', 'it2'), true);
  assert.equal(sdb.getLog('ana', 'l3'), null);
  db.deleteHealthData('ana', []);
  assert.equal(sdb.listItems('ana').length, 0);
  assert.equal(sdb.listLogs('ana', '2000-01-01').length, 0);
  assert.equal(sdb.getProfile('ana').ackVersion, null);
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `cd api && node --test supplements-db.test.js`
Expected: FAIL (`Cannot find module './supplements-db.js'`).

- [ ] **Step 3: Implementar `api/supplements-db.js`**

```js
// Suplementos en la base (docs/superpowers/specs/2026-10-09-suplementos-design.md): tablas y acceso
// a datos. Las reglas (fechas, validación, recordatorios) están en supplements.js. initDatabase
// (database.js) llama a migrateSupplements.
import { getDatabase } from './database.js';

export function migrateSupplements(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS supplement_items (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      catalog_id TEXT,
      name TEXT,
      dose REAL,
      unit TEXT,
      scoop_g REAL,
      doses_per_day INTEGER NOT NULL DEFAULT 1,
      slot TEXT NOT NULL DEFAULT 'any',
      days TEXT NOT NULL DEFAULT 'daily',
      reminder_time TEXT,
      meta TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_supp_items_user ON supplement_items(user_id);
    CREATE TABLE IF NOT EXISTS supplement_logs (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      item_id TEXT REFERENCES supplement_items(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      source TEXT,
      amount REAL,
      comida_id INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_supp_logs_user_date ON supplement_logs(user_id, date);
    CREATE TABLE IF NOT EXISTS supplement_profile (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      ack_version TEXT,
      ack_at TEXT,
      adult INTEGER,
      last_reminder_sent TEXT
    );
  `);
}

const parse = v => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
const itemFromRow = r => r && ({
  id: r.id, catalogId: r.catalog_id || null, name: r.name || null, dose: r.dose, unit: r.unit || null, scoopG: r.scoop_g ?? null,
  doses: r.doses_per_day, slot: r.slot, days: r.days, reminderTime: r.reminder_time || null, meta: parse(r.meta),
  status: r.status, createdAt: r.created_at, updatedAt: r.updated_at
});
const logFromRow = r => r && ({ id: r.id, itemId: r.item_id || null, date: r.date, source: r.source || null, amount: r.amount ?? 0, comidaId: r.comida_id ?? null, createdAt: r.created_at });
const nowIso = () => new Date().toISOString();

export const listItems = userId => getDatabase().prepare('SELECT * FROM supplement_items WHERE user_id = ? ORDER BY created_at, id').all(userId).map(itemFromRow);
export const getItem = (userId, id) => itemFromRow(getDatabase().prepare('SELECT * FROM supplement_items WHERE user_id = ? AND id = ?').get(userId, id)) || null;

export function saveItem(userId, item) {
  const db = getDatabase();
  const at = nowIso();
  const values = [item.catalogId || null, item.name || null, item.dose ?? null, item.unit || null, item.scoopG ?? null, item.doses || 1, item.slot || 'any', item.days || 'daily', item.reminderTime || null, item.meta ? JSON.stringify(item.meta) : null];
  const res = db.prepare(`UPDATE supplement_items SET catalog_id = ?, name = ?, dose = ?, unit = ?, scoop_g = ?, doses_per_day = ?, slot = ?, days = ?, reminder_time = ?, meta = ?, updated_at = ?
    WHERE id = ? AND user_id = ?`).run(...values, at, item.id, userId);
  if (!res.changes) {
    db.prepare(`INSERT INTO supplement_items (catalog_id, name, dose, unit, scoop_g, doses_per_day, slot, days, reminder_time, meta, updated_at, id, user_id, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`).run(...values, at, item.id, userId, at);
  }
  return getItem(userId, item.id);
}

export const setItemStatus = (userId, id, status) => getDatabase().prepare('UPDATE supplement_items SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?').run(status, nowIso(), id, userId).changes > 0;

export function deleteItem(userId, id) {
  const db = getDatabase();
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const r of db.prepare('SELECT comida_id FROM supplement_logs WHERE user_id = ? AND item_id = ? AND comida_id IS NOT NULL').all(userId, id)) {
      db.prepare('DELETE FROM comidas_registradas WHERE id = ? AND user_id = ?').run(r.comida_id, userId);
    }
    db.prepare('DELETE FROM supplement_logs WHERE user_id = ? AND item_id = ?').run(userId, id);
    const n = db.prepare('DELETE FROM supplement_items WHERE user_id = ? AND id = ?').run(userId, id).changes;
    db.exec('COMMIT');
    return n > 0;
  } catch (error) { try { db.exec('ROLLBACK'); } catch {} throw error; }
}

export const listLogs = (userId, fromDate) => getDatabase().prepare('SELECT * FROM supplement_logs WHERE user_id = ? AND date >= ? ORDER BY date, created_at, id').all(userId, fromDate).map(logFromRow);
export const getLog = (userId, id) => logFromRow(getDatabase().prepare('SELECT * FROM supplement_logs WHERE user_id = ? AND id = ?').get(userId, id)) || null;

export function addLog(userId, log) {
  const existing = getLog(userId, log.id);
  if (existing) return existing;
  getDatabase().prepare('INSERT INTO supplement_logs (id, user_id, item_id, date, source, amount, comida_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(log.id, userId, log.itemId || null, log.date, log.source || null, log.amount ?? 0, log.comidaId ?? null, nowIso());
  return getLog(userId, log.id);
}

export function deleteLog(userId, id) {
  const row = getLog(userId, id);
  if (!row) return null;
  const db = getDatabase();
  if (row.comidaId) db.prepare('DELETE FROM comidas_registradas WHERE id = ? AND user_id = ?').run(row.comidaId, userId);
  db.prepare('DELETE FROM supplement_logs WHERE user_id = ? AND id = ?').run(userId, id);
  return row;
}

export function getProfile(userId) {
  const r = getDatabase().prepare('SELECT * FROM supplement_profile WHERE user_id = ?').get(userId);
  return { ackVersion: r?.ack_version || null, ackAt: r?.ack_at || null, adult: r?.adult ?? null, lastReminderSent: parse(r?.last_reminder_sent) || {} };
}
const ensureProfile = userId => getDatabase().prepare('INSERT OR IGNORE INTO supplement_profile (user_id) VALUES (?)').run(userId);
export function setAck(userId, version, adult) {
  ensureProfile(userId);
  getDatabase().prepare('UPDATE supplement_profile SET ack_version = ?, ack_at = ?, adult = COALESCE(?, adult) WHERE user_id = ?').run(version, nowIso(), adult ?? null, userId);
}
export function markReminderSent(userId, itemId, date) {
  ensureProfile(userId);
  const sent = { ...getProfile(userId).lastReminderSent, [itemId]: date };
  getDatabase().prepare('UPDATE supplement_profile SET last_reminder_sent = ? WHERE user_id = ?').run(JSON.stringify(sent), userId);
}
export const itemsWithReminders = () => getDatabase()
  .prepare("SELECT * FROM supplement_items WHERE status = 'active' AND reminder_time IS NOT NULL ORDER BY user_id, created_at, id").all()
  .map(r => ({ ...itemFromRow(r), userId: r.user_id }));

// "Borrar mis datos de salud": todo lo de suplementos (las comidas de proteína las borra deleteHealthData).
export function deleteSupplementData(db, userId) {
  db.prepare('DELETE FROM supplement_logs WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM supplement_items WHERE user_id = ?').run(userId);
  db.prepare('DELETE FROM supplement_profile WHERE user_id = ?').run(userId);
}
```

- [ ] **Step 4: Conectar en `api/database.js`**

Junto a `import { migrateClasses } from './classes-db.js';`:

```js
import { migrateSupplements, deleteSupplementData } from './supplements-db.js';
```

Después de `migrateClasses(db);` en `initDatabase`:

```js
  migrateSupplements(db);
```

En `deleteHealthData`, dentro del `try`, después de borrar `plantillas_comida`:

```js
    deleteSupplementData(db, userId);
```

Y actualizar su comentario: "…metas y registros de nutrición, sus plantillas y los suplementos".

- [ ] **Step 5: Correr y ver que pasa**

Run: `cd api && node --test supplements-db.test.js database.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/supplements-db.js api/supplements-db.test.js api/database.js
git commit -m "feat(supplements): tables and data access, wiped with health data" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 4: Reglas del servidor (validación, fechas, comida de proteína, recordatorios)

**Files:**
- Create: `api/supplements.js`
- Create: `api/supplements.test.js`

**Interfaces:**
- Produces:
  - `SUPP_ACK_VERSION = '2026-10-09'` (mismo valor que el cliente)
  - `SLOTS`, `DAYS`, `UNITS`, `CAFFEINE_SOURCES` (ids), `CATALOG_IDS` (los seguibles del catálogo)
  - `validateItem(body): { value: Item } | { error: string }`
  - `validateLog(body, { today, item }): { value: Log } | { error: string }`
  - `logDateOk(date, today): boolean` (ventana del servidor: `today − 8 … today + 1`, por diferencia de zona horaria con el socio)
  - `proteinMeal({ item, amount, date, today, time }): { fecha, franja, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas }`
  - `reminderDue({ item, localDate, localTime, lastSent, taken, trainingDay }): boolean` (5 minutos de ventana)
  - `supplementsEnabled(value): boolean` (`value !== '0'`)

- [ ] **Step 1: Tests que fallan**

```js
// api/supplements.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateItem, validateLog, logDateOk, proteinMeal, reminderDue, supplementsEnabled } from './supplements.js';

const base = { id: 'a1b2c3d4', catalogId: 'creatina', dose: 5, unit: 'g', scoopG: 5, doses: 1, slot: 'morning', days: 'daily', reminderTime: '09:00' };

test('validateItem: valores conocidos, rangos y nombre en los propios', () => {
  assert.deepEqual(validateItem(base).value, { ...base, name: null, meta: null });
  assert.match(validateItem({ ...base, catalogId: 'quemadores' }).error, /no se puede seguir/);
  assert.ok(validateItem({ ...base, slot: 'siesta' }).error);
  assert.ok(validateItem({ ...base, days: 'a veces' }).error);
  assert.ok(validateItem({ ...base, doses: 9 }).error);
  assert.ok(validateItem({ ...base, dose: -1 }).error);
  assert.ok(validateItem({ ...base, reminderTime: '25:00' }).error);
  assert.ok(validateItem({ ...base, catalogId: null, name: '' }).error);
  assert.equal(validateItem({ ...base, catalogId: null, name: '  Ashwagandha ' }).value.name, 'Ashwagandha');
  assert.ok(validateItem({ ...base, id: 'x' }).error);
  assert.equal(validateItem({ ...base, catalogId: 'proteina', meta: { macros: { proteina: 24, calorias: 120, carbos: 3, grasas: 1.5 } } }).value.meta.macros.proteina, 24);
});

test('logDateOk: ventana con tolerancia de zona horaria', () => {
  assert.equal(logDateOk('2026-10-09', '2026-10-09'), true);
  assert.equal(logDateOk('2026-10-10', '2026-10-09'), true);
  assert.equal(logDateOk('2026-10-11', '2026-10-09'), false);
  assert.equal(logDateOk('2026-10-01', '2026-10-09'), true);
  assert.equal(logDateOk('2026-09-30', '2026-10-09'), false);
});

test('validateLog: toma de un item o fuente de cafeína', () => {
  const item = { id: 'it', catalogId: 'creatina' };
  assert.deepEqual(validateLog({ id: 'l1abcdef', itemId: 'it', date: '2026-10-09', amount: 5 }, { today: '2026-10-09', item }).value,
    { id: 'l1abcdef', itemId: 'it', date: '2026-10-09', source: null, amount: 5 });
  assert.equal(validateLog({ id: 'l2abcdef', source: 'mate', date: '2026-10-09', amount: 80 }, { today: '2026-10-09', item: null }).value.source, 'mate');
  assert.ok(validateLog({ id: 'l3abcdef', source: 'whisky', date: '2026-10-09', amount: 1 }, { today: '2026-10-09', item: null }).error);
  assert.ok(validateLog({ id: 'l4abcdef', itemId: 'it', date: '2026-10-20', amount: 5 }, { today: '2026-10-09', item }).error);
  assert.ok(validateLog({ id: 'l5abcdef', itemId: 'nope', date: '2026-10-09', amount: 5 }, { today: '2026-10-09', item: null }).error);
  assert.ok(validateLog({ id: 'l6abcdef', source: 'otro', date: '2026-10-09', amount: 5000 }, { today: '2026-10-09', item: null }).error);
});

test('proteinMeal: franja por hora y macros por scoop', () => {
  const item = { catalogId: 'proteina', scoopG: 30, meta: { macros: { proteina: 24, calorias: 120, carbos: 3, grasas: 1.5 } } };
  assert.deepEqual(proteinMeal({ item, amount: 60, date: '2026-10-09', today: '2026-10-09', time: '18:30' }),
    { fecha: '2026-10-09', franja: 'merienda', nombre_alimento: 'Proteína en polvo', cantidad_gramos: 60, calorias: 240, proteina: 48, carbohidratos: 6, grasas: 3 });
  assert.equal(proteinMeal({ item, amount: 30, date: '2026-10-08', today: '2026-10-09', time: '08:00' }).franja, 'extra');
  assert.equal(proteinMeal({ item: { catalogId: 'proteina', meta: null }, amount: 30, date: '2026-10-09', today: '2026-10-09', time: '07:00' }).proteina, 24);
});

test('reminderDue: a su hora (5 min), si toca, si falta y una vez por día', () => {
  const item = { id: 'it', reminderTime: '09:00', doses: 1, days: 'daily', status: 'active', createdAt: '2026-09-01T00:00:00Z' };
  const at = (localTime, extra = {}) => reminderDue({ item, localDate: '2026-10-09', localTime, lastSent: null, taken: 0, trainingDay: false, ...extra });
  assert.equal(at('08:59'), false);
  assert.equal(at('09:00'), true);
  assert.equal(at('09:04'), true);
  assert.equal(at('09:05'), false);
  assert.equal(at('09:01', { lastSent: '2026-10-09' }), false);
  assert.equal(at('09:01', { taken: 1 }), false);
  assert.equal(reminderDue({ item: { ...item, days: 'training' }, localDate: '2026-10-09', localTime: '09:00', lastSent: null, taken: 0, trainingDay: false }), false);
});

test('supplementsEnabled: prendido salvo "0"', () => {
  assert.equal(supplementsEnabled(null), true);
  assert.equal(supplementsEnabled('1'), true);
  assert.equal(supplementsEnabled('0'), false);
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `cd api && node --test supplements.test.js`
Expected: FAIL (no existe `./supplements.js`).

- [ ] **Step 3: Implementar**

```js
// api/supplements.js
// Reglas de suplementos del lado del servidor (docs/superpowers/specs/2026-10-09-suplementos-design.md):
// validación de items y tomas, ventana de fechas, la comida que crea una toma de proteína y cuándo
// toca un recordatorio. El catálogo con el contenido vive en el cliente (frontend/src/lib/suplementos-data.js);
// acá solo los ids seguibles.
import { addDays } from './classes.js';

export const SUPP_ACK_VERSION = '2026-10-09';
export const SLOTS = ['morning', 'pre', 'post', 'meals', 'night', 'any'];
export const DAYS = ['daily', 'training'];
export const UNITS = ['g', 'mg', 'ml', 'caps', 'ui', 'dosis'];
export const CAFFEINE_SOURCES = ['mate', 'cafe', 'espresso', 'energizante', 'preentreno', 'otro'];
export const CATALOG_IDS = ['creatina', 'cafeina', 'betaalanina', 'proteina', 'electrolitos', 'colageno', 'vitaminad', 'hierro', 'omega3', 'magnesio', 'multivitaminico'];
const ID = /^[A-Za-z0-9_-]{8,64}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v, max) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= max;

export const supplementsEnabled = value => value !== '0';

export function validateItem(b) {
  if (!b || typeof b !== 'object') return { error: 'Datos inválidos' };
  if (!ID.test(String(b.id || ''))) return { error: 'id inválido' };
  const catalogId = b.catalogId ?? null;
  if (catalogId !== null && !CATALOG_IDS.includes(catalogId)) return { error: 'Ese suplemento no se puede seguir' };
  const name = catalogId ? null : String(b.name || '').trim();
  if (!catalogId && (!name || name.length > 40)) return { error: 'Poné un nombre (máx. 40 caracteres)' };
  if (b.dose != null && !num(b.dose, 100000)) return { error: 'Dosis inválida' };
  if (b.unit != null && !UNITS.includes(b.unit)) return { error: 'Unidad inválida' };
  if (b.scoopG != null && !num(b.scoopG, 200)) return { error: 'Scoop inválido' };
  const doses = b.doses ?? 1;
  if (!Number.isInteger(doses) || doses < 1 || doses > 6) return { error: 'Las tomas van de 1 a 6' };
  if (!SLOTS.includes(b.slot || 'any')) return { error: 'Momento inválido' };
  if (!DAYS.includes(b.days || 'daily')) return { error: 'Días inválidos' };
  if (b.reminderTime != null && !HHMM.test(b.reminderTime)) return { error: 'Hora inválida' };
  let meta = null;
  if (b.meta != null) {
    const m = b.meta.macros, mg = b.meta.mgPerScoop;
    if (m && !['proteina', 'calorias', 'carbos', 'grasas'].every(k => num(m[k], 2000))) return { error: 'Valores por scoop inválidos' };
    if (mg != null && !num(mg, 1000)) return { error: 'mg por scoop inválidos' };
    meta = { ...(m ? { macros: { proteina: m.proteina, calorias: m.calorias, carbos: m.carbos, grasas: m.grasas } } : {}), ...(mg != null ? { mgPerScoop: mg } : {}) };
  }
  return { value: { id: b.id, catalogId, name, dose: b.dose ?? null, unit: b.unit ?? null, scoopG: b.scoopG ?? null, doses, slot: b.slot || 'any', days: b.days || 'daily', reminderTime: b.reminderTime ?? null, meta } };
}

export const logDateOk = (date, today) => DATE.test(date || '') && date <= addDays(today, 1) && date >= addDays(today, -8);

export function validateLog(b, { today, item }) {
  if (!b || typeof b !== 'object' || !ID.test(String(b.id || ''))) return { error: 'id inválido' };
  if (!logDateOk(b.date, today)) return { error: 'Solo hoy y hasta 7 días atrás' };
  const source = b.source ?? null;
  if (source === null) {
    if (!item || item.id !== b.itemId) return { error: 'Ese suplemento no existe' };
  } else if (!CAFFEINE_SOURCES.includes(source)) return { error: 'Fuente inválida' };
  if (!num(b.amount ?? 0, source ? 1000 : 100000)) return { error: 'Cantidad inválida' };
  return { value: { id: b.id, itemId: source ? null : b.itemId, date: b.date, source, amount: b.amount ?? 0 } };
}

const DEFAULT_SCOOP = 30, DEFAULT_MACROS = { proteina: 24, calorias: 120, carbos: 3, grasas: 1.5 };
const r1 = n => Math.round(n * 10) / 10;
const franjaOf = (date, today, time) => date !== today ? 'extra' : time < '11:00' ? 'desayuno' : time < '15:00' ? 'almuerzo' : time < '19:00' ? 'merienda' : 'cena';
export function proteinMeal({ item, amount, date, today, time }) {
  const scoop = item.scoopG > 0 ? item.scoopG : DEFAULT_SCOOP;
  const m = item.meta?.macros || DEFAULT_MACROS;
  const k = amount / scoop;
  return { fecha: date, franja: franjaOf(date, today, time), nombre_alimento: 'Proteína en polvo', cantidad_gramos: amount,
    calorias: r1(m.calorias * k), proteina: r1(m.proteina * k), carbohidratos: r1(m.carbos * k), grasas: r1(m.grasas * k) };
}

const minutes = hhmm => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export function reminderDue({ item, localDate, localTime, lastSent, taken, trainingDay }) {
  if (item.status !== 'active' || !item.reminderTime || lastSent === localDate) return false;
  if (localDate < String(item.createdAt || '').slice(0, 10)) return false;
  if (item.days === 'training' && !trainingDay) return false;
  if (taken >= Math.max(1, item.doses || 1)) return false;
  const diff = minutes(localTime) - minutes(item.reminderTime);
  return diff >= 0 && diff < 5;
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `cd api && node --test supplements.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/supplements.js api/supplements.test.js
git commit -m "feat(supplements): server validation, date window, protein meal and reminder rule" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 5: Rutas del socio y del owner

**Files:**
- Create: `api/supplements-routes.js`
- Create: `api/supplements.http.test.js`
- Modify: `api/server.js` (import; `MEMBERSHIP_GATED`; regex de `NUTRITION_ROUTES`; `/api/config`; registro con `...supplementRoutes({...})` junto a `...closureRoutes(...)`)

**Interfaces:**
- Consumes: Tarea 3 (`supplements-db.js`), Tarea 4 (`supplements.js`); de `database.js`: `getAdminSetting`, `setAdminSetting`, `getDatabase`, `getUserState`; de `billing.js`: `gymClock`, `getBillingSettings`.
- Produces:
  - `SUPPLEMENTS_SETTING = 'supplements_enabled'`, `supplementsOn(): boolean`
  - `supplementRoutes(d)` con `d = { json, readBody, readSession, requireOwner, audit }` y estas rutas:
    - `GET /api/supplements` → `200 { enabled, ackVersion, profile: { ackVersion, adult }, adult: 'adult'|'minor'|'unknown', today, items, logs }` (logs desde hoy − 400 días)
    - `POST /api/supplements/ack` `{ version, adult? }` → `200 { ok: true }` / `409 { error: 'ack_version_changed', version }`
    - `POST /api/supplements/items` (body = item) → `200 { item }`
    - `POST /api/supplements/items/archive` `{ id, archived }` → `200 { item }`
    - `POST /api/supplements/items/delete` `{ id }` → `200 { ok: true }`
    - `POST /api/supplements/log` (body = log) → `200 { log }` (proteína: crea la comida y devuelve `log.comidaId`)
    - `POST /api/supplements/log/delete` `{ id }` → `200 { ok: true }`
    - `GET /api/owner/supplements` → `200 { enabled }`; `PUT /api/owner/supplements` `{ enabled }` → `200 { enabled }` (auditoría `owner.supplements.enabled` / `.disabled`)
  - Errores comunes de las rutas del socio: `401` sin sesión; `404 { error: 'supplements_off' }` apagado; `409 { error: 'supplements_ack_required' }` escritura sin aviso aceptado (salvo `ack`); `403 { error: 'supplements_minor' }` escritura de menor (salvo `ack`); `400 { error }` validación. El gate global ya responde `403 health_consent_required`, `account_pending` y `membership_blocked`.
  - `writeGuard(user): null | [status, body]` exportada (la usa `sync.js` en la Tarea 6).
  - `sendSupplementReminders({ send, nowMs })` (la usa la Tarea 7).

- [ ] **Step 1: Test HTTP que falla**

Mismo arnés que `api/classes-member.http.test.js` (puertos `52000–52900`). Escenario:

```js
// api/supplements.http.test.js
// Suplementos sobre server.js de verdad: apagado por el owner, aviso obligatorio, menores, ventana de
// fechas, proteína como comida, aislamiento por usuario y sin consentimiento de salud. Puertos 52000–52900.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gymToday } from './billing.js';
import { addDays } from './classes.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-supp-http-'));
const SECRET = crypto.randomBytes(32).toString('hex');
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET);
process.env.DATA_DIR = dataDir;
const today = gymToday(Date.now(), 'America/Argentina/Buenos_Aires');
const db = await import('./database.js');
db.initDatabase();
db.createUser({ id: 'owner', name: 'Dueña', created: Date.now() });
for (const id of ['ana', 'beto', 'nene']) db.createUser({ id, name: id, created: Date.now(), healthConsent: true });
db.createUser({ id: 'nosalud', name: 'nosalud', created: Date.now(), healthConsent: false });
db.getDatabase().prepare('INSERT OR IGNORE INTO user_state (user_id, _ts) VALUES (?, ?)').run('nene', Date.now());
db.getDatabase().prepare('UPDATE user_state SET edad = 15 WHERE user_id = ?').run('nene');
db.closeDatabase();

const PORT = 52000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
let server;
const cookie = uid => { const payload = `${uid}:${Date.now() + 3600000}:0`; return 'gymsid=' + payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url'); };
async function call(uid, method, url, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (uid) headers.Cookie = cookie(uid);
  const res = await fetch(BASE + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
}
before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL('./server.js', import.meta.url))], {
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), LICENSE_EXPIRES_AT: '', LICENSE_PAID_UNTIL: '', ADMIN_UIDS: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let log = '';
  server.stderr.on('data', d => { log += d; });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('el server no arrancó:\n' + log)), 15000);
    server.stdout.on('data', d => { if (String(d).includes('gym-api on')) { clearTimeout(timer); resolve(); } });
    server.on('exit', code => reject(new Error(`el server terminó (${code}):\n${log}`)));
  });
});
after(async () => {
  if (server && server.exitCode === null) await new Promise(resolve => { server.once('exit', resolve); server.kill(); });
  fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const creatina = { id: 'crea0001', catalogId: 'creatina', dose: 5, unit: 'g', scoopG: 5, doses: 1, slot: 'morning', days: 'daily', reminderTime: '09:00' };

test('sin sesión 401; sin consentimiento de salud 403; /api/config lo informa', async () => {
  assert.equal((await call(null, 'GET', '/api/supplements')).status, 401);
  assert.equal((await call('nosalud', 'GET', '/api/supplements')).body.error, 'health_consent_required');
  assert.equal((await call(null, 'GET', '/api/config')).body.supplements_enabled, true);
});

test('el aviso es obligatorio para escribir y vale solo la versión vigente', async () => {
  const first = (await call('ana', 'GET', '/api/supplements')).body;
  assert.deepEqual([first.enabled, first.profile.ackVersion, first.adult, first.items, first.logs], [true, null, 'unknown', [], []]);
  assert.equal((await call('ana', 'POST', '/api/supplements/items', creatina)).body.error, 'supplements_ack_required');
  assert.equal((await call('ana', 'POST', '/api/supplements/ack', { version: '2000-01-01' })).status, 409);
  assert.equal((await call('ana', 'POST', '/api/supplements/ack', { version: first.ackVersion, adult: true })).status, 200);
  assert.equal((await call('ana', 'GET', '/api/supplements')).body.adult, 'adult');
});

test('menor: puede aceptar el aviso pero no seguir suplementos', async () => {
  const v = (await call('nene', 'GET', '/api/supplements')).body.ackVersion;
  await call('nene', 'POST', '/api/supplements/ack', { version: v, adult: true });
  assert.equal((await call('nene', 'GET', '/api/supplements')).body.adult, 'minor');
  assert.equal((await call('nene', 'POST', '/api/supplements/items', { ...creatina, id: 'crea0002' })).body.error, 'supplements_minor');
});

test('items y tomas: alta, ventana de fechas, aislamiento y archivo', async () => {
  assert.equal((await call('ana', 'POST', '/api/supplements/items', creatina)).body.item.dose, 5);
  assert.equal((await call('ana', 'POST', '/api/supplements/log', { id: 'log00001', itemId: 'crea0001', date: today, amount: 5 })).status, 200);
  assert.equal((await call('ana', 'POST', '/api/supplements/log', { id: 'log00002', itemId: 'crea0001', date: addDays(today, 3), amount: 5 })).status, 400);
  assert.equal((await call('ana', 'POST', '/api/supplements/log', { id: 'log00003', source: 'mate', date: today, amount: 80 })).status, 200);
  const mine = (await call('ana', 'GET', '/api/supplements')).body;
  assert.equal(mine.logs.length, 2);
  assert.equal((await call('beto', 'GET', '/api/supplements')).body.items.length, 0);
  const v = mine.ackVersion;
  await call('beto', 'POST', '/api/supplements/ack', { version: v, adult: true });
  assert.equal((await call('beto', 'POST', '/api/supplements/log/delete', { id: 'log00001' })).status, 404);
  assert.equal((await call('ana', 'POST', '/api/supplements/items/archive', { id: 'crea0001', archived: true })).body.item.status, 'archived');
  assert.equal((await call('ana', 'POST', '/api/supplements/log/delete', { id: 'log00003' })).status, 200);
});

test('proteína: la toma crea la comida y borrarla la saca', async () => {
  const prot = { id: 'prot0001', catalogId: 'proteina', dose: 30, unit: 'g', scoopG: 30, doses: 1, slot: 'post', days: 'daily', meta: { macros: { proteina: 24, calorias: 120, carbos: 3, grasas: 1.5 } } };
  await call('ana', 'POST', '/api/supplements/items', prot);
  const log = (await call('ana', 'POST', '/api/supplements/log', { id: 'plog0001', itemId: 'prot0001', date: today, amount: 30 })).body.log;
  assert.ok(log.comidaId);
  const meals = (await call('ana', 'GET', `/api/comidas?fecha=${today}`)).body;
  assert.equal(meals.find(m => m.id === log.comidaId).proteina, 24);
  await call('ana', 'POST', '/api/supplements/log/delete', { id: 'plog0001' });
  assert.equal((await call('ana', 'GET', `/api/comidas?fecha=${today}`)).body.some(m => m.id === log.comidaId), false);
});

test('el owner lo apaga: 404 para el socio y la config lo dice; se vuelve a prender', async () => {
  assert.equal((await call('ana', 'PUT', '/api/owner/supplements', { enabled: false })).status, 403);
  assert.deepEqual((await call('owner', 'PUT', '/api/owner/supplements', { enabled: false })).body, { enabled: false });
  assert.equal((await call('ana', 'GET', '/api/supplements')).status, 404);
  assert.equal((await call(null, 'GET', '/api/config')).body.supplements_enabled, false);
  assert.deepEqual((await call('owner', 'GET', '/api/owner/supplements')).body, { enabled: false });
  await call('owner', 'PUT', '/api/owner/supplements', { enabled: true });
  assert.equal((await call('ana', 'GET', '/api/supplements')).status, 200);
});
```

Nota: si `createUser` no acepta `healthConsent: true`, ver su firma en `api/database.js` (línea ~439: `user.healthConsent === true ? 'granted'`); el campo es ese.

- [ ] **Step 2: Correr y ver que falla**

Run: `cd api && node --test supplements.http.test.js`
Expected: FAIL (404 en `/api/supplements`).

- [ ] **Step 3: Implementar `api/supplements-routes.js`**

```js
// Rutas de suplementos (docs/superpowers/specs/2026-10-09-suplementos-design.md). server.js las suma con
// supplementRoutes({ ... }); el scheduler usa sendSupplementReminders y sync.js usa writeGuard. La
// lógica está en supplements.js y los datos en supplements-db.js. El staff no ve nada de esto.
import * as sdb from './supplements-db.js';
import { SUPP_ACK_VERSION, validateItem, validateLog, proteinMeal, reminderDue, supplementsEnabled } from './supplements.js';
import { getAdminSetting, setAdminSetting, getDatabase, getUserState } from './database.js';
import { gymClock, getBillingSettings } from './billing.js';
import { addDays } from './classes.js';
import { supplementReminderPush } from './push-messages.js';

export const SUPPLEMENTS_SETTING = 'supplements_enabled';
export const supplementsOn = () => supplementsEnabled(getAdminSetting(SUPPLEMENTS_SETTING));
const gymTz = () => getBillingSettings(getDatabase()).gym_tz;
const clock = (ms = Date.now(), tz = gymTz()) => gymClock(ms, tz);
const edadOf = userId => getDatabase().prepare('SELECT edad FROM user_state WHERE user_id = ?').get(userId)?.edad ?? null;
export function adultOf(userId) {
  const edad = Number(edadOf(userId));
  if (edad > 0) return edad >= 18 ? 'adult' : 'minor';
  const a = sdb.getProfile(userId).adult;
  return a === 1 ? 'adult' : a === 0 ? 'minor' : 'unknown';
}
// Escritura permitida: módulo prendido, aviso vigente aceptado y no es menor. → null o [status, body].
export function writeGuard(user) {
  if (!supplementsOn()) return [404, { error: 'supplements_off' }];
  if (sdb.getProfile(user.id).ackVersion !== SUPP_ACK_VERSION) return [409, { error: 'supplements_ack_required' }];
  if (adultOf(user.id) === 'minor') return [403, { error: 'supplements_minor' }];
  return null;
}

// Toma de un item o fuente de cafeína, con la comida si es proteína. La usa también sync.js.
export function applyLog(userId, body) {
  const now = clock();
  const item = body?.itemId ? sdb.getItem(userId, String(body.itemId)) : null;
  const v = validateLog(body, { today: now.date, item });
  if (v.error) return { error: v.error };
  const existing = sdb.getLog(userId, v.value.id);
  if (existing) return { log: existing };
  let comidaId = null;
  if (item?.catalogId === 'proteina' && v.value.amount > 0) {
    const m = proteinMeal({ item, amount: v.value.amount, date: v.value.date, today: now.date, time: now.time });
    comidaId = Number(getDatabase().prepare(`INSERT INTO comidas_registradas (user_id, fecha, franja, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(userId, m.fecha, m.franja, m.nombre_alimento, m.cantidad_gramos, m.calorias, m.proteina, m.carbohidratos, m.grasas).lastInsertRowid);
  }
  return { log: sdb.addLog(userId, { ...v.value, comidaId }) };
}

export function supplementRoutes(d) {
  const { json, readBody } = d;
  const member = (req, res) => {
    const user = d.readSession(req);
    if (!user) { json(res, 401, { error: 'No has iniciado sesión' }); return null; }
    if (!supplementsOn()) { json(res, 404, { error: 'supplements_off' }); return null; }
    return user;
  };
  const writer = (req, res) => {
    const user = member(req, res); if (!user) return null;
    const g = writeGuard(user);
    if (g) { json(res, g[0], g[1]); return null; }
    return user;
  };
  return {
    'GET /api/supplements': async (req, res) => {
      const user = member(req, res); if (!user) return;
      const today = clock().date;
      const p = sdb.getProfile(user.id);
      json(res, 200, { enabled: true, ackVersion: SUPP_ACK_VERSION, profile: { ackVersion: p.ackVersion, adult: p.adult }, adult: adultOf(user.id), today,
        items: sdb.listItems(user.id), logs: sdb.listLogs(user.id, addDays(today, -400)) });
    },
    'POST /api/supplements/ack': async (req, res) => {
      const user = member(req, res); if (!user) return;
      const body = await readBody(req);
      if (body.version !== SUPP_ACK_VERSION) return json(res, 409, { error: 'ack_version_changed', version: SUPP_ACK_VERSION });
      sdb.setAck(user.id, SUPP_ACK_VERSION, typeof body.adult === 'boolean' ? (body.adult ? 1 : 0) : null);
      json(res, 200, { ok: true });
    },
    'POST /api/supplements/items': async (req, res) => {
      const user = writer(req, res); if (!user) return;
      const v = validateItem(await readBody(req));
      if (v.error) return json(res, 400, { error: v.error });
      json(res, 200, { item: sdb.saveItem(user.id, v.value) });
    },
    'POST /api/supplements/items/archive': async (req, res) => {
      const user = writer(req, res); if (!user) return;
      const body = await readBody(req);
      if (!sdb.setItemStatus(user.id, String(body.id || ''), body.archived ? 'archived' : 'active')) return json(res, 404, { error: 'not_found' });
      json(res, 200, { item: sdb.getItem(user.id, String(body.id)) });
    },
    'POST /api/supplements/items/delete': async (req, res) => {
      const user = writer(req, res); if (!user) return;
      const body = await readBody(req);
      if (!sdb.deleteItem(user.id, String(body.id || ''))) return json(res, 404, { error: 'not_found' });
      json(res, 200, { ok: true });
    },
    'POST /api/supplements/log': async (req, res) => {
      const user = writer(req, res); if (!user) return;
      const out = applyLog(user.id, await readBody(req));
      if (out.error) return json(res, 400, { error: out.error });
      json(res, 200, { log: out.log });
    },
    'POST /api/supplements/log/delete': async (req, res) => {
      const user = writer(req, res); if (!user) return;
      const body = await readBody(req);
      if (!sdb.deleteLog(user.id, String(body.id || ''))) return json(res, 404, { error: 'not_found' });
      json(res, 200, { ok: true });
    },
    'GET /api/owner/supplements': async (req, res) => {
      const owner = d.requireOwner(req, res); if (!owner) return;
      json(res, 200, { enabled: supplementsOn() });
    },
    'PUT /api/owner/supplements': async (req, res) => {
      const owner = d.requireOwner(req, res); if (!owner) return;
      const body = await readBody(req);
      if (typeof body.enabled !== 'boolean') return json(res, 400, { error: 'enabled debe ser true o false' });
      setAdminSetting(SUPPLEMENTS_SETTING, body.enabled ? '1' : '0');
      d.audit(req, body.enabled ? 'owner.supplements.enabled' : 'owner.supplements.disabled', { user: owner });
      json(res, 200, { enabled: body.enabled });
    },
  };
}

// Recordatorios: por item con hora, en la zona del socio (reminder_settings.tz o la del gimnasio),
// solo si toca, falta tomarlo y no se mandó hoy. Socios sin consentimiento, sin aviso, menores o
// desactivados no reciben nada. sendSupplementReminders es sincrónica: `send` no se espera.
export function sendSupplementReminders({ send, nowMs = Date.now() }) {
  if (!supplementsOn()) return;
  const db = getDatabase();
  const byUser = new Map();
  for (const item of sdb.itemsWithReminders()) (byUser.get(item.userId) || byUser.set(item.userId, []).get(item.userId)).push(item);
  for (const [userId, items] of byUser) {
    const u = db.prepare('SELECT u.disabled, u.health_consent, rs.tz FROM users u LEFT JOIN reminder_settings rs ON rs.user_id = u.id WHERE u.id = ?').get(userId);
    if (!u || u.disabled || u.health_consent === 'declined') continue;
    if (writeGuard({ id: userId })) continue;
    const local = clock(nowMs, u.tz || gymTz());
    const profile = sdb.getProfile(userId);
    const logs = sdb.listLogs(userId, local.date).filter(l => l.date === local.date);
    let state = null;
    for (const item of items) {
      const taken = logs.filter(l => l.itemId === item.id).length;
      let trainingDay = false;
      if (item.days === 'training') {
        state = state || getUserState(userId) || {};
        trainingDay = isTrainingDay(state, local.date);
      }
      if (!reminderDue({ item, localDate: local.date, localTime: local.time, lastSent: profile.lastReminderSent[item.id] || null, taken, trainingDay })) continue;
      sdb.markReminderSent(userId, item.id, local.date);
      send(userId, supplementReminderPush({ name: item.name, catalogId: item.catalogId, dose: item.dose, unit: item.unit, doses: item.doses }));
    }
  }
}

// Igual que el cliente (frontend/src/lib/suplementos.js, isTrainingDay): rutina del plan o un workout ese día.
function isTrainingDay(state, date) {
  const ov = state?.dayPlan?.[date];
  if (ov === 'rest' || (ov && typeof ov === 'object' && ['descanso', 'completado'].includes(ov.estado))) return (state.workouts || []).some(w => w.d === date);
  const planned = (ov && typeof ov === 'object' && ov.estado === 'rutina' && ov.rutinaId) || (typeof ov === 'string' && ov)
    || state?.week?.[new Date(`${date}T12:00:00`).getDay()] || null;
  return !!planned || (state?.workouts || []).some(w => w.d === date);
}
```

`supplementReminderPush` se crea en la Tarea 7; para que este archivo importe en esta tarea, agregarla ya en `api/push-messages.js` con el texto final:

```js
// Recordatorio de un suplemento: "Creatina: te falta la de hoy" / "5 g. Tocá para marcarla."
const SUPP_NAMES = { creatina: 'Creatina', cafeina: 'Cafeína', betaalanina: 'Beta-alanina', proteina: 'Proteína', electrolitos: 'Electrolitos', colageno: 'Colágeno', vitaminad: 'Vitamina D', hierro: 'Hierro', omega3: 'Omega-3', magnesio: 'Magnesio', multivitaminico: 'Multivitamínico' };
const SUPP_UNITS = { g: 'g', mg: 'mg', ml: 'ml', caps: 'cápsulas', ui: 'UI', dosis: 'dosis' };
export function supplementReminderPush({ name, catalogId, dose, unit, doses }) {
  const label = SUPP_NAMES[catalogId] || name || 'Suplemento';
  const per = dose > 0 ? `${Math.round((dose / Math.max(1, doses || 1)) * 100) / 100} ${SUPP_UNITS[unit] || unit || ''}`.trim().replace('.', ',') + '. ' : '';
  return { title: `${label}: te falta la de hoy`, body: `${per}Tocá para marcarla.`, tag: `supp-${catalogId || 'propio'}`, data: { redirectUrl: '/#/nutricion' } };
}
```

- [ ] **Step 4: Conectar en `api/server.js`**

1. Import, junto a `import { closureRoutes, ... } from './closures-routes.js';`:

```js
import { supplementRoutes, supplementsOn } from './supplements-routes.js';
```

2. En `MEMBERSHIP_GATED`, agregar una línea:

```js
  'GET /api/supplements', 'POST /api/supplements/ack', 'POST /api/supplements/items', 'POST /api/supplements/items/archive',
  'POST /api/supplements/items/delete', 'POST /api/supplements/log', 'POST /api/supplements/log/delete',
```

3. `NUTRITION_ROUTES`: cambiar la regex a `/alimentos|comidas|plantillas|nutrition|supplements/` (así el gate devuelve `health_consent_required`).

4. En `'GET /api/config'`, después de `owner_transfer_enabled`:

```js
      ,
      // Suplementos (interruptor del owner): sin él, Nutrición no muestra la tarjeta ni la guía.
      supplements_enabled: supplementsOn()
```

(dejar la coma en la línea anterior, no al principio).

5. En la tabla de rutas, después de `...closureRoutes(...)`:

```js
  // Suplementos (supplements-routes.js).
  ...supplementRoutes({ json, readBody, readSession, requireOwner, audit }),
```

- [ ] **Step 5: Correr y ver que pasa**

Run: `cd api && node --test supplements.http.test.js route-permissions.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add api/supplements-routes.js api/supplements.http.test.js api/server.js api/push-messages.js
git commit -m "feat(supplements): member and owner routes behind consent, notice and owner switch" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 6: Tomas sin conexión por `/api/data/sync`

**Files:**
- Modify: `api/sync.js` (`applyRequest`)
- Create: `api/supplements-sync.test.js`

**Interfaces:**
- Consumes: `applyLog`, `writeGuard` (Tarea 5); `sdb.deleteLog` (Tarea 3).
- Produces: pedidos `{ kind: 'supp-log-add', payload: Log }` → `{ log }` y `{ kind: 'supp-log-delete', payload: { id } }` → `{ deleted: id }`. Un pedido no permitido o inválido tira `Error` (queda como conflicto, igual que una comida inválida).

- [ ] **Step 1: Test que falla**

```js
// api/supplements-sync.test.js
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-supp-sync-'));
process.env.DATA_DIR = dataDir;
const db = await import('./database.js');
const sdb = await import('./supplements-db.js');
const { processSyncBatch } = await import('./sync.js');
const { SUPP_ACK_VERSION } = await import('./supplements.js');
const { gymToday } = await import('./billing.js');
db.initDatabase();
after(() => { db.closeDatabase(); fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
db.createUser({ id: 'ana', name: 'ana', created: Date.now(), healthConsent: true });
const today = gymToday(Date.now(), 'America/Argentina/Buenos_Aires');
const run = ops => processSyncBatch({ db: db.getDatabase(), userId: 'ana', operations: ops, getUserState: db.getUserState, saveUserState: db.saveUserState });
const op = (id, request) => ({ id, createdAt: Date.now(), changes: [{ request: { ...request, opId: id } }] });

test('sin aviso aceptado el pedido es conflicto; con aviso se aplica una sola vez', () => {
  sdb.saveItem('ana', { id: 'crea0001', catalogId: 'creatina', dose: 5, unit: 'g', doses: 1 });
  const add = { kind: 'supp-log-add', payload: { id: 'log00001', itemId: 'crea0001', date: today, amount: 5 } };
  assert.equal(run([op('op000001', add)]).conflicts.length, 1);
  sdb.setAck('ana', SUPP_ACK_VERSION, 1);
  assert.equal(run([op('op000002', add)]).conflicts.length, 0);
  assert.equal(run([op('op000003', add)]).conflicts.length, 0);   // idempotente por id
  assert.equal(sdb.listLogs('ana', today).length, 1);
  assert.equal(run([op('op000004', { kind: 'supp-log-delete', payload: { id: 'log00001' } })]).conflicts.length, 0);
  assert.equal(sdb.listLogs('ana', today).length, 0);
});
```

- [ ] **Step 2: Correr y ver que falla**

Run: `cd api && node --test supplements-sync.test.js`
Expected: FAIL (el segundo `run` devuelve conflicto `unsupported sync operation`).

- [ ] **Step 3: Implementar en `api/sync.js`**

Import arriba:

```js
import { applyLog, writeGuard } from './supplements-routes.js';
import { deleteLog } from './supplements-db.js';
```

En `applyRequest`, antes de `throw new Error('unsupported sync operation');`:

```js
  if (request.kind === 'supp-log-add' || request.kind === 'supp-log-delete') {
    const guard = writeGuard({ id: userId });
    if (guard) throw new Error(guard[1].error);
    if (request.kind === 'supp-log-delete') { deleteLog(userId, String(p.id || '')); return { deleted: p.id }; }
    const out = applyLog(userId, p);
    if (out.error) throw new Error('invalid supplement log');
    return { log: out.log };
  }
```

Nota: `applyRequest` corre dentro de la transacción de `processSyncBatch`; `applyLog` usa la misma conexión (`getDatabase()`), así que entra en esa transacción.

- [ ] **Step 4: Correr y ver que pasa**

Run: `cd api && node --test supplements-sync.test.js sync.test.js sync.integration.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/sync.js api/supplements-sync.test.js
git commit -m "feat(supplements): offline intakes through the sync queue" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 7: Recordatorios en el scheduler

**Files:**
- Modify: `api/scheduler.js`
- Create: `api/scheduler-supplements.test.js`
- Modify: `api/push-messages.test.js` (texto del aviso)

**Interfaces:**
- Consumes: `sendSupplementReminders({ send, nowMs })` y `supplementReminderPush` (Tarea 5).

- [ ] **Step 1: Tests que fallan**

```js
// api/scheduler-supplements.test.js
// Recordatorios de suplementos en el tick: a su hora, si falta tomarlo, una vez por día, nunca con el
// módulo apagado, sin aviso aceptado ni a quien sacó el consentimiento.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lauyim-scheduler-supp-'));
process.env.DATA_DIR = dataDir;
const db = await import('./database.js');
const sdb = await import('./supplements-db.js');
const { runSchedulerTick } = await import('./scheduler.js');
const { SUPP_ACK_VERSION } = await import('./supplements.js');
const { gymClock, getBillingSettings } = await import('./billing.js');
db.initDatabase();
after(() => { db.closeDatabase(); fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

for (const id of ['ana', 'beto']) {
  db.createUser({ id, name: id, created: Date.now(), healthConsent: true });
  db.getDatabase().prepare('INSERT INTO subscriptions (endpoint, user_id, keys, created_at) VALUES (?, ?, ?, ?)').run('https://push/' + id, id, '{}', Date.now());
  sdb.setAck(id, SUPP_ACK_VERSION, 1);
}
const tz = getBillingSettings(db.getDatabase()).gym_tz;
// Un instante del día de hoy en la zona del gimnasio a la hora HH:MM.
function at(hhmm) {
  const now = Date.now();
  const local = gymClock(now, tz);
  const diffMin = (Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3))) - (Number(local.time.slice(0, 2)) * 60 + Number(local.time.slice(3)));
  return now + diffMin * 60000;
}
const today = gymClock(Date.now(), tz).date;
sdb.saveItem('ana', { id: 'crea0001', catalogId: 'creatina', dose: 5, unit: 'g', doses: 1, slot: 'morning', days: 'daily', reminderTime: '09:00' });
sdb.saveItem('beto', { id: 'crea0002', catalogId: 'creatina', dose: 5, unit: 'g', doses: 1, slot: 'morning', days: 'daily', reminderTime: '09:00' });
// Las fechas de alta: ayer, así hoy ya toca.
db.getDatabase().prepare("UPDATE supplement_items SET created_at = '2000-01-01T00:00:00Z'").run();
sdb.addLog('beto', { id: 'blog0001', itemId: 'crea0002', date: today, amount: 5 });

async function tick(now) {
  const sent = [];
  runSchedulerTick({ now, sendToUser: async (userId, payload) => { sent.push({ userId, payload }); return { sent: 1 }; } });
  await new Promise(r => setTimeout(r, 50));
  return sent.filter(s => s.payload.tag?.startsWith('supp-'));
}

test('a su hora, solo a quien le falta, una vez por día', async () => {
  assert.deepEqual(await tick(at('08:58')), []);
  const first = await tick(at('09:01'));
  assert.deepEqual(first.map(s => s.userId), ['ana']);
  assert.match(first[0].payload.title, /Creatina: te falta la de hoy/);
  assert.deepEqual(await tick(at('09:02')), []);
});

test('apagado por el owner o sin consentimiento: nada', async () => {
  db.getDatabase().prepare("DELETE FROM supplement_profile WHERE user_id = 'ana'").run();
  sdb.setAck('ana', SUPP_ACK_VERSION, 1);
  db.setAdminSetting('supplements_enabled', '0');
  assert.deepEqual(await tick(at('09:00')), []);
  db.setAdminSetting('supplements_enabled', '1');
  db.getDatabase().prepare("UPDATE users SET health_consent = 'declined' WHERE id = 'ana'").run();
  assert.deepEqual(await tick(at('09:00')), []);
});
```

Agregar en `api/push-messages.test.js`:

```js
test('supplementReminderPush: nombre del catálogo, dosis por toma y abre Nutrición', () => {
  const p = supplementReminderPush({ catalogId: 'betaalanina', dose: 3.2, unit: 'g', doses: 2 });
  assert.equal(p.title, 'Beta-alanina: te falta la de hoy');
  assert.equal(p.body, '1,6 g. Tocá para marcarla.');
  assert.equal(p.data.redirectUrl, '/#/nutricion');
  assert.equal(supplementReminderPush({ catalogId: null, name: 'Ashwagandha', dose: null }).title, 'Ashwagandha: te falta la de hoy');
});
```

(y sumar `supplementReminderPush` al import de ese archivo).

- [ ] **Step 2: Correr y ver que falla**

Run: `cd api && node --test scheduler-supplements.test.js push-messages.test.js`
Expected: FAIL en el scheduler (el tick no manda nada todavía). El de push-messages ya pasa por la Tarea 5.

- [ ] **Step 3: Implementar en `api/scheduler.js`**

Import:

```js
import { sendSupplementReminders } from './supplements-routes.js';
```

Al final de `runSchedulerTick`, después del bloque de cierres:

```js
  // Suplementos: el recordatorio de cada uno, a su hora, si todavía no se tomó.
  try {
    sendSupplementReminders({
      nowMs: now,
      send: (userId, payload) => { sendToUser(userId, payload).catch(err => console.error(`[Scheduler] Error al enviar recordatorio de suplemento a user_id=${userId}:`, err)); }
    });
  } catch (err) {
    console.error('[Scheduler] Error en suplementos:', err);
  }
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `cd api && node --test scheduler-supplements.test.js scheduler.test.js push-messages.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/scheduler.js api/scheduler-supplements.test.js api/push-messages.test.js
git commit -m "feat(supplements): daily push reminder per supplement" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 8: Estado del cliente (`useSupplements`)

**Files:**
- Create: `frontend/src/store/useSupplements.js`
- Create: `frontend/src/store/useSupplements.test.js`

**Interfaces:**
- Consumes: `api` de `../lib/api.js`; `enqueueRequest`, `shouldQueueOffline` de `../lib/sync-queue.js`; `useStore` (`user`).
- Produces:
  - `useSupplements` (zustand) con estado `{ loaded: boolean, enabled: boolean, ackVersion: string|null, profile: { ackVersion, adult }, adult: 'adult'|'minor'|'unknown', today: string|null, items: Item[], logs: Log[] }`
  - `loadSupplements(): Promise<void>`
  - `acceptNotice({ adult?: boolean }): Promise<void>`
  - `saveItem(item): Promise<Item>` (online; error con mensaje)
  - `archiveItem(id, archived): Promise<void>`, `deleteItem(id): Promise<void>`
  - `addLog({ itemId?, source?, date, amount }): Promise<Log>` (optimista; sin conexión → `enqueueRequest(user, { kind: 'supp-log-add', payload })`)
  - `removeLog(id): Promise<void>` (optimista; sin conexión → `supp-log-delete`)
  - `newId(): string` (8+ caracteres `[A-Za-z0-9_-]`)
  - `noticeAccepted(state): boolean` (= `state.profile.ackVersion === state.ackVersion`)
  - Caché: `localStorage['lauyim_supps']` = `{ userId, data }`, leída al crear el store si es del mismo usuario.

- [ ] **Step 1: Tests que fallan**

```js
// frontend/src/store/useSupplements.test.js
// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
const enqueueMock = vi.hoisted(() => vi.fn(async () => ({ id: 'q', opId: 'o' })))
vi.mock('../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))
vi.mock('../lib/sync-queue.js', async importOriginal => ({ ...(await importOriginal()), enqueueRequest: enqueueMock }))

const { useStore } = await import('./useStore.js')
const { useSupplements, loadSupplements, addLog, removeLog, acceptNotice, noticeAccepted } = await import('./useSupplements.js')

const server = { enabled: true, ackVersion: '2026-10-09', profile: { ackVersion: null, adult: null }, adult: 'unknown', today: '2026-10-09', items: [], logs: [] }
beforeEach(() => {
  apiMock.mockReset(); enqueueMock.mockClear(); localStorage.clear()
  useStore.setState({ user: { id: 'ana' } })
  useSupplements.setState({ loaded: false, enabled: false, ackVersion: null, profile: { ackVersion: null, adult: null }, adult: 'unknown', today: null, items: [], logs: [] })
})
afterEach(() => vi.useRealTimers())

describe('useSupplements', () => {
  it('carga del servidor y guarda en caché por usuario', async () => {
    apiMock.mockResolvedValue(server)
    await loadSupplements()
    expect(useSupplements.getState()).toMatchObject({ loaded: true, enabled: true, today: '2026-10-09' })
    expect(JSON.parse(localStorage.getItem('lauyim_supps')).userId).toBe('ana')
  })
  it('apagado: 404 supplements_off deja enabled en false', async () => {
    apiMock.mockRejectedValue(Object.assign(new Error('supplements_off'), { status: 404, data: { error: 'supplements_off' } }))
    await loadSupplements()
    expect(useSupplements.getState()).toMatchObject({ loaded: true, enabled: false })
  })
  it('aceptar el aviso lo marca como aceptado', async () => {
    useSupplements.setState({ ...server, loaded: true })
    apiMock.mockResolvedValue({ ok: true })
    await acceptNotice({ adult: true })
    expect(apiMock).toHaveBeenCalledWith('/api/supplements/ack', { method: 'POST', body: JSON.stringify({ version: '2026-10-09', adult: true }) })
    expect(noticeAccepted(useSupplements.getState())).toBe(true)
  })
  it('toma: optimista y, sin conexión, a la cola', async () => {
    useSupplements.setState({ ...server, loaded: true })
    apiMock.mockRejectedValue(Object.assign(new Error('Sin conexión'), { code: 'network_error' }))
    const log = await addLog({ source: 'mate', date: '2026-10-09', amount: 80 })
    expect(useSupplements.getState().logs.map(l => l.id)).toEqual([log.id])
    expect(enqueueMock).toHaveBeenCalledWith('ana', { kind: 'supp-log-add', payload: expect.objectContaining({ id: log.id, source: 'mate', amount: 80 }) })
    await removeLog(log.id)
    expect(useSupplements.getState().logs).toEqual([])
    expect(enqueueMock).toHaveBeenLastCalledWith('ana', { kind: 'supp-log-delete', payload: { id: log.id } })
  })
  it('toma con error definitivo del servidor: se deshace y se avisa', async () => {
    useSupplements.setState({ ...server, loaded: true })
    apiMock.mockRejectedValue(Object.assign(new Error('Solo hoy y hasta 7 días atrás'), { status: 400, data: { error: 'Solo hoy y hasta 7 días atrás' } }))
    await expect(addLog({ itemId: 'x', date: '2026-09-01', amount: 5 })).rejects.toThrow()
    expect(useSupplements.getState().logs).toEqual([])
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `cd frontend && npx vitest run src/store/useSupplements.test.js`
Expected: FAIL (no existe el store).

- [ ] **Step 3: Implementar**

```js
// frontend/src/store/useSupplements.js
// Suplementos del socio (docs/superpowers/specs/2026-10-09-suplementos-design.md): fuera de S (el servidor
// tiene tablas propias). Caché en el dispositivo para abrir Nutrición sin esperar, y las tomas sin
// conexión van a la cola de sync (supp-log-add / supp-log-delete) como las comidas.
import { create } from 'zustand'
import { api } from '../lib/api.js'
import { enqueueRequest, shouldQueueOffline } from '../lib/sync-queue.js'
import { useStore } from './useStore.js'

const KEY = 'lauyim_supps'
const EMPTY = { loaded: false, enabled: false, ackVersion: null, profile: { ackVersion: null, adult: null }, adult: 'unknown', today: null, items: [], logs: [] }
const userId = () => useStore.getState().user?.id || null
const DATA_KEYS = ['enabled', 'ackVersion', 'profile', 'adult', 'today', 'items', 'logs']
const pick = s => Object.fromEntries(DATA_KEYS.map(k => [k, s[k]]))
function readCache() {
  try { const c = JSON.parse(localStorage.getItem(KEY) || 'null'); return c && c.userId === userId() ? { ...EMPTY, ...c.data, loaded: true } : EMPTY } catch { return EMPTY }
}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ userId: userId(), data: pick(useSupplements.getState()) })) } catch { /* sin storage */ } }

export const useSupplements = create(() => readCache())
export const noticeAccepted = s => !!s.ackVersion && s.profile?.ackVersion === s.ackVersion
export const newId = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Date.now().toString(36) + Math.random().toString(36).slice(2)).slice(0, 24)
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) })

export async function loadSupplements() {
  try {
    const d = await api('/api/supplements')
    useSupplements.setState({ ...pick({ ...EMPTY, ...d }), loaded: true })
    save()
  } catch (e) {
    if (e?.data?.error === 'supplements_off' || e?.data?.error === 'health_consent_required') { useSupplements.setState({ ...EMPTY, loaded: true }); save() }
    else useSupplements.setState({ loaded: true })
  }
}

export async function acceptNotice({ adult } = {}) {
  const s = useSupplements.getState()
  await post('/api/supplements/ack', adult === undefined ? { version: s.ackVersion } : { version: s.ackVersion, adult })
  useSupplements.setState({ profile: { ...s.profile, ackVersion: s.ackVersion, adult: adult === undefined ? s.profile.adult : (adult ? 1 : 0) }, adult: s.adult === 'unknown' && adult !== undefined ? (adult ? 'adult' : 'minor') : s.adult })
  save()
}

export async function saveItem(item) {
  const { item: saved } = await post('/api/supplements/items', item)
  const items = useSupplements.getState().items.filter(i => i.id !== saved.id).concat(saved)
  useSupplements.setState({ items }); save()
  return saved
}
export async function archiveItem(id, archived) {
  const { item } = await post('/api/supplements/items/archive', { id, archived })
  useSupplements.setState(s => ({ items: s.items.map(i => i.id === id ? item : i) })); save()
}
export async function deleteItem(id) {
  await post('/api/supplements/items/delete', { id })
  useSupplements.setState(s => ({ items: s.items.filter(i => i.id !== id), logs: s.logs.filter(l => l.itemId !== id) })); save()
}

export async function addLog({ itemId = null, source = null, date, amount = 0 }) {
  const log = { id: newId(), itemId, source, date, amount, comidaId: null, createdAt: new Date().toISOString() }
  useSupplements.setState(s => ({ logs: [...s.logs, log] })); save()
  const payload = { id: log.id, itemId, source, date, amount }
  try {
    const { log: saved } = await post('/api/supplements/log', payload)
    useSupplements.setState(s => ({ logs: s.logs.map(l => l.id === log.id ? saved : l) })); save()
    return saved
  } catch (e) {
    if (shouldQueueOffline(e) && userId()) { await enqueueRequest(userId(), { kind: 'supp-log-add', payload }); return log }
    useSupplements.setState(s => ({ logs: s.logs.filter(l => l.id !== log.id) })); save()
    throw e
  }
}

export async function removeLog(id) {
  const before = useSupplements.getState().logs
  useSupplements.setState({ logs: before.filter(l => l.id !== id) }); save()
  try { await post('/api/supplements/log/delete', { id }) }
  catch (e) {
    if (shouldQueueOffline(e) && userId()) { await enqueueRequest(userId(), { kind: 'supp-log-delete', payload: { id } }); return }
    if (e?.status === 404) return
    useSupplements.setState({ logs: before }); save()
    throw e
  }
}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `cd frontend && npx vitest run src/store/useSupplements.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/store/useSupplements.js frontend/src/store/useSupplements.test.js
git commit -m "feat(supplements): client store with cache and offline intakes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 9: `HeatmapGrid` reutilizable

**Files:**
- Modify: `frontend/src/components/Heatmap.jsx`
- Create: `frontend/src/components/Heatmap.test.jsx`

**Interfaces:**
- Produces: `export function HeatmapGrid({ levelOf, titleOf, onDay, legend: [string, string], weeks = 52 })` donde `levelOf(iso): 0..4`, `titleOf(iso): string`, `onDay(iso) | undefined` (solo clickeable si `levelOf(iso) > 0`). `Heatmap` (default) queda igual por fuera y usa `HeatmapGrid`.

- [ ] **Step 1: Test que falla**

```jsx
// frontend/src/components/Heatmap.test.jsx
// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
const { HeatmapGrid, default: Heatmap } = await import('./Heatmap.jsx')
const { setLang } = await import('../lib/i18n.js')
const { todayISO } = await import('../lib/format.js')

async function mount(el) {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const c = document.createElement('div'); document.body.appendChild(c)
  const r = createRoot(c); await act(async () => r.render(el)); return c
}

describe('HeatmapGrid', () => {
  it('pinta el nivel de cada día y solo deja tocar los días con nivel', async () => {
    await setLang('es')
    const today = todayISO(), onDay = vi.fn()
    const c = await mount(<HeatmapGrid weeks={4} levelOf={iso => iso === today ? 3 : 0} titleOf={iso => 'día ' + iso} onDay={onDay} legend={['Menos', 'Más']} />)
    const cell = c.querySelector('.hm-c.today')
    expect(cell.className).toContain('l3')
    expect(cell.title).toBe('día ' + today)
    await act(async () => cell.click())
    expect(onDay).toHaveBeenCalledWith(today)
    expect(c.querySelector('.hm-legend').textContent).toContain('Menos')
  })
  it('Heatmap de Stats sigue igual', async () => {
    const c = await mount(<Heatmap S={{ workouts: [], unit: 'kg' }} onDay={() => {}} />)
    expect(c.querySelectorAll('.hm-col').length).toBe(53)
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `cd frontend && npx vitest run src/components/Heatmap.test.jsx`
Expected: FAIL (`HeatmapGrid` no existe).

- [ ] **Step 3: Implementar**

Reemplazar el contenido de `frontend/src/components/Heatmap.jsx` por:

```jsx
import { useEffect, useRef } from 'react'
import { fmtVol, isoOf, todayISO, MONTHS } from '../lib/format.js'
import { t } from '../lib/i18n.js'

// Grilla tipo GitHub: una columna por semana (lunes a domingo), `weeks` semanas hasta la actual.
// levelOf(iso) → 0..4 (la intensidad del color); titleOf(iso) → el texto al pasar el mouse.
export function HeatmapGrid({ levelOf, titleOf, onDay, legend, weeks = 52 }) {
  const wrapRef = useRef(null)
  useEffect(() => { if (wrapRef.current) wrapRef.current.scrollLeft = wrapRef.current.scrollWidth }, [])
  const today = new Date(); today.setHours(12, 0, 0, 0)
  const end = new Date(today); end.setDate(today.getDate() - ((today.getDay() + 6) % 7))
  const start = new Date(end); start.setDate(end.getDate() - weeks * 7)
  const months = [], cols = []
  let lastMonth = -1
  for (let wk = 0; wk <= weeks; wk++) {
    const colStart = new Date(start); colStart.setDate(start.getDate() + wk * 7)
    const mo = colStart.getMonth()
    const showM = mo !== lastMonth && colStart.getDate() <= 7 && wk < weeks - 1
    months.push(<span key={wk}>{showM ? t(MONTHS[mo]) : ''}</span>)
    if (colStart.getDate() <= 7) lastMonth = mo
    const cells = []
    for (let d = 0; d < 7; d++) {
      const day = new Date(colStart); day.setDate(colStart.getDate() + d)
      const key = isoOf(day)
      const lvl = day > today ? 0 : levelOf(key)
      const cls = 'hm-c l' + lvl + (key === todayISO() ? ' today' : '') + (day > today ? ' future' : '')
      cells.push(<div key={d} className={cls} title={titleOf(key)} onClick={lvl > 0 && onDay ? () => onDay(key) : undefined} />)
    }
    cols.push(<div key={wk} className="hm-col">{cells}</div>)
  }
  return <>
    <div className="hm-wrap" ref={wrapRef}>
      <div className="hm-months" style={{ marginLeft: 30 }}>{months}</div>
      <div className="hm-body">
        <div className="hm-days"><span>{t('Mon')}</span><span /><span>{t('Wed')}</span><span /><span>{t('Fri')}</span><span /><span /></div>
        <div className="hm-grid">{cols}</div>
      </div>
    </div>
    <div className="hm-legend">{legend[0]} <div className="hm-c l0" /><div className="hm-c l1" /><div className="hm-c l2" /><div className="hm-c l3" /><div className="hm-c l4" /> {legend[1]}</div>
  </>
}

// GitHub-style activity heatmap, shaded by time trained per day.
export default function Heatmap({ S, onDay }) {
  const agg = {}
  S.workouts.forEach(w => {
    const a = agg[w.d] = agg[w.d] || { n: 0, vol: 0, min: 0 }
    a.n++; a.vol += w.vol || 0
    a.min += Math.max(0, Math.round(((w.end || w.start) - w.start) / 60000))
  })
  const mins = Object.values(agg).map(a => a.min).filter(v => v > 0).sort((a, b) => a - b)
  const q = p => (mins.length ? mins[Math.min(mins.length - 1, Math.floor(p * mins.length))] : 0)
  const t1 = q(0.25), t2 = q(0.5), t3 = q(0.75)
  const level = a => !a ? 0 : !a.min ? 1 : a.min >= t3 ? 4 : a.min >= t2 ? 3 : a.min >= t1 ? 2 : 1
  return <HeatmapGrid
    levelOf={iso => level(agg[iso])}
    titleOf={iso => { const a = agg[iso]; return iso + (a ? ` · ${t(a.n === 1 ? '{0} workout' : '{0} workouts', a.n)} · ${a.min} min · ${fmtVol(a.vol, S.unit)}` : '') }}
    onDay={onDay}
    legend={[t('Less time'), t('More time')]} />
}
```

Diferencia de comportamiento a revisar: antes una celda era clickeable si había workouts (`a` existía), aunque su nivel fuera 1; ahora `lvl > 0`, que para Stats es lo mismo (`level(a) >= 1` siempre que `a` existe).

- [ ] **Step 4: Correr y ver que pasa**

Run: `cd frontend && npx vitest run src/components/Heatmap.test.jsx src/views/Stats.recovery.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/Heatmap.jsx frontend/src/components/Heatmap.test.jsx
git commit -m "refactor(heatmap): extract a reusable HeatmapGrid" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 10: Aviso inicial y tarjeta en Nutrición

**Files:**
- Create: `frontend/src/components/suplementos/AvisoInicial.jsx`
- Create: `frontend/src/components/suplementos/SuplementosCard.jsx`
- Create: `frontend/src/components/suplementos/SuplementosCard.test.jsx`
- Modify: `frontend/src/views/Nutricion.jsx` (montar la tarjeta)
- Modify: `frontend/src/index.css` (estilos `.supp-*`)

**Interfaces:**
- Consumes: Tareas 1, 2, 8. `useUI.getState().openSheet(render, opts)`; `Button`, `Segmented`, `Check` de `../ui.jsx`; `Icon`.
- Produces:
  - `openNotice(then?: () => void): void` — abre la hoja del aviso (`{ locked: true, backGesture: true }`: no se cierra tocando afuera ni deslizando, sí con el gesto atrás). Al aceptar llama a `then`.
  - `withNotice(fn): void` — si el aviso está aceptado corre `fn`; si no, `openNotice(fn)`.
  - `SuplementosCard` (default export) — sin props; lee `useStore` (`S`, `config`) y `useSupplements`.
  - Por ahora la tarjeta llama a funciones de las Tareas 11–13 que todavía no existen: importarlas con `import(...)` dinámico dentro de los handlers (`openGuide`, `openConfig`, `openCaffeine`, `openMine`), como hace `ClosureSheet.jsx` con `sheets.jsx`. Los tests de esta tarea no tocan esos botones.

Comportamiento (spec, "Vista en Nutrición" y "Primer uso"):
- `useEffect` → `loadSupplements()` al montar.
- No renderiza nada si `config?.supplements_enabled === false` o `!enabled` (después de `loaded`).
- Aviso sin aceptar: título "Suplementos", recuadro "🔒 Para ver la guía y registrar suplementos, leé y aceptá el aviso." y botón **Leer el aviso** (`openNotice()`).
- Menor (`adult === 'minor'`): "Suplementos" + "La guía es solo informativa: no recomendamos suplementos a menores de 18 sin supervisión profesional." + botón **Ver la guía**.
- Sin items activos: estado vacío ("¿Tomás suplementos? Mirá qué dice la ciencia: qué funciona, cuánto y cómo prepararlo."), botón primario **Ver la guía** y enlace **＋ Agregar un suplemento**; debajo, igual, la sección de cafeína del día si hay consumos hoy.
- Con items: encabezado "Suplementos" + "Hoy: N de M tomas" + **Marcar todos**; grupos por momento (`groupBySlot` de los que tocan hoy); fila = nombre (+ etiqueta "indicación" si `fichaById(catalogId)?.level === 'indicacion'`), `doseLabel`, racha "🔥 n" si n ≥ 2, y un `Check` por toma (`doses` = 1) o puntos (`doses` > 1). Tocar un check sin marcar → `addLog({ itemId, date: today, amount: perTake(item) })`; tocar uno marcado → `removeLog(último log de ese item hoy)`. **Marcar todos** agrega las tomas que faltan.
- Exceso de cualquier suplemento con `dayMax` (ej. creatina > 20 g en un día): debajo de su fila, `.supp-warn` "Hoy marcaste {cantidad} {unidad}: más de lo recomendado para un día." (`overDose`). El registro se guarda igual.
- Sección "Cafeína del día": total `caffeineTotal` "≈ X mg de 400 · estimado", barra (`width = min(100, X/4)%`, roja si `isOverCaffeine`), botones rápidos 🧉 Mate / ☕ Café / ⚡ Pre-entreno / ＋ que abren `openCaffeine()`. Si se pasa: "Hoy vas X mg: más de lo recomendado para un día. Si te cuesta dormir, cortá la cafeína unas 6 h antes."
- Pie: **📖 Guía** · **Mis suplementos** · **＋ Agregar** (todos por `withNotice`).
- `today` = `useSupplements.today || todayISO()`. `trainingDayOf = iso => isTrainingDay(S, iso)`.
- PC (≥ 768 px): CSS de dos columnas (`.supp-card-cols`), momentos a la izquierda y cafeína a la derecha.

Hoja del aviso (`AvisoInicial.jsx`):
- Título "Antes de empezar"; recuadro: "Esta guía es **información general** basada en IOC, AIS, ISSN, NIH y EFSA. **No es consejo médico** ni reemplaza a un profesional de la salud."
- "Consultá a un profesional antes si te aplica alguna": 🤰 Embarazo o lactancia · 🫘 Enfermedad renal o hepática · ❤️ Presión alta o problemas cardíacos · 💊 Tomás medicación de forma habitual · 😵 Ansiedad o problemas para dormir (por la cafeína).
- "No guardamos cuál te aplica: solo que leíste esto."
- Si `adult === 'unknown'`: "¿Tenés 18 años o más?" con `Segmented` Sí/No (sin valor elegido de entrada; el botón queda deshabilitado hasta elegir).
- Único botón: **Leí y acepto** → `acceptNotice({ adult })` (o sin `adult` si ya se sabe), cierra y llama a `then`. Error → toast con `errorText`.
- Nada más debajo del botón.

- [ ] **Step 1: Tests que fallan**

```jsx
// frontend/src/components/suplementos/SuplementosCard.test.jsx
// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))
const { useStore } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { useSupplements } = await import('../../store/useSupplements.js')
const { setLang } = await import('../../lib/i18n.js')
const { default: SuplementosCard } = await import('./SuplementosCard.jsx')

const TODAY = '2026-10-09'
const crea = { id: 'crea0001', catalogId: 'creatina', dose: 5, unit: 'g', scoopG: 5, doses: 1, slot: 'morning', days: 'daily', status: 'active', createdAt: '2026-09-01T00:00:00Z' }
const beta = { id: 'beta0001', catalogId: 'betaalanina', dose: 3.2, unit: 'g', scoopG: null, doses: 2, slot: 'meals', days: 'daily', status: 'active', createdAt: '2026-09-01T00:00:00Z' }
const base = { enabled: true, ackVersion: '2026-10-09', profile: { ackVersion: '2026-10-09', adult: 1 }, adult: 'adult', today: TODAY, items: [], logs: [] }
let container, root
const tick = () => act(async () => { await new Promise(r => setTimeout(r, 10)) })
async function mount(state) {
  apiMock.mockImplementation(url => url === '/api/supplements' ? Promise.resolve(state) : Promise.resolve({ ok: true, log: { id: 'srv', itemId: 'crea0001', date: TODAY, amount: 5 } }))
  useSupplements.setState({ ...state, loaded: true })
  container = document.createElement('div'); document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => root.render(<MemoryRouter><SuplementosCard /></MemoryRouter>))
  await tick()
}
const text = () => container.textContent

beforeEach(async () => {
  await setLang('es'); globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 9, 12))
  apiMock.mockReset(); useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ user: { id: 'ana' }, config: { supplements_enabled: true }, S: { ...useStore.getState().S, routines: [], week: {}, dayPlan: {}, workouts: [], bodyweight: [{ d: TODAY, w: 80 }] } })
})
afterEach(async () => { if (root) await act(async () => root.unmount()); container?.remove(); vi.useRealTimers() })

describe('tarjeta de suplementos', () => {
  it('apagado por el gimnasio: no se ve', async () => {
    useStore.setState({ config: { supplements_enabled: false } })
    await mount(base)
    expect(text()).toBe('')
  })
  it('sin aviso aceptado: candado y "Leer el aviso" abre la hoja sin "Ahora no"', async () => {
    await mount({ ...base, profile: { ackVersion: null, adult: null }, adult: 'unknown' })
    expect(text()).toContain('leé y aceptá el aviso')
    await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent.includes('Leer el aviso')).click())
    const sheet = useUI.getState().sheets.at(-1)
    expect(sheet.locked).toBe(true)
    const host = document.createElement('div'); const r = createRoot(host)
    await act(async () => r.render(sheet.render(() => {})))
    expect(host.textContent).toContain('Leí y acepto')
    expect(host.textContent).not.toContain('Ahora no')
    expect(host.textContent).toContain('¿Tenés 18 años o más?')
    await act(async () => r.unmount())
  })
  it('vacío: llamado a la guía', async () => {
    await mount(base)
    expect(text()).toContain('¿Tomás suplementos?')
  })
  it('con items: agrupa por momento, muestra dosis y marca una toma', async () => {
    await mount({ ...base, items: [crea, beta] })
    expect(text()).toContain('Mañana'); expect(text()).toContain('Con las comidas')
    expect(text()).toContain('1 scoop · 5 g'); expect(text()).toContain('2 tomas · 1,6 g c/u')
    expect(text()).toContain('Hoy: 0 de 3 tomas')
    await act(async () => container.querySelector('[aria-label="Marcar Creatina monohidrato"]').click())
    await tick()
    expect(apiMock).toHaveBeenCalledWith('/api/supplements/log', expect.objectContaining({ method: 'POST' }))
    expect(text()).toContain('Hoy: 1 de 3 tomas')
  })
  it('cafeína: total del día y aviso al pasarse de 400', async () => {
    const logs = [{ id: 'a', itemId: null, source: 'mate', date: TODAY, amount: 300 }, { id: 'b', itemId: null, source: 'cafe', date: TODAY, amount: 150 }]
    await mount({ ...base, items: [crea], logs })
    expect(text()).toContain('450 mg')
    expect(text()).toContain('más de lo recomendado para un día')
  })
  it('menor: solo la guía', async () => {
    await mount({ ...base, adult: 'minor', items: [crea] })
    expect(text()).toContain('no recomendamos suplementos a menores de 18')
    expect(text()).not.toContain('Hoy:')
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `cd frontend && npx vitest run src/components/suplementos/SuplementosCard.test.jsx`
Expected: FAIL (no existen los componentes).

- [ ] **Step 3: Implementar `AvisoInicial.jsx`**

```jsx
// Aviso de suplementos (spec, "Primer uso"): información general, lista de condiciones que no se
// guarda y, si falta la edad, "¿Tenés 18 años o más?". Un solo botón: "Leí y acepto". Sin aceptar no
// se guarda nada y vuelve a aparecer; el gesto atrás puede cerrarla (no se traba al usuario).
import { useState } from 'react'
import { useUI } from '../../store/useUI.js'
import { useSupplements, acceptNotice, noticeAccepted } from '../../store/useSupplements.js'
import { t } from '../../lib/i18n.js'
import { errorText } from '../../lib/errors.js'
import { Button, Segmented } from '../ui.jsx'

const CONDITIONS = [['🤰', 'Embarazo o lactancia'], ['🫘', 'Enfermedad renal o hepática'], ['❤️', 'Presión alta o problemas cardíacos'], ['💊', 'Tomás medicación de forma habitual'], ['😵', 'Ansiedad o problemas para dormir (por la cafeína)']]

function Aviso({ close, then }) {
  const askAge = useSupplements(s => s.adult === 'unknown')
  const [adult, setAdult] = useState(null)
  const [busy, setBusy] = useState(false)
  const accept = async () => {
    setBusy(true)
    try { await acceptNotice(askAge ? { adult: adult === 'si' } : {}); close(); then && then() }
    catch (e) { useUI.getState().toast(errorText(e, t('No se pudo guardar. Probá de nuevo.'))) }
    setBusy(false)
  }
  return <div className="supp-notice">
    <h3>{t('Antes de empezar')}</h3>
    <div className="supp-box">{t('Esta guía es información general basada en IOC, AIS, ISSN, NIH y EFSA. No es consejo médico ni reemplaza a un profesional de la salud.')}</div>
    <div className="supp-label">{t('Consultá a un profesional antes si te aplica alguna')}</div>
    <ul className="supp-conditions">{CONDITIONS.map(([e, c]) => <li key={c}><span aria-hidden="true">{e}</span> {t(c)}</li>)}</ul>
    <div className="small dim">{t('No guardamos cuál te aplica: solo que leíste esto.')}</div>
    {askAge && <div className="supp-age">
      <div className="supp-label">{t('¿Tenés 18 años o más?')}</div>
      <Segmented options={[{ value: 'si', label: t('Sí') }, { value: 'no', label: t('No') }]} value={adult} onChange={setAdult} />
    </div>}
    <Button variant="primary" disabled={busy || (askAge && !adult)} onClick={accept}>{t('Leí y acepto')}</Button>
  </div>
}

export const openNotice = then => useUI.getState().openSheet(close => <Aviso close={close} then={then} />, { locked: true, backGesture: true })
export const withNotice = fn => noticeAccepted(useSupplements.getState()) ? fn() : openNotice(fn)
```

- [ ] **Step 4: Implementar `SuplementosCard.jsx`**

```jsx
// Tarjeta "Suplementos" en Nutrición (spec, "Vista en Nutrición"): lo que toca hoy agrupado por momento,
// con un check por toma, la racha y la cafeína del día. Entre Peso corporal y Resumen nutricional.
import { Fragment, useEffect } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { useSupplements, loadSupplements, addLog, removeLog, noticeAccepted } from '../../store/useSupplements.js'
import { t } from '../../lib/i18n.js'
import { errorText } from '../../lib/errors.js'
import { todayISO } from '../../lib/format.js'
import { fichaById } from '../../lib/suplementos-data.js'
import { isTrainingDay, isDueOn, takenOn, streakOf, groupBySlot, doseLabel, perTake, itemName, caffeineTotal, isOverCaffeine, overDose } from '../../lib/suplementos.js'
import { Button, Check } from '../ui.jsx'
import Icon from '../Icon.jsx'
import { openNotice, withNotice } from './AvisoInicial.jsx'

const open = (mod, fn, ...args) => withNotice(() => import(`./${mod}.jsx`).then(m => m[fn](...args)))
export const openGuide = id => open('GuiaSheet', 'openGuide', id)
export const openCaffeine = () => open('CafeinaSheet', 'openCaffeine')
export const openMine = () => open('MisSuplementos', 'openMine')
export const openAdd = () => openGuide(null)

export function CaffeineToday({ items, logs, today }) {
  const total = caffeineTotal(logs, items, today)
  const over = isOverCaffeine(total)
  return <div className="supp-caffeine">
    <div className="supp-sec">{t('Cafeína del día')}</div>
    <div className="row"><b>≈ {total} mg</b><span className="small dim grow">{t('de 400 · estimado')}</span></div>
    <div className={'supp-bar' + (over ? ' over' : '')}><i style={{ width: Math.min(100, total / 4) + '%' }} /></div>
    {over && <div className="supp-warn">{t('Hoy vas {0} mg: más de lo recomendado para un día. Si te cuesta dormir, cortá la cafeína unas 6 h antes.', total)}</div>}
    <div className="chips supp-quick">
      <button type="button" className="chip nocap" onClick={openCaffeine}>🧉 {t('Mate')}</button>
      <button type="button" className="chip nocap" onClick={openCaffeine}>☕ {t('Café')}</button>
      <button type="button" className="chip nocap" onClick={openCaffeine}>⚡ {t('Pre-entreno')}</button>
      <button type="button" className="chip nocap" onClick={openCaffeine} aria-label={t('Otra cafeína')}>＋</button>
    </div>
  </div>
}

function TakeButtons({ item, taken, onAdd, onRemove }) {
  const name = itemName(item)
  if ((item.doses || 1) === 1) return <Check checked={taken > 0} onChange={v => v ? onAdd() : onRemove()} aria-label={t('Marcar {0}', name)} />
  return <div className="supp-dots">{Array.from({ length: item.doses }, (_, i) => <button key={i} type="button" className={'supp-dot' + (i < taken ? ' on' : '')}
    aria-label={t('Toma {0} de {1}', i + 1, name)} onClick={() => i < taken ? onRemove() : onAdd()} />)}</div>
}

export default function SuplementosCard() {
  const S = useStore(s => s.S)
  const off = useStore(s => s.config?.supplements_enabled === false)
  const st = useSupplements()
  useEffect(() => { loadSupplements() }, [])
  if (off || !st.loaded || !st.enabled) return null
  const today = st.today || todayISO()
  const trainingDayOf = iso => isTrainingDay(S, iso)
  const toast = e => useUI.getState().toast(errorText(e, t('No se pudo guardar. Probá de nuevo.')))
  const header = <h2>{t('Suplementos')}</h2>

  if (!noticeAccepted(st)) return <div className="card supp-card">
    {header}
    <div className="supp-lock"><Icon name="lock" /> {t('Para ver la guía y registrar suplementos, leé y aceptá el aviso.')}</div>
    <Button variant="primary" onClick={() => openNotice()}>{t('Leer el aviso')}</Button>
  </div>

  if (st.adult === 'minor') return <div className="card supp-card">
    {header}
    <div className="small dim">{t('La guía es solo informativa: no recomendamos suplementos a menores de 18 sin supervisión profesional.')}</div>
    <Button onClick={() => openGuide(null)}>{t('Ver la guía')}</Button>
  </div>

  const due = st.items.filter(i => isDueOn(i, today, trainingDayOf(today)))
  const totalDoses = due.reduce((n, i) => n + (i.doses || 1), 0)
  const doneDoses = due.reduce((n, i) => n + Math.min(i.doses || 1, takenOn(st.logs, i.id, today)), 0)
  const add = item => addLog({ itemId: item.id, date: today, amount: perTake(item) }).catch(toast)
  const remove = item => { const last = st.logs.filter(l => l.itemId === item.id && l.date === today).at(-1); if (last) removeLog(last.id).catch(toast) }
  const markAll = () => { for (const i of due) for (let k = takenOn(st.logs, i.id, today); k < (i.doses || 1); k++) add(i) }
  const footer = <div className="supp-actions">
    <button type="button" className="link" onClick={() => openGuide(null)}>📖 {t('Guía')}</button>
    <button type="button" className="link" onClick={openMine}>{t('Mis suplementos')}</button>
    <button type="button" className="link" onClick={openAdd}>＋ {t('Agregar')}</button>
  </div>
  const caffeine = <CaffeineToday items={st.items} logs={st.logs} today={today} />

  if (!st.items.some(i => i.status === 'active')) return <div className="card supp-card">
    {header}
    <div className="small dim">{t('¿Tomás suplementos? Mirá qué dice la ciencia: qué funciona, cuánto y cómo prepararlo.')}</div>
    <Button variant="primary" onClick={() => openGuide(null)}>📖 {t('Ver la guía')}</Button>
    <button type="button" className="link supp-add" onClick={openAdd}>＋ {t('Agregar un suplemento')}</button>
    {st.logs.some(l => l.date === today && l.source) && caffeine}
  </div>

  return <div className="card supp-card">
    <div className="row between">
      <div>{header}<div className="small dim">{t('Hoy: {0} de {1} tomas', doneDoses, totalDoses)}</div></div>
      {doneDoses < totalDoses && <button type="button" className="link" onClick={markAll}>{t('Marcar todos')}</button>}
    </div>
    <div className="supp-card-cols">
      <div>
        {groupBySlot(due).map(g => <div key={g.slot.id}>
          <div className="supp-sec">{t(g.slot.label)}</div>
          {g.items.map(item => {
            const taken = takenOn(st.logs, item.id, today)
            const streak = streakOf(item, st.logs, today, trainingDayOf)
            return <Fragment key={item.id}><div className="supp-row">
              <div className="grow"><b>{itemName(item)}</b>{fichaById(item.catalogId)?.level === 'indicacion' && <span className="supp-pill">{t('indicación')}</span>}
                <div className="small dim">{doseLabel(item)}</div></div>
              {streak >= 2 && <span className="supp-streak">🔥 {streak}</span>}
              <TakeButtons item={item} taken={taken} onAdd={() => add(item)} onRemove={() => remove(item)} />
            </div>
            {overDose(item, st.logs, today) != null && <div className="supp-warn">{t('Hoy marcaste {0} {1}: más de lo recomendado para un día.', overDose(item, st.logs, today), item.unit)}</div>}</Fragment>
          })}
        </div>)}
      </div>
      {caffeine}
    </div>
    {footer}
  </div>
}
```

Nota: `Check` no pasa `aria-label`; agregarlo en `frontend/src/components/ui.jsx` (`export function Check({ checked, onChange, className = '', size, ...rest })` y `{...rest}` en el `<button>`), sin cambiar a los que ya lo usan.

- [ ] **Step 5: Montar en Nutrición**

En `frontend/src/views/Nutricion.jsx`, import:

```js
import SuplementosCard from '../components/suplementos/SuplementosCard.jsx'
```

Entre el cierre de la tarjeta `data-tour="nutrition-weight"` y `<div className="card" data-tour="nutrition-summary">`:

```jsx
    <SuplementosCard />
```

- [ ] **Step 6: Estilos**

En `frontend/src/index.css`, al final:

```css
/* --- suplementos (components/suplementos) --- */
.supp-card h2{margin:0}
.supp-sec{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--label-2);margin:12px 0 4px}
.supp-row{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--sep)}
.supp-row:last-child{border-bottom:none}
.supp-pill{font-size:10.5px;background:var(--surface-3);color:var(--label-2);border-radius:6px;padding:1px 6px;margin-left:6px}
.supp-streak{font-size:12px;color:var(--orange)}
.supp-dots{display:flex;gap:6px}
.supp-dot{width:22px;height:22px;border-radius:50%;border:2px solid var(--surface-3);background:none;padding:0}
.supp-dot.on{background:var(--acc);border-color:var(--acc)}
.supp-bar{height:7px;background:var(--surface-3);border-radius:4px;overflow:hidden;margin:6px 0 3px}
.supp-bar i{display:block;height:100%;background:var(--orange)}
.supp-bar.over i{background:var(--red)}
.supp-warn{background:color-mix(in srgb,var(--orange) 14%,transparent);border:1px solid color-mix(in srgb,var(--orange) 50%,transparent);border-radius:10px;padding:7px 9px;font-size:12.5px;margin-top:6px}
.supp-quick{margin-top:6px}
.supp-actions{display:flex;justify-content:space-between;margin-top:12px}
.supp-actions .link,.supp-add{color:var(--acc);background:none;border:none;padding:6px 0;font:inherit}
.supp-lock{background:color-mix(in srgb,var(--yellow) 12%,transparent);border:1px solid color-mix(in srgb,var(--yellow) 45%,transparent);border-radius:11px;padding:10px;font-size:13px;margin:8px 0}
.supp-box{background:var(--surface-2);border-radius:11px;padding:10px;font-size:13px;line-height:1.5;margin:8px 0}
.supp-label{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--label-2);margin:10px 0 4px}
.supp-conditions{list-style:none;padding:0;margin:0 0 6px}
.supp-conditions li{margin:5px 0;font-size:13.5px}
.supp-age{margin:12px 0}
.supp-notice .btn.primary{width:100%;margin-top:14px}
@media (min-width:768px){.supp-card-cols{display:grid;grid-template-columns:1fr 1fr;gap:0 22px;align-items:start}}
```

Si `color-mix` o alguna variable (`--orange`, `--yellow`, `--red`, `--acc`, `--sep`) no existe en `index.css`, usar la que esté definida (ver el bloque `:root`).

- [ ] **Step 7: Correr y ver que pasa**

Run: `cd frontend && npx vitest run src/components/suplementos/SuplementosCard.test.jsx src/views/Nutricion.membership.test.jsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/suplementos frontend/src/views/Nutricion.jsx frontend/src/index.css frontend/src/components/ui.jsx
git commit -m "feat(supplements): nutrition card and mandatory notice" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 11: Guía y ficha

**Files:**
- Create: `frontend/src/components/suplementos/GuiaSheet.jsx`
- Create: `frontend/src/components/suplementos/GuiaSheet.test.jsx`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Consumes: Tareas 1, 2, 8; `openConfig(catalogId)` de la Tarea 12 (por `import()` dinámico).
- Produces: `openGuide(id: string | null): void` — `id` abre directo esa ficha; `null`, la lista. Hoja `{ fullScreen: true }` en celular; en PC (≥ 768 px) la misma hoja muestra lista y ficha en dos columnas (`.supp-guide-cols`).

Comportamiento (spec, "Guía (contenido)"):
- Encabezado "Guía de suplementos" + "Basado en IOC, AIS, ISSN, NIH y EFSA".
- Consejo de agua arriba de todo: `WATER_TIP.mujeres` si `S.genero === 'femenino'`, `hombres` si `'masculino'`, si no `ambos`.
- Lista por nivel (`LEVELS` en orden), cada uno con su color; fila = nombre + `short`; "✓ la tomás" si hay un item activo con ese `catalogId`; los de `puntual` muestran "Solo información". Al final: "＋ Otro suplemento (cargalo vos)" → `openConfig(null)`.
- Ficha: "‹" vuelve a la lista (en celular); nombre; etiqueta de nivel `"FUNCIONA · AIS A"` (`LEVELS[level].label.toUpperCase() + ' · AIS ' + ais`); `badge` si existe; `intro`. Secciones, en este orden: **Cómo tomarlo** (filas `howTo` con su ícono; en cafeína, una fila extra con el rango calculado: "Para tus 80 kg: 240 a 400 mg (empezá por lo más bajo). Más de 200 mg de una vez supera la referencia de EFSA para una sola toma." usando `caffeineRange(lastBW(S)?.w)`; sin peso: "Cargá tu peso para ver el rango para vos.") → recuadro `loading` si existe → **Qué dice la evidencia** → **Para quién sirve** → **Qué podés notar** (`notice`, si existe) → **Precauciones** (`cautions`, siempre visibles) → **Comprar con criterio** → **Fuentes** (lista + "Revisado: {reviewed}").
- Botón **＋ Agregar a mis suplementos** solo si `trackable`, el socio no es menor y no lo tiene activo (si lo tiene: "Ya lo tomás · Configurar" → `openConfig(id)`). Menor: en lugar de "Cómo tomarlo" con dosis, el texto "No recomendado para menores de 18 sin supervisión profesional." (las otras secciones se ven).

- [ ] **Step 1: Tests que fallan**

```jsx
// frontend/src/components/suplementos/GuiaSheet.test.jsx
// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it } from 'vitest'
const { useStore } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { useSupplements } = await import('../../store/useSupplements.js')
const { setLang } = await import('../../lib/i18n.js')
const { openGuide } = await import('./GuiaSheet.jsx')

async function render(id) {
  openGuide(id)
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div'); document.body.appendChild(host)
  const r = createRoot(host)
  await act(async () => r.render(sheet.render(() => {}, { setOnBack: () => {} })))
  return host
}
beforeEach(async () => {
  await setLang('es'); globalThis.IS_REACT_ACT_ENVIRONMENT = true
  useUI.setState({ sheets: [] })
  useStore.setState({ user: { id: 'ana' }, S: { ...useStore.getState().S, genero: 'masculino', bodyweight: [{ d: '2026-10-09', w: 80 }] } })
  useSupplements.setState({ loaded: true, enabled: true, adult: 'adult', items: [{ id: 'c1', catalogId: 'creatina', status: 'active', doses: 1 }], logs: [], ackVersion: 'v', profile: { ackVersion: 'v' } })
})

describe('guía', () => {
  it('lista: agua arriba, niveles y "la tomás"', async () => {
    const h = await render(null)
    expect(h.textContent.indexOf('Recordá tomar agua')).toBeLessThan(h.textContent.indexOf('Funciona'))
    expect(h.textContent).toContain('2,5 L')
    for (const l of ['Funciona', 'Evidencia en desarrollo', 'Con indicación profesional', 'No recomendado']) expect(h.textContent).toContain(l)
    expect(h.textContent).toContain('la tomás')
    expect(h.textContent).toContain('Otro suplemento')
  })
  it('ficha de creatina: cómo tomarla primero, carga, precauciones y fuentes; ya la toma', async () => {
    const t = (await render('creatina')).textContent
    expect(t.indexOf('Cómo tomarla')).toBeLessThan(t.indexOf('Qué dice la evidencia'))
    expect(t).toContain('recién empezás'); expect(t).toContain('Precauciones'); expect(t).toContain('Revisado')
    expect(t).toContain('Ya lo tomás')
  })
  it('cafeína: rango con el peso', async () => {
    expect((await render('cafeina')).textContent).toContain('Para tus 80 kg: 240 a 400 mg')
  })
  it('no recomendado: sin "Agregar"', async () => {
    expect((await render('quemadores')).textContent).not.toContain('Agregar a mis suplementos')
  })
  it('menor: sin dosis ni "Agregar"', async () => {
    useSupplements.setState({ adult: 'minor', items: [] })
    const t = (await render('creatina')).textContent
    expect(t).toContain('No recomendado para menores de 18'); expect(t).not.toContain('Agregar a mis suplementos')
  })
})
```

Nota: el título de "Cómo tomarlo" se concuerda con el suplemento ("Cómo tomarla" en creatina y cafeína, "Cómo tomarlo" en los demás): agregar a cada ficha un campo `howToTitle` en `suplementos-data.js` (Tarea 1) o derivarlo con una tabla `{ creatina: 'Cómo tomarla', cafeina: 'Cómo tomarla', proteina: 'Cómo tomarla', betaalanina: 'Cómo tomarla', vitaminad: 'Cómo tomarla' }` en `GuiaSheet.jsx`; el test usa "Cómo tomarla" con creatina.

- [ ] **Step 2: Correr y ver que falla**

Run: `cd frontend && npx vitest run src/components/suplementos/GuiaSheet.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implementar `GuiaSheet.jsx`**

```jsx
// Guía de suplementos (spec, "Guía (contenido)"): agua arriba, lista por nivel y la ficha de cada uno
// en una sola página con lo práctico primero y las precauciones siempre a la vista. En PC, lista y
// ficha lado a lado.
import { useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { useSupplements } from '../../store/useSupplements.js'
import { t } from '../../lib/i18n.js'
import { lastBW } from '../../lib/history.js'
import { SUPLEMENTOS, LEVELS, WATER_TIP, fichaById } from '../../lib/suplementos-data.js'
import { caffeineRange } from '../../lib/suplementos.js'
import { Button } from '../ui.jsx'

const FEM_TAKE = new Set(['creatina', 'cafeina', 'proteina', 'betaalanina', 'vitaminad'])
const howToTitle = id => FEM_TAKE.has(id) ? 'Cómo tomarla' : 'Cómo tomarlo'
const openConfig = id => import('./ConfigSuplemento.jsx').then(m => m.openConfig(id))

function Ficha({ id, onBack }) {
  const f = fichaById(id)
  const S = useStore(s => s.S)
  const minor = useSupplements(s => s.adult === 'minor')
  const mine = useSupplements(s => s.items.find(i => i.catalogId === id && i.status === 'active'))
  if (!f) return null
  const range = id === 'cafeina' ? caffeineRange(lastBW(S)?.w) : null
  const Sec = ({ title, children }) => <><div className="supp-sec">{t(title)}</div><div className="supp-box">{children}</div></>
  return <div className="supp-ficha">
    {onBack && <button type="button" className="link supp-back" onClick={onBack} aria-label={t('Volver a la lista')}>‹ {t('Guía')}</button>}
    <h3>{f.name}</h3>
    <span className="supp-level" style={{ '--lvl': LEVELS[f.level].color }}>{LEVELS[f.level].label.toUpperCase()}{f.ais ? ' · AIS ' + f.ais : ''}</span>
    {f.badge && <span className="supp-pill">{f.badge}</span>}
    <p className="dim">{f.intro}</p>
    {minor ? <Sec title={howToTitle(id)}>{t('No recomendado para menores de 18 sin supervisión profesional.')}</Sec>
      : f.howTo?.length > 0 && <Sec title={howToTitle(id)}>
        {f.howTo.map((h, i) => <div key={i} className="supp-how"><span aria-hidden="true">{h.icon}</span><span>{h.text}</span></div>)}
        {id === 'cafeina' && <div className="supp-how"><span aria-hidden="true">🎯</span><span>{range
          ? `Para tus ${Math.round(lastBW(S).w)} kg: ${range.min} a ${range.max} mg (empezá por lo más bajo). Más de 200 mg de una vez supera la referencia de EFSA para una sola toma.`
          : 'Cargá tu peso para ver el rango para vos.'}</span></div>}
      </Sec>}
    {!minor && f.loading && <div className="supp-box supp-loading">⚡ {f.loading}</div>}
    <Sec title="Qué dice la evidencia">{f.evidence}</Sec>
    <Sec title="Para quién sirve">{f.forWhom}</Sec>
    {f.notice && <Sec title="Qué podés notar">{f.notice}</Sec>}
    <Sec title="Precauciones"><ul className="supp-list">{f.cautions.map(c => <li key={c}>{c}</li>)}</ul></Sec>
    <Sec title="Comprar con criterio">{f.buy}</Sec>
    <div className="supp-sec">{t('Fuentes')}</div>
    <div className="small dim">{f.sources.join(' · ')}<br />{t('Revisado: {0}', f.reviewed)}</div>
    {f.trackable && !minor && (mine
      ? <Button onClick={() => openConfig(id)}>{t('Ya lo tomás · Configurar')}</Button>
      : <Button variant="primary" icon="plus" onClick={() => openConfig(id)}>{t('Agregar a mis suplementos')}</Button>)}
  </div>
}

function Lista({ selected, onPick }) {
  const genero = useStore(s => s.S.genero)
  const items = useSupplements(s => s.items)
  const has = id => items.some(i => i.catalogId === id && i.status === 'active')
  const water = genero === 'femenino' ? WATER_TIP.mujeres : genero === 'masculino' ? WATER_TIP.hombres : WATER_TIP.ambos
  const levels = Object.entries(LEVELS).sort((a, b) => a[1].order - b[1].order)
  return <div className="supp-list-col">
    <h3>{t('Guía de suplementos')}</h3>
    <div className="small dim">{t('Basado en IOC, AIS, ISSN, NIH y EFSA')}</div>
    <div className="supp-water">💧 {water}</div>
    {levels.map(([lvl, info]) => <div key={lvl}>
      <div className="supp-lvl-title" style={{ '--lvl': info.color }}><i />{info.label}</div>
      {SUPLEMENTOS.filter(f => f.level === lvl).map(f => <button key={f.id} type="button" className={'supp-item' + (selected === f.id ? ' sel' : '')} onClick={() => onPick(f.id)}>
        <div className="grow"><b>{f.name}</b><div className="small dim">{lvl === 'puntual' ? t('Solo información') : f.short}</div></div>
        {has(f.id) && <span className="supp-mine">✓ {t('la tomás')}</span>}
      </button>)}
    </div>)}
    <button type="button" className="supp-item supp-other" onClick={() => openConfig(null)}>＋ {t('Otro suplemento (cargalo vos)')}</button>
  </div>
}

function Guia({ initial }) {
  const [id, setId] = useState(initial)
  return <div className="supp-guide-cols">
    <div className={id ? 'supp-hide-phone' : ''}><Lista selected={id} onPick={setId} /></div>
    <div className={id ? '' : 'supp-hide-phone'}>{id ? <Ficha id={id} onBack={() => setId(null)} /> : <div className="dim supp-empty-pc">{t('Elegí un suplemento para ver su ficha.')}</div>}</div>
  </div>
}

export const openGuide = id => useUI.getState().openSheet(() => <Guia initial={id} />, { fullScreen: true })
```

- [ ] **Step 4: Estilos**

```css
.supp-water{background:color-mix(in srgb,var(--blue) 15%,transparent);border:1px solid color-mix(in srgb,var(--blue) 50%,transparent);border-radius:12px;padding:9px 10px;margin:10px 0;font-size:13px}
.supp-lvl-title{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin:14px 0 6px;color:var(--lvl);display:flex;align-items:center;gap:6px}
.supp-lvl-title i{width:9px;height:9px;border-radius:3px;background:var(--lvl)}
.supp-item{display:flex;align-items:center;gap:8px;width:100%;text-align:left;background:var(--surface-2);border:none;border-radius:10px;padding:9px 10px;margin:4px 0;color:inherit;font:inherit}
.supp-item.sel{outline:1.5px solid var(--acc)}
.supp-other{background:none;color:var(--acc)}
.supp-mine{font-size:11.5px;color:var(--acc)}
.supp-level{display:inline-block;font-size:10.5px;font-weight:700;border-radius:6px;padding:2px 7px;color:var(--lvl);background:color-mix(in srgb,var(--lvl) 18%,transparent)}
.supp-how{display:grid;grid-template-columns:22px 1fr;gap:6px;margin:5px 0}
.supp-list{margin:0;padding-left:18px}
.supp-back{color:var(--acc);background:none;border:none;padding:4px 0;font:inherit}
.supp-ficha .btn{width:100%;margin-top:14px}
@media (max-width:767px){.supp-hide-phone{display:none}}
@media (min-width:768px){.supp-guide-cols{display:grid;grid-template-columns:280px 1fr;gap:18px}.supp-back{display:none}}
```

- [ ] **Step 5: Correr y ver que pasa**

Run: `cd frontend && npx vitest run src/components/suplementos/GuiaSheet.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/suplementos/GuiaSheet.jsx frontend/src/components/suplementos/GuiaSheet.test.jsx frontend/src/index.css
git commit -m "feat(supplements): guide with single-page entries and water tip" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 12: Alta y configuración (un formulario)

**Files:**
- Create: `frontend/src/components/suplementos/ConfigSuplemento.jsx`
- Create: `frontend/src/components/suplementos/ConfigSuplemento.test.jsx`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Consumes: Tareas 1, 2, 8; `askInContext` de `../../lib/notif-ask.js` (leer su firma: `askInContext(uid, status, now)`; usarlo como lo usan los otros pedidos en contexto del repo — buscar `askInContext(` en `frontend/src` y copiar el patrón); `NumberField`, `Segmented`, `Switch`, `TextField`, `Button`.
- Produces: `openConfig(catalogId: string | null, itemId?: string): void` (`null` = suplemento propio; con `itemId` edita ese item).

Comportamiento (spec, "Alta y configuración" + maqueta A):
- Título "Agregar {nombre}" o "Editar {nombre}"; en uno propio, campo **Nombre** (máx. 40).
- Creatina y sin ningún item de creatina (activo o archivado): cartel arriba "⚡ ¿Recién empezás? Mirá la fase de carga en la guía: saturás en alrededor de 1 semana en vez de 3 a 4. Es opcional." con enlace "Ver en la guía ›" (`openGuide('creatina')`).
- **Dosis por día**: `NumberField` + unidad (fija desde la ficha; en propio e indicación, `Segmented`/chips con `UNITS`). Pista: "sugerido {min}–{max} {unidad}" (cafeína: con el peso, `caffeineRange`); indicación: "La que te indicó tu profesional". Precargada: `dose.suggested`; cafeína `caffeineRange(peso).min` (sin peso: 100). Fuera de rango → aviso amarillo "Está fuera de lo sugerido en la guía." (no bloquea).
- **Mi scoop** (solo si la unidad es `g`): "1 scoop = [__] g", pista "📦 Mirá la etiqueta de tu marca: dice cuántos gramos trae el scoop. Sin scoop, dejalo vacío."
- Proteína: además "Por scoop (de la etiqueta)": proteína, calorías, carbos, grasas (`NumberField` ×4), precargados con `macrosPerScoop`.
- **Tomas por día** (1–6, `Segmented` 1..6); precarga `doses` de la ficha.
- **Cuándo**: chips con `SLOTS`.
- **Qué días**: `Segmented` "Todos los días" / "Solo de entreno"; pista en creatina: "La creatina va todos los días, también los de descanso."
- **Recordatorio**: `Switch` + hora (`<input type="time">`, por defecto `09:00`). Al prenderlo, si `Notification.permission !== 'granted'`, disparar el pedido en contexto (`askInContext`).
- Vista previa: "En la tarjeta vas a ver: **{doseLabel(item)}**".
- Botón **Agregar** / **Guardar** → `saveItem({ id: itemId || newId(), catalogId, name, dose, unit, scoopG, doses, slot, days, reminderTime, meta })`; cierra y toast "Agregado" / "Guardado".
- En edición: **Dejar de tomar** (`archiveItem(id, true)`, toast "Lo archivamos. Tu historial queda guardado.") y **Eliminar** con `confirmSheet` ("¿Eliminar {nombre}? Se borra también su historial. No se puede deshacer.") → `deleteItem`.
- PC: dos columnas (`.supp-form-cols`).

- [ ] **Step 1: Tests que fallan**

```jsx
// frontend/src/components/suplementos/ConfigSuplemento.test.jsx
// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))
const { useStore } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { useSupplements } = await import('../../store/useSupplements.js')
const { setLang } = await import('../../lib/i18n.js')
const { openConfig } = await import('./ConfigSuplemento.jsx')

async function render(...args) {
  openConfig(...args)
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div'); document.body.appendChild(host)
  const r = createRoot(host)
  await act(async () => r.render(sheet.render(() => useUI.getState().closeSheet(sheet.id), { setOnBack: () => {} })))
  return host
}
const btn = (h, label) => [...h.querySelectorAll('button')].find(b => b.textContent.trim() === label)
beforeEach(async () => {
  await setLang('es'); globalThis.IS_REACT_ACT_ENVIRONMENT = true
  apiMock.mockReset(); apiMock.mockImplementation((url, o) => Promise.resolve({ item: { ...JSON.parse(o.body), status: 'active', createdAt: '2026-10-09T00:00:00Z' } }))
  useUI.setState({ sheets: [], toastMsg: '' })
  useStore.setState({ user: { id: 'ana' }, S: { ...useStore.getState().S, bodyweight: [{ d: '2026-10-09', w: 80 }] } })
  useSupplements.setState({ loaded: true, enabled: true, adult: 'adult', items: [], logs: [] })
})

describe('alta de suplemento', () => {
  it('creatina nueva: cartel de fase de carga, 5 g sugeridos y scoop', async () => {
    const h = await render('creatina')
    expect(h.textContent).toContain('¿Recién empezás?')
    expect(h.textContent).toContain('sugerido 3–5 g')
    expect(h.textContent).toContain('Mirá la etiqueta de tu marca')
    expect(h.textContent).toContain('1 scoop =')
  })
  it('sin cartel si ya tuvo creatina', async () => {
    useSupplements.setState({ items: [{ id: 'old', catalogId: 'creatina', status: 'archived' }] })
    expect((await render('creatina')).textContent).not.toContain('¿Recién empezás?')
  })
  it('cafeína: dosis precargada con el peso', async () => {
    const h = await render('cafeina')
    expect(h.querySelector('input[name="supp-dose"]').value).toBe('240')
  })
  it('guardar manda el item y lo suma al store', async () => {
    const h = await render('creatina')
    await act(async () => btn(h, 'Agregar').click())
    expect(apiMock).toHaveBeenCalledWith('/api/supplements/items', expect.objectContaining({ method: 'POST' }))
    const sent = JSON.parse(apiMock.mock.calls[0][1].body)
    expect(sent).toMatchObject({ catalogId: 'creatina', dose: 5, unit: 'g', doses: 1, days: 'daily' })
    expect(useSupplements.getState().items).toHaveLength(1)
  })
  it('suplemento propio: pide nombre', async () => {
    const h = await render(null)
    expect(h.querySelector('input[name="supp-name"]')).toBeTruthy()
  })
  it('indicación profesional: sin dosis sugerida', async () => {
    expect((await render('vitaminad')).textContent).toContain('La que te indicó tu profesional')
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `cd frontend && npx vitest run src/components/suplementos/ConfigSuplemento.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implementar `ConfigSuplemento.jsx`**

```jsx
// Alta y edición de un suplemento (spec, "Alta y configuración"): un solo formulario con lo sugerido ya
// cargado. Creatina nueva: cartel de fase de carga. Proteína: macros por scoop desde la etiqueta.
import { useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { useSupplements, saveItem, archiveItem, deleteItem, newId } from '../../store/useSupplements.js'
import { t } from '../../lib/i18n.js'
import { errorText } from '../../lib/errors.js'
import { lastBW } from '../../lib/history.js'
import { askInContext } from '../../lib/notif-ask.js'
import { fichaById, SLOTS, UNITS } from '../../lib/suplementos-data.js'
import { caffeineRange, doseLabel, itemName } from '../../lib/suplementos.js'
import { Button, NumberField, Segmented, Switch, TextField } from '../ui.jsx'

const openGuide = id => import('./GuiaSheet.jsx').then(m => m.openGuide(id))

function Config({ catalogId, itemId, close }) {
  const S = useStore(s => s.S)
  const uid = useStore(s => s.user?.id)
  const items = useSupplements(s => s.items)
  const f = catalogId ? fichaById(catalogId) : null
  const editing = itemId ? items.find(i => i.id === itemId) : null
  const weight = lastBW(S)?.w
  const range = catalogId === 'cafeina' ? caffeineRange(weight) : null
  const first = catalogId === 'creatina' && !items.some(i => i.catalogId === 'creatina')
  const [name, setName] = useState(editing?.name || '')
  const [dose, setDose] = useState(editing?.dose ?? (catalogId === 'cafeina' ? (range?.min || 100) : f?.dose?.suggested ?? null))
  const [unit, setUnit] = useState(editing?.unit || f?.unit || 'g')
  const [scoopG, setScoopG] = useState(editing?.scoopG ?? null)
  const [doses, setDoses] = useState(editing?.doses || f?.doses || 1)
  const [slot, setSlot] = useState(editing?.slot || f?.slot || 'any')
  const [days, setDays] = useState(editing?.days || f?.days || 'daily')
  const [remind, setRemind] = useState(!!editing?.reminderTime)
  const [time, setTime] = useState(editing?.reminderTime || '09:00')
  const [macros, setMacros] = useState(editing?.meta?.macros || f?.macrosPerScoop || null)
  const [busy, setBusy] = useState(false)
  const lo = range ? range.min : f?.dose?.min, hi = range ? range.max : f?.dose?.max
  const outOfRange = dose != null && lo != null && (dose < lo || dose > hi)
  const draft = { id: editing?.id || 'preview', catalogId, name: catalogId ? null : name.trim(), dose, unit, scoopG: unit === 'g' ? scoopG : null, doses, slot, days, reminderTime: remind ? time : null,
    meta: catalogId === 'proteina' && macros ? { macros: { proteina: macros.proteina, calorias: macros.calorias, carbos: macros.carbos, grasas: macros.grasas } } : null }
  const title = (editing ? t('Editar {0}', itemName(draft)) : t('Agregar {0}', f ? f.name.toLowerCase() : t('un suplemento')))
  const toast = msg => useUI.getState().toast(msg)
  const save = async () => {
    setBusy(true)
    try { await saveItem({ ...draft, id: editing?.id || newId() }); close(); toast(editing ? t('Guardado') : t('Agregado')) }
    catch (e) { toast(errorText(e, t('No se pudo guardar. Probá de nuevo.'))) }
    setBusy(false)
  }
  const toggleRemind = v => { setRemind(v); if (v && uid && typeof Notification !== 'undefined' && Notification.permission !== 'granted') askInContext(uid, 'supplement-reminder') }
  const archive = async () => { try { await archiveItem(editing.id, true); close(); toast(t('Lo archivamos. Tu historial queda guardado.')) } catch (e) { toast(errorText(e, t('No se pudo guardar. Probá de nuevo.'))) } }
  const remove = () => import('../../sheets.jsx').then(({ confirmSheet }) => confirmSheet({
    title: t('¿Eliminar {0}?', itemName(editing)), message: t('Se borra también su historial. No se puede deshacer.'), confirmText: t('Eliminar'), danger: true,
    onConfirm: async () => { try { await deleteItem(editing.id); close(); toast(t('Eliminado')) } catch (e) { toast(errorText(e, t('No se pudo eliminar'))) } }
  }))
  const field = (label, children, hint) => <div className="supp-field"><div className="supp-label">{t(label)}</div>{children}{hint && <div className="small dim">{hint}</div>}</div>
  const fixedUnit = f && f.level !== 'indicacion'
  return <div className="supp-config">
    <h3>{title}</h3>
    {first && <div className="supp-lock">⚡ <b>{t('¿Recién empezás?')}</b> {t('Mirá la fase de carga en la guía: saturás en alrededor de 1 semana en vez de 3 a 4. Es opcional.')} <button type="button" className="link" onClick={() => openGuide('creatina')}>{t('Ver en la guía ›')}</button></div>}
    <div className="supp-form-cols">
      <div>
        {!catalogId && field('Nombre', <TextField name="supp-name" maxLength={40} value={name} onChange={e => setName(e.target.value)} placeholder={t('Ej.: ashwagandha')} />)}
        {field('Dosis por día', <div className="row">
          <NumberField name="supp-dose" value={dose} nullable onChange={setDose} className="supp-num" />
          {fixedUnit ? <span className="dim">{UNITS.find(u => u.id === unit)?.label}</span>
            : <div className="chips">{UNITS.map(u => <button key={u.id} type="button" className={'chip nocap' + (unit === u.id ? ' on' : '')} onClick={() => setUnit(u.id)}>{u.label}</button>)}</div>}
        </div>, f?.level === 'indicacion' ? t('La que te indicó tu profesional') : lo != null ? `${t('sugerido')} ${lo}–${hi} ${UNITS.find(u => u.id === unit)?.label}` : null)}
        {outOfRange && <div className="supp-warn">{t('Está fuera de lo sugerido en la guía.')}</div>}
        {unit === 'g' && field('Mi scoop', <div className="row"><span className="dim">{t('1 scoop =')}</span><NumberField name="supp-scoop" value={scoopG} nullable onChange={setScoopG} className="supp-num" /><span className="dim">g</span></div>,
          '📦 ' + t('Mirá la etiqueta de tu marca: dice cuántos gramos trae el scoop. Sin scoop, dejalo vacío.'))}
        {catalogId === 'proteina' && macros && field('Por scoop (de la etiqueta)', <div className="supp-macros">
          {[['proteina', 'Proteína (g)'], ['calorias', 'Calorías'], ['carbos', 'Carbos (g)'], ['grasas', 'Grasas (g)']].map(([k, l]) =>
            <label key={k}><span className="small dim">{t(l)}</span><NumberField name={'supp-' + k} value={macros[k]} onChange={v => setMacros(m => ({ ...m, [k]: v }))} /></label>)}
        </div>)}
      </div>
      <div>
        {field('Tomas por día', <Segmented options={[1, 2, 3, 4, 5, 6].map(n => ({ value: n, label: String(n) }))} value={doses} onChange={setDoses} />)}
        {field('Cuándo', <div className="chips">{SLOTS.map(s => <button key={s.id} type="button" className={'chip nocap' + (slot === s.id ? ' on' : '')} onClick={() => setSlot(s.id)}>{t(s.label)}</button>)}</div>)}
        {field('Qué días', <Segmented options={[{ value: 'daily', label: t('Todos los días') }, { value: 'training', label: t('Solo de entreno') }]} value={days} onChange={setDays} />,
          catalogId === 'creatina' ? t('La creatina va todos los días, también los de descanso.') : null)}
        {field('Recordatorio', <div className="row"><Switch checked={remind} onChange={toggleRemind} label={t('Recordatorio')} />{remind && <input className="input supp-time" type="time" value={time} onChange={e => setTime(e.target.value || '09:00')} />}</div>)}
      </div>
    </div>
    <div className="small dim supp-preview">{t('En la tarjeta vas a ver:')} <b>{doseLabel(draft)}</b></div>
    <Button variant="primary" disabled={busy || (!catalogId && !name.trim()) || !(dose > 0) && f?.level !== 'indicacion'} onClick={save}>{editing ? t('Guardar') : t('Agregar')}</Button>
    {editing && <div className="supp-edit-actions">
      <Button variant="ghost" onClick={archive}>{t('Dejar de tomar')}</Button>
      <Button variant="ghost" className="danger" onClick={remove}>{t('Eliminar')}</Button>
    </div>}
  </div>
}

export const openConfig = (catalogId, itemId) => useUI.getState().openSheet(close => <Config catalogId={catalogId} itemId={itemId} close={close} />, { kind: 'panel' })
```

Revisar la firma real de `askInContext` en `frontend/src/lib/notif-ask.js` y la forma en que la usan sus llamadores (`grep -rn "askInContext(" frontend/src`); si su segundo parámetro no es un motivo libre, pasar lo que corresponda y documentarlo en el commit.

- [ ] **Step 4: Estilos**

```css
.supp-field{margin:10px 0}
.supp-num{max-width:110px}
.supp-macros{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.supp-time{max-width:120px;margin-left:10px}
.supp-preview{text-align:center;margin:12px 0 4px}
.supp-config>.btn.primary{width:100%}
.supp-edit-actions{display:flex;justify-content:space-between;margin-top:10px}
@media (min-width:768px){.supp-form-cols{display:grid;grid-template-columns:1fr 1fr;gap:0 20px}}
```

- [ ] **Step 5: Correr y ver que pasa**

Run: `cd frontend && npx vitest run src/components/suplementos/ConfigSuplemento.test.jsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/suplementos/ConfigSuplemento.jsx frontend/src/components/suplementos/ConfigSuplemento.test.jsx frontend/src/index.css
git commit -m "feat(supplements): single-form add and edit with scoop, protein macros and reminder" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 13: Cafeína del día (mate por ½ termo)

**Files:**
- Create: `frontend/src/components/suplementos/CafeinaSheet.jsx`
- Create: `frontend/src/components/suplementos/CafeinaSheet.test.jsx`

**Interfaces:**
- Consumes: `CAFFEINE_SOURCES`, `MATE_TIPS` (Tarea 1); `caffeineTotal`, `isOverCaffeine` (Tarea 2); `addLog`, `removeLog`, `useSupplements` (Tarea 8).
- Produces: `openCaffeine(): void` (hoja normal; en PC, `kind: 'panel'`).

Comportamiento (spec, "Cafeína del día" + maqueta v2):
- Título "Cafeína de hoy"; total "≈ X mg" + "de 400 · estimado" + barra (roja si se pasa) + "Tocá cada vez que tomás. Se suma solo."
- Grilla de 6 botones (`CAFFEINE_SOURCES`): emoji, nombre, "~{mg} mg" (o `unitLabel` si `mg` es null); el del mate muestra "~{mg} mg por ½ termo". Cada toque con `mg` fijo → `addLog({ source, date: today, amount: mg })`. Contador "×N" de los consumos de hoy de esa fuente.
- **Pre-entreno**: abre un campo "mg por scoop (de la etiqueta)" precargado con el `amount` del último consumo `preentreno` (si hay) y botón "Sumar"; **Otro**: "mg" + "Sumar".
- **↶ Eliminar último consumo** (deshabilitado si no hay consumos hoy), con el detalle "(🧉 Mate 11:40)"; borra el último consumo de cafeína de hoy (fuente rápida o item de cafeína), por `createdAt`.
- "Consumos de hoy": lista con emoji, nombre, hora (`createdAt` local, HH:MM), "~mg" y **Eliminar**.
- "Sobre el mate": los `MATE_TIPS`.
- Aviso de exceso igual que la tarjeta.

- [ ] **Step 1: Tests que fallan**

```jsx
// frontend/src/components/suplementos/CafeinaSheet.test.jsx
// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))
const { useStore } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { useSupplements } = await import('../../store/useSupplements.js')
const { setLang } = await import('../../lib/i18n.js')
const { CAFFEINE_SOURCES } = await import('../../lib/suplementos-data.js')
const { openCaffeine } = await import('./CafeinaSheet.jsx')

const TODAY = '2026-10-09'
const MATE = CAFFEINE_SOURCES.find(s => s.id === 'mate').mg
async function render() {
  openCaffeine()
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div'); document.body.appendChild(host)
  const r = createRoot(host)
  await act(async () => r.render(sheet.render(() => {}, { setOnBack: () => {} })))
  return host
}
const btn = (h, re) => [...h.querySelectorAll('button')].find(b => re.test(b.textContent))
beforeEach(async () => {
  await setLang('es'); globalThis.IS_REACT_ACT_ENVIRONMENT = true
  apiMock.mockReset(); apiMock.mockImplementation((url, o) => Promise.resolve(url.endsWith('/log') ? { log: { ...JSON.parse(o.body), createdAt: new Date().toISOString() } } : { ok: true }))
  useUI.setState({ sheets: [] }); useStore.setState({ user: { id: 'ana' } })
  useSupplements.setState({ loaded: true, enabled: true, today: TODAY, items: [], logs: [] })
})

describe('cafeína del día', () => {
  it('cada toque del mate suma ½ termo y muestra ×N', async () => {
    const h = await render()
    await act(async () => btn(h, /Mate/).click())
    await act(async () => btn(h, /Mate/).click())
    expect(useSupplements.getState().logs.filter(l => l.source === 'mate')).toHaveLength(2)
    expect(btn(h, /Mate/).textContent).toContain('×2')
    expect(h.textContent).toContain(`≈ ${MATE * 2} mg`)
    expect(h.textContent).toContain('por ½ termo')
  })
  it('"Eliminar último consumo" borra el último', async () => {
    useSupplements.setState({ logs: [
      { id: 'a', source: 'cafe', date: TODAY, amount: 90, createdAt: '2026-10-09T11:00:00Z' },
      { id: 'b', source: 'mate', date: TODAY, amount: MATE, createdAt: '2026-10-09T14:40:00Z' }] })
    const h = await render()
    await act(async () => btn(h, /Eliminar último consumo/).click())
    expect(useSupplements.getState().logs.map(l => l.id)).toEqual(['a'])
  })
  it('lista de hoy con "Eliminar" en cada uno y consejos del mate', async () => {
    useSupplements.setState({ logs: [{ id: 'a', source: 'cafe', date: TODAY, amount: 90, createdAt: '2026-10-09T11:00:00Z' }] })
    const h = await render()
    expect(h.textContent).toContain('Consumos de hoy')
    expect([...h.querySelectorAll('button')].filter(b => b.textContent.trim() === 'Eliminar')).toHaveLength(1)
    expect(h.textContent).toContain('no deshidrata')
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `cd frontend && npx vitest run src/components/suplementos/CafeinaSheet.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implementar `CafeinaSheet.jsx`**

```jsx
// Cafeína del día (spec, "Cafeína del día"): cada toque suma un consumo (el mate es ½ termo), con
// "Eliminar último consumo", la lista de hoy y consejos del mate.
import { useState } from 'react'
import { useUI } from '../../store/useUI.js'
import { useSupplements, addLog, removeLog } from '../../store/useSupplements.js'
import { t } from '../../lib/i18n.js'
import { errorText } from '../../lib/errors.js'
import { todayISO } from '../../lib/format.js'
import { CAFFEINE_SOURCES, MATE_TIPS } from '../../lib/suplementos-data.js'
import { caffeineTotal, isOverCaffeine, itemName } from '../../lib/suplementos.js'
import { Button, NumberField } from '../ui.jsx'

const hhmm = iso => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

function Cafeina() {
  const st = useSupplements()
  const today = st.today || todayISO()
  const [ask, setAsk] = useState(null)   // 'preentreno' | 'otro'
  const [mg, setMg] = useState(null)
  const toast = e => useUI.getState().toast(errorText(e, t('No se pudo guardar. Probá de nuevo.')))
  const caffeineItems = new Set(st.items.filter(i => i.catalogId === 'cafeina').map(i => i.id))
  const todays = st.logs.filter(l => l.date === today && (l.source || caffeineItems.has(l.itemId))).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
  const total = caffeineTotal(st.logs, st.items, today), over = isOverCaffeine(total)
  const src = id => CAFFEINE_SOURCES.find(s => s.id === id)
  const labelOf = l => l.source ? `${src(l.source)?.emoji} ${t(src(l.source)?.label)}` : `💊 ${itemName(st.items.find(i => i.id === l.itemId) || {})}`
  const add = (source, amount) => addLog({ source, date: today, amount }).catch(toast)
  const tap = s => {
    if (s.mg != null) return add(s.id, s.mg)
    setAsk(s.id)
    setMg(s.id === 'preentreno' ? (st.logs.filter(l => l.source === 'preentreno').at(-1)?.amount ?? null) : null)
  }
  const last = todays.at(-1)
  return <div className="supp-caffeine-sheet">
    <h3>{t('Cafeína de hoy')}</h3>
    <div className="row"><b className="supp-big">≈ {total} mg</b><span className="small dim grow">{t('de 400 · estimado')}</span></div>
    <div className={'supp-bar' + (over ? ' over' : '')}><i style={{ width: Math.min(100, total / 4) + '%' }} /></div>
    {over && <div className="supp-warn">{t('Hoy vas {0} mg: más de lo recomendado para un día. Si te cuesta dormir, cortá la cafeína unas 6 h antes.', total)}</div>}
    <div className="small dim">{t('Tocá cada vez que tomás. Se suma solo.')}</div>
    <div className="supp-quick-grid">{CAFFEINE_SOURCES.map(s => {
      const n = todays.filter(l => l.source === s.id).length
      return <button key={s.id} type="button" className="supp-q" onClick={() => tap(s)}>
        {n > 0 && <span className="supp-q-n">×{n}</span>}
        <span className="supp-q-e" aria-hidden="true">{s.emoji}</span>{t(s.label)}
        <span className="small dim">{s.mg != null ? (s.id === 'mate' ? t('~{0} mg por ½ termo', s.mg) : `~${s.mg} mg`) : t(s.unitLabel)}</span>
      </button>
    })}</div>
    {ask && <div className="supp-ask row">
      <span className="small">{ask === 'preentreno' ? t('mg por scoop (de la etiqueta)') : 'mg'}</span>
      <NumberField name="supp-mg" value={mg} nullable onChange={setMg} className="supp-num" />
      <Button size="sm" variant="primary" disabled={!(mg > 0)} onClick={() => { add(ask, mg); setAsk(null) }}>{t('Sumar')}</Button>
    </div>}
    <button type="button" className="supp-undo" disabled={!last} onClick={() => last && removeLog(last.id).catch(toast)}>
      ↶ {t('Eliminar último consumo')}{last && <span className="small dim"> ({labelOf(last)} {hhmm(last.createdAt)})</span>}
    </button>
    {todays.length > 0 && <>
      <div className="supp-sec">{t('Consumos de hoy')}</div>
      {todays.slice().reverse().map(l => <div key={l.id} className="supp-row">
        <span className="grow">{labelOf(l)} · {hhmm(l.createdAt)}</span>
        <span className="small dim">~{Math.round(l.amount)} mg</span>
        <button type="button" className="link danger" onClick={() => removeLog(l.id).catch(toast)}>{t('Eliminar')}</button>
      </div>)}
    </>}
    <div className="supp-sec">{t('Sobre el mate')}</div>
    {MATE_TIPS.map(tip => <div key={tip} className="supp-tip">{tip}</div>)}
  </div>
}

export const openCaffeine = () => useUI.getState().openSheet(() => <Cafeina />, { kind: 'panel' })
```

Estilos:

```css
.supp-big{font-size:20px}
.supp-quick-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin:8px 0}
.supp-q{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;background:var(--surface-2);border:none;border-radius:11px;padding:9px 4px;color:inherit;font:inherit;font-size:12.5px}
.supp-q-e{font-size:20px}
.supp-q-n{position:absolute;top:5px;right:6px;background:var(--orange);color:#000;font-weight:800;font-size:11px;border-radius:9px;padding:0 6px}
.supp-ask{gap:8px;margin:6px 0}
.supp-undo{width:100%;border:1px solid var(--surface-3);background:none;border-radius:10px;padding:8px;color:var(--red);font:inherit;margin:6px 0}
.supp-undo:disabled{opacity:.4}
.supp-tip{background:color-mix(in srgb,var(--acc) 12%,transparent);border-radius:10px;padding:8px 10px;font-size:12.5px;margin:5px 0}
```

- [ ] **Step 4: Correr y ver que pasa**

Run: `cd frontend && npx vitest run src/components/suplementos/CafeinaSheet.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/suplementos/CafeinaSheet.jsx frontend/src/components/suplementos/CafeinaSheet.test.jsx frontend/src/index.css
git commit -m "feat(supplements): caffeine of the day with mate per half thermos" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 14: Mis suplementos (historial, heatmap, días anteriores)

**Files:**
- Create: `frontend/src/components/suplementos/MisSuplementos.jsx`
- Create: `frontend/src/components/suplementos/MisSuplementos.test.jsx`

**Interfaces:**
- Consumes: `HeatmapGrid` (Tarea 9); `streakOf`, `adherence30`, `dayLevel`, `takenOn`, `isDueOn`, `isTrainingDay`, `canLogDate`, `addDays`, `doseLabel`, `itemName`, `perTake` (Tarea 2); `addLog`, `removeLog`, `archiveItem` (Tarea 8); `openConfig` (Tarea 12, import dinámico).
- Produces: `openMine(): void` (hoja `fullScreen`; PC `kind: 'panel'` con lista + detalle).

Comportamiento (spec, "Seguimiento"):
- Lista "Activos" y "Archivados" (estos con **Volver a tomar** → `archiveItem(id, false)`).
- Arriba, un heatmap combinado (26 semanas) con nivel por día = el **mínimo** nivel entre los items que tocaban (0 si ninguno tocaba). Leyenda "Menos" / "Cumplido".
- Detalle de un item: nombre, `doseLabel`, "🔥 Racha: N días", "Últimos 30 días: X %" (o "Sin días todavía"), heatmap del item (52 semanas, `dayLevel`), y "Últimos 7 días": una fila por día de hoy a hoy−7 (solo los que tocaban), con un check por toma (marca/desmarca con `addLog`/`removeLog` en esa fecha; `canLogDate` lo garantiza). Botón **Configurar** → `openConfig(item.catalogId, item.id)`.

- [ ] **Step 1: Tests que fallan**

```jsx
// frontend/src/components/suplementos/MisSuplementos.test.jsx
// @vitest-environment happy-dom
import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'
const apiMock = vi.hoisted(() => vi.fn())
vi.mock('../../lib/api.js', async importOriginal => ({ ...(await importOriginal()), api: apiMock }))
const { useStore } = await import('../../store/useStore.js')
const { useUI } = await import('../../store/useUI.js')
const { useSupplements } = await import('../../store/useSupplements.js')
const { setLang } = await import('../../lib/i18n.js')
const { openMine } = await import('./MisSuplementos.jsx')

const TODAY = '2026-10-09'
const crea = { id: 'crea0001', catalogId: 'creatina', dose: 5, unit: 'g', scoopG: 5, doses: 1, slot: 'morning', days: 'daily', status: 'active', createdAt: '2026-09-01T00:00:00Z' }
async function render() {
  openMine()
  const sheet = useUI.getState().sheets.at(-1)
  const host = document.createElement('div'); document.body.appendChild(host)
  const r = createRoot(host)
  await act(async () => r.render(sheet.render(() => {}, { setOnBack: () => {} })))
  return host
}
beforeEach(async () => {
  await setLang('es'); globalThis.IS_REACT_ACT_ENVIRONMENT = true
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 9, 9, 12))
  apiMock.mockReset(); apiMock.mockImplementation((url, o) => Promise.resolve(url.endsWith('/log') ? { log: JSON.parse(o.body) } : { ok: true }))
  useUI.setState({ sheets: [] }); useStore.setState({ user: { id: 'ana' }, S: { ...useStore.getState().S, workouts: [], week: {}, dayPlan: {} } })
  const logs = ['2026-10-06', '2026-10-07', '2026-10-08'].map((d, i) => ({ id: 'l' + i, itemId: 'crea0001', date: d, amount: 5 }))
  useSupplements.setState({ loaded: true, enabled: true, today: TODAY, items: [crea, { ...crea, id: 'old00001', catalogId: 'omega3', status: 'archived' }], logs })
})

describe('mis suplementos', () => {
  it('racha, cumplimiento y archivados', async () => {
    const h = await render()
    await act(async () => [...h.querySelectorAll('button')].find(b => b.textContent.includes('Creatina')).click())
    expect(h.textContent).toContain('Racha: 3 días')
    expect(h.textContent).toContain('Últimos 30 días')
    expect(h.textContent).toContain('Archivados')
    expect(h.querySelectorAll('.hm-c').length).toBeGreaterThan(0)
  })
  it('marca un día anterior dentro de los 7 días', async () => {
    const h = await render()
    await act(async () => [...h.querySelectorAll('button')].find(b => b.textContent.includes('Creatina')).click())
    await act(async () => h.querySelector('[aria-label="Marcar creatina el 2026-10-05"]').click())
    expect(useSupplements.getState().logs.some(l => l.date === '2026-10-05')).toBe(true)
    expect(h.querySelector('[aria-label="Marcar creatina el 2026-10-01"]')).toBeNull()
  })
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `cd frontend && npx vitest run src/components/suplementos/MisSuplementos.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implementar `MisSuplementos.jsx`**

```jsx
// Mis suplementos (spec, "Seguimiento"): heatmap combinado, y por suplemento racha, cumplimiento de 30
// días, su heatmap y los últimos 7 días para marcar lo que te olvidaste. Archivados con "Volver a tomar".
import { useState } from 'react'
import { useStore } from '../../store/useStore.js'
import { useUI } from '../../store/useUI.js'
import { useSupplements, addLog, removeLog, archiveItem } from '../../store/useSupplements.js'
import { t } from '../../lib/i18n.js'
import { errorText } from '../../lib/errors.js'
import { todayISO } from '../../lib/format.js'
import { streakOf, adherence30, dayLevel, takenOn, isDueOn, isTrainingDay, canLogDate, addDays, doseLabel, itemName, perTake } from '../../lib/suplementos.js'
import { HeatmapGrid } from '../Heatmap.jsx'
import { Button, Check } from '../ui.jsx'

const openConfig = (c, id) => import('./ConfigSuplemento.jsx').then(m => m.openConfig(c, id))

function Detalle({ item, onBack }) {
  const S = useStore(s => s.S)
  const st = useSupplements()
  const today = st.today || todayISO()
  const train = iso => isTrainingDay(S, iso)
  const toast = e => useUI.getState().toast(errorText(e, t('No se pudo guardar. Probá de nuevo.')))
  const streak = streakOf(item, st.logs, today, train), adh = adherence30(item, st.logs, today, train)
  const name = itemName(item)
  const days = Array.from({ length: 8 }, (_, i) => addDays(today, -i)).filter(iso => canLogDate(iso, today) && isDueOn({ ...item, status: 'active' }, iso, train(iso)))
  return <div className="supp-detail">
    {onBack && <button type="button" className="link supp-back" onClick={onBack}>‹ {t('Mis suplementos')}</button>}
    <h3>{name}</h3>
    <div className="small dim">{doseLabel(item)}</div>
    <div className="supp-stats"><span>🔥 {t('Racha: {0} días', streak)}</span><span>{adh == null ? t('Sin días todavía') : t('Últimos 30 días: {0} %', adh)}</span></div>
    <HeatmapGrid weeks={52} levelOf={iso => dayLevel(item, st.logs, iso, train)} titleOf={iso => `${iso} · ${takenOn(st.logs, item.id, iso)}/${item.doses || 1}`} legend={[t('Menos'), t('Cumplido')]} />
    {item.status === 'active' && <>
      <div className="supp-sec">{t('Últimos 7 días')}</div>
      {days.map(iso => {
        const taken = takenOn(st.logs, item.id, iso)
        return <div key={iso} className="supp-row">
          <span className="grow">{iso === today ? t('Hoy') : iso}</span>
          {Array.from({ length: item.doses || 1 }, (_, k) => <Check key={k} checked={k < taken}
            aria-label={(item.doses || 1) === 1 ? t('Marcar {0} el {1}', name.split(' ')[0].toLowerCase(), iso) : t('Toma {0} de {1} el {2}', k + 1, name, iso)}
            onChange={v => v ? addLog({ itemId: item.id, date: iso, amount: perTake(item) }).catch(toast)
              : removeLog(st.logs.filter(l => l.itemId === item.id && l.date === iso).at(-1).id).catch(toast)} />)}
        </div>
      })}
      <Button onClick={() => openConfig(item.catalogId, item.id)}>{t('Configurar')}</Button>
    </>}
  </div>
}

function Mis() {
  const S = useStore(s => s.S)
  const st = useSupplements()
  const [sel, setSel] = useState(null)
  const today = st.today || todayISO()
  const train = iso => isTrainingDay(S, iso)
  const active = st.items.filter(i => i.status === 'active'), archived = st.items.filter(i => i.status === 'archived')
  const combined = iso => { const due = active.filter(i => isDueOn(i, iso, train(iso))); return due.length ? Math.min(...due.map(i => dayLevel(i, st.logs, iso, train))) : 0 }
  const item = st.items.find(i => i.id === sel)
  const toast = e => useUI.getState().toast(errorText(e, t('No se pudo guardar. Probá de nuevo.')))
  return <div className="supp-guide-cols">
    <div className={item ? 'supp-hide-phone' : ''}>
      <h3>{t('Mis suplementos')}</h3>
      {active.length > 0 && <HeatmapGrid weeks={26} levelOf={combined} titleOf={iso => iso} legend={[t('Menos'), t('Cumplido')]} />}
      <div className="supp-sec">{t('Activos')}</div>
      {active.length ? active.map(i => <button key={i.id} type="button" className={'supp-item' + (sel === i.id ? ' sel' : '')} onClick={() => setSel(i.id)}>
        <div className="grow"><b>{itemName(i)}</b><div className="small dim">{doseLabel(i)}</div></div>
        <span className="supp-streak">🔥 {streakOf(i, st.logs, today, train)}</span>
      </button>) : <div className="small dim">{t('Todavía no agregaste suplementos.')}</div>}
      {archived.length > 0 && <>
        <div className="supp-sec">{t('Archivados')}</div>
        {archived.map(i => <div key={i.id} className="supp-item">
          <button type="button" className="grow link" onClick={() => setSel(i.id)}><b>{itemName(i)}</b></button>
          <Button size="sm" onClick={() => archiveItem(i.id, false).catch(toast)}>{t('Volver a tomar')}</Button>
        </div>)}
      </>}
    </div>
    <div className={item ? '' : 'supp-hide-phone'}>{item ? <Detalle item={item} onBack={() => setSel(null)} /> : <div className="dim supp-empty-pc">{t('Elegí un suplemento para ver su historial.')}</div>}</div>
  </div>
}

export const openMine = () => useUI.getState().openSheet(() => <Mis />, { fullScreen: true })
```

Estilos: `.supp-stats{display:flex;gap:14px;margin:8px 0 10px;font-size:13px}`.

- [ ] **Step 4: Correr y ver que pasa**

Run: `cd frontend && npx vitest run src/components/suplementos/MisSuplementos.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/suplementos/MisSuplementos.jsx frontend/src/components/suplementos/MisSuplementos.test.jsx frontend/src/index.css
git commit -m "feat(supplements): history with streak, 30-day adherence, heatmap and last 7 days" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 15: Interruptor del owner y textos legales

**Files:**
- Modify: `frontend/src/views/admin/Acceso.jsx` (tarjeta `SupplementsToggleCard`, solo owner)
- Modify: `frontend/src/views/admin/Approval.test.jsx` o crear `frontend/src/views/admin/SupplementsToggle.test.jsx`
- Modify: `frontend/src/components/PrivacyNotice.jsx`, `frontend/src/components/TermsNotice.jsx`
- Modify: `frontend/src/components/LegalNotices.test.jsx`
- Modify: `api/legal.js` (`LEGAL_VERSION`)

**Interfaces:**
- Consumes: `GET/PUT /api/owner/supplements` (Tarea 5).

- [ ] **Step 1: Tests que fallan**

`frontend/src/views/admin/SupplementsToggle.test.jsx`: montar `Acceso` como lo hace `Approval.test.jsx` (mismo `apiMock`, contexto del layout con `useOutletContext`; copiar su `mount`). Casos:

```jsx
it('el owner ve el interruptor de suplementos y lo apaga con confirmación', async () => {
  // apiMock: '/api/owner/supplements' GET → { enabled: true }; PUT → { enabled: false }
  // 1) texto "Guía y seguimiento de suplementos" visible
  // 2) clic en el Switch → confirmSheet → "Desactivar" → apiMock llamado con ('/api/owner/supplements', { method: 'PUT', body: JSON.stringify({ enabled: false }) })
})
it('un admin que no es owner no lo ve', async () => { /* user sin owner → no aparece el texto */ })
```

En `LegalNotices.test.jsx`, agregar:

```jsx
it('privacidad y términos mencionan los suplementos', async () => {
  // renderizar PrivacyNotice y TermsNotice como los tests existentes del archivo
  // expect(privacy).toContain('suplementos'); expect(terms).toContain('Guía de suplementos')
})
```

- [ ] **Step 2: Correr y ver que falla**

Run: `cd frontend && npx vitest run src/views/admin/SupplementsToggle.test.jsx src/components/LegalNotices.test.jsx`
Expected: FAIL.

- [ ] **Step 3: Implementar**

`Acceso.jsx`, después de `BillingToggleCard`:

```jsx
// Suplementos (owner): la guía y el seguimiento en Nutrición. Apagarlo no borra datos.
function SupplementsToggleCard() {
  const toast = useUI(s => s.toast)
  const [enabled, setEnabled] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api('/api/owner/supplements').then(d => setEnabled(d.enabled)).catch(() => setEnabled(null)) }, [])
  const put = value => {
    setBusy(true)
    api('/api/owner/supplements', { method: 'PUT', body: JSON.stringify({ enabled: value }) })
      .then(d => { setEnabled(d.enabled); toast(d.enabled ? t('Suplementos activados') : t('Suplementos desactivados')) })
      .catch(e => toast(errorText(e, t('Failed to save setting'))))
      .finally(() => setBusy(false))
  }
  const change = v => v ? put(true) : confirmSheet({
    title: t('¿Desactivar los suplementos?'),
    message: t('Los socios dejan de ver la guía, la tarjeta y los recordatorios de suplementos. No se borra ningún dato: al volver a activarlo, todo sigue como estaba.'),
    confirmText: t('Desactivar'), danger: true, onConfirm: () => put(false)
  })
  if (enabled === null) return null
  return <div className="card">
    <div className="row between">
      <div><h3 style={{ margin: 0 }}>{t('Guía y seguimiento de suplementos')}</h3>
        <div className="small dim">{t('En Nutrición: una guía basada en evidencia y el registro de lo que toma cada socio. Solo lo ve cada socio, no el staff.')}</div></div>
      <Switch checked={enabled} disabled={busy} onChange={change} label={t('Guía y seguimiento de suplementos')} />
    </div>
  </div>
}
```

Montarla solo para el owner, después de `<BillingToggleCard … />`: `{user?.owner && <SupplementsToggleCard />}` (usar la variable de usuario que ya tenga el componente; si no la tiene, `const user = useStore(s => s.user)`). Importar `Switch` si no está importado.

`PrivacyNotice.jsx`: en la lista de datos de salud (línea con "peso corporal, edad, género, altura, lesiones y nutrición"), agregar "y los suplementos que registres"; en el párrafo de datos sensibles, una oración: "Los suplementos que registres son un dato de salud: solo los ves vos (el staff del gimnasio no tiene acceso) y se borran con "Borrar mis datos de salud"." Actualizar `HEALTH_DATA_LABEL` a `'peso, edad, género, lesiones, nutrición y suplementos'`.

`TermsNotice.jsx`, dentro de `<Sect title={t('Salud y entrenamiento')}>`, un párrafo más:

```jsx
      <p>{t('La Guía de suplementos es información general basada en publicaciones científicas (IOC, AIS, ISSN, NIH y EFSA). No es consejo médico, no recomienda marcas ni productos y no reemplaza a un profesional de la salud. Las dosis son rangos generales: si tenés una condición de salud, estás embarazada o en lactancia, o tomás medicación, consultá antes de usar suplementos.')}</p>
```

`api/legal.js`: `export const LEGAL_VERSION = '<fecha del commit, AAAA-MM-DD>';` y actualizar los tests que tengan la versión anterior fija (`grep -rn "2026-10-04" api frontend/src`): solo los que se refieren a `LEGAL_VERSION` (no las fechas de clases o cierres que casualmente coinciden).

- [ ] **Step 4: Correr y ver que pasa**

Run: `cd frontend && npx vitest run src/views/admin src/components/LegalNotices.test.jsx` y `cd api && node --test privacy.http.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/views/admin frontend/src/components/PrivacyNotice.jsx frontend/src/components/TermsNotice.jsx frontend/src/components/LegalNotices.test.jsx api/legal.js
git commit -m "feat(supplements): owner switch and legal texts for the supplements guide" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push
```

---

### Task 16: Verificación completa y prueba en el navegador

**Files:** ninguno nuevo (arreglos que aparezcan).

- [ ] **Step 1: Suites completas**

```bash
cd api && npm test
cd ../frontend && npm test && npm run build && node scripts/check-locales.mjs && node scripts/check-source-strings.mjs
```

Expected: todo en verde (`check-source-strings` es informativo: revisar que no sume textos nuevos sin traducir más allá de los del módulo, que están en español a propósito).

- [ ] **Step 2: Dev en el navegador (celular y PC, claro y oscuro)**

Levantar el dev local (preview `name` de `.claude/launch.json`; si no existe, crearlo con el comando de `frontend/package.json` `dev` + la API) y recorrer, con un socio con consentimiento de salud y peso cargado:

1. Nutrición: la tarjeta entre Peso corporal y Resumen nutricional, con candado → "Leer el aviso" → sin "Ahora no"; cerrar con el gesto atrás → sigue el candado; aceptar.
2. Guía: agua arriba; ficha de creatina (cómo tomarla primero, carga, precauciones, fuentes); cafeína con el rango del peso; quemadores sin "Agregar".
3. Agregar creatina (cartel de carga, scoop 5 g) → la tarjeta muestra "1 scoop · 5 g" en "Mañana"; marcar y desmarcar; beta-alanina con 2 tomas (puntos).
4. Cafeína: tocar mate 3 veces (×3), café 1; "Eliminar último consumo"; pasarse de 400 → barra roja y aviso.
5. Proteína: marcar la toma → aparece la comida en Nutrición y suma a la meta; desmarcar → desaparece.
6. Mis suplementos: racha, 30 días, heatmap, marcar un día de hace 3 días; no aparece hace 8.
7. Sin conexión (DevTools offline): marcar una toma → queda; volver online → se sincroniza (recargar y sigue).
8. Owner: Admin → Acceso → apagar suplementos → el socio no ve la tarjeta; prender.
9. Menor (edad 15 en el perfil): solo la guía.
10. Teclado en celular: el formulario de alta con el campo de scoop no queda tapado.
11. PC: tarjeta en dos columnas, guía con lista + ficha, alta en dos columnas.

Arreglar lo que falle con su test y commit (`fix(supplements): …`).

- [ ] **Step 3: Push final y aviso**

```bash
git push
```

Avisar al usuario: rama lista para su prueba en dev (`~/hub/lauyim-dev`); **no** mergear a `main` sin su pedido, y **no** llevar a producción hasta la revisión del abogado (aviso, privacidad y términos).
