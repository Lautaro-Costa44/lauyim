#!/usr/bin/env bash
# Prueba de scripts/disk-check.sh con df y curl falsos (no manda nada real).
# Uso: bash scripts/tests/disk-check.test.sh
set -u -o pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
pass=0; failed=0
ok() { echo "ok - $1"; pass=$((pass + 1)); }
ko() { echo "FALLA - $1"; failed=$((failed + 1)); }

mkdir -p "$T/bin" "$T/hub"
# df falso: el uso sale de $T/pct.
cat > "$T/bin/df" <<STUB
#!/usr/bin/env bash
echo "Filesystem Size Used Avail Use% Mounted on"
echo "/dev/sda1 100G 50G 12G \$(cat "$T/pct")% /"
STUB
cat > "$T/bin/curl" <<STUB
#!/usr/bin/env bash
[[ -f "$T/curl-fail" ]] && exit 7
body=""; url=""
while [[ \$# -gt 0 ]]; do case "\$1" in --data-raw) body="\$2"; shift 2 ;; -m|-o|--retry) shift 2 ;; -*) shift ;; *) url="\$1"; shift ;; esac; done
printf '%s|%s\n' "\$url" "\$body" >> "$T/curl.log"
STUB
chmod +x "$T/bin/"*
export PATH="$T/bin:$PATH" DISK_PATH="$T/hub" DISK_PING_URL=https://hc.test/disk
run() { rm -f "$T/curl.log"; bash "$ROOT/scripts/disk-check.sh" > /dev/null 2>&1; rc=$?; }

echo 42 > "$T/pct"; run
[[ $rc -eq 0 && "$(cat "$T/curl.log")" == "https://hc.test/disk|Disco al 42% en $T/hub (quedan 12G)." ]] && ok "por debajo del límite: ping ok" || ko "debajo ($rc: $(cat "$T/curl.log" 2>/dev/null))"
echo 91 > "$T/pct"; run
[[ $rc -eq 1 && "$(cat "$T/curl.log")" == "https://hc.test/disk/fail|Disco al 91% en $T/hub (quedan 12G). Límite: 85%." ]] && ok "por encima: ping fail con el porcentaje" || ko "encima ($rc: $(cat "$T/curl.log" 2>/dev/null))"
echo 70 > "$T/pct"; DISK_MAX_PCT=60 run
[[ $rc -eq 1 && "$(cat "$T/curl.log")" == https://hc.test/disk/fail* ]] && ok "DISK_MAX_PCT cambia el límite" || ko "DISK_MAX_PCT ($rc)"
touch "$T/curl-fail"; run
[[ $rc -eq 3 ]] && ok "healthchecks caído sale con 3" || ko "healthchecks caído ($rc)"
rm -f "$T/curl-fail"
DISK_PING_URL= run
[[ $rc -eq 2 && ! -f "$T/curl.log" ]] && ok "sin DISK_PING_URL sale con 2" || ko "sin URL ($rc)"
DISK_PATH="$T/no-existe" run
[[ $rc -eq 2 ]] && ok "carpeta inexistente sale con 2" || ko "carpeta inexistente ($rc)"

echo "# pass $pass, fail $failed"
[[ $failed -eq 0 ]]
