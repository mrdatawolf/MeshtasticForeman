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

import type { TelemetryPoint } from "../../api/analytics.js";
import type { MqttNode, NodeInfo } from "@foreman/shared";

// Tab 4 — Telemetry
// ---------------------------------------------------------------------------

export function TelemetryTab({ nodes, mqttNodes }: { nodes: NodeInfo[]; mqttNodes: MqttNode[] }) {
  const [since, setSince] = useState("24h");
  const { data } = useAnalyticsQuery<TelemetryPoint[]>(
    (signal) => analyticsApi.telemetryHistory({ since }, signal),
    [since],
    [],
  );

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
