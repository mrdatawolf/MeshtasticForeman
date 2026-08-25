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

import { cx, styles } from "./analyticsStyles.js";
import {
  ChartCard,
  Empty,
  GRID_COLOR,
  LEGEND_WRAPPER_STYLE,
  Loading,
  RangeBtn,
  TICK_STYLE,
  TOOLTIP_STYLE,
  formatTs,
  nodeColor,
  nodeName,
} from "./components.js";
import localStyles from "./signal.module.css";
import { useAnalyticsQuery } from "./useAnalyticsQuery.js";

import type { LinkQualityEntry, SnrHistoryPoint } from "../../api/analytics.js";
import type { MqttNode, NodeInfo } from "@foreman/shared";
import type { CSSProperties } from "react";

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
    <div className={styles.grid}>
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
              <Legend wrapperStyle={LEGEND_WRAPPER_STYLE} />
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
              <Legend wrapperStyle={LEGEND_WRAPPER_STYLE} />
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

  function cellClass(snr: number | null): string {
    if (snr === null) return localStyles.snrCellNone;
    if (snr > 0) return localStyles.snrCellGreat;
    if (snr > -5) return localStyles.snrCellGood;
    if (snr > -10) return localStyles.snrCellFair;
    if (snr > -15) return localStyles.snrCellPoor;
    return localStyles.snrCellBad;
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
    <div className={styles.grid}>
      <div className={styles.gridSpan}>
        <RangeBtn options={["24h", "7d", "30d", "all"]} value={since} onChange={setSince} />
        <div className={localStyles.matrixCaption}>
          Average SNR (dB) per node pair · top 20 most active nodes shown
        </div>
      </div>

      <ChartCard title="Link Quality Matrix (SNR dB)" fullWidth>
        {data === null ? (
          <Loading />
        ) : data.length === 0 ? (
          <Empty message="No SNR data in this time window. Link quality requires packets received directly over radio — MQTT-relayed packets do not carry rx_snr." />
        ) : (
          <div className={localStyles.tableScroll}>
            <table className={localStyles.table}>
              <thead>
                <tr>
                  <th className={styles.matrixCorner} />
                  {nodeIds.map((id) => (
                    <th
                      key={id}
                      className={styles.matrixHeader}
                      title={nodeName(id, nodes, mqttNodes)}
                    >
                      {shortName(id)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {nodeIds.map((fromId) => (
                  <tr key={fromId}>
                    <td
                      className={styles.matrixRowHeader}
                      title={nodeName(fromId, nodes, mqttNodes)}
                    >
                      {shortName(fromId)}
                    </td>
                    {nodeIds.map((toId) => {
                      if (fromId === toId) {
                        return (
                          <td
                            key={toId}
                            className={cx(styles.matrixCell, localStyles.matrixCellDiag)}
                          />
                        );
                      }
                      const snr = snrMap.get(`${fromId}_${toId}`) ?? null;
                      return (
                        <td
                          key={toId}
                          className={cx(styles.matrixCell, cellClass(snr))}
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
            <div className={localStyles.legend}>
              {[
                { label: "> 0 dB", bg: "#14532d" },
                { label: "0 to -5", bg: "#166534" },
                { label: "-5 to -10", bg: "#854d0e" },
                { label: "-10 to -15", bg: "#7c2d12" },
                { label: "< -15 dB", bg: "#450a0a" },
                { label: "No data", bg: "#0f172a" },
              ].map((s) => (
                <span key={s.label} className={localStyles.legendItem}>
                  <span
                    className={localStyles.legendSwatch}
                    style={{ "--swatch-color": s.bg } as CSSProperties}
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
