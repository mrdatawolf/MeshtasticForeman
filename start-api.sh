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

# Run node directly, as packages/daemon's "dev" script does. pnpm exits as soon as it
# gets SIGTERM, which ends this script while the daemon is still shutting down. systemd
# then sends a second signal, and that abandons the shutdown. Do not start node in the
# background and forward signals either: a control-group stop would signal it twice.
# Bash runs this trap only after node exits, so the script outlives the daemon.
stopping=0
trap 'stopping=1' INT TERM

cd "$ROOT/packages/daemon"

while true; do
    rc=0
    node --env-file=../../.env --import tsx/esm src/index.ts || rc=$?
    # Exit 0 is a finished graceful shutdown. Anything else without a stop request
    # is a crash, so restart.
    if [ "$stopping" -eq 1 ] || [ "$rc" -eq 0 ]; then
        exit 0
    fi
    echo ""
    echo "  Daemon exited — restarting..."
    echo ""
    sleep 1
done
