# Backup y restauración de lauyim

Cada instancia (contenedor de la API + `/data`) se respalda como **un paquete** por noche:

```
prod_2026-09-26_02-00-00.tar.gz
└── prod_2026-09-26_02-00-00/
    ├── gym.db           copia consistente (VACUUM INTO) verificada con PRAGMA integrity_check
    ├── vapid.json       claves de Web Push: sin ellas todas las suscripciones quedan inválidas
    ├── secret           firma de sesiones: sin él todos los socios tienen que volver a entrar
    ├── audit.log        registro de auditoría (si AUDIT_LOG no está apagado)
    └── MANIFEST.sha256  sha256 de cada archivo
```

El paquete tiene **DNIs, teléfonos, mails y secretos**, así que se sube a un remote **`crypt`** de
rclone: Google Drive solo ve nombres y contenidos cifrados. `scripts/backup.sh` se niega a subir a
un remote que no sea `crypt` (salvo `BACKUP_ALLOW_UNENCRYPTED=1`).

---

## 1. Configurar el remote cifrado (una sola vez, en el servidor)

Se asume que ya existe el remote de Drive `gdrive-backup:` (el que usaba el backup viejo). Si no,
crearlo primero con `rclone config` → `n` → nombre `gdrive-backup` → tipo `drive` → scope
`drive.file` (solo ve lo que crea rclone).

### 1.1 Generar las dos contraseñas **en tu computadora, no en el servidor**

```bash
openssl rand -base64 32   # contraseña del crypt
openssl rand -base64 32   # salt (password2)
```

Guardalas **ya mismo** en tu gestor de contraseñas (Bitwarden, 1Password, etc.) con el nombre
"lauyim — rclone crypt", junto con el nombre del remote y la ruta de Drive (`lauyim-crypt`).

> **Por qué fuera del servidor:** `rclone.conf` guarda las contraseñas *ofuscadas*, no cifradas
> (`rclone reveal` las devuelve en claro). Si el servidor se rompe o lo roban, sin la copia en tu
> gestor **no hay forma de abrir ningún backup**. Y quien tenga `rclone.conf` + acceso al Drive
> puede leerlos: por eso el archivo tiene que quedar `chmod 600`.

### 1.2 Crear el remote `crypt`

En el servidor, como `lauyyii`:

```bash
rclone config
#  n) New remote
#  name> gdrive-crypt
#  Storage> crypt
#  remote> gdrive-backup:lauyim-crypt
#  filename_encryption> 1 (standard)
#  directory_name_encryption> 1 (true)
#  Password or pass phrase for encryption> y  → pegar la contraseña del crypt (dos veces)
#  Password or pass phrase for salt> y        → pegar el salt (dos veces)
#  Edit advanced config?> n
#  Keep this remote?> y
chmod 600 ~/.config/rclone/rclone.conf
```

No pegues las contraseñas en la línea de comandos (quedan en el historial de bash).

### 1.3 Probar

```bash
rclone listremotes --long              # tiene que aparecer: gdrive-crypt:   crypt
echo prueba > /tmp/p.txt && rclone copy /tmp/p.txt gdrive-crypt:lauyim/prueba && rm /tmp/p.txt
rclone ls gdrive-crypt:lauyim/prueba   # se ve p.txt (descifrado)
rclone ls gdrive-backup:lauyim-crypt   # en Drive se ven nombres ilegibles
rclone purge gdrive-crypt:lauyim/prueba
```

---

## 2. Backup automático

1. Copiar `scripts/backup.sh` del repo al servidor (`~/hub/scripts/backup.sh`) y `chmod 700`.
2. Validar la configuración sin subir nada:
   ```bash
   BACKUP_REMOTE=gdrive-crypt:lauyim ~/hub/scripts/backup.sh --check
   ```
3. Correrlo una vez a mano y revisar `~/hub/scripts/backup.log`:
   ```bash
   BACKUP_REMOTE=gdrive-crypt:lauyim ~/hub/scripts/backup.sh; echo "código $?"
   rclone ls gdrive-crypt:lauyim
   ```
4. Cron (`crontab -e`), reemplazando la línea vieja:
   ```
   0 2 * * * BACKUP_REMOTE=gdrive-crypt:lauyim /home/lauyyii/hub/scripts/backup.sh
   ```

| Variable | Default | Qué hace |
|---|---|---|
| `BACKUP_REMOTE` | — (obligatoria) | destino, ej. `gdrive-crypt:lauyim`. Cada instancia va en su carpeta (`…/prod`, `…/dev`) |
| `BACKUP_INSTANCES` | `prod\|lauyim-api-1 dev\|lauyim-dev-api-1` | `nombre\|contenedor` separados por espacio. Un gym nuevo = una entrada más |
| `BACKUP_RETENTION_DAYS` | `7` | se borran del remote los paquetes de más días, solo después de una subida buena |
| `BACKUP_LOG_FILE` | `backup.log` junto al script | log |
| `BACKUP_ALLOW_UNENCRYPTED` | — | `1` permite un remote que no es crypt (no usar con datos reales) |

Códigos de salida: `0` ok · `1` falló el dump de alguna instancia (contenedor caído, integridad,
archivo faltante) · `2` configuración (falta la variable, rclone, el remote, o no es crypt) ·
`3` falló rclone (subida o rotación). Los errores también salen por stderr (cron los manda por mail
si `MAILTO` está configurado).

Los backups viejos sin cifrar (`gdrive-backup:lauyim-backups/`) este script **no los toca**: cuando
el crypt lleve unos días andando, borrarlos a mano (`rclone purge gdrive-backup:lauyim-backups`).

**Antes de cada deploy:** correr el backup a mano (paso 3) además del cron.

---

## 3. Restaurar en un entorno de prueba (y verificar)

Hacerlo **al menos una vez por mes**: un backup que nunca se restauró no es un backup.

```bash
cd ~/hub/lauyim                     # la copia del repo con docker-compose.restore-test.yml
export BACKUP_REMOTE=gdrive-crypt:lauyim

scripts/restore.sh --list prod      # paquetes disponibles
scripts/restore.sh --instance prod  # baja el último, verifica sha256 + integrity_check,
                                    # y lo deja en ./restore-test-data
# o uno puntual:  scripts/restore.sh --instance prod --file prod_2026-09-26_02-00-00.tar.gz
# o uno ya bajado: scripts/restore.sh --package ~/prod_….tar.gz

# Imágenes locales (si no existen):
docker build -t lauyim-api:local api
docker build -t lauyim-web:local -f web/Dockerfile .

docker compose -f docker-compose.restore-test.yml -p restore-test up -d
```

Verificar:

```bash
curl -s http://localhost:3099/api/health          # {"ok":true,"users":N} con N ≈ socios de producción
docker compose -f docker-compose.restore-test.yml -p restore-test logs api | tail    # sin errores de base
docker compose -f docker-compose.restore-test.yml -p restore-test exec api node -e "
  const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/data/gym.db',{readOnly:true});
  for (const t of ['users','member_profile','payments','plans']) console.log(t, d.prepare('select count(*) n from '+t).get().n)"
```

- `users`, `member_profile`, `payments` y `plans` tienen que dar números parecidos a producción.
- El login con passkey **no** funciona en `localhost:3099` (las passkeys están atadas al dominio de
  producción): es esperado. Lo que se verifica es que la base abra, tenga los datos y la API arranque.

Limpiar:

```bash
docker compose -f docker-compose.restore-test.yml -p restore-test down
rm -rf restore-test-data            # tiene DNIs: no dejarlo tirado
```

`restore.sh` nunca escribe en `~/hub/lauyim/data` ni en `~/hub/lauyim-dev/data`: se niega si el
destino parece el directorio de una instancia en uso.

---

## 4. Restaurar producción (desastre)

Solo si la base de producción se perdió o está dañada. A mano y con la API parada:

```bash
cd ~/hub/lauyim
BACKUP_REMOTE=gdrive-crypt:lauyim scripts/restore.sh --instance prod --target ~/restore-prod
docker compose -p lauyim stop api
mkdir -p ~/data-rota && mv data/gym.db* data/vapid.json data/secret data/audit.log ~/data-rota/ 2>/dev/null
cp -p ~/restore-prod/* data/
docker compose -p lauyim start api
curl -s https://lauyim.online/api/health
rm -rf ~/restore-prod               # cuando todo ande; ~/data-rota después de unos días
```

Se pierde lo cargado desde el último backup (hasta 24 h): avisar al gym para que vuelva a registrar
los pagos de ese día.

Si el servidor se perdió entero: instalar rclone en el nuevo, recrear `gdrive-backup:` y
`gdrive-crypt:` con **las mismas contraseñas del gestor** (paso 1.2) y seguir desde acá.
