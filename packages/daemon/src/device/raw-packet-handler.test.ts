import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runMigrations } from "../db/migrations.js";

import { handleRawPacket } from "./raw-packet-handler.js";

import type { ServerEvent } from "@foreman/shared";

const DEVICE_ID = "00000000-0000-4000-8000-000000000044";
const MY_NODE_ID = 100;
const BROADCAST = 0xffffffff;

describe("handleRawPacket relayed messages", () => {
  let db: PGlite;
  let emitted: ServerEvent[];

  beforeEach(async () => {
    db = new PGlite();
    await runMigrations(db);
    await db.query("INSERT INTO devices(id, name, port) VALUES ($1, $2, $3)", [
      DEVICE_ID,
      "Relay observer",
      "/dev/test-relay",
    ]);
    emitted = [];
  });

  afterEach(async () => {
    await db.close();
  });

  function decodedPacket(overrides: Record<string, unknown> = {}) {
    return {
      id: 4400,
      replyId: 4300,
      from: 200,
      to: 300,
      channel: 2,
      rxTime: Math.trunc(new Date("2026-08-26T12:00:00.000Z").getTime() / 1000),
      rxSnr: 4.25,
      rxRssi: -91,
      hopLimit: 3,
      wantAck: true,
      viaMqtt: false,
      payloadVariant: {
        case: "decoded",
        value: { portnum: 1, payload: new TextEncoder().encode("relayed hello") },
      },
      ...overrides,
    };
  }

  async function dispatch(packet: Record<string, unknown>) {
    await handleRawPacket(
      {
        db,
        emit: (event) => emitted.push(event),
        pendingReplyIds: new Map(),
        getMyNodeId: () => MY_NODE_ID,
        setLastPacketMs: vi.fn(),
      },
      DEVICE_ID,
      packet,
    );
  }

  it("persists and emits decoded text traffic between two other nodes as relayed", async () => {
    await dispatch(decodedPacket());

    const { rows } = await db.query<{
      id: string;
      packet_id: number;
      from_node_id: number;
      to_node_id: number;
      channel_index: number;
      text: string;
      rx_snr: number;
      rx_rssi: number;
      hop_limit: number;
      want_ack: boolean;
      via_mqtt: boolean;
      role: string;
      reply_to_packet_id: number;
    }>(
      `SELECT id, packet_id, from_node_id, to_node_id, channel_index, text, rx_snr,
              rx_rssi, hop_limit, want_ack, via_mqtt, role, reply_to_packet_id
       FROM messages WHERE role = 'relayed'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      packet_id: 4400,
      from_node_id: 200,
      to_node_id: 300,
      channel_index: 2,
      text: "relayed hello",
      rx_snr: 4.25,
      rx_rssi: -91,
      hop_limit: 3,
      want_ack: true,
      via_mqtt: false,
      role: "relayed",
      reply_to_packet_id: 4300,
    });

    const messageEvents = emitted.filter((event) => event.type === "message:received");
    expect(messageEvents).toHaveLength(1);
    expect(messageEvents[0].payload).toEqual({
      id: rows[0].id,
      packetId: 4400,
      fromNodeId: 200,
      toNodeId: 300,
      channelIndex: 2,
      text: "relayed hello",
      rxTime: "2026-08-26T12:00:00.000Z",
      rxSnr: 4.25,
      rxRssi: -91,
      hopLimit: 3,
      wantAck: true,
      viaMqtt: false,
      role: "relayed",
      ackStatus: null,
      ackAt: null,
      ackError: null,
      replyToPacketId: 4300,
    });
  });

  it("drops genuinely encrypted traffic from the messages domain", async () => {
    await dispatch({
      ...decodedPacket(),
      payloadVariant: {
        case: "encrypted",
        value: new Uint8Array([1, 2, 3, 4]),
      },
    });

    const { rows } = await db.query("SELECT id FROM messages");
    expect(rows).toHaveLength(0);
    expect(emitted.filter((event) => event.type === "message:received")).toHaveLength(0);
    expect(emitted.filter((event) => event.type === "packet:raw")).toHaveLength(1);
  });

  it.each([
    ["direct", MY_NODE_ID],
    ["broadcast", BROADCAST],
  ])("excludes decoded %s traffic from the relayed path", async (_label, toNodeId) => {
    await dispatch(decodedPacket({ to: toNodeId }));

    const { rows } = await db.query("SELECT id FROM messages");
    expect(rows).toHaveLength(0);
    expect(emitted.filter((event) => event.type === "message:received")).toHaveLength(0);
  });
});
