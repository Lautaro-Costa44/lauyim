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
  lsf) ls "\$(p "\$2")" ;;
  lsl) ls -l "\$(p "\$2")" ;;
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
# 4. Backup bueno.
BACKUP_REMOTE=gcrypt:lauyim bash "$ROOT/scripts/backup.sh"; rc=$?
pkg="$(ls "$T/remote/lauyim/prod/" 2>/dev/null | head -1)"
if [[ $rc -eq 0 && "$pkg" == prod_*.tar.gz ]]; then
  files="$(tar -tzf "$T/remote/lauyim/prod/$pkg" | sed 's|^[^/]*/||' | sort | tr '\n' ' ')"
  [[ "$files" == " MANIFEST.sha256 audit.log gym.db secret vapid.json " ]] && ok "paquete completo" || ko "contenido del paquete: $files"
  grep -q -- "--min-age 7d" "$T/rclone-delete.log" && ok "rotación después de subir" || ko "rotación"
else ko "backup bueno ($rc)"; fi
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

# 7. Restore del último paquete.
cd "$T"
BACKUP_REMOTE=gcrypt:lauyim bash "$ROOT/scripts/restore.sh" --instance prod --target "$T/restored" > /dev/null 2>"$T/restore.err"; rc=$?
if [[ $rc -eq 0 ]] && cmp -s "$T/restored/secret" "$T/c/data/secret" && cmp -s "$T/restored/vapid.json" "$T/c/data/vapid.json"; then
  n="$(node -e "const {DatabaseSync}=require('node:sqlite');console.log(new DatabaseSync('$T/restored/gym.db').prepare('select count(*) n from users').get().n)" 2>/dev/null)"
  [[ "$n" == 1 ]] && ok "restore completo" || ko "restore: gym.db sin datos"
else ko "restore ($rc: $(cat "$T/restore.err"))"; fi
# 8. Destino no vacío sin --force.
BACKUP_REMOTE=gcrypt:lauyim bash "$ROOT/scripts/restore.sh" --instance prod --target "$T/restored" > /dev/null 2>&1; [[ $? -eq 2 ]] && ok "destino no vacío rechazado" || ko "destino no vacío"
# 9. Paquete alterado: sha256 no coincide.
mkdir -p "$T/tamper" && tar -xzf "$T/remote/lauyim/prod/$pkg" -C "$T/tamper" && echo x >> "$T/tamper"/*/secret
( cd "$T/tamper" && tar -czf "$T/bad.tar.gz" * )
msg="$(bash "$ROOT/scripts/restore.sh" --package "$T/bad.tar.gz" --target "$T/r2" 2>&1)"; rc=$?
[[ $rc -eq 1 && "$msg" == *sha256* && ! -e "$T/r2/secret" ]] && ok "paquete alterado rechazado" || ko "paquete alterado ($rc: $msg)"

echo "# pass $pass, fail $failed"
[[ $failed -eq 0 ]]
