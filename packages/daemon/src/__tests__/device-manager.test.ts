/**
 * DeviceManager unit tests
 *
 * All serial I/O is mocked — TransportNodeSerial.create() returns a fake
 * transport, and new MeshDevice() returns a controllable fake with event
 * dispatchers we can call directly.  The database is a real PGlite in-memory
 * instance with the full migration schema applied.
 *
 * Key vitest constraints observed here:
 *  - Variables referenced inside vi.mock factories MUST come from vi.hoisted().
 *  - MeshDevice must be mocked as a class (not an arrow function) so that
 *    `new MeshDevice()` works without "is not a constructor" errors.
 */

import { PGlite } from "@electric-sql/pglite";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { runMigrations } from "../db/migrations.js";
import { DeviceManager } from "../device/device-manager.js";

import type { ServerEvent } from "@foreman/shared";

// ---------------------------------------------------------------------------
// vi.hoisted — runs before everything, including vi.mock factories.
// All shared state that the mock factory needs must live here.
// ---------------------------------------------------------------------------

const { mockDevice, makeDispatcher } = vi.hoisted(() => {
  /** A minimal synchronous event bus that mirrors the ste-simple-events API. */
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
    /** Holds a reference to the most recently constructed fake MeshDevice. */
    mockDevice: { ref: null as Record<string, unknown> | null },
    makeDispatcher,
  };
});

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock("@meshtastic/transport-node-serial", () => ({
  TransportNodeSerial: {
    create: vi.fn().mockResolvedValue({
      disconnect: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("@meshtastic/core", async (importOriginal) => {
  // Keep the real Types and Protobuf so DeviceStatusEnum and PortNum work.
  const actual = await importOriginal<typeof import("@meshtastic/core")>();
  return {
    ...actual,
    // Must be a class (not an arrow function) so `new MeshDevice()` succeeds.
    MeshDevice: class MockMeshDevice {
      configure = vi.fn().mockResolvedValue(0);
      sendText = vi.fn().mockResolvedValue(42);
      setHeartbeatInterval = vi.fn();
      events = {
        onMessagePacket: makeDispatcher(),
        onMeshPacket: makeDispatcher(),
        onNodeInfoPacket: makeDispatcher(),
        onPositionPacket: makeDispatcher(),
        onDeviceStatus: makeDispatcher(),
        onFromRadio: makeDispatcher(),
        onQueueStatus: makeDispatcher(),
        onTraceRoutePacket: makeDispatcher(),
        onDeviceMetadataPacket: makeDispatcher(),
        onConfigPacket: makeDispatcher(),
        onModuleConfigPacket: makeDispatcher(),
        onChannelPacket: makeDispatcher(),
        onMyNodeInfo: makeDispatcher(),
        onTelemetryPacket: makeDispatcher(),
      };
      constructor() {
        // Capture `this` so tests can fire events and inspect methods.
        mockDevice.ref = this as unknown as Record<string, unknown>;
      }
    },
  };
});

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

async function createTestDb() {
  const db = new PGlite(); // in-memory — no disk I/O
  await runMigrations(db);
  return db;
}

async function seedDevice(
  db: PGlite,
  overrides: Partial<{ id: string; name: string; port: string }> = {},
) {
  const id = overrides.id ?? "00000000-0000-0000-0000-000000000001";
  const name = overrides.name ?? "Seeded Node";
  const port = overrides.port ?? "/dev/ttyUSB99";
  await db.query("INSERT INTO devices(id, name, port) VALUES ($1, $2, $3)", [id, name, port]);
  return { id, name, port };
}

function collectEvents(manager: DeviceManager) {
  const events: ServerEvent[] = [];
  manager.on("event", (e: ServerEvent) => events.push(e));
  return events;
}

/** Convenience — get the events sub-object from the most-recently created fake device. */
function getFakeEvents() {
  return mockDevice.ref!.events as ReturnType<typeof _makeFakeEvents>;
}

function _makeFakeEvents() {
  return {
    onMessagePacket: makeDispatcher(),
    onMeshPacket: makeDispatcher(),
    onNodeInfoPacket: makeDispatcher(),
    onPositionPacket: makeDispatcher(),
    onDeviceStatus: makeDispatcher(),
    onFromRadio: makeDispatcher(),
    onQueueStatus: makeDispatcher(),
    onTraceRoutePacket: makeDispatcher(),
    onDeviceMetadataPacket: makeDispatcher(),
    onConfigPacket: makeDispatcher(),
    onModuleConfigPacket: makeDispatcher(),
    onChannelPacket: makeDispatcher(),
    onMyNodeInfo: makeDispatcher(),
    onTelemetryPacket: makeDispatcher(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DeviceManager", () => {
  let db: PGlite;
  let manager: DeviceManager;
  let emitted: ServerEvent[];

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDevice.ref = null;
    db = await createTestDb();
    manager = new DeviceManager(db);
    emitted = collectEvents(manager);
  });

  // -------------------------------------------------------------------------
  describe("connect()", () => {
    it("upserts a device record in the database", async () => {
      await manager.connect("/dev/ttyUSB0", "Field Node");

      const { rows } = await db.query<{ name: string; port: string }>(
        "SELECT name, port FROM devices",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe("Field Node");
      expect(rows[0].port).toBe("/dev/ttyUSB0");
    });

    it("emits device:status connecting then connected", async () => {
      await manager.connect("/dev/ttyUSB0", "Field Node");

      const statusEvents = emitted.filter((e) => e.type === "device:status");
      expect(statusEvents).toHaveLength(2);
      expect(statusEvents[0].payload).toMatchObject({ status: "connecting" });
      expect(statusEvents[1].payload).toMatchObject({
        status: "connected",
        name: "Field Node",
        port: "/dev/ttyUSB0",
      });
    });

    it("calls configure() on the MeshDevice", async () => {
      await manager.connect("/dev/ttyUSB0", "Field Node");
      const configure = mockDevice.ref!.configure as ReturnType<typeof vi.fn>;
      expect(configure).toHaveBeenCalledOnce();
    });

    it("returns a ConnectedDevice with correct fields", async () => {
      const device = await manager.connect("/dev/ttyUSB0", "Field Node");
      expect(device.port).toBe("/dev/ttyUSB0");
      expect(device.name).toBe("Field Node");
      expect(device.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
      expect(device.connectedAt).toBeDefined();
    });

    it("is idempotent — second connect to same port returns existing device", async () => {
      const a = await manager.connect("/dev/ttyUSB0", "Node A");
      const b = await manager.connect("/dev/ttyUSB0", "Node A");
      expect(b.id).toBe(a.id);

      const { rows } = await db.query("SELECT id FROM devices");
      expect(rows).toHaveLength(1);
    });

    it("uses the provided existingId when reconnecting a saved device", async () => {
      const existingId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
      const device = await manager.connect("/dev/ttyUSB0", "Saved Node", existingId);
      expect(device.id).toBe(existingId);
    });
  });

  // -------------------------------------------------------------------------
  describe("disconnect()", () => {
    it("calls transport.disconnect()", async () => {
      const device = await manager.connect("/dev/ttyUSB0", "Node");
      await manager.disconnect(device.id);
      expect(device.transport.disconnect).toHaveBeenCalledOnce();
    });

    it("emits device:status disconnected", async () => {
      const device = await manager.connect("/dev/ttyUSB0", "Node");
      emitted.length = 0;
      await manager.disconnect(device.id);

      const statusEvents = emitted.filter((e) => e.type === "device:status");
      expect(statusEvents).toHaveLength(1);
      expect(statusEvents[0].payload).toMatchObject({ status: "disconnected" });
    });

    it("is a no-op for an unknown id", async () => {
      await expect(
        manager.disconnect("00000000-0000-0000-0000-000000000000"),
      ).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  describe("listDevices()", () => {
    it("returns empty array when nothing is connected", async () => {
      expect(await manager.listDevices()).toHaveLength(0);
    });

    it("returns device after connect", async () => {
      await manager.connect("/dev/ttyUSB0", "My Node");
      const list = await manager.listDevices();
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe("My Node");
    });

    it("returns all devices when multiple are connected", async () => {
      await manager.connect("/dev/ttyUSB0", "Node A");
      await manager.connect("/dev/ttyUSB1", "Node B");
      expect(await manager.listDevices()).toHaveLength(2);
    });
  });

  // -------------------------------------------------------------------------
  describe("reconnectSaved()", () => {
    it("reconnects devices stored in the database", async () => {
      const { id, port, name } = await seedDevice(db);
      await manager.reconnectSaved();

      const connected = manager.getDevice(id);
      expect(connected).toBeDefined();
      expect(connected!.port).toBe(port);
      expect(connected!.name).toBe(name);
    });

    it("survives a failing port gracefully", async () => {
      const { TransportNodeSerial } = await import("@meshtastic/transport-node-serial");
      (TransportNodeSerial.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("port not found"),
      );

      await seedDevice(db, { port: "/dev/ghost" });
      // Should resolve without throwing
      await expect(manager.reconnectSaved()).resolves.toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  describe("message handling (onMessagePacket)", () => {
    function dispatchMessage(overrides: Record<string, unknown> = {}) {
      getFakeEvents().onMessagePacket.dispatch({
        id: 100,
        rxTime: new Date("2025-01-15T12:00:00Z"),
        from: 111,
        to: 222,
        channel: 0,
        data: "Hello mesh",
        type: "broadcast",
        ...overrides,
      });
    }

    it("writes the message to the messages table", async () => {
      await manager.connect("/dev/ttyUSB0", "Node");
      dispatchMessage();
      await new Promise((r) => setTimeout(r, 20));

      const { rows } = await db.query<{ text: string; from_node_id: number }>(
        "SELECT text, from_node_id FROM messages",
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].text).toBe("Hello mesh");
      expect(rows[0].from_node_id).toBe(111);
    });

    it("emits message:received event", async () => {
      await manager.connect("/dev/ttyUSB0", "Node");
      emitted.length = 0;
      dispatchMessage({ id: 200, from: 333, to: 4294967295, channel: 1, data: "Broadcast!" });
      await new Promise((r) => setTimeout(r, 20));

      const msgEvents = emitted.filter((e) => e.type === "message:received");
      expect(msgEvents).toHaveLength(1);
      expect(msgEvents[0].payload).toMatchObject({
        fromNodeId: 333,
        toNodeId: 4294967295,
        channelIndex: 1,
        text: "Broadcast!",
      });
    });

    it("updates last_seen on the device", async () => {
      const connected = await manager.connect("/dev/ttyUSB0", "Node");
      dispatchMessage({ rxTime: new Date("2025-06-01T08:00:00Z") });
      await new Promise((r) => setTimeout(r, 20));

      const { rows } = await db.query<{ last_seen: string }>(
        "SELECT last_seen FROM devices WHERE id = $1",
        [connected.id],
      );
      expect(rows[0].last_seen).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe("raw packet handling (onMeshPacket)", () => {
    function makeDecodedPacket(overrides: Record<string, unknown> = {}) {
      return {
        id: 9999,
        from: 1,
        to: 2,
        channel: 0,
        rxTime: Math.trunc(new Date("2025-03-01T10:00:00Z").getTime() / 1000),
        wantAck: false,
        viaMqtt: false,
        payloadVariant: {
          case: "decoded",
          value: { portnum: 1, payload: new TextEncoder().encode("hi") },
        },
        ...overrides,
      };
    }

    it("writes the packet to the packets table", async () => {
      await manager.connect("/dev/ttyUSB0", "Node");
      getFakeEvents().onMeshPacket.dispatch(makeDecodedPacket());
      await new Promise((r) => setTimeout(r, 20));

      const { rows } = await db.query<{
        from_node_id: number;
        portnum: number;
        portnum_name: string;
      }>("SELECT from_node_id, portnum, portnum_name FROM packets");
      expect(rows).toHaveLength(1);
      expect(rows[0].from_node_id).toBe(1);
      expect(rows[0].portnum).toBe(1);
      expect(rows[0].portnum_name).toBe("TEXT_MESSAGE_APP");
    });

    it("computes rxTime from packet unix-seconds field", async () => {
      await manager.connect("/dev/ttyUSB0", "Node");
      const epochSeconds = Math.trunc(new Date("2025-03-01T10:00:00Z").getTime() / 1000);
      getFakeEvents().onMeshPacket.dispatch(makeDecodedPacket({ rxTime: epochSeconds }));
      await new Promise((r) => setTimeout(r, 20));

      const { rows } = await db.query<{ rx_time: string }>("SELECT rx_time FROM packets");
      expect(rows).toHaveLength(1);
      expect(new Date(rows[0].rx_time).getFullYear()).toBe(2025);
    });

    it("stores payload as base64", async () => {
      await manager.connect("/dev/ttyUSB0", "Node");
      const payload = new TextEncoder().encode("test");
      getFakeEvents().onMeshPacket.dispatch(
        makeDecodedPacket({
          payloadVariant: { case: "decoded", value: { portnum: 1, payload } },
        }),
      );
      await new Promise((r) => setTimeout(r, 20));

      const { rows } = await db.query<{ payload_raw: string }>("SELECT payload_raw FROM packets");
      expect(rows[0].payload_raw).toBe(Buffer.from(payload).toString("base64"));
    });

    it("emits packet:raw event", async () => {
      await manager.connect("/dev/ttyUSB0", "Node");
      emitted.length = 0;
      getFakeEvents().onMeshPacket.dispatch(makeDecodedPacket({ id: 5555, from: 77 }));
      await new Promise((r) => setTimeout(r, 20));

      const rawEvents = emitted.filter((e) => e.type === "packet:raw");
      expect(rawEvents).toHaveLength(1);
      expect(rawEvents[0].payload).toMatchObject({
        packetId: 5555,
        fromNodeId: 77,
        portnum: 1,
        portnumName: "TEXT_MESSAGE_APP",
      });
    });

    it("handles encrypted packets — portnum=0, payload in encrypted branch", async () => {
      await manager.connect("/dev/ttyUSB0", "Node");
      getFakeEvents().onMeshPacket.dispatch({
        id: 1,
        from: 1,
        to: 2,
        channel: 0,
        rxTime: Math.trunc(Date.now() / 1000),
        payloadVariant: {
          case: "encrypted",
          value: new Uint8Array([0xde, 0xad, 0xbe, 0xef]),
        },
      });
      await new Promise((r) => setTimeout(r, 20));

      const { rows } = await db.query<{ portnum: number; payload_raw: string }>(
        "SELECT portnum, payload_raw FROM packets",
      );
      expect(rows[0].portnum).toBe(0);
      expect(rows[0].payload_raw).toBe("3q2+7w=="); // base64 of 0xdeadbeef
    });
  });

  // -------------------------------------------------------------------------
  describe("node info handling (onNodeInfoPacket)", () => {
    function makeNodeInfo(overrides: Record<string, unknown> = {}) {
      return {
        num: 12345,
        lastHeard: Math.trunc(new Date("2025-01-01T00:00:00Z").getTime() / 1000),
        snr: 5.5,
        hopsAway: 2,
        user: {
          longName: "Field Node Alpha",
          shortName: "FNA",
          macaddr: new Uint8Array([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]),
          hwModel: 43,
          publicKey: new Uint8Array([0xab, 0xcd]),
        },
        position: {
          latitudeI: 376766660, // 37.6766660°
          longitudeI: -1220000000, // -122.0°
          altitude: 50,
        },
        ...overrides,
      };
    }

    it("upserts node into nodes table", async () => {
      const connected = await manager.connect("/dev/ttyUSB0", "Node");
      getFakeEvents().onNodeInfoPacket.dispatch(makeNodeInfo());
      await new Promise((r) => setTimeout(r, 20));

      const { rows } = await db.query<{
        node_id: number;
        long_name: string;
        device_id: string;
      }>("SELECT node_id, long_name, device_id FROM nodes");
      expect(rows).toHaveLength(1);
      expect(rows[0].node_id).toBe(12345);
      expect(rows[0].long_name).toBe("Field Node Alpha");
      expect(rows[0].device_id).toBe(connected.id);
    });

    it("converts latitudeI / longitudeI to decimal degrees", async () => {
      await manager.connect("/dev/ttyUSB0", "Node");
      getFakeEvents().onNodeInfoPacket.dispatch(makeNodeInfo());
      await new Promise((r) => setTimeout(r, 20));

      const { rows } = await db.query<{ latitude: number; longitude: number }>(
        "SELECT latitude, longitude FROM nodes",
      );
      expect(rows[0].latitude).toBeCloseTo(37.676666, 4);
      expect(rows[0].longitude).toBeCloseTo(-122.0, 4);
    });

    it("formats MAC address as colon-separated hex", async () => {
      await manager.connect("/dev/ttyUSB0", "Node");
      getFakeEvents().onNodeInfoPacket.dispatch(makeNodeInfo());
      await new Promise((r) => setTimeout(r, 20));

      const { rows } = await db.query<{ mac_address: string }>("SELECT mac_address FROM nodes");
      expect(rows[0].mac_address).toBe("01:02:03:04:05:06");
    });

    it("emits node:update event with correct fields", async () => {
      await manager.connect("/dev/ttyUSB0", "Node");
      emitted.length = 0;
      getFakeEvents().onNodeInfoPacket.dispatch(makeNodeInfo());
      await new Promise((r) => setTimeout(r, 20));

      const nodeEvents = emitted.filter((e) => e.type === "node:update");
      expect(nodeEvents).toHaveLength(1);
      expect(nodeEvents[0].payload).toMatchObject({
        nodeId: 12345,
        longName: "Field Node Alpha",
        shortName: "FNA",
        snr: 5.5,
        hopsAway: 2,
      });
    });

    it("UPSERT: second update with partial data does not overwrite existing fields", async () => {
      await manager.connect("/dev/ttyUSB0", "Node");
      getFakeEvents().onNodeInfoPacket.dispatch(makeNodeInfo());
      await new Promise((r) => setTimeout(r, 20));

      // Second dispatch — only snr, no user
      getFakeEvents().onNodeInfoPacket.dispatch({ num: 12345, snr: 8.0 });
      await new Promise((r) => setTimeout(r, 20));

      const { rows } = await db.query<{ long_name: string; snr: number }>(
        "SELECT long_name, snr FROM nodes WHERE node_id = 12345",
      );
      expect(rows[0].long_name).toBe("Field Node Alpha"); // preserved by COALESCE
      expect(rows[0].snr).toBeCloseTo(8.0);
    });

    it("nodes are keyed by (node_id, device_id) — same node_id on two devices stays separate", async () => {
      const devA = await manager.connect("/dev/ttyUSB0", "Device A");
      const eventsA = getFakeEvents();

      await manager.connect("/dev/ttyUSB1", "Device B");
      const eventsB = getFakeEvents();

      eventsA.onNodeInfoPacket.dispatch(makeNodeInfo({ num: 1 }));
      eventsB.onNodeInfoPacket.dispatch(makeNodeInfo({ num: 1 }));
      await new Promise((r) => setTimeout(r, 20));

      const { rows } = await db.query<{ device_id: string }>(
        "SELECT device_id FROM nodes WHERE node_id = 1",
      );
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.device_id)).toContain(devA.id);
    });
  });

  // -------------------------------------------------------------------------
  describe("metadata handling (onDeviceMetadataPacket)", () => {
    it("updates hw_model and firmware in devices table", async () => {
      const connected = await manager.connect("/dev/ttyUSB0", "Node");
      getFakeEvents().onDeviceMetadataPacket.dispatch({
        data: { firmwareVersion: "2.3.14", hwModel: 10 },
      });
      await new Promise((r) => setTimeout(r, 20));

      const { rows } = await db.query<{ hw_model: string; firmware: string }>(
        "SELECT hw_model, firmware FROM devices WHERE id = $1",
        [connected.id],
      );
      expect(rows[0].hw_model).toBe("10");
      expect(rows[0].firmware).toBe("2.3.14");
    });

    it("re-emits device:status with updated hardware fields", async () => {
      await manager.connect("/dev/ttyUSB0", "Node");
      emitted.length = 0;
      getFakeEvents().onDeviceMetadataPacket.dispatch({
        data: { firmwareVersion: "2.3.14", hwModel: 10 },
      });
      await new Promise((r) => setTimeout(r, 20));

      const statusEvents = emitted.filter((e) => e.type === "device:status");
      expect(statusEvents).toHaveLength(1);
      expect(statusEvents[0].payload).toMatchObject({
        status: "connected",
        firmwareVersion: "2.3.14",
        hardwareModel: "10",
      });
    });
  });

  // -------------------------------------------------------------------------
  describe("auto-reconnect on device disconnect", () => {
    it("emits device:status disconnected when the device reports disconnect", async () => {
      const { Types } = await import("@meshtastic/core");
      await manager.connect("/dev/ttyUSB0", "Node");
      emitted.length = 0;

      getFakeEvents().onDeviceStatus.dispatch(Types.DeviceStatusEnum.DeviceDisconnected);

      const statusEvents = emitted.filter((e) => e.type === "device:status");
      expect(statusEvents).toHaveLength(1);
      expect(statusEvents[0].payload).toMatchObject({ status: "disconnected" });
    });

    it("schedules a reconnect attempt after 5 seconds", async () => {
      const { Types } = await import("@meshtastic/core");
      const { TransportNodeSerial } = await import("@meshtastic/transport-node-serial");

      vi.useFakeTimers();
      try {
        await manager.connect("/dev/ttyUSB0", "Node");
        getFakeEvents().onDeviceStatus.dispatch(Types.DeviceStatusEnum.DeviceDisconnected);

        // Before timer fires: 1 call (initial connect)
        expect(TransportNodeSerial.create as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(1);

        await vi.runAllTimersAsync();

        // After 5s timer: 1 more call for the reconnect
        expect(TransportNodeSerial.create as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does not stack multiple reconnect timers on rapid disconnect events", async () => {
      const { Types } = await import("@meshtastic/core");
      const { TransportNodeSerial } = await import("@meshtastic/transport-node-serial");

      vi.useFakeTimers();
      try {
        await manager.connect("/dev/ttyUSB0", "Node");
        const fakeEvents = getFakeEvents();

        // Two rapid disconnects
        fakeEvents.onDeviceStatus.dispatch(Types.DeviceStatusEnum.DeviceDisconnected);
        fakeEvents.onDeviceStatus.dispatch(Types.DeviceStatusEnum.DeviceDisconnected);

        await vi.runAllTimersAsync();

        // Only 1 initial + 1 reconnect (not 1 + 2)
        expect(TransportNodeSerial.create as ReturnType<typeof vi.fn>).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  // -------------------------------------------------------------------------
  describe("getMessageHistory()", () => {
    async function seedMessage(
      deviceId: string,
      overrides: {
        channelIndex?: number;
        toNodeId?: number;
        rxTime?: string;
        text?: string;
      } = {},
    ) {
      const { randomUUID } = await import("node:crypto");
      const id = randomUUID();
      await db.query(
        `INSERT INTO messages(id, packet_id, device_id, from_node_id, to_node_id,
           channel_index, text, rx_time)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          1,
          deviceId,
          10,
          overrides.toNodeId ?? 4294967295,
          overrides.channelIndex ?? 0,
          overrides.text ?? "test",
          overrides.rxTime ?? "2025-01-01T00:00:00Z",
        ],
      );
      return id;
    }

    it("returns all messages for a device with no filters", async () => {
      const connected = await manager.connect("/dev/ttyUSB0", "Node");
      await seedMessage(connected.id, { text: "a" });
      await seedMessage(connected.id, { text: "b" });

      const history = await manager.getMessageHistory(connected.id, { limit: 100 });
      expect(history).toHaveLength(2);
    });

    it("filters by channelIndex", async () => {
      const connected = await manager.connect("/dev/ttyUSB0", "Node");
      await seedMessage(connected.id, { channelIndex: 0, text: "ch0" });
      await seedMessage(connected.id, { channelIndex: 1, text: "ch1" });

      const history = await manager.getMessageHistory(connected.id, {
        channelIndex: 1,
        limit: 100,
      });
      expect(history).toHaveLength(1);
      expect(history[0].text).toBe("ch1");
    });

    it("filters by toNodeId", async () => {
      const connected = await manager.connect("/dev/ttyUSB0", "Node");
      await seedMessage(connected.id, { toNodeId: 111, text: "to 111" });
      await seedMessage(connected.id, { toNodeId: 222, text: "to 222" });

      const history = await manager.getMessageHistory(connected.id, { toNodeId: 111, limit: 100 });
      expect(history).toHaveLength(1);
      expect(history[0].text).toBe("to 111");
    });

    it("filters by before timestamp", async () => {
      const connected = await manager.connect("/dev/ttyUSB0", "Node");
      await seedMessage(connected.id, { rxTime: "2025-01-01T09:00:00Z", text: "old" });
      await seedMessage(connected.id, { rxTime: "2025-01-01T11:00:00Z", text: "new" });

      const history = await manager.getMessageHistory(connected.id, {
        before: "2025-01-01T10:00:00Z",
        limit: 100,
      });
      expect(history).toHaveLength(1);
      expect(history[0].text).toBe("old");
    });

    it("respects the limit", async () => {
      const connected = await manager.connect("/dev/ttyUSB0", "Node");
      for (let i = 0; i < 5; i++) {
        await seedMessage(connected.id, { text: `msg ${i}` });
      }
      const history = await manager.getMessageHistory(connected.id, { limit: 3 });
      expect(history).toHaveLength(3);
    });

    it("does not return messages from a different device", async () => {
      const devA = await manager.connect("/dev/ttyUSB0", "Device A");
      const devB = await manager.connect("/dev/ttyUSB1", "Device B");
      await seedMessage(devA.id, { text: "device A message" });
      await seedMessage(devB.id, { text: "device B message" });

      const historyA = await manager.getMessageHistory(devA.id, { limit: 100 });
      expect(historyA).toHaveLength(1);
      expect(historyA[0].text).toBe("device A message");
    });

    it("returns empty array for device with no messages", async () => {
      const connected = await manager.connect("/dev/ttyUSB0", "Node");
      expect(await manager.getMessageHistory(connected.id, { limit: 100 })).toHaveLength(0);
    });
  });
});
