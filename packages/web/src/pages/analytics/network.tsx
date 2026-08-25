import { useEffect, useMemo, useRef, useState } from "react";
import {
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

import { styles } from "./analyticsStyles.js";
import {
  ChartCard,
  Empty,
  GRID_COLOR,
  LEGEND_WRAPPER_STYLE,
  Loading,
  MeshGraph,
  PIE_PALETTE,
  RangeBtn,
  TICK_STYLE,
  TOOLTIP_STYLE,
  nodeColor,
  nodeName,
  snrLinkColor,
  snrLinkWidth,
} from "./components.js";
import localStyles from "./network.module.css";
import { useAnalyticsQuery } from "./useAnalyticsQuery.js";

import type {
  HardwareBucket,
  HopBucket,
  NeighborLink,
  TracerouteRecord,
} from "../../api/analytics.js";
import type { MqttNode, NodeInfo } from "@foreman/shared";
import type { CSSProperties } from "react";

// Tab 3 — Network
// ---------------------------------------------------------------------------

export function NetworkTab({ nodes, mqttNodes }: { nodes: NodeInfo[]; mqttNodes: MqttNode[] }) {
  const [graphSince, setGraphSince] = useState("24h");
  const graphQuerySince = graphSince !== "all" ? graphSince : undefined;
  const { data: hops } = useAnalyticsQuery<HopBucket[]>(
    (signal) => analyticsApi.hopDistribution(undefined, signal),
    [],
    [],
  );
  const { data: hardware } = useAnalyticsQuery<HardwareBucket[]>(
    (signal) => analyticsApi.hardwareBreakdown(undefined, signal),
    [],
    [],
  );
  const { data: neighbors } = useAnalyticsQuery<NeighborLink[]>(
    (signal) => analyticsApi.neighborGraph({ since: graphQuerySince }, signal),
    [graphQuerySince],
    [],
  );
  const { data: routes } = useAnalyticsQuery<TracerouteRecord[]>(
    (signal) => analyticsApi.traceroutes({ since: graphQuerySince }, signal),
    [graphQuerySince],
    [],
  );

  const neighborRef = useRef<HTMLDivElement>(null);
  const tracerouteRef = useRef<HTMLDivElement>(null);
  const [neighborWidth, setNeighborWidth] = useState(600);
  const [tracerouteWidth, setTracerouteWidth] = useState(600);

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
    <div className={styles.grid}>
      {/* Range selector */}
      <div className={styles.gridSpan}>
        <RangeBtn
          options={["1h", "6h", "24h", "7d", "all"]}
          value={graphSince}
          onChange={setGraphSince}
        />
      </div>

      {/* Neighbor Info Graph — full width, primary topology view */}
      <ChartCard title="Neighbor Topology (SNR-coloured links)" fullWidth>
        <div className={localStyles.topologyHeader}>
          {neighbors && (
            <span className={localStyles.mutedNote}>
              {neighborGraphData.nodes.length} nodes · {neighborGraphData.links.length} links
              {neighbors.length === 0 && " — no NEIGHBORINFO_APP packets received yet"}
            </span>
          )}
          {/* SNR colour legend */}
          <div className={localStyles.snrLegend}>
            {snrLegend.map((s) => (
              <span key={s.label} className={localStyles.snrLegendItem}>
                <span
                  className={localStyles.snrSwatch}
                  style={{ "--swatch-color": s.color } as CSSProperties}
                />
                {s.label}
              </span>
            ))}
          </div>
        </div>
        <div ref={neighborRef} className={localStyles.graphContainer}>
          {neighbors === null ? (
            <div
              className={localStyles.graphPlaceholder}
              style={{ "--graph-height": "420px" } as CSSProperties}
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
                wrapperStyle={LEGEND_WRAPPER_STYLE}
                formatter={(value) => (
                  <span className={localStyles.legendFormatterLabel}>{value}</span>
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Traceroute Topology — secondary graph */}
      <ChartCard title="Traceroute Topology" fullWidth>
        {routes && (
          <div className={localStyles.routeCount}>
            {tracerouteGraphData.nodes.length} nodes · {tracerouteGraphData.links.length} links
          </div>
        )}
        <div ref={tracerouteRef} className={localStyles.graphContainer}>
          {routes === null ? (
            <div
              className={localStyles.graphPlaceholder}
              style={{ "--graph-height": "360px" } as CSSProperties}
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
