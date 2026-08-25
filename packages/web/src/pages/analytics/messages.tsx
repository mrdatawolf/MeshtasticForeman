import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import * as analyticsApi from "../../api/analytics.js";

import {
  ChartCard,
  Empty,
  GRID_COLOR,
  Loading,
  ROLE_COLORS,
  RangeBtn,
  TICK_STYLE,
  TOOLTIP_STYLE,
  formatMs,
  formatTs,
  nodeColor,
  nodeName,
  styles,
} from "./components.js";
import { useAnalyticsQuery } from "./useAnalyticsQuery.js";

import type {
  BusiestNode,
  ChannelBucket,
  LatencyHistogram,
  MessageDeliveryStats,
  MessageVolumePoint,
  NodeActivityPoint,
} from "../../api/analytics.js";
import type { DeviceInfo, MqttNode, NodeInfo } from "@foreman/shared";

// Tab 2 — Messages
// ---------------------------------------------------------------------------

export function MessagesTab({ nodes, mqttNodes }: { nodes: NodeInfo[]; mqttNodes: MqttNode[] }) {
  const [since, setSince] = useState("7d");
  const bucket = since === "30d" ? "day" : "hour";

  const { data: volume } = useAnalyticsQuery<MessageVolumePoint[]>(
    (signal) => analyticsApi.messageVolume({ since, bucket }, signal),
    [since, bucket],
    [],
  );
  const { data: delivery } = useAnalyticsQuery<MessageDeliveryStats>(
    (signal) => analyticsApi.messageDelivery({ since }, signal),
    [since],
    { acked: 0, pending: 0, error: 0, total: 0, errorTypes: [] },
  );
  const { data: busiest } = useAnalyticsQuery<BusiestNode[]>(
    (signal) => analyticsApi.busiestNodes({ since }, signal),
    [since],
    [],
  );
  const { data: channels } = useAnalyticsQuery<ChannelBucket[]>(
    (signal) => analyticsApi.channelUtilization({ since }, signal),
    [since],
    [],
  );
  const { data: latency } = useAnalyticsQuery<LatencyHistogram>(
    (signal) => analyticsApi.messageLatency({ since }, signal),
    [since],
  );

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
// Tab 7 — Node Activity Timeline
// ---------------------------------------------------------------------------

export function ActivityTimelineTab({
  nodes,
  mqttNodes,
  devices,
}: {
  nodes: NodeInfo[];
  mqttNodes: MqttNode[];
  devices: DeviceInfo[];
}) {
  const [since, setSince] = useState("7d");
  const [showLocal, setShowLocal] = useState(false);

  const localNodeIds = useMemo(
    () => new Set(devices.map((d) => d.ownNodeId).filter((id): id is number => id != null)),
    [devices],
  );

  const bucket = since === "30d" || since === "all" ? "day" : "hour";
  const { data } = useAnalyticsQuery<NodeActivityPoint[]>(
    (signal) => analyticsApi.nodeActivity({ since, bucket }, signal),
    [since, bucket],
    [],
  );

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
