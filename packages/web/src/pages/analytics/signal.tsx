import { formatNodeId as nodeHex, resolveNodeName } from "@foreman/shared";
import { useMemo, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
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
  RangeBtn,
  TICK_STYLE,
  TOOLTIP_STYLE,
  formatTs,
  nodeColor,
  nodeName,
  styles,
} from "./components.js";
import { useAnalyticsQuery } from "./useAnalyticsQuery.js";

import type { LinkQualityEntry, SnrHistoryPoint } from "../../api/analytics.js";
import type { MqttNode, NodeInfo } from "@foreman/shared";

// Tab 1 — Signal Quality
// ---------------------------------------------------------------------------

export function SignalTab({ nodes, mqttNodes }: { nodes: NodeInfo[]; mqttNodes: MqttNode[] }) {
  const [since, setSince] = useState("24h");
  const { data: snrData } = useAnalyticsQuery<SnrHistoryPoint[]>(
    (signal) => analyticsApi.snrHistory({ since }, signal),
    [since],
    [],
  );

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
// Tab 6 — Link Quality Matrix
// ---------------------------------------------------------------------------

export function LinkQualityTab({ nodes, mqttNodes }: { nodes: NodeInfo[]; mqttNodes: MqttNode[] }) {
  const [since, setSince] = useState("7d");
  const { data } = useAnalyticsQuery<LinkQualityEntry[]>(
    (signal) => analyticsApi.linkQuality({ since }, signal),
    [since],
    [],
  );

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
    return resolveNodeName(id, n ?? {}, {
      preference: ["shortName"],
      fallback: nodeHex(id).slice(-4),
    });
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
