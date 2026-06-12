#!/usr/bin/env bash
# Build a clean Chrome Web Store upload zip.
# Includes ONLY what the extension runs; excludes dev, test, docs, and secret/config files.
# Usage: bash build/package.sh   →   build/lms-loop-<version>.zip
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# Production OAuth2 client ID (Chrome Web Store extension).
# manifest.json keeps the local-dev ID; this is swapped in during packaging.
PROD_CLIENT_ID="518594584743-7ifm1ksb3pinqnm9l39i2cjeoo9uq2n8.apps.googleusercontent.com"

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
OUT_ABS="$ROOT/$OUT"

# Stage into a temp dir so we can ship a manifest WITHOUT the local-dev "key"
# field — the Chrome Web Store rejects "key" (it assigns the ID itself).
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
for item in "${INCLUDE[@]}"; do
  cp -R "$item" "$STAGE/"
done
# Strip "key" and swap in production client_id.
# Source manifest keeps the local-dev values; the store build needs neither.
node -e "
const fs=require('fs');
const p='$STAGE/manifest.json';
const m=JSON.parse(fs.readFileSync(p,'utf8'));
delete m.key;
m.oauth2.client_id = '$PROD_CLIENT_ID';
fs.writeFileSync(p, JSON.stringify(m,null,2)+'\n');
"

# -r recurse, -X strip extra file attrs, exclude OS cruft.
( cd "$STAGE" && zip -rX "$OUT_ABS" "${INCLUDE[@]}" \
    -x "*/.DS_Store" "*/.gitkeep" >/dev/null )

echo "✓ Built $OUT  (key field stripped for store upload)"
echo "  Contents:"
unzip -Z1 "$OUT" | sed 's/^/    /'
echo
echo "Next: upload $OUT at https://chrome.google.com/webstore/devconsole"
