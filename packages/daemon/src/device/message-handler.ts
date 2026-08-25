import { randomUUID } from "node:crypto";

import { formatNodeId } from "@foreman/shared";
import { Types } from "@meshtastic/core";

import type { PGlite } from "@electric-sql/pglite";
import type { ServerEvent } from "@foreman/shared";
import type { MeshDevice } from "@meshtastic/core";

export interface MessageHandlerDeps {
  db: PGlite;
  emit: (event: ServerEvent) => void;
  botEnabled: boolean;
  pendingReplyIds: Map<number, number>;
  getMeshDevice: (deviceId: string) => MeshDevice | undefined;
  getMyNodeId: (deviceId: string) => number | undefined;
}

export async function handleMessage(
  deps: MessageHandlerDeps,
  deviceId: string,
  packet: Types.PacketMetadata<string>,
) {
  const id = randomUUID();
  const rxTime = packet.rxTime.toISOString();
  const replyToPacketId = deps.pendingReplyIds.get(packet.id) ?? 0;
  deps.pendingReplyIds.delete(packet.id);
  await deps.db.query(
    `INSERT INTO messages(id, packet_id, device_id, from_node_id, to_node_id, channel_index, text, rx_time, role, reply_to_packet_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'received', $9)
     ON CONFLICT(id) DO NOTHING`,
    [
      id,
      packet.id,
      deviceId,
      packet.from,
      packet.to,
      packet.channel,
      packet.data,
      rxTime,
      replyToPacketId,
    ],
  );
  await deps.db.query("UPDATE devices SET last_seen = $1 WHERE id = $2", [rxTime, deviceId]);
  deps.emit({
    type: "message:received",
    payload: {
      id,
      packetId: packet.id,
      fromNodeId: packet.from,
      toNodeId: packet.to,
      channelIndex: packet.channel,
      text: packet.data,
      rxTime,
      rxSnr: null,
      rxRssi: null,
      hopLimit: null,
      wantAck: false,
      viaMqtt: false,
      role: "received",
      ackStatus: null,
      ackAt: null,
      ackError: null,
      replyToPacketId,
    },
  });
  if (deps.botEnabled && packet.data?.startsWith("!")) {
    await handleBotCommand(deps, deviceId, packet).catch((err) =>
      console.error("[bot] command handler error:", err),
    );
  }
}

async function handleBotCommand(
  deps: MessageHandlerDeps,
  deviceId: string,
  packet: Types.PacketMetadata<string>,
): Promise<void> {
  const meshDevice = deps.getMeshDevice(deviceId);
  if (!meshDevice) return;
  const raw = packet.data.trim();
  const [cmd, ...args] = raw.slice(1).toLowerCase().split(/\s+/);
  let reply: string | null = null;
  switch (cmd) {
    case "ping":
      reply = "pong!";
      break;
    case "help":
      reply = "Commands: !ping !nodes !status !help";
      break;
    case "nodes": {
      const { rows } = await deps.db.query<{ cnt: string }>(
        "SELECT COUNT(*) AS cnt FROM nodes WHERE device_id = $1",
        [deviceId],
      );
      reply = `${rows[0]?.cnt ?? 0} nodes in mesh`;
      break;
    }
    case "status": {
      const { rows } = await deps.db.query<{ cnt: string }>(
        "SELECT COUNT(*) AS cnt FROM nodes WHERE device_id = $1",
        [deviceId],
      );
      reply = `Foreman OK · ${rows[0]?.cnt ?? 0} nodes · me: ${formatNodeId(deps.getMyNodeId(deviceId) ?? 0)}`;
      break;
    }
    default:
      if (args.length === 0 && raw.length < 20) reply = `Unknown command "${cmd}". Try !help`;
      break;
  }
  if (!reply) return;
  const toNodeId = packet.from;
  const channelIndex = packet.channel;
  const packetId = await meshDevice.sendText(
    reply,
    toNodeId,
    false,
    channelIndex as Types.ChannelNumber,
  );
  const txTime = new Date().toISOString();
  const msgId = randomUUID();
  const myNodeId = deps.getMyNodeId(deviceId) ?? 0;
  await deps.db.query(
    `INSERT INTO messages(id, packet_id, device_id, from_node_id, to_node_id, channel_index,
       text, rx_time, want_ack, role, ack_status, reply_to_packet_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, 'sent', null, 0)`,
    [msgId, packetId, deviceId, myNodeId, toNodeId, channelIndex, reply, txTime],
  );
  deps.emit({
    type: "message:received",
    payload: {
      id: msgId,
      packetId,
      fromNodeId: myNodeId,
      toNodeId,
      channelIndex,
      text: reply,
      rxTime: txTime,
      rxSnr: null,
      rxRssi: null,
      hopLimit: null,
      wantAck: false,
      viaMqtt: false,
      role: "sent",
      ackStatus: null,
      ackAt: null,
      ackError: null,
      replyToPacketId: 0,
    },
  });
  console.log(`[bot] replied to !${cmd} → "${reply}" → ${formatNodeId(toNodeId)}`);
}
