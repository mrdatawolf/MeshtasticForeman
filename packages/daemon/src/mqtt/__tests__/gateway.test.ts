import { Buffer } from "node:buffer";

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { Protobuf } from "@meshtastic/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MqttGateway } from "../gateway.js";

import type { PGlite } from "@electric-sql/pglite";

const { mqttClient, mqttConnect, handlers } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const mqttClient = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler);
      return mqttClient;
    }),
    subscribe: vi.fn(),
    publish: vi.fn(),
    end: vi.fn(),
  };
  return { mqttClient, mqttConnect: vi.fn(() => mqttClient), handlers };
});

vi.mock("mqtt", () => ({ default: { connect: mqttConnect } }));

interface GatewayInternals {
  client: typeof mqttClient | null;
  _connected: boolean;
  devices: Map<string, DeviceStateFixture>;
  _expandPsk(psk: Uint8Array): Buffer;
  _encrypt(key: Buffer, packetId: number, fromNode: number, plaintext: Buffer): Buffer;
  _decrypt(key: Buffer, packetId: number, fromNode: number, ciphertext: Buffer): Buffer;
  _handleInbound(topic: string, payload: Buffer): Promise<void>;
  _handleJsonInbound(
    payload: Buffer,
    channelName: string,
    gatewayId: string,
    regionPath: string,
  ): Promise<void>;
  _handleMeshPacket(deviceId: string, packet: unknown): Promise<void>;
  _upsertFromData: ReturnType<typeof vi.fn>;
}

interface DeviceStateFixture {
  nodeNum: number;
  gatewayId: string;
  channels: Map<number, { name: string; key: Buffer }>;
  cachedUser: null;
  cachedPosition: null;
  selfAnnounceTimer: null;
  announceScheduled: boolean;
  lastRelayAnnounceMs: number;
  lastDistanceRecalcMs: number;
}

const config = {
  broker: "test.invalid",
  port: 1883,
  username: "test-user",
  password: "test-password",
  rootTopic: "msh/US/CA/CentralCoast",
};

function makeGateway(rootTopic = config.rootTopic) {
  const gateway = new MqttGateway({ ...config, rootTopic }, {} as PGlite);
  return {
    gateway,
    internals: gateway as unknown as GatewayInternals,
  };
}

function makeState(key: Buffer): DeviceStateFixture {
  return {
    nodeNum: 0x12345678,
    gatewayId: "!12345678",
    channels: new Map([[0, { name: "TestChannel", key }]]),
    cachedUser: null,
    cachedPosition: null,
    selfAnnounceTimer: null,
    announceScheduled: false,
    lastRelayAnnounceMs: 0,
    lastDistanceRecalcMs: 0,
  };
}

function makeEnvelope(
  payloadVariant:
    { case: "decoded"; value: Protobuf.Mesh.Data } | { case: "encrypted"; value: Uint8Array },
) {
  const packet = create(Protobuf.Mesh.MeshPacketSchema, {
    from: 0x01020304,
    to: 0xffffffff,
    id: 0x11223344,
    rxTime: 1_700_000_000,
    channel: 0,
    payloadVariant,
  });
  return Buffer.from(
    toBinary(
      Protobuf.Mqtt.ServiceEnvelopeSchema,
      create(Protobuf.Mqtt.ServiceEnvelopeSchema, {
        packet,
        channelId: "TestChannel",
        gatewayId: "!aabbccdd",
      }),
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  handlers.clear();
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("MqttGateway crypto helpers", () => {
  it("expands sentinel, direct-length, padded, truncated, and all-zero PSKs", () => {
    const { internals } = makeGateway();
    expect(internals._expandPsk(Uint8Array.of(0x01)).toString("base64")).toBe(
      "1PG7OiApB1nwvP+rz05pAQ==",
    );

    // All remaining key bytes are synthetic test-only material.
    const sixteen = Uint8Array.from({ length: 16 }, (_, i) => i);
    const thirtyTwo = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    expect(internals._expandPsk(sixteen)).toEqual(Buffer.from(sixteen));
    expect(internals._expandPsk(thirtyTwo)).toEqual(Buffer.from(thirtyTwo));
    expect(internals._expandPsk(Uint8Array.of(2, 3, 4))).toEqual(
      Buffer.concat([Buffer.from([2, 3, 4]), Buffer.alloc(13)]),
    );
    expect(internals._expandPsk(Uint8Array.from({ length: 20 }, (_, i) => i + 1))).toEqual(
      Buffer.from(Array.from({ length: 16 }, (_, i) => i + 1)),
    );
    expect(internals._expandPsk(new Uint8Array(17)).toString("base64")).toBe(
      "1PG7OiApB1nwvP+rz05pAQ==",
    );
  });

  it("round-trips plaintext with AES-128-CTR", () => {
    const { internals } = makeGateway();
    // Synthetic counting-pattern key; never use production channel material in tests.
    const key = Buffer.from(Array.from({ length: 16 }, (_, i) => i));
    const plaintext = Buffer.from("round-trip test payload", "utf8");
    const ciphertext = internals._encrypt(key, 0x12345678, 0x90abcdef, plaintext);
    expect(internals._decrypt(key, 0x12345678, 0x90abcdef, ciphertext)).toEqual(plaintext);
  });

  it("matches a fixed AES-128-CTR known vector", () => {
    const { internals } = makeGateway();
    // Synthetic counting-pattern key; expected bytes were independently derived with Node crypto.
    const key = Buffer.from(Array.from({ length: 16 }, (_, i) => i));
    const ciphertext = internals._encrypt(
      key,
      0x12345678,
      0x90abcdef,
      Buffer.from("synthetic-vector", "utf8"),
    );
    expect(ciphertext.toString("hex")).toBe("bc9848bbb4088190e3018abe47a71209");
  });
});

describe("MqttGateway inbound handling", () => {
  it("parses encrypted topics and filters the missing-city double slash", async () => {
    const { internals } = makeGateway();
    const data = create(Protobuf.Mesh.DataSchema, {
      portnum: Protobuf.Portnums.PortNum.TEXT_MESSAGE_APP,
      payload: Buffer.from("inbound encrypted fixture"),
    });
    // Synthetic test-only key.
    const key = Buffer.from(Array.from({ length: 16 }, (_, i) => 15 - i));
    internals.devices.set("device-1", makeState(key));
    const encrypted = internals._encrypt(
      key,
      0x11223344,
      0x01020304,
      Buffer.from(toBinary(Protobuf.Mesh.DataSchema, data)),
    );
    internals._upsertFromData = vi.fn().mockResolvedValue(undefined);

    await internals._handleInbound(
      "msh/US/CA/CentralCoast//2/e/TestChannel/!aabbccdd",
      makeEnvelope({ case: "encrypted", value: encrypted }),
    );

    expect(internals._upsertFromData).toHaveBeenCalledOnce();
    expect(internals._upsertFromData.mock.calls[0].slice(0, 6)).toEqual([
      0x01020304,
      expect.objectContaining({ portnum: Protobuf.Portnums.PortNum.TEXT_MESSAGE_APP }),
      "2023-11-14T22:13:20.000Z",
      "!aabbccdd",
      "US/CA/CentralCoast",
      "TestChannel",
    ]);
  });

  it("normalizes an already-decoded inbound packet", async () => {
    const { internals } = makeGateway();
    const data = create(Protobuf.Mesh.DataSchema, {
      portnum: Protobuf.Portnums.PortNum.TEXT_MESSAGE_APP,
      payload: Buffer.from("decoded inbound fixture"),
    });
    internals._upsertFromData = vi.fn().mockResolvedValue(undefined);

    await internals._handleInbound(
      "msh/US/CA/2/e/TestChannel/!aabbccdd",
      makeEnvelope({ case: "decoded", value: data }),
    );

    expect(internals._upsertFromData).toHaveBeenCalledWith(
      0x01020304,
      expect.objectContaining({ portnum: Protobuf.Portnums.PortNum.TEXT_MESSAGE_APP }),
      "2023-11-14T22:13:20.000Z",
      "!aabbccdd",
      "US/CA",
      "TestChannel",
      0,
      0,
    );
  });

  it("parses JSON topic metadata before delegating", async () => {
    const { internals } = makeGateway();
    internals._handleJsonInbound = vi.fn().mockResolvedValue(undefined);
    const payload = Buffer.from('{"from":16909060,"type":"text"}');

    await internals._handleInbound(
      "msh/US/CA/Humboldt/Eureka/2/json/TestChannel/!aabbccdd",
      payload,
    );

    expect(internals._handleJsonInbound).toHaveBeenCalledWith(
      payload,
      "TestChannel",
      "!aabbccdd",
      "US/CA/Humboldt/Eureka",
    );
  });

  it("skips non-2/e topics without throwing", async () => {
    const { internals } = makeGateway();
    await expect(
      internals._handleInbound("msh/US/CA/2/map/TestChannel", Buffer.from([1, 2, 3])),
    ).resolves.toBeUndefined();
  });

  it("contains malformed encrypted protobuf and JSON payloads", async () => {
    const { internals } = makeGateway();
    await expect(
      internals._handleInbound(
        "msh/US/CA/2/e/TestChannel/!aabbccdd",
        Buffer.from([0xff, 0xff, 0xff]),
      ),
    ).resolves.toBeUndefined();
    await expect(
      internals._handleInbound(
        "msh/US/CA/2/json/TestChannel/!aabbccdd",
        Buffer.from("{not valid json"),
      ),
    ).resolves.toBeUndefined();
  });
});

describe("MqttGateway MQTT publication", () => {
  it('subscribes to "#" when rootTopic is "all"', () => {
    const { gateway } = makeGateway("all");
    gateway.start();
    handlers.get("connect")?.();
    expect(mqttClient.subscribe).toHaveBeenCalledWith("#", expect.any(Function));
    gateway.stop();
  });

  it("passes encrypted mesh bytes through and re-encrypts decoded mesh data", async () => {
    const { internals } = makeGateway();
    // Synthetic test-only key.
    const key = Buffer.from(Array.from({ length: 16 }, (_, i) => i + 32));
    internals.client = mqttClient;
    internals._connected = true;
    internals.devices.set("device-1", makeState(key));

    const passthrough = Uint8Array.of(9, 8, 7, 6);
    await internals._handleMeshPacket("device-1", {
      from: 0x01020304,
      to: 0xffffffff,
      id: 0x11223344,
      channel: 0,
      rxTime: 1_700_000_000,
      payloadVariant: { case: "encrypted", value: passthrough },
    });
    const firstEnvelope = fromBinary(
      Protobuf.Mqtt.ServiceEnvelopeSchema,
      mqttClient.publish.mock.calls[0][1] as Buffer,
    );
    expect(firstEnvelope.packet?.payloadVariant.case).toBe("encrypted");
    expect(Buffer.from(firstEnvelope.packet?.payloadVariant.value as Uint8Array)).toEqual(
      Buffer.from(passthrough),
    );

    const decoded = create(Protobuf.Mesh.DataSchema, {
      portnum: Protobuf.Portnums.PortNum.TEXT_MESSAGE_APP,
      payload: Buffer.from("outbound decoded fixture"),
    });
    await internals._handleMeshPacket("device-1", {
      from: 0x01020304,
      to: 0xffffffff,
      id: 0x11223344,
      channel: 0,
      rxTime: 1_700_000_000,
      payloadVariant: { case: "decoded", value: decoded },
    });
    const secondEnvelope = fromBinary(
      Protobuf.Mqtt.ServiceEnvelopeSchema,
      mqttClient.publish.mock.calls[1][1] as Buffer,
    );
    const expected = internals._encrypt(
      key,
      0x11223344,
      0x01020304,
      Buffer.from(toBinary(Protobuf.Mesh.DataSchema, decoded)),
    );
    expect(secondEnvelope.packet?.payloadVariant.case).toBe("encrypted");
    expect(Buffer.from(secondEnvelope.packet?.payloadVariant.value as Uint8Array)).toEqual(
      expected,
    );
    expect(mqttClient.publish).toHaveBeenNthCalledWith(
      2,
      "msh/US/CA/CentralCoast/2/e/TestChannel/!12345678",
      expect.any(Buffer),
    );
  });
});

describe("MqttGateway shutdown", () => {
  it("reuses stop and contains teardown errors", async () => {
    const { gateway } = makeGateway();
    const stop = vi.spyOn(gateway, "stop").mockImplementation(() => {
      throw new Error("transport failed");
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(gateway.shutdown()).resolves.toBeUndefined();

    expect(stop).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(
      '[mqtt] gateway shutdown failed {"operation":"shutdown","err":{"name":"Error"}}',
    );
    error.mockRestore();
  });
});
