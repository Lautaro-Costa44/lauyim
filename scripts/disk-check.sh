#!/usr/bin/env bash
# Avisa a healthchecks.io cómo está el disco donde viven las instancias: OK por debajo del límite,
# falla por encima. Con el disco lleno la base no puede escribir y el backup no puede armar el
# paquete. Ver docs/monitoreo.md.
#
# Variables:
#   DISK_PING_URL   obligatoria. URL de un check de healthchecks.io (https://hc-ping.com/<uuid>)
#   DISK_PATH       carpeta a medir (default: ~/hub, donde están las instancias)
#   DISK_MAX_PCT    porcentaje de uso a partir del cual avisa falla (default 85)
#
# Códigos de salida: 0 ok · 1 disco por encima del límite · 2 configuración · 3 no se pudo avisar
#
# Cron (crontab -e), una vez por hora:
#   15 * * * * DISK_PING_URL=https://hc-ping.com/<uuid> /home/lauyyii/hub/scripts/disk-check.sh > /dev/null
set -u -o pipefail

URL="${DISK_PING_URL:-}"
DIR="${DISK_PATH:-$HOME/hub}"
MAX="${DISK_MAX_PCT:-85}"

fail_config() { printf 'disk-check.sh: ERROR: %s\n' "$1" >&2; exit 2; }
[[ "$URL" == https://* ]] || fail_config "falta DISK_PING_URL (una URL https://, ej. https://hc-ping.com/<uuid>)."
[[ "$MAX" =~ ^[1-9][0-9]?$ ]] || fail_config "DISK_MAX_PCT='$MAX' tiene que ser un entero entre 1 y 99."
[[ -d "$DIR" ]] || fail_config "no existe la carpeta '$DIR' (DISK_PATH)."
command -v curl > /dev/null 2>&1 || fail_config "curl no está instalado."

# df -P: una línea por sistema de archivos, en formato POSIX (la 5ª columna es el uso, "42%").
read -r pct avail < <(df -P -h "$DIR" | awk 'NR == 2 { sub("%", "", $5); print $5, $4 }')
if [[ ! "${pct:-}" =~ ^[0-9]+$ ]]; then
  suffix=fail; status=1
  msg="No se pudo leer el uso del disco de ${DIR}."
elif (( pct >= MAX )); then
  suffix=fail; status=1
  msg="Disco al ${pct}% en ${DIR} (quedan ${avail}). Límite: ${MAX}%."
else
  suffix=""; status=0
  msg="Disco al ${pct}% en ${DIR} (quedan ${avail})."
fi

target="${URL%/}"
[[ -n "$suffix" ]] && target="${target}/${suffix}"
if ! curl -fsS -m 10 --retry 3 -o /dev/null --data-raw "$msg" "$target" 2> /dev/null; then
  printf 'disk-check.sh: ERROR: no se pudo avisar a healthchecks. %s\n' "$msg" >&2
  exit 3
fi
echo "$msg"
exit "$status"
