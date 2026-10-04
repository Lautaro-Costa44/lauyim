#!/usr/bin/env bash
# Backup de las instancias de lauyim: un paquete .tar.gz por instancia con gym.db (VACUUM INTO,
# consistente con la API andando), vapid.json, secret y audit.log, subido con rclone a un remote
# cifrado (crypt). Ver docs/backup-restore.md.
#
# Variables:
#   BACKUP_REMOTE            obligatorio. Remote de rclone de destino, ej. gdrive-crypt:lauyim
#   BACKUP_INSTANCES         "nombre|contenedor ..." (default: "prod|lauyim-api-1 dev|lauyim-dev-api-1")
#   BACKUP_KEEP_DAILY        días que se conservan los diarios (default 7; BACKUP_RETENTION_DAYS, el
#                            nombre viejo, sigue andando)
#   BACKUP_KEEP_WEEKLY       semanas que se conservan las copias de los lunes (default 4; 0 = no se guardan)
#   BACKUP_KEEP_MONTHLY      meses que se conservan las copias de los días 1 (default 6; 0 = no se guardan)
#   BACKUP_LOG_FILE          log (default: backup.log junto a este script)
#   BACKUP_ALLOW_UNENCRYPTED 1 = permitir un remote que no es crypt (no recomendado: hay DNIs y secretos)
#   BACKUP_PING_URL          opcional. URL de un check de healthchecks.io (https://hc-ping.com/<uuid>):
#                            avisa el inicio y el código de salida, con el log de la corrida. Si el
#                            backup falla o no corre, healthchecks manda la alerta. Ver docs/monitoreo.md.
#
# Uso:  backup.sh           hace el backup
#       backup.sh --check   solo valida la configuración (rclone, remote, contenedores)
#
# Códigos de salida: 0 ok · 1 falló el dump/empaquetado de alguna instancia
#                    2 configuración inválida · 3 falló rclone (subida o rotación)
#
# Remote: <BACKUP_REMOTE>/<instancia>/daily/, weekly/ y monthly/. Cada noche el paquete va a daily/;
# los lunes, también a weekly/; los días 1, también a monthly/. Cada carpeta rota por su cuenta. Los
# paquetes de antes de esta separación (sueltos en <instancia>/) rotan como diarios.
#
# Cron (crontab -e del usuario que corre docker):
#   0 2 * * * BACKUP_REMOTE=gdrive-crypt:lauyim BACKUP_PING_URL=https://hc-ping.com/<uuid> /home/lauyyii/hub/scripts/backup.sh
set -u -o pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="${BACKUP_LOG_FILE:-${SCRIPT_DIR}/backup.log}"
REMOTE="${BACKUP_REMOTE:-}"
KEEP_DAILY="${BACKUP_KEEP_DAILY:-${BACKUP_RETENTION_DAYS:-7}}"
KEEP_WEEKLY="${BACKUP_KEEP_WEEKLY:-4}"
KEEP_MONTHLY="${BACKUP_KEEP_MONTHLY:-6}"
# Fecha de la corrida para decidir semanal y mensual (BACKUP_DATE=AAAA-MM-DD solo para los tests).
RUN_DATE="${BACKUP_DATE:-$(date '+%Y-%m-%d')}"
PING_URL="${BACKUP_PING_URL:-}"
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

# Aviso a healthchecks.io (si BACKUP_PING_URL está): ping start | ping <código> "<cuerpo>". Nunca hace
# fallar el backup: sin internet o con el servicio caído, solo queda anotado. La URL no se escribe
# en el log (con ella cualquiera puede marcar el check como OK).
ping() {
  [[ -z "$PING_URL" ]] && return 0
  if ! curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "${2:-}" "${PING_URL%/}/$1" 2> /dev/null; then
    log "AVISO: no se pudo avisar a healthchecks (${1}); el backup sigue."
  fi
}

# Termina avisando el código y las líneas del log de esta corrida.
finish() {
  ping "$1" "$(tail -n "+$((LOG_START + 1))" "$LOG_FILE" 2> /dev/null)"
  exit "$1"
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
  if ! [[ "$KEEP_DAILY" =~ ^[1-9][0-9]*$ ]]; then
    error "BACKUP_KEEP_DAILY='$KEEP_DAILY' tiene que ser un entero positivo."
    return 1
  fi
  if ! [[ "$KEEP_WEEKLY" =~ ^[0-9]+$ && "$KEEP_MONTHLY" =~ ^[0-9]+$ ]]; then
    error "BACKUP_KEEP_WEEKLY='$KEEP_WEEKLY' y BACKUP_KEEP_MONTHLY='$KEEP_MONTHLY' tienen que ser enteros (0 = no se guardan)."
    return 1
  fi
  if ! date -d "$RUN_DATE" '+%u' > /dev/null 2>&1; then
    error "BACKUP_DATE='$RUN_DATE' no es una fecha."
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
  if [[ -n "$PING_URL" && "$PING_URL" != https://* ]]; then
    error "BACKUP_PING_URL tiene que ser una URL https:// (ej. https://hc-ping.com/<uuid>)."
    return 1
  fi
  if [[ -n "$PING_URL" ]] && ! command -v curl > /dev/null 2>&1; then
    error "BACKUP_PING_URL está configurada pero curl no está instalado."
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
  echo "ok: remote ${REMOTE}, se guardan ${KEEP_DAILY} diarios, ${KEEP_WEEKLY} semanales y ${KEEP_MONTHLY} mensuales"
  [[ -n "$PING_URL" ]] && echo "ok: avisos a healthchecks configurados (--check no manda ningún ping)"
  exit 0
elif [[ $# -gt 0 ]]; then
  echo "uso: $0 [--check]" >&2
  exit "$EXIT_CONFIG"
fi

LOG_START=0
[[ -f "$LOG_FILE" ]] && LOG_START="$(wc -l < "$LOG_FILE")"
log "===== Backup iniciado (${TIMESTAMP}) ====="
ping start
check_config || { log "===== Backup abortado (configuración) ====="; finish "$EXIT_CONFIG"; }

WORK="$(mktemp -d "${TMPDIR:-/tmp}/lauyim-backup.XXXXXX")" || { error "mktemp falló."; finish "$EXIT_DUMP"; }
trap 'rm -rf "$WORK"' EXIT

# Carpetas de esta corrida: siempre daily; los lunes, weekly; los días 1, monthly.
TIERS=(daily)
[[ "$KEEP_WEEKLY" -gt 0 && "$(date -d "$RUN_DATE" '+%u')" == 1 ]] && TIERS+=(weekly)
[[ "$KEEP_MONTHLY" -gt 0 && "$(date -d "$RUN_DATE" '+%d')" == 01 ]] && TIERS+=(monthly)
log "copias de hoy: ${TIERS[*]}"

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

  uploaded=1
  for tier in "${TIERS[@]}"; do
    if ! out="$(rclone copy "$pkg" "${dest}/${tier}" 2>&1)"; then
      error "${instance}: rclone copy a ${dest}/${tier} falló; no se rota el remote. ${out}"
      status=$EXIT_RCLONE
      uploaded=0
      break
    fi
    log "${instance}: subido a ${dest}/${tier}/${pkg_name}.tar.gz."
  done
  rm -f "$pkg"
  [[ $uploaded -eq 1 ]] || continue

  # Rotación solo después de una subida buena: si el remote falla, lo viejo se queda. Cada carpeta
  # por su cuenta y sin bajar a subcarpetas (--max-depth 1): la de la raíz (paquetes de antes de
  # daily/) entraría si no a weekly/ y monthly/. Solo las carpetas que existen: en Drive no hay
  # carpetas vacías, así que weekly/ no existe hasta el primer lunes (y rclone delete falla ahí).
  if ! folders="$(rclone lsf "$dest" --dirs-only --max-depth 1 2>&1)"; then
    error "${instance}: no se pudieron listar las carpetas de ${dest}; no se rota. ${folders}"
    status=$EXIT_RCLONE
    continue
  fi
  for rot in "daily|${KEEP_DAILY}" "|${KEEP_DAILY}" "weekly|$((KEEP_WEEKLY * 7))" "monthly|$((KEEP_MONTHLY * 31))"; do
    folder="${rot%%|*}"; days="${rot#*|}"
    [[ "$days" -gt 0 ]] || continue
    [[ -z "$folder" ]] || grep -qx "${folder}/" <<< "$folders" || continue
    target="$dest"; [[ -n "$folder" ]] && target="${dest}/${folder}"
    if ! out="$(rclone delete "$target" --min-age "${days}d" --max-depth 1 --include "${instance}_*.tar.gz" 2>&1)"; then
      error "${instance}: la rotación en ${target} falló. ${out}"
      status=$EXIT_RCLONE
    fi
  done
  log "${instance}: rotación hecha (${KEEP_DAILY} diarios, ${KEEP_WEEKLY} semanales, ${KEEP_MONTHLY} mensuales)."
done

log "===== Backup terminado (código ${status}) ====="
finish "$status"
