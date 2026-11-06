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

## Hiding old nodes

The **Last seen** control in the header limits the app to nodes heard recently. Choose **Week**,
**Month**, **Quarter**, **Year**, or **All**. It starts on **Week**, and each browser remembers its
own choice. The count beside it, such as `6 / 12 nodes`, shows how many nodes are shown out of all
known nodes, after any MQTT region scope. Hidden nodes are not deleted.

- A node's age comes from whichever is more recent, its mesh or its MQTT last-heard time.
- Nodes with no last-heard time appear only under **All**.
- The connected radio's own node always appears.
- A hidden node comes back as soon as it is heard again, with no reload.

The filter applies to Nodes, Map, the **+ New** picker on Messages, and the per-node charts and lists
on Analytics. Existing conversations stay in Messages with their names, whatever their age. Activity,
Logs, Overrides, and Device Config are not filtered. The traceroute **Age** control on Map and the
range buttons on Analytics work separately.

## Troubleshooting a radio

Open **Settings > Debug** when the app says a radio is connected but nothing is happening. The page
lists what is wrong in plain language, with a likely cause, a next step, and a tool button where a
tool can help. It works from another machine on your network and at phone width. **Copy results**
gives you the report as text for sharing.

| Tool | What it does |
|---|---|
| Rerun checks | Runs the checks again. It changes nothing. |
| Re-request config | Asks the radio for its config again. |
| Disconnect serial | Releases the port after you confirm. The daemon then stays off the radio until you reconnect it or restart the daemon. |
| Reconnect serial | Connects again without restarting the daemon. |
| Raw serial probe | After you confirm, drops the connection for up to about 30 seconds and tests the radio directly, then reconnects. |

**Radio responding** is the check to read first. It fails when the radio sends nothing for 25
seconds after a config request. A radio that is quiet with nothing to answer is fine.

If it fails, run the raw serial probe:

| Result | What to do |
|---|---|
| The radio is healthy | The radio is fine, so check the daemon's connection to it. |
| The radio answered, but did not finish | The link or firmware is unreliable. Retry, then power-cycle the radio. |
| The radio did not answer | Power-cycle the radio, including its battery if it has one. |
| The port could not be opened | Check whether another program is holding the port. |

No software tool here can clear a hung radio, because that needs a power cycle. After **Disconnect
serial** the port is free for outside tools, such as `meshtastic --port <port> --info`, and a radio
that is still responding can be restarted with `meshtastic --port <port> --reboot`.

## Installers

Pre-built installers for Windows and Linux are available on the [Releases](../../releases) page.
