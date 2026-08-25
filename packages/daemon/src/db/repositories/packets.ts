export interface PacketLogRow {
  id: string;
  packet_id: string;
  device_id: string;
  from_node_id: string;
  to_node_id: string;
  portnum_name: string;
  rx_time: string;
  rx_snr: number | null;
  rx_rssi: number | null;
  hop_limit: number | null;
  hop_start: number | null;
  via_mqtt: boolean;
}

export function mapPacketLogRow(row: PacketLogRow) {
  return {
    id: row.id,
    packetId: Number(row.packet_id),
    deviceId: row.device_id,
    fromNodeId: Number(row.from_node_id),
    toNodeId: Number(row.to_node_id),
    portnumName: row.portnum_name,
    rxTime: new Date(row.rx_time).toISOString(),
    rxSnr: row.rx_snr ?? null,
    rxRssi: row.rx_rssi ?? null,
    hopLimit: row.hop_limit ?? null,
    hopStart: row.hop_start ?? null,
    viaMqtt: row.via_mqtt,
  };
}
