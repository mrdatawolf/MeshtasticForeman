import "maplibre-gl/dist/maplibre-gl.css";
import { formatNodeId as nodeHex, resolveNodeName } from "@foreman/shared";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { type MapRef, Marker, Popup } from "react-map-gl/maplibre";

import { MapCanvas } from "../components/map/MapCanvas.js";
import { MapControls } from "../components/map/MapControls.js";
import {
  channelNameToPreset,
  DEFAULT_RADIUS_KM,
  MAP_STYLE,
  MODEM_PRESET_RADIUS_KM,
  presetRadiusKm,
  TERRAIN_FETCH_RADIUS_KM,
  TERRAIN_MAP_STYLE,
} from "../components/map/mapCoverageConfig.js";
import {
  ageFilterBtnClass,
  cx,
  onOffBtnClass,
  styles as controlStyles,
} from "../components/map/mapStyles.js";
import { MeshPopup, MqttPopup } from "../components/map/NodePopups.js";
import { ProposalControls } from "../components/map/ProposalControls.js";
import { ProposalEditor } from "../components/map/ProposalEditor.js";
import { deleteViewshed, fetchElevation, fetchViewshed } from "../components/map/terrainApi.js";
import { buildCoverageCircle, clipViewshedToRadius } from "../lib/coordinateHelpers.js";
import { mergeCoveragePolygons } from "../lib/coverageMath.js";
import { foremanClient } from "../ws/client.js";

import styles from "./MapPage.module.css";

export { channelNameToPreset } from "../components/map/mapCoverageConfig.js";

import type { NodeInfo, MqttNode, DeviceConfig, CoverageProposal } from "@foreman/shared";
import type { CSSProperties } from "react";

type PendingMapAction = { nodeId: number; action: "ping" | "traceroute" };

function nodeColor(nodeId: number): string {
  const hue = (nodeId * 137.508) % 360;
  return `hsl(${hue}, 70%, 55%)`;
}

// ---------------------------------------------------------------------------
// Traceroute types
// ---------------------------------------------------------------------------

interface StoredTraceroute {
  id: string;
  deviceId: string;
  fromNodeId: number;
  toNodeId: number;
  route: number[];
  routeBack: number[];
  recordedAt: string;
}

// ---------------------------------------------------------------------------
// Age filter options
// ---------------------------------------------------------------------------

const AGE_OPTIONS: { label: string; hours: number }[] = [
  { label: "1h", hours: 1 },
  { label: "6h", hours: 6 },
  { label: "24h", hours: 24 },
  { label: "7d", hours: 168 },
  { label: "All", hours: 0 },
];

// ---------------------------------------------------------------------------
// Coverage circle helpers
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// GeoJSON line building
// ---------------------------------------------------------------------------

type Coord = [number, number];

interface Segment {
  coords: Coord[];
  dashed: boolean;
  color: string;
}

/**
 * Build map line segments for a traceroute. The full path is:
 *   fromNodeId → route[0] → ... → route[n] → toNodeId
 *
 * For each consecutive pair where BOTH nodes have known GPS: solid segment.
 * Where one or more hops are missing GPS data, we "skip" to the next known
 * node and draw a dashed segment to indicate the gap.
 */
function buildSegments(traceroute: StoredTraceroute, posMap: Map<number, Coord>): Segment[] {
  const path = [traceroute.fromNodeId, ...traceroute.route, traceroute.toNodeId];
  const color = nodeColor(traceroute.toNodeId);
  const segments: Segment[] = [];

  let lastKnownIdx: number | null = null;
  let hadGap = false;

  for (let i = 0; i < path.length; i++) {
    const pos = posMap.get(path[i]);
    if (!pos) {
      if (lastKnownIdx !== null) hadGap = true;
      continue;
    }
    if (lastKnownIdx !== null) {
      const prevPos = posMap.get(path[lastKnownIdx])!;
      segments.push({ coords: [prevPos, pos], dashed: hadGap, color });
    }
    lastKnownIdx = i;
    hadGap = false;
  }

  return segments;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

type SelectedNode = { source: "mesh"; node: NodeInfo } | { source: "mqtt"; node: MqttNode };

interface Props {
  nodes: NodeInfo[];
  mqttNodes: MqttNode[];
  showMesh: boolean;
  setShowMesh: (fn: (v: boolean) => boolean) => void;
  showMqtt: boolean;
  setShowMqtt: (fn: (v: boolean) => boolean) => void;
  deviceId?: string | null;
  deviceConfigs?: Map<string, DeviceConfig>;
  onMessage?: (nodeId: number) => void;
  focusedNodeId?: number | null;
  onClearFocusedNode?: () => void;
  /** Only show coverage for nodes on this modem preset (null = show all). */
  presetFilter?: number | null;
  setPresetFilter?: (v: number | null) => void;
}

export function MapPage({
  nodes,
  mqttNodes,
  showMesh,
  showMqtt,
  deviceId,
  deviceConfigs,
  onMessage,
  focusedNodeId,
  onClearFocusedNode,
  presetFilter = null,
  setPresetFilter,
}: Props) {
  const [selected, setSelected] = useState<SelectedNode | null>(null);
  const [stackedNodes, setStackedNodes] = useState<SelectedNode[]>([]);
  const [mapSearch, setMapSearch] = useState("");
  const [traceroutes, setTraceroutes] = useState<StoredTraceroute[]>([]);
  const [showTraceroutes, setShowTraceroutes] = useState(true);
  const [ageHours, setAgeHours] = useState(24);
  const [tracerouteExpanded, setTracerouteExpanded] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingMapAction | null>(null);
  const [showCoverage, setShowCoverage] = useState(false);
  const [terrainMode, setTerrainMode] = useState(false);
  const [coverageUnion, setCoverageUnion] = useState(true);
  const [coverageExpanded, setCoverageExpanded] = useState(false);
  const [coverageMqtt, setCoverageMqtt] = useState(false);
  const [coverageRadiusKm, setCoverageRadiusKm] = useState(() =>
    presetRadiusKm(deviceConfigs ?? new Map(), deviceId),
  );
  // Re-snap radius to preset when config first arrives (e.g. device connects after page load),
  // but only if the user hasn't manually picked a radius yet.
  const [userPickedRadius, setUserPickedRadius] = useState(false);
  useEffect(() => {
    if (userPickedRadius) return;
    setCoverageRadiusKm(presetRadiusKm(deviceConfigs ?? new Map(), deviceId));
  }, [deviceId, deviceConfigs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Node focused from within the map (popup coverage button). Takes priority over
  // the prop-based focusedNodeId which comes from the Nodes tab.
  const [localFocusedNodeId, setLocalFocusedNodeId] = useState<number | null>(null);
  const effectiveFocusedNodeId = localFocusedNodeId ?? focusedNodeId ?? null;

  // All unique modem presets present in current nodes — used to render preset filter buttons.
  const availablePresets = useMemo(() => {
    const seen = new Set<number>();
    const cfg = deviceConfigs?.get(deviceId ?? "");
    const meshPreset = (cfg?.radioConfig as { lora?: { modemPreset?: number } } | undefined)?.lora
      ?.modemPreset;
    if (meshPreset != null) seen.add(meshPreset);
    for (const n of mqttNodes) {
      const p = channelNameToPreset(n.channelName);
      if (p != null) seen.add(p);
    }
    return [...seen].sort((a, b) => a - b);
  }, [nodes, mqttNodes, deviceId, deviceConfigs]); // eslint-disable-line react-hooks/exhaustive-deps

  // Tracks nodes whose terrain is currently being force-refreshed via the popup button.
  const [refreshingTerrainNodes, setRefreshingTerrainNodes] = useState<Set<number>>(new Set());

  // Viewshed cache: nodeId → GeoJSON polygon always fetched at TERRAIN_FETCH_RADIUS_KM.
  // One entry per node; display radius is applied via clipViewshedToRadius at render time.
  const viewshedCache = useRef(new Map<string, GeoJSON.Feature<GeoJSON.Polygon>>());
  const [viewshedStatus, setViewshedStatus] = useState<Map<number, "loading" | "ready" | "error">>(
    new Map(),
  );
  const mapRef = useRef<MapRef>(null);

  // ── Coverage proposal planning ──────────────────────────────────────────
  const [proposals, setProposals] = useState<CoverageProposal[]>([]);
  const [proposalPlanningMode, setProposalPlanningMode] = useState(false);
  const [showProposals] = useState(true);
  const [proposalsExpanded, setProposalsExpanded] = useState(false);
  const [selectedProposal, setSelectedProposal] = useState<CoverageProposal | null>(null);
  const mapStyle = terrainMode ? TERRAIN_MAP_STYLE : MAP_STYLE;
  const proposalViewshedCache = useRef(new Map<string, GeoJSON.Feature<GeoJSON.Polygon>>());
  const [proposalViewshedStatus, setProposalViewshedStatus] = useState<
    Map<string, "loading" | "ready" | "error">
  >(new Map());

  // When a node is focused (from Nodes tab or map popup): enable terrain coverage and fly to it.
  useEffect(() => {
    if (effectiveFocusedNodeId == null) return;
    setShowCoverage(true);
    setTerrainMode(true);
  }, [effectiveFocusedNodeId]);

  useEffect(() => {
    if (effectiveFocusedNodeId == null) return;
    const node = [...mappableMesh, ...mappableMqtt].find(
      (n) => n.nodeId === effectiveFocusedNodeId,
    );
    if (!node?.longitude || !node?.latitude) return;
    mapRef.current?.flyTo({ center: [node.longitude, node.latitude], zoom: 12, duration: 1200 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveFocusedNodeId]);

  // Clear popup when the relevant source is hidden
  useEffect(() => {
    if (!showMesh && selected?.source === "mesh") {
      setSelected(null);
      setStackedNodes([]);
    }
  }, [showMesh]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!showMqtt && selected?.source === "mqtt") {
      setSelected(null);
      setStackedNodes([]);
    }
  }, [showMqtt]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch stored traceroutes from the API
  const fetchTraceroutes = useCallback(async () => {
    try {
      let url = "/api/traceroutes";
      if (ageHours > 0) {
        const since = new Date(Date.now() - ageHours * 3600 * 1000).toISOString();
        url += `?since=${encodeURIComponent(since)}`;
      }
      const res = await fetch(url);
      if (!res.ok) return;
      const data = (await res.json()) as StoredTraceroute[];
      setTraceroutes(data);
    } catch {
      // ignore fetch errors (daemon may be restarting)
    }
  }, [ageHours]);

  // Fetch on mount and whenever the age filter changes
  useEffect(() => {
    fetchTraceroutes();
  }, [fetchTraceroutes]);

  // Fetch coverage proposals on mount
  useEffect(() => {
    fetch("/api/proposals")
      .then((r) => r.json())
      .then(setProposals)
      .catch(console.error);
  }, []);

  // Re-fetch when a new traceroute result arrives via WebSocket; clear pending action
  useEffect(() => {
    const off = foremanClient.on((event) => {
      if (event.type === "traceroute:result") {
        fetchTraceroutes();
        setPendingAction((p) =>
          p?.action === "traceroute" && p.nodeId === event.payload.nodeId ? null : p,
        );
      }
    });
    return () => {
      off();
    };
  }, [fetchTraceroutes]);

  // Build nodeId → [lon, lat] lookup from all known nodes
  const posMap = useMemo<Map<number, Coord>>(() => {
    const m = new Map<number, Coord>();
    for (const n of nodes) {
      if (n.latitude != null && n.longitude != null) {
        m.set(n.nodeId, [n.longitude, n.latitude]);
      }
    }
    for (const n of mqttNodes) {
      if (n.latitude != null && n.longitude != null) {
        m.set(n.nodeId, [n.longitude, n.latitude]);
      }
    }
    return m;
  }, [nodes, mqttNodes]);

  // Build GeoJSON for traceroute lines — two layers: solid and dashed
  const { solidGeoJson, dashedGeoJson } = useMemo(() => {
    const solidFeatures: GeoJSON.Feature[] = [];
    const dashedFeatures: GeoJSON.Feature[] = [];

    if (!showTraceroutes)
      return { solidGeoJson: mkFeatureCollection([]), dashedGeoJson: mkFeatureCollection([]) };

    for (const tr of traceroutes) {
      const segs = buildSegments(tr, posMap);
      for (const seg of segs) {
        const feature: GeoJSON.Feature<GeoJSON.LineString> = {
          type: "Feature",
          properties: { color: seg.color, trId: tr.id },
          geometry: { type: "LineString", coordinates: seg.coords },
        };
        if (seg.dashed) {
          dashedFeatures.push(feature);
        } else {
          solidFeatures.push(feature);
        }
      }
    }

    return {
      solidGeoJson: mkFeatureCollection(solidFeatures),
      dashedGeoJson: mkFeatureCollection(dashedFeatures),
    };
  }, [traceroutes, posMap, showTraceroutes]);

  // Stable keys — recompute only when the set of GPS-equipped nodes or their positions change.
  // Sorted so ordering differences in the incoming array don't cause spurious cache misses.
  const meshGpsKey = nodes
    .filter((n) => n.latitude != null && n.longitude != null)
    .map((n) => `${n.nodeId}:${n.latitude?.toFixed(4)}:${n.longitude?.toFixed(4)}`)
    .sort()
    .join("|");
  const mqttGpsKey = mqttNodes
    .filter((n) => n.latitude != null && n.longitude != null)
    .map((n) => `${n.nodeId}:${n.latitude?.toFixed(4)}:${n.longitude?.toFixed(4)}`)
    .sort()
    .join("|");

  // Only produce new array references when GPS-relevant data actually changes,
  // preventing the viewshed effect from re-firing on every WebSocket update.

  const mappableMesh = useMemo(
    () => nodes.filter((n) => n.latitude != null && n.longitude != null),
    [meshGpsKey],
  );
  // Exclude any MQTT node whose nodeId is already present in the mesh list —
  // the mesh copy is authoritative and we don't want duplicate markers/coverage.

  const mappableMqtt = useMemo(() => {
    const meshIds = new Set(mappableMesh.map((n) => n.nodeId));
    return mqttNodes.filter(
      (n) => n.latitude != null && n.longitude != null && !meshIds.has(n.nodeId),
    );
  }, [mqttGpsKey, meshGpsKey]);
  const allMappable = [...mappableMesh, ...mappableMqtt];

  // Search filter — matches shortName, longName, or !hex node ID (case-insensitive).
  const filteredMesh = useMemo(() => {
    const q = mapSearch.trim().toLowerCase();
    if (!q) return mappableMesh;
    return mappableMesh.filter(
      (n) =>
        (n.shortName ?? "").toLowerCase().includes(q) ||
        (n.longName ?? "").toLowerCase().includes(q) ||
        nodeHex(n.nodeId).toLowerCase().includes(q),
    );
  }, [mappableMesh, mapSearch]);

  const filteredMqtt = useMemo(() => {
    const q = mapSearch.trim().toLowerCase();
    if (!q) return mappableMqtt;
    return mappableMqtt.filter(
      (n) =>
        (n.shortName ?? "").toLowerCase().includes(q) ||
        (n.longName ?? "").toLowerCase().includes(q) ||
        nodeHex(n.nodeId).toLowerCase().includes(q),
    );
  }, [mappableMqtt, mapSearch]);

  // Count of visible (filtered) nodes at each lat:lon — drives the +N stack badge.
  const colocatedCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const n of [...filteredMesh, ...filteredMqtt]) {
      const key = `${n.latitude}:${n.longitude}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [filteredMesh, filteredMqtt]);

  // Name of the currently focused node (for display in coverage panel)
  const effectiveFocusedNode =
    effectiveFocusedNodeId != null
      ? allMappable.find((n) => n.nodeId === effectiveFocusedNodeId)
      : undefined;
  const effectiveFocusedNodeName = effectiveFocusedNode
    ? resolveNodeName(effectiveFocusedNode.nodeId, effectiveFocusedNode)
    : null;

  // Fetch terrain viewsheds for all mappable nodes when terrain mode is active.
  // Placed after mappableMesh/mappableMqtt so those variables are in scope.
  useEffect(() => {
    if (!showCoverage || !terrainMode) {
      setViewshedStatus(new Map());
      return;
    }
    // In single-node mode only fetch for that node; otherwise fetch all.
    const allNodes =
      effectiveFocusedNodeId != null
        ? [...mappableMesh, ...mappableMqtt].filter((n) => n.nodeId === effectiveFocusedNodeId)
        : [...mappableMesh, ...mappableMqtt];
    if (allNodes.length === 0) return;

    // Evict stale cache entries for nodes no longer in the visible set to prevent unbounded memory growth.
    const activeKeys = new Set(allNodes.map((n) => `${n.nodeId}`));
    for (const key of viewshedCache.current.keys()) {
      if (!activeKeys.has(key)) viewshedCache.current.delete(key);
    }

    // Initialise status without resetting already-cached nodes — avoids the
    // "X/76 loading" flicker when the effect fires due to unrelated node updates.
    // Cache key is just nodeId — always fetched at TERRAIN_FETCH_RADIUS_KM (20km).
    const pending = new Map<number, "loading" | "ready" | "error">();
    for (const n of allNodes) {
      pending.set(n.nodeId, viewshedCache.current.has(`${n.nodeId}`) ? "ready" : "loading");
    }
    setViewshedStatus(new Map(pending));

    // Fetch viewsheds with limited concurrency (3 at a time) rather than firing
    // all requests at once.  Nodes in the same area share terrain — the first
    // few responses warm the backend elevation cache so later ones are fast DB
    // hits.  3 concurrent keeps throughput reasonable without bursting the API.
    let cancelled = false;
    const queue = allNodes.filter((n) => !viewshedCache.current.has(`${n.nodeId}`));
    let qi = 0;

    async function fetchOne(n: (typeof allNodes)[0]): Promise<void> {
      const key = `${n.nodeId}`;
      const antennaM = n.altitude != null ? n.altitude + 2 : 2;
      try {
        const geojson = await fetchViewshed(
          n.latitude!,
          n.longitude!,
          TERRAIN_FETCH_RADIUS_KM,
          antennaM,
        );
        // Always write to cache — preserves work even if cancelled so a
        // subsequent toggle-on skips nodes already fetched.
        viewshedCache.current.set(key, geojson);
        pending.set(n.nodeId, "ready");
      } catch {
        pending.set(n.nodeId, "error");
      }
      if (!cancelled) setViewshedStatus(new Map(pending));
    }

    async function worker(): Promise<void> {
      while (true) {
        if (cancelled) break;
        const idx = qi++;
        if (idx >= queue.length) break;
        await fetchOne(queue[idx]);
      }
    }

    const CONCURRENCY = 3;
    Promise.all(Array.from({ length: CONCURRENCY }, worker));

    return () => {
      cancelled = true;
    };
  }, [showCoverage, terrainMode, effectiveFocusedNodeId, mappableMesh, mappableMqtt]);

  // Fetch viewsheds for visible proposals whenever terrain mode is active.
  // Uses same concurrency-limited queue pattern as the live node viewshed fetch.
  useEffect(() => {
    if (!showProposals || !terrainMode) return;
    const visibleProposals = proposals.filter(
      (p) => p.visible && !proposalViewshedCache.current.has(p.id),
    );
    if (visibleProposals.length === 0) return;

    let cancelled = false;
    const queue = [...visibleProposals];
    let qi = 0;

    const fetchOne = async (p: CoverageProposal) => {
      const key = p.id;
      setProposalViewshedStatus((prev) => new Map(prev).set(key, "loading"));
      try {
        const geojson = await fetchViewshed(p.lat, p.lon, TERRAIN_FETCH_RADIUS_KM, p.altitudeM);
        if (!cancelled) {
          proposalViewshedCache.current.set(key, geojson);
          setProposalViewshedStatus((prev) => new Map(prev).set(key, "ready"));
        }
      } catch {
        if (!cancelled) setProposalViewshedStatus((prev) => new Map(prev).set(key, "error"));
      }
    };

    const worker = async () => {
      for (;;) {
        if (cancelled) break;
        const idx = qi++;
        if (idx >= queue.length) break;
        await fetchOne(queue[idx]);
      }
    };

    const CONCURRENCY = 3;
    Promise.all(Array.from({ length: CONCURRENCY }, worker));

    return () => {
      cancelled = true;
    };
  }, [showProposals, terrainMode, proposals]);

  // Build GeoJSON for proposal coverage — always separate from live node coverage.
  // In terrain mode: use cached viewshed polygons. In circle mode: use preset radius circles.
  const proposalCoverageGeoJson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showProposals) return mkFeatureCollection([]);
    const features: GeoJSON.Feature[] = [];
    for (const p of proposals) {
      if (!p.visible) continue;
      const radius = MODEM_PRESET_RADIUS_KM[p.modemPreset] ?? DEFAULT_RADIUS_KM;
      if (terrainMode) {
        const cached = proposalViewshedCache.current.get(p.id);
        if (!cached) continue;
        const poly =
          radius < TERRAIN_FETCH_RADIUS_KM
            ? clipViewshedToRadius(cached, p.lat, p.lon, radius)
            : cached;
        features.push({ ...poly, properties: { ...poly.properties, color: "#f59e0b" } });
      } else {
        features.push(buildCoverageCircle(p.lon, p.lat, radius, "#f59e0b", 64, false));
      }
    }
    return mkFeatureCollection(features);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showProposals, terrainMode, proposals, proposalViewshedStatus]);

  // Build GeoJSON coverage layer.
  // In terrain mode: only show nodes whose polygon has been computed — no
  // placeholder circles.  Nodes pop onto the map as their terrain arrives.
  // In circle mode: show all nodes as geodesic circles immediately.
  // Each MQTT node uses its own radius derived from its channelName; mesh nodes
  // use the device config preset.  presetFilter hides nodes not on that preset.
  // viewshedStatus is in deps so the memo refreshes as terrain data arrives.
  const coverageGeoJson = useMemo<GeoJSON.FeatureCollection>(() => {
    if (!showCoverage) return mkFeatureCollection([]);

    const meshPreset = (() => {
      const cfg = deviceConfigs?.get(deviceId ?? "");
      return (
        (cfg?.radioConfig as { lora?: { modemPreset?: number } } | undefined)?.lora?.modemPreset ??
        null
      );
    })();

    const features: GeoJSON.Feature[] = [];

    // When a specific preset is selected the user can override the radius via the range
    // buttons (coverageRadiusKm).  When showing all presets each node uses its own
    // preset's default range so the circles are proportionally accurate.
    const radiusFor = (preset: number | null) =>
      presetFilter !== null
        ? coverageRadiusKm
        : preset != null
          ? (MODEM_PRESET_RADIUS_KM[preset] ?? DEFAULT_RADIUS_KM)
          : DEFAULT_RADIUS_KM;

    // ── Mesh nodes ────────────────────────────────────────────────────────────
    const meshToShow =
      effectiveFocusedNodeId != null
        ? mappableMesh.filter((n) => n.nodeId === effectiveFocusedNodeId)
        : mappableMesh;
    for (const n of meshToShow) {
      if (presetFilter != null && meshPreset !== presetFilter) continue;
      const color = nodeColor(n.nodeId);
      const isFocused = n.nodeId === effectiveFocusedNodeId;
      const radius = radiusFor(meshPreset);
      const cached = viewshedCache.current.get(`${n.nodeId}`);
      if (terrainMode) {
        if (!cached) continue;
        const poly =
          radius < TERRAIN_FETCH_RADIUS_KM
            ? clipViewshedToRadius(cached, n.latitude!, n.longitude!, radius)
            : cached;
        features.push({
          ...poly,
          properties: { ...poly.properties, color, focused: isFocused ? 1 : 0 },
        });
      } else {
        features.push(buildCoverageCircle(n.longitude!, n.latitude!, radius, color, 64, isFocused));
      }
    }

    // ── MQTT nodes — only included when explicitly enabled in coverage settings ──
    if (showMqtt && coverageMqtt) {
      const mqttToShow =
        effectiveFocusedNodeId != null
          ? mappableMqtt.filter((n) => n.nodeId === effectiveFocusedNodeId)
          : mappableMqtt;
      for (const n of mqttToShow) {
        const nodePreset = channelNameToPreset(n.channelName);
        if (presetFilter != null && nodePreset !== presetFilter) continue;
        const color = nodeColor(n.nodeId);
        const isFocused = n.nodeId === effectiveFocusedNodeId;
        const radius = radiusFor(nodePreset);
        const cached = viewshedCache.current.get(`${n.nodeId}`);
        if (terrainMode) {
          if (!cached) continue;
          const poly =
            radius < TERRAIN_FETCH_RADIUS_KM
              ? clipViewshedToRadius(cached, n.latitude!, n.longitude!, radius)
              : cached;
          features.push({
            ...poly,
            properties: { ...poly.properties, color, focused: isFocused ? 1 : 0 },
          });
        } else {
          features.push(
            buildCoverageCircle(n.longitude!, n.latitude!, radius, color, 64, isFocused),
          );
        }
      }
    }

    // ── Separate mode: render each node's polygon individually ───────────────
    if (!coverageUnion) return mkFeatureCollection(features);

    // ── Union mode: merge all polygons into one shape ─────────────────────────
    // The result is a single filled area whose outer boundary traces the combined
    // coverage footprint.  Overlapping regions disappear — no stacked outlines.
    const isFocused = effectiveFocusedNodeId != null;
    const color = isFocused ? nodeColor(effectiveFocusedNodeId!) : "#3b82f6";
    return mergeCoveragePolygons(features, color, isFocused);
  }, [
    showCoverage,
    terrainMode,
    coverageRadiusKm,
    coverageMqtt,
    coverageUnion,
    effectiveFocusedNodeId,
    mappableMesh,
    mappableMqtt,
    showMqtt,
    presetFilter,
    deviceId,
    deviceConfigs,
    viewshedStatus,
  ]);

  const firstNode = allMappable[0];
  const initialView = {
    longitude: firstNode?.longitude ?? -98.5,
    latitude: firstNode?.latitude ?? 39.5,
    zoom: firstNode ? 10 : 4,
  };

  const handleMeshClick = useCallback(
    (node: NodeInfo, e: { originalEvent: MouseEvent }) => {
      e.originalEvent.stopPropagation();
      setSelected((prev) => {
        if (prev?.source === "mesh" && prev.node.nodeId === node.nodeId) {
          setStackedNodes([]);
          return null;
        }
        return { source: "mesh", node };
      });
      const colocated: SelectedNode[] = [
        ...filteredMesh
          .filter((n) => n.latitude === node.latitude && n.longitude === node.longitude)
          .map((n): SelectedNode => ({ source: "mesh", node: n })),
        ...filteredMqtt
          .filter((n) => n.latitude === node.latitude && n.longitude === node.longitude)
          .map((n): SelectedNode => ({ source: "mqtt", node: n })),
      ];
      setStackedNodes(colocated.length > 1 ? colocated : []);
    },
    [filteredMesh, filteredMqtt],
  );

  const handleMqttClick = useCallback(
    (node: MqttNode, e: { originalEvent: MouseEvent }) => {
      e.originalEvent.stopPropagation();
      setSelected((prev) => {
        if (prev?.source === "mqtt" && prev.node.nodeId === node.nodeId) {
          setStackedNodes([]);
          return null;
        }
        return { source: "mqtt", node };
      });
      const colocated: SelectedNode[] = [
        ...filteredMesh
          .filter((n) => n.latitude === node.latitude && n.longitude === node.longitude)
          .map((n): SelectedNode => ({ source: "mesh", node: n })),
        ...filteredMqtt
          .filter((n) => n.latitude === node.latitude && n.longitude === node.longitude)
          .map((n): SelectedNode => ({ source: "mqtt", node: n })),
      ];
      setStackedNodes(colocated.length > 1 ? colocated : []);
    },
    [filteredMesh, filteredMqtt],
  );

  const selectedLon =
    selected?.source === "mesh"
      ? selected.node.longitude
      : selected?.source === "mqtt"
        ? selected.node.longitude
        : null;
  const selectedLat =
    selected?.source === "mesh"
      ? selected.node.latitude
      : selected?.source === "mqtt"
        ? selected.node.latitude
        : null;

  return (
    <div className={styles.wrap}>
      <MapCanvas
        mapRef={mapRef}
        hasGpsNodes={allMappable.length > 0}
        initialView={initialView}
        mapStyle={mapStyle}
        planningMode={proposalPlanningMode}
        coverageGeoJson={coverageGeoJson}
        proposalCoverageGeoJson={proposalCoverageGeoJson}
        solidGeoJson={solidGeoJson}
        dashedGeoJson={dashedGeoJson}
        onMapClick={(e) => {
          if (proposalPlanningMode) {
            const { lng, lat } = e.lngLat;
            const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
            const name = `Site ${letters[proposals.length % 26]}`;
            // Fetch terrain elevation at click point; default to terrain + 3m antenna height.
            fetchElevation(lat, lng)
              .then((elevationM) => {
                const altitudeM = Math.round((isFinite(elevationM) ? elevationM : 0) + 3);
                return fetch("/api/proposals", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    name,
                    lat,
                    lon: lng,
                    altitudeM,
                    modemPreset: 0,
                    notes: null,
                  }),
                }).then((r) => r.json());
              })
              .then((p: CoverageProposal) => setProposals((prev) => [...prev, p]))
              .catch(console.error);
          } else {
            setSelected(null);
            setSelectedProposal(null);
          }
        }}
      >
        {/* Mesh node markers */}
        {showMesh &&
          filteredMesh.map((node) => {
            const isLocal = node.hopsAway === 0;
            const color = nodeColor(node.nodeId);
            const stackCount = colocatedCounts.get(`${node.latitude}:${node.longitude}`) ?? 1;
            const hasStack = stackCount > 1;
            return (
              <Marker
                key={`mesh-${node.nodeId}`}
                longitude={node.longitude!}
                latitude={node.latitude!}
                anchor="center"
                onClick={(e) => handleMeshClick(node, e)}
              >
                <div
                  title={resolveNodeName(node.nodeId, node, { preference: ["longName"] })}
                  className={cx(styles.markerOuter, styles.markerOuterMesh)}
                  style={
                    {
                      "--marker-color": color,
                      "--marker-shadow": `${color}33`,
                    } as CSSProperties
                  }
                >
                  <div
                    className={cx(styles.markerInner, hasStack && styles.markerInnerStacked)}
                    style={
                      {
                        "--marker-bg": isLocal ? color : "#0f172a",
                        "--marker-fg": isLocal ? "#fff" : color,
                        "--marker-border": `2px solid ${color}`,
                      } as CSSProperties
                    }
                  >
                    {resolveNodeName(node.nodeId, node, {
                      preference: ["shortName"],
                      fallback: nodeHex(node.nodeId).slice(-4),
                    }).slice(0, 4)}
                  </div>
                  {isLocal && <div className={styles.localRing} />}
                  {hasStack && <div className={styles.stackBadge}>+{stackCount}</div>}
                </div>
              </Marker>
            );
          })}

        {/* MQTT node markers — dashed border to distinguish from mesh */}
        {showMqtt &&
          filteredMqtt.map((node) => {
            const color = nodeColor(node.nodeId);
            const stackCount = colocatedCounts.get(`${node.latitude}:${node.longitude}`) ?? 1;
            const hasStack = stackCount > 1;
            return (
              <Marker
                key={`mqtt-${node.nodeId}`}
                longitude={node.longitude!}
                latitude={node.latitude!}
                anchor="center"
                onClick={(e) => handleMqttClick(node, e)}
              >
                <div
                  title={`[MQTT] ${resolveNodeName(node.nodeId, node, { preference: ["longName"] })}`}
                  className={styles.markerOuter}
                >
                  <div
                    className={cx(
                      styles.markerInner,
                      styles.markerInnerMqtt,
                      hasStack && styles.markerInnerStacked,
                    )}
                    style={
                      {
                        "--marker-fg": color,
                        "--marker-border": `2px dashed ${color}`,
                        "--marker-shadow": `${color}22`,
                      } as CSSProperties
                    }
                  >
                    {resolveNodeName(node.nodeId, node, {
                      preference: ["shortName"],
                      fallback: nodeHex(node.nodeId).slice(-4),
                    }).slice(0, 4)}
                  </div>
                  {hasStack && <div className={styles.stackBadge}>+{stackCount}</div>}
                </div>
              </Marker>
            );
          })}

        {/* Coverage proposal markers — amber pin with name label, draggable to reposition */}
        {showProposals &&
          proposals
            .filter((p) => p.visible)
            .map((p) => (
              <Marker
                key={`proposal-${p.id}`}
                longitude={p.lon}
                latitude={p.lat}
                anchor="bottom"
                draggable
                onClick={(e) => {
                  e.originalEvent.stopPropagation();
                  setSelectedProposal((prev) => (prev?.id === p.id ? null : p));
                  setSelected(null);
                }}
                onDragStart={() => {
                  // Drop cached viewshed immediately so coverage clears while dragging
                  proposalViewshedCache.current.delete(p.id);
                  setProposalViewshedStatus((prev) => {
                    const m = new Map(prev);
                    m.delete(p.id);
                    return m;
                  });
                }}
                onDragEnd={(e) => {
                  const { lng, lat } = e.lngLat;
                  // Fetch terrain elevation at the new position, then PATCH lat/lon/altitude
                  fetchElevation(lat, lng)
                    .then((elevationM) => {
                      const altitudeM = Math.round((isFinite(elevationM) ? elevationM : 0) + 3);
                      return fetch(`/api/proposals/${p.id}`, {
                        method: "PATCH",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ lat, lon: lng, altitudeM }),
                      }).then((r) => r.json());
                    })
                    .then((updated: CoverageProposal) => {
                      setProposals((prev) => prev.map((x) => (x.id === updated.id ? updated : x)));
                      setSelectedProposal((prev) => (prev?.id === updated.id ? updated : prev));
                    })
                    .catch(console.error);
                }}
              >
                <div
                  className={styles.proposalMarker}
                  title={`Proposal: ${p.name} — drag to reposition`}
                >
                  {/* Label on top */}
                  <span className={styles.proposalLabel}>{p.name}</span>
                  {/* Diamond head */}
                  <div className={styles.proposalDiamond} />
                  {/* Pole — bottom is the anchor point */}
                  <div className={styles.proposalPole} />
                </div>
              </Marker>
            ))}

        {/* Proposal popup — edit/delete/copy for a selected proposal */}
        {selectedProposal && (
          <Popup
            longitude={selectedProposal.lon}
            latitude={selectedProposal.lat}
            anchor="top"
            offset={8}
            closeButton={true}
            closeOnClick={false}
            onClose={() => setSelectedProposal(null)}
            // react-map-gl's <Popup> only accepts a `style` prop for its container
            // (no `className`), so this can't move to a CSS module.
            style={{ fontFamily: "monospace" }}
          >
            <ProposalEditor
              proposal={selectedProposal}
              onUpdate={(updated) => {
                fetch(`/api/proposals/${updated.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    name: updated.name,
                    altitudeM: updated.altitudeM,
                    modemPreset: updated.modemPreset,
                    notes: updated.notes,
                  }),
                })
                  .then((r) => r.json())
                  .then((p: CoverageProposal) => {
                    setProposals((prev) => prev.map((x) => (x.id === p.id ? p : x)));
                    setSelectedProposal(p);
                    // Invalidate cached viewshed for this proposal (preset/alt changed)
                    proposalViewshedCache.current.delete(p.id);
                    setProposalViewshedStatus((prev) => {
                      const m = new Map(prev);
                      m.delete(p.id);
                      return m;
                    });
                  })
                  .catch(console.error);
              }}
              onDelete={() => {
                fetch(`/api/proposals/${selectedProposal.id}`, { method: "DELETE" })
                  .then(() => {
                    setProposals((prev) => prev.filter((x) => x.id !== selectedProposal.id));
                    proposalViewshedCache.current.delete(selectedProposal.id);
                    setProposalViewshedStatus((prev) => {
                      const m = new Map(prev);
                      m.delete(selectedProposal.id);
                      return m;
                    });
                    setSelectedProposal(null);
                  })
                  .catch(console.error);
              }}
            />
          </Popup>
        )}

        {selected &&
          selectedLon != null &&
          selectedLat != null &&
          (() => {
            // Focus this node's coverage from within the map popup.
            const handleFocusCoverage = () => {
              setLocalFocusedNodeId(selected.node.nodeId);
              setShowCoverage(true);
              setSelected(null);
            };

            // Build a refresh callback only when terrain mode is on and the node
            // has a known position (needed to key the viewshed_cache row).
            const refreshTerrain =
              terrainMode &&
              selected.source === "mesh" &&
              selected.node.latitude != null &&
              selected.node.longitude != null
                ? async () => {
                    const n = selected.node;
                    const nodeId = n.nodeId;
                    setRefreshingTerrainNodes((prev) => new Set(prev).add(nodeId));
                    // 1. Evict the DB-cached viewshed polygon for this position
                    await deleteViewshed(n.latitude!, n.longitude!, TERRAIN_FETCH_RADIUS_KM).catch(
                      () => {
                        /* ignore — we'll re-fetch regardless */
                      },
                    );
                    // 2. Drop the in-memory polygon so the fetch loop doesn't skip it
                    viewshedCache.current.delete(`${nodeId}`);
                    // 3. Fetch the fresh viewshed directly (bypasses the loop queue)
                    const antennaM = n.altitude != null ? n.altitude + 2 : 2;
                    try {
                      const geojson = await fetchViewshed(
                        n.latitude!,
                        n.longitude!,
                        TERRAIN_FETCH_RADIUS_KM,
                        antennaM,
                      );
                      viewshedCache.current.set(`${nodeId}`, geojson);
                      setViewshedStatus((prev) => new Map(prev).set(nodeId, "ready"));
                    } catch {
                      setViewshedStatus((prev) => new Map(prev).set(nodeId, "error"));
                    } finally {
                      setRefreshingTerrainNodes((prev) => {
                        const s = new Set(prev);
                        s.delete(nodeId);
                        return s;
                      });
                    }
                  }
                : undefined;

            return (
              <Popup
                longitude={selectedLon}
                latitude={selectedLat}
                anchor="bottom"
                offset={20}
                closeButton={true}
                closeOnClick={false}
                onClose={() => {
                  setSelected(null);
                  setStackedNodes([]);
                }}
                // react-map-gl's <Popup> only accepts a `style` prop for its container
                // (no `className`), so this can't move to a CSS module.
                style={{ fontFamily: "monospace" }}
              >
                {stackedNodes.length > 1 && (
                  <div className={styles.stackHeader}>
                    <span className={styles.stackHeaderLabel}>
                      {stackedNodes.length} nodes at this location:
                    </span>
                    {stackedNodes.map((sn) => {
                      const isActive = selected.node.nodeId === sn.node.nodeId;
                      const label = resolveNodeName(sn.node.nodeId, sn.node, {
                        preference: ["shortName"],
                        fallback: nodeHex(sn.node.nodeId).slice(-4),
                      }).slice(0, 6);
                      return (
                        <button
                          key={`${sn.source}-${sn.node.nodeId}`}
                          onClick={() => setSelected(sn)}
                          className={styles.stackButton}
                          style={
                            {
                              "--stack-border": `1px solid ${isActive ? nodeColor(sn.node.nodeId) : "#334155"}`,
                              "--stack-bg": isActive ? `${nodeColor(sn.node.nodeId)}22` : "#0f172a",
                              "--stack-color": isActive ? nodeColor(sn.node.nodeId) : "#94a3b8",
                            } as CSSProperties
                          }
                          title={resolveNodeName(sn.node.nodeId, sn.node, {
                            preference: ["longName"],
                          })}
                        >
                          {label}
                          {sn.source === "mqtt" ? "*" : ""}
                        </button>
                      );
                    })}
                  </div>
                )}
                {selected.source === "mesh" ? (
                  <MeshPopup
                    node={selected.node}
                    deviceId={deviceId ?? null}
                    pending={
                      pendingAction?.nodeId === selected.node.nodeId ? pendingAction.action : null
                    }
                    onRequestPosition={() => {
                      if (!deviceId) return;
                      setPendingAction({ nodeId: selected.node.nodeId, action: "ping" });
                      foremanClient.send({
                        type: "node:request-position",
                        payload: { deviceId, nodeId: selected.node.nodeId },
                      });
                      setTimeout(
                        () =>
                          setPendingAction((p) => (p?.nodeId === selected.node.nodeId ? null : p)),
                        15000,
                      );
                    }}
                    onTraceroute={() => {
                      if (!deviceId) return;
                      setPendingAction({ nodeId: selected.node.nodeId, action: "traceroute" });
                      foremanClient.send({
                        type: "node:traceroute",
                        payload: { deviceId, nodeId: selected.node.nodeId },
                      });
                      setTimeout(
                        () =>
                          setPendingAction((p) => (p?.nodeId === selected.node.nodeId ? null : p)),
                        30000,
                      );
                    }}
                    onMessage={
                      onMessage
                        ? () => {
                            setSelected(null);
                            onMessage(selected.node.nodeId);
                          }
                        : undefined
                    }
                    onFocusCoverage={
                      selected.node.latitude != null && selected.node.longitude != null
                        ? handleFocusCoverage
                        : undefined
                    }
                    onRefreshTerrain={refreshTerrain}
                    terrainRefreshing={refreshingTerrainNodes.has(selected.node.nodeId)}
                  />
                ) : (
                  <MqttPopup
                    node={selected.node}
                    onFocusCoverage={
                      selected.node.latitude != null && selected.node.longitude != null
                        ? handleFocusCoverage
                        : undefined
                    }
                    onRefreshTerrain={refreshTerrain}
                    terrainRefreshing={refreshingTerrainNodes.has(selected.node.nodeId)}
                  />
                )}
              </Popup>
            );
          })()}
      </MapCanvas>

      {/* Traceroute + Coverage controls — top left, side by side */}
      <div className={styles.topControlsRow}>
        {/* ── Traceroute panel ─────────────────────────────────────────── */}
        <div className={controlStyles.controlPanel}>
          {/* Simple row — always visible */}
          <div className={controlStyles.controlRow}>
            <span className={controlStyles.controlLabel}>Traceroutes:</span>

            <span className={controlStyles.summaryPill}>
              {AGE_OPTIONS.find((o) => o.hours === ageHours)?.label ?? `${ageHours}h`}
            </span>

            <button
              className={onOffBtnClass(showTraceroutes)}
              onClick={() => setShowTraceroutes((v) => !v)}
              title={showTraceroutes ? "Hide traceroute lines" : "Show traceroute lines"}
            >
              {showTraceroutes ? "On" : "Off"}
            </button>

            <button
              className={cx(ageFilterBtnClass(tracerouteExpanded), controlStyles.ageFilterBtnCaret)}
              onClick={() => setTracerouteExpanded((v) => !v)}
              title={tracerouteExpanded ? "Hide age options" : "Show age options"}
            >
              {tracerouteExpanded ? "▲" : "▼"}
            </button>

            <span className={styles.routeCountText}>
              {showTraceroutes
                ? `${traceroutes.length} route${traceroutes.length !== 1 ? "s" : ""}`
                : "hidden"}
            </span>
          </div>

          {/* Age row — shown when expanded */}
          {tracerouteExpanded && (
            <div className={cx(controlStyles.controlRow, controlStyles.advancedRow)}>
              <span className={cx(controlStyles.controlLabel, controlStyles.controlLabelFlush)}>
                Age:
              </span>
              {AGE_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  className={ageFilterBtnClass(ageHours === opt.hours)}
                  onClick={() => {
                    setAgeHours(opt.hours);
                    if (!showTraceroutes) setShowTraceroutes(true);
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>

        <MapControls
          deviceId={deviceId}
          deviceConfigs={deviceConfigs}
          presetFilter={presetFilter}
          setPresetFilter={setPresetFilter}
          availablePresets={availablePresets}
          coverageRadiusKm={coverageRadiusKm}
          setCoverageRadiusKm={setCoverageRadiusKm}
          setUserPickedRadius={setUserPickedRadius}
          showCoverage={showCoverage}
          setShowCoverage={setShowCoverage}
          terrainMode={terrainMode}
          setTerrainMode={setTerrainMode}
          coverageUnion={coverageUnion}
          setCoverageUnion={setCoverageUnion}
          coverageExpanded={coverageExpanded}
          setCoverageExpanded={setCoverageExpanded}
          coverageMqtt={coverageMqtt}
          setCoverageMqtt={setCoverageMqtt}
          showMqtt={showMqtt}
          effectiveFocusedNodeId={effectiveFocusedNodeId}
          effectiveFocusedNodeName={effectiveFocusedNodeName}
          setLocalFocusedNodeId={setLocalFocusedNodeId}
          onClearFocusedNode={onClearFocusedNode}
          viewshedStatus={viewshedStatus}
        />
        <ProposalControls
          terrainMode={terrainMode}
          proposals={proposals}
          setProposals={setProposals}
          proposalViewshedStatus={proposalViewshedStatus}
          setProposalViewshedStatus={setProposalViewshedStatus}
          proposalViewshedCache={proposalViewshedCache}
          proposalPlanningMode={proposalPlanningMode}
          setProposalPlanningMode={setProposalPlanningMode}
          proposalsExpanded={proposalsExpanded}
          setProposalsExpanded={setProposalsExpanded}
          selectedProposal={selectedProposal}
          setSelectedProposal={setSelectedProposal}
        />
      </div>

      {/* Search filter — top center */}
      <div className={styles.searchBar}>
        <span className={styles.searchIcon}>🔍</span>
        <input
          type="text"
          placeholder="node name or !hex…"
          value={mapSearch}
          onChange={(e) => setMapSearch(e.target.value)}
          className={styles.searchInput}
        />
        {mapSearch && (
          <>
            <span className={styles.searchCount}>
              {filteredMesh.length + filteredMqtt.length} shown
            </span>
            <button
              onClick={() => setMapSearch("")}
              className={styles.searchClearBtn}
              title="Clear search"
            >
              ✕
            </button>
          </>
        )}
      </div>

      {/* Legend — bottom left */}
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendDirectWrap}>
            <span className={cx(styles.legendDot, styles.legendDotDirect)} />
            <span className={styles.legendDirectRing} />
          </span>
          Direct (0 hops)
        </span>
        <span className={styles.legendItem}>
          <span className={cx(styles.legendDot, styles.legendDotMesh)} />
          Mesh
        </span>
        <span className={styles.legendItem}>
          <span className={cx(styles.legendDot, styles.legendDotMqtt)} />
          MQTT
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendLine} />
          Traceroute
        </span>
        <span className={styles.legendItem}>
          <span className={cx(styles.legendLine, styles.legendLineDashed)} />
          Traceroute (gap)
        </span>
        {showCoverage && (
          <span className={styles.legendItem}>
            <span
              className={cx(
                styles.legendSwatch,
                coverageUnion
                  ? styles.legendSwatchUnion
                  : terrainMode
                    ? styles.legendSwatchTerrainSeparate
                    : styles.legendSwatchCircle,
              )}
            />
            {terrainMode
              ? "Terrain LOS"
              : coverageUnion
                ? "Coverage (union)"
                : `${coverageRadiusKm}km range`}
          </span>
        )}
        {showProposals && proposals.some((p) => p.visible) && (
          <span className={styles.legendItem}>
            <span className={cx(styles.legendSwatch, styles.legendSwatchAmber)} />
            Proposed site
          </span>
        )}
        <span className={styles.legendMuted}>
          {mapSearch
            ? `${filteredMesh.length + filteredMqtt.length} / ${mappableMesh.length + mappableMqtt.length} matching`
            : `${mappableMesh.length + mappableMqtt.length} / ${nodes.length + mqttNodes.length} with GPS`}
        </span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function mkFeatureCollection(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features };
}
