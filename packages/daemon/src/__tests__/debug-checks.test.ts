/**
 * Debug check tests. Every port lookup goes through a fake inspector or a
 * temporary file, and `serialport` is mocked, so nothing touches a real port.
 */

import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runMigrations } from "../db/migrations.js";
import {
  buildDeviceChecks,
  collectDebugChecks,
  createPortInspector,
  mqttCheck,
  radioState,
  readCoreVersion,
  savedDevicesCheck,
} from "../debug/checks.js";
import { RADIO_RESPONSE_WINDOW_MS } from "../device/raw-probe.js";

import type { DeviceFacts, PortInspector } from "../debug/checks.js";
import type { DebugCheck } from "@foreman/shared";

vi.mock("serialport", () => ({
  SerialPort: class {
    constructor() {
      throw new Error("A check tried to open a serial port");
    }
  },
}));

const NOW = Date.parse("2026-11-06T12:00:00.000Z");
const iso = (msBeforeNow: number) => new Date(NOW - msBeforeNow).toISOString();

function facts(overrides: Partial<DeviceFacts> = {}): DeviceFacts {
  return {
    deviceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    port: "/dev/ttyUSB0",
    portHeld: true,
    phase: "held",
    lastFrameAt: iso(1_000),
    framesThisConnection: 40,
    lastConfigRequestAt: iso(2_000),
    unansweredSinceAt: null,
    configured: true,
    portPresent: true,
    portAccessible: true,
    ownNodeId: 0x1234abcd,
    hasGpsPosition: true,
    gpsMode: "1",
    firmware: "2.6.11",
    hasSavedConfig: true,
    coreVersion: "2.6.7",
    ...overrides,
  };
}

function find(checks: DebugCheck[], id: string): DebugCheck {
  const found = checks.find((item) => item.id === id);
  if (!found) throw new Error(`No check ${id}`);
  return found;
}

const result = (id: string, overrides: Partial<DeviceFacts> = {}) =>
  find(buildDeviceChecks(facts(overrides), NOW), id);

describe("Radio responding", () => {
  it("is skipped when the daemon does not hold the port", () => {
    expect(result("radio-responding", { portHeld: false, phase: "released" }).status).toBe(
      "skipped",
    );
  });

  it("passes when a frame arrived after the request", () => {
    expect(result("radio-responding").status).toBe("pass");
  });

  it("warns while waiting, under the window", () => {
    const check = result("radio-responding", {
      lastFrameAt: null,
      lastConfigRequestAt: iso(RADIO_RESPONSE_WINDOW_MS - 1),
      unansweredSinceAt: iso(RADIO_RESPONSE_WINDOW_MS - 1),
    });
    expect(check.status).toBe("warn");
  });

  it("fails at the window, with a cause, a next step, and the probe offered", () => {
    const check = result("radio-responding", {
      lastFrameAt: iso(60_000),
      lastConfigRequestAt: iso(RADIO_RESPONSE_WINDOW_MS),
      unansweredSinceAt: iso(RADIO_RESPONSE_WINDOW_MS),
    });
    expect(check.status).toBe("fail");
    expect(check.cause).toContain("firmware");
    expect(check.fix).toContain("power-cycle");
    expect(check.toolIds).toContain("raw-probe");
  });

  it("a healthy radio that stays silent with no request outstanding does not fail", () => {
    const check = result("radio-responding", {
      lastFrameAt: iso(6 * 60 * 60_000),
      lastConfigRequestAt: iso(6 * 60 * 60_000 + 1),
    });
    expect(check.status).toBe("pass");
  });

  it("treats no request yet as waiting, not a failure", () => {
    expect(
      result("radio-responding", { lastConfigRequestAt: null, lastFrameAt: null }).status,
    ).toBe("warn");
  });

  it("stays failed through a repeat request, however recent", () => {
    expect(
      radioState(
        { portHeld: true, lastConfigRequestAt: iso(1_000), unansweredSinceAt: iso(95_000) },
        NOW,
      ),
    ).toBe("silent");
  });

  it("waits again for a new request after the radio answers", () => {
    expect(
      radioState(
        { portHeld: true, lastConfigRequestAt: iso(1_000), unansweredSinceAt: iso(1_000) },
        NOW,
      ),
    ).toBe("waiting");
  });
});

describe("device checks", () => {
  it("every failing check has a cause and a next step", () => {
    const silent = facts({
      portPresent: false,
      portAccessible: false,
      lastFrameAt: null,
      lastConfigRequestAt: iso(30_000),
      unansweredSinceAt: iso(30_000),
      configured: false,
      ownNodeId: null,
    });
    const failing = buildDeviceChecks(silent, NOW).filter((item) => item.status === "fail");

    expect(failing.map((item) => item.id).sort()).toEqual([
      "configuration-finished",
      "node-id-known",
      "radio-responding",
      "serial-port-permission",
      "serial-port-present",
    ]);
    for (const item of failing) {
      expect(item.cause).toBeTruthy();
      expect(item.fix).toBeTruthy();
    }
  });

  it("Serial port present reports a missing port and cannot-tell", () => {
    expect(result("serial-port-present", { portPresent: false }).status).toBe("fail");
    expect(result("serial-port-present", { portPresent: null }).status).toBe("skipped");
    expect(result("serial-port-present").status).toBe("pass");
  });

  it("Serial port permission is skipped when it cannot be tested", () => {
    expect(result("serial-port-permission", { portAccessible: null }).status).toBe("skipped");
    expect(result("serial-port-permission", { portAccessible: false }).status).toBe("fail");
  });

  it("Connection held describes each phase and offers reconnect when down", () => {
    expect(result("connection-held").status).toBe("pass");
    expect(result("connection-held", { portHeld: false, phase: "connecting" }).status).toBe("warn");
    for (const phase of ["backoff", "released"] as const) {
      const check = result("connection-held", { portHeld: false, phase });
      expect(check.status).toBe("warn");
      expect(check.toolIds).toEqual(["reconnect"]);
    }
  });

  it("Configuration finished waits, passes, and warns on a stalled transfer", () => {
    expect(result("configuration-finished").status).toBe("pass");
    expect(
      result("configuration-finished", { configured: false, lastFrameAt: iso(1_000) }).summary,
    ).toContain("Waiting");
    const stalled = result("configuration-finished", {
      configured: false,
      lastConfigRequestAt: iso(40_000),
      lastFrameAt: iso(1_000),
    });
    expect(stalled.status).toBe("warn");
    expect(stalled.toolIds).toEqual(["reconfigure"]);
    expect(result("configuration-finished", { portHeld: false }).status).toBe("skipped");
  });

  it("Node ID known shows the ID, and fails only for a silent radio", () => {
    expect(result("node-id-known").summary).toContain("1234abcd");
    expect(result("node-id-known", { ownNodeId: null }).status).toBe("warn");
    expect(
      result("node-id-known", {
        ownNodeId: null,
        lastFrameAt: null,
        lastConfigRequestAt: iso(30_000),
        unansweredSinceAt: iso(30_000),
      }).status,
    ).toBe("fail");
    expect(result("node-id-known", { ownNodeId: null, portHeld: false }).status).toBe("skipped");
  });

  it("Config freshness flags a saved copy", () => {
    expect(result("config-freshness").status).toBe("pass");
    expect(result("config-freshness", { configured: false }).status).toBe("warn");
    const released = result("config-freshness", { portHeld: false });
    expect(released.status).toBe("warn");
    expect(released.toolIds).toEqual(["reconnect"]);
    expect(result("config-freshness", { portHeld: false, hasSavedConfig: false }).status).toBe(
      "skipped",
    );
  });

  it("GPS reports the saved mode and only warns when a position is expected", () => {
    expect(result("gps").status).toBe("pass");
    expect(result("gps", { hasGpsPosition: false }).status).toBe("warn");
    expect(result("gps", { hasGpsPosition: false }).summary).toContain("Enabled");
    expect(result("gps", { hasGpsPosition: false, gpsMode: "0" }).status).toBe("skipped");
    expect(result("gps", { hasGpsPosition: false, gpsMode: "NOT_PRESENT" }).summary).toContain(
      "Not present",
    );
    expect(result("gps", { hasGpsPosition: false, portHeld: false }).status).toBe("skipped");
  });

  it("Versions is informational", () => {
    expect(result("versions").summary).toBe("Firmware 2.6.11, @meshtastic/core 2.6.7.");
    expect(result("versions").status).toBe("pass");
    expect(result("versions", { firmware: null }).status).toBe("skipped");
  });
});

describe("MQTT broker", () => {
  it("reports each gateway state separately from the radio", () => {
    expect(mqttCheck(null).status).toBe("skipped");
    expect(mqttCheck({ isRunning: false, connected: false }).status).toBe("skipped");
    expect(mqttCheck({ isRunning: true, connected: true }).status).toBe("pass");
    const down = mqttCheck({ isRunning: true, connected: false });
    expect(down.status).toBe("fail");
    expect(down.cause).toContain("separate from the radio");
  });
});

describe("Saved devices", () => {
  it("lists saved ports that do not exist", () => {
    const check = savedDevicesCheck([
      { port: "/dev/ttyUSB0", portPresent: true },
      { port: "/dev/ttyUSB9", portPresent: false },
    ]);
    expect(check.status).toBe("warn");
    expect(check.summary).toContain("/dev/ttyUSB9");
    expect(check.summary).not.toContain("/dev/ttyUSB0");
  });

  it("handles no rows, all present, and unknown", () => {
    expect(savedDevicesCheck([]).status).toBe("skipped");
    expect(savedDevicesCheck([{ port: "COM3", portPresent: true }]).status).toBe("pass");
    expect(savedDevicesCheck([{ port: "COM3", portPresent: null }]).status).toBe("skipped");
  });
});

describe("createPortInspector", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "foreman-ports-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("uses the filesystem for Linux paths and never asks for a port list", async () => {
    const listPorts = vi.fn();
    const inspector = createPortInspector({ platform: "linux", listPorts });
    const file = join(directory, "ttyUSB0");
    await writeFile(file, "");

    expect(await inspector.isPresent(file)).toBe(true);
    expect(await inspector.isPresent(join(directory, "missing"))).toBe(false);
    expect(await inspector.canOpen(file)).toBe(true);
    expect(listPorts).not.toHaveBeenCalled();
  });

  it.skipIf(process.getuid?.() === 0)("reports a port the user cannot open", async () => {
    const file = join(directory, "ttyUSB0");
    await writeFile(file, "");
    await chmod(file, 0o000);

    expect(await createPortInspector({ platform: "linux" }).canOpen(file)).toBe(false);
  });

  it("looks up Windows COM ports in the port list and skips permission", async () => {
    const inspector = createPortInspector({
      platform: "win32",
      listPorts: async () => [{ path: "COM3" }],
    });

    expect(await inspector.isPresent("COM3")).toBe(true);
    expect(await inspector.isPresent("com3")).toBe(true);
    expect(await inspector.isPresent("\\\\.\\COM3")).toBe(true);
    expect(await inspector.isPresent("COM7")).toBe(false);
    expect(await inspector.canOpen("COM3")).toBeNull();
  });

  it("returns cannot-tell if the Windows port list fails", async () => {
    const inspector = createPortInspector({
      platform: "win32",
      listPorts: () => Promise.reject(new Error("no")),
    });
    expect(await inspector.isPresent("COM3")).toBeNull();
  });
});

describe("collectDebugChecks", () => {
  const DEVICE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const DEVICE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const SECRET_KEY = "c2VjcmV0LXByaXZhdGUta2V5";
  let db: PGlite;

  const released = {
    portHeld: false,
    phase: "released" as const,
    lastFrameAt: null,
    framesThisConnection: 0,
    lastConfigRequestAt: null,
    unansweredSinceAt: null,
    configured: false,
  };
  const deviceManager = {
    getConnectionFacts: vi.fn(() => released),
    getMyNodeId: vi.fn(() => undefined),
    hasGpsPosition: vi.fn(() => false),
  };
  const inspector: PortInspector = {
    isPresent: vi.fn(async (port: string) => port !== "/dev/ttyMissing"),
    canOpen: vi.fn(async () => true),
  };
  const deps = () => ({
    db,
    deviceManager,
    mqttGateway: { isRunning: true, connected: true },
    inspector,
    coreVersion: "2.6.7",
  });

  beforeAll(async () => {
    db = new PGlite();
    await runMigrations(db);
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    await db.query("DELETE FROM devices");
    await db.query(
      `INSERT INTO devices(id, name, port, firmware, radio_config, module_config)
       VALUES ($1, 'Radio A', '/dev/ttyUSB0', '2.6.11', $2, $3)`,
      [
        DEVICE_A,
        JSON.stringify({ position: { gpsMode: 1 }, security: { privateKey: SECRET_KEY } }),
        JSON.stringify({ mqtt: { password: SECRET_KEY } }),
      ],
    );
    await db.query(
      "INSERT INTO devices(id, name, port) VALUES ($1, 'Radio B', '/dev/ttyMissing')",
      [DEVICE_B],
    );
    await db.query("INSERT INTO channels(device_id, idx, psk) VALUES ($1, 0, $2)", [
      DEVICE_A,
      SECRET_KEY,
    ]);
  });

  it("covers every saved device, and is useful when nothing is connected", async () => {
    const report = await collectDebugChecks(deps(), undefined, NOW);

    expect(report?.generatedAt).toBe(new Date(NOW).toISOString());
    expect(report?.devices.map((device) => device.deviceId)).toEqual([DEVICE_A, DEVICE_B]);
    expect(report?.devices[0]).toMatchObject({ port: "/dev/ttyUSB0", portHeld: false });
    const checks = report?.devices[0].checks ?? [];
    expect(find(checks, "connection-held").status).toBe("warn");
    expect(find(checks, "versions").summary).toContain("2.6.11");
    expect(find(checks, "gps").summary).toContain("Enabled");
    expect(find(report?.devices[1].checks ?? [], "serial-port-present").status).toBe("fail");
    expect(find(report?.system ?? [], "mqtt-broker").status).toBe("pass");
    expect(find(report?.system ?? [], "saved-devices").summary).toContain("/dev/ttyMissing");
  });

  it("narrows to one device but keeps the system checks", async () => {
    const report = await collectDebugChecks(deps(), DEVICE_B, NOW);

    expect(report?.devices.map((device) => device.deviceId)).toEqual([DEVICE_B]);
    expect(find(report?.system ?? [], "saved-devices").status).toBe("warn");
  });

  it("returns null for an unknown device", async () => {
    await expect(
      collectDebugChecks(deps(), "cccccccc-cccc-4ccc-8ccc-cccccccccccc", NOW),
    ).resolves.toBeNull();
  });

  it("works with no saved devices", async () => {
    await db.query("DELETE FROM devices");
    const report = await collectDebugChecks(deps(), undefined, NOW);
    expect(report?.devices).toEqual([]);
    expect(report?.system).toHaveLength(2);
  });

  it("never exposes keys, PSKs, or credentials", async () => {
    const report = await collectDebugChecks(deps(), undefined, NOW);
    const text = JSON.stringify(report);
    expect(text).not.toContain(SECRET_KEY);
    expect(text).not.toMatch(/privateKey|psk|password/i);
  });

  it("does not test permission on a port that is missing", async () => {
    await collectDebugChecks(deps(), DEVICE_B, NOW);
    expect(inspector.canOpen).not.toHaveBeenCalledWith("/dev/ttyMissing");
  });
});

describe("readCoreVersion", () => {
  it("finds the installed version", async () => {
    await expect(readCoreVersion()).resolves.toMatch(/^\d+\.\d+\.\d+/);
  });
});
