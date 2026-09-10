import { getDatabase } from './database.js';

const plantillas = [...[
  {
    "nombre": "Milanesa con puré",
    "categoria": "tradicional",
    "ingredientes": [
      { "nombre_alimento": "Milanesa de carne", "cantidad_gramos": 150, "calorias_100g": 250, "proteina_100g": 20, "carbohidratos_100g": 12, "grasas_100g": 14 },
      { "nombre_alimento": "Puré de papas", "cantidad_gramos": 200, "calorias_100g": 90, "proteina_100g": 2, "carbohidratos_100g": 17, "grasas_100g": 2 }
    ]
  },
  {
    "nombre": "Asado con ensalada mixta",
    "categoria": "tradicional",
    "ingredientes": [
      { "nombre_alimento": "Carne de vaca (asado, cocido)", "cantidad_gramos": 250, "calorias_100g": 290, "proteina_100g": 24, "carbohidratos_100g": 0, "grasas_100g": 21 },
      { "nombre_alimento": "Lechuga", "cantidad_gramos": 50, "calorias_100g": 15, "proteina_100g": 1, "carbohidratos_100g": 3, "grasas_100g": 0 },
      { "nombre_alimento": "Tomate", "cantidad_gramos": 100, "calorias_100g": 18, "proteina_100g": 1, "carbohidratos_100g": 4, "grasas_100g": 0 }
    ]
  },
  {
    "nombre": "Pastel de papas",
    "categoria": "tradicional",
    "ingredientes": [
      { "nombre_alimento": "Puré de papas", "cantidad_gramos": 200, "calorias_100g": 90, "proteina_100g": 2, "carbohidratos_100g": 17, "grasas_100g": 2 },
      { "nombre_alimento": "Carne vacuna picada cocida", "cantidad_gramos": 150, "calorias_100g": 250, "proteina_100g": 17, "carbohidratos_100g": 0, "grasas_100g": 20 },
      { "nombre_alimento": "Queso muzzarella", "cantidad_gramos": 30, "calorias_100g": 300, "proteina_100g": 22, "carbohidratos_100g": 2, "grasas_100g": 22 },
      { "nombre_alimento": "Huevo duro", "cantidad_gramos": 25, "calorias_100g": 155, "proteina_100g": 13, "carbohidratos_100g": 1, "grasas_100g": 11 }
    ]
  },
  {
    "nombre": "Tarta de jamón y queso",
    "categoria": "tradicional",
    "ingredientes": [
      { "nombre_alimento": "Masa para tarta", "cantidad_gramos": 100, "calorias_100g": 350, "proteina_100g": 7, "carbohidratos_100g": 45, "grasas_100g": 16 },
      { "nombre_alimento": "Jamón cocido", "cantidad_gramos": 50, "calorias_100g": 110, "proteina_100g": 16, "carbohidratos_100g": 2, "grasas_100g": 4 },
      { "nombre_alimento": "Queso tybo o barra", "cantidad_gramos": 80, "calorias_100g": 330, "proteina_100g": 24, "carbohidratos_100g": 2, "grasas_100g": 25 },
      { "nombre_alimento": "Huevo (mezcla)", "cantidad_gramos": 50, "calorias_100g": 143, "proteina_100g": 12, "carbohidratos_100g": 1, "grasas_100g": 10 }
    ]
  },
  {
    "nombre": "Tallarines con tuco",
    "categoria": "tradicional",
    "ingredientes": [
      { "nombre_alimento": "Fideos secos cocidos", "cantidad_gramos": 200, "calorias_100g": 130, "proteina_100g": 5, "carbohidratos_100g": 25, "grasas_100g": 1 },
      { "nombre_alimento": "Salsa de tomate con carne (tuco)", "cantidad_gramos": 120, "calorias_100g": 90, "proteina_100g": 4, "carbohidratos_100g": 5, "grasas_100g": 6 },
      { "nombre_alimento": "Queso rallado", "cantidad_gramos": 15, "calorias_100g": 400, "proteina_100g": 33, "carbohidratos_100g": 3, "grasas_100g": 28 }
    ]
  },
  {
    "nombre": "Arroz con pollo",
    "categoria": "tradicional",
    "ingredientes": [
      { "nombre_alimento": "Arroz blanco cocido", "cantidad_gramos": 150, "calorias_100g": 130, "proteina_100g": 2, "carbohidratos_100g": 28, "grasas_100g": 0.5 },
      { "nombre_alimento": "Pollo cocido sin piel", "cantidad_gramos": 150, "calorias_100g": 165, "proteina_100g": 25, "carbohidratos_100g": 0, "grasas_100g": 7 },
      { "nombre_alimento": "Arvejas", "cantidad_gramos": 40, "calorias_100g": 80, "proteina_100g": 5, "carbohidratos_100g": 14, "grasas_100g": 0.5 }
    ]
  },
  {
    "nombre": "Guiso de lentejas",
    "categoria": "tradicional",
    "ingredientes": [
      { "nombre_alimento": "Lentejas cocidas", "cantidad_gramos": 150, "calorias_100g": 116, "proteina_100g": 9, "carbohidratos_100g": 20, "grasas_100g": 0.5 },
      { "nombre_alimento": "Carne de vaca en cubos", "cantidad_gramos": 100, "calorias_100g": 250, "proteina_100g": 18, "carbohidratos_100g": 0, "grasas_100g": 20 },
      { "nombre_alimento": "Papa cocida", "cantidad_gramos": 100, "calorias_100g": 86, "proteina_100g": 2, "carbohidratos_100g": 20, "grasas_100g": 0.1 },
      { "nombre_alimento": "Chorizo colorado / panceta", "cantidad_gramos": 30, "calorias_100g": 350, "proteina_100g": 14, "carbohidratos_100g": 2, "grasas_100g": 32 }
    ]
  },
  {
    "nombre": "Empanadas de carne al horno (3 unidades)",
    "categoria": "tradicional",
    "ingredientes": [
      { "nombre_alimento": "Masa para empanadas", "cantidad_gramos": 90, "calorias_100g": 330, "proteina_100g": 8, "carbohidratos_100g": 48, "grasas_100g": 11 },
      { "nombre_alimento": "Carne picada cocida", "cantidad_gramos": 100, "calorias_100g": 250, "proteina_100g": 17, "carbohidratos_100g": 0, "grasas_100g": 20 },
      { "nombre_alimento": "Cebolla cocida", "cantidad_gramos": 40, "calorias_100g": 40, "proteina_100g": 1, "carbohidratos_100g": 9, "grasas_100g": 0.2 },
      { "nombre_alimento": "Huevo duro", "cantidad_gramos": 20, "calorias_100g": 155, "proteina_100g": 13, "carbohidratos_100g": 1, "grasas_100g": 11 }
    ]
  },
  {
    "nombre": "Locro",
    "categoria": "tradicional",
    "ingredientes": [
      { "nombre_alimento": "Maíz blanco cocido", "cantidad_gramos": 150, "calorias_100g": 110, "proteina_100g": 4, "carbohidratos_100g": 22, "grasas_100g": 1 },
      { "nombre_alimento": "Porotos cocidos", "cantidad_gramos": 80, "calorias_100g": 120, "proteina_100g": 8, "carbohidratos_100g": 21, "grasas_100g": 0.5 },
      { "nombre_alimento": "Zapallo cocido", "cantidad_gramos": 150, "calorias_100g": 30, "proteina_100g": 1, "carbohidratos_100g": 7, "grasas_100g": 0.1 },
      { "nombre_alimento": "Carnes mixtas (vaca, cerdo, panceta)", "cantidad_gramos": 120, "calorias_100g": 280, "proteina_100g": 16, "carbohidratos_100g": 0, "grasas_100g": 24 }
    ]
  },
  {
    "nombre": "Choripán",
    "categoria": "tradicional",
    "ingredientes": [
      { "nombre_alimento": "Pan francés", "cantidad_gramos": 100, "calorias_100g": 270, "proteina_100g": 9, "carbohidratos_100g": 52, "grasas_100g": 3 },
      { "nombre_alimento": "Chorizo de cerdo/mixto cocido", "cantidad_gramos": 150, "calorias_100g": 330, "proteina_100g": 14, "carbohidratos_100g": 2, "grasas_100g": 29 },
      { "nombre_alimento": "Chimichurri", "cantidad_gramos": 15, "calorias_100g": 400, "proteina_100g": 1, "carbohidratos_100g": 3, "grasas_100g": 42 }
    ]
  },
  {
    "nombre": "Pizza casera de muzzarella (3 porciones)",
    "categoria": "tradicional",
    "ingredientes": [
      { "nombre_alimento": "Masa de pizza al molde", "cantidad_gramos": 180, "calorias_100g": 260, "proteina_100g": 8, "carbohidratos_100g": 50, "grasas_100g": 3 },
      { "nombre_alimento": "Queso muzzarella", "cantidad_gramos": 120, "calorias_100g": 300, "proteina_100g": 22, "carbohidratos_100g": 2, "grasas_100g": 22 },
      { "nombre_alimento": "Salsa de tomate", "cantidad_gramos": 50, "calorias_100g": 40, "proteina_100g": 1, "carbohidratos_100g": 8, "grasas_100g": 0.5 }
    ]
  },
  {
    "nombre": "Tortilla de papas",
    "categoria": "tradicional",
    "ingredientes": [
      { "nombre_alimento": "Papas cocidas/salteadas", "cantidad_gramos": 200, "calorias_100g": 130, "proteina_100g": 2, "carbohidratos_100g": 20, "grasas_100g": 5 },
      { "nombre_alimento": "Huevo", "cantidad_gramos": 100, "calorias_100g": 143, "proteina_100g": 12, "carbohidratos_100g": 1, "grasas_100g": 10 },
      { "nombre_alimento": "Cebolla salteada", "cantidad_gramos": 30, "calorias_100g": 60, "proteina_100g": 1, "carbohidratos_100g": 10, "grasas_100g": 2 },
      { "nombre_alimento": "Aceite (absorbido)", "cantidad_gramos": 15, "calorias_100g": 884, "proteina_100g": 0, "carbohidratos_100g": 0, "grasas_100g": 100 }
    ]
  },
  {
    "nombre": "Ñoquis con salsa",
    "categoria": "tradicional",
    "ingredientes": [
      { "nombre_alimento": "Ñoquis de papa", "cantidad_gramos": 250, "calorias_100g": 150, "proteina_100g": 4, "carbohidratos_100g": 30, "grasas_100g": 1 },
      { "nombre_alimento": "Salsa de tomate (fileto)", "cantidad_gramos": 100, "calorias_100g": 50, "proteina_100g": 1, "carbohidratos_100g": 7, "grasas_100g": 2 },
      { "nombre_alimento": "Queso rallado", "cantidad_gramos": 15, "calorias_100g": 400, "proteina_100g": 33, "carbohidratos_100g": 3, "grasas_100g": 28 }
    ]
  },
  {
    "nombre": "Pollo al horno con papas",
    "categoria": "tradicional",
    "ingredientes": [
      { "nombre_alimento": "Pollo asado (muslo/pata sin piel)", "cantidad_gramos": 200, "calorias_100g": 180, "proteina_100g": 23, "carbohidratos_100g": 0, "grasas_100g": 9 },
      { "nombre_alimento": "Papas al horno", "cantidad_gramos": 200, "calorias_100g": 110, "proteina_100g": 2, "carbohidratos_100g": 22, "grasas_100g": 2 }
    ]
  },
  {
    "nombre": "Bife a caballo",
    "categoria": "tradicional",
    "ingredientes": [
      { "nombre_alimento": "Bife de vaca (cuadril/bife de chorizo)", "cantidad_gramos": 200, "calorias_100g": 220, "proteina_100g": 22, "carbohidratos_100g": 0, "grasas_100g": 14 },
      { "nombre_alimento": "Huevo frito", "cantidad_gramos": 50, "calorias_100g": 190, "proteina_100g": 14, "carbohidratos_100g": 1, "grasas_100g": 15 }
    ]
  },
  {
    "nombre": "Sándwich de milanesa",
    "categoria": "tradicional",
    "ingredientes": [
      { "nombre_alimento": "Pan francés", "cantidad_gramos": 100, "calorias_100g": 270, "proteina_100g": 9, "carbohidratos_100g": 52, "grasas_100g": 3 },
      { "nombre_alimento": "Milanesa de carne", "cantidad_gramos": 120, "calorias_100g": 250, "proteina_100g": 20, "carbohidratos_100g": 12, "grasas_100g": 14 },
      { "nombre_alimento": "Tomate", "cantidad_gramos": 40, "calorias_100g": 18, "proteina_100g": 1, "carbohidratos_100g": 4, "grasas_100g": 0 },
      { "nombre_alimento": "Lechuga", "cantidad_gramos": 20, "calorias_100g": 15, "proteina_100g": 1, "carbohidratos_100g": 3, "grasas_100g": 0 }
    ]
  },
  {
    "nombre": "Fideos con manteca y queso",
    "categoria": "tradicional",
    "ingredientes": [
      { "nombre_alimento": "Fideos secos cocidos", "cantidad_gramos": 200, "calorias_100g": 130, "proteina_100g": 5, "carbohidratos_100g": 25, "grasas_100g": 1 },
      { "nombre_alimento": "Manteca", "cantidad_gramos": 15, "calorias_100g": 717, "proteina_100g": 1, "carbohidratos_100g": 0, "grasas_100g": 81 },
      { "nombre_alimento": "Queso rallado", "cantidad_gramos": 20, "calorias_100g": 400, "proteina_100g": 33, "carbohidratos_100g": 3, "grasas_100g": 28 }
    ]
  },
  {
    "nombre": "Zapallitos rellenos",
    "categoria": "tradicional",
    "ingredientes": [
      { "nombre_alimento": "Zapallitos hervidos", "cantidad_gramos": 250, "calorias_100g": 17, "proteina_100g": 1, "carbohidratos_100g": 3, "grasas_100g": 0.2 },
      { "nombre_alimento": "Carne picada magra cocida", "cantidad_gramos": 100, "calorias_100g": 200, "proteina_100g": 20, "carbohidratos_100g": 0, "grasas_100g": 12 },
      { "nombre_alimento": "Queso fresco (gratinado)", "cantidad_gramos": 40, "calorias_100g": 300, "proteina_100g": 22, "carbohidratos_100g": 2, "grasas_100g": 22 },
      { "nombre_alimento": "Cebolla rehogada", "cantidad_gramos": 30, "calorias_100g": 60, "proteina_100g": 1, "carbohidratos_100g": 10, "grasas_100g": 2 }
    ]
  },
  {
    "nombre": "Canelones de verdura y ricota",
    "categoria": "tradicional",
    "ingredientes": [
      { "nombre_alimento": "Panqueques (masa)", "cantidad_gramos": 100, "calorias_100g": 220, "proteina_100g": 7, "carbohidratos_100g": 30, "grasas_100g": 8 },
      { "nombre_alimento": "Acelga o espinaca cocida", "cantidad_gramos": 100, "calorias_100g": 20, "proteina_100g": 2, "carbohidratos_100g": 4, "grasas_100g": 0.1 },
      { "nombre_alimento": "Ricota", "cantidad_gramos": 60, "calorias_100g": 140, "proteina_100g": 11, "carbohidratos_100g": 3, "grasas_100g": 9 },
      { "nombre_alimento": "Salsa blanca", "cantidad_gramos": 80, "calorias_100g": 130, "proteina_100g": 4, "carbohidratos_100g": 10, "grasas_100g": 8 }
    ]
  },
  {
    "nombre": "Filet de merluza con puré de calabaza",
    "categoria": "tradicional",
    "ingredientes": [
      { "nombre_alimento": "Filet de merluza al horno", "cantidad_gramos": 200, "calorias_100g": 90, "proteina_100g": 18, "carbohidratos_100g": 0, "grasas_100g": 2 },
      { "nombre_alimento": "Puré de calabaza/zapallo", "cantidad_gramos": 200, "calorias_100g": 45, "proteina_100g": 1, "carbohidratos_100g": 9, "grasas_100g": 1 }
    ]
  }
], ...[
  {
    "nombre": "Omelette de claras con espinaca",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Claras de huevo", "cantidad_gramos": 150, "calorias_100g": 52, "proteina_100g": 11, "carbohidratos_100g": 0.7, "grasas_100g": 0.2 },
      { "nombre_alimento": "Espinaca cocida", "cantidad_gramos": 50, "calorias_100g": 23, "proteina_100g": 2.9, "carbohidratos_100g": 3.6, "grasas_100g": 0.4 }
    ]
  },
  {
    "nombre": "Tostadas con huevo revuelto",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Pan integral", "cantidad_gramos": 60, "calorias_100g": 250, "proteina_100g": 10, "carbohidratos_100g": 40, "grasas_100g": 4 },
      { "nombre_alimento": "Huevo entero", "cantidad_gramos": 100, "calorias_100g": 143, "proteina_100g": 12.5, "carbohidratos_100g": 0.7, "grasas_100g": 9.5 }
    ]
  },
  {
    "nombre": "Tostadas con palta y huevo",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Pan integral", "cantidad_gramos": 50, "calorias_100g": 250, "proteina_100g": 10, "carbohidratos_100g": 40, "grasas_100g": 4 },
      { "nombre_alimento": "Palta", "cantidad_gramos": 40, "calorias_100g": 160, "proteina_100g": 2, "carbohidratos_100g": 8.5, "grasas_100g": 15 },
      { "nombre_alimento": "Huevo entero duro", "cantidad_gramos": 50, "calorias_100g": 143, "proteina_100g": 12.5, "carbohidratos_100g": 0.7, "grasas_100g": 9.5 }
    ]
  },
  {
    "nombre": "Avena con polvo de proteína",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Avena tradicional", "cantidad_gramos": 50, "calorias_100g": 389, "proteina_100g": 16.9, "carbohidratos_100g": 66, "grasas_100g": 6.9 },
      { "nombre_alimento": "Polvo de proteína whey", "cantidad_gramos": 30, "calorias_100g": 380, "proteina_100g": 75, "carbohidratos_100g": 8, "grasas_100g": 5 }
    ]
  },
  {
    "nombre": "Yogur griego con avena y arándanos",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Yogur griego natural descremado", "cantidad_gramos": 150, "calorias_100g": 59, "proteina_100g": 10, "carbohidratos_100g": 3.6, "grasas_100g": 0.4 },
      { "nombre_alimento": "Avena tradicional", "cantidad_gramos": 30, "calorias_100g": 389, "proteina_100g": 16.9, "carbohidratos_100g": 66, "grasas_100g": 6.9 },
      { "nombre_alimento": "Arándanos", "cantidad_gramos": 50, "calorias_100g": 57, "proteina_100g": 0.7, "carbohidratos_100g": 14, "grasas_100g": 0.3 }
    ]
  },
  {
    "nombre": "Huevos revueltos con pechuga de pavo",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Huevo entero", "cantidad_gramos": 100, "calorias_100g": 143, "proteina_100g": 12.5, "carbohidratos_100g": 0.7, "grasas_100g": 9.5 },
      { "nombre_alimento": "Pechuga de pavo (fiambre)", "cantidad_gramos": 50, "calorias_100g": 104, "proteina_100g": 17, "carbohidratos_100g": 4, "grasas_100g": 2 }
    ]
  },
  {
    "nombre": "Galletas de arroz con mantequilla de maní y banana",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Galletas de arroz", "cantidad_gramos": 25, "calorias_100g": 387, "proteina_100g": 8, "carbohidratos_100g": 81, "grasas_100g": 2.8 },
      { "nombre_alimento": "Mantequilla de maní sin azúcar", "cantidad_gramos": 20, "calorias_100g": 588, "proteina_100g": 25, "carbohidratos_100g": 20, "grasas_100g": 50 },
      { "nombre_alimento": "Banana", "cantidad_gramos": 80, "calorias_100g": 89, "proteina_100g": 1.1, "carbohidratos_100g": 23, "grasas_100g": 0.3 }
    ]
  },
  {
    "nombre": "Panqueques de avena y clara de huevo",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Avena tradicional", "cantidad_gramos": 40, "calorias_100g": 389, "proteina_100g": 16.9, "carbohidratos_100g": 66, "grasas_100g": 6.9 },
      { "nombre_alimento": "Claras de huevo", "cantidad_gramos": 100, "calorias_100g": 52, "proteina_100g": 11, "carbohidratos_100g": 0.7, "grasas_100g": 0.2 },
      { "nombre_alimento": "Huevo entero", "cantidad_gramos": 50, "calorias_100g": 143, "proteina_100g": 12.5, "carbohidratos_100g": 0.7, "grasas_100g": 9.5 }
    ]
  },
  {
    "nombre": "Batido de proteína con leche y banana",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Polvo de proteína whey", "cantidad_gramos": 30, "calorias_100g": 380, "proteina_100g": 75, "carbohidratos_100g": 8, "grasas_100g": 5 },
      { "nombre_alimento": "Leche descremada", "cantidad_gramos": 250, "calorias_100g": 34, "proteina_100g": 3.4, "carbohidratos_100g": 5, "grasas_100g": 0.1 },
      { "nombre_alimento": "Banana", "cantidad_gramos": 100, "calorias_100g": 89, "proteina_100g": 1.1, "carbohidratos_100g": 23, "grasas_100g": 0.3 }
    ]
  },
  {
    "nombre": "Yogur griego con almendras",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Yogur griego natural descremado", "cantidad_gramos": 200, "calorias_100g": 59, "proteina_100g": 10, "carbohidratos_100g": 3.6, "grasas_100g": 0.4 },
      { "nombre_alimento": "Almendras", "cantidad_gramos": 20, "calorias_100g": 579, "proteina_100g": 21, "carbohidratos_100g": 21, "grasas_100g": 49 }
    ]
  },
  {
    "nombre": "Pollo con arroz y brócoli",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Pechuga de pollo cocida", "cantidad_gramos": 150, "calorias_100g": 165, "proteina_100g": 31, "carbohidratos_100g": 0, "grasas_100g": 3.6 },
      { "nombre_alimento": "Arroz blanco cocido", "cantidad_gramos": 150, "calorias_100g": 130, "proteina_100g": 2.7, "carbohidratos_100g": 28, "grasas_100g": 0.3 },
      { "nombre_alimento": "Brócoli cocido", "cantidad_gramos": 100, "calorias_100g": 35, "proteina_100g": 2.4, "carbohidratos_100g": 7, "grasas_100g": 0.4 }
    ]
  },
  {
    "nombre": "Salmón con batata al horno",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Salmón cocido", "cantidad_gramos": 150, "calorias_100g": 206, "proteina_100g": 22, "carbohidratos_100g": 0, "grasas_100g": 12 },
      { "nombre_alimento": "Batata cocida", "cantidad_gramos": 150, "calorias_100g": 90, "proteina_100g": 2, "carbohidratos_100g": 21, "grasas_100g": 0.2 }
    ]
  },
  {
    "nombre": "Ensalada de atún con papa y tomate",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Atún al natural escurrido", "cantidad_gramos": 120, "calorias_100g": 116, "proteina_100g": 25, "carbohidratos_100g": 0, "grasas_100g": 0.8 },
      { "nombre_alimento": "Papa hervida", "cantidad_gramos": 150, "calorias_100g": 86, "proteina_100g": 2, "carbohidratos_100g": 20, "grasas_100g": 0.1 },
      { "nombre_alimento": "Tomate", "cantidad_gramos": 100, "calorias_100g": 18, "proteina_100g": 1, "carbohidratos_100g": 4, "grasas_100g": 0.2 }
    ]
  },
  {
    "nombre": "Bowl de quinoa con pechuga de pollo",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Quinoa cocida", "cantidad_gramos": 150, "calorias_100g": 120, "proteina_100g": 4.4, "carbohidratos_100g": 21, "grasas_100g": 1.9 },
      { "nombre_alimento": "Pechuga de pollo cocida", "cantidad_gramos": 120, "calorias_100g": 165, "proteina_100g": 31, "carbohidratos_100g": 0, "grasas_100g": 3.6 }
    ]
  },
  {
    "nombre": "Wrap integral de pollo y palta",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Wrap / Tortilla integral", "cantidad_gramos": 50, "calorias_100g": 290, "proteina_100g": 8, "carbohidratos_100g": 48, "grasas_100g": 7 },
      { "nombre_alimento": "Pechuga de pollo cocida", "cantidad_gramos": 100, "calorias_100g": 165, "proteina_100g": 31, "carbohidratos_100g": 0, "grasas_100g": 3.6 },
      { "nombre_alimento": "Palta", "cantidad_gramos": 40, "calorias_100g": 160, "proteina_100g": 2, "carbohidratos_100g": 8.5, "grasas_100g": 15 }
    ]
  },
  {
    "nombre": "Bife magro con papas al horno",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Carne vacuna magra cocida", "cantidad_gramos": 150, "calorias_100g": 214, "proteina_100g": 29, "carbohidratos_100g": 0, "grasas_100g": 10 },
      { "nombre_alimento": "Papa al horno", "cantidad_gramos": 200, "calorias_100g": 86, "proteina_100g": 2, "carbohidratos_100g": 20, "grasas_100g": 0.1 }
    ]
  },
  {
    "nombre": "Fideos con carne picada magra",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Fideos secos cocidos", "cantidad_gramos": 150, "calorias_100g": 130, "proteina_100g": 5, "carbohidratos_100g": 25, "grasas_100g": 1 },
      { "nombre_alimento": "Carne picada magra cocida", "cantidad_gramos": 120, "calorias_100g": 212, "proteina_100g": 26, "carbohidratos_100g": 0, "grasas_100g": 11 }
    ]
  },
  {
    "nombre": "Tofu firme con arroz integral",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Tofu firme", "cantidad_gramos": 150, "calorias_100g": 144, "proteina_100g": 15, "carbohidratos_100g": 3, "grasas_100g": 8 },
      { "nombre_alimento": "Arroz integral cocido", "cantidad_gramos": 150, "calorias_100g": 112, "proteina_100g": 2.6, "carbohidratos_100g": 23, "grasas_100g": 0.9 }
    ]
  },
  {
    "nombre": "Filet de merluza con puré de calabaza",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Merluza al horno", "cantidad_gramos": 180, "calorias_100g": 90, "proteina_100g": 18, "carbohidratos_100g": 0, "grasas_100g": 2 },
      { "nombre_alimento": "Puré de calabaza", "cantidad_gramos": 200, "calorias_100g": 45, "proteina_100g": 1, "carbohidratos_100g": 9, "grasas_100g": 1 }
    ]
  },
  {
    "nombre": "Solomillo de cerdo con batata",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Solomillo de cerdo cocido", "cantidad_gramos": 150, "calorias_100g": 143, "proteina_100g": 26, "carbohidratos_100g": 0, "grasas_100g": 3.5 },
      { "nombre_alimento": "Batata cocida", "cantidad_gramos": 150, "calorias_100g": 90, "proteina_100g": 2, "carbohidratos_100g": 21, "grasas_100g": 0.2 }
    ]
  },
  {
    "nombre": "Ensalada de pollo con palta",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Pechuga de pollo cocida", "cantidad_gramos": 120, "calorias_100g": 165, "proteina_100g": 31, "carbohidratos_100g": 0, "grasas_100g": 3.6 },
      { "nombre_alimento": "Palta", "cantidad_gramos": 50, "calorias_100g": 160, "proteina_100g": 2, "carbohidratos_100g": 8.5, "grasas_100g": 15 },
      { "nombre_alimento": "Lechuga", "cantidad_gramos": 100, "calorias_100g": 15, "proteina_100g": 1, "carbohidratos_100g": 3, "grasas_100g": 0.2 }
    ]
  },
  {
    "nombre": "Atún con galletas de arroz",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Atún al natural escurrido", "cantidad_gramos": 120, "calorias_100g": 116, "proteina_100g": 25, "carbohidratos_100g": 0, "grasas_100g": 0.8 },
      { "nombre_alimento": "Galletas de arroz", "cantidad_gramos": 30, "calorias_100g": 387, "proteina_100g": 8, "carbohidratos_100g": 81, "grasas_100g": 2.8 }
    ]
  },
  {
    "nombre": "Pechuga de pollo con ensalada mixta",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Pechuga de pollo cocida", "cantidad_gramos": 150, "calorias_100g": 165, "proteina_100g": 31, "carbohidratos_100g": 0, "grasas_100g": 3.6 },
      { "nombre_alimento": "Tomate", "cantidad_gramos": 100, "calorias_100g": 18, "proteina_100g": 1, "carbohidratos_100g": 4, "grasas_100g": 0.2 },
      { "nombre_alimento": "Lechuga", "cantidad_gramos": 50, "calorias_100g": 15, "proteina_100g": 1, "carbohidratos_100g": 3, "grasas_100g": 0.2 }
    ]
  },
  {
    "nombre": "Omelette de huevo entero con queso magro",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Huevo entero", "cantidad_gramos": 150, "calorias_100g": 143, "proteina_100g": 12.5, "carbohidratos_100g": 0.7, "grasas_100g": 9.5 },
      { "nombre_alimento": "Queso fresco magro", "cantidad_gramos": 40, "calorias_100g": 110, "proteina_100g": 12, "carbohidratos_100g": 3, "grasas_100g": 5 }
    ]
  },
  {
    "nombre": "Tostadas con queso untable y pavo",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Pan integral", "cantidad_gramos": 60, "calorias_100g": 250, "proteina_100g": 10, "carbohidratos_100g": 40, "grasas_100g": 4 },
      { "nombre_alimento": "Queso untable descremado", "cantidad_gramos": 30, "calorias_100g": 80, "proteina_100g": 11, "carbohidratos_100g": 4, "grasas_100g": 1.5 },
      { "nombre_alimento": "Pechuga de pavo (fiambre)", "cantidad_gramos": 50, "calorias_100g": 104, "proteina_100g": 17, "carbohidratos_100g": 4, "grasas_100g": 2 }
    ]
  },
  {
    "nombre": "Queso cottage con arándanos",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Queso cottage", "cantidad_gramos": 150, "calorias_100g": 98, "proteina_100g": 11, "carbohidratos_100g": 3.4, "grasas_100g": 4.3 },
      { "nombre_alimento": "Arándanos", "cantidad_gramos": 80, "calorias_100g": 57, "proteina_100g": 0.7, "carbohidratos_100g": 14, "grasas_100g": 0.3 }
    ]
  },
  {
    "nombre": "Batido de proteína con avena y mantequilla de maní",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Polvo de proteína whey", "cantidad_gramos": 30, "calorias_100g": 380, "proteina_100g": 75, "carbohidratos_100g": 8, "grasas_100g": 5 },
      { "nombre_alimento": "Avena tradicional", "cantidad_gramos": 30, "calorias_100g": 389, "proteina_100g": 16.9, "carbohidratos_100g": 66, "grasas_100g": 6.9 },
      { "nombre_alimento": "Mantequilla de maní sin azúcar", "cantidad_gramos": 15, "calorias_100g": 588, "proteina_100g": 25, "carbohidratos_100g": 20, "grasas_100g": 50 }
    ]
  },
  {
    "nombre": "Manzana con mantequilla de maní",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Manzana", "cantidad_gramos": 150, "calorias_100g": 52, "proteina_100g": 0.3, "carbohidratos_100g": 14, "grasas_100g": 0.2 },
      { "nombre_alimento": "Mantequilla de maní sin azúcar", "cantidad_gramos": 25, "calorias_100g": 588, "proteina_100g": 25, "carbohidratos_100g": 20, "grasas_100g": 50 }
    ]
  },
  {
    "nombre": "Huevos duros con arroz blanco",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Huevo entero duro", "cantidad_gramos": 100, "calorias_100g": 143, "proteina_100g": 12.5, "carbohidratos_100g": 0.7, "grasas_100g": 9.5 },
      { "nombre_alimento": "Arroz blanco cocido", "cantidad_gramos": 150, "calorias_100g": 130, "proteina_100g": 2.7, "carbohidratos_100g": 28, "grasas_100g": 0.3 }
    ]
  },
  {
    "nombre": "Lentejas con carne magra",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Lentejas cocidas", "cantidad_gramos": 150, "calorias_100g": 116, "proteina_100g": 9, "carbohidratos_100g": 20, "grasas_100g": 0.5 },
      { "nombre_alimento": "Carne vacuna magra cocida", "cantidad_gramos": 100, "calorias_100g": 214, "proteina_100g": 29, "carbohidratos_100g": 0, "grasas_100g": 10 }
    ]
  },
  {
    "nombre": "Wrap integral de atún",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Wrap / Tortilla integral", "cantidad_gramos": 50, "calorias_100g": 290, "proteina_100g": 8, "carbohidratos_100g": 48, "grasas_100g": 7 },
      { "nombre_alimento": "Atún al natural escurrido", "cantidad_gramos": 120, "calorias_100g": 116, "proteina_100g": 25, "carbohidratos_100g": 0, "grasas_100g": 0.8 },
      { "nombre_alimento": "Tomate", "cantidad_gramos": 60, "calorias_100g": 18, "proteina_100g": 1, "carbohidratos_100g": 4, "grasas_100g": 0.2 }
    ]
  },
  {
    "nombre": "Fideos con pechuga de pollo",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Fideos secos cocidos", "cantidad_gramos": 150, "calorias_100g": 130, "proteina_100g": 5, "carbohidratos_100g": 25, "grasas_100g": 1 },
      { "nombre_alimento": "Pechuga de pollo cocida", "cantidad_gramos": 120, "calorias_100g": 165, "proteina_100g": 31, "carbohidratos_100g": 0, "grasas_100g": 3.6 }
    ]
  },
  {
    "nombre": "Bife de vaca a la plancha con brócoli",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Carne vacuna magra cocida", "cantidad_gramos": 150, "calorias_100g": 214, "proteina_100g": 29, "carbohidratos_100g": 0, "grasas_100g": 10 },
      { "nombre_alimento": "Brócoli cocido", "cantidad_gramos": 150, "calorias_100g": 35, "proteina_100g": 2.4, "carbohidratos_100g": 7, "grasas_100g": 0.4 }
    ]
  },
  {
    "nombre": "Arroz con palta y huevo duro",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Arroz blanco cocido", "cantidad_gramos": 150, "calorias_100g": 130, "proteina_100g": 2.7, "carbohidratos_100g": 28, "grasas_100g": 0.3 },
      { "nombre_alimento": "Palta", "cantidad_gramos": 40, "calorias_100g": 160, "proteina_100g": 2, "carbohidratos_100g": 8.5, "grasas_100g": 15 },
      { "nombre_alimento": "Huevo entero duro", "cantidad_gramos": 50, "calorias_100g": 143, "proteina_100g": 12.5, "carbohidratos_100g": 0.7, "grasas_100g": 9.5 }
    ]
  },
  {
    "nombre": "Tostadas con mantequilla de maní y banana",
    "categoria": "fitness",
    "ingredientes": [
      { "nombre_alimento": "Pan integral", "cantidad_gramos": 60, "calorias_100g": 250, "proteina_100g": 10, "carbohidratos_100g": 40, "grasas_100g": 4 },
      { "nombre_alimento": "Mantequilla de maní sin azúcar", "cantidad_gramos": 20, "calorias_100g": 588, "proteina_100g": 25, "carbohidratos_100g": 20, "grasas_100g": 50 },
      { "nombre_alimento": "Banana", "cantidad_gramos": 80, "calorias_100g": 89, "proteina_100g": 1.1, "carbohidratos_100g": 23, "grasas_100g": 0.3 }
    ]
  }
]];

function franjasDePlantilla(plantilla) {
  if (plantilla.categoria !== 'fitness') return [];
  const nombre = String(plantilla.nombre || '').toLowerCase();
  const franjas = new Set();
  if (/omelette|tostad|avena|yogur|huevo.*revuelt|panqueque|batido/.test(nombre)) franjas.add('desayuno');
  if (/yogur|batido|galleta|panqueque|manzana|tostad|banana|mantequilla de maní/.test(nombre)) franjas.add('merienda');
  if (/pollo|arroz|salmón|salmon|ensalada|bowl|wrap|bife|fideo|tofu|merluza|solomillo|lenteja|huevo.*arroz/.test(nombre)) {
    franjas.add('almuerzo');
    franjas.add('cena');
  }
  if (/galleta|batido|manzana|yogur|atún con galletas|atun con galletas/.test(nombre)) franjas.add('extra');
  return franjas.size ? [...franjas] : ['extra'];
}

for (const plantilla of plantillas) plantilla.franjas_recomendadas = franjasDePlantilla(plantilla);

const db = getDatabase();

const buscarPlantilla = db.prepare(`
  SELECT id
  FROM plantillas_comida
  WHERE user_id IS NULL AND nombre = ? AND categoria = ?
`);

const actualizarFranjas = db.prepare(`
  UPDATE plantillas_comida SET franjas_recomendadas = ? WHERE id = ?
`);

const insertarPlantilla = db.prepare(`
  INSERT INTO plantillas_comida (user_id, nombre, categoria, franjas_recomendadas, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const insertarIngrediente = db.prepare(`
  INSERT INTO plantillas_ingredientes
    (plantilla_id, nombre_alimento, cantidad_gramos, calorias, proteina, carbohidratos, grasas)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

let insertadas = 0;
let omitidas = 0;

for (const plantilla of plantillas) {
  const existente = buscarPlantilla.get(plantilla.nombre, plantilla.categoria);

  if (existente) {
    actualizarFranjas.run(JSON.stringify(plantilla.franjas_recomendadas || []), existente.id);
    omitidas += 1;
    console.log(`Ya existe: ${plantilla.nombre} (${plantilla.categoria}), omitida`);
    continue;
  }

  db.exec('BEGIN');
  try {
    const now = Date.now();
    const resultado = insertarPlantilla.run(
      null,
      plantilla.nombre,
      plantilla.categoria,
      JSON.stringify(plantilla.franjas_recomendadas || []),
      now,
      now
    );

    for (const ingrediente of plantilla.ingredientes) {
      const factor = ingrediente.cantidad_gramos / 100;
      insertarIngrediente.run(
        resultado.lastInsertRowid,
        ingrediente.nombre_alimento,
        ingrediente.cantidad_gramos,
        ingrediente.calorias_100g * factor,
        ingrediente.proteina_100g * factor,
        ingrediente.carbohidratos_100g * factor,
        ingrediente.grasas_100g * factor
      );
    }

    db.exec('COMMIT');
    insertadas += 1;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

console.log(`Total insertadas: ${insertadas}`);
console.log(`Total omitidas por duplicado: ${omitidas}`);
