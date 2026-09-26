# Entrega 1 — Backup cifrado (solo código)

Rama: `claude/entrega-1-backup` (desde `main`).

## Auditoría del estado actual

- `scripts/backup.sh` (cron 02:00 en el host):
  - remote fijo `gdrive-backup:lauyim-backups/` (**sin cifrar**);
  - por instancia (`prod|lauyim-api-1`, `dev|lauyim-dev-api-1`): `VACUUM INTO /tmp/backup_tmp.db`
    dentro del contenedor → `docker cp` → `gzip` → `rclone copy`;
  - **solo `gym.db`**: no guarda `vapid.json` (sin él, todas las suscripciones push quedan
    inválidas al restaurar), `secret` (sin él se invalidan todas las sesiones) ni `audit.log`;
  - rotación: 7 días local (`/tmp`) y remota (`rclone delete --min-age 7d`);
  - los errores van al log y el código de salida es 1, pero no hay mensaje en stderr, no se
    distingue un fallo de rclone de uno de docker y no se valida que el remote exista;
  - los `.db` quedan en `/tmp` del host con permisos por defecto (legibles por otros usuarios).
- `docker-compose.restore-test.yml`: levanta `lauyim-api:local` + `lauyim-web:local` con
  `./restore-test-data` como `/data` en `http://localhost:3099`. No hay `restore.sh` ni doc.
- Archivos de `/data` (`api/server.js`): `gym.db` (+ `-wal`/`-shm`), `secret` (l.278),
  `vapid.json` (l.429), `audit.log` (l.872).

## Plan

1. `scripts/backup.sh` reescrito:
   - `BACKUP_REMOTE` obligatorio (ej. `gdrive-crypt:lauyim`); sin él, sale con código 2 y mensaje.
   - Verifica antes de empezar: `rclone` instalado, el remote existe (`rclone listremotes`)
     y es de tipo `crypt`. Si no es `crypt` falla, salvo `BACKUP_ALLOW_UNENCRYPTED=1`.
   - Instancias configurables con `BACKUP_INSTANCES="prod|lauyim-api-1 dev|lauyim-dev-api-1"`
     (ese es el default, igual que hoy).
   - Un paquete por instancia: `<instancia>_<fecha>.tar.gz` con `gym.db` (VACUUM INTO +
     `PRAGMA integrity_check`), `vapid.json`, `secret`, `audit.log` (si existe; `AUDIT_LOG=0`
     no lo crea) y `MANIFEST.sha256`. Sube a `$BACKUP_REMOTE/<instancia>/`.
   - Temporales del host en un `mktemp -d` con `umask 077`, borrado con `trap` siempre.
   - Archivo temporal del contenedor con nombre único (no más `/tmp/backup_tmp.db` fijo).
   - Rotación igual que hoy (`BACKUP_RETENTION_DAYS`, default 7) pero por carpeta de instancia,
     y solo si la subida de esa instancia salió bien (un remote caído no borra lo viejo).
   - Códigos de salida: 0 ok · 1 falló el dump/empaquetado de alguna instancia · 2 configuración
     (falta variable, rclone, remote) · 3 falló rclone (subida o rotación). Mensaje `ERROR:` en
     stderr y en el log.
   - `--check`: solo valida configuración (para probar el cron sin subir nada).
2. `scripts/restore.sh`: lista (`--list <instancia>`), baja (`--instance <i> [--file <nombre>|latest]`)
   o usa un paquete local (`--package <archivo>`), verifica los sha256 del `MANIFEST`, extrae en
   un directorio destino (default `./restore-test-data`, se niega si no está vacío salvo `--force`)
   y corre `PRAGMA integrity_check` (con `sqlite3` del host o con la imagen `lauyim-api:local`).
   **Nunca escribe en `~/hub/lauyim/data`**: restaurar producción es un paso manual documentado.
3. `docs/backup-restore.md`: configurar el remote `crypt` de rclone paso a paso (contraseñas
   generadas y guardadas fuera del servidor), variables del cron, restaurar con
   `docker-compose.restore-test.yml`, cómo verificar, y restauración real de producción.
4. `scripts/tests/backup-restore.test.sh`: prueba con `docker` y `rclone` falsos (stubs en
   `PATH`) — paquete completo, remote no-crypt rechazado, fallo de rclone → código 3, ida y
   vuelta con `restore.sh` y detección de un archivo alterado. No se suma a CI (el workflow
   `test.yml` solo mira `frontend/`, `api/`, `mcp/`).

Sin librerías nuevas. No se toca `.env`, `docker-compose.yml` ni el servidor.

## Decisiones propias / PREGUNTAS

- **RESUELTO (Lautaro):** sí, falla si el remote no es `crypt`. Orden: primero configurar
  `gdrive-crypt:`, después copiar el script (anotado al principio del runbook).
- (Pregunta original) el script falla si el remote no es `crypt`. Es lo conservador (backups con DNIs
  sin cifrar en Drive), pero el cron actual del servidor apunta a `gdrive-backup:` (sin cifrar):
  al copiar este script al servidor sin configurar el crypt, el backup nocturno **va a fallar**
  hasta que se configure. Salida de emergencia: `BACKUP_ALLOW_UNENCRYPTED=1`.
- **PREGUNTA:** la ruta remota pasa de `lauyim-backups/<archivo>` plano a
  `<remote>/<instancia>/<archivo>`. Los backups viejos sin cifrar no se tocan ni se rotan desde
  este script: borrarlos a mano cuando el crypt esté andando.
- `vapid.json` y `secret` son secretos: van en el paquete porque sin ellos la restauración pierde
  push y sesiones; por eso el cifrado es obligatorio por defecto.
