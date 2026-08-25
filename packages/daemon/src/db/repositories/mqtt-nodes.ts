import type { MqttNode } from "@foreman/shared";

export interface MqttNodeRow {
  node_id: number;
  long_name: string | null;
  short_name: string | null;
  hw_model: number | null;
  public_key: string | null;
  last_heard: string | null;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  last_gateway: string | null;
  region_path: string | null;
  channel_name: string | null;
  snr: number | null;
  hops_away: number | null;
  distance_m: number | null;
}

export function mapMqttNodeRow(row: MqttNodeRow): MqttNode {
  return {
    nodeId: row.node_id,
    longName: row.long_name,
    shortName: row.short_name,
    hwModel: row.hw_model,
    publicKey: row.public_key,
    lastHeard: row.last_heard,
    latitude: row.latitude,
    longitude: row.longitude,
    altitude: row.altitude,
    lastGateway: row.last_gateway,
    regionPath: row.region_path,
    channelName: row.channel_name,
    snr: row.snr,
    hopsAway: row.hops_away,
    distanceM: row.distance_m,
  };
}
