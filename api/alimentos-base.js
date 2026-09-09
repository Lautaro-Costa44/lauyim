// Common foods are kept locally so meal logging does not depend on branded products.
// Values are approximate per 100 g and can be overridden by a scanned product.
export const ALIMENTOS_BASE = [
  { nombre: 'Arroz blanco cocido', aliases: ['arroz', 'rice'], caloriasPor100g: 130, proteinaPor100g: 2.7, carbosPor100g: 28.2, grasasPor100g: 0.3 },
  { nombre: 'Pechuga de pollo cocida', aliases: ['pollo', 'pechuga'], caloriasPor100g: 165, proteinaPor100g: 31, carbosPor100g: 0, grasasPor100g: 3.6 },
  { nombre: 'Huevo entero', aliases: ['huevo', 'huevos'], caloriasPor100g: 143, proteinaPor100g: 12.6, carbosPor100g: 0.7, grasasPor100g: 9.5 },
  { nombre: 'Carne vacuna magra cocida', aliases: ['carne', 'vaca', 'ternera'], caloriasPor100g: 217, proteinaPor100g: 26, carbosPor100g: 0, grasasPor100g: 12 },
  { nombre: 'Pescado blanco cocido', aliases: ['pescado', 'merluza'], caloriasPor100g: 120, proteinaPor100g: 26, carbosPor100g: 0, grasasPor100g: 2 },
  { nombre: 'Avena cruda', aliases: ['avena', 'oats'], caloriasPor100g: 389, proteinaPor100g: 16.9, carbosPor100g: 66.3, grasasPor100g: 6.9 },
  { nombre: 'Pan integral', aliases: ['pan', 'tostada'], caloriasPor100g: 247, proteinaPor100g: 13, carbosPor100g: 41, grasasPor100g: 4.2 },
  { nombre: 'Papa hervida', aliases: ['papa', 'patata'], caloriasPor100g: 87, proteinaPor100g: 1.9, carbosPor100g: 20.1, grasasPor100g: 0.1 },
  { nombre: 'Batata cocida', aliases: ['batata', 'boniato'], caloriasPor100g: 90, proteinaPor100g: 2, carbosPor100g: 20.7, grasasPor100g: 0.2 },
  { nombre: 'Lentejas cocidas', aliases: ['lenteja', 'lentejas'], caloriasPor100g: 116, proteinaPor100g: 9, carbosPor100g: 20.1, grasasPor100g: 0.4 },
  { nombre: 'Porotos cocidos', aliases: ['poroto', 'frijol', 'frijoles'], caloriasPor100g: 127, proteinaPor100g: 8.7, carbosPor100g: 22.8, grasasPor100g: 0.5 },
  { nombre: 'Banana', aliases: ['banana', 'plátano', 'platano'], caloriasPor100g: 89, proteinaPor100g: 1.1, carbosPor100g: 22.8, grasasPor100g: 0.3 },
  { nombre: 'Manzana', aliases: ['manzana'], caloriasPor100g: 52, proteinaPor100g: 0.3, carbosPor100g: 13.8, grasasPor100g: 0.2 },
  { nombre: 'Tomate', aliases: ['tomate'], caloriasPor100g: 18, proteinaPor100g: 0.9, carbosPor100g: 3.9, grasasPor100g: 0.2 },
  { nombre: 'Leche entera', aliases: ['leche'], caloriasPor100g: 61, proteinaPor100g: 3.2, carbosPor100g: 4.8, grasasPor100g: 3.3 },
  { nombre: 'Yogur natural', aliases: ['yogur', 'yogurt'], caloriasPor100g: 61, proteinaPor100g: 3.5, carbosPor100g: 4.7, grasasPor100g: 3.3 },
  { nombre: 'Queso cremoso', aliases: ['queso'], caloriasPor100g: 342, proteinaPor100g: 22.4, carbosPor100g: 3.4, grasasPor100g: 27.5 },
  { nombre: 'Aceite de oliva', aliases: ['aceite', 'oliva'], caloriasPor100g: 884, proteinaPor100g: 0, carbosPor100g: 0, grasasPor100g: 100 },
  { nombre: 'Maní', aliases: ['mani', 'cacahuate', 'cacahuates'], caloriasPor100g: 567, proteinaPor100g: 25.8, carbosPor100g: 16.1, grasasPor100g: 49.2 },
  { nombre: 'Almendras', aliases: ['almendra', 'almendras'], caloriasPor100g: 579, proteinaPor100g: 21.2, carbosPor100g: 21.6, grasasPor100g: 49.9 },
]
