# Monitoreo de lauyim

Qué avisa si algo se rompe, y cómo configurarlo en el servidor. Nada de esto recibe datos de
socios: healthchecks recibe líneas del log de backup (nombres de instancia, tamaños, rutas) y
UptimeRobot solo consulta `/api/health`, que responde `{"ok":true}`.

| Qué se rompe | Quién avisa | Cómo se entera |
|---|---|---|
| El backup falla, o no corre (cron roto, servidor apagado) | healthchecks.io, check "Backup" | `scripts/backup.sh` avisa inicio y código; si a las 03:00 no llegó nada, alerta |
| El disco se está llenando | healthchecks.io, check "Disco" | `scripts/disk-check.sh` cada hora |
| Una instancia no responde (servidor, túnel, contenedor o base) | UptimeRobot | consulta `https://<instancia>/api/health` cada 5 minutos desde afuera |
| Los logs de docker llenan el disco | (se evita) | rotación en `/etc/docker/daemon.json` |

---

## 1. healthchecks.io (backup y disco)

Gratis hasta 20 checks. Las URLs de ping son secretas en la práctica (con una URL cualquiera puede
marcar el check como OK): guardalas en el gestor de contraseñas, no en el repo.

### 1.1 Crear la cuenta y los checks

1. Crear la cuenta en <https://healthchecks.io> y, en **Integrations**, sumar el canal de aviso
   (mail viene por defecto; Telegram es gratis y llega al celular).
2. Check **"lauyim backup"**: *Schedule* → *Cron expression* `0 2 * * *`, *Time zone*
   `America/Argentina/Buenos_Aires`, *Grace time* `1 hour`.
3. Check **"lauyim disco"**: *Schedule* → *Simple*, *Period* `1 hour`, *Grace time* `30 minutes`.
4. Copiar la *Ping URL* de cada uno (`https://hc-ping.com/<uuid>`).

### 1.2 Instalar los scripts en el servidor

Desde la copia del repo de prod (`~/hub/lauyim`, ya actualizada con `git pull`):

```bash
cp ~/hub/lauyim/scripts/backup.sh ~/hub/lauyim/scripts/disk-check.sh ~/hub/scripts/ && chmod 700 ~/hub/scripts/*.sh
```

### 1.3 Cron

`crontab -e` y dejar estas dos líneas (la de backup reemplaza a la que ya está):

```
0 2 * * * BACKUP_REMOTE=gdrive-crypt:lauyim BACKUP_PING_URL=https://hc-ping.com/<uuid-backup> /home/lauyyii/hub/scripts/backup.sh
15 * * * * DISK_PING_URL=https://hc-ping.com/<uuid-disco> /home/lauyyii/hub/scripts/disk-check.sh > /dev/null
```

`disk-check.sh` mide la carpeta `~/hub` y avisa falla desde el 85 % de uso (`DISK_PATH` y
`DISK_MAX_PCT` lo cambian).

### 1.4 Probar

```bash
BACKUP_REMOTE=gdrive-crypt:lauyim BACKUP_PING_URL=https://hc-ping.com/<uuid-backup> ~/hub/scripts/backup.sh --check
```

```bash
BACKUP_REMOTE=gdrive-crypt:lauyim BACKUP_PING_URL=https://hc-ping.com/<uuid-backup> ~/hub/scripts/backup.sh; echo "código $?"
```

En healthchecks, el check pasa a verde y en *Events* aparecen "Started" y "Success", con el log de
esa corrida en el cuerpo.

```bash
DISK_PING_URL=https://hc-ping.com/<uuid-disco> ~/hub/scripts/disk-check.sh; echo "código $?"
```

Para ver una alerta de verdad, forzar el límite al 1 % (el check pasa a rojo y llega el aviso):

```bash
DISK_PING_URL=https://hc-ping.com/<uuid-disco> DISK_MAX_PCT=1 ~/hub/scripts/disk-check.sh; echo "código $?"
```

Después correrlo una vez sin `DISK_MAX_PCT` para que vuelva a verde.

---

## 2. UptimeRobot (instancias)

Gratis hasta 50 monitores, cada 5 minutos, desde afuera del servidor: si se cae el servidor, el
túnel de Cloudflare, el contenedor o la base, avisa igual.

1. Crear la cuenta en <https://uptimerobot.com> y cargar el contacto de alerta (mail o Telegram).
2. Un monitor por instancia (prod, dev, demo y cada gym):
   - *Monitor type*: **Keyword**
   - *URL*: `https://lauyim.online/api/health` (o el dominio de la instancia)
   - *Keyword*: `"ok":true`, *Alert when*: **Keyword not exists**
   - *Interval*: 5 minutes
3. Opcional: una *Status page* pública con los monitores de los gyms, para mostrarle al dueño.

Probar con dev (avisa en 5 a 10 minutos):

```bash
cd ~/hub/lauyim-dev && docker compose -p lauyim-dev stop api
```

```bash
cd ~/hub/lauyim-dev && docker compose -p lauyim-dev start api
```

---

## 3. Rotación de logs de docker

Sin límite, el log de cada contenedor crece para siempre. Con esto docker guarda como máximo tres
archivos de 10 MB por contenedor, para todas las instancias (las de hoy y las que se agreguen).

1. Ver si ya hay un `/etc/docker/daemon.json` (si existe, sumarle las dos claves en vez de
   reemplazarlo):

   ```bash
   cat /etc/docker/daemon.json
   ```

2. Si no existe:

   ```bash
   echo '{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" } }' | sudo tee /etc/docker/daemon.json
   ```

3. Reiniciar docker. **Corta todas las instancias unos segundos**; hacerlo de noche. Los
   contenedores vuelven solos (`restart: unless-stopped`).

   ```bash
   sudo systemctl restart docker
   ```

4. La configuración nueva se aplica a los contenedores que se crean de nuevo. En cada instancia
   (prod, dev, demo), desde su carpeta:

   ```bash
   cd ~/hub/lauyim && docker compose -p lauyim up -d --force-recreate
   ```

5. Verificar (tiene que decir `max-file:3 max-size:10m`):

   ```bash
   docker inspect -f '{{.HostConfig.LogConfig}}' lauyim-api-1
   ```

---

## 4. Alta de un gym nuevo

- Un monitor más en UptimeRobot con su `https://<dominio>/api/health`.
- Una entrada más en `BACKUP_INSTANCES` en la línea de cron del backup, por ejemplo
  `BACKUP_INSTANCES="prod|lauyim-api-1 dev|lauyim-dev-api-1 gymx|gymx-api-1"`.
- Logs y disco no necesitan nada: ya cubren todas las instancias.

## 5. Lo que esto no cubre

Errores de la app (respuestas 500, excepciones): quedan en el log del contenedor.

```bash
docker compose -p lauyim logs --since 24h api | grep -iE "error|exception"
```
