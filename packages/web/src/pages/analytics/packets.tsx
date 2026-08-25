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

import { cx, styles } from "./analyticsStyles.js";
import {
  ChartCard,
  Empty,
  GRID_COLOR,
  LEGEND_WRAPPER_STYLE,
  Loading,
  PIE_PALETTE,
  RangeBtn,
  TICK_STYLE,
  TOOLTIP_STYLE,
  formatTs,
} from "./components.js";
import localStyles from "./packets.module.css";
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
    <div className={styles.grid}>
      <div className={styles.gridSpan}>
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
                wrapperStyle={LEGEND_WRAPPER_STYLE}
                formatter={(value) => <span className={localStyles.legendLabel}>{value}</span>}
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
              <Legend wrapperStyle={LEGEND_WRAPPER_STYLE} />
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
        <div className={localStyles.controlsRow}>
          <select
            value={logFilter}
            onChange={(e) => setLogFilter(e.target.value)}
            className={localStyles.select}
          >
            <option value="">All types</option>
            {(portnum ?? []).map((p) => (
              <option key={p.portnumName} value={p.portnumName}>
                {p.portnumName}
              </option>
            ))}
          </select>
          <span className={localStyles.rowStatus}>
            {packetLog !== null ? `${packetLog.length} rows (latest 200)` : "loading…"}
          </span>
          <button onClick={handleCsvExport} className={localStyles.exportBtn}>
            Export CSV
          </button>
        </div>
        {packetLog === null ? (
          <Loading />
        ) : packetLog.length === 0 ? (
          <Empty message="No packets in this time window." />
        ) : (
          <div className={localStyles.logScroll}>
            <table className={localStyles.table}>
              <thead>
                <tr className={localStyles.stickyHeaderRow}>
                  {["Time", "From", "To", "Type", "SNR", "RSSI", "Hops", "MQTT"].map((h) => (
                    <th key={h} className={localStyles.th}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {packetLog.map((p) => (
                  <tr key={p.id} className={localStyles.tr}>
                    <td className={localStyles.logCell}>
                      {new Date(p.rxTime).toLocaleTimeString()}
                    </td>
                    <td className={localStyles.logCell}>{nodeHex(p.fromNodeId)}</td>
                    <td className={localStyles.logCell}>{nodeHex(p.toNodeId)}</td>
                    <td className={cx(localStyles.logCell, localStyles.logCellType)}>
                      {p.portnumName.replace(/_APP$/, "")}
                    </td>
                    <td
                      className={cx(
                        localStyles.logCell,
                        p.rxSnr == null
                          ? localStyles.logCellSnrNone
                          : p.rxSnr > 0
                            ? localStyles.logCellSnrGood
                            : p.rxSnr > -10
                              ? localStyles.logCellSnrOk
                              : localStyles.logCellSnrBad,
                      )}
                    >
                      {p.rxSnr != null ? `${p.rxSnr.toFixed(1)}` : "—"}
                    </td>
                    <td className={localStyles.logCell}>{p.rxRssi != null ? p.rxRssi : "—"}</td>
                    <td className={localStyles.logCell}>
                      {p.hopLimit != null && p.hopStart != null
                        ? `${p.hopStart - p.hopLimit}/${p.hopStart}`
                        : (p.hopLimit ?? "—")}
                    </td>
                    <td
                      className={cx(
                        localStyles.logCell,
                        p.viaMqtt ? localStyles.logCellMqttYes : localStyles.logCellMqttNo,
                      )}
                    >
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
