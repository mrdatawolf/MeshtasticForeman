import type { NodeInfo } from "@foreman/shared";

export interface NodeRow {
  node_id: number;
  long_name: string | null;
  short_name: string | null;
  mac_address: string | null;
  hw_model: number | null;
  public_key: string | null;
  last_heard: string | null;
  snr: number | null;
  hops_away: number | null;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
}

export function mapNodeRow(row: NodeRow): NodeInfo {
  return {
    nodeId: row.node_id,
    longName: row.long_name,
    shortName: row.short_name,
    macAddress: row.mac_address,
    hwModel: row.hw_model,
    publicKey: row.public_key,
    lastHeard: row.last_heard,
    snr: row.snr,
    hopsAway: row.hops_away,
    latitude: row.latitude,
    longitude: row.longitude,
    altitude: row.altitude,
  };
}
