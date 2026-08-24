import "maplibre-gl/dist/maplibre-gl.css";
import { useState, useEffect, useMemo, useRef, lazy, Suspense } from "react";
import MapGL, { Source, Layer, NavigationControl } from "react-map-gl/maplibre";
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";

import type { NodeInfo, MqttNode, DeviceInfo } from "@foreman/shared";
import * as analyticsApi from "../api/analytics.js";
import type {
  BusiestNode,
  ChannelBucket,
  HardwareBucket,
  HopBucket,
  LatencyHistogram,
  LinkQualityEntry,
  MessageDeliveryStats,
  MessageVolumePoint,
  NeighborLink,
  NodeActivityPoint,
  PacketLogEntry,
  PacketTimelinePoint,
  PortnumCount,
  PositionRecord,
  SnrHistoryPoint,
  TelemetryPoint,
  TracerouteRecord,
} from "../api/analytics.js";

const ForceGraph2D = lazy(() => import("react-force-graph-2d"));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nodeHex(id: number): string {
  return `!${id.toString(16).padStart(8, "0")}`;
}

function nodeName(id: number, nodes: NodeInfo[], mqttNodes: MqttNode[]): string {
  const n = (nodes as Array<NodeInfo | MqttNode>).concat(mqttNodes).find((x) => x.nodeId === id);
  if (!n) return nodeHex(id);
  return n.longName ?? n.shortName ?? nodeHex(id);
}

/** Deterministic HSL colour from a node ID — same hashing as MapPage. */
function nodeColor(id: number): string {
  const h = Math.round((id * 137.508) % 360);
  return `hsl(${h},65%,60%)`;
}

/** SNR → link colour for the neighbor graph. */
function snrLinkColor(snr: number | null): string {
  if (snr === null) return "#475569";
  if (snr > 0) return "#22c55e";
  if (snr > -5) return "#84cc16";
  if (snr > -10) return "#f59e0b";
  if (snr > -15) return "#f97316";
  return "#ef4444";
}

/** SNR → link width (1–4 px). */
function snrLinkWidth(snr: number | null): number {
  if (snr === null) return 1;
  return Math.max(1, Math.min(4, (snr + 20) / 5));
}

function formatTs(ts: string, bucket = "hour"): string {
  const d = new Date(ts);
  if (bucket === "day") return d.toLocaleDateString([], { month: "short", day: "numeric" });
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatMs(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

const MAP_STYLE = import.meta.env.VITE_MAP_STYLE ?? "https://tiles.openfreemap.org/styles/liberty";

// Inject a single keyframe rule for the loading spinner (once per page load).
if (typeof document !== "undefined" && !document.getElementById("analytics-spinner-kf")) {
  const s = document.createElement("style");
  s.id = "analytics-spinner-kf";
  s.textContent =
    "@keyframes analytics-spin{to{transform:rotate(360deg)}}" +
    ".analytics-spinner{width:22px;height:22px;border:2px solid #1e293b;" +
    "border-top-color:#3b82f6;border-radius:50%;" +
    "animation:analytics-spin 0.75s linear infinite}";
  document.head.appendChild(s);
}

// ---------------------------------------------------------------------------
// Recharts dark-theme constants
// ---------------------------------------------------------------------------

const GRID_COLOR = "#1e293b";
const TICK_STYLE = { fill: "#64748b", fontSize: 11, fontFamily: "monospace" };
const TOOLTIP_STYLE = {
  contentStyle: {
    background: "#0f172a",
    border: "1px solid #334155",
    borderRadius: "0.375rem",
    fontFamily: "monospace",
    fontSize: "0.75rem",
  },
  labelStyle: { color: "#94a3b8" },
  itemStyle: { color: "#e2e8f0" },
};

const ROLE_COLORS = { received: "#60a5fa", sent: "#34d399", relayed: "#a78bfa" };
const PIE_PALETTE = [
  "#60a5fa",
  "#34d399",
  "#a78bfa",
  "#fb923c",
  "#fbbf24",
  "#f87171",
  "#94a3b8",
  "#22d3ee",
  "#e879f9",
  "#4ade80",
];

// ---------------------------------------------------------------------------
// Shared UI primitives
// ---------------------------------------------------------------------------

function ChartCard({
  title,
  children,
  fullWidth,
}: {
  title: string;
  children: React.ReactNode;
  fullWidth?: boolean;
}) {
  return (
    <div style={{ ...styles.card, gridColumn: fullWidth ? "1 / -1" : undefined }}>
      <div style={styles.cardTitle}>{title}</div>
      {children}
    </div>
  );
}

function Empty({ message = "No data" }: { message?: string }) {
  return <div style={styles.empty}>{message}</div>;
}

function Loading({ height }: { height?: number } = {}) {
  return (
    <div style={{ ...styles.empty, height: height ?? 160 }}>
      <div className="analytics-spinner" />
    </div>
  );
}

function RangeBtn({
  options,
  value,
  onChange,
}: {
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ display: "flex", gap: "0.25rem", marginBottom: "0.6rem" }}>
      {options.map((o) => (
        <button key={o} style={rangeStyle(value === o)} onClick={() => onChange(o)}>
          {o}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 1 — Signal Quality
// ---------------------------------------------------------------------------

function SignalTab({ nodes, mqttNodes }: { nodes: NodeInfo[]; mqttNodes: MqttNode[] }) {
  const [since, setSince] = useState("24h");
  const [snrData, setSnrData] = useState<SnrHistoryPoint[] | null>(null);

  useEffect(() => {
    setSnrData(null);
    analyticsApi
      .snrHistory({ since })
      .then(setSnrData)
      .catch(() => setSnrData([]));
  }, [since]);

  // Collect unique node IDs, sorted by total count desc (cap at 8 lines)
  const topNodes = useMemo(() => {
    if (!snrData) return [];
    const totals = new Map<number, number>();
    for (const p of snrData) totals.set(p.nodeId, (totals.get(p.nodeId) ?? 0) + p.count);
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id]) => id);
  }, [snrData]);

  // Pivot: one row per timestamp bucket, one key per nodeId
  const pivotedSnr = useMemo(() => {
    if (!snrData) return [];
    const byTs = new Map<string, Record<string, unknown>>();
    for (const p of snrData) {
      if (!topNodes.includes(p.nodeId)) continue;
      if (!byTs.has(p.ts)) byTs.set(p.ts, { ts: p.ts });
      byTs.get(p.ts)![String(p.nodeId)] = p.snr;
    }
    return [...byTs.values()].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  }, [snrData, topNodes]);

  const pivotedRssi = useMemo(() => {
    if (!snrData) return [];
    const byTs = new Map<string, Record<string, unknown>>();
    for (const p of snrData) {
      if (!topNodes.includes(p.nodeId)) continue;
      if (!byTs.has(p.ts)) byTs.set(p.ts, { ts: p.ts });
      byTs.get(p.ts)![String(p.nodeId)] = p.rssi;
    }
    return [...byTs.values()].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  }, [snrData, topNodes]);

  const hasData = snrData !== null && snrData.length > 0;

  const snrEmptyMsg =
    "No SNR/RSSI data recorded in this time window. Signal metrics require packets " +
    "received directly over radio — MQTT-relayed packets do not carry rx_snr/rx_rssi.";

  return (
    <div style={styles.grid}>
      <ChartCard title="SNR over Time (dB)" fullWidth>
        <RangeBtn options={["1h", "6h", "24h", "7d"]} value={since} onChange={setSince} />
        {snrData === null ? (
          <Loading />
        ) : !hasData ? (
          <Empty message={snrEmptyMsg} />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={pivotedSnr}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
              <XAxis dataKey="ts" tickFormatter={(v) => formatTs(v)} tick={TICK_STYLE} />
              <YAxis tick={TICK_STYLE} unit=" dB" />
              <Tooltip
                {...TOOLTIP_STYLE}
                labelFormatter={(v) => new Date(v as string).toLocaleString()}
              />
              <Legend wrapperStyle={styles.legendWrap} />
              {topNodes.map((id) => (
                <Line
                  key={id}
                  dataKey={String(id)}
                  name={nodeName(id, nodes, mqttNodes)}
                  stroke={nodeColor(id)}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="RSSI over Time (dBm)" fullWidth>
        {snrData === null ? (
          <Loading />
        ) : !hasData ? (
          <Empty message={snrEmptyMsg} />
        ) : (
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={pivotedRssi}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
              <XAxis dataKey="ts" tickFormatter={(v) => formatTs(v)} tick={TICK_STYLE} />
              <YAxis tick={TICK_STYLE} unit=" dBm" />
              <Tooltip
                {...TOOLTIP_STYLE}
                labelFormatter={(v) => new Date(v as string).toLocaleString()}
              />
              <Legend wrapperStyle={styles.legendWrap} />
              {topNodes.map((id) => (
                <Line
                  key={id}
                  dataKey={String(id)}
                  name={nodeName(id, nodes, mqttNodes)}
                  stroke={nodeColor(id)}
                  dot={false}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 2 — Messages
// ---------------------------------------------------------------------------

function MessagesTab({ nodes, mqttNodes }: { nodes: NodeInfo[]; mqttNodes: MqttNode[] }) {
  const [since, setSince] = useState("7d");
  const bucket = since === "30d" ? "day" : "hour";

  const [volume, setVolume] = useState<MessageVolumePoint[] | null>(null);
  const [delivery, setDelivery] = useState<MessageDeliveryStats | null>(null);
  const [busiest, setBusiest] = useState<BusiestNode[] | null>(null);
  const [channels, setChannels] = useState<ChannelBucket[] | null>(null);
  const [latency, setLatency] = useState<LatencyHistogram | null>(null);

  useEffect(() => {
    setVolume(null);
    analyticsApi
      .messageVolume({ since, bucket })
      .then(setVolume)
      .catch(() => setVolume([]));
  }, [since, bucket]);

  useEffect(() => {
    setDelivery(null);
    analyticsApi
      .messageDelivery({ since })
      .then(setDelivery)
      .catch(() => setDelivery({ acked: 0, pending: 0, error: 0, total: 0, errorTypes: [] }));
  }, [since]);

  useEffect(() => {
    setBusiest(null);
    analyticsApi
      .busiestNodes({ since })
      .then(setBusiest)
      .catch(() => setBusiest([]));
  }, [since]);

  useEffect(() => {
    setChannels(null);
    analyticsApi
      .channelUtilization({ since })
      .then(setChannels)
      .catch(() => setChannels([]));
  }, [since]);

  useEffect(() => {
    setLatency(null);
    analyticsApi
      .messageLatency({ since })
      .then(setLatency)
      .catch(() => setLatency(null));
  }, [since]);

  // Delivery donut data
  const deliverySlices = delivery
    ? [
        { name: "Acked", value: delivery.acked, fill: "#34d399" },
        { name: "Pending", value: delivery.pending, fill: "#f59e0b" },
        { name: "Error", value: delivery.error, fill: "#ef4444" },
      ].filter((s) => s.value > 0)
    : [];

  // Busiest nodes with resolved names
  const busiestRows = useMemo(
    () =>
      (busiest ?? []).map((b) => ({
        ...b,
        name: nodeName(b.nodeId, nodes, mqttNodes),
      })),
    [busiest, nodes, mqttNodes],
  );

  // Channel utilization with display names
  const channelRows = useMemo(
    () =>
      (channels ?? []).map((c) => ({
        ...c,
        label: c.channelName ? `${c.channelName} (${c.channelIndex})` : `Ch ${c.channelIndex}`,
      })),
    [channels],
  );

  return (
    <div style={styles.grid}>
      {/* Range selector spanning full width */}
      <div style={{ gridColumn: "1 / -1" }}>
        <RangeBtn options={["6h", "24h", "7d", "30d"]} value={since} onChange={setSince} />
      </div>

      {/* Message Volume — full width */}
      <ChartCard title="Message Volume" fullWidth>
        {volume === null ? (
          <Loading />
        ) : volume.length === 0 ? (
          <Empty />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={volume}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
              <XAxis dataKey="ts" tickFormatter={(v) => formatTs(v, bucket)} tick={TICK_STYLE} />
              <YAxis tick={TICK_STYLE} allowDecimals={false} />
              <Tooltip
                {...TOOLTIP_STYLE}
                labelFormatter={(v) => new Date(v as string).toLocaleString()}
              />
              <Legend wrapperStyle={styles.legendWrap} />
              <Area
                type="monotone"
                dataKey="received"
                name="Received"
                stackId="a"
                fill={ROLE_COLORS.received + "80"}
                stroke={ROLE_COLORS.received}
              />
              <Area
                type="monotone"
                dataKey="sent"
                name="Sent"
                stackId="a"
                fill={ROLE_COLORS.sent + "80"}
                stroke={ROLE_COLORS.sent}
              />
              <Area
                type="monotone"
                dataKey="relayed"
                name="Relayed"
                stackId="a"
                fill={ROLE_COLORS.relayed + "80"}
                stroke={ROLE_COLORS.relayed}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Delivery Rate */}
      <ChartCard title="Delivery Rate">
        {delivery === null ? (
          <Loading />
        ) : delivery.total === 0 ? (
          <Empty message="No sent messages with ACK requested" />
        ) : (
          <>
            <div style={styles.deliverySummary}>
              {delivery.total > 0 && (
                <span style={{ color: "#94a3b8" }}>
                  {delivery.acked} / {delivery.total} delivered
                  <span style={{ color: "#64748b" }}>
                    {" "}
                    ({Math.round((delivery.acked / delivery.total) * 100)}%)
                  </span>
                </span>
              )}
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  dataKey="value"
                  data={deliverySlices}
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={3}
                >
                  {deliverySlices.map((s, i) => (
                    <Cell key={i} fill={s.fill} />
                  ))}
                </Pie>
                <Tooltip {...TOOLTIP_STYLE} />
                <Legend wrapperStyle={styles.legendWrap} />
              </PieChart>
            </ResponsiveContainer>
            {delivery.errorTypes.length > 0 && (
              <div style={{ marginTop: "0.5rem" }}>
                <div style={styles.subLabel}>Error breakdown</div>
                {delivery.errorTypes.map((e) => (
                  <div key={e.type} style={styles.errorRow}>
                    <span style={{ color: "#f87171" }}>{e.type}</span>
                    <span style={{ color: "#64748b" }}>{e.count}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </ChartCard>

      {/* Channel Utilization */}
      <ChartCard title="Channel Utilization">
        {channels === null ? (
          <Loading />
        ) : channels.length === 0 ? (
          <Empty />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={channelRows}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
              <XAxis dataKey="label" tick={TICK_STYLE} />
              <YAxis tick={TICK_STYLE} allowDecimals={false} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Legend wrapperStyle={styles.legendWrap} />
              <Bar dataKey="received" name="Received" stackId="a" fill={ROLE_COLORS.received} />
              <Bar dataKey="sent" name="Sent" stackId="a" fill={ROLE_COLORS.sent} />
              <Bar dataKey="relayed" name="Relayed" stackId="a" fill={ROLE_COLORS.relayed} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Busiest Nodes — full width */}
      <ChartCard title="Busiest Nodes" fullWidth>
        {busiest === null ? (
          <Loading />
        ) : busiest.length === 0 ? (
          <Empty />
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(200, busiestRows.length * 28)}>
            <BarChart layout="vertical" data={busiestRows}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal={false} />
              <XAxis type="number" tick={TICK_STYLE} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="name"
                width={160}
                tick={{ ...TICK_STYLE, fontSize: 10 }}
              />
              <Tooltip {...TOOLTIP_STYLE} />
              <Legend wrapperStyle={styles.legendWrap} />
              <Bar dataKey="received" name="Received" stackId="a" fill={ROLE_COLORS.received} />
              <Bar dataKey="sent" name="Sent" stackId="a" fill={ROLE_COLORS.sent} />
              <Bar dataKey="relayed" name="Relayed" stackId="a" fill={ROLE_COLORS.relayed} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Message Latency */}
      <ChartCard title="Message Latency (ACK round-trip)" fullWidth>
        {latency === null ? (
          <Loading />
        ) : latency.totalSamples === 0 ? (
          <Empty message="No ACKed messages in this window" />
        ) : (
          <>
            <div style={styles.latencySummary}>
              <span>
                Median: <strong style={{ color: "#e2e8f0" }}>{formatMs(latency.medianMs)}</strong>
              </span>
              <span>
                p95: <strong style={{ color: "#e2e8f0" }}>{formatMs(latency.p95Ms)}</strong>
              </span>
              <span style={{ color: "#64748b" }}>{latency.totalSamples} samples</span>
            </div>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={latency.buckets}>
                <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
                <XAxis dataKey="label" tick={TICK_STYLE} />
                <YAxis tick={TICK_STYLE} allowDecimals={false} />
                <Tooltip {...TOOLTIP_STYLE} />
                <Bar dataKey="count" name="Messages" fill="#60a5fa" />
              </BarChart>
            </ResponsiveContainer>
          </>
        )}
      </ChartCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared: Force-graph canvas component
// ---------------------------------------------------------------------------

function MeshGraph({
  graphData,
  graphWidth,
  height = 420,
  emptyMessage = "No data in this window",
}: {
  graphData: { nodes: unknown[]; links: unknown[] };
  graphWidth: number;
  height?: number;
  emptyMessage?: string;
}) {
  if (graphData.nodes.length === 0) {
    return (
      <div
        style={{
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#475569",
          fontSize: "0.75rem",
        }}
      >
        {emptyMessage}
      </div>
    );
  }
  return (
    <Suspense
      fallback={
        <div
          style={{
            height,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#475569",
            fontSize: "0.75rem",
          }}
        >
          Loading graph…
        </div>
      }
    >
      <ForceGraph2D
        graphData={graphData as Parameters<typeof ForceGraph2D>[0]["graphData"]}
        width={graphWidth}
        height={height}
        backgroundColor="#020617"
        nodeLabel="name"
        nodeColor={(n: Record<string, unknown>) => (n.color as string | undefined) ?? "#60a5fa"}
        linkColor={(l: Record<string, unknown>) => (l.color as string | undefined) ?? "#334155"}
        linkWidth={(l: Record<string, unknown>) => (l.width as number | undefined) ?? 1}
        nodeCanvasObjectMode={() => "after"}
        nodeCanvasObject={(
          node: { x?: number; y?: number; name?: string },
          ctx: CanvasRenderingContext2D,
          globalScale: number,
        ) => {
          if (!node.name || node.x == null || node.y == null) return;
          const fontSize = Math.max(10, 12 / globalScale);
          ctx.font = `${fontSize}px monospace`;
          ctx.fillStyle = "#94a3b8";
          ctx.textAlign = "center";
          ctx.fillText(node.name, node.x, node.y + 10);
        }}
      />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Tab 3 — Network
// ---------------------------------------------------------------------------

function NetworkTab({ nodes, mqttNodes }: { nodes: NodeInfo[]; mqttNodes: MqttNode[] }) {
  const [hops, setHops] = useState<HopBucket[] | null>(null);
  const [hardware, setHardware] = useState<HardwareBucket[] | null>(null);
  const [neighbors, setNeighbors] = useState<NeighborLink[] | null>(null);
  const [routes, setRoutes] = useState<TracerouteRecord[] | null>(null);
  const [graphSince, setGraphSince] = useState("24h");

  const neighborRef = useRef<HTMLDivElement>(null);
  const tracerouteRef = useRef<HTMLDivElement>(null);
  const [neighborWidth, setNeighborWidth] = useState(600);
  const [tracerouteWidth, setTracerouteWidth] = useState(600);

  useEffect(() => {
    analyticsApi
      .hopDistribution()
      .then(setHops)
      .catch(() => setHops([]));
    analyticsApi
      .hardwareBreakdown()
      .then(setHardware)
      .catch(() => setHardware([]));
  }, []);

  useEffect(() => {
    setNeighbors(null);
    setRoutes(null);
    const since = graphSince !== "all" ? graphSince : undefined;
    analyticsApi
      .neighborGraph({ since })
      .then(setNeighbors)
      .catch(() => setNeighbors([]));
    analyticsApi
      .traceroutes({ since })
      .then(setRoutes)
      .catch(() => setRoutes([]));
  }, [graphSince]);

  // Measure containers for graph widths
  useEffect(() => {
    const observe = (el: HTMLDivElement | null, set: (w: number) => void) => {
      if (!el) return () => {};
      const ro = new ResizeObserver((e) => set(e[0].contentRect.width - 32));
      ro.observe(el);
      return () => ro.disconnect();
    };
    const off1 = observe(neighborRef.current, setNeighborWidth);
    const off2 = observe(tracerouteRef.current, setTracerouteWidth);
    return () => {
      off1();
      off2();
    };
  }, []);

  // Build neighbor graph data — deduplicate bidirectional edges, keep best SNR
  const neighborGraphData = useMemo(() => {
    if (!neighbors) return { nodes: [], links: [] };
    const nodeIds = new Set<number>();
    const edgeMap = new Map<
      string,
      { source: number; target: number; snr: number | null; color: string; width: number }
    >();

    for (const lk of neighbors) {
      nodeIds.add(lk.fromNodeId);
      nodeIds.add(lk.toNodeId);
      const key = `${Math.min(lk.fromNodeId, lk.toNodeId)}_${Math.max(lk.fromNodeId, lk.toNodeId)}`;
      const existing = edgeMap.get(key);
      // Keep the best (highest) SNR for the edge
      if (!existing || (lk.snr !== null && (existing.snr === null || lk.snr > existing.snr))) {
        edgeMap.set(key, {
          source: lk.fromNodeId,
          target: lk.toNodeId,
          snr: lk.snr,
          color: snrLinkColor(lk.snr),
          width: snrLinkWidth(lk.snr),
        });
      }
    }

    return {
      nodes: [...nodeIds].map((id) => ({
        id,
        name: nodeName(id, nodes, mqttNodes),
        color: nodeColor(id),
      })),
      links: [...edgeMap.values()],
    };
  }, [neighbors, nodes, mqttNodes]);

  // Build traceroute graph data
  const tracerouteGraphData = useMemo(() => {
    if (!routes) return { nodes: [], links: [] };
    const nodeIds = new Set<number>();
    const edgeSet = new Set<string>();
    const links: { source: number; target: number; color: string; width: number }[] = [];

    for (const tr of routes) {
      const path = [tr.fromNodeId, ...tr.route, tr.toNodeId];
      for (const id of path) nodeIds.add(id);
      for (let i = 0; i < path.length - 1; i++) {
        const key = `${Math.min(path[i], path[i + 1])}_${Math.max(path[i], path[i + 1])}`;
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          links.push({ source: path[i], target: path[i + 1], color: "#3b82f6", width: 1.5 });
        }
      }
    }

    return {
      nodes: [...nodeIds].map((id) => ({
        id,
        name: nodeName(id, nodes, mqttNodes),
        color: nodeColor(id),
      })),
      links,
    };
  }, [routes, nodes, mqttNodes]);

  const hopRows = useMemo(
    () =>
      (hops ?? []).map((h) => ({
        label: h.hopsAway === 0 ? "Direct" : `${h.hopsAway} hop${h.hopsAway > 1 ? "s" : ""}`,
        count: h.count,
      })),
    [hops],
  );

  // SNR legend items for the neighbor graph
  const snrLegend = [
    { label: "> 0 dB", color: "#22c55e" },
    { label: "0 to -5", color: "#84cc16" },
    { label: "-5 to -10", color: "#f59e0b" },
    { label: "-10 to -15", color: "#f97316" },
    { label: "< -15 dB", color: "#ef4444" },
    { label: "Unknown", color: "#475569" },
  ];

  return (
    <div style={styles.grid}>
      {/* Range selector */}
      <div style={{ gridColumn: "1 / -1" }}>
        <RangeBtn
          options={["1h", "6h", "24h", "7d", "all"]}
          value={graphSince}
          onChange={setGraphSince}
        />
      </div>

      {/* Neighbor Info Graph — full width, primary topology view */}
      <ChartCard title="Neighbor Topology (SNR-coloured links)" fullWidth>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "1rem",
            marginBottom: "0.6rem",
            flexWrap: "wrap",
          }}
        >
          {neighbors && (
            <span style={{ color: "#64748b", fontSize: "0.7rem", fontFamily: "monospace" }}>
              {neighborGraphData.nodes.length} nodes · {neighborGraphData.links.length} links
              {neighbors.length === 0 && " — no NEIGHBORINFO_APP packets received yet"}
            </span>
          )}
          {/* SNR colour legend */}
          <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap", marginLeft: "auto" }}>
            {snrLegend.map((s) => (
              <span
                key={s.label}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.3rem",
                  fontSize: "0.68rem",
                  fontFamily: "monospace",
                  color: "#64748b",
                }}
              >
                <span
                  style={{
                    display: "inline-block",
                    width: "1.5rem",
                    height: "3px",
                    background: s.color,
                    borderRadius: "2px",
                  }}
                />
                {s.label}
              </span>
            ))}
          </div>
        </div>
        <div
          ref={neighborRef}
          style={{ background: "#020617", borderRadius: "0.375rem", overflow: "hidden" }}
        >
          {neighbors === null ? (
            <div
              style={{
                height: 420,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div className="analytics-spinner" />
            </div>
          ) : (
            <MeshGraph
              graphData={neighborGraphData}
              graphWidth={neighborWidth}
              emptyMessage="No NEIGHBORINFO_APP packets recorded — nodes must have neighbor broadcast enabled and be received directly over radio."
            />
          )}
        </div>
      </ChartCard>

      {/* Hop Distribution */}
      <ChartCard title="Hop Distance Distribution">
        {hops === null ? (
          <Loading />
        ) : hops.length === 0 ? (
          <Empty message="No nodes with hop data" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={hopRows}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
              <XAxis dataKey="label" tick={TICK_STYLE} />
              <YAxis tick={TICK_STYLE} allowDecimals={false} />
              <Tooltip {...TOOLTIP_STYLE} />
              <Bar dataKey="count" name="Nodes" fill="#60a5fa" />
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Hardware Breakdown */}
      <ChartCard title="Hardware Breakdown">
        {hardware === null ? (
          <Loading />
        ) : hardware.length === 0 ? (
          <Empty />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                dataKey="count"
                data={hardware}
                nameKey="hwModelName"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={2}
              >
                {hardware.map((_, i) => (
                  <Cell key={i} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip {...TOOLTIP_STYLE} />
              <Legend
                wrapperStyle={styles.legendWrap}
                formatter={(value) => (
                  <span style={{ color: "#94a3b8", fontSize: "0.7rem", fontFamily: "monospace" }}>
                    {value}
                  </span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Traceroute Topology — secondary graph */}
      <ChartCard title="Traceroute Topology" fullWidth>
        {routes && (
          <div
            style={{
              color: "#64748b",
              fontSize: "0.7rem",
              fontFamily: "monospace",
              marginBottom: "0.6rem",
            }}
          >
            {tracerouteGraphData.nodes.length} nodes · {tracerouteGraphData.links.length} links
          </div>
        )}
        <div
          ref={tracerouteRef}
          style={{ background: "#020617", borderRadius: "0.375rem", overflow: "hidden" }}
        >
          {routes === null ? (
            <div
              style={{
                height: 360,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div className="analytics-spinner" />
            </div>
          ) : (
            <MeshGraph
              graphData={tracerouteGraphData}
              graphWidth={tracerouteWidth}
              height={360}
              emptyMessage="No traceroute data in this window"
            />
          )}
        </div>
      </ChartCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 4 — Telemetry
// ---------------------------------------------------------------------------

function TelemetryTab({ nodes, mqttNodes }: { nodes: NodeInfo[]; mqttNodes: MqttNode[] }) {
  const [since, setSince] = useState("24h");
  const [data, setData] = useState<TelemetryPoint[] | null>(null);

  useEffect(() => {
    setData(null);
    analyticsApi
      .telemetryHistory({ since })
      .then(setData)
      .catch(() => setData([]));
  }, [since]);

  // Unique node IDs present in the dataset
  const allNodes = useMemo(() => {
    if (!data) return [];
    const seen = new Map<number, number>();
    for (const p of data) seen.set(p.nodeId, (seen.get(p.nodeId) ?? 0) + 1);
    return [...seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id]) => id);
  }, [data]);

  // Pivot helper: one row per ts, keyed by nodeId string
  function pivotField(field: keyof TelemetryPoint) {
    if (!data) return [];
    const byTs = new Map<string, Record<string, unknown>>();
    for (const p of data) {
      if (!allNodes.includes(p.nodeId)) continue;
      if (!byTs.has(p.ts)) byTs.set(p.ts, { ts: p.ts });
      const v = p[field];
      if (v !== null) byTs.get(p.ts)![String(p.nodeId)] = v;
    }
    return [...byTs.values()].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  }

  const hasDevice = data !== null && data.some((p) => p.variantCase === "deviceMetrics");
  const hasEnv = data !== null && data.some((p) => p.variantCase === "environmentMetrics");

  const noData = data !== null && data.length === 0;

  const commonLine = (id: number) => (
    <Line
      key={id}
      dataKey={String(id)}
      name={nodeName(id, nodes, mqttNodes)}
      stroke={nodeColor(id)}
      dot={false}
      connectNulls
    />
  );

  const commonAxes = (unit: string) => (
    <>
      <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
      <XAxis dataKey="ts" tickFormatter={(v) => formatTs(v)} tick={TICK_STYLE} />
      <YAxis tick={TICK_STYLE} unit={` ${unit}`} />
      <Tooltip {...TOOLTIP_STYLE} labelFormatter={(v) => new Date(v as string).toLocaleString()} />
      <Legend wrapperStyle={styles.legendWrap} />
    </>
  );

  return (
    <div style={styles.grid}>
      <div style={{ gridColumn: "1 / -1" }}>
        <RangeBtn options={["1h", "6h", "24h", "7d"]} value={since} onChange={setSince} />
        {noData && (
          <div
            style={{
              color: "#64748b",
              fontSize: "0.75rem",
              fontFamily: "monospace",
              marginTop: "0.5rem",
            }}
          >
            No telemetry data yet. TELEMETRY_APP packets will be decoded and stored as they arrive
            from connected devices.
          </div>
        )}
      </div>

      {/* Device Metrics */}
      <ChartCard title="Battery Level (%)">
        {data === null ? (
          <Loading />
        ) : !hasDevice ? (
          <Empty message="No device metrics" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={pivotField("batteryLevel")}>
              {commonAxes("%")}
              {allNodes.map(commonLine)}
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Voltage (V)">
        {data === null ? (
          <Loading />
        ) : !hasDevice ? (
          <Empty message="No device metrics" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={pivotField("voltage")}>
              {commonAxes("V")}
              {allNodes.map(commonLine)}
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Channel Utilization (%)">
        {data === null ? (
          <Loading />
        ) : !hasDevice ? (
          <Empty message="No device metrics" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={pivotField("channelUtilization")}>
              {commonAxes("%")}
              {allNodes.map(commonLine)}
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Air TX Utilization (%)">
        {data === null ? (
          <Loading />
        ) : !hasDevice ? (
          <Empty message="No device metrics" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={pivotField("airUtilTx")}>
              {commonAxes("%")}
              {allNodes.map(commonLine)}
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Environment Metrics */}
      <ChartCard title="Temperature (°C)">
        {data === null ? (
          <Loading />
        ) : !hasEnv ? (
          <Empty message="No environment sensor data" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={pivotField("temperature")}>
              {commonAxes("°C")}
              {allNodes.map(commonLine)}
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Humidity (%)">
        {data === null ? (
          <Loading />
        ) : !hasEnv ? (
          <Empty message="No environment sensor data" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={pivotField("relativeHumidity")}>
              {commonAxes("%")}
              {allNodes.map(commonLine)}
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      <ChartCard title="Barometric Pressure (hPa)" fullWidth>
        {data === null ? (
          <Loading />
        ) : !hasEnv ? (
          <Empty message="No environment sensor data" />
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={pivotField("barometricPressure")}>
              {commonAxes("hPa")}
              {allNodes.map(commonLine)}
            </LineChart>
          </ResponsiveContainer>
        )}
      </ChartCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 5 — Packets
// ---------------------------------------------------------------------------

function PacketsTab() {
  const [since, setSince] = useState("24h");
  const [portnum, setPortnum] = useState<PortnumCount[] | null>(null);
  const [timeline, setTimeline] = useState<PacketTimelinePoint[] | null>(null);
  const [logFilter, setLogFilter] = useState("");
  const [packetLog, setPacketLog] = useState<PacketLogEntry[] | null>(null);

  const bucket = since === "7d" ? "hour" : "hour";

  useEffect(() => {
    setPortnum(null);
    analyticsApi
      .portnumBreakdown({ since })
      .then(setPortnum)
      .catch(() => setPortnum([]));
  }, [since]);

  useEffect(() => {
    setTimeline(null);
    analyticsApi
      .packetTimeline({ since, bucket })
      .then(setTimeline)
      .catch(() => setTimeline([]));
  }, [since, bucket]);

  useEffect(() => {
    setPacketLog(null);
    analyticsApi
      .packetLog({ since, limit: 200, portnum: logFilter || undefined })
      .then(setPacketLog)
      .catch(() => setPacketLog([]));
  }, [since, logFilter]);

  function nodeHex(id: number) {
    return `!${id.toString(16).padStart(8, "0")}`;
  }

  function handleCsvExport() {
    const params = new URLSearchParams({ since });
    if (logFilter) params.set("portnum", logFilter);
    window.open(`/api/analytics/packet-log.csv?${params}`, "_blank");
  }

  // Top 6 portnums for the area chart; rest → "Other"
  const topPortnums = useMemo(() => {
    if (!portnum) return [];
    return portnum.slice(0, 6).map((p) => p.portnumName);
  }, [portnum]);

  // Flatten packet timeline for recharts: one object per ts with portnum keys
  const timelineFlat = useMemo(() => {
    if (!timeline) return [];
    return timeline.map((pt) => {
      const row: Record<string, unknown> = { ts: pt.ts };
      let other = 0;
      for (const [k, v] of Object.entries(pt.counts)) {
        if (topPortnums.includes(k)) row[k] = v;
        else other += v;
      }
      if (other > 0) row["Other"] = other;
      return row;
    });
  }, [timeline, topPortnums]);

  const areaKeys =
    topPortnums.length > 0
      ? [
          ...topPortnums,
          ...(timeline?.some((pt) => {
            let hasOther = false;
            for (const k of Object.keys(pt.counts)) {
              if (!topPortnums.includes(k)) {
                hasOther = true;
                break;
              }
            }
            return hasOther;
          })
            ? ["Other"]
            : []),
        ]
      : [];

  return (
    <div style={styles.grid}>
      <div style={{ gridColumn: "1 / -1" }}>
        <RangeBtn options={["1h", "6h", "24h", "7d"]} value={since} onChange={setSince} />
      </div>

      {/* Portnum Breakdown */}
      <ChartCard title="Packet Type Breakdown">
        {portnum === null ? (
          <Loading />
        ) : portnum.length === 0 ? (
          <Empty />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie
                dataKey="count"
                data={portnum}
                nameKey="portnumName"
                innerRadius={60}
                outerRadius={100}
                paddingAngle={2}
              >
                {portnum.map((_, i) => (
                  <Cell key={i} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />
                ))}
              </Pie>
              <Tooltip {...TOOLTIP_STYLE} />
              <Legend
                wrapperStyle={styles.legendWrap}
                formatter={(value) => (
                  <span style={{ color: "#94a3b8", fontSize: "0.68rem", fontFamily: "monospace" }}>
                    {value}
                  </span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Packet Timeline */}
      <ChartCard title="Packet Volume over Time" fullWidth>
        {timeline === null ? (
          <Loading />
        ) : timeline.length === 0 ? (
          <Empty />
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <AreaChart data={timelineFlat}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} />
              <XAxis dataKey="ts" tickFormatter={(v) => formatTs(v)} tick={TICK_STYLE} />
              <YAxis tick={TICK_STYLE} allowDecimals={false} />
              <Tooltip
                {...TOOLTIP_STYLE}
                labelFormatter={(v) => new Date(v as string).toLocaleString()}
              />
              <Legend wrapperStyle={styles.legendWrap} />
              {areaKeys.map((key, i) => (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stackId="a"
                  fill={PIE_PALETTE[i % PIE_PALETTE.length] + "80"}
                  stroke={PIE_PALETTE[i % PIE_PALETTE.length]}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Raw Packet Log */}
      <ChartCard title="Packet Log" fullWidth>
        <div
          style={{
            display: "flex",
            gap: "0.5rem",
            alignItems: "center",
            marginBottom: "0.6rem",
            flexWrap: "wrap",
          }}
        >
          <select
            value={logFilter}
            onChange={(e) => setLogFilter(e.target.value)}
            style={{
              background: "#1e293b",
              color: "#94a3b8",
              border: "1px solid #334155",
              borderRadius: "0.3rem",
              padding: "0.2rem 0.4rem",
              fontSize: "0.7rem",
              fontFamily: "monospace",
            }}
          >
            <option value="">All types</option>
            {(portnum ?? []).map((p) => (
              <option key={p.portnumName} value={p.portnumName}>
                {p.portnumName}
              </option>
            ))}
          </select>
          <span style={{ color: "#64748b", fontSize: "0.7rem", fontFamily: "monospace", flex: 1 }}>
            {packetLog !== null ? `${packetLog.length} rows (latest 200)` : "loading…"}
          </span>
          <button
            onClick={handleCsvExport}
            style={{
              background: "#1e3a5f",
              color: "#93c5fd",
              border: "1px solid #3b82f6",
              borderRadius: "0.3rem",
              padding: "0.2rem 0.6rem",
              fontSize: "0.7rem",
              fontFamily: "monospace",
              cursor: "pointer",
            }}
          >
            Export CSV
          </button>
        </div>
        {packetLog === null ? (
          <Loading />
        ) : packetLog.length === 0 ? (
          <Empty message="No packets in this time window." />
        ) : (
          <div style={{ overflowX: "auto", maxHeight: "400px", overflowY: "auto" }}>
            <table
              style={{
                borderCollapse: "collapse",
                fontFamily: "monospace",
                fontSize: "0.65rem",
                width: "100%",
              }}
            >
              <thead>
                <tr style={{ background: "#1e293b", position: "sticky", top: 0 }}>
                  {["Time", "From", "To", "Type", "SNR", "RSSI", "Hops", "MQTT"].map((h) => (
                    <th
                      key={h}
                      style={{
                        padding: "0.3rem 0.5rem",
                        color: "#94a3b8",
                        textAlign: "left",
                        borderBottom: "1px solid #334155",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {packetLog.map((p) => (
                  <tr key={p.id} style={{ borderBottom: "1px solid #1e293b" }}>
                    <td style={styles.logCell}>{new Date(p.rxTime).toLocaleTimeString()}</td>
                    <td style={styles.logCell}>{nodeHex(p.fromNodeId)}</td>
                    <td style={styles.logCell}>{nodeHex(p.toNodeId)}</td>
                    <td style={{ ...styles.logCell, color: "#7dd3fc" }}>
                      {p.portnumName.replace(/_APP$/, "")}
                    </td>
                    <td
                      style={{
                        ...styles.logCell,
                        color:
                          p.rxSnr != null
                            ? p.rxSnr > 0
                              ? "#4ade80"
                              : p.rxSnr > -10
                                ? "#fbbf24"
                                : "#f87171"
                            : "#475569",
                      }}
                    >
                      {p.rxSnr != null ? `${p.rxSnr.toFixed(1)}` : "—"}
                    </td>
                    <td style={{ ...styles.logCell, color: "#94a3b8" }}>
                      {p.rxRssi != null ? p.rxRssi : "—"}
                    </td>
                    <td style={{ ...styles.logCell, color: "#94a3b8" }}>
                      {p.hopLimit != null && p.hopStart != null
                        ? `${p.hopStart - p.hopLimit}/${p.hopStart}`
                        : (p.hopLimit ?? "—")}
                    </td>
                    <td style={{ ...styles.logCell, color: p.viaMqtt ? "#818cf8" : "#334155" }}>
                      {p.viaMqtt ? "yes" : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 6 — Link Quality Matrix
// ---------------------------------------------------------------------------

function LinkQualityTab({ nodes, mqttNodes }: { nodes: NodeInfo[]; mqttNodes: MqttNode[] }) {
  const [since, setSince] = useState("7d");
  const [data, setData] = useState<LinkQualityEntry[] | null>(null);

  useEffect(() => {
    setData(null);
    analyticsApi
      .linkQuality({ since })
      .then(setData)
      .catch(() => setData([]));
  }, [since]);

  // Collect unique node IDs, sorted by total message count
  const nodeIds = useMemo(() => {
    if (!data) return [];
    const totals = new Map<number, number>();
    for (const e of data) {
      totals.set(e.fromNodeId, (totals.get(e.fromNodeId) ?? 0) + e.messageCount);
      totals.set(e.toNodeId, (totals.get(e.toNodeId) ?? 0) + e.messageCount);
    }
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([id]) => id);
  }, [data]);

  // Build a lookup: `${from}_${to}` → avgSnr
  const snrMap = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const e of data ?? []) {
      m.set(`${e.fromNodeId}_${e.toNodeId}`, e.avgSnr);
      // Mirror: if we have A→B but not B→A, use the same value
      if (!m.has(`${e.toNodeId}_${e.fromNodeId}`)) {
        m.set(`${e.toNodeId}_${e.fromNodeId}`, e.avgSnr);
      }
    }
    return m;
  }, [data]);

  function cellColor(snr: number | null): string {
    if (snr === null) return "#0f172a";
    if (snr > 0) return "#14532d";
    if (snr > -5) return "#166534";
    if (snr > -10) return "#854d0e";
    if (snr > -15) return "#7c2d12";
    return "#450a0a";
  }
  function cellText(snr: number | null): string {
    if (snr === null) return "";
    return `${snr > 0 ? "+" : ""}${snr.toFixed(1)}`;
  }

  const shortName = (id: number) => {
    const n = (nodes as Array<NodeInfo | MqttNode>).concat(mqttNodes).find((x) => x.nodeId === id);
    return n?.shortName ?? nodeHex(id).slice(-4);
  };

  return (
    <div style={styles.grid}>
      <div style={{ gridColumn: "1 / -1" }}>
        <RangeBtn options={["24h", "7d", "30d", "all"]} value={since} onChange={setSince} />
        <div
          style={{
            color: "#64748b",
            fontSize: "0.7rem",
            fontFamily: "monospace",
            marginTop: "0.25rem",
          }}
        >
          Average SNR (dB) per node pair · top 20 most active nodes shown
        </div>
      </div>

      <ChartCard title="Link Quality Matrix (SNR dB)" fullWidth>
        {data === null ? (
          <Loading />
        ) : data.length === 0 ? (
          <Empty message="No SNR data in this time window. Link quality requires packets received directly over radio — MQTT-relayed packets do not carry rx_snr." />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{ borderCollapse: "collapse", fontFamily: "monospace", fontSize: "0.65rem" }}
            >
              <thead>
                <tr>
                  <th style={styles.matrixCorner} />
                  {nodeIds.map((id) => (
                    <th key={id} style={styles.matrixHeader} title={nodeName(id, nodes, mqttNodes)}>
                      {shortName(id)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {nodeIds.map((fromId) => (
                  <tr key={fromId}>
                    <td style={styles.matrixRowHeader} title={nodeName(fromId, nodes, mqttNodes)}>
                      {shortName(fromId)}
                    </td>
                    {nodeIds.map((toId) => {
                      if (fromId === toId) {
                        return (
                          <td key={toId} style={{ ...styles.matrixCell, background: "#1e293b" }} />
                        );
                      }
                      const snr = snrMap.get(`${fromId}_${toId}`) ?? null;
                      return (
                        <td
                          key={toId}
                          style={{
                            ...styles.matrixCell,
                            background: cellColor(snr),
                            color: snr !== null ? "#e2e8f0" : undefined,
                          }}
                          title={`${shortName(fromId)} → ${shortName(toId)}: ${snr !== null ? `${snr.toFixed(1)} dB` : "no data"}`}
                        >
                          {cellText(snr)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Legend */}
            <div style={{ display: "flex", gap: "1rem", marginTop: "0.75rem", flexWrap: "wrap" }}>
              {[
                { label: "> 0 dB", bg: "#14532d" },
                { label: "0 to -5", bg: "#166534" },
                { label: "-5 to -10", bg: "#854d0e" },
                { label: "-10 to -15", bg: "#7c2d12" },
                { label: "< -15 dB", bg: "#450a0a" },
                { label: "No data", bg: "#0f172a" },
              ].map((s) => (
                <span
                  key={s.label}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.35rem",
                    fontSize: "0.68rem",
                    fontFamily: "monospace",
                    color: "#64748b",
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      width: "0.9rem",
                      height: "0.9rem",
                      background: s.bg,
                      border: "1px solid #334155",
                      borderRadius: "2px",
                    }}
                  />
                  {s.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </ChartCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 7 — Node Activity Timeline
// ---------------------------------------------------------------------------

function ActivityTimelineTab({
  nodes,
  mqttNodes,
  devices,
}: {
  nodes: NodeInfo[];
  mqttNodes: MqttNode[];
  devices: DeviceInfo[];
}) {
  const [since, setSince] = useState("7d");
  const [data, setData] = useState<NodeActivityPoint[] | null>(null);
  const [showLocal, setShowLocal] = useState(false);

  const localNodeIds = useMemo(
    () => new Set(devices.map((d) => d.ownNodeId).filter((id): id is number => id != null)),
    [devices],
  );

  const bucket = since === "30d" || since === "all" ? "day" : "hour";

  useEffect(() => {
    setData(null);
    analyticsApi
      .nodeActivity({ since, bucket })
      .then(setData)
      .catch(() => setData([]));
  }, [since, bucket]);

  // Top 15 most active nodes (excluding local device unless toggled)
  const topNodes = useMemo(() => {
    if (!data) return [];
    const totals = new Map<number, number>();
    for (const p of data) {
      if (!showLocal && localNodeIds.has(p.nodeId)) continue;
      totals.set(p.nodeId, (totals.get(p.nodeId) ?? 0) + p.count);
    }
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([id]) => id);
  }, [data, showLocal, localNodeIds]);

  // Pivot: one row per ts bucket, columns = nodes
  const pivoted = useMemo(() => {
    if (!data) return [];
    const byTs = new Map<string, Record<string, unknown>>();
    for (const p of data) {
      if (!topNodes.includes(p.nodeId)) continue;
      if (!byTs.has(p.ts)) byTs.set(p.ts, { ts: p.ts });
      byTs.get(p.ts)![String(p.nodeId)] = p.count;
    }
    return [...byTs.values()].sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  }, [data, topNodes]);

  return (
    <div style={styles.grid}>
      <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: "1rem" }}>
        <RangeBtn options={["24h", "7d", "30d"]} value={since} onChange={setSince} />
        {localNodeIds.size > 0 && (
          <button
            onClick={() => setShowLocal((v) => !v)}
            style={{
              padding: "0.25rem 0.75rem",
              fontSize: "0.75rem",
              borderRadius: "0.375rem",
              border: "1px solid",
              borderColor: showLocal ? "#3b82f6" : "#475569",
              background: showLocal ? "#1d4ed8" : "transparent",
              color: showLocal ? "#fff" : "#94a3b8",
              cursor: "pointer",
            }}
          >
            {showLocal ? "Hide local device" : "Show local device"}
          </button>
        )}
      </div>

      <ChartCard title="Node Activity Timeline (packets per bucket)" fullWidth>
        {data === null ? (
          <Loading />
        ) : data.length === 0 ? (
          <Empty />
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(300, topNodes.length * 28 + 60)}>
            <BarChart layout="vertical" data={pivoted}>
              <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal={false} />
              <XAxis type="number" tick={TICK_STYLE} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="ts"
                width={90}
                tick={{ ...TICK_STYLE, fontSize: 10 }}
                tickFormatter={(v) => formatTs(v, bucket)}
              />
              <Tooltip
                {...TOOLTIP_STYLE}
                labelFormatter={(v) => new Date(v as string).toLocaleString()}
                formatter={(value, name) => [value, nodeName(Number(name), nodes, mqttNodes)]}
              />
              {topNodes.map((id) => (
                <Bar
                  key={id}
                  dataKey={String(id)}
                  name={String(id)}
                  stackId="a"
                  fill={nodeColor(id)}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Per-node packet count summary */}
      <ChartCard title="Total Activity by Node" fullWidth>
        {data === null ? (
          <Loading />
        ) : data.length === 0 ? (
          <Empty />
        ) : (
          (() => {
            const totals = new Map<number, number>();
            for (const p of data) {
              if (!showLocal && localNodeIds.has(p.nodeId)) continue;
              totals.set(p.nodeId, (totals.get(p.nodeId) ?? 0) + p.count);
            }
            const sorted = [...totals.entries()]
              .sort((a, b) => b[1] - a[1])
              .slice(0, 20)
              .map(([id, count]) => ({
                name: nodeName(id, nodes, mqttNodes),
                count,
              }));
            return (
              <ResponsiveContainer width="100%" height={Math.max(200, sorted.length * 26)}>
                <BarChart layout="vertical" data={sorted}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_COLOR} horizontal={false} />
                  <XAxis type="number" tick={TICK_STYLE} allowDecimals={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={150}
                    tick={{ ...TICK_STYLE, fontSize: 10 }}
                  />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Bar dataKey="count" name="Packets" fill="#60a5fa" />
                </BarChart>
              </ResponsiveContainer>
            );
          })()
        )}
      </ChartCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab 8 — Position History & Trail Map
// ---------------------------------------------------------------------------

const TRAIL_VIEW = { longitude: -98.5, latitude: 39.5, zoom: 3 };

function PositionsTab({ nodes, mqttNodes }: { nodes: NodeInfo[]; mqttNodes: MqttNode[] }) {
  const [since, setSince] = useState("24h");
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [data, setData] = useState<PositionRecord[] | null>(null);

  useEffect(() => {
    setData(null);
    analyticsApi
      .positionHistory({ since, nodeId: selectedNodeId ?? undefined, limit: 5000 })
      .then(setData)
      .catch(() => setData([]));
  }, [since, selectedNodeId]);

  // Unique nodes present in data
  const nodeIds = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.map((r) => r.nodeId))].sort((a, b) => a - b);
  }, [data]);

  // Build GeoJSON for map trails — one LineString feature per node (sorted chronologically)
  const trailGeoJson = useMemo((): GeoJSON.FeatureCollection => {
    if (!data || data.length === 0) return { type: "FeatureCollection", features: [] };
    const byNode = new Map<number, PositionRecord[]>();
    for (const r of data) {
      if (!byNode.has(r.nodeId)) byNode.set(r.nodeId, []);
      byNode.get(r.nodeId)!.push(r);
    }
    const features: GeoJSON.Feature[] = [];
    for (const [nodeId, fixes] of byNode) {
      const sorted = [...fixes].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
      if (sorted.length < 2) continue;
      features.push({
        type: "Feature",
        properties: { nodeId, color: nodeColor(nodeId) },
        geometry: {
          type: "LineString",
          coordinates: sorted.map((f) => [f.longitude, f.latitude]),
        },
      });
    }
    return { type: "FeatureCollection", features };
  }, [data]);

  // Latest fix per node for dot markers
  const latestFixes = useMemo(() => {
    if (!data || data.length === 0) return [] as PositionRecord[];
    const byNode = new Map<number, PositionRecord>();
    for (const r of data) {
      const existing = byNode.get(r.nodeId);
      if (!existing || r.recordedAt > existing.recordedAt) byNode.set(r.nodeId, r);
    }
    return [...byNode.values()];
  }, [data]);

  const latestGeoJson = useMemo(
    (): GeoJSON.FeatureCollection => ({
      type: "FeatureCollection",
      features: latestFixes.map((f) => ({
        type: "Feature",
        properties: { nodeId: f.nodeId, color: nodeColor(f.nodeId) },
        geometry: { type: "Point", coordinates: [f.longitude, f.latitude] },
      })),
    }),
    [latestFixes],
  );

  // Table rows sorted newest first
  const tableRows = useMemo(
    () =>
      (data ?? [])
        .slice()
        .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
        .slice(0, 500),
    [data],
  );

  return (
    <div style={styles.grid}>
      {/* Controls */}
      <div
        style={{
          gridColumn: "1 / -1",
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <RangeBtn
          options={["1h", "6h", "24h", "7d", "30d", "all"]}
          value={since}
          onChange={setSince}
        />
        <select
          value={selectedNodeId ?? ""}
          onChange={(e) => setSelectedNodeId(e.target.value ? Number(e.target.value) : null)}
          style={{
            background: "#0f172a",
            color: "#e2e8f0",
            border: "1px solid #1e293b",
            borderRadius: "0.25rem",
            padding: "0.15rem 0.4rem",
            fontFamily: "monospace",
            fontSize: "0.72rem",
          }}
        >
          <option value="">All nodes</option>
          {nodeIds.map((id) => (
            <option key={id} value={id}>
              {nodeName(id, nodes, mqttNodes)}
            </option>
          ))}
        </select>
        {data && (
          <span style={{ color: "#64748b", fontSize: "0.7rem", fontFamily: "monospace" }}>
            {data.length.toLocaleString()} fixes · {nodeIds.length} node
            {nodeIds.length !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* Trail Map */}
      <ChartCard title="Position Trails" fullWidth>
        {data === null ? (
          <Loading />
        ) : data.length === 0 ? (
          <Empty message="No position fixes recorded yet. Position data is saved when nodes broadcast GPS packets." />
        ) : (
          <div style={{ height: 420, borderRadius: "0.375rem", overflow: "hidden" }}>
            <MapGL
              initialViewState={TRAIL_VIEW}
              style={{ width: "100%", height: "100%" }}
              mapStyle={MAP_STYLE}
              attributionControl={false}
            >
              <NavigationControl position="top-right" />
              {/* Trail lines */}
              <Source id="trails" type="geojson" data={trailGeoJson}>
                <Layer
                  id="trail-lines"
                  type="line"
                  paint={{
                    "line-color": ["get", "color"],
                    "line-width": 2,
                    "line-opacity": 0.8,
                  }}
                />
              </Source>
              {/* Latest position dots */}
              <Source id="dots" type="geojson" data={latestGeoJson}>
                <Layer
                  id="dot-circles"
                  type="circle"
                  paint={{
                    "circle-color": ["get", "color"],
                    "circle-radius": 6,
                    "circle-stroke-color": "#0f172a",
                    "circle-stroke-width": 1.5,
                  }}
                />
              </Source>
            </MapGL>
          </div>
        )}
      </ChartCard>

      {/* Recent fixes table */}
      <ChartCard title="Recent Position Fixes (newest first, max 500 shown)" fullWidth>
        {data === null ? (
          <Loading />
        ) : tableRows.length === 0 ? (
          <Empty />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table
              style={{
                borderCollapse: "collapse",
                fontFamily: "monospace",
                fontSize: "0.68rem",
                width: "100%",
              }}
            >
              <thead>
                <tr>
                  {[
                    "Node",
                    "Lat",
                    "Lon",
                    "Alt (m)",
                    "Speed (m/s)",
                    "Track °",
                    "Sats",
                    "Recorded",
                  ].map((h) => (
                    <th key={h} style={styles.matrixHeader}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((r) => (
                  <tr key={r.id} style={{ borderBottom: "1px solid #1e293b" }}>
                    <td style={styles.matrixRowHeader}>
                      <span
                        style={{
                          display: "inline-block",
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: nodeColor(r.nodeId),
                          marginRight: 5,
                          verticalAlign: "middle",
                        }}
                      />
                      {nodeName(r.nodeId, nodes, mqttNodes)}
                    </td>
                    <td style={styles.matrixCell}>{r.latitude.toFixed(5)}</td>
                    <td style={styles.matrixCell}>{r.longitude.toFixed(5)}</td>
                    <td style={styles.matrixCell}>{r.altitude ?? "—"}</td>
                    <td style={styles.matrixCell}>{r.speed != null ? r.speed.toFixed(1) : "—"}</td>
                    <td style={styles.matrixCell}>
                      {r.groundTrack != null ? r.groundTrack.toFixed(0) : "—"}
                    </td>
                    <td style={styles.matrixCell}>{r.satsInView ?? "—"}</td>
                    <td style={styles.matrixCell}>{new Date(r.recordedAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ChartCard>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main AnalyticsPage
// ---------------------------------------------------------------------------

type AnalyticsTab =
  | "signal"
  | "messages"
  | "network"
  | "telemetry"
  | "packets"
  | "linkquality"
  | "timeline"
  | "positions";

interface Props {
  nodes: NodeInfo[];
  mqttNodes: MqttNode[];
  devices: DeviceInfo[];
}

export function AnalyticsPage({ nodes, mqttNodes, devices }: Props) {
  const [tab, setTab] = useState<AnalyticsTab>("messages");

  return (
    <div style={styles.page}>
      {/* Sub-tab nav */}
      <div style={styles.subNav}>
        {(
          [
            "messages",
            "signal",
            "network",
            "telemetry",
            "packets",
            "linkquality",
            "timeline",
            "positions",
          ] as AnalyticsTab[]
        ).map((t) => (
          <button key={t} style={subTabStyle(tab === t)} onClick={() => setTab(t)}>
            {t === "linkquality"
              ? "Link Quality"
              : t === "timeline"
                ? "Timeline"
                : t === "positions"
                  ? "Positions"
                  : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {tab === "signal" && <SignalTab nodes={nodes} mqttNodes={mqttNodes} />}
      {tab === "messages" && <MessagesTab nodes={nodes} mqttNodes={mqttNodes} />}
      {tab === "network" && <NetworkTab nodes={nodes} mqttNodes={mqttNodes} />}
      {tab === "telemetry" && <TelemetryTab nodes={nodes} mqttNodes={mqttNodes} />}
      {tab === "packets" && <PacketsTab />}
      {tab === "linkquality" && <LinkQualityTab nodes={nodes} mqttNodes={mqttNodes} />}
      {tab === "timeline" && (
        <ActivityTimelineTab nodes={nodes} mqttNodes={mqttNodes} devices={devices} />
      )}
      {tab === "positions" && <PositionsTab nodes={nodes} mqttNodes={mqttNodes} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function subTabStyle(active: boolean): React.CSSProperties {
  return {
    background: "transparent",
    color: active ? "#e2e8f0" : "#64748b",
    border: "none",
    borderBottom: active ? "2px solid #3b82f6" : "2px solid transparent",
    padding: "0.3rem 0.9rem",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: "0.8rem",
    marginBottom: "-1px",
  };
}

function rangeStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? "#1e3a5f" : "#0f172a",
    color: active ? "#60a5fa" : "#64748b",
    border: `1px solid ${active ? "#3b82f6" : "#1e293b"}`,
    padding: "0.15rem 0.5rem",
    borderRadius: "0.25rem",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: "0.72rem",
  };
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    padding: "1rem 1.5rem",
    display: "flex",
    flexDirection: "column",
    height: "100%",
    boxSizing: "border-box",
    overflowY: "auto",
  },
  subNav: {
    display: "flex",
    gap: "0.1rem",
    borderBottom: "1px solid #1e293b",
    marginBottom: "1rem",
    flexShrink: 0,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: "1rem",
    alignItems: "start",
  },
  card: {
    background: "#0f172a",
    borderRadius: "0.5rem",
    padding: "1rem",
    border: "1px solid #1e293b",
  },
  cardTitle: {
    fontSize: "0.7rem",
    fontWeight: "bold",
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: "#64748b",
    paddingBottom: "0.5rem",
    borderBottom: "1px solid #1e293b",
    marginBottom: "0.75rem",
  },
  empty: {
    height: "160px",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#475569",
    fontSize: "0.75rem",
    fontFamily: "monospace",
  },
  legendWrap: {
    fontSize: "0.7rem",
    fontFamily: "monospace",
    color: "#94a3b8",
  },
  subLabel: {
    fontSize: "0.65rem",
    fontWeight: "bold",
    letterSpacing: "0.06em",
    textTransform: "uppercase" as const,
    color: "#475569",
    marginBottom: "0.3rem",
    marginTop: "0.5rem",
  },
  errorRow: {
    display: "flex",
    justifyContent: "space-between",
    fontSize: "0.72rem",
    fontFamily: "monospace",
    padding: "0.1rem 0",
  },
  deliverySummary: {
    fontSize: "0.72rem",
    fontFamily: "monospace",
    color: "#94a3b8",
    marginBottom: "0.25rem",
  },
  latencySummary: {
    display: "flex",
    gap: "1.5rem",
    fontSize: "0.72rem",
    fontFamily: "monospace",
    color: "#64748b",
    marginBottom: "0.5rem",
  },
  matrixCorner: {
    padding: "0.2rem 0.4rem",
    background: "#020617",
  },
  matrixHeader: {
    padding: "0.2rem 0.4rem",
    textAlign: "center" as const,
    color: "#94a3b8",
    background: "#020617",
    borderBottom: "1px solid #1e293b",
    fontWeight: "normal",
    whiteSpace: "nowrap" as const,
    maxWidth: "5rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  matrixRowHeader: {
    padding: "0.2rem 0.5rem",
    color: "#94a3b8",
    background: "#020617",
    borderRight: "1px solid #1e293b",
    whiteSpace: "nowrap" as const,
    maxWidth: "8rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  matrixCell: {
    padding: "0.2rem 0.4rem",
    textAlign: "center" as const,
    fontSize: "0.62rem",
    color: "#64748b",
    border: "1px solid #0f172a",
  },
  logCell: {
    padding: "0.25rem 0.5rem",
    color: "#94a3b8",
    whiteSpace: "nowrap" as const,
  },
};
