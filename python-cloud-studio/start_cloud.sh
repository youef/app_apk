#!/bin/sh
set -eu
: "${ALEZZ_PUBLIC_MODE:=1}"
export ALEZZ_PUBLIC_MODE
exec uvicorn server:app --host 0.0.0.0 --port "${PORT:-8080}" --workers 1 --proxy-headers --forwarded-allow-ips '*'
