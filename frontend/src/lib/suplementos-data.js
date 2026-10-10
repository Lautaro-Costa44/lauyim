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

// mg por porción (EFSA 2015). El mate es por ½ termo y siempre "estimado" (cuenta en docs/suplementos-fuentes.md).
export const CAFFEINE_SOURCES = [
  { id: 'mate', label: 'Mate', emoji: '🧉', unitLabel: '½ termo', mg: 130 },
  { id: 'cafe', label: 'Café', emoji: '☕', unitLabel: 'taza', mg: 90 },
  { id: 'espresso', label: 'Espresso', emoji: '☕', unitLabel: 'pocillo', mg: 80 },
  { id: 'energizante', label: 'Energizante', emoji: '⚡', unitLabel: 'lata 250 ml', mg: 80 },
  { id: 'capsula', label: 'Cápsula', emoji: '💊', unitLabel: 'mg de tu cápsula', mg: null },
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
const IOC = 'IOC Consensus Statement 2018 (Maughan et al., BJSM)'
const AIS = g => `AIS Sports Supplement Framework, grupo ${g}`
const NIH = 'NIH Office of Dietary Supplements'
const BUY = 'Buscá registro ANMAT y, si podés, un sello de control de terceros (Informed Sport o NSF Certified for Sport): controlan que no tenga sustancias que no dice la etiqueta.'
const MINOR = 'Menores de 18: solo con supervisión profesional.'
const PROF = 'Tomá la dosis que te indicó tu médico o nutricionista, en el momento que te indicó.'

export const SUPLEMENTOS = [
  {
    id: 'creatina', name: 'Creatina monohidrato', short: 'Fuerza y masa muscular', level: 'funciona', ais: 'A', trackable: true,
    unit: 'g', dose: { min: 3, max: 5, suggested: 5 }, dayMax: 20, doses: 1, slot: 'any', days: 'daily',
    intro: 'Mejora la fuerza y la masa muscular cuando entrenás con pesas. Es de los suplementos más estudiados.',
    howTo: [
      { icon: '⚖️', text: '3 a 5 g por día, todos los días (también los de descanso).' },
      { icon: '🥄', text: '1 scoop: fijate en la etiqueta cuántos gramos trae el tuyo (suelen ser 3 o 5 g). Sin scoop: 1 cucharadita de té al ras son unos 3 a 5 g (aproximado: mejor scoop o balanza).' },
      { icon: '💧', text: 'Disolvela en 200 a 300 ml de agua, jugo o leche, o mezclala en tu batido o yogur. Tibio se disuelve mejor. Preparala en el momento: disuelta por días se degrada.' },
      { icon: '🕐', text: 'A cualquier hora. Lo que importa es tomarla todos los días. Con una comida está bien.' },
      { icon: '🤷', text: '¿Te olvidaste? Seguí al otro día con lo normal. No dupliques.' },
    ],
    loading: 'Fase de carga, para cuando recién empezás (o retomás después de semanas sin tomarla): unos 20 g por día en 4 dosis de 5 g, durante 5 a 7 días, y después 3 a 5 g. Es opcional: sin carga llegás al mismo punto en 3 a 4 semanas.',
    evidence: 'Funciona: mejora la fuerza y la ganancia de masa muscular en entrenamiento de fuerza y en esfuerzos cortos e intensos.',
    forWhom: 'Para quien entrena fuerza o hace esfuerzos cortos e intensos. No hace falta para caminar o hacer cardio suave.',
    notice: 'Podés subir alrededor de medio kilo a un kilo las primeras semanas: es agua dentro del músculo, no grasa.',
    cautions: ['En personas sanas no hay evidencia de daño renal. Si tenés una enfermedad renal, consultá antes.', MINOR],
    buy: 'Elegí creatina monohidrato: es la estudiada. No hacen falta versiones "mejoradas". ' + BUY,
    sources: [IOC, AIS('A'), 'ISSN, Kreider et al. 2017', NIH], reviewed: R,
  },
  {
    // No se agrega como suplemento: se suma con un toque en la barra "Cafeína del día" (mate, café, cápsula…).
    id: 'cafeina', name: 'Cafeína', short: 'Rendimiento y energía', level: 'funciona', ais: 'A', trackable: false, caffeineBar: true,
    unit: 'mg', dosePerKg: { min: 3, max: 6 }, dayMax: 400, doses: 1, slot: 'pre', days: 'training',
    intro: 'Mejora el rendimiento en casi todo tipo de ejercicio y baja la sensación de esfuerzo.',
    howTo: [
      { icon: '⚖️', text: '3 a 6 mg por kilo de peso, unos 30 a 60 minutos antes de entrenar. Empezá por lo más bajo: más no rinde más.' },
      { icon: '💊', text: 'En cápsula de 100 o 200 mg, con agua. Con pre-entreno: mirá en la etiqueta cuántos mg trae el scoop y empezá con medio.' },
      { icon: '🧉', text: 'Contá también el mate, el café y los energizantes: en un día sano no pasés de 400 mg en total.' },
      { icon: '🌙', text: 'Si te cuesta dormir, no tomes cafeína en las 6 horas antes de acostarte.' },
    ],
    evidence: 'Funciona: mejora la resistencia, la fuerza y los esfuerzos repetidos, en personas entrenadas y no entrenadas.',
    forWhom: 'Para quien la tolera bien y quiere rendir más en una sesión puntual. No hace falta todos los días.',
    notice: 'Puede dar nervios, palpitaciones, malestar de estómago o costar dormir, sobre todo en dosis altas.',
    cautions: ['Embarazo y lactancia: no más de 200 mg por día en total.', 'Si tenés presión alta, arritmias, ansiedad o tomás medicación, consultá antes.', 'Menores de 18: no hay una cantidad segura definida.'],
    buy: 'Las cápsulas de cafeína pura permiten saber cuánto tomás. Con pre-entrenos, mirá cuánta cafeína trae cada scoop. ' + BUY,
    sources: [IOC, AIS('A'), 'ISSN, Guest et al. 2021', 'EFSA 2015 (seguridad de la cafeína)', 'Drake et al. 2013'], reviewed: R,
  },
  {
    id: 'proteina', name: 'Proteína en polvo', short: 'Llegar a tu meta de proteína', level: 'funciona', ais: 'A', trackable: true,
    unit: 'g', dose: { min: 20, max: 40, suggested: 30 }, dayMax: 120, doses: 1, slot: 'post', days: 'daily',
    macrosPerScoop: { gramos: 30, proteina: 24, calorias: 120, carbos: 3, grasas: 1.5 },
    intro: 'Es comida en polvo: sirve para llegar a la proteína del día cuando con la comida no alcanzás.',
    howTo: [
      { icon: '🥄', text: '1 scoop (unos 30 g de polvo, entre 20 y 25 g de proteína según la etiqueta).' },
      { icon: '💧', text: 'En 250 a 300 ml de agua o leche, o mezclada con yogur, avena o en un batido con fruta.' },
      { icon: '🕐', text: 'Cuando te quede cómodo: después de entrenar o para completar una comida con poca proteína.' },
      { icon: '🎯', text: 'Cada dosis que marcás suma a tu meta de proteína de Nutrición.' },
    ],
    evidence: 'Funciona para llegar a la proteína diaria (1,4 a 2 g por kilo si entrenás fuerza). No es mejor que la proteína de la comida: es más práctica.',
    forWhom: 'Para quien no llega a su meta de proteína con la comida. Si ya llegás, no suma.',
    cautions: ['Si tenés una enfermedad renal o te indicaron limitar la proteína, consultá antes.', 'Si tenés intolerancia a la lactosa, elegí una aislada o vegetal.'],
    buy: 'Mirá cuánta proteína trae cada scoop en la etiqueta (y cargalo en la app). ' + BUY,
    sources: [IOC, AIS('A'), 'ISSN, Jäger et al. 2017'], reviewed: R,
  },
  {
    id: 'betaalanina', name: 'Beta-alanina', short: 'Esfuerzos intensos de 1 a 4 minutos', level: 'funciona', ais: 'A', trackable: true,
    unit: 'g', dose: { min: 4, max: 6, suggested: 4.8 }, dayMax: 6.4, doses: 3, slot: 'meals', days: 'daily',
    intro: 'Aumenta la carnosina del músculo, que amortigua la acidez en los esfuerzos intensos de 1 a 4 minutos.',
    howTo: [
      { icon: '⚖️', text: '4 a 6 g por día, repartidos en dosis de 1,6 g (o en versión de liberación lenta).' },
      { icon: '🍽️', text: 'Con las comidas, con agua o jugo. Todos los días: el efecto aparece después de 2 a 4 semanas.' },
      { icon: '🤷', text: '¿Te olvidaste una dosis? Seguí con la siguiente, sin juntar.' },
    ],
    evidence: 'Funciona en esfuerzos intensos de 1 a 4 minutos (series largas, circuitos, remo, natación). Para fuerza máxima la evidencia es menor.',
    forWhom: 'Para quien hace series largas o circuitos intensos. Para pesas pesadas de pocas repeticiones aporta poco.',
    notice: 'Un hormigueo en la piel (cara, manos) un rato después de tomarla: es inofensivo y baja con dosis más chicas.',
    cautions: ['En personas sanas parece segura en las dosis recomendadas.', MINOR],
    buy: BUY,
    sources: [IOC, AIS('A'), 'ISSN, Trexler et al. 2015'], reviewed: R,
  },
  {
    id: 'electrolitos', name: 'Electrolitos', short: 'Sesiones largas o con calor', level: 'funciona', ais: 'A', trackable: true,
    unit: 'dosis', dose: { min: 1, max: 2, suggested: 1 }, dayMax: 4, doses: 1, slot: 'pre', days: 'training',
    intro: 'Reponen el sodio y otras sales que se pierden con el sudor.',
    howTo: [
      { icon: '💧', text: '1 sobre o pastilla en 500 a 750 ml de agua, según la etiqueta.' },
      { icon: '🕐', text: 'Antes o durante sesiones de más de 60 a 90 minutos, con calor o si transpirás mucho.' },
      { icon: '🥤', text: 'En una hora de pesas con agua y comida normal, no hacen falta.' },
    ],
    evidence: 'Funcionan en sesiones largas, con calor o mucho sudor, para hidratarte mejor.',
    forWhom: 'Para entrenamientos largos, al aire libre en verano o si terminás con la ropa blanca de sal.',
    cautions: ['Si tenés presión alta o enfermedad renal o cardíaca, consultá antes: tienen sodio.'],
    buy: 'Mirá cuánto sodio trae cada dosis. Las bebidas deportivas también sirven. ' + BUY,
    sources: [AIS('A'), 'ACSM, Sawka et al. 2007 (reposición de líquidos)'], reviewed: R,
  },
  {
    id: 'bicarbonato', name: 'Bicarbonato de sodio', short: 'Solo información', level: 'puntual', ais: 'A', trackable: false,
    intro: 'Amortigua la acidez en esfuerzos muy intensos de 1 a 7 minutos.',
    howTo: [
      { icon: '⚖️', text: 'En los estudios: 0,2 a 0,5 g por kilo (0,3 g por kilo es lo habitual), 60 a 180 minutos antes, con agua y comida.' },
    ],
    evidence: 'Funciona en esfuerzos muy intensos y cortos (remo, natación, ciclismo de pista). Para un entrenamiento de gimnasio común, casi no aporta.',
    forWhom: 'Para competencias con esfuerzos máximos de pocos minutos, con supervisión.',
    cautions: ['Da molestias digestivas (diarrea, náuseas) con frecuencia.', 'Tiene mucho sodio: si tenés presión alta, no.'],
    buy: 'No hace falta comprarlo como suplemento: es el bicarbonato de cocina. Probalo solo con un profesional.',
    sources: [IOC, AIS('A'), 'ISSN, Grgic et al. 2021'], reviewed: R,
  },
  {
    id: 'remolacha', name: 'Nitrato (jugo de remolacha)', short: 'Solo información', level: 'puntual', ais: 'A', trackable: false,
    intro: 'El nitrato de la remolacha mejora la eficiencia del músculo en esfuerzos de resistencia.',
    howTo: [
      { icon: '⚖️', text: 'En los estudios: unos 5 a 9 mmol de nitrato (310 a 560 mg), 2 a 3 horas antes.' },
    ],
    evidence: 'Funciona sobre todo en personas poco o medianamente entrenadas, en esfuerzos de resistencia. En deportistas muy entrenados el efecto es menor.',
    forWhom: 'Para resistencia (correr, pedalear). Para pesas, poco.',
    cautions: ['La orina puede ponerse rosada: es normal.', 'Evitá enjuague bucal antiséptico ese día: frena el efecto.'],
    buy: 'Remolacha y verduras de hoja verde en la comida ya aportan nitrato.',
    sources: [IOC, AIS('A')], reviewed: R,
  },
  {
    id: 'colageno', name: 'Colágeno', short: 'Tendones y articulaciones', level: 'desarrollo', ais: 'B', trackable: true, badge: 'Evidencia en desarrollo',
    unit: 'g', dose: { min: 10, max: 15, suggested: 15 }, dayMax: 30, doses: 1, slot: 'pre', days: 'training',
    intro: 'Aporta los aminoácidos del colágeno. Se estudia para tendones y articulaciones.',
    howTo: [
      { icon: '⚖️', text: 'En los estudios: 10 a 15 g de colágeno o gelatina con vitamina C, una hora antes de la actividad.' },
      { icon: '💧', text: 'Disuelto en agua o jugo (el jugo de naranja suma la vitamina C).' },
    ],
    evidence: 'Evidencia en desarrollo: en un estudio chico aumentó un marcador de síntesis de colágeno en sangre. No está probado que prevenga lesiones.',
    forWhom: 'Para quien quiera probarlo en tendones o articulaciones, sabiendo que la evidencia todavía es limitada.',
    cautions: ['No reemplaza el tratamiento de una lesión: consultá a un profesional.'],
    buy: BUY,
    sources: [AIS('B'), 'Shaw et al. 2017 (Am J Clin Nutr)'], reviewed: R,
  },
  {
    id: 'vitaminad', name: 'Vitamina D', short: 'Si tenés déficit', level: 'indicacion', ais: 'A', trackable: true,
    unit: 'ui', doses: 1, slot: 'morning', days: 'daily',
    intro: 'Sirve si tenés déficit, que se confirma con un análisis de sangre.',
    howTo: [{ icon: '🩺', text: PROF }, { icon: '🍽️', text: 'Se absorbe mejor con una comida.' }],
    evidence: 'Funciona para corregir un déficit confirmado. Sin déficit no mejora el rendimiento.',
    forWhom: 'Para quien tiene un déficit confirmado por análisis.',
    cautions: ['El exceso se acumula y es tóxico: no pases de lo indicado (el límite en adultos es 4.000 UI por día).', 'Si tomás medicación, consultá por interacciones.'],
    buy: BUY,
    sources: [AIS('A'), NIH], reviewed: R,
  },
  {
    id: 'hierro', name: 'Hierro', short: 'Si tenés déficit', level: 'indicacion', ais: 'A', trackable: true,
    unit: 'mg', doses: 1, slot: 'morning', days: 'daily',
    intro: 'Corrige la falta de hierro, que da cansancio y baja el rendimiento.',
    howTo: [{ icon: '🩺', text: PROF }, { icon: '🍊', text: 'Suele indicarse lejos del café, el té y los lácteos, y con vitamina C para absorberlo mejor.' }],
    evidence: 'Funciona para corregir un déficit confirmado. Sin déficit no ayuda y puede hacer daño.',
    forWhom: 'Para quien tiene un déficit confirmado por análisis.',
    cautions: ['Nunca por tu cuenta: el exceso de hierro es tóxico (el límite en adultos es 45 mg por día).', 'Puede dar estreñimiento o malestar de estómago.'],
    buy: BUY,
    sources: [AIS('A'), NIH], reviewed: R,
  },
  {
    id: 'omega3', name: 'Omega-3', short: 'Si te lo indicaron', level: 'indicacion', ais: 'B', trackable: true,
    unit: 'caps', doses: 1, slot: 'meals', days: 'daily',
    intro: 'Grasas del pescado. Tienen usos clínicos; para el rendimiento la evidencia está en desarrollo.',
    howTo: [{ icon: '🩺', text: PROF }, { icon: '🍽️', text: 'Con una comida, con agua.' }],
    evidence: 'Para rendimiento o recuperación la evidencia todavía es mixta (AIS grupo B).',
    forWhom: 'Para quien se lo indicó un profesional o no come pescado.',
    cautions: ['Si tomás anticoagulantes, consultá antes: puede sumar efecto.'],
    buy: BUY,
    sources: [AIS('B'), NIH], reviewed: R,
  },
  {
    id: 'magnesio', name: 'Magnesio', short: 'Si te lo indicaron', level: 'indicacion', ais: 'A', trackable: true,
    unit: 'mg', doses: 1, slot: 'night', days: 'daily',
    intro: 'Mineral que participa en la función muscular y nerviosa.',
    howTo: [{ icon: '🩺', text: PROF }, { icon: '💧', text: 'Con agua, idealmente con una comida.' }],
    evidence: 'Sirve si tenés déficit. Sin déficit no mejora el rendimiento.',
    forWhom: 'Para quien tiene déficit o se lo indicó un profesional.',
    cautions: ['En suplementos, por encima de 350 mg por día da diarrea.', 'Si tenés enfermedad renal, consultá antes.'],
    buy: BUY,
    sources: [AIS('A'), NIH], reviewed: R,
  },
  {
    id: 'multivitaminico', name: 'Multivitamínico', short: 'Si te lo indicaron', level: 'indicacion', ais: 'A', trackable: true,
    unit: 'caps', doses: 1, slot: 'morning', days: 'daily',
    intro: 'Vitaminas y minerales en una pastilla. No reemplaza una alimentación variada.',
    howTo: [{ icon: '🩺', text: PROF }],
    evidence: 'Sirve cuando la alimentación no alcanza (dietas muy restrictivas, viajes). Si comés variado, no suma.',
    forWhom: 'Para quien hace una dieta muy restrictiva o se lo indicó un profesional.',
    cautions: ['No lo combines con otros suplementos de las mismas vitaminas sin consultar: se suman.'],
    buy: 'Elegí dosis cercanas a las recomendadas diarias, no "megadosis". ' + BUY,
    sources: [AIS('A'), NIH], reviewed: R,
  },
  {
    id: 'quemadores', name: 'Quemadores de grasa', short: 'Por qué no', level: 'no', trackable: false,
    intro: 'Prometen bajar grasa "sin esfuerzo" o acelerar el metabolismo.',
    howTo: [],
    evidence: 'No muestran una pérdida de grasa que valga la pena. Lo que se nota suele ser la cafeína u otros estimulantes que traen.',
    forWhom: 'Para nadie. Para bajar grasa: déficit calórico, proteína suficiente y entrenamiento.',
    cautions: ['Muchos traen estimulantes fuertes o no declarados (algunos prohibidos).', 'Pueden dar palpitaciones, presión alta, ansiedad e insomnio.', 'Hay casos de productos contaminados.'],
    buy: 'En qué gastar en cambio: comida con proteína, y si querés, cafeína pura sabiendo cuánto tomás.',
    sources: [IOC, AIS('C/D')], reviewed: R,
  },
  {
    id: 'bcaa', name: 'BCAA (aminoácidos ramificados)', short: 'Por qué no', level: 'no', trackable: false,
    intro: 'Prometen más músculo y menos cansancio.',
    howTo: [],
    evidence: 'Si comés suficiente proteína, no suman nada: la proteína ya trae esos aminoácidos y todos los demás.',
    forWhom: 'Para casi nadie que llegue a su proteína diaria.',
    cautions: ['No es peligroso, pero es plata que no rinde.'],
    buy: 'En qué gastar en cambio: proteína (comida o en polvo).',
    sources: [IOC, AIS('C')], reviewed: R,
  },
  {
    id: 'glutamina', name: 'Glutamina', short: 'Por qué no', level: 'no', trackable: false,
    intro: 'Promete más músculo, más recuperación y mejores defensas.',
    howTo: [],
    evidence: 'En personas sanas que entrenan no mejora la fuerza, la masa muscular ni la recuperación.',
    forWhom: 'Para casi nadie fuera de usos clínicos indicados.',
    cautions: ['No es peligrosa, pero no rinde.'],
    buy: 'En qué gastar en cambio: proteína suficiente y dormir bien.',
    sources: [IOC, AIS('C')], reviewed: R,
  },
  {
    id: 'boosters', name: '"Boosters" de testosterona', short: 'Por qué no', level: 'no', trackable: false,
    intro: 'Prometen subir la testosterona con hierbas (tribulus, fenogreco y similares).',
    howTo: [],
    evidence: 'No suben la testosterona de forma relevante ni mejoran la fuerza o la masa muscular.',
    forWhom: 'Para nadie.',
    cautions: ['Algunos productos vienen contaminados con sustancias prohibidas.', 'Si sospechás testosterona baja, es un tema médico: consultá.'],
    buy: 'En qué gastar en cambio: dormir bien, comer suficiente y entrenar con constancia.',
    sources: [IOC, AIS('C/D')], reviewed: R,
  },
  {
    id: 'prohormonas', name: 'Prohormonas y SARMs', short: 'Por qué no', level: 'no', trackable: false,
    intro: 'Sustancias que actúan como hormonas o se convierten en ellas.',
    howTo: [],
    evidence: 'Son sustancias prohibidas en el deporte y de alto riesgo (AIS grupo D).',
    forWhom: 'Para nadie.',
    cautions: ['Pueden dañar el hígado, el corazón y las hormonas propias.', 'Están prohibidas por la Agencia Mundial Antidopaje.', 'Muchas se venden sin control y con contenido distinto al de la etiqueta.'],
    buy: 'No las compres. Si alguien te las ofrece, consultá a un profesional.',
    sources: [IOC, AIS('D')], reviewed: R,
  },
]

export const fichaById = id => SUPLEMENTOS.find(f => f.id === id) || null
