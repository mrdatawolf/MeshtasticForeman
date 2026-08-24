#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

VERSION=$(node -p "require('$ROOT/package.json').version")

echo ""
echo "  Meshtastic Foreman v$VERSION"
echo ""

# Launch a script in a new terminal window.
# Returns 0 if a terminal emulator was found, 1 if not.
launch_in_terminal() {
    local title="$1" script="$2"
    if command -v gnome-terminal &>/dev/null; then
        gnome-terminal --title="$title" -- bash "$script" &
    elif command -v konsole &>/dev/null; then
        konsole --noclose --title "$title" -e bash "$script" &
    elif command -v xfce4-terminal &>/dev/null; then
        xfce4-terminal --title="$title" --hold -e "bash $script" &
    elif command -v xterm &>/dev/null; then
        xterm -title "$title" -hold -e bash "$script" &
    else
        return 1
    fi
    return 0
}

echo "  Starting API daemon..."
if launch_in_terminal "Foreman — API" "$ROOT/start-api.sh"; then
    echo "  Waiting 3s for daemon to initialise..."
    sleep 3
    echo "  Starting frontend..."
    launch_in_terminal "Foreman — Frontend" "$ROOT/start-frontend.sh"
    echo ""
    echo "  Both services launched in separate windows."
    echo ""
else
    # No terminal emulator found — run API in background, frontend in foreground.
    echo "  No terminal emulator found; running API in background and frontend here."
    echo "  Press Ctrl+C to stop both."
    echo ""
    bash "$ROOT/start-api.sh" &
    API_PID=$!
    echo "  API daemon PID: $API_PID"
    echo "  Waiting 3s for daemon to initialise..."
    sleep 3
    echo "  Starting frontend..."
    trap 'kill "$API_PID" 2>/dev/null; exit' INT TERM
    bash "$ROOT/start-frontend.sh"
fi
