import { useMemo, useState } from "react";
import MapGL, { Source, Layer, NavigationControl } from "react-map-gl/maplibre";

import "maplibre-gl/dist/maplibre-gl.css";
import * as analyticsApi from "../../api/analytics.js";

import { cx, styles } from "./analyticsStyles.js";
import {
  ChartCard,
  Empty,
  Loading,
  MAP_STYLE,
  RangeBtn,
  nodeColor,
  nodeName,
} from "./components.js";
import localStyles from "./positions.module.css";
import { useAnalyticsQuery } from "./useAnalyticsQuery.js";

import type { PositionRecord } from "../../api/analytics.js";
import type { MqttNode, NodeInfo } from "@foreman/shared";
import type { CSSProperties } from "react";

// Tab 8 — Position History & Trail Map
// ---------------------------------------------------------------------------

const TRAIL_VIEW = { longitude: -98.5, latitude: 39.5, zoom: 3 };

export function PositionsTab({ nodes, mqttNodes }: { nodes: NodeInfo[]; mqttNodes: MqttNode[] }) {
  const [since, setSince] = useState("24h");
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const { data } = useAnalyticsQuery<PositionRecord[]>(
    (signal) =>
      analyticsApi.positionHistory(
        { since, nodeId: selectedNodeId ?? undefined, limit: 5000 },
        signal,
      ),
    [since, selectedNodeId],
    [],
  );

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
    <div className={styles.grid}>
      {/* Controls */}
      <div className={cx(styles.gridSpan, styles.controlsRow, styles.controlsRowWrap)}>
        <RangeBtn
          options={["1h", "6h", "24h", "7d", "30d", "all"]}
          value={since}
          onChange={setSince}
        />
        <select
          value={selectedNodeId ?? ""}
          onChange={(e) => setSelectedNodeId(e.target.value ? Number(e.target.value) : null)}
          className={localStyles.select}
        >
          <option value="">All nodes</option>
          {nodeIds.map((id) => (
            <option key={id} value={id}>
              {nodeName(id, nodes, mqttNodes)}
            </option>
          ))}
        </select>
        {data && (
          <span className={localStyles.mutedNote}>
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
          <div className={localStyles.mapWrap}>
            <MapGL
              initialViewState={TRAIL_VIEW}
              // react-map-gl's <Map> only accepts a `style` prop (verified via its
              // .d.ts) — no `className` alternative exists, see TASK-022b precedent.
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
          <div className={localStyles.tableScroll}>
            <table className={localStyles.table}>
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
                    <th key={h} className={styles.matrixHeader}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableRows.map((r) => (
                  <tr key={r.id} className={localStyles.tr}>
                    <td className={styles.matrixRowHeader}>
                      <span
                        className={localStyles.nodeDot}
                        style={{ "--dot-color": nodeColor(r.nodeId) } as CSSProperties}
                      />
                      {nodeName(r.nodeId, nodes, mqttNodes)}
                    </td>
                    <td className={styles.matrixCell}>{r.latitude.toFixed(5)}</td>
                    <td className={styles.matrixCell}>{r.longitude.toFixed(5)}</td>
                    <td className={styles.matrixCell}>{r.altitude ?? "—"}</td>
                    <td className={styles.matrixCell}>
                      {r.speed != null ? r.speed.toFixed(1) : "—"}
                    </td>
                    <td className={styles.matrixCell}>
                      {r.groundTrack != null ? r.groundTrack.toFixed(0) : "—"}
                    </td>
                    <td className={styles.matrixCell}>{r.satsInView ?? "—"}</td>
                    <td className={styles.matrixCell}>{new Date(r.recordedAt).toLocaleString()}</td>
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
