#!/bin/bash
# Build qdfirefox-extension into dist/firefox/ and dist/firefox.xpi.
#
# Firefox MV3 uses a flat scripts-array background, so we ship the
# source tree as-is — no concatenation needed, unlike the MV2 path
# in qdchrome-extension. The xpi is just a zip of the source tree
# with manifest.json at the root.
set -euo pipefail

HERE="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$HERE/dist"
OUT="$DIST/firefox"

rm -rf "$DIST"
mkdir -p "$OUT/src/modules" "$OUT/src/content" "$OUT/icons"

cp "$HERE/manifest.json"        "$OUT/manifest.json"
cp "$HERE/src/api.js"           "$OUT/src/api.js"
cp "$HERE/src/port.js"          "$OUT/src/port.js"
cp "$HERE/src/dispatcher.js"    "$OUT/src/dispatcher.js"
cp "$HERE/src/intent.js"        "$OUT/src/intent.js"
cp "$HERE/src/background.js"    "$OUT/src/background.js"
cp "$HERE/src/popup.html"       "$OUT/src/popup.html"
cp "$HERE/src/popup.js"         "$OUT/src/popup.js"
cp "$HERE/src/options.html"     "$OUT/src/options.html"
cp "$HERE/src/options.js"       "$OUT/src/options.js"
cp "$HERE"/src/modules/*.js     "$OUT/src/modules/"
cp "$HERE"/src/content/*.js     "$OUT/src/content/"
cp "$HERE"/icons/*              "$OUT/icons/"

if ! command -v zip >/dev/null 2>&1; then
    echo "[build-extension] zip not installed; unpacked tree at $OUT" >&2
    exit 0
fi
( cd "$OUT" && zip -qr "$DIST/firefox.xpi" . )

echo "[build-extension] OK"
ls -la "$DIST"
