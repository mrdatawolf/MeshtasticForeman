import { request } from "./client.js";

export interface SnrHistoryPoint {
  ts: string;
  nodeId: number;
  snr: number | null;
  rssi: number | null;
  count: number;
}
export interface MessageVolumePoint {
  ts: string;
  received: number;
  sent: number;
  relayed: number;
  total: number;
}
export interface MessageDeliveryStats {
  acked: number;
  pending: number;
  error: number;
  total: number;
  errorTypes: { type: string; count: number }[];
}
export interface BusiestNode {
  nodeId: number;
  received: number;
  sent: number;
  relayed: number;
  total: number;
}
export interface PortnumCount {
  portnumName: string;
  count: number;
}
export interface PacketTimelinePoint {
  ts: string;
  counts: Record<string, number>;
  total: number;
}
export interface HopBucket {
  hopsAway: number;
  count: number;
}
export interface HardwareBucket {
  hwModel: number;
  hwModelName: string;
  count: number;
}
export interface ChannelBucket {
  channelIndex: number;
  channelName: string | null;
  received: number;
  sent: number;
  relayed: number;
  total: number;
}
export interface LatencyHistogram {
  buckets: { label: string; maxMs: number; count: number }[];
  medianMs: number | null;
  p95Ms: number | null;
  totalSamples: number;
}
export interface TracerouteRecord {
  id: string;
  deviceId: string;
  fromNodeId: number;
  toNodeId: number;
  route: number[];
  routeBack: number[];
  recordedAt: string;
}
export interface NeighborLink {
  fromNodeId: number;
  toNodeId: number;
  snr: number | null;
  lastSeen: string;
}
export interface PacketLogEntry {
  id: string;
  packetId: number;
  deviceId: string;
  fromNodeId: number;
  toNodeId: number;
  portnumName: string;
  rxTime: string;
  rxSnr: number | null;
  rxRssi: number | null;
  hopLimit: number | null;
  hopStart: number | null;
  viaMqtt: boolean;
}
export interface LinkQualityEntry {
  fromNodeId: number;
  toNodeId: number;
  avgSnr: number | null;
  messageCount: number;
}
export interface NodeActivityPoint {
  ts: string;
  nodeId: number;
  count: number;
}
export interface PositionRecord {
  id: string;
  nodeId: number;
  latitude: number;
  longitude: number;
  altitude: number | null;
  speed: number | null;
  groundTrack: number | null;
  satsInView: number | null;
  recordedAt: string;
}
export interface TelemetryPoint {
  ts: string;
  nodeId: number;
  variantCase: string | null;
  batteryLevel: number | null;
  voltage: number | null;
  channelUtilization: number | null;
  airUtilTx: number | null;
  uptimeSeconds: number | null;
  temperature: number | null;
  relativeHumidity: number | null;
  barometricPressure: number | null;
}

export interface AnalyticsQuery {
  since?: string;
  deviceId?: string;
}
export interface SnrHistoryQuery extends AnalyticsQuery {
  nodeId?: number;
}
export interface BucketQuery extends AnalyticsQuery {
  bucket?: "hour" | "day";
}
export interface PacketTimelineQuery extends AnalyticsQuery {
  bucket?: "minute" | "hour";
}
export interface BusiestNodesQuery extends AnalyticsQuery {
  limit?: number;
}
export interface PacketLogQuery extends AnalyticsQuery {
  limit?: number;
  portnum?: string;
}
export interface PositionHistoryQuery extends AnalyticsQuery {
  nodeId?: number;
  limit?: number;
}

function get<T>(path: string, query: object = {}, signal?: AbortSignal): Promise<T> {
  return request<T>(path, {
    query: { ...query } as Record<string, string | number | boolean | undefined>,
    signal,
  }) as Promise<T>;
}

export const snrHistory = (query: SnrHistoryQuery = {}, signal?: AbortSignal) =>
  get<SnrHistoryPoint[]>("/api/analytics/snr-history", query, signal);
export const messageVolume = (query: BucketQuery = {}, signal?: AbortSignal) =>
  get<MessageVolumePoint[]>("/api/analytics/message-volume", query, signal);
export const messageDelivery = (query: AnalyticsQuery = {}, signal?: AbortSignal) =>
  get<MessageDeliveryStats>("/api/analytics/message-delivery", query, signal);
export const busiestNodes = (query: BusiestNodesQuery = {}, signal?: AbortSignal) =>
  get<BusiestNode[]>("/api/analytics/busiest-nodes", query, signal);
export const portnumBreakdown = (query: AnalyticsQuery = {}, signal?: AbortSignal) =>
  get<PortnumCount[]>("/api/analytics/portnum-breakdown", query, signal);
export const packetTimeline = (query: PacketTimelineQuery = {}, signal?: AbortSignal) =>
  get<PacketTimelinePoint[]>("/api/analytics/packet-timeline", query, signal);
export const hopDistribution = (deviceId?: string, signal?: AbortSignal) =>
  get<HopBucket[]>("/api/analytics/hop-distribution", { deviceId }, signal);
export const hardwareBreakdown = (deviceId?: string, signal?: AbortSignal) =>
  get<HardwareBucket[]>("/api/analytics/hardware-breakdown", { deviceId }, signal);
export const channelUtilization = (query: AnalyticsQuery = {}, signal?: AbortSignal) =>
  get<ChannelBucket[]>("/api/analytics/channel-utilization", query, signal);
export const messageLatency = (query: AnalyticsQuery = {}, signal?: AbortSignal) =>
  get<LatencyHistogram>("/api/analytics/message-latency", query, signal);
export const telemetryHistory = (query: SnrHistoryQuery = {}, signal?: AbortSignal) =>
  get<TelemetryPoint[]>("/api/analytics/telemetry-history", query, signal);
export const linkQuality = (query: AnalyticsQuery = {}, signal?: AbortSignal) =>
  get<LinkQualityEntry[]>("/api/analytics/link-quality", query, signal);
export const nodeActivity = (query: BucketQuery = {}, signal?: AbortSignal) =>
  get<NodeActivityPoint[]>("/api/analytics/node-activity", query, signal);
export const neighborGraph = (query: AnalyticsQuery = {}, signal?: AbortSignal) =>
  get<NeighborLink[]>("/api/analytics/neighbor-graph", query, signal);
export const positionHistory = (query: PositionHistoryQuery = {}, signal?: AbortSignal) =>
  get<PositionRecord[]>("/api/analytics/position-history", query, signal);
export const traceroutes = (query: AnalyticsQuery = {}, signal?: AbortSignal) =>
  get<TracerouteRecord[]>("/api/traceroutes", query, signal);
export const packetLog = (query: PacketLogQuery = {}, signal?: AbortSignal) =>
  get<PacketLogEntry[]>("/api/analytics/packet-log", query, signal);
