// Datos fijos del gimnasio de la demo: planes, programas, clases y personas. Lo que depende de la
// fecha (entrenamientos, pagos, asistencia, reservas) lo arma build.mjs a partir de esto, siempre
// relativo al día en que se corre el script.
//
// Convenciones (las verifica check.mjs):
// - Pesos de trabajo: barra de 2,5 en 2,5 kg; mancuernas de 2 en 2 kg; máquinas, poleas y prensa
//   de 5 en 5 kg; pesas rusas de 4 en 4 kg; peso corporal sin carga (w = 0).
// - Series, repeticiones, precios, cupos y minutos: enteros.
// - Peso corporal: kg con un decimal.

export const GYM = {
  name: 'Gimnasio Demo',
  shortName: 'Gym Demo',
  tagline: 'Tu entrenamiento, tus clases y tu cuota en un solo lugar',
  contact: 'Recepción del gimnasio · hola@gimnasiodemo.com.ar',
  tz: 'America/Argentina/Buenos_Aires',
  // Días de historia hacia atrás desde hoy.
  historyDays: 150,
  // Semanas de clases pasadas con reservas y asistencia.
  classWeeks: 6,
  // El precio de los planes subió hace estos días (los pagos de antes quedan con el precio viejo).
  priceRaiseDaysAgo: 60,
  // Recepción abre de 7 a 22.
  opens: '07:00',
  closes: '22:00'
};

// Planes de cuota. price: el de hoy; oldPrice: el de antes del aumento.
export const PLANS = [
  { key: 'mensual', name: 'Mensual', price: 45000, oldPrice: 40000, durationDays: 30 },
  { key: 'trimestral', name: 'Trimestral', price: 120000, oldPrice: 108000, durationDays: 90 },
  { key: 'clases8', name: '8 clases por mes', price: 32000, oldPrice: 28000, durationDays: 30, classLimit: 8, classPeriod: 'month' },
  { key: 'estudiante', name: 'Estudiante', price: 38000, oldPrice: 34000, durationDays: 30 }
];

// Equipamiento del catálogo → paso de carga y carga mínima con peso.
export const LOAD_STEPS = {
  barbell: { step: 2.5, min: 20 },
  'ez barbell': { step: 2.5, min: 10 },
  dumbbell: { step: 2, min: 2 },
  kettlebell: { step: 4, min: 8 },
  cable: { step: 5, min: 5 },
  'leverage machine': { step: 5, min: 5 },
  'sled machine': { step: 5, min: 20 },
  'smith machine': { step: 5, min: 20 },
  'body weight': { step: 0, min: 0 }
};

// Programas del gimnasio (Plan → "Cargar un plan"). plannedDay: 0 domingo … 6 sábado.
export const PROGRAMS = [
  {
    name: 'Full Body (3 días)',
    days: [
      { id: 'demo-fb-a', name: 'Full Body A', emoji: 'dumbbell', plannedDay: 1, ex: [['1760', 3, 12], ['0314', 3, 10], ['2330', 3, 12], ['0405', 3, 10], ['0274', 3, 15]] },
      { id: 'demo-fb-b', name: 'Full Body B', emoji: 'barbell', plannedDay: 3, ex: [['0085', 3, 10], ['0025', 3, 10], ['0861', 3, 12], ['0336', 3, 10], ['0294', 3, 12]] },
      { id: 'demo-fb-c', name: 'Full Body C', emoji: 'legs', plannedDay: 5, ex: [['0739', 3, 12], ['0596', 3, 12], ['0673', 3, 12], ['0334', 3, 15], ['0201', 3, 12]] }
    ]
  },
  {
    name: 'Torso / Pierna (4 días)',
    days: [
      { id: 'demo-tp-ta', name: 'Torso A', emoji: 'barbell', plannedDay: 1, ex: [['0025', 4, 8], ['0027', 4, 8], ['0405', 3, 10], ['2330', 3, 12], ['0031', 3, 10], ['0241', 3, 12]] },
      { id: 'demo-tp-pa', name: 'Pierna A', emoji: 'legs', plannedDay: 2, ex: [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0586', 3, 12], ['0605', 4, 15]] },
      { id: 'demo-tp-tb', name: 'Torso B', emoji: 'dumbbell', plannedDay: 4, ex: [['0314', 4, 10], ['0861', 4, 10], ['0334', 3, 15], ['0596', 3, 12], ['0313', 3, 12], ['0201', 3, 12]] },
      { id: 'demo-tp-pb', name: 'Pierna B', emoji: 'legs', plannedDay: 5, ex: [['1409', 4, 10], ['0336', 3, 10], ['0585', 3, 15], ['0599', 3, 12], ['0597', 3, 15]] }
    ]
  },
  {
    name: 'Empuje / Tirón / Piernas (3 días)',
    days: [
      { id: 'demo-ppl-push', name: 'Empuje', emoji: 'barbell', plannedDay: 1, ex: [['0025', 4, 8], ['0047', 3, 10], ['0426', 3, 10], ['0334', 3, 12], ['0241', 3, 12], ['0251', 3, 10]] },
      { id: 'demo-ppl-pull', name: 'Tirón', emoji: 'pullup', plannedDay: 3, ex: [['2330', 4, 10], ['0027', 4, 8], ['1323', 3, 10], ['0031', 3, 10], ['0313', 3, 12]] },
      { id: 'demo-ppl-legs', name: 'Piernas', emoji: 'legs', plannedDay: 5, ex: [['0043', 4, 8], ['0085', 3, 10], ['0739', 3, 12], ['0585', 3, 12], ['0586', 3, 12], ['0605', 4, 15]] }
    ]
  }
];

// Clases (íconos de ClassEditor.jsx → CLASS_ICONS). teacher: clave de una persona con cuenta (PEOPLE) o null con teacherName (profe externa).
// slots: [día 0-6, 'HH:MM'] — cada día con su hora.
export const CLASSES = [
  {
    key: 'spinning', name: 'Spinning', color: '#ff375f', icon: 'bike', durationMin: 45, capacity: 12, room: 'Sala de spinning',
    teacher: 'carolina', description: 'Bici fija con música, por intervalos. Traé toalla y agua.',
    logMode: 'muscles', log: { muscles: ['quadriceps', 'gluteal', 'hamstring', 'calves'], intensity: 'high' },
    slots: [[1, '19:00'], [2, '08:00'], [3, '19:00'], [5, '18:00']]
  },
  {
    key: 'funcional', name: 'Funcional', color: '#ff9f0a', icon: 'kettlebell', durationMin: 50, capacity: 16, room: 'Salón principal',
    teacher: 'carolina', description: 'Circuito de fuerza y resistencia en estaciones. Todos los niveles.',
    logMode: 'exercises', log: { exercises: [{ id: '0549', sets: 4, reps: 15 }, { id: '1760', sets: 4, reps: 12 }, { id: '0662', sets: 4, reps: 10 }, { id: '0336', sets: 3, reps: 12 }, { id: '0274', sets: 3, reps: 20 }] },
    slots: [[2, '19:00'], [4, '19:00'], [6, '10:00']]
  },
  {
    key: 'pilates', name: 'Pilates mat', color: '#bf5af2', icon: 'stretch', durationMin: 55, capacity: 10, room: 'Salón 2',
    teacher: null, teacherName: 'Valeria Gómez', description: 'Pilates en colchoneta: core, postura y movilidad.',
    logMode: 'muscles', log: { muscles: ['abs', 'obliques', 'lower-back', 'gluteal', 'hip-flexors'], intensity: 'medium' },
    slots: [[2, '09:30'], [4, '09:30'], [6, '11:00']]
  },
  {
    key: 'yoga', name: 'Yoga', color: '#40c8e0', icon: 'heart', durationMin: 60, capacity: null, room: 'Salón 2',
    teacher: null, teacherName: 'Nicolás Paz', description: 'Hatha yoga: respiración, flexibilidad y equilibrio. Sin cupo.',
    logMode: 'muscles', log: { muscles: ['hamstring', 'lower-back', 'hip-flexors'], intensity: 'low' },
    slots: [[1, '08:00'], [3, '20:00']]
  },
  {
    key: 'gap', name: 'GAP', color: '#30d158', icon: 'flame', durationMin: 50, capacity: 15, room: 'Salón principal',
    teacher: null, teacherName: 'Florencia Díaz', description: 'Glúteos, abdomen y piernas. Con bandas y mancuernas livianas.',
    logMode: 'muscles', log: { muscles: ['gluteal', 'abs', 'quadriceps', 'hamstring', 'adductors'], intensity: 'high' },
    slots: [[1, '18:00'], [3, '18:00'], [5, '19:00']]
  }
];

// Personas principales. username: el de la cuenta (lo que la app muestra: "Hola Lucía", "con Carolina");
// fullName: el de la ficha.
// joinDaysAgo: cuándo se creó la cuenta. role: 'owner' | id de rol | null.
// training: programa, días (0-6) y hora base; consistency: probabilidad de ir un día del plan.
// start: carga de trabajo inicial por ejercicio (kg). bw: [peso inicial, peso de hoy] si da
// consentimiento de salud.
export const PEOPLE = [
  {
    key: 'juan', username: 'Juan', fullName: 'Juan', role: 'owner', joinDaysAgo: 150,
    dni: '36412877', phone: '11 4567-2391', email: 'juan@gimnasiodemo.com.ar',
    health: true, sex: 'masculino', age: 34, height: 178, objetivo: 'hipertrofia', nivel: 'intermedio', bw: [82.4, 79.8],
    training: { program: 'Empuje / Tirón / Piernas (3 días)', time: '07:30', jitter: 20, consistency: 0.9, weighEvery: 7 },
    start: { '0025': 72.5, '0047': 55, '0426': 18, '0334': 8, '0241': 25, '0251': 0, '2330': 50, '0027': 60, '1323': 45, '0031': 30, '0313': 14, '0043': 85, '0085': 70, '0739': 140, '0585': 45, '0586': 35, '0605': 60 },
    nutritionDays: 10
  },
  {
    key: 'carolina', username: 'Carolina', fullName: 'Carolina Ríos (demo)', role: 'coach', joinDaysAgo: 150,
    dni: '38274615', phone: '11 6231-4078', email: 'caro.rios.profe@gmail.com',
    health: true, sex: 'femenino', age: 32, height: 166, objetivo: 'fitness_general', nivel: 'avanzado', bw: [60.2, 59.6],
    training: { program: 'Full Body (3 días)', time: '13:30', jitter: 15, consistency: 0.7, weighEvery: 14 },
    start: { '1760': 20, '0314': 14, '2330': 40, '0405': 10, '0274': 0, '0085': 50, '0025': 35, '0861': 40, '0336': 10, '0294': 8, '0739': 120, '0596': 30, '0673': 40, '0334': 6, '0201': 20 }
  },
  {
    key: 'martin', username: 'Martín', fullName: 'Martín Sosa (demo)', role: 'reception', joinDaysAgo: 150,
    dni: '41736092', phone: '11 3958-1146', email: 'martinsosa.99@hotmail.com',
    health: true, sex: 'masculino', age: 27, height: 174, objetivo: 'hipertrofia', nivel: 'principiante', bw: [70.1, 72.3],
    training: { program: 'Full Body (3 días)', time: '07:00', jitter: 10, consistency: 0.55, weighEvery: 21 },
    start: { '1760': 16, '0314': 14, '2330': 40, '0405': 10, '0274': 0, '0085': 40, '0025': 40, '0861': 35, '0336': 8, '0294': 8, '0739': 100, '0596': 25, '0673': 35, '0334': 6, '0201': 15 }
  },
  {
    key: 'lucia', username: 'Lucía', fullName: 'Lucía Fernández (demo)', role: null, joinDaysAgo: 141, status: 'al_dia', plan: 'mensual', payMethod: 'transferencia',
    dni: '40158326', phone: '11 5482-7730', email: 'lu.fernandez97@gmail.com',
    health: true, sex: 'femenino', age: 29, height: 163, objetivo: 'hipertrofia', nivel: 'intermedio', bw: [63.0, 61.8],
    training: { program: 'Torso / Pierna (4 días)', time: '19:30', jitter: 15, consistency: 0.88, perfectWeeks: 12, weighEvery: 7 },
    start: { '0025': 30, '0027': 30, '0405': 8, '2330': 30, '0031': 20, '0241': 15, '0043': 45, '0085': 45, '0739': 80, '0586': 20, '0605': 40, '0314': 10, '0861': 30, '0334': 4, '0596': 20, '0313': 8, '0201': 15, '1409': 60, '0336': 8, '0585': 25, '0599': 20, '0597': 35 },
    injuries: ['hombros'],
    nutritionDays: 10,
    classes: [{ class: 'pilates', weekday: 6, recurring: true, chance: 0.75 }]
  },
  {
    key: 'sofia', username: 'Sofía', fullName: 'Sofía Romero (demo)', role: null, joinDaysAgo: 95, status: 'al_dia', plan: 'clases8', payMethod: 'efectivo', trialFirst: true,
    dni: '43871204', phone: '11 2764-5519', email: 'sofi.romero02@gmail.com',
    health: true, sex: 'femenino', age: 24, height: 159, objetivo: 'fitness_general', nivel: 'principiante', bw: [56.4, 55.9],
    training: null,
    classes: [{ class: 'spinning', weekday: 2, recurring: true, chance: 0.9 }, { class: 'yoga', weekday: 1, recurring: false, chance: 0.6 }, { class: 'yoga', weekday: 3, recurring: false, chance: 0.35 }]
  },
  {
    key: 'diego', username: 'Diego', fullName: 'Diego Pereyra (demo)', role: null, joinDaysAgo: 102, status: 'bloqueado', plan: 'mensual', payMethod: 'efectivo',
    dni: '31548903', phone: '11 4029-8817', email: null,
    health: false,
    training: { program: 'Empuje / Tirón / Piernas (3 días)', time: '20:30', jitter: 25, consistency: 0.55, weighEvery: 0 },
    start: { '0025': 50, '0047': 40, '0426': 12, '0334': 6, '0241': 20, '0251': 0, '2330': 40, '0027': 40, '1323': 35, '0031': 20, '0313': 10, '0043': 50, '0085': 40, '0739': 100, '0585': 30, '0586': 25, '0605': 40 },
    classes: [{ class: 'funcional', weekday: 4, recurring: false, chance: 0.4 }]
  }
];

// Socios de relleno: ficha, plan, pagos, ingresos y clases (sin rutina propia).
// joinDaysAgo decide el estado de la cuota (los vencimientos caen cada `duración` días desde el
// alta): al día o por vencer pagan todo; vencido o bloqueado no pagaron el período de hoy.
// app: tiene la app instalada (passkey de ejemplo, inservible para entrar). status: cómo queda la
// cuota hoy. visitsPerWeek: ingresos por semana. classes: [clase, día, probabilidad].
export const EXTRAS = [
  { sex: 'femenino', username: 'Valentina L.', fullName: 'Valentina López (demo)', year: 1998, plan: 'mensual', status: 'al_dia', app: true, joinDaysAgo: 140, visitsPerWeek: 3, classes: [['spinning', 1, 0.8], ['gap', 3, 0.7]] },
  { username: 'Matías G.', fullName: 'Matías González (demo)', year: 1991, plan: 'trimestral', status: 'al_dia', app: true, joinDaysAgo: 135, visitsPerWeek: 4, classes: [['funcional', 2, 0.7]] },
  { sex: 'femenino', username: 'Camila M.', fullName: 'Camila Martínez (demo)', year: 2001, plan: 'estudiante', status: 'al_dia', app: true, joinDaysAgo: 120, visitsPerWeek: 3, classes: [['spinning', 3, 0.8], ['spinning', 5, 0.7]] },
  { username: 'Nicolás R.', fullName: 'Nicolás Rodríguez (demo)', year: 1987, plan: 'mensual', status: 'por_vencer', app: true, joinDaysAgo: 116, visitsPerWeek: 3, classes: [['funcional', 4, 0.6]] },
  { sex: 'femenino', username: 'Florencia S.', fullName: 'Florencia Sánchez (demo)', year: 1994, plan: 'clases8', status: 'al_dia', app: true, joinDaysAgo: 100, visitsPerWeek: 2, classes: [['pilates', 2, 0.85], ['pilates', 4, 0.8]] },
  { username: 'Tomás D.', fullName: 'Tomás Díaz (demo)', year: 2003, plan: 'estudiante', status: 'vencido', app: true, joinDaysAgo: 93, visitsPerWeek: 3, classes: [['spinning', 1, 0.6]] },
  { sex: 'femenino', username: 'Agustina P.', fullName: 'Agustina Pérez (demo)', year: 1996, plan: 'mensual', status: 'al_dia', app: true, joinDaysAgo: 130, visitsPerWeek: 4, classes: [['gap', 1, 0.8], ['gap', 5, 0.75], ['spinning', 5, 0.5]] },
  { username: 'Lucas G.', fullName: 'Lucas Gómez (demo)', year: 1989, plan: 'trimestral', status: 'por_vencer', app: true, joinDaysAgo: 88, visitsPerWeek: 4, classes: [] },
  { sex: 'femenino', username: 'Martina R.', fullName: 'Martina Ruiz (demo)', year: 1999, plan: 'mensual', status: 'al_dia', app: true, joinDaysAgo: 75, visitsPerWeek: 3, classes: [['spinning', 2, 0.7], ['yoga', 3, 0.5]] },
  { username: 'Santiago Á.', fullName: 'Santiago Álvarez (demo)', year: 1983, plan: 'mensual', status: 'al_dia', app: true, joinDaysAgo: 141, visitsPerWeek: 3, classes: [['funcional', 6, 0.6]] },
  { sex: 'femenino', username: 'Julieta T.', fullName: 'Julieta Torres (demo)', year: 1993, plan: 'clases8', status: 'al_dia', app: true, joinDaysAgo: 62, visitsPerWeek: 2, classes: [['yoga', 1, 0.8], ['pilates', 6, 0.7]] },
  { username: 'Facundo R.', fullName: 'Facundo Romero (demo)', year: 1997, plan: 'mensual', status: 'bloqueado', app: true, joinDaysAgo: 115, visitsPerWeek: 2, classes: [] },
  { sex: 'femenino', username: 'Micaela F.', fullName: 'Micaela Flores (demo)', year: 2000, plan: 'estudiante', status: 'al_dia', app: true, joinDaysAgo: 50, visitsPerWeek: 3, classes: [['spinning', 5, 0.8], ['gap', 3, 0.6]] },
  { username: 'Gonzalo B.', fullName: 'Gonzalo Benítez (demo)', year: 1985, plan: 'mensual', status: 'al_dia', app: true, joinDaysAgo: 40, visitsPerWeek: 4, classes: [['funcional', 2, 0.6], ['funcional', 4, 0.6]], voidedPayment: true },
  // Fichas sin app (las cargó recepción).
  { username: 'Roberto M.', fullName: 'Roberto Medina (demo)', year: 1964, plan: 'mensual', status: 'al_dia', app: false, joinDaysAgo: 125, visitsPerWeek: 3, classes: [['yoga', 1, 0.7]] },
  { sex: 'femenino', username: 'Graciela C.', fullName: 'Graciela Castro (demo)', year: 1968, plan: 'trimestral', status: 'al_dia', app: false, joinDaysAgo: 105, visitsPerWeek: 2, classes: [['pilates', 2, 0.8], ['pilates', 4, 0.7]] },
  { username: 'Ezequiel M.', fullName: 'Ezequiel Molina (demo)', year: 1990, plan: 'mensual', status: 'vencido', app: false, joinDaysAgo: 64, visitsPerWeek: 2, classes: [] },
  { sex: 'femenino', username: 'Paula H.', fullName: 'Paula Herrera (demo)', year: 1995, plan: null, status: 'prueba', app: false, joinDaysAgo: 1, visitsPerWeek: 0, classes: [] },
  // Se registraron con la app y esperan la aprobación de recepción.
  { sex: 'femenino', username: 'Brenda A.', fullName: 'Brenda Acosta (demo)', year: 2002, plan: null, status: 'pendiente', app: true, joinDaysAgo: 1, visitsPerWeek: 0, classes: [] },
  { username: 'Ignacio V.', fullName: 'Ignacio Vega (demo)', year: 1992, plan: null, status: 'pendiente', app: true, joinDaysAgo: 0, visitsPerWeek: 0, classes: [] }
];

// Comidas habituales (nombres de alimentos-base.js de la API) por franja, con gramos típicos.
export const MEALS = {
  desayuno: [[['Avena cruda', 50], ['Banana', 120]], [['Pan integral', 60], ['Huevo entero', 100]], [['Yogur natural', 200], ['Avena cruda', 40]]],
  almuerzo: [[['Pechuga de pollo cocida', 180], ['Arroz blanco cocido', 200]], [['Carne vacuna magra cocida', 160], ['Papa hervida', 250]], [['Pescado blanco cocido', 200], ['Arroz blanco cocido', 180]]],
  merienda: [[['Yogur natural', 200], ['Manzana', 150]], [['Pan integral', 60], ['Queso cremoso', 40]], [['Banana', 120], ['Almendras', 25]]],
  cena: [[['Pechuga de pollo cocida', 160], ['Papa hervida', 200]], [['Huevo entero', 150], ['Pan integral', 60]], [['Carne vacuna magra cocida', 150], ['Arroz blanco cocido', 150]]]
};

// Más socios, generados con estos nombres (build.mjs → generatedMembers): llenan las clases y las
// listas como en un gimnasio real. Todos pagan al día; los estados especiales están en EXTRAS.
export const GENERATED_COUNT = 48;
export const FIRST_NAMES = {
  femenino: ['María', 'Ana', 'Laura', 'Carla', 'Daniela', 'Romina', 'Natalia', 'Belén', 'Rocío', 'Milagros', 'Antonella', 'Josefina', 'Victoria', 'Lorena', 'Silvina', 'Cecilia', 'Pilar', 'Abril', 'Candela', 'Jimena'],
  masculino: ['Juan Pablo', 'Federico', 'Sebastián', 'Alejandro', 'Damián', 'Leandro', 'Pablo', 'Hernán', 'Ramiro', 'Bruno', 'Joaquín', 'Franco', 'Emiliano', 'Maximiliano', 'Rodrigo', 'Cristian', 'Gastón', 'Mariano', 'Iván', 'Thiago']
};
export const LAST_NAMES = ['Fernández', 'García', 'Silva', 'Ramírez', 'Morales', 'Ortiz', 'Suárez', 'Ríos', 'Navarro', 'Domínguez', 'Gutiérrez', 'Cabrera', 'Ponce', 'Aguirre', 'Luna', 'Peralta', 'Ibáñez', 'Rojas', 'Figueroa', 'Godoy', 'Sosa', 'Quiroga', 'Ledesma', 'Villalba', 'Correa', 'Paz', 'Méndez', 'Vera', 'Arias', 'Bustos'];
// Peso de cada clase en las preferencias (las más pedidas, primero).
export const CLASS_POPULARITY = { spinning: 0.3, funcional: 0.22, gap: 0.23, pilates: 0.15, yoga: 0.1 };
