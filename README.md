# lauyim

Un seguidor de entrenamiento deportivo *self-hosted*, centrado en la privacidad, ligero y diseñado como PWA para funcionar de manera fluida en cualquier dispositivo[cite: 1, 2].

---

## 🚀 Características Principales

* **Autenticación Biométrica y Passkeys:** Inicio de sesión seguro mediante huella dactilar o Face ID sin depender de contraseñas[cite: 1, 2].
* **Catálogo Completo en Español:** Más de 1,300 ejercicios estructurados con traducciones, guías de ejecución y filtros por grupo muscular[cite: 2, 5].
* **Registro de Entrenamientos:** Seguimiento en tiempo real de series, repeticiones, cargas y temporizador de descanso[cite: 5, 8].
* **Generador Inteligente de Rutinas:** Encuesta paso a paso para sugerir planes personalizados según nivel, tiempo, equipamiento y lesiones[cite: 7].
* **Análisis y Métricas:** Gráficas de sobrecarga progresiva, mapa de actividad reciente y equilibrio muscular[cite: 5, 8].
* **100% Privado y Offline:** Funciona sin enviar tus datos de salud a la nube de terceros; la persistencia utiliza bases de datos locales en JSON[cite: 1, 2, 5].

---

## 🛠️ Stack Tecnológico

* **Frontend:** React + Vite + PWA (servido vía Nginx)[cite: 1, 5]
* **Backend:** Node.js (API REST)[cite: 1, 5]
* **Base de Datos:** Persistencia ligera basada en JSON (`db.json` / `db_espanol.json`)[cite: 1, 5, 9]
* **Infraestructura:** Docker Compose
* **Acceso Remoto Seguro:** Cloudflare Tunnels (`cloudflared`)

---

## 📦 Instalación Local con Docker

### 1. Clonar el repositorio
```bash
git clone [https://github.com/Lautaro-Costa44/lauyim.git](https://github.com/Lautaro-Costa44/lauyim.git)
cd lauyim