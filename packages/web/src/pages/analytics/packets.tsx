import { formatNodeId as nodeHex } from "@foreman/shared";
import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
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
  PIE_PALETTE,
  RangeBtn,
  TICK_STYLE,
  TOOLTIP_STYLE,
  formatTs,
  styles,
} from "./components.js";
import { useAnalyticsQuery } from "./useAnalyticsQuery.js";

import type { PacketLogEntry, PacketTimelinePoint, PortnumCount } from "../../api/analytics.js";

// Tab 5 — Packets
// ---------------------------------------------------------------------------

export function PacketsTab() {
  const [since, setSince] = useState("24h");
  const [logFilter, setLogFilter] = useState("");

  const bucket = since === "7d" ? "hour" : "hour";
  const { data: portnum } = useAnalyticsQuery<PortnumCount[]>(
    (signal) => analyticsApi.portnumBreakdown({ since }, signal),
    [since],
    [],
  );
  const { data: timeline } = useAnalyticsQuery<PacketTimelinePoint[]>(
    (signal) => analyticsApi.packetTimeline({ since, bucket }, signal),
    [since, bucket],
    [],
  );
  const { data: packetLog } = useAnalyticsQuery<PacketLogEntry[]>(
    (signal) =>
      analyticsApi.packetLog({ since, limit: 200, portnum: logFilter || undefined }, signal),
    [since, logFilter],
    [],
  );

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
