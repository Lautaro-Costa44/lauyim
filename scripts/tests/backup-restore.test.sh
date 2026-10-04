#!/usr/bin/env bash
# Prueba de scripts/backup.sh y scripts/restore.sh con docker y rclone falsos (no toca nada real).
# Uso: bash scripts/tests/backup-restore.test.sh   (necesita node >= 22 para el VACUUM INTO)
set -u -o pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
pass=0; failed=0
ok() { echo "ok - $1"; pass=$((pass + 1)); }
ko() { echo "FALLA - $1"; failed=$((failed + 1)); }

# Contenedor falso: /data y /tmp del "contenedor" son directorios locales.
mkdir -p "$T/bin" "$T/c/data" "$T/c/tmp" "$T/remote"
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('$T/c/data/gym.db');d.exec('PRAGMA journal_mode=WAL;CREATE TABLE users(id TEXT);INSERT INTO users VALUES (\'u1\')');d.close()" 2>/dev/null
echo '{"publicKey":"x","privateKey":"y"}' > "$T/c/data/vapid.json"
echo 'secreto' > "$T/c/data/secret"
echo '{"a":1}' > "$T/c/data/audit.log"

cat > "$T/bin/docker" <<STUB
#!/usr/bin/env bash
C="$T/c"
map() { local p="\${1#*:}"; printf '%s' "\$C\$p"; }
case "\$1" in
  inspect) [[ "\${@: -1}" == api-1 ]] && echo true || exit 1 ;;
  exec)
    shift; env=(); while [[ "\$1" == -e ]]; do env+=("\$2"); shift 2; done; shift
    if [[ "\$1" == node ]]; then
      shift 2
      script="\${1//\/data\/gym.db/\$C/data/gym.db}"
      out="\${env[0]#OUT=}"; OUT="\$C\$out" node -e "\$script"
    elif [[ "\$1" == test ]]; then test -f "\$C\$3"
    elif [[ "\$1" == rm ]]; then rm -f "\$C\$3"
    fi ;;
  cp) cp "\$(map "\$2")" "\$3" ;;
  *) exit 1 ;;
esac
STUB
cat > "$T/bin/rclone" <<STUB
#!/usr/bin/env bash
R="$T/remote"
[[ -f "$T/rclone-fail" ]] && { echo "Failed to copy: googleapi: 403" >&2; exit 1; }
p() { local r="\${1#*:}"; printf '%s/%s' "\$R" "\$r"; }
case "\$1" in
  listremotes) printf 'gcrypt: crypt\ngplain: drive\n' ;;
  copy) mkdir -p "\$(p "\$3")"; if [[ -f "\$2" ]]; then cp "\$2" "\$(p "\$3")/"; else cp "\$(p "\$2")" "\$3/"; fi ;;
  delete) echo "\$@" >> "$T/rclone-delete.log" ;;
  lsf|lsl)
    cmd="\$1"; dir="\$(p "\$2")"; shift 2; pat='*'
    while [[ \$# -gt 0 ]]; do [[ "\$1" == --include ]] && { pat="\$2"; shift; }; shift; done
    [[ -d "\$dir" ]] || exit 0
    (cd "\$dir" && find . -type f -name "\$pat" | sed 's|^\./||' | sort | while read -r f; do
      [[ "\$cmd" == lsl ]] && echo "1 2026-01-01 00:00:00 \$f" || echo "\$f"; done) ;;
esac
STUB
chmod +x "$T/bin/"*
export PATH="$T/bin:$PATH" BACKUP_LOG_FILE="$T/backup.log" BACKUP_INSTANCES="prod|api-1"

# 1. Sin BACKUP_REMOTE: código 2.
env -u BACKUP_REMOTE bash "$ROOT/scripts/backup.sh" 2>/dev/null; [[ $? -eq 2 ]] && ok "sin BACKUP_REMOTE sale con 2" || ko "sin BACKUP_REMOTE"
# 2. Remote que no es crypt: código 2 con mensaje.
msg="$(BACKUP_REMOTE=gplain:lauyim bash "$ROOT/scripts/backup.sh" 2>&1)"; rc=$?
[[ $rc -eq 2 && "$msg" == *"no crypt"* ]] && ok "remote no crypt rechazado" || ko "remote no crypt ($rc: $msg)"
# 3. Remote inexistente.
BACKUP_REMOTE=nada:x bash "$ROOT/scripts/backup.sh" 2>/dev/null; [[ $? -eq 2 ]] && ok "remote inexistente sale con 2" || ko "remote inexistente"
# 4. Backup bueno, un miércoles: solo a daily/.
BACKUP_DATE=2026-10-07 BACKUP_REMOTE=gcrypt:lauyim bash "$ROOT/scripts/backup.sh"; rc=$?
pkg="$(ls "$T/remote/lauyim/prod/daily/" 2>/dev/null | head -1)"
if [[ $rc -eq 0 && "$pkg" == prod_*.tar.gz ]]; then
  files="$(tar -tzf "$T/remote/lauyim/prod/daily/$pkg" | sed 's|^[^/]*/||' | sort | tr '\n' ' ')"
  [[ "$files" == " MANIFEST.sha256 audit.log gym.db secret vapid.json " ]] && ok "paquete completo" || ko "contenido del paquete: $files"
  [[ ! -d "$T/remote/lauyim/prod/weekly" && ! -d "$T/remote/lauyim/prod/monthly" ]] && ok "un miércoles no hay semanal ni mensual" || ko "miércoles con semanal o mensual"
  grep -q -- "lauyim/prod/daily --min-age 7d" "$T/rclone-delete.log" && ok "rotación de los diarios (7 días)" || ko "rotación diaria: $(cat "$T/rclone-delete.log")"
  grep -q -- "lauyim/prod --min-age 7d" "$T/rclone-delete.log" && ok "los paquetes viejos de la raíz rotan como diarios" || ko "rotación de la raíz"
  # Sin --max-depth 1, la rotación de la raíz entraría a weekly/ y monthly/ y los borraría a los 7 días.
  [[ "$(grep -c -- "--max-depth 1" "$T/rclone-delete.log")" == "$(wc -l < "$T/rclone-delete.log")" ]] && ok "cada rotación se queda en su carpeta" || ko "rotación sin --max-depth 1"
else ko "backup bueno ($rc)"; fi
# 4b. Un lunes: también a weekly/ (rota a las 4 semanas). Un día 1: también a monthly/ (6 meses).
rm -f "$T/rclone-delete.log"
BACKUP_DATE=2026-10-05 BACKUP_REMOTE=gcrypt:lauyim bash "$ROOT/scripts/backup.sh"; rc=$?
[[ $rc -eq 0 && -n "$(ls "$T/remote/lauyim/prod/weekly/" 2>/dev/null)" && ! -d "$T/remote/lauyim/prod/monthly" ]] \
  && grep -q -- "lauyim/prod/weekly --min-age 28d" "$T/rclone-delete.log" && ok "lunes: copia semanal y rotación de 28 días" || ko "lunes ($rc: $(cat "$T/rclone-delete.log"))"
rm -f "$T/rclone-delete.log"
BACKUP_DATE=2026-10-01 BACKUP_REMOTE=gcrypt:lauyim bash "$ROOT/scripts/backup.sh"; rc=$?
[[ $rc -eq 0 && -n "$(ls "$T/remote/lauyim/prod/monthly/" 2>/dev/null)" ]] \
  && grep -q -- "lauyim/prod/monthly --min-age 186d" "$T/rclone-delete.log" && ok "día 1: copia mensual y rotación de 6 meses" || ko "día 1 ($rc: $(cat "$T/rclone-delete.log"))"
# 4c. BACKUP_KEEP_WEEKLY=0 apaga las semanales; un valor inválido es un error de configuración.
rm -rf "$T/remote/lauyim/prod/weekly"
BACKUP_KEEP_WEEKLY=0 BACKUP_DATE=2026-10-05 BACKUP_REMOTE=gcrypt:lauyim bash "$ROOT/scripts/backup.sh"; rc=$?
[[ $rc -eq 0 && ! -d "$T/remote/lauyim/prod/weekly" ]] && ok "BACKUP_KEEP_WEEKLY=0 no guarda semanales" || ko "KEEP_WEEKLY=0 ($rc)"
BACKUP_KEEP_MONTHLY=x BACKUP_REMOTE=gcrypt:lauyim bash "$ROOT/scripts/backup.sh" 2>/dev/null; [[ $? -eq 2 ]] && ok "BACKUP_KEEP_MONTHLY inválido sale con 2" || ko "KEEP_MONTHLY inválido"
BACKUP_DATE=2026-10-05 BACKUP_REMOTE=gcrypt:lauyim bash "$ROOT/scripts/backup.sh"
pkg="daily/$(ls "$T/remote/lauyim/prod/daily/" | sort | tail -1)"
[[ -z "$(ls "$T/c/tmp")" ]] && ok "sin temporales en el contenedor" || ko "quedaron temporales en el contenedor"
# 5. Contenedor caído: código 1.
BACKUP_INSTANCES="prod|otro" BACKUP_REMOTE=gcrypt:lauyim bash "$ROOT/scripts/backup.sh" 2>/dev/null; [[ $? -eq 1 ]] && ok "contenedor caído sale con 1" || ko "contenedor caído"
# 6. rclone falla en la subida: código 3 y sin rotación.
rm -f "$T/rclone-delete.log"
# listremotes tiene que andar: el stub falla todo, así que se simula con un wrapper.
mv "$T/bin/rclone" "$T/bin/rclone.real"
printf '#!/usr/bin/env bash\n[[ "$1" == listremotes ]] && exec "%s" "$@"\necho "Failed to copy: googleapi: 403" >&2; exit 1\n' "$T/bin/rclone.real" > "$T/bin/rclone"; chmod +x "$T/bin/rclone"
msg="$(BACKUP_REMOTE=gcrypt:lauyim bash "$ROOT/scripts/backup.sh" 2>&1)"; rc=$?
[[ $rc -eq 3 && "$msg" == *"rclone copy"*"403"* && ! -f "$T/rclone-delete.log" ]] && ok "rclone falla: código 3, mensaje y sin rotación" || ko "rclone falla ($rc: $msg)"
mv "$T/bin/rclone.real" "$T/bin/rclone"

# 7. Restore del último paquete (el más nuevo de daily/, weekly/, monthly/ y la raíz).
cp "$T/remote/lauyim/prod/$pkg" "$T/remote/lauyim/prod/prod_2026-01-01_02-00-00.tar.gz"
list="$(BACKUP_REMOTE=gcrypt:lauyim bash "$ROOT/scripts/restore.sh" --list prod 2>&1)"
[[ "$list" == *daily/prod_* && "$list" == *weekly/prod_* && "$list" == *monthly/prod_* && "$list" == *" prod_2026-01-01"* ]] && ok "--list muestra las tres carpetas y la raíz" || ko "--list: $list"
cd "$T"
BACKUP_REMOTE=gcrypt:lauyim bash "$ROOT/scripts/restore.sh" --instance prod --target "$T/restored" > /dev/null 2>"$T/restore.err"; rc=$?
if [[ $rc -eq 0 ]] && cmp -s "$T/restored/secret" "$T/c/data/secret" && cmp -s "$T/restored/vapid.json" "$T/c/data/vapid.json"; then
  n="$(node -e "const {DatabaseSync}=require('node:sqlite');console.log(new DatabaseSync('$T/restored/gym.db').prepare('select count(*) n from users').get().n)" 2>/dev/null)"
  [[ "$n" == 1 ]] && ok "restore completo" || ko "restore: gym.db sin datos"
else ko "restore ($rc: $(cat "$T/restore.err"))"; fi
# 7b. --file con carpeta.
BACKUP_REMOTE=gcrypt:lauyim bash "$ROOT/scripts/restore.sh" --instance prod --file "$pkg" --target "$T/restored-b" > /dev/null 2>&1 \
  && cmp -s "$T/restored-b/secret" "$T/c/data/secret" && ok "--file daily/<paquete>" || ko "--file con carpeta"
# 8. Destino no vacío sin --force.
BACKUP_REMOTE=gcrypt:lauyim bash "$ROOT/scripts/restore.sh" --instance prod --target "$T/restored" > /dev/null 2>&1; [[ $? -eq 2 ]] && ok "destino no vacío rechazado" || ko "destino no vacío"
# 9. Paquete alterado: sha256 no coincide.
mkdir -p "$T/tamper" && tar -xzf "$T/remote/lauyim/prod/$pkg" -C "$T/tamper" && echo x >> "$T/tamper"/*/secret
( cd "$T/tamper" && tar -czf "$T/bad.tar.gz" * )
msg="$(bash "$ROOT/scripts/restore.sh" --package "$T/bad.tar.gz" --target "$T/r2" 2>&1)"; rc=$?
[[ $rc -eq 1 && "$msg" == *sha256* && ! -e "$T/r2/secret" ]] && ok "paquete alterado rechazado" || ko "paquete alterado ($rc: $msg)"

# 10-14. Avisos a healthchecks (BACKUP_PING_URL), con un curl falso que anota URL y cuerpo.
cat > "$T/bin/curl" <<STUB
#!/usr/bin/env bash
[[ -f "$T/curl-fail" ]] && exit 7
body=""; url=""
while [[ \$# -gt 0 ]]; do case "\$1" in --data-raw) body="\$2"; shift 2 ;; -m|-o|--retry) shift 2 ;; -*) shift ;; *) url="\$1"; shift ;; esac; done
printf '%s\n' "\$url" >> "$T/curl.log"
printf '%s' "\$body" > "$T/curl-body-\${url##*/}"
STUB
chmod +x "$T/bin/curl"
H=https://hc.test/abc
rm -f "$T/curl.log"
BACKUP_REMOTE=gcrypt:lauyim BACKUP_PING_URL="$H" bash "$ROOT/scripts/backup.sh" 2>/dev/null; rc=$?
if [[ $rc -eq 0 && "$(cat "$T/curl.log" 2>/dev/null | tr '\n' ' ')" == "$H/start $H/0 " ]]; then
  body="$(cat "$T/curl-body-0")"
  [[ "$body" == *"Backup terminado (código 0)"* && $(grep -c "Backup iniciado" <<< "$body") -eq 1 ]] \
    && ok "ping start y 0 con el log de esa corrida (sola)" || ko "cuerpo del ping: $body"
else ko "pings de un backup bueno ($rc: $(cat "$T/curl.log" 2>/dev/null))"; fi
rm -f "$T/curl.log"
BACKUP_REMOTE=gplain:lauyim BACKUP_PING_URL="$H" bash "$ROOT/scripts/backup.sh" 2>/dev/null; rc=$?
[[ $rc -eq 2 && "$(tr '\n' ' ' < "$T/curl.log")" == "$H/start $H/2 " ]] && ok "configuración inválida avisa /2" || ko "ping de config inválida ($rc: $(cat "$T/curl.log" 2>/dev/null))"
touch "$T/curl-fail"
BACKUP_REMOTE=gcrypt:lauyim BACKUP_PING_URL="$H" bash "$ROOT/scripts/backup.sh" 2>/dev/null; rc=$?
[[ $rc -eq 0 ]] && grep -q "no se pudo avisar a healthchecks" "$T/backup.log" && ! grep -q "hc.test" "$T/backup.log" \
  && ok "healthchecks caído no frena el backup ni deja la URL en el log" || ko "healthchecks caído ($rc)"
rm -f "$T/curl-fail" "$T/curl.log"
BACKUP_REMOTE=gcrypt:lauyim bash "$ROOT/scripts/backup.sh" 2>/dev/null; rc=$?
[[ $rc -eq 0 && ! -f "$T/curl.log" ]] && ok "sin BACKUP_PING_URL no hay pings" || ko "pings sin BACKUP_PING_URL ($rc)"
BACKUP_REMOTE=gcrypt:lauyim BACKUP_PING_URL=http://hc.test/abc bash "$ROOT/scripts/backup.sh" --check > /dev/null 2>&1; rc=$?
[[ $rc -eq 2 && ! -f "$T/curl.log" ]] && ok "BACKUP_PING_URL sin https rechazada y --check no manda pings" || ko "URL http ($rc)"

echo "# pass $pass, fail $failed"
[[ $failed -eq 0 ]]
