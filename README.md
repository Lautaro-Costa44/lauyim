# lauyim

Un seguidor de entrenamiento deportivo *self-hosted*, centrado en la privacidad, ligero y diseñado como PWA para funcionar de manera fluida en cualquier dispositivo.

## Créditos y licencia

lauyim es un fork de [openGym](https://github.com/DuarteSantos8/openGym).

El proyecto está licenciado bajo [AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html).

[Ver código fuente](https://github.com/Lautaro-Costa44/lauyim)

---

## Características

### Entrenamiento

- Catálogo de ejercicios.
- Registro de series, repeticiones y carga.
- Generador de rutinas.
- Métricas y seguimiento del progreso.

### Nutrición

- Módulo de nutrición.
- Sincronización de datos.

### Cuentas y acceso

- WebAuthn/Passkeys para autenticación sin contraseñas.
- Sesiones firmadas.
- Protección CSRF.
- Invitaciones y acceso configurable mediante `INVITE_ONLY` y `ALLOW_GUEST`.

### Administración

- Roles Owner/Admin mediante `ADMIN_UIDS`.
- Panel de gestión.

### Notificaciones

- Web Push/VAPID.
- Protección de endpoints privados.

### Confiabilidad

- Backups automáticos de SQLite mediante `VACUUM INTO`.
- Retención de backups local y remota.
- Rate limiting.
- Límites de tamaño de request.
- Persistencia local en SQLite con WAL.

---

## 🛠️ Stack Tecnológico

- **Frontend:** React + Vite + Service Worker (PWA con precache atómico).
- **Backend:** Node.js 22 + `node:sqlite`.
- **Autenticación:** WebAuthn/Passkeys.
- **Persistencia:** SQLite (`data/gym.db`) con WAL.
- **Contenedores y proxy:** Docker Compose + Nginx.
- **Acceso remoto:** Cloudflare Tunnels.

---

## 📦 Instalación Local con Docker

### 1. Clonar el repositorio
```bash
git clone [https://github.com/Lautaro-Costa44/lauyim.git](https://github.com/Lautaro-Costa44/lauyim.git)
cd lauyim
```

### 2. Configurar el entorno

Copiar `.env.example` a `.env` y ajustar las variables necesarias para la instancia.

```bash
cp .env.example .env
```

La API utiliza Node.js 22. La versión está fijada en `.nvmrc` y los Dockerfiles utilizan imágenes basadas en `node:22-alpine`.

### 3. Levantar los servicios

```bash
docker compose up --build -d
```

La composición inicia la descarga de los medios de ejercicios cuando todavía no están presentes, construye la API y el frontend y sirve la aplicación mediante Nginx. Por defecto, el frontend queda publicado en el puerto `8080` y la API escucha internamente en el puerto `3000`.

### 4. Abrir la aplicación

Con la configuración predeterminada, acceder a:

```text
http://localhost:8080
```

Los datos persistentes de la instancia se almacenan en `./data` y se montan en el contenedor de la API como `/data`. Este directorio debe incluirse en la estrategia de backups.

Para detener la instancia:

```bash
docker compose down
```

Para consultar los logs:

```bash
docker compose logs -f
```

Para publicar la instancia mediante Cloudflare Tunnels, configurar `cloudflared` según el entorno y asegurarse de que el proxy preserve la configuración de origen prevista por la instancia.
