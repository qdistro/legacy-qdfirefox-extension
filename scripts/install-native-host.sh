#!/bin/bash
# Install (or print) the Firefox native-messaging-host manifest for
# the qdistro bridge.
#
# Firefox's native-host manifest lives at one of:
#   user:     ~/.mozilla/native-messaging-hosts/<name>.json
#   system:   /usr/lib/mozilla/native-messaging-hosts/<name>.json
#             /usr/lib64/mozilla/native-messaging-hosts/<name>.json
#
# This script installs the user-level manifest by default. Pass
# --system to write the system-level one (requires root).
#
# Differences from Chromium's manifest:
#   - field is `allowed_extensions` (not `allowed_origins`)
#   - values are extension IDs (gecko.id) not chrome-extension:// URIs
#
# Required environment / arguments:
#   QDISTRO_BRIDGE_PATH  absolute path to the qdistro-browser-bridge
#                        executable (the Python entry point). If
#                        unset, defaults to $(command -v
#                        qdistro-browser-bridge).
set -euo pipefail

HOST_NAME="qdistro"
EXT_ID="qdistro-firefox@qdistro.local"
BRIDGE_PATH="${QDISTRO_BRIDGE_PATH:-$(command -v qdistro-browser-bridge 2>/dev/null || true)}"

if [[ -z "$BRIDGE_PATH" ]]; then
    echo "[install-native-host] QDISTRO_BRIDGE_PATH unset and qdistro-browser-bridge not on PATH" >&2
    exit 1
fi

MODE="user"
case "${1:-}" in
    --system) MODE="system" ;;
    --print)  MODE="print" ;;
    "")       ;;
    *) echo "usage: $0 [--system|--print]" >&2; exit 2 ;;
esac

manifest_json() {
    cat <<JSON
{
  "name": "${HOST_NAME}",
  "description": "qdistro browser bridge (native messaging host)",
  "path": "${BRIDGE_PATH}",
  "type": "stdio",
  "allowed_extensions": ["${EXT_ID}"]
}
JSON
}

case "$MODE" in
    print)
        manifest_json
        ;;
    user)
        DIR="$HOME/.mozilla/native-messaging-hosts"
        mkdir -p "$DIR"
        manifest_json > "$DIR/${HOST_NAME}.json"
        echo "[install-native-host] wrote $DIR/${HOST_NAME}.json"
        ;;
    system)
        if [[ -d /usr/lib64/mozilla/native-messaging-hosts ]]; then
            DIR=/usr/lib64/mozilla/native-messaging-hosts
        else
            DIR=/usr/lib/mozilla/native-messaging-hosts
        fi
        mkdir -p "$DIR"
        manifest_json > "$DIR/${HOST_NAME}.json"
        echo "[install-native-host] wrote $DIR/${HOST_NAME}.json"
        ;;
esac
