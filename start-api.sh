#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

VERSION=$(node -p "require('$ROOT/package.json').version")

echo ""
echo "  Meshtastic Foreman — API Daemon"
echo "  v$VERSION"
echo ""

# Warn if MESHTASTIC_PORT looks like a Windows COM port
if [ -f "$ROOT/.env" ]; then
    port=$(grep -E '^MESHTASTIC_PORT=' "$ROOT/.env" | cut -d= -f2 | tr -d '[:space:]"' || true)
    if [[ "$port" =~ ^COM[0-9]+ ]]; then
        echo "  WARNING: MESHTASTIC_PORT is set to '$port' (Windows COM port)."
        echo "           On Linux use a device path, e.g. /dev/ttyUSB0 or /dev/ttyACM0"
        echo ""
    fi
fi

cd "$ROOT"

while true; do
    pnpm --filter @foreman/daemon dev || true
    echo ""
    echo "  Daemon exited — restarting..."
    echo ""
    sleep 1
done
