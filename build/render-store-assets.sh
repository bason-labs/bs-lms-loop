#!/usr/bin/env bash
# Render store-asset HTML (from make-store-assets.mjs) to exact-size PNGs via headless Chrome.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
SRC="docs/store-assets/src"
OUT="docs/store-assets"

node build/make-store-assets.mjs

# name:WIDTHxHEIGHT
ASSETS=(
  "01-overview:1280x800"
  "02-quizzes:1280x800"
  "03-signin:1280x800"
  "promo-small:440x280"
  "promo-marquee:1400x560"
)

render() {
  local name="$1" w="$2" h="$3"
  "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
    --default-background-color=00000000 \
    --window-size="${w},${h}" \
    --screenshot="$ROOT/$OUT/${name}.png" \
    "file://$ROOT/$SRC/${name}.html" >/dev/null 2>&1
}

for a in "${ASSETS[@]}"; do
  name="${a%%:*}"; dim="${a##*:}"; w="${dim%x*}"; h="${dim#*x}"
  render "$name" "$w" "$h"
  echo "✓ $OUT/${name}.png (${w}×${h})"
done

echo
echo "Done. Verify sizes/look, then upload from $OUT/."
