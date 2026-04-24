# Setup & Configuration

## Prerequisites

- [Node.js](https://nodejs.org) 20+
- [pnpm](https://pnpm.io) 8+
- A Meshtastic device connected via USB serial

## Installation

```sh
# 1. Clone the repo
git clone https://github.com/mrdatawolf/MeshtasticForeman.git
cd MeshtasticForeman

# 2. Copy and fill in your environment variables
cp .env.example .env

# 3. Install dependencies
pnpm install
```

## Starting the app

| Script | What it runs |
|--------|-------------|
| `start-both.ps1` / `start-both.sh` | Daemon + frontend dev server |
| `start-api.ps1` / `start-api.sh` | Daemon only |
| `start-frontend.ps1` / `start-frontend.sh` | Frontend dev server only |

In production, the daemon serves the built frontend — run `pnpm build` first, then start only the daemon.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MESHTASTIC_PORT` | — | Serial port of the device (`COM7`, `/dev/ttyUSB0`) |
| `MESHTASTIC_NAME` | port value | Display name for the device |
| `API_PORT` | `3172` | Daemon HTTP port |
| `API_HOST` | `0.0.0.0` | Daemon bind address |
| `API_URI` | `http://localhost` | Base URI the frontend uses to reach the daemon |
| `FRONTEND_PORT` | `3173` | Frontend dev server port |
| `FRONTEND_HOST` | `0.0.0.0` | Frontend dev server bind address |
| `MQTT_BROKER` | — | MQTT broker hostname — gateway disabled if unset |
| `MQTT_PORT` | `1883` | MQTT broker port |
| `MQTT_USER` | — | MQTT username |
| `MQTT_PASS` | — | MQTT password |
| `MQTT_ROOT` | — | Root topic prefix (e.g. `msh/US/CA/Humboldt/Eureka`) |
| `PGLITE_DIR` | auto | Override path for the PGlite data directory |
| `VITE_MAP_STYLE` | OpenFreeMap liberty | MapLibre GL style JSON URL |

## Installers

Pre-built installers for Windows and Linux are available on the [Releases](../../releases) page.
