#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

VERSION=$(node -p "require('$ROOT/package.json').version")

echo ""
echo "  Meshtastic Foreman — Frontend"
echo "  v$VERSION"
echo ""

cd "$ROOT"

# Wait for the API to be listening before starting the frontend (there's no
# HTTP health endpoint to poll, so we just check that the TCP port is open).
API_PORT=$(grep -E '^API_PORT=' "$ROOT/.env" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]"' || true)
API_PORT="${API_PORT:-3172}"
API_WAIT_TIMEOUT=60

echo "  Waiting for API on port $API_PORT..."
waited=0
until (exec 3<>"/dev/tcp/127.0.0.1/$API_PORT") 2>/dev/null; do
    exec 3>&- 2>/dev/null || true
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -ge "$API_WAIT_TIMEOUT" ]; then
        echo "  WARNING: API did not come up on port $API_PORT within ${API_WAIT_TIMEOUT}s — starting frontend anyway."
        break
    fi
done
exec 3>&- 2>/dev/null || true
[ "$waited" -lt "$API_WAIT_TIMEOUT" ] && echo "  API is up."

pnpm --filter @foreman/web dev
