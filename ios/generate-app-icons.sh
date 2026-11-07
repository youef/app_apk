#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
source_file="../web/alizz-tv-transparent.png"
out="Assets.xcassets/AppIcon.appiconset"
test -s "$source_file"
mkdir -p "$out"
for size in 120 180 152 167 1024; do
  sips -s format png -z "$size" "$size" "$source_file" --out "$out/AppIcon-$size.png" >/dev/null
done
echo "Al Ezz TV app icons generated"
