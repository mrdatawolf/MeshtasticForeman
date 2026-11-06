/**
 * DeviceManager behavior for CONTRACT-013: frame tracking, disconnect in every
 * state, and the raw probe's effect on the connection.
 *
 * All serial I/O is fake. `serialport` and the transport are mocked, so nothing
 * here can open a real port.
 */

import { EventEmitter } from "node:events";

import { PGlite } from "@electric-sql/pglite";
import { Types } from "@meshtastic/core";
import { TransportNodeSerial } from "@meshtastic/transport-node-serial";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runMigrations } from "../db/migrations.js";
import {
  ConnectCancelledError,
  DeviceManager,
  ProbeInterruptedError,
} from "../device/device-manager.js";
import { runRawProbe } from "../device/raw-probe.js";

import type { RawProbeReading } from "../device/raw-probe.js";
import type { ServerEvent } from "@foreman/shared";

const { meshDevices, makeDispatcher, nextConfigure } = vi.hoisted(() => {
  function makeDispatcher<T = unknown>() {
    const handlers: Array<(d: T) => void> = [];
    return {
      subscribe(fn: (d: T) => void) {
        handlers.push(fn);
      },
      dispatch(data: T) {
        handlers.forEach((h) => h(data));
      },
    };
  }
  return {
    meshDevices: [] as FakeMeshDevice[],
    makeDispatcher,
    /** What the next configure() call returns, for holding a connect in flight. */
    nextConfigure: { promise: null as Promise<number> | null },
  };
});

interface FakeMeshDevice {
  configure: ReturnType<typeof vi.fn>;
  setHeartbeatInterval: ReturnType<typeof vi.fn>;
  events: Record<string, { dispatch(data: unknown): void }>;
}

vi.mock("@meshtastic/transport-node-serial", () => ({
  TransportNodeSerial: { create: vi.fn() },
}));

vi.mock("../device/raw-probe.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../device/raw-probe.js")>()),
  runRawProbe: vi.fn(),
}));

vi.mock("serialport", () => ({
  SerialPort: class {
    constructor() {
      throw new Error("A test tried to open a real serial port");
    }
  },
}));

vi.mock("@meshtastic/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@meshtastic/core")>();
  return {
    ...actual,
    MeshDevice: class MockMeshDevice {
      configure = vi.fn(() => {
        const promise = nextConfigure.promise ?? Promise.resolve(0);
        nextConfigure.promise = null;
        return promise;
      });
      requestPosition = vi.fn().mockResolvedValue(undefined);
      setHeartbeatInterval = vi.fn();
      events = Object.fromEntries(
        [
          "onMessagePacket",
          "onMeshPacket",
          "onNodeInfoPacket",
          "onPositionPacket",
          "onDeviceStatus",
          "onFromRadio",
          "onQueueStatus",
          "onTraceRoutePacket",
          "onDeviceMetadataPacket",
          "onConfigPacket",
          "onModuleConfigPacket",
          "onChannelPacket",
          "onMyNodeInfo",
          "onTelemetryPacket",
        ].map((name) => [name, makeDispatcher()]),
      );
      constructor(transport: { fromDevice: { pipeTo(destination: unknown): Promise<void> } }) {
        meshDevices.push(this as unknown as FakeMeshDevice);
        void transport.fromDevice.pipeTo({});
      }
    },
  };
});

const DEVICE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PORT = "/dev/ttyUSB0";
const NAME = "Test Node";

type FakeTransport = {
  disconnect: ReturnType<typeof vi.fn>;
  fromDevice: { pipeTo: ReturnType<typeof vi.fn> };
  port?: EventEmitter & { isOpen: boolean; closing: boolean };
};

const makeTransport = (): FakeTransport => ({
  disconnect: vi.fn().mockResolvedValue(undefined),
  fromDevice: { pipeTo: vi.fn().mockResolvedValue(undefined) },
});

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const createTransport = vi.mocked(TransportNodeSerial.create);
const probeRunner = vi.mocked(runRawProbe);

/** Resolves to the rejection, so a connect can fail before the test gets to it. */
const settled = <T>(promise: Promise<T>) => promise.catch((err: unknown) => err);

const noResponse: RawProbeReading = {
  outcome: "no-response",
  bytesReceived: 0,
  framesReceived: 0,
  ownNodeId: null,
  durationMs: 25_000,
};

describe("DeviceManager debug behavior", () => {
  let db: PGlite;
  let manager: DeviceManager;
  let events: ServerEvent[];
  let transports: FakeTransport[];

  const statuses = () =>
    events.flatMap((event) => (event.type === "device:status" ? [event.payload.status] : []));
  const internals = () =>
    manager as unknown as {
      watchdogTimers: Map<string, NodeJS.Timeout>;
      reconnectTimers: Map<string, NodeJS.Timeout>;
      reconnectTargets: Map<string, unknown>;
      connectAttempts: Set<unknown>;
      lastPacketMs: Map<string, number>;
      _scheduleReconnect(deviceId: string, port: string, name: string): void;
    };
  const connect = () => manager.connect(PORT, NAME, DEVICE_ID);
  const cancellableConnect = () => settled(connect());
  const lastDevice = () => meshDevices[meshDevices.length - 1];
  const dropConnection = (device = lastDevice()) =>
    device.events.onDeviceStatus.dispatch(Types.DeviceStatusEnum.DeviceDisconnected);

  // One database for the file: migrating a new one per test is slow enough to
  // starve the worker-based tests that run alongside this file.
  beforeAll(async () => {
    db = new PGlite();
    await runMigrations(db);
  });

  afterAll(async () => {
    await db.close();
  });

  beforeEach(async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
    });
    meshDevices.length = 0;
    nextConfigure.promise = null;
    transports = [];
    createTransport.mockReset();
    createTransport.mockImplementation(async () => {
      const transport = makeTransport();
      transports.push(transport);
      return transport as never;
    });
    probeRunner.mockReset();
    probeRunner.mockResolvedValue(noResponse);

    await db.query("DELETE FROM devices");
    await db.query("INSERT INTO devices(id, name, port) VALUES ($1, $2, $3)", [
      DEVICE_ID,
      NAME,
      PORT,
    ]);
    manager = new DeviceManager(db, { bot: { enabled: false } });
    events = [];
    manager.on("event", (event: ServerEvent) => events.push(event));
  });

  afterEach(async () => {
    await manager.shutdown();
    vi.useRealTimers();
  });

  describe("frame tracking", () => {
    it("records a config request from connect() and starts with no frames", async () => {
      await connect();
      const facts = manager.getConnectionFacts(DEVICE_ID);
      expect(facts).toMatchObject({
        portHeld: true,
        phase: "held",
        lastFrameAt: null,
        framesThisConnection: 0,
        configured: false,
      });
      expect(facts.lastConfigRequestAt).not.toBeNull();
    });

    it("counts every frame, and non-packet frames leave the mesh-packet timer alone", async () => {
      await connect();
      const packetTime = internals().lastPacketMs.get(DEVICE_ID);
      vi.setSystemTime(Date.now() + 5_000);

      lastDevice().events.onFromRadio.dispatch({ payloadVariant: { case: "config" } });
      lastDevice().events.onFromRadio.dispatch({ payloadVariant: { case: "packet" } });

      const facts = manager.getConnectionFacts(DEVICE_ID);
      expect(facts.framesThisConnection).toBe(2);
      expect(facts.lastFrameAt).toBe(new Date().toISOString());
      expect(internals().lastPacketMs.get(DEVICE_ID)).toBe(packetTime);
    });

    it("uses DeviceConfigured for configured, not configure() resolving", async () => {
      await connect();
      expect(manager.getConnectionFacts(DEVICE_ID).configured).toBe(false);

      lastDevice().events.onDeviceStatus.dispatch(Types.DeviceStatusEnum.DeviceConfigured);
      expect(manager.getConnectionFacts(DEVICE_ID).configured).toBe(true);
    });

    it("a tool's request updates the request time and clears configured", async () => {
      await connect();
      lastDevice().events.onDeviceStatus.dispatch(Types.DeviceStatusEnum.DeviceConfigured);
      vi.setSystemTime(Date.now() + 1_000);

      expect(manager.requestConfig(DEVICE_ID)).toBe(true);

      expect(lastDevice().configure).toHaveBeenCalledTimes(2);
      expect(manager.getConnectionFacts(DEVICE_ID)).toMatchObject({
        lastConfigRequestAt: new Date().toISOString(),
        configured: false,
      });
    });

    it("refuses a config request when the port is not held", () => {
      expect(manager.requestConfig(DEVICE_ID)).toBe(false);
    });

    it("the watchdog's request updates the request time", async () => {
      await connect();
      const before = manager.getConnectionFacts(DEVICE_ID).lastConfigRequestAt;

      await vi.advanceTimersByTimeAsync(135_000);

      expect(lastDevice().configure).toHaveBeenCalledTimes(2);
      expect(manager.getConnectionFacts(DEVICE_ID).lastConfigRequestAt).not.toBe(before);
    });

    it("repeat requests keep the time of the first unanswered request", async () => {
      await connect();
      const first = manager.getConnectionFacts(DEVICE_ID).unansweredSinceAt;
      expect(first).not.toBeNull();

      await vi.advanceTimersByTimeAsync(135_000);

      const facts = manager.getConnectionFacts(DEVICE_ID);
      expect(lastDevice().configure).toHaveBeenCalledTimes(2);
      expect(facts.lastConfigRequestAt).not.toBe(first);
      expect(facts.unansweredSinceAt).toBe(first);
    });

    it("any frame clears the unanswered request, and the next request starts again", async () => {
      await connect();

      lastDevice().events.onFromRadio.dispatch({ payloadVariant: { case: "packet" } });
      expect(manager.getConnectionFacts(DEVICE_ID).unansweredSinceAt).toBeNull();

      vi.setSystemTime(Date.now() + 1_000);
      expect(manager.requestConfig(DEVICE_ID)).toBe(true);

      expect(manager.getConnectionFacts(DEVICE_ID).unansweredSinceAt).toBe(
        new Date().toISOString(),
      );
    });

    it("records a request core makes by itself after the radio reboots", async () => {
      await connect();
      vi.setSystemTime(Date.now() + 1_000);

      lastDevice().events.onDeviceStatus.dispatch(Types.DeviceStatusEnum.DeviceConfiguring);

      expect(manager.getConnectionFacts(DEVICE_ID).lastConfigRequestAt).toBe(
        new Date().toISOString(),
      );
    });

    it("late frames from an old connection do not count toward the new one", async () => {
      await connect();
      const oldDevice = lastDevice();
      await manager.disconnect(DEVICE_ID);
      await connect();

      oldDevice.events.onFromRadio.dispatch({ payloadVariant: { case: "config" } });

      expect(manager.getConnectionFacts(DEVICE_ID).framesThisConnection).toBe(0);
    });
  });

  describe("disconnect", () => {
    it("stops the packet watchdog", async () => {
      await connect();
      expect(internals().watchdogTimers.size).toBe(1);

      await manager.disconnect(DEVICE_ID);

      expect(internals().watchdogTimers.size).toBe(0);
      expect(transports[0].disconnect).toHaveBeenCalledOnce();
    });

    it("waits for the OS to release the port before returning", async () => {
      await connect();
      const serial = Object.assign(new EventEmitter(), { isOpen: true, closing: false });
      transports[0].port = serial;
      let returned = false;

      const disconnecting = manager.disconnect(DEVICE_ID).then(() => {
        returned = true;
      });
      await vi.advanceTimersByTimeAsync(100);
      expect(returned).toBe(false);

      serial.emit("close");
      await disconnecting;
      expect(returned).toBe(true);
    });

    it("cancels reconnect backoff so no retry follows", async () => {
      await connect();
      dropConnection();
      await vi.advanceTimersByTimeAsync(1);
      expect(internals().reconnectTimers.size).toBe(1);
      expect(manager.getConnectionFacts(DEVICE_ID).phase).toBe("backoff");
      createTransport.mockClear();

      await manager.disconnect(DEVICE_ID);
      await vi.advanceTimersByTimeAsync(120_000);

      expect(internals().reconnectTimers.size).toBe(0);
      expect(createTransport).not.toHaveBeenCalled();
      expect(manager.getConnectionFacts(DEVICE_ID).phase).toBe("released");
      expect(statuses().at(-1)).toBe("disconnected");
    });

    it("cancels a reconnect while the dropped port is still closing", async () => {
      await connect();
      const closing = deferred();
      transports[0].disconnect.mockReturnValue(closing.promise);
      dropConnection();

      const disconnecting = manager.disconnect(DEVICE_ID);
      closing.resolve();
      await disconnecting;
      await vi.advanceTimersByTimeAsync(120_000);

      expect(createTransport).toHaveBeenCalledOnce();
      expect(internals().reconnectTimers.size).toBe(0);
    });

    it("an in-flight connect() does not end connected, start a watchdog, or keep the port", async () => {
      const configure = deferred<number>();
      nextConfigure.promise = configure.promise;
      const connecting = cancellableConnect();
      await vi.waitFor(() => expect(lastDevice()?.configure).toHaveBeenCalled());

      await manager.disconnect(DEVICE_ID);
      expect(await connecting).toBeInstanceOf(ConnectCancelledError);
      configure.resolve(0);
      await vi.advanceTimersByTimeAsync(1_000);

      expect(statuses()).not.toContain("connected");
      expect(statuses().at(-1)).toBe("disconnected");
      expect(internals().watchdogTimers.size).toBe(0);
      expect(lastDevice().setHeartbeatInterval).not.toHaveBeenCalled();
      expect(transports[0].disconnect).toHaveBeenCalledOnce();
      expect(manager.getDevice(DEVICE_ID)).toBeUndefined();
    });

    it("a disconnect during the port open closes the port before returning", async () => {
      const open = deferred<FakeTransport>();
      createTransport.mockReturnValueOnce(open.promise as never);
      const connecting = cancellableConnect();
      await vi.waitFor(() => expect(createTransport).toHaveBeenCalled());

      let returned = false;
      const disconnecting = manager.disconnect(DEVICE_ID).then(() => {
        returned = true;
      });
      await vi.advanceTimersByTimeAsync(10);
      expect(returned).toBe(false);

      const transport = makeTransport();
      open.resolve(transport);
      await disconnecting;

      expect(transport.disconnect).toHaveBeenCalledOnce();
      expect(await connecting).toBeInstanceOf(ConnectCancelledError);
      expect(meshDevices).toHaveLength(0);
      expect(statuses().at(-1)).toBe("disconnected");
    });

    it("a failed open after a disconnect does not report an error", async () => {
      const open = deferred<FakeTransport>();
      createTransport.mockReturnValueOnce(open.promise as never);
      const connecting = cancellableConnect();
      await vi.waitFor(() => expect(createTransport).toHaveBeenCalled());

      const disconnecting = manager.disconnect(DEVICE_ID);
      open.reject(new Error("Cannot lock port"));
      await disconnecting;

      expect(await connecting).toBeInstanceOf(ConnectCancelledError);
      expect(statuses()).not.toContain("error");
    });

    it("cancels a connect that has not resolved its saved row yet", async () => {
      const connecting = settled(manager.connect(PORT, NAME));
      await manager.disconnect(DEVICE_ID);

      expect(await connecting).toBeInstanceOf(ConnectCancelledError);
      expect(createTransport).not.toHaveBeenCalled();
    });

    it("a reconnect-timer connect cancelled by disconnect does not retry", async () => {
      await connect();
      nextConfigure.promise = new Promise(() => {});
      dropConnection();
      await vi.advanceTimersByTimeAsync(5_000);
      await vi.waitFor(() => expect(meshDevices).toHaveLength(2));
      await vi.waitFor(() => expect(lastDevice().configure).toHaveBeenCalled());

      await manager.disconnect(DEVICE_ID);
      await vi.advanceTimersByTimeAsync(120_000);

      expect(createTransport).toHaveBeenCalledTimes(2);
      expect(manager.getDevice(DEVICE_ID)).toBeUndefined();
      expect(internals().reconnectTimers.size).toBe(0);
    });

    it("does nothing for a device with no connection, timer, or attempt", async () => {
      await manager.disconnect(DEVICE_ID);
      expect(events).toHaveLength(0);
    });
  });

  describe("a stale connect", () => {
    it("cannot act on the newer connection that replaced it", async () => {
      const firstConfigure = deferred<number>();
      nextConfigure.promise = firstConfigure.promise;
      const first = cancellableConnect();
      await vi.waitFor(() => expect(lastDevice()?.configure).toHaveBeenCalled());
      const firstDevice = lastDevice();

      dropConnection(firstDevice);
      await vi.advanceTimersByTimeAsync(1);
      expect(await first).toBeInstanceOf(ConnectCancelledError);

      await vi.advanceTimersByTimeAsync(5_000);
      await vi.waitFor(() => expect(manager.getDevice(DEVICE_ID)).toBeDefined());
      await vi.waitFor(() => expect(internals().watchdogTimers.size).toBe(1));
      const current = manager.getDevice(DEVICE_ID);
      const watchdog = internals().watchdogTimers.get(DEVICE_ID);

      firstConfigure.resolve(0);
      await vi.advanceTimersByTimeAsync(10);

      expect(manager.getDevice(DEVICE_ID)).toBe(current);
      expect(internals().watchdogTimers.get(DEVICE_ID)).toBe(watchdog);
      expect(firstDevice.setHeartbeatInterval).not.toHaveBeenCalled();
    });
  });

  describe("reconnect", () => {
    it("returns at once and connects on the saved port", async () => {
      await connect();
      await manager.disconnect(DEVICE_ID);
      createTransport.mockClear();

      manager.reconnect(DEVICE_ID, PORT, NAME);
      await vi.waitFor(() => expect(internals().watchdogTimers.size).toBe(1));

      expect(createTransport).toHaveBeenCalledExactlyOnceWith(PORT, 115200);
      expect(statuses().at(-1)).toBe("connected");
    });

    it("replaces a pending backoff timer rather than racing it", async () => {
      await connect();
      dropConnection();
      await vi.advanceTimersByTimeAsync(1);
      createTransport.mockClear();

      manager.reconnect(DEVICE_ID, PORT, NAME);
      await vi.waitFor(() => expect(internals().watchdogTimers.size).toBe(1));
      await vi.advanceTimersByTimeAsync(120_000);

      expect(createTransport).toHaveBeenCalledOnce();
    });

    it("does not start a second connect while one is running", async () => {
      const open = deferred<FakeTransport>();
      createTransport.mockReturnValueOnce(open.promise as never);
      const connecting = cancellableConnect();
      await vi.waitFor(() => expect(createTransport).toHaveBeenCalled());

      manager.reconnect(DEVICE_ID, PORT, NAME);
      await vi.advanceTimersByTimeAsync(10);
      expect(createTransport).toHaveBeenCalledOnce();

      open.resolve(makeTransport());
      await connecting;
    });

    it("falls back to backoff if the port cannot be opened", async () => {
      createTransport.mockRejectedValueOnce(new Error("no such port"));

      manager.reconnect(DEVICE_ID, PORT, NAME);
      await vi.waitFor(() => expect(internals().reconnectTimers.size).toBe(1));

      expect(statuses().slice(-2)).toEqual(["error", "disconnected"]);
    });
  });

  describe("raw probe", () => {
    it("restores a held connection without waiting for it", async () => {
      await connect();
      nextConfigure.promise = new Promise(() => {});

      const result = await manager.rawProbe(DEVICE_ID, PORT, NAME);

      expect(result).toEqual({ ...noResponse, reconnecting: true });
      expect(transports[0].disconnect).toHaveBeenCalledOnce();
      expect(manager.getConnectionFacts(DEVICE_ID).phase).toBe("connecting");
      await vi.waitFor(() => expect(createTransport).toHaveBeenCalledTimes(2));
    });

    it("releases the port before opening it", async () => {
      await connect();
      probeRunner.mockImplementationOnce(async () => {
        expect(transports[0].disconnect).toHaveBeenCalledOnce();
        expect(manager.getConnectionFacts(DEVICE_ID).portHeld).toBe(false);
        return noResponse;
      });

      await manager.rawProbe(DEVICE_ID, PORT, NAME);
      expect(probeRunner).toHaveBeenCalledExactlyOnceWith(PORT, expect.any(AbortSignal));
    });

    it("restores backoff by reconnecting", async () => {
      await connect();
      dropConnection();
      await vi.advanceTimersByTimeAsync(1);
      createTransport.mockClear();

      const result = await manager.rawProbe(DEVICE_ID, PORT, NAME);

      expect(result.reconnecting).toBe(true);
      expect(internals().reconnectTimers.size).toBe(0);
      await vi.waitFor(() => expect(createTransport).toHaveBeenCalledOnce());
    });

    it("leaves a released device released", async () => {
      const result = await manager.rawProbe(DEVICE_ID, PORT, NAME);

      expect(result.reconnecting).toBe(false);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(createTransport).not.toHaveBeenCalled();
    });

    it("reconnects after any outcome, including open-failed", async () => {
      await connect();
      probeRunner.mockResolvedValueOnce({ ...noResponse, outcome: "open-failed" });

      const result = await manager.rawProbe(DEVICE_ID, PORT, NAME);

      expect(result).toMatchObject({ outcome: "open-failed", reconnecting: true });
    });

    it("does not reconnect after a disconnect arrives during the probe", async () => {
      await connect();
      const reading = deferred<RawProbeReading>();
      let signal: AbortSignal | undefined;
      probeRunner.mockImplementationOnce((_port, abortSignal) => {
        signal = abortSignal;
        return reading.promise;
      });

      const probing = settled(manager.rawProbe(DEVICE_ID, PORT, NAME));
      await vi.waitFor(() => expect(signal).toBeDefined());
      const disconnecting = manager.disconnect(DEVICE_ID);
      expect(signal?.aborted).toBe(true);
      reading.resolve(noResponse);

      expect(await probing).toBeInstanceOf(ProbeInterruptedError);
      await disconnecting;
      createTransport.mockClear();
      await vi.advanceTimersByTimeAsync(120_000);
      expect(createTransport).not.toHaveBeenCalled();
    });

    it("on shutdown the probe stops and no reconnect starts", async () => {
      await connect();
      const reading = deferred<RawProbeReading>();
      let signal: AbortSignal | undefined;
      probeRunner.mockImplementationOnce((_port, abortSignal) => {
        signal = abortSignal;
        abortSignal.addEventListener("abort", () => reading.resolve(noResponse));
        return reading.promise;
      });

      const probing = settled(manager.rawProbe(DEVICE_ID, PORT, NAME));
      await vi.waitFor(() => expect(signal).toBeDefined());
      createTransport.mockClear();
      await manager.shutdown();

      expect(await probing).toBeInstanceOf(ProbeInterruptedError);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(createTransport).not.toHaveBeenCalled();
    });

    it("does not start the probe when shutdown wins the race for the port", async () => {
      await connect();
      const closing = deferred();
      transports[0].disconnect.mockReturnValue(closing.promise);

      const probing = settled(manager.rawProbe(DEVICE_ID, PORT, NAME));
      const shuttingDown = manager.shutdown();
      closing.resolve();

      expect(await probing).toBeInstanceOf(ProbeInterruptedError);
      await shuttingDown;
      expect(probeRunner).not.toHaveBeenCalled();
    });
  });

  it("shutdown cancels an in-flight connect", async () => {
    nextConfigure.promise = new Promise(() => {});
    const connecting = cancellableConnect();
    await vi.waitFor(() => expect(lastDevice()?.configure).toHaveBeenCalled());

    await manager.shutdown();

    expect(await connecting).toBeInstanceOf(ConnectCancelledError);
    expect(internals().connectAttempts.size).toBe(0);
    expect(statuses()).not.toContain("connected");
  });
});
