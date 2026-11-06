import { constants as fsConstants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { formatNodeId } from "@foreman/shared";
import { SerialPort } from "serialport";

import { radioState, type RadioState } from "../device/radio-state.js";
import { RADIO_RESPONSE_WINDOW_MS } from "../device/raw-probe.js";

import type { ConnectionFacts, DeviceManager } from "../device/device-manager.js";
import type { MqttGateway } from "../mqtt/gateway.js";
import type { PGlite } from "@electric-sql/pglite";
import type {
  CheckStatus,
  DebugCheck,
  DebugChecksResponse,
  DebugDeviceReport,
  DebugToolId,
} from "@foreman/shared";

const WINDOW_SECONDS = RADIO_RESPONSE_WINDOW_MS / 1000;

/** Read-only answers about a port. None of these open it. Null means "cannot tell here". */
export interface PortInspector {
  isPresent(port: string): Promise<boolean | null>;
  canOpen(port: string): Promise<boolean | null>;
}

export interface DeviceFacts extends ConnectionFacts {
  deviceId: string;
  port: string;
  portPresent: boolean | null;
  portAccessible: boolean | null;
  ownNodeId: number | null;
  hasGpsPosition: boolean;
  gpsMode: string | null;
  firmware: string | null;
  hasSavedConfig: boolean;
  coreVersion: string | null;
}

function check(
  id: string,
  title: string,
  status: CheckStatus,
  summary: string,
  details: { cause?: string; fix?: string; toolIds?: DebugToolId[] } = {},
): DebugCheck {
  return {
    id,
    title,
    status,
    summary,
    cause: details.cause ?? null,
    fix: details.fix ?? null,
    toolIds: details.toolIds ?? [],
  };
}

function portPresentCheck(facts: DeviceFacts): DebugCheck {
  const { id, title } = { id: "serial-port-present", title: "Serial port present" };
  if (facts.portPresent === null) {
    return check(id, title, "skipped", `Could not look up ${facts.port} on this system.`);
  }
  if (facts.portPresent) return check(id, title, "pass", `${facts.port} exists.`);
  return check(id, title, "fail", `${facts.port} does not exist.`, {
    cause: "The radio is unplugged, or the system gave it a different port name.",
    fix: "Check the USB cable and that the radio is powered on. If the port name changed, connect it from the Device menu.",
  });
}

function portPermissionCheck(facts: DeviceFacts): DebugCheck {
  const { id, title } = { id: "serial-port-permission", title: "Serial port permission" };
  if (facts.portAccessible === null) {
    return check(id, title, "skipped", "This cannot be tested here without opening the port.");
  }
  if (facts.portAccessible) {
    return check(id, title, "pass", `The daemon's user can read and write ${facts.port}.`);
  }
  return check(id, title, "fail", `The daemon's user cannot open ${facts.port}.`, {
    cause: "The account running the daemon does not have permission to use this port.",
    fix: "On Linux, add that account to the group that owns the port, such as dialout, then log in again.",
  });
}

function connectionHeldCheck(facts: DeviceFacts): DebugCheck {
  const { id, title } = { id: "connection-held", title: "Connection held" };
  switch (facts.phase) {
    case "held":
      return check(id, title, "pass", `The daemon holds ${facts.port}.`);
    case "connecting":
      return check(id, title, "warn", `The daemon is opening ${facts.port}.`);
    case "backoff":
      return check(id, title, "warn", "The connection dropped and the daemon is retrying.", {
        cause: "The port closed unexpectedly, or a reconnect attempt failed.",
        fix: "Wait for the next retry, or reconnect now.",
        toolIds: ["reconnect"],
      });
    case "released":
      return check(id, title, "warn", `The daemon has released ${facts.port}.`, {
        cause: "The port was disconnected, or could not be opened when the daemon started.",
        fix: "Reconnect when you want the daemon to use the radio again.",
        toolIds: ["reconnect"],
      });
  }
}

function radioRespondingCheck(facts: DeviceFacts, state: RadioState): DebugCheck {
  const { id, title } = { id: "radio-responding", title: "Radio responding" };
  switch (state) {
    case "not-held":
      return check(id, title, "skipped", "The daemon does not hold the port.");
    case "no-request":
      return check(id, title, "warn", "Waiting for the first config request.");
    case "answered":
      return check(id, title, "pass", "The radio answered the latest config request.");
    case "waiting":
      return check(id, title, "warn", "Waiting for the radio to answer a config request.");
    case "silent":
      return check(
        id,
        title,
        "fail",
        `The radio sent nothing for at least ${WINDOW_SECONDS} seconds after a config request.`,
        {
          cause:
            "The radio's firmware may have stopped answering. The USB port can still look normal when this happens.",
          fix: "Run the raw serial probe. If it receives nothing, power-cycle the radio, including its battery if it has one.",
          toolIds: ["raw-probe", "reconfigure"],
        },
      );
  }
}

function configurationCheck(facts: DeviceFacts, state: RadioState): DebugCheck {
  const { id, title } = { id: "configuration-finished", title: "Configuration finished" };
  if (!facts.portHeld) return check(id, title, "skipped", "The daemon does not hold the port.");
  if (facts.configured) return check(id, title, "pass", "The radio finished sending its config.");
  if (state === "silent") {
    return check(id, title, "fail", "The radio never finished sending its config.", {
      cause: "The radio did not answer the config request.",
      fix: "Follow the Radio responding check first.",
      toolIds: ["raw-probe", "reconfigure"],
    });
  }
  const requestMs = Date.parse(facts.lastConfigRequestAt ?? "");
  const lastFrameMs = Date.parse(facts.lastFrameAt ?? "");
  if (state === "answered" && lastFrameMs - requestMs >= RADIO_RESPONSE_WINDOW_MS) {
    return check(id, title, "warn", "The radio is sending data but has not finished its config.", {
      cause: "The config transfer was interrupted, or the link is dropping data.",
      fix: "Request the config again.",
      toolIds: ["reconfigure"],
    });
  }
  return check(id, title, "warn", "Waiting for the radio to finish sending its config.");
}

function nodeIdCheck(facts: DeviceFacts, state: RadioState): DebugCheck {
  const { id, title } = { id: "node-id-known", title: "Node ID known" };
  if (facts.ownNodeId !== null) {
    return check(id, title, "pass", `This radio is ${formatNodeId(facts.ownNodeId)}.`);
  }
  if (!facts.portHeld) return check(id, title, "skipped", "The daemon does not hold the port.");
  if (state === "silent") {
    return check(id, title, "fail", "The radio has not reported its node ID.", {
      cause: "The radio did not answer the config request.",
      fix: "Follow the Radio responding check first.",
      toolIds: ["raw-probe", "reconfigure"],
    });
  }
  return check(id, title, "warn", "Waiting for the radio to report its node ID.", {
    toolIds: ["reconfigure"],
  });
}

function configFreshnessCheck(facts: DeviceFacts): DebugCheck {
  const { id, title } = { id: "config-freshness", title: "Config freshness" };
  if (facts.portHeld && facts.configured) {
    return check(id, title, "pass", "The config shown came from the radio this session.");
  }
  if (!facts.hasSavedConfig) {
    return check(id, title, "skipped", "No config has been saved for this radio yet.");
  }
  return check(id, title, "warn", "The config shown is a saved copy, not from this session.", {
    cause: "The radio has not finished sending its config since it connected.",
    fix: "Treat the Device Config page as possibly out of date until this passes.",
    toolIds: facts.portHeld ? ["reconfigure"] : ["reconnect"],
  });
}

function gpsModeLabel(mode: string | null): string {
  switch (mode) {
    case "0":
    case "DISABLED":
      return "Disabled";
    case "1":
    case "ENABLED":
      return "Enabled";
    case "2":
    case "NOT_PRESENT":
      return "Not present";
    default:
      return "Unknown";
  }
}

function gpsCheck(facts: DeviceFacts): DebugCheck {
  const { id, title } = { id: "gps", title: "GPS" };
  const label = gpsModeLabel(facts.gpsMode);
  if (facts.hasGpsPosition) {
    return check(id, title, "pass", `A position arrived this session. Saved mode: ${label}.`);
  }
  if (!facts.portHeld) {
    return check(id, title, "skipped", `The daemon does not hold the port. Saved mode: ${label}.`);
  }
  if (label !== "Enabled" && label !== "Unknown") {
    return check(id, title, "skipped", `No position expected. Saved mode: ${label}.`);
  }
  return check(id, title, "warn", `No position received yet. Saved mode: ${label}.`, {
    cause: "The GPS may not have a fix, or the radio has not reported one.",
    fix: "Give the radio a clear view of the sky, or request a position from the GPS menu.",
  });
}

function versionsCheck(facts: DeviceFacts): DebugCheck {
  const { id, title } = { id: "versions", title: "Versions" };
  const summary = `Firmware ${facts.firmware ?? "unknown"}, @meshtastic/core ${facts.coreVersion ?? "unknown"}.`;
  return check(id, title, facts.firmware === null ? "skipped" : "pass", summary);
}

export function buildDeviceChecks(facts: DeviceFacts, nowMs: number): DebugCheck[] {
  const state = radioState(facts, nowMs);
  return [
    portPresentCheck(facts),
    portPermissionCheck(facts),
    connectionHeldCheck(facts),
    radioRespondingCheck(facts, state),
    configurationCheck(facts, state),
    nodeIdCheck(facts, state),
    configFreshnessCheck(facts),
    gpsCheck(facts),
    versionsCheck(facts),
  ];
}

/** Reports connection state only. The broker address can hold credentials, so it stays out. */
export function mqttCheck(
  gateway: Pick<MqttGateway, "isRunning" | "connected"> | null,
): DebugCheck {
  const { id, title } = { id: "mqtt-broker", title: "MQTT broker" };
  if (gateway === null) return check(id, title, "skipped", "No MQTT broker is configured.");
  if (!gateway.isRunning) return check(id, title, "skipped", "The MQTT gateway is turned off.");
  if (gateway.connected) return check(id, title, "pass", "Connected to the MQTT broker.");
  return check(id, title, "fail", "The daemon cannot reach the MQTT broker.", {
    cause: "This is separate from the radio. The broker or the network may be down.",
    fix: "Check the broker address and your network. The daemon keeps retrying by itself.",
  });
}

export function savedDevicesCheck(
  saved: { port: string; portPresent: boolean | null }[],
): DebugCheck {
  const { id, title } = { id: "saved-devices", title: "Saved devices" };
  if (saved.length === 0) return check(id, title, "skipped", "No devices are saved.");
  const missing = saved.filter((row) => row.portPresent === false).map((row) => row.port);
  if (missing.length > 0) {
    return check(id, title, "warn", `Saved ports that do not exist: ${missing.join(", ")}.`, {
      cause: "These radios are unplugged, or their port names changed.",
      fix: "Plug the radio back in, or connect it on its new port from the Device menu.",
    });
  }
  if (saved.some((row) => row.portPresent === null)) {
    return check(id, title, "skipped", "Could not look up the saved ports on this system.");
  }
  const count = saved.length === 1 ? "1 saved device" : `${saved.length} saved devices`;
  return check(id, title, "pass", `${count}, and every port exists.`);
}

function errorCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException).code;
}

/** Windows COM ports are not files, so they are looked up in the system's port list. */
function normaliseComPort(port: string): string {
  return port.replace(/^\\\\\.\\/, "").toUpperCase();
}

export function createPortInspector({
  platform = process.platform,
  listPorts = () => SerialPort.list(),
}: {
  platform?: NodeJS.Platform;
  listPorts?: () => Promise<{ path: string }[]>;
} = {}): PortInspector {
  if (platform === "win32") {
    return {
      async isPresent(port) {
        try {
          const ports = await listPorts();
          return ports.some((p) => normaliseComPort(p.path) === normaliseComPort(port));
        } catch {
          return null;
        }
      },
      // Windows gives no way to test this without opening the port.
      canOpen: async () => null,
    };
  }

  return {
    async isPresent(port) {
      try {
        await stat(port);
        return true;
      } catch (err) {
        return errorCode(err) === "ENOENT" ? false : null;
      }
    },
    async canOpen(port) {
      try {
        await access(port, fsConstants.R_OK | fsConstants.W_OK);
        return true;
      } catch (err) {
        const code = errorCode(err);
        return code === "EACCES" || code === "EPERM" ? false : null;
      }
    },
  };
}

/** The installed version, or null where it cannot be found, such as a bundled daemon. */
export async function readCoreVersion(): Promise<string | null> {
  try {
    const entry = createRequire(import.meta.url).resolve("@meshtastic/core");
    const manifest = await readFile(join(dirname(entry), "..", "package.json"), "utf8");
    const { version } = JSON.parse(manifest) as { version?: unknown };
    return typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

interface SavedDeviceRow {
  id: string;
  port: string;
  firmware: string | null;
  has_config: boolean;
  gps_mode: string | null;
}

export interface DebugCheckDeps {
  db: PGlite;
  deviceManager: Pick<DeviceManager, "getConnectionFacts" | "getMyNodeId" | "hasGpsPosition">;
  mqttGateway: Pick<MqttGateway, "isRunning" | "connected"> | null;
  inspector: PortInspector;
  coreVersion: string | null;
}

/**
 * Gathers facts and runs every check. It only reads: nothing here opens a port,
 * sends to a radio, or changes state. The query names single columns so that
 * keys and PSKs in the saved config never reach this code. Returns null when
 * `deviceId` matches no saved device.
 */
export async function collectDebugChecks(
  deps: DebugCheckDeps,
  deviceId?: string,
  nowMs = Date.now(),
): Promise<DebugChecksResponse | null> {
  const { rows } = await deps.db.query<SavedDeviceRow>(
    `SELECT id, port, firmware,
            radio_config IS NOT NULL AS has_config,
            radio_config->'position'->>'gpsMode' AS gps_mode
     FROM devices ORDER BY created_at`,
  );
  const selected = deviceId === undefined ? rows : rows.filter((row) => row.id === deviceId);
  if (deviceId !== undefined && selected.length === 0) return null;

  const present = new Map<string, boolean | null>();
  for (const port of new Set(rows.map((row) => row.port))) {
    present.set(port, await deps.inspector.isPresent(port));
  }

  const devices: DebugDeviceReport[] = [];
  for (const row of selected) {
    const connection = deps.deviceManager.getConnectionFacts(row.id);
    const portPresent = present.get(row.port) ?? null;
    const checks = buildDeviceChecks(
      {
        ...connection,
        deviceId: row.id,
        port: row.port,
        portPresent,
        portAccessible: portPresent === true ? await deps.inspector.canOpen(row.port) : null,
        ownNodeId: deps.deviceManager.getMyNodeId(row.id) ?? null,
        hasGpsPosition: deps.deviceManager.hasGpsPosition(row.id),
        gpsMode: row.gps_mode,
        firmware: row.firmware,
        hasSavedConfig: row.has_config,
        coreVersion: deps.coreVersion,
      },
      nowMs,
    );
    devices.push({
      deviceId: row.id,
      port: row.port,
      portHeld: connection.portHeld,
      lastFrameAt: connection.lastFrameAt,
      framesThisConnection: connection.framesThisConnection,
      lastConfigRequestAt: connection.lastConfigRequestAt,
      configured: connection.configured,
      checks,
    });
  }

  return {
    generatedAt: new Date(nowMs).toISOString(),
    devices,
    system: [
      mqttCheck(deps.mqttGateway),
      savedDevicesCheck(
        rows.map((row) => ({ port: row.port, portPresent: present.get(row.port) ?? null })),
      ),
    ],
  };
}
