#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p app/src/main/assets/tls
get_root(){
 local url="$1" file="$2" expected="$3"
 if [ ! -s "$file" ]; then
   curl -fL --retry 3 --connect-timeout 12 --max-time 45 "$url" -o "$file.tmp"
   mv "$file.tmp" "$file"
 fi
 local fingerprint
 fingerprint="$(openssl x509 -in "$file" -noout -fingerprint -sha256 | cut -d= -f2 | tr -d : | tr '[:lower:]' '[:upper:]')"
 [ "$fingerprint" = "$expected" ] || { echo "Invalid CA certificate: $file" >&2; exit 1; }
 openssl x509 -in "$file" -noout -checkend 0 >/dev/null
 echo "PASS: $file SHA256 $fingerprint"
}
get_root "https://letsencrypt.org/certs/isrgrootx1.pem" "app/src/main/assets/tls/isrg_root_x1.pem" "96BCEC06264976F37460779ACF28C5A7CFE8A3C0AAE11A8FFCEE05C0BDDF08C6"
get_root "https://pki.goog/repo/certs/gtsr1.pem" "app/src/main/assets/tls/gts_root_r1.pem" "D947432ABDE7B7FA90FC2E6B59101B1280E0E1C7E4E40FA3C6887FFF57A7F4CF"
