// Core domain types shared between daemon and web

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface GpsDetail {
  latitude: number;
  longitude: number;
  altitude: number | null;
  satsInView: number | null;
  fixType: number | null; // 0=no fix, 2=2D, 3=3D — stored internally by firmware, never transmitted in packets
  fixQuality: number | null; // 0=invalid, 1=GPS, 2=DGPS — stored internally by firmware, never transmitted in packets
  pdop: number | null; // position dilution of precision (raw × 100, so 120 = 1.20) — sent by default
  hdop: number | null; // horizontal dilution of precision — only sent if HVDOP position flag enabled on device
  locationSource: number | null; // 0=unset, 1=manual, 2=internal, 3=external
  gpsTimestamp: string | null; // ISO timestamp from GPS fix
}

export interface DeviceInfo {
  id: string;
  name: string;
  port: string;
  status: ConnectionStatus;
  connectedAt: string | null;
  lastSeenAt: string | null;
  hardwareModel: string | null;
  firmwareVersion: string | null;
  batteryLevel: number | null; // 0–100, null if unknown or plugged in without reporting
  hasGpsPosition: boolean; // true once device has sent a valid GPS fix this session
  gpsDetail: GpsDetail | null; // latest GPS fix detail, null until first fix
  ownNodeId: number | null; // the device's own mesh node number
}

export interface NodeInfo {
  nodeId: number;
  longName: string | null;
  shortName: string | null;
  macAddress: string | null;
  hwModel: number | null;
  publicKey: string | null;
  lastHeard: string | null;
  snr: number | null;
  hopsAway: number | null;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
}

export type MessageRole = "received" | "sent" | "relayed";
export type AckStatus = "pending" | "acked" | "error";

export interface Message {
  id: string;
  packetId: number;
  fromNodeId: number;
  toNodeId: number;
  channelIndex: number;
  text: string | null; // null for encrypted relayed packets we cannot decode
  rxTime: string;
  rxSnr: number | null;
  rxRssi: number | null;
  hopLimit: number | null;
  wantAck: boolean;
  viaMqtt: boolean;
  role: MessageRole;
  ackStatus: AckStatus | null; // null = no ACK requested (wantAck false) or non-sent message
  ackAt: string | null;
  ackError: string | null;
  replyToPacketId: number; // 0 = not a reply; populated from MeshPacket.reply_id (field 23)
}

export interface Packet {
  id: string;
  packetId: number;
  fromNodeId: number;
  toNodeId: number;
  channel: number;
  portnum: number;
  portnumName: string;
  rxTime: string;
  rxSnr: number | null;
  rxRssi: number | null;
  hopLimit: number | null;
  hopStart: number | null;
  wantAck: boolean;
  viaMqtt: boolean;
  payloadRaw: string | null; // base64 encoded
  decodedJson: string | null; // JSON string of decoded payload
}

export interface Channel {
  index: number;
  name: string | null;
  role: number;
  psk: string | null; // base64
}

export interface MqttNode {
  nodeId: number;
  longName: string | null;
  shortName: string | null;
  hwModel: number | null;
  publicKey: string | null;
  lastHeard: string | null;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  lastGateway: string | null;
  regionPath: string | null;
  /** Channel name parsed from the MQTT topic path (e.g. "LongFast", "MediumFast").
   *  Maps to a modem preset for coverage radius estimation. */
  channelName: string | null;
  snr: number | null;
  hopsAway: number | null;
  distanceM: number | null;
}

export interface Waypoint {
  id: number;
  name: string;
  description: string | null;
  latitude: number;
  longitude: number;
  icon: number | null;
  lockedTo: number | null;
  expire: string | null;
}

export interface ActivityEntry {
  id: number; // monotonic sequence number
  ts: string; // ISO timestamp
  source: "mesh" | "mqtt";
  portnum: string; // e.g. "POSITION_APP", "TELEMETRY_APP"
  fromHex: string; // "!43577e14"
  region: string | null; // MQTT only
  gateway: string | null; // MQTT only
  viaMqtt: boolean; // mesh: was packet a downlink echo
}

export interface LogEntry {
  id: number;
  ts: string;
  level: "log" | "warn" | "error";
  tag: string; // "devices", "mqtt", "ws", etc. — empty string for untagged
  text: string;
}

export interface NodeOverride {
  nodeId: number;
  aliasName: string | null;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  notes: string | null;
}

/**
 * A hypothetical node location for coverage extension planning.
 * Stored locally; not tied to any live mesh node.
 */
export interface CoverageProposal {
  id: string;
  name: string;
  lat: number;
  lon: number;
  altitudeM: number;
  modemPreset: number;
  notes: string | null;
  visible: boolean;
  createdAt: string;
}

/**
 * Full device configuration snapshot.
 * radioConfig and moduleConfig are keyed by section name (e.g. "lora", "mqtt")
 * and contain the raw protobuf values as plain JSON.
 */
export interface DeviceConfig {
  deviceId: string;
  radioConfig: Record<string, unknown>;
  moduleConfig: Record<string, unknown>;
  channels: Channel[];
}
