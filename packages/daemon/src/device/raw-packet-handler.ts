import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

/* eslint-disable @typescript-eslint/no-explicit-any -- TASK-024 preserves the untyped onMeshPacket boundary. */

import { fromBinary } from "@bufbuild/protobuf";
import { formatNodeId } from "@foreman/shared";
import { Protobuf } from "@meshtastic/core";

import { activityLog } from "../activity/log.js";
import { mapNodeRow, type NodeRow } from "../db/repositories/nodes.js";
import { decodePayload } from "../decode-payload.js";
import { createLogger } from "../logger.js";

import type { PGlite } from "@electric-sql/pglite";
import type { ServerEvent } from "@foreman/shared";

export interface RawPacketHandlerDeps {
  db: PGlite;
  emit: (event: ServerEvent) => void;
  pendingReplyIds: Map<number, number>;
  getMyNodeId: (deviceId: string) => number | undefined;
  setLastPacketMs: (deviceId: string, value: number) => void;
}
const log = createLogger("devices");

// Protobuf packet typing remains intentionally unchanged from DeviceManager.
export async function handleRawPacket(
  deps: RawPacketHandlerDeps,
  deviceId: string,
  meshPacket: any,
) {
  const p = meshPacket as any;
  const isDecoded = p.payloadVariant?.case === "decoded";
  const isEncrypted = p.payloadVariant?.case === "encrypted";
  const portnum: number = isDecoded ? (p.payloadVariant.value.portnum ?? 0) : 0;

  // This synchronous write must remain before every await. onMeshPacket fires before
  // the derived onMessagePacket, whose handler consumes this shared map entry once.
  const TEXT_MESSAGE_APP_PORT = 1;
  if (portnum === TEXT_MESSAGE_APP_PORT && isDecoded && (p.id ?? 0) !== 0) {
    deps.pendingReplyIds.set(p.id, p.replyId ?? 0);
  }

  const portnumName: string =
    (Protobuf.Portnums.PortNum as Record<number, string>)[portnum] ?? "UNKNOWN_APP";
  const rxTimeSec: number = p.rxTime ?? 0;
  const rxTime =
    rxTimeSec > 0 ? new Date(rxTimeSec * 1000).toISOString() : new Date().toISOString();

  let payloadRaw: string | null = null;
  let decodedJson: unknown = null;
  if (isDecoded && p.payloadVariant.value.payload instanceof Uint8Array) {
    const payloadBytes: Uint8Array = p.payloadVariant.value.payload;
    payloadRaw = Buffer.from(payloadBytes).toString("base64");
    decodedJson = decodePayload(portnumName, payloadBytes);
  } else if (isEncrypted && p.payloadVariant.value instanceof Uint8Array) {
    payloadRaw = Buffer.from(p.payloadVariant.value).toString("base64");
  }

  const fromNodeId: number = p.from ?? 0;
  const isMqttEcho = p.viaMqtt ?? false;
  deps.setLastPacketMs(deviceId, Date.now());
  log.info(
    {
      deviceId,
      packetId: p.id ?? 0,
      operation: "receive-raw-packet",
      fromNodeId: formatNodeId(fromNodeId),
      portnum: portnumName,
      viaMqtt: isMqttEcho,
    },
    "raw packet received",
  );
  if (fromNodeId !== 0) {
    activityLog.add({
      ts: rxTime,
      source: "mesh",
      portnum: portnumName,
      fromHex: formatNodeId(fromNodeId),
      region: null,
      gateway: null,
      viaMqtt: isMqttEcho,
    });

    await deps.db.query(
      `INSERT INTO nodes(node_id, device_id, last_heard)
       VALUES ($1, $2, $3)
       ON CONFLICT(node_id, device_id) DO UPDATE SET
         last_heard = GREATEST(EXCLUDED.last_heard, nodes.last_heard)`,
      [fromNodeId, deviceId, rxTime],
    );

    const { rows } = await deps.db.query<NodeRow>(
      `SELECT node_id, long_name, short_name, mac_address, hw_model, public_key,
              last_heard, snr, hops_away, latitude, longitude, altitude
       FROM nodes WHERE device_id = $1 AND node_id = $2`,
      [deviceId, fromNodeId],
    );
    if (rows[0]) {
      const node = mapNodeRow(rows[0]);
      deps.emit({
        type: "node:update",
        payload: {
          ...node,
          lastHeard: rxTime,
        },
      });
    }
  }

  const id = randomUUID();
  await deps.db.query(
    `INSERT INTO packets(id, packet_id, device_id, from_node_id, to_node_id, channel,
       portnum, portnum_name, rx_time, rx_snr, rx_rssi, hop_limit, hop_start,
       want_ack, via_mqtt, payload_raw, decoded_json)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb)`,
    [
      id,
      p.id ?? 0,
      deviceId,
      p.from ?? 0,
      p.to ?? 0,
      p.channel ?? 0,
      portnum,
      portnumName,
      rxTime,
      p.rxSnr || null,
      p.rxRssi || null,
      p.hopLimit || null,
      p.hopStart || null,
      p.wantAck ?? false,
      p.viaMqtt ?? false,
      payloadRaw,
      decodedJson !== null ? JSON.stringify(decodedJson) : null,
    ],
  );

  deps.emit({
    type: "packet:raw",
    payload: {
      id,
      packetId: p.id ?? 0,
      fromNodeId: p.from ?? 0,
      toNodeId: p.to ?? 0,
      channel: p.channel ?? 0,
      portnum,
      portnumName,
      rxTime,
      rxSnr: p.rxSnr || null,
      rxRssi: p.rxRssi || null,
      hopLimit: p.hopLimit || null,
      hopStart: p.hopStart || null,
      wantAck: p.wantAck ?? false,
      viaMqtt: p.viaMqtt ?? false,
      payloadRaw,
      decodedJson: null,
    },
  });

  const ROUTING_APP = 5;
  if (portnum === ROUTING_APP && isDecoded) {
    const requestId: number = p.payloadVariant?.value?.requestId ?? 0;
    const payload: Uint8Array | undefined = p.payloadVariant?.value?.payload;
    if (requestId !== 0 && payload?.length) {
      try {
        const routing = fromBinary(Protobuf.Mesh.RoutingSchema, payload);
        if (routing.variant.case === "errorReason") {
          const isAck = routing.variant.value === Protobuf.Mesh.Routing_Error.NONE;
          const ackAt = new Date().toISOString();
          const ackError = isAck
            ? null
            : ((Protobuf.Mesh.Routing_Error as Record<number, string>)[routing.variant.value] ??
              String(routing.variant.value));
          const { rows } = await deps.db.query<{ id: string }>(
            `UPDATE messages
             SET ack_status = $1, ack_at = $2, ack_error = $3
             WHERE packet_id = $4 AND device_id = $5 AND role = 'sent' AND ack_status = 'pending'
             RETURNING id`,
            [isAck ? "acked" : "error", ackAt, ackError, requestId, deviceId],
          );
          if (rows[0]) {
            deps.emit({
              type: "message:ack",
              payload: {
                messageId: rows[0].id,
                packetId: requestId,
                status: isAck ? "acked" : "error",
                ackAt,
                ackError,
              },
            });
            log.info(
              {
                deviceId,
                packetId: requestId,
                operation: "receive-ack",
                acknowledged: isAck,
                ackError,
              },
              "packet acknowledgement received",
            );
          }
        }
      } catch (err) {
        log.warn(
          { deviceId, packetId: p.id ?? 0, operation: "decode-routing-packet", err },
          "routing packet decode failed",
        );
      }
    }
  }

  const TEXT_MESSAGE_APP = 1;
  const BROADCAST = 0xffffffff;
  const myNodeId = deps.getMyNodeId(deviceId);
  const toNodeId: number = p.to ?? 0;
  if (
    portnum === TEXT_MESSAGE_APP &&
    isEncrypted &&
    fromNodeId !== 0 &&
    fromNodeId !== myNodeId &&
    toNodeId !== myNodeId &&
    toNodeId !== BROADCAST
  ) {
    await deps.db.query(
      `INSERT INTO messages(id, packet_id, device_id, from_node_id, to_node_id, channel_index,
         text, rx_time, rx_snr, rx_rssi, hop_limit, want_ack, via_mqtt, role, reply_to_packet_id)
       VALUES ($1, $2, $3, $4, $5, $6, NULL, $7, $8, $9, $10, $11, $12, 'relayed', $13)`,
      [
        randomUUID(),
        p.id ?? 0,
        deviceId,
        fromNodeId,
        toNodeId,
        p.channel ?? 0,
        rxTime,
        p.rxSnr || null,
        p.rxRssi || null,
        p.hopLimit || null,
        p.wantAck ?? false,
        p.viaMqtt ?? false,
        p.replyId ?? 0,
      ],
    );
  }
}
