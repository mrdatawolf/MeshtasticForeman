#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

VERSION=$(node -p "require('$ROOT/package.json').version")

echo ""
echo "  Meshtastic Foreman — Frontend"
echo "  v$VERSION"
echo ""

cd "$ROOT"

# Wait for the API's HTTP liveness endpoint before starting the frontend.
API_PORT=$(grep -E '^API_PORT=' "$ROOT/.env" 2>/dev/null | cut -d= -f2 | tr -d '[:space:]"' || true)
API_PORT="${API_PORT:-3172}"
API_WAIT_TIMEOUT=60

echo "  Waiting for API on port $API_PORT..."
waited=0
until curl --fail -s "http://127.0.0.1:$API_PORT/api/health" >/dev/null; do
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -ge "$API_WAIT_TIMEOUT" ]; then
        echo "  WARNING: API did not come up on port $API_PORT within ${API_WAIT_TIMEOUT}s — starting frontend anyway."
        break
    fi
done
[ "$waited" -lt "$API_WAIT_TIMEOUT" ] && echo "  API is up."

pnpm --filter @foreman/web dev
