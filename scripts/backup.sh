#!/usr/bin/env bash
# Backup de las instancias de lauyim: un paquete .tar.gz por instancia con gym.db (VACUUM INTO,
# consistente con la API andando), vapid.json, secret y audit.log, subido con rclone a un remote
# cifrado (crypt). Ver docs/backup-restore.md.
#
# Variables:
#   BACKUP_REMOTE            obligatorio. Remote de rclone de destino, ej. gdrive-crypt:lauyim
#   BACKUP_INSTANCES         "nombre|contenedor ..." (default: "prod|lauyim-api-1 dev|lauyim-dev-api-1")
#   BACKUP_RETENTION_DAYS    días que se conservan en el remote (default 7)
#   BACKUP_LOG_FILE          log (default: backup.log junto a este script)
#   BACKUP_ALLOW_UNENCRYPTED 1 = permitir un remote que no es crypt (no recomendado: hay DNIs y secretos)
#
# Uso:  backup.sh           hace el backup
#       backup.sh --check   solo valida la configuración (rclone, remote, contenedores)
#
# Códigos de salida: 0 ok · 1 falló el dump/empaquetado de alguna instancia
#                    2 configuración inválida · 3 falló rclone (subida o rotación)
#
# Cron (crontab -e del usuario que corre docker):
#   0 2 * * * BACKUP_REMOTE=gdrive-crypt:lauyim /home/lauyyii/hub/scripts/backup.sh
set -u -o pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="${BACKUP_LOG_FILE:-${SCRIPT_DIR}/backup.log}"
REMOTE="${BACKUP_REMOTE:-}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-7}"
read -r -a INSTANCES <<< "${BACKUP_INSTANCES:-prod|lauyim-api-1 dev|lauyim-dev-api-1}"
TIMESTAMP="$(date '+%Y-%m-%d_%H-%M-%S')"
DATA_FILES=(vapid.json secret audit.log)
EXIT_DUMP=1
EXIT_CONFIG=2
EXIT_RCLONE=3

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"
}

error() {
  log "ERROR: $*"
  printf 'backup.sh: ERROR: %s\n' "$*" >&2
}

# remote_path "gdrive-crypt:lauyim" prod -> gdrive-crypt:lauyim/prod ("gdrive-crypt:" -> gdrive-crypt:prod)
remote_path() {
  case "$1" in
    *: | */) printf '%s%s' "$1" "$2" ;;
    *) printf '%s/%s' "$1" "$2" ;;
  esac
}

check_config() {
  if [[ -z "$REMOTE" ]]; then
    error "falta BACKUP_REMOTE (ej. BACKUP_REMOTE=gdrive-crypt:lauyim). Ver docs/backup-restore.md."
    return 1
  fi
  if [[ "$REMOTE" != *:* ]]; then
    error "BACKUP_REMOTE='$REMOTE' no es un remote de rclone (tiene que ser nombre:ruta)."
    return 1
  fi
  if ! [[ "$RETENTION_DAYS" =~ ^[1-9][0-9]*$ ]]; then
    error "BACKUP_RETENTION_DAYS='$RETENTION_DAYS' tiene que ser un entero positivo."
    return 1
  fi
  if ! command -v rclone > /dev/null 2>&1; then
    error "rclone no está instalado."
    return 1
  fi
  if ! command -v docker > /dev/null 2>&1; then
    error "docker no está instalado."
    return 1
  fi
  local name="${REMOTE%%:*}" remotes type
  if ! remotes="$(rclone listremotes --long 2>&1)"; then
    error "rclone listremotes falló: ${remotes}"
    return 1
  fi
  type="$(printf '%s\n' "$remotes" | awk -v n="${name}:" '$1 == n { print $2; exit }')"
  if [[ -z "$type" ]]; then
    error "el remote '${name}:' no existe en rclone (rclone config). Ver docs/backup-restore.md."
    return 1
  fi
  if [[ "$type" != crypt ]]; then
    if [[ "${BACKUP_ALLOW_UNENCRYPTED:-}" == 1 ]]; then
      log "AVISO: el remote '${name}:' es de tipo '${type}', no crypt: el backup se sube SIN cifrar."
    else
      error "el remote '${name}:' es de tipo '${type}', no crypt: el backup tiene DNIs y secretos y no se sube sin cifrar (BACKUP_ALLOW_UNENCRYPTED=1 para forzarlo)."
      return 1
    fi
  fi
  return 0
}

# Arma el paquete de una instancia en $1 (directorio vacío). Devuelve 1 si algo falla.
dump_instance() {
  local instance="$1" container="$2" dir="$3"
  local ctmp="/tmp/lauyim-backup-${TIMESTAMP}-$$.db" f

  if ! docker inspect -f '{{.State.Running}}' "$container" 2> /dev/null | grep -qx true; then
    error "${instance}: el contenedor ${container} no está corriendo."
    return 1
  fi

  # VACUUM INTO da una copia consistente sin frenar la API; se verifica antes de copiarla.
  if ! docker exec -e OUT="$ctmp" "$container" node -e "
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync('/data/gym.db', { readOnly: true });
    db.exec(\"VACUUM INTO '\" + process.env.OUT + \"'\");
    db.close();
    const copy = new DatabaseSync(process.env.OUT, { readOnly: true });
    const r = copy.prepare('PRAGMA integrity_check').get();
    copy.close();
    if (Object.values(r)[0] !== 'ok') { console.error('integrity_check: ' + JSON.stringify(r)); process.exit(1); }
  "; then
    error "${instance}: VACUUM INTO / integrity_check falló dentro de ${container}."
    docker exec "$container" rm -f "$ctmp" > /dev/null 2>&1
    return 1
  fi
  if ! docker cp "${container}:${ctmp}" "${dir}/gym.db" > /dev/null; then
    error "${instance}: docker cp de gym.db falló."
    docker exec "$container" rm -f "$ctmp" > /dev/null 2>&1
    return 1
  fi
  docker exec "$container" rm -f "$ctmp" > /dev/null 2>&1 || log "${instance}: no se pudo borrar ${ctmp} del contenedor."

  for f in "${DATA_FILES[@]}"; do
    if docker exec "$container" test -f "/data/${f}"; then
      if ! docker cp "${container}:/data/${f}" "${dir}/${f}" > /dev/null; then
        error "${instance}: docker cp de ${f} falló."
        return 1
      fi
    elif [[ "$f" == audit.log ]]; then
      log "${instance}: sin audit.log (AUDIT_LOG=0 o todavía vacío), se sigue."
    else
      error "${instance}: falta /data/${f} en ${container}."
      return 1
    fi
  done

  (cd "$dir" && sha256sum -- * > MANIFEST.sha256) || { error "${instance}: no se pudo generar MANIFEST.sha256."; return 1; }
  return 0
}

if [[ "${1:-}" == --check ]]; then
  check_config || exit "$EXIT_CONFIG"
  for entry in "${INSTANCES[@]}"; do
    container="${entry#*|}"
    if docker inspect -f '{{.State.Running}}' "$container" 2> /dev/null | grep -qx true; then
      echo "ok: ${entry%%|*} (${container}) corriendo"
    else
      echo "AVISO: ${entry%%|*}: el contenedor ${container} no está corriendo" >&2
    fi
  done
  echo "ok: remote ${REMOTE}, retención ${RETENTION_DAYS} días"
  exit 0
elif [[ $# -gt 0 ]]; then
  echo "uso: $0 [--check]" >&2
  exit "$EXIT_CONFIG"
fi

log "===== Backup iniciado (${TIMESTAMP}) ====="
check_config || { log "===== Backup abortado (configuración) ====="; exit "$EXIT_CONFIG"; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/lauyim-backup.XXXXXX")" || { error "mktemp falló."; exit "$EXIT_DUMP"; }
trap 'rm -rf "$WORK"' EXIT

status=0
for entry in "${INSTANCES[@]}"; do
  instance="${entry%%|*}"
  container="${entry#*|}"
  pkg_name="${instance}_${TIMESTAMP}"
  dir="${WORK}/${pkg_name}"
  pkg="${WORK}/${pkg_name}.tar.gz"
  dest="$(remote_path "$REMOTE" "$instance")"
  log "${instance}: inicio (contenedor ${container})."
  mkdir -p "$dir"

  if ! dump_instance "$instance" "$container" "$dir"; then
    [[ $status -eq 0 ]] && status=$EXIT_DUMP
    rm -rf "$dir"
    continue
  fi
  if ! tar -czf "$pkg" -C "$WORK" "$pkg_name"; then
    error "${instance}: no se pudo crear ${pkg_name}.tar.gz."
    [[ $status -eq 0 ]] && status=$EXIT_DUMP
    rm -rf "$dir" "$pkg"
    continue
  fi
  rm -rf "$dir"
  log "${instance}: paquete $(du -h "$pkg" | cut -f1) listo."

  if ! out="$(rclone copy "$pkg" "$dest" 2>&1)"; then
    error "${instance}: rclone copy a ${dest} falló; no se rota el remote. ${out}"
    status=$EXIT_RCLONE
    rm -f "$pkg"
    continue
  fi
  rm -f "$pkg"
  log "${instance}: subido a ${dest}/${pkg_name}.tar.gz."

  # Rotación solo después de una subida buena: si el remote falla, lo viejo se queda.
  if ! out="$(rclone delete "$dest" --min-age "${RETENTION_DAYS}d" --include "${instance}_*.tar.gz" 2>&1)"; then
    error "${instance}: la rotación en ${dest} falló. ${out}"
    status=$EXIT_RCLONE
  else
    log "${instance}: rotación hecha (más de ${RETENTION_DAYS} días)."
  fi
done

log "===== Backup terminado (código ${status}) ====="
exit "$status"
