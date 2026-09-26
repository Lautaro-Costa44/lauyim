#!/usr/bin/env bash
# Restaura un paquete de scripts/backup.sh en un directorio (por defecto ./restore-test-data, el
# que monta docker-compose.restore-test.yml). Nunca toca los datos de una instancia en uso:
# restaurar producción es un paso manual (docs/backup-restore.md).
#
# Uso:
#   restore.sh --list <instancia>                          lista los paquetes del remote
#   restore.sh --instance <instancia> [--file <paquete>]   baja el último (o el indicado) y lo restaura
#   restore.sh --package <archivo.tar.gz>                  restaura un paquete ya descargado
# Opciones:
#   --target <dir>  destino (default: ./restore-test-data). Tiene que estar vacío o no existir.
#   --force         vacía el destino si tiene archivos.
#
# Variables: BACKUP_REMOTE (ej. gdrive-crypt:lauyim), obligatorio para --list e --instance.
#            RESTORE_CHECK_IMAGE imagen para el integrity_check si no hay sqlite3 (default lauyim-api:local).
#
# Códigos de salida: 0 ok · 1 paquete inválido (sha256, integridad, faltan archivos)
#                    2 uso/configuración · 3 falló rclone
set -u -o pipefail
umask 077

REMOTE="${BACKUP_REMOTE:-}"
CHECK_IMAGE="${RESTORE_CHECK_IMAGE:-lauyim-api:local}"
TARGET="./restore-test-data"
MODE=""
INSTANCE=""
FILE="latest"
PACKAGE=""
FORCE=0

die() {
  printf 'restore.sh: ERROR: %s\n' "$2" >&2
  exit "$1"
}

usage() {
  sed -n '6,13p' "$0" | sed 's/^# \{0,1\}//' >&2
  exit 2
}

remote_path() {
  case "$1" in
    *: | */) printf '%s%s' "$1" "$2" ;;
    *) printf '%s/%s' "$1" "$2" ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --list) MODE=list; INSTANCE="${2:-}"; shift 2 || usage ;;
    --instance) MODE=remote; INSTANCE="${2:-}"; shift 2 || usage ;;
    --file) FILE="${2:-}"; shift 2 || usage ;;
    --package) MODE=local; PACKAGE="${2:-}"; shift 2 || usage ;;
    --target) TARGET="${2:-}"; shift 2 || usage ;;
    --force) FORCE=1; shift ;;
    -h | --help) usage ;;
    *) printf 'opción desconocida: %s\n' "$1" >&2; usage ;;
  esac
done
[[ -n "$MODE" ]] || usage
if [[ "$MODE" != local ]]; then
  [[ -n "$INSTANCE" ]] || usage
  [[ "$INSTANCE" =~ ^[A-Za-z0-9._-]+$ ]] || die 2 "nombre de instancia inválido: ${INSTANCE}"
  [[ -n "$REMOTE" ]] || die 2 "falta BACKUP_REMOTE (ej. BACKUP_REMOTE=gdrive-crypt:lauyim)."
  command -v rclone > /dev/null 2>&1 || die 2 "rclone no está instalado."
  SRC="$(remote_path "$REMOTE" "$INSTANCE")"
fi

if [[ "$MODE" == list ]]; then
  rclone lsl "$SRC" --include "${INSTANCE}_*.tar.gz" || die 3 "rclone lsl ${SRC} falló."
  exit 0
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/lauyim-restore.XXXXXX")" || die 1 "mktemp falló."
trap 'rm -rf "$WORK"' EXIT

if [[ "$MODE" == remote ]]; then
  if [[ "$FILE" == latest ]]; then
    # Los nombres llevan la fecha (instancia_AAAA-MM-DD_HH-MM-SS): el último en orden es el más nuevo.
    FILE="$(rclone lsf "$SRC" --files-only --include "${INSTANCE}_*.tar.gz" | sort | tail -n 1)" \
      || die 3 "rclone lsf ${SRC} falló."
    [[ -n "$FILE" ]] || die 1 "no hay paquetes de ${INSTANCE} en ${SRC}."
  fi
  [[ "$FILE" =~ ^[A-Za-z0-9._-]+\.tar\.gz$ ]] || die 2 "nombre de paquete inválido: ${FILE}"
  echo "Bajando ${SRC}/${FILE}…"
  rclone copy "${SRC}/${FILE}" "$WORK" || die 3 "rclone copy ${SRC}/${FILE} falló."
  PACKAGE="${WORK}/${FILE}"
fi

[[ -f "$PACKAGE" ]] || die 2 "no existe el paquete ${PACKAGE}."

# Solo se aceptan rutas simples dentro de una carpeta: nada absoluto ni con "..".
listing="$(tar -tzf "$PACKAGE")" || die 1 "el paquete no es un .tar.gz válido."
while IFS= read -r entry; do
  case "$entry" in
    /* | *..*) die 1 "el paquete tiene una ruta sospechosa: ${entry}" ;;
  esac
done <<< "$listing"

mkdir -p "${WORK}/x"
tar -xzf "$PACKAGE" -C "${WORK}/x" --no-same-owner || die 1 "no se pudo extraer el paquete."
dirs=("${WORK}"/x/*/)
[[ ${#dirs[@]} -eq 1 && -d "${dirs[0]}" ]] || die 1 "el paquete tiene que tener una sola carpeta."
SRC_DIR="${dirs[0]%/}"

[[ -f "${SRC_DIR}/MANIFEST.sha256" ]] || die 1 "falta MANIFEST.sha256 en el paquete."
(cd "$SRC_DIR" && sha256sum --quiet -c MANIFEST.sha256) || die 1 "los sha256 no coinciden: el paquete está dañado o fue alterado."
for f in gym.db vapid.json secret; do
  [[ -f "${SRC_DIR}/${f}" ]] || die 1 "falta ${f} en el paquete."
done

integrity=""
if command -v sqlite3 > /dev/null 2>&1; then
  integrity="$(sqlite3 -readonly "${SRC_DIR}/gym.db" 'PRAGMA integrity_check;' 2>&1)"
elif command -v docker > /dev/null 2>&1 && docker image inspect "$CHECK_IMAGE" > /dev/null 2>&1; then
  integrity="$(docker run --rm --network none -v "${SRC_DIR}:/check:ro" "$CHECK_IMAGE" node -e "
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync('/check/gym.db', { readOnly: true });
    console.log(Object.values(db.prepare('PRAGMA integrity_check').get())[0]);
  " 2> /dev/null)"
fi
if [[ -z "$integrity" ]]; then
  echo "AVISO: sin sqlite3 ni la imagen ${CHECK_IMAGE}: no se corrió PRAGMA integrity_check (sí se verificaron los sha256)." >&2
elif [[ "$integrity" != ok ]]; then
  die 1 "PRAGMA integrity_check: ${integrity}"
fi

if [[ -d "$TARGET" ]] && [[ -n "$(ls -A "$TARGET")" ]]; then
  [[ $FORCE -eq 1 ]] || die 2 "${TARGET} no está vacío (usá --force para vaciarlo)."
  if [[ -f "${TARGET}/gym.db-wal" ]] || [[ "$(cd "$TARGET" && pwd -P)" == */hub/lauyim/data || "$(cd "$TARGET" && pwd -P)" == */hub/lauyim-dev/data ]]; then
    die 2 "${TARGET} parece el directorio de datos de una instancia en uso: restauralo a mano (docs/backup-restore.md)."
  fi
  find "$TARGET" -mindepth 1 -delete || die 2 "no se pudo vaciar ${TARGET}."
fi
mkdir -p "$TARGET"
for f in gym.db vapid.json secret audit.log; do
  [[ -f "${SRC_DIR}/${f}" ]] && cp -p "${SRC_DIR}/${f}" "${TARGET}/${f}"
done
# El contenedor de la API corre como root (node:22-alpine) y lee estos archivos; 600 alcanza.
chmod 600 "${TARGET}"/*

echo "Restaurado en ${TARGET}:"
ls -l "$TARGET"
[[ -n "$integrity" ]] && echo "PRAGMA integrity_check: ok"
echo "Siguiente paso: docker compose -f docker-compose.restore-test.yml -p restore-test up -d  (http://localhost:3099)"
