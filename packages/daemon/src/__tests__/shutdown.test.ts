import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { importedDb, importedClearDbLock } = vi.hoisted(() => ({
  importedDb: { close: vi.fn().mockResolvedValue(undefined) },
  importedClearDbLock: vi.fn(),
}));

vi.mock("../db/client.js", () => ({ db: importedDb }));
vi.mock("../db/open.js", () => ({ clearDbLock: importedClearDbLock }));

import { createShutdownCoordinator } from "../index.js";

function makeHarness(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const wsHandle = {
    closeAll: vi.fn((code: number, reason: string) => calls.push(`ws:${code}:${reason}`)),
  };
  const app = { close: vi.fn(async () => void calls.push("http")) };
  const mqttGateway = { shutdown: vi.fn(async () => void calls.push("mqtt")) };
  const deviceManager = { shutdown: vi.fn(async () => void calls.push("serial")) };
  const retentionSweep = { stop: vi.fn(() => calls.push("retention")) };
  const db = { close: vi.fn(async () => void calls.push("db")) };
  const clearDbLock = vi.fn(() => calls.push("lock"));
  const dependencies = {
    getWsHandle: () => wsHandle,
    getApp: () => app,
    getMqttGateway: () => mqttGateway,
    getDeviceManager: () => deviceManager,
    getRetentionSweep: () => retentionSweep,
    db,
    clearDbLock,
    ...overrides,
  };
  return {
    calls,
    dependencies,
    wsHandle,
    app,
    mqttGateway,
    deviceManager,
    retentionSweep,
    db,
    clearDbLock,
  };
}

describe("coordinated shutdown", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("closes every subsystem in the contract order and exits cleanly", async () => {
    const harness = makeHarness();
    await createShutdownCoordinator(harness.dependencies)("SIGTERM");

    expect(harness.calls).toEqual([
      "ws:1001:server shutting down",
      "http",
      "mqtt",
      "serial",
      "retention",
      "db",
      "lock",
    ]);
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it("continues through later steps when one subsystem throws", async () => {
    const harness = makeHarness();
    harness.app.close.mockRejectedValueOnce(new Error("close failed"));

    await createShutdownCoordinator(harness.dependencies)("SIGINT");

    expect(harness.calls).toEqual([
      "ws:1001:server shutting down",
      "mqtt",
      "serial",
      "retention",
      "db",
      "lock",
    ]);
    expect(harness.db.close).toHaveBeenCalledOnce();
    expect(harness.clearDbLock).toHaveBeenCalledOnce();
    expect(process.exit).toHaveBeenCalledWith(0);
  });

  it("force-exits after the timeout without clearing the database lock", async () => {
    vi.useFakeTimers();
    const harness = makeHarness({
      getMqttGateway: () => ({ shutdown: () => new Promise<void>(() => {}) }),
    });

    void createShutdownCoordinator(harness.dependencies, 25)("SIGTERM");
    await vi.advanceTimersByTimeAsync(25);

    expect(process.exit).toHaveBeenCalledWith(124);
    expect(console.error).toHaveBeenCalledWith(
      '[shutdown] shutdown timed out; forcing exit {"operation":"shutdown","step":"MQTT gateway"}',
    );
    expect(harness.db.close).not.toHaveBeenCalled();
    expect(harness.clearDbLock).not.toHaveBeenCalled();
  });

  it("force-exits immediately on a second signal", () => {
    importedDb.close.mockImplementationOnce(() => new Promise<void>(() => {}));

    process.emit("SIGTERM", "SIGTERM");
    process.emit("SIGINT", "SIGINT");

    expect(process.exit).toHaveBeenCalledWith(1);
  });
});
