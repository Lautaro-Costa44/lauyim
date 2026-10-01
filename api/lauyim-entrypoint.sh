#!/bin/sh
# La API corre como el usuario node, sin privilegios. El contenedor arranca como root solo para
# dejar /data de node (las instancias de antes la crearon como root, y sin esto la API no podría
# escribir su base) y enseguida le pasa el proceso con su-exec.
set -e
DATA="${DATA_DIR:-/data}"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA"
  chown -R node:node "$DATA"
  exec su-exec node "$@"
fi
exec "$@"
