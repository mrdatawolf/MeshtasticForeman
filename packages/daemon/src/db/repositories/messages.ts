import type { Message } from "@foreman/shared";

export interface MessageRow {
  id: string;
  packet_id: number;
  from_node_id: number;
  to_node_id: number;
  channel_index: number;
  text: string | null;
  rx_time: string;
  rx_snr: number | null;
  rx_rssi: number | null;
  hop_limit: number | null;
  want_ack: boolean;
  via_mqtt: boolean;
  role: string;
  ack_status: string | null;
  ack_at: string | null;
  ack_error: string | null;
  reply_to_packet_id: number;
}

export function mapMessageRow(row: MessageRow): Message {
  return {
    id: row.id,
    packetId: row.packet_id,
    fromNodeId: row.from_node_id,
    toNodeId: row.to_node_id,
    channelIndex: row.channel_index,
    text: row.text,
    rxTime: row.rx_time,
    rxSnr: row.rx_snr,
    rxRssi: row.rx_rssi,
    hopLimit: row.hop_limit,
    wantAck: row.want_ack,
    viaMqtt: row.via_mqtt,
    role: row.role as Message["role"],
    ackStatus: row.ack_status as Message["ackStatus"],
    ackAt: row.ack_at,
    ackError: row.ack_error,
    replyToPacketId: row.reply_to_packet_id ?? 0,
  };
}
