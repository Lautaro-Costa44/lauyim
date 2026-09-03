<p align="center">
  <img src="assets/banner.svg" alt="lauyim" width="480">
</p>

# lauyim

**lauyim** es un seguidor de entrenamiento y peso corporal *self-hosted*: dos contenedores
(`api` + `web`) más una carpeta `./data` que es tuya — sin cuenta de terceros, sin telemetría.
Login con passkeys (WebAuthn), instalable como app de pantalla de inicio (PWA).

Licencia: AGPL-3.0-or-later.

---

## Características

- **Login con passkeys (WebAuthn)** — sin contraseñas, huella o Face ID según el dispositivo.
- **Modo invitado** — usar la app sin cuenta, los datos quedan solo en ese navegador.
- **Catálogo de ejercicios** — más de 1.300 ejercicios con instrucciones, filtros por grupo
  muscular e imágenes/GIFs de ejecución.
- **Registro de entrenamientos** — series, repeticiones, carga, temporizador de descanso,
  supersets y ejercicios de cardio.
- **Motor de progresión** — reglas de progresión (lineal, Greyskull LP, doble progresión,
  basada en tiempo) que sugieren la siguiente carga/serie automáticamente.
- **Generador de rutinas** — encuesta paso a paso que arma un plan según nivel, tiempo,
  equipamiento y lesiones.
- **Estadísticas** — sobrecarga progresiva, 1RM estimado, mapa de recuperación/equilibrio
  muscular, historial y actividad reciente.
- **Notificaciones push** — aviso de fin de descanso y recordatorios de entrenamiento
  (Web Push, claves VAPID autogeneradas).
- **Panel de administración opcional** — gestión de usuarios, invitaciones y log de
  actividad, para quien despliegue una instancia para más de una persona.
- **PWA instalable y offline** — funciona como app nativa en el celular, sin depender de
  la nube de un tercero.
- **Servidor MCP opcional** (`mcp/`) — puente de solo lectura (Model Context Protocol) para
  que un cliente LLM (Claude Desktop, Cursor…) lea rutinas, workouts, 1RM y equilibrio
  muscular de un usuario, sin llamadas de red ni contenedor extra.

## Stack técnico

| Capa | Tecnología |
|---|---|
| Frontend | React 19 + Vite, Zustand (estado), React Router — build estático servido por nginx |
| Backend | Node.js puro (`node:http`, sin framework) |
| Datos | SQLite (`better-sqlite3`) bajo `./data`, ficheros por usuario |
| Auth | WebAuthn/passkeys (`@simplewebauthn/server`) + cookie de sesión firmada (HMAC) |
| Push | `web-push` con claves VAPID |
| Infraestructura | Docker Compose (`api`, `web`, `media`) |

## Estructura del repositorio

```
frontend/  App React (src/views, src/components, src/store, src/lib). Compila a estático.
api/       Backend: server.js (Node, sin framework), database.js (SQLite), scheduler.js, etc.
web/       Dockerfile multi-stage (build del frontend → nginx) + nginx.conf.template.
mcp/       Servidor MCP opcional (solo lectura), corre por fuera del build de Docker.
media/     Imágenes/GIFs de ejercicios (gitignored), se descargan al levantar el servicio media.
scripts/   Utilidades (descarga de media, generación de instrucciones).
website/   Sitio estático de marketing (HTML/CSS/JS plano).
docs/      Guías (self-hosting, importación de datos).
```

## Puesta en marcha con Docker

Requisitos: Docker con el plugin Compose.

```bash
git clone https://github.com/Lautaro-Costa44/lauyim.git
cd lauyim
cp .env.example .env
docker compose up -d --build
```

- El primer arranque descarga las imágenes/GIFs de ejercicios (~140 MB) en `media/`.
- Abrí `http://localhost:8080` y creá tu perfil con passkey (o entrá como invitado).
- Estado: `docker compose ps` · logs: `docker compose logs -f` · parar: `docker compose down`.

> Las passkeys están atadas a un hostname exacto y requieren HTTPS (excepto `localhost`). Para
> usar la app desde otro dispositivo hace falta un dominio real detrás de un proxy con TLS
> (Cloudflare Tunnel, Caddy, Traefik/nginx…), configurando `RP_ID` y `ORIGIN` en `.env`.

### Variables de entorno principales (`.env`)

| Variable | Uso |
|---|---|
| `RP_ID` / `ORIGIN` | Hostname y origen público exactos que ve el navegador (passkeys) |
| `WEB_PORT` / `NGINX_PORT` / `PORT` | Puertos de host / nginx / API |
| `SESSION_DAYS` | Duración de la sesión firmada |
| `ADMIN_UIDS` | IDs de usuario (separados por coma) con acceso al panel de admin |
| `INVITE_ONLY` | Exige código de invitación para crear un perfil |
| `ALLOW_GUEST` | Habilita/deshabilita el modo invitado |
| `BREVO_API_KEY` | API key de Brevo para enviar mails de soporte |
| `SUPPORT_DESTINATION_EMAIL` | Casilla destino de los reportes de soporte |
| `INSTANCE_NAME` | Nombre de la instancia usado en esos reportes |

## Desarrollo local

```bash
# Frontend con hot reload (proxya /api hacia :3000)
cd frontend && npm install && npm run dev

# Backend
cd api && npm install && npm start

# Servidor MCP (opcional)
cd mcp && npm install && npm start
```

### Tests

```bash
# Lógica de entrenamiento (progresión, 1RM, lectura de sesiones)
cd frontend && npm test              # vitest run
cd frontend && npm run test:watch
npx vitest run src/lib/progression.test.js   # un archivo puntual
npx vitest run -t "some test name"           # un test por nombre

# Backend
cd api && npm test

# MCP
cd mcp && npm test
```

No hay linter/formateador configurado (sin ESLint/Prettier) ni TypeScript: el estilo se
mantiene a mano siguiendo el código existente.

### Build de producción

```bash
cd frontend && npm run build
```

## Privacidad

Sin cuenta de terceros, sin telemetría, sin analítica externa. Todo el estado vive en
`./data`, en el servidor que vos elijas. El modo invitado ni siquiera llega a tocar el
servidor: los datos quedan solo en el navegador.

## Licencia

AGPL-3.0-or-later — ver [LICENSE](LICENSE).
