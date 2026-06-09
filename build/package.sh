#!/usr/bin/env bash
# Build a clean Chrome Web Store upload zip.
# Includes ONLY what the extension runs; excludes dev, test, docs, and secret/config files.
# Usage: bash build/package.sh   →   build/lms-loop-<version>.zip
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(node -p "require('./manifest.json').version" 2>/dev/null || echo "0.0.0")"
OUT="build/lms-loop-${VERSION}.zip"

# Runtime files the extension actually loads (from manifest.json).
INCLUDE=(
  manifest.json
  background
  content
  config
  lib
  popup
  icons
)

# Guard: refuse to ship unfilled placeholders.
if grep -q "PASTE_THE_" manifest.json; then
  echo "✗ manifest.json still has PASTE_THE_* placeholders (key / oauth client_id). Fill them first." >&2
  echo "  See docs/DEPLOY.md." >&2
  exit 1
fi

rm -f "$OUT"
# -r recurse, -X strip extra file attrs, exclude OS cruft.
zip -rX "$OUT" "${INCLUDE[@]}" \
  -x "*/.DS_Store" "*/.gitkeep" >/dev/null

echo "✓ Built $OUT"
echo "  Contents:"
unzip -l "$OUT" | tail -n +4 | head -n -2 | awk '{print "    " $4}'
echo
echo "Next: upload $OUT at https://chrome.google.com/webstore/devconsole"
