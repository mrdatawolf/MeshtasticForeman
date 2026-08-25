import "maplibre-gl/dist/maplibre-gl.css";
import {
  formatNodeId as nodeHex,
  MODEM_PRESET_LABELS as MODEM_PRESET_LABEL,
  resolveNodeName,
} from "@foreman/shared";
import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import MapGL, {
  type MapRef,
  Marker,
  Popup,
  NavigationControl,
  Source,
  Layer,
} from "react-map-gl/maplibre";

import { buildCoverageCircle, clipViewshedToRadius } from "../lib/coordinateHelpers.js";
import { mergeCoveragePolygons } from "../lib/coverageMath.js";
import { formatRelativeTime } from "../lib/relativeTime.js";
import { foremanClient } from "../ws/client.js";

import type { NodeInfo, MqttNode, DeviceConfig, CoverageProposal } from "@foreman/shared";

type PendingMapAction = { nodeId: number; action: "ping" | "traceroute" };

const MAP_STYLE = import.meta.env.VITE_MAP_STYLE ?? "https://tiles.openfreemap.org/styles/liberty";

const TERRAIN_MAP_STYLE = "https://tiles.stadiamaps.com/styles/stamen_terrain.json";

const HW_MODEL: Record<number, string> = {
  0: "UNSET",
  4: "TBEAM",
  8: "T_ECHO",
  10: "RAK4631",
  13: "LILYGO_TBEAM_S3_CORE",
  43: "HELTEC_V3",
  48: "HELTEC_WIRELESS_TRACKER",
  49: "HELTEC_WIRELESS_PAPER",
  50: "T_DECK",
  51: "T_WATCH_S3",
  64: "TRACKER_T1000_E",
  66: "WIO_E5",
  95: "HELTEC_WIRELESS_PAPER_V3",
  99: "SEEED_WIO_TRACKER_L1",
  255: "PRIVATE_HW",
};

function formatLastHeard(iso: string | null): string {
  return formatRelativeTime(iso, "never");
}

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

const COVERAGE_RADII_KM = [1, 2, 3, 5, 7, 10, 12, 15, 20];

/**
 * Expected typical LoRa range per modem preset (km).
 * Based on Meshtastic's documented spreading-factor / bandwidth combinations.
 * These are optimistic open-terrain estimates — terrain will reduce them.
 *
 * Preset numbers match Meshtastic's Config.LoRaConfig.ModemPreset enum:
 *   0 LONG_FAST · 1 LONG_SLOW · 2 VERY_LONG_SLOW · 3 MEDIUM_SLOW
 *   4 MEDIUM_FAST · 5 SHORT_SLOW · 6 SHORT_FAST · 7 LONG_MODERATE · 8 SHORT_TURBO
 */
const MODEM_PRESET_RADIUS_KM: Record<number, number> = {
  0: 10, // LONG_FAST
  1: 15, // LONG_SLOW
  2: 20, // VERY_LONG_SLOW
  3: 7, // MEDIUM_SLOW
  4: 5, // MEDIUM_FAST
  5: 3, // SHORT_SLOW
  6: 2, // SHORT_FAST
  7: 12, // LONG_MODERATE
  8: 1, // SHORT_TURBO
};
const DEFAULT_RADIUS_KM = 10; // LONG_FAST fallback

/** Map channel name strings from MQTT topic paths to modem preset numbers.
 *  Matching is case-insensitive and ignores underscores/hyphens so both
 *  "LongFast" (topic) and "LONG_FAST" (enum label) resolve correctly. */
export function channelNameToPreset(name: string | null | undefined): number | null {
  if (!name) return null;
  const key = name.toLowerCase().replace(/[_\-\s]/g, "");
  const map: Record<string, number> = {
    longfast: 0,
    longslow: 1,
    verylongslow: 2,
    mediumslow: 3,
    mediumfast: 4,
    shortslow: 5,
    shortfast: 6,
    longmoderate: 7,
    shortturbo: 8,
  };
  return map[key] ?? null;
}

/** Always fetch viewsheds at this radius — one cache entry per node regardless of display radius. */
const TERRAIN_FETCH_RADIUS_KM = 20;

// ---------------------------------------------------------------------------
// Viewshed clip helpers
// ---------------------------------------------------------------------------

function presetRadiusKm(
  deviceConfigs: Map<string, DeviceConfig>,
  deviceId: string | null | undefined,
): number {
  if (!deviceId) return DEFAULT_RADIUS_KM;
  const cfg = deviceConfigs.get(deviceId);
  const preset = (cfg?.radioConfig as { lora?: { modemPreset?: number } } | undefined)?.lora
    ?.modemPreset;
  if (preset == null) return DEFAULT_RADIUS_KM;
  return MODEM_PRESET_RADIUS_KM[preset] ?? DEFAULT_RADIUS_KM;
}

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
      const url = `/api/coverage/viewshed?lat=${n.latitude}&lon=${n.longitude}&radiusKm=${TERRAIN_FETCH_RADIUS_KM}&altitudeM=${antennaM}`;
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const geojson = (await r.json()) as GeoJSON.Feature<GeoJSON.Polygon>;
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
        const url = `/api/coverage/viewshed?lat=${p.lat}&lon=${p.lon}&radiusKm=${TERRAIN_FETCH_RADIUS_KM}&altitudeM=${p.altitudeM}`;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const geojson = (await r.json()) as GeoJSON.Feature<GeoJSON.Polygon>;
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
    <div style={styles.wrap}>
      <MapGL
        ref={mapRef}
        key={allMappable.length > 0 ? "has-gps" : "no-gps"}
        initialViewState={initialView}
        style={{ width: "100%", height: "100%" }}
        mapStyle={mapStyle}
        attributionControl={false}
        cursor={proposalPlanningMode ? "crosshair" : "grab"}
        onClick={(e) => {
          if (proposalPlanningMode) {
            const { lng, lat } = e.lngLat;
            const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
            const name = `Site ${letters[proposals.length % 26]}`;
            // Fetch terrain elevation at click point; default to terrain + 3m antenna height.
            fetch(`/api/elevation?lat=${lat}&lon=${lng}`)
              .then((r) => r.json())
              .then(({ elevationM }: { elevationM: number }) => {
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
        <NavigationControl position="top-right" />

        {/* Coverage layer — union mode renders one merged polygon; separate mode renders per-node. */}
        <Source id="coverage" type="geojson" data={coverageGeoJson}>
          <Layer
            id="coverage-fill"
            type="fill"
            paint={{
              "fill-color": ["get", "color"],
              "fill-opacity": ["case", ["==", ["get", "focused"], 1], 0.28, 0.15],
            }}
          />
          <Layer
            id="coverage-outline"
            type="line"
            paint={{
              "line-color": ["get", "color"],
              "line-width": ["case", ["==", ["get", "focused"], 1], 2.5, 1.5],
              "line-opacity": ["case", ["==", ["get", "focused"], 1], 0.9, 0.65],
            }}
          />
        </Source>

        {/* Proposal coverage layer — always separate from live node coverage, amber styling */}
        <Source id="proposal-coverage" type="geojson" data={proposalCoverageGeoJson}>
          <Layer
            id="proposal-coverage-fill"
            type="fill"
            paint={{ "fill-color": "#f59e0b", "fill-opacity": 0.18 }}
          />
          <Layer
            id="proposal-coverage-outline"
            type="line"
            paint={{
              "line-color": "#f59e0b",
              "line-width": 1.5,
              "line-dasharray": [3, 2],
              "line-opacity": 0.8,
            }}
          />
        </Source>

        {/* Traceroute lines — solid (all hops known) */}
        <Source id="traceroutes-solid" type="geojson" data={solidGeoJson}>
          <Layer
            id="traceroutes-solid-line"
            type="line"
            paint={{
              "line-color": ["get", "color"],
              "line-width": 2,
              "line-opacity": 0.75,
            }}
          />
        </Source>

        {/* Traceroute lines — dashed (some hops missing GPS) */}
        <Source id="traceroutes-dashed" type="geojson" data={dashedGeoJson}>
          <Layer
            id="traceroutes-dashed-line"
            type="line"
            paint={{
              "line-color": ["get", "color"],
              "line-width": 2,
              "line-opacity": 0.5,
              "line-dasharray": [3, 3],
            }}
          />
        </Source>

        {/* Mesh node markers */}
        {showMesh &&
          filteredMesh.map((node) => {
            const isLocal = node.hopsAway === 0;
            const color = nodeColor(node.nodeId);
            const stackCount = colocatedCounts.get(`${node.latitude}:${node.longitude}`) ?? 1;
            const hasStack = stackCount > 1;
            const size = hasStack ? "2.4rem" : "2rem";
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
                  style={{
                    ...styles.markerOuter,
                    borderColor: color,
                    boxShadow: `0 0 0 2px ${color}33`,
                    cursor: "pointer",
                  }}
                >
                  <div
                    style={{
                      ...styles.markerInner,
                      width: size,
                      height: size,
                      background: isLocal ? color : "#0f172a",
                      color: isLocal ? "#fff" : color,
                      border: `2px solid ${color}`,
                    }}
                  >
                    {resolveNodeName(node.nodeId, node, {
                      preference: ["shortName"],
                      fallback: nodeHex(node.nodeId).slice(-4),
                    }).slice(0, 4)}
                  </div>
                  {isLocal && <div style={styles.localRing} />}
                  {hasStack && <div style={styles.stackBadge}>+{stackCount}</div>}
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
            const size = hasStack ? "2.4rem" : "2rem";
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
                  style={{ ...styles.markerOuter, cursor: "pointer" }}
                >
                  <div
                    style={{
                      ...styles.markerInner,
                      width: size,
                      height: size,
                      background: "#0f172a",
                      color,
                      border: `2px dashed ${color}`,
                      boxShadow: `0 0 0 2px ${color}22`,
                    }}
                  >
                    {resolveNodeName(node.nodeId, node, {
                      preference: ["shortName"],
                      fallback: nodeHex(node.nodeId).slice(-4),
                    }).slice(0, 4)}
                  </div>
                  {hasStack && <div style={styles.stackBadge}>+{stackCount}</div>}
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
                  fetch(`/api/elevation?lat=${lat}&lon=${lng}`)
                    .then((r) => r.json())
                    .then(({ elevationM }: { elevationM: number }) => {
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
                  style={styles.proposalMarker}
                  title={`Proposal: ${p.name} — drag to reposition`}
                >
                  {/* Label on top */}
                  <span style={styles.proposalLabel}>{p.name}</span>
                  {/* Diamond head */}
                  <div style={styles.proposalDiamond} />
                  {/* Pole — bottom is the anchor point */}
                  <div style={styles.proposalPole} />
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
            style={{ fontFamily: "monospace" }}
          >
            <ProposalPopup
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
                    await fetch(
                      `/api/coverage/viewshed?lat=${n.latitude}&lon=${n.longitude}&radiusKm=${TERRAIN_FETCH_RADIUS_KM}`,
                      { method: "DELETE" },
                    ).catch(() => {
                      /* ignore — we'll re-fetch regardless */
                    });
                    // 2. Drop the in-memory polygon so the fetch loop doesn't skip it
                    viewshedCache.current.delete(`${nodeId}`);
                    // 3. Fetch the fresh viewshed directly (bypasses the loop queue)
                    const antennaM = n.altitude != null ? n.altitude + 2 : 2;
                    const url = `/api/coverage/viewshed?lat=${n.latitude}&lon=${n.longitude}&radiusKm=${TERRAIN_FETCH_RADIUS_KM}&altitudeM=${antennaM}`;
                    try {
                      const r = await fetch(url);
                      if (!r.ok) throw new Error(`HTTP ${r.status}`);
                      const geojson = (await r.json()) as GeoJSON.Feature<GeoJSON.Polygon>;
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
                style={{ fontFamily: "monospace" }}
              >
                {stackedNodes.length > 1 && (
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: "0.25rem",
                      padding: "0.35rem 0.5rem",
                      borderBottom: "1px solid #1e293b",
                      marginBottom: "0.35rem",
                      maxWidth: "260px",
                    }}
                  >
                    <span
                      style={{
                        fontSize: "0.65rem",
                        color: "#64748b",
                        width: "100%",
                        marginBottom: "0.1rem",
                      }}
                    >
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
                          style={{
                            padding: "0.15rem 0.4rem",
                            fontSize: "0.7rem",
                            fontFamily: "monospace",
                            borderRadius: "0.25rem",
                            border: `1px solid ${isActive ? nodeColor(sn.node.nodeId) : "#334155"}`,
                            background: isActive ? `${nodeColor(sn.node.nodeId)}22` : "#0f172a",
                            color: isActive ? nodeColor(sn.node.nodeId) : "#94a3b8",
                            cursor: "pointer",
                          }}
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
      </MapGL>

      {/* Traceroute + Coverage controls — top left, side by side */}
      <div
        style={{
          position: "absolute",
          top: "1rem",
          left: "1rem",
          display: "flex",
          flexDirection: "row",
          gap: "0.5rem",
          alignItems: "flex-start",
          zIndex: 10,
        }}
      >
        {/* ── Traceroute panel ─────────────────────────────────────────── */}
        <div style={{ ...styles.controlPanel }}>
          {/* Simple row — always visible */}
          <div style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
            <span style={styles.controlLabel}>Traceroutes:</span>

            <span style={styles.summaryPill}>
              {AGE_OPTIONS.find((o) => o.hours === ageHours)?.label ?? `${ageHours}h`}
            </span>

            <button
              style={{
                ...ageFilterBtnStyle(showTraceroutes),
                ...(!showTraceroutes ? { color: "#64748b" } : {}),
              }}
              onClick={() => setShowTraceroutes((v) => !v)}
              title={showTraceroutes ? "Hide traceroute lines" : "Show traceroute lines"}
            >
              {showTraceroutes ? "On" : "Off"}
            </button>

            <button
              style={{ ...ageFilterBtnStyle(tracerouteExpanded), padding: "0.2rem 0.35rem" }}
              onClick={() => setTracerouteExpanded((v) => !v)}
              title={tracerouteExpanded ? "Hide age options" : "Show age options"}
            >
              {tracerouteExpanded ? "▲" : "▼"}
            </button>

            <span style={{ color: "#64748b", fontSize: "0.7rem" }}>
              {showTraceroutes
                ? `${traceroutes.length} route${traceroutes.length !== 1 ? "s" : ""}`
                : "hidden"}
            </span>
          </div>

          {/* Age row — shown when expanded */}
          {tracerouteExpanded && (
            <div
              style={{
                display: "flex",
                gap: "0.3rem",
                alignItems: "center",
                paddingTop: "0.15rem",
                borderTop: "1px solid #1e293b",
              }}
            >
              <span style={{ ...styles.controlLabel, marginRight: 0 }}>Age:</span>
              {AGE_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  style={ageFilterBtnStyle(ageHours === opt.hours)}
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

        {/* ── Coverage panel ───────────────────────────────────────────── */}
        {(() => {
          const devicePreset = (() => {
            if (!deviceId || !deviceConfigs) return null;
            const cfg = deviceConfigs.get(deviceId);
            return (
              (cfg?.radioConfig as { lora?: { modemPreset?: number } } | undefined)?.lora
                ?.modemPreset ?? null
            );
          })();
          const summaryPreset = presetFilter !== null ? presetFilter : devicePreset;
          const summaryPresetLabel =
            summaryPreset != null
              ? (MODEM_PRESET_LABEL[summaryPreset] ?? `#${summaryPreset}`)
              : availablePresets.length > 1
                ? "All presets"
                : "—";
          const summaryRangeLabel =
            presetFilter !== null
              ? `${coverageRadiusKm}km`
              : summaryPreset != null
                ? `${MODEM_PRESET_RADIUS_KM[summaryPreset] ?? DEFAULT_RADIUS_KM}km`
                : "auto";

          const terrainStatus = (() => {
            if (!showCoverage || !terrainMode) return null;
            const total = viewshedStatus.size;
            if (total === 0) return null;
            const done = [...viewshedStatus.values()].filter((s) => s !== "loading").length;
            const errors = [...viewshedStatus.values()].filter((s) => s === "error").length;
            if (done < total)
              return {
                text: `⛰ ${done}/${total}`,
                color: "#fbbf24",
                title: "Computing terrain line-of-sight…",
              };
            return {
              text: errors > 0 ? `⛰ ${errors} failed` : "⛰ ready",
              color: errors > 0 ? "#fca5a5" : "#86efac",
              title: undefined,
            };
          })();

          const rowStyle: React.CSSProperties = {
            display: "flex",
            gap: "0.3rem",
            alignItems: "center",
          };

          return (
            <div style={{ ...styles.controlPanel }}>
              {/* Simple row — always visible */}
              <div style={rowStyle}>
                <span style={styles.controlLabel}>Coverage:</span>

                <span style={styles.summaryPill}>
                  {summaryPresetLabel} · {summaryRangeLabel}
                </span>

                <button
                  style={{
                    ...ageFilterBtnStyle(terrainMode),
                    ...(terrainMode
                      ? { borderColor: "#86efac", color: "#86efac", background: "#14532d" }
                      : {}),
                  }}
                  onClick={() => setTerrainMode((v) => !v)}
                  title={
                    terrainMode
                      ? "Switch to simple circle coverage"
                      : "Switch to terrain-aware coverage (fetches elevation data)"
                  }
                >
                  {terrainMode ? "Terrain" : "Simple"}
                </button>

                <button
                  style={{
                    ...ageFilterBtnStyle(coverageUnion),
                    ...(coverageUnion
                      ? { borderColor: "#a78bfa", color: "#a78bfa", background: "#2e1065" }
                      : {}),
                  }}
                  onClick={() => setCoverageUnion((v) => !v)}
                  title={
                    coverageUnion
                      ? "Switch to separate fills (each node draws its own circle)"
                      : "Switch to union fill (overlapping areas merge into one shape)"
                  }
                >
                  {coverageUnion ? "Union" : "Separate"}
                </button>

                <button
                  style={{
                    ...ageFilterBtnStyle(showCoverage),
                    ...(showCoverage ? {} : { color: "#64748b" }),
                  }}
                  onClick={() => setShowCoverage((v) => !v)}
                  title={showCoverage ? "Hide coverage overlay" : "Show coverage overlay"}
                >
                  {showCoverage ? "On" : "Off"}
                </button>

                <button
                  style={{ ...ageFilterBtnStyle(coverageExpanded), padding: "0.2rem 0.35rem" }}
                  onClick={() => setCoverageExpanded((v) => !v)}
                  title={
                    coverageExpanded
                      ? "Hide advanced coverage options"
                      : "Show advanced coverage options"
                  }
                >
                  {coverageExpanded ? "▲" : "▼"}
                </button>

                {effectiveFocusedNodeId != null && (
                  <>
                    <button
                      style={{
                        ...ageFilterBtnStyle(false),
                        borderColor: "#86efac",
                        color: "#86efac",
                      }}
                      onClick={() => {
                        setLocalFocusedNodeId(null);
                        onClearFocusedNode?.();
                      }}
                      title="Return to all-nodes coverage view"
                    >
                      ← All nodes
                    </button>
                    {effectiveFocusedNodeName && (
                      <span
                        style={{
                          color: "#86efac",
                          fontSize: "0.7rem",
                          fontFamily: "monospace",
                          maxWidth: "10rem",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {effectiveFocusedNodeName}
                      </span>
                    )}
                  </>
                )}

                {terrainStatus && (
                  <span
                    style={{
                      color: terrainStatus.color,
                      fontSize: "0.7rem",
                      fontFamily: "monospace",
                    }}
                    title={terrainStatus.title}
                  >
                    {terrainStatus.text}
                  </span>
                )}
              </div>

              {/* Advanced row — shown when expanded */}
              {coverageExpanded && (
                <div
                  style={{
                    ...rowStyle,
                    flexWrap: "wrap",
                    paddingTop: "0.15rem",
                    borderTop: "1px solid #1e293b",
                  }}
                >
                  <span style={{ ...styles.controlLabel, marginRight: 0 }}>Preset:</span>

                  <button
                    style={ageFilterBtnStyle(presetFilter === null)}
                    onClick={() => setPresetFilter?.(null)}
                    title="Show all presets at their own default range"
                  >
                    All
                  </button>

                  {availablePresets.map((p) => (
                    <button
                      key={p}
                      style={ageFilterBtnStyle(presetFilter === p)}
                      onClick={() => {
                        const next = presetFilter === p ? null : p;
                        setPresetFilter?.(next);
                        if (next !== null) {
                          setCoverageRadiusKm(MODEM_PRESET_RADIUS_KM[next] ?? DEFAULT_RADIUS_KM);
                          setUserPickedRadius(false);
                        }
                      }}
                      title={`${MODEM_PRESET_LABEL[p] ?? `#${p}`} — default range ${MODEM_PRESET_RADIUS_KM[p] ?? DEFAULT_RADIUS_KM}km`}
                    >
                      {MODEM_PRESET_LABEL[p] ?? `#${p}`}
                    </button>
                  ))}

                  {presetFilter !== null && (
                    <>
                      <span style={{ color: "#475569", margin: "0 0.1rem", fontSize: "0.8rem" }}>
                        |
                      </span>
                      <span style={{ ...styles.controlLabel, marginRight: 0 }}>Range:</span>
                      {COVERAGE_RADII_KM.map((km) => (
                        <button
                          key={km}
                          style={ageFilterBtnStyle(coverageRadiusKm === km)}
                          onClick={() => {
                            setCoverageRadiusKm(km);
                            setUserPickedRadius(true);
                          }}
                          title={`Set coverage radius to ${km} km`}
                        >
                          {km}km
                        </button>
                      ))}
                    </>
                  )}

                  {showMqtt && (
                    <>
                      <span style={{ color: "#475569", margin: "0 0.1rem", fontSize: "0.8rem" }}>
                        |
                      </span>
                      <button
                        style={{
                          ...ageFilterBtnStyle(coverageMqtt),
                          ...(coverageMqtt
                            ? { borderColor: "#34d399", color: "#34d399", background: "#052e16" }
                            : {}),
                        }}
                        onClick={() => setCoverageMqtt((v) => !v)}
                        title={
                          coverageMqtt
                            ? "Hide MQTT node coverage"
                            : "Include MQTT nodes in coverage overlay"
                        }
                      >
                        {coverageMqtt ? "−MQTT" : "+MQTT"}
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── Proposals panel ───────────────────────────────────────────── */}
        {(() => {
          const proposalTerrainStatus = (() => {
            if (!terrainMode || proposals.length === 0) return null;
            const visible = proposals.filter((p) => p.visible);
            if (visible.length === 0) return null;
            const total = visible.length;
            const done = visible.filter(
              (p) =>
                proposalViewshedStatus.get(p.id) !== "loading" &&
                proposalViewshedCache.current.has(p.id),
            ).length;
            const errors = visible.filter(
              (p) => proposalViewshedStatus.get(p.id) === "error",
            ).length;
            if (done < total)
              return {
                text: `⛰ ${done}/${total}`,
                color: "#fbbf24",
                title: "Computing terrain line-of-sight for proposals…",
              };
            return {
              text: errors > 0 ? `⛰ ${errors} failed` : "⛰ ready",
              color: errors > 0 ? "#fca5a5" : "#86efac",
              title: undefined,
            };
          })();

          return (
            <div style={{ ...styles.controlPanel }}>
              {/* Always-visible summary row */}
              <div style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
                <span style={styles.controlLabel}>Proposals:</span>
                <span style={styles.summaryPill}>
                  {proposals.length === 0
                    ? "none"
                    : `${proposals.filter((p) => p.visible).length}/${proposals.length}`}
                </span>
                <button
                  style={{
                    ...ageFilterBtnStyle(proposalPlanningMode),
                    ...(proposalPlanningMode
                      ? { borderColor: "#f59e0b", color: "#f59e0b", background: "#422006" }
                      : {}),
                  }}
                  onClick={() => setProposalPlanningMode((v) => !v)}
                  title={
                    proposalPlanningMode
                      ? "Click map to drop proposal pins. Click again to exit."
                      : "Enter planning mode to add proposal pins"
                  }
                >
                  {proposalPlanningMode ? "✦ Placing…" : "+ Place"}
                </button>
                {proposalTerrainStatus && (
                  <span
                    style={{
                      color: proposalTerrainStatus.color,
                      fontSize: "0.7rem",
                      fontFamily: "monospace",
                    }}
                    title={proposalTerrainStatus.title}
                  >
                    {proposalTerrainStatus.text}
                  </span>
                )}
                {proposals.length > 0 && (
                  <button
                    style={ageFilterBtnStyle(proposalsExpanded)}
                    onClick={() => setProposalsExpanded((v) => !v)}
                    title="Show/hide proposal list"
                  >
                    {proposalsExpanded ? "▲" : "▼"}
                  </button>
                )}
              </div>

              {/* Expanded proposal list */}
              {proposalsExpanded && proposals.length > 0 && (
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.25rem",
                    paddingTop: "0.15rem",
                    borderTop: "1px solid #1e293b",
                    width: "100%",
                  }}
                >
                  {proposals.map((p) => (
                    <div
                      key={p.id}
                      style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}
                    >
                      <button
                        style={{
                          ...ageFilterBtnStyle(p.visible),
                          padding: "0.15rem 0.4rem",
                          minWidth: "2.5rem",
                          ...(p.visible
                            ? { borderColor: "#f59e0b", color: "#f59e0b", background: "#422006" }
                            : {}),
                        }}
                        onClick={() => {
                          fetch(`/api/proposals/${p.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ visible: !p.visible }),
                          })
                            .then((r) => r.json())
                            .then((updated: CoverageProposal) =>
                              setProposals((prev) =>
                                prev.map((x) => (x.id === updated.id ? updated : x)),
                              ),
                            )
                            .catch(console.error);
                        }}
                        title={p.visible ? "Hide this proposal" : "Show this proposal"}
                      >
                        {p.visible ? "●" : "○"}
                      </button>
                      <span
                        style={{
                          flex: 1,
                          color: "#cbd5e1",
                          fontSize: "0.7rem",
                          fontFamily: "monospace",
                        }}
                      >
                        {p.name}
                      </span>
                      <span
                        style={{ color: "#64748b", fontSize: "0.65rem", fontFamily: "monospace" }}
                      >
                        {MODEM_PRESET_LABEL[p.modemPreset]?.replace(/_/g, " ") ??
                          `#${p.modemPreset}`}
                      </span>
                      <button
                        style={{
                          ...ageFilterBtnStyle(false),
                          padding: "0.15rem 0.4rem",
                          color: "#ef4444",
                        }}
                        onClick={() => {
                          fetch(`/api/proposals/${p.id}`, { method: "DELETE" })
                            .then(() => {
                              setProposals((prev) => prev.filter((x) => x.id !== p.id));
                              proposalViewshedCache.current.delete(p.id);
                              setProposalViewshedStatus((prev) => {
                                const m = new Map(prev);
                                m.delete(p.id);
                                return m;
                              });
                              if (selectedProposal?.id === p.id) setSelectedProposal(null);
                            })
                            .catch(console.error);
                        }}
                        title="Delete this proposal"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  {/* Copy all proposals as GeoJSON FeatureCollection */}
                  <button
                    style={{
                      ...ageFilterBtnStyle(false),
                      marginTop: "0.1rem",
                      textAlign: "center",
                      width: "100%",
                    }}
                    onClick={() => {
                      const fc: GeoJSON.FeatureCollection = {
                        type: "FeatureCollection",
                        features: proposals.map((p) => ({
                          type: "Feature",
                          geometry: { type: "Point", coordinates: [p.lon, p.lat, p.altitudeM] },
                          properties: {
                            name: p.name,
                            altitudeM: p.altitudeM,
                            modemPreset: p.modemPreset,
                            modemPresetLabel:
                              MODEM_PRESET_LABEL[p.modemPreset] ?? `#${p.modemPreset}`,
                            coverageRadiusKm: MODEM_PRESET_RADIUS_KM[p.modemPreset] ?? 10,
                            notes: p.notes,
                          },
                        })),
                      };
                      navigator.clipboard
                        .writeText(JSON.stringify(fc, null, 2))
                        .catch(console.error);
                    }}
                    title="Copy all proposals as GeoJSON FeatureCollection to clipboard"
                  >
                    Copy All GeoJSON
                  </button>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* Search filter — top center */}
      <div
        style={{
          position: "absolute",
          top: "0.75rem",
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          alignItems: "center",
          gap: "0.35rem",
          background: "#0f172a",
          border: "1px solid #334155",
          borderRadius: "0.5rem",
          padding: "0.25rem 0.5rem",
          zIndex: 10,
          boxShadow: "0 2px 8px #0008",
        }}
      >
        <span style={{ color: "#64748b", fontSize: "0.75rem", userSelect: "none" }}>🔍</span>
        <input
          type="text"
          placeholder="node name or !hex…"
          value={mapSearch}
          onChange={(e) => setMapSearch(e.target.value)}
          style={{
            background: "transparent",
            border: "none",
            outline: "none",
            color: "#e2e8f0",
            fontSize: "0.75rem",
            fontFamily: "monospace",
            width: "14rem",
          }}
        />
        {mapSearch && (
          <>
            <span
              style={{
                color: "#94a3b8",
                fontSize: "0.7rem",
                fontFamily: "monospace",
                whiteSpace: "nowrap",
              }}
            >
              {filteredMesh.length + filteredMqtt.length} shown
            </span>
            <button
              onClick={() => setMapSearch("")}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "#64748b",
                fontSize: "0.85rem",
                lineHeight: 1,
                padding: "0 0.1rem",
              }}
              title="Clear search"
            >
              ✕
            </button>
          </>
        )}
      </div>

      {/* Legend — bottom left */}
      <div style={styles.legend}>
        <span style={styles.legendItem}>
          <span
            style={{
              position: "relative",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <span
              style={{ ...styles.legendDot, background: "#3b82f6", border: "2px solid #3b82f6" }}
            />
            <span
              style={{
                position: "absolute",
                inset: "-3px",
                borderRadius: "50%",
                border: "2px dashed #22c55e",
              }}
            />
          </span>
          Direct (0 hops)
        </span>
        <span style={styles.legendItem}>
          <span
            style={{ ...styles.legendDot, background: "#0f172a", border: "2px solid #94a3b8" }}
          />
          Mesh
        </span>
        <span style={styles.legendItem}>
          <span
            style={{ ...styles.legendDot, background: "#0f172a", border: "2px dashed #94a3b8" }}
          />
          MQTT
        </span>
        <span style={styles.legendItem}>
          <span style={styles.legendLine} />
          Traceroute
        </span>
        <span style={styles.legendItem}>
          <span style={{ ...styles.legendLine, borderStyle: "dashed", opacity: 0.6 }} />
          Traceroute (gap)
        </span>
        {showCoverage && (
          <span style={styles.legendItem}>
            <span
              style={{
                display: "inline-block",
                width: "1rem",
                height: "1rem",
                borderRadius: terrainMode ? "2px" : coverageUnion ? "2px" : "50%",
                background: coverageUnion ? "#3b82f633" : "#94a3b833",
                border: `1px solid ${coverageUnion ? "#3b82f6" : "#94a3b8"}`,
              }}
            />
            {terrainMode
              ? "Terrain LOS"
              : coverageUnion
                ? "Coverage (union)"
                : `${coverageRadiusKm}km range`}
          </span>
        )}
        {showProposals && proposals.some((p) => p.visible) && (
          <span style={styles.legendItem}>
            <span
              style={{
                display: "inline-block",
                width: "1rem",
                height: "1rem",
                borderRadius: "2px",
                background: "#f59e0b33",
                border: "1px dashed #f59e0b",
              }}
            />
            Proposed site
          </span>
        )}
        <span style={{ color: "#64748b" }}>
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

function ageFilterBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: "0.2rem 0.45rem",
    fontSize: "0.7rem",
    borderRadius: "0.3rem",
    border: active ? "1px solid #60a5fa" : "1px solid #334155",
    background: active ? "#1e3a5f" : "#1e293b",
    color: active ? "#93c5fd" : "#94a3b8",
    cursor: "pointer",
  };
}

// ---------------------------------------------------------------------------
// Popup components
// ---------------------------------------------------------------------------

interface MeshPopupProps {
  node: NodeInfo;
  deviceId: string | null;
  pending: "ping" | "traceroute" | null;
  onRequestPosition: () => void;
  onTraceroute: () => void;
  onMessage?: () => void;
  onFocusCoverage?: () => void;
  onRefreshTerrain?: () => void;
  terrainRefreshing?: boolean;
}

function MeshPopup({
  node,
  deviceId,
  pending,
  onRequestPosition,
  onTraceroute,
  onMessage,
  onFocusCoverage,
  onRefreshTerrain,
  terrainRefreshing,
}: MeshPopupProps) {
  return (
    <div style={popupStyles.popup}>
      <div style={popupStyles.name}>
        {resolveNodeName(node.nodeId, node, { preference: ["longName"] })}
      </div>
      {node.shortName && node.longName && <div style={popupStyles.muted}>{node.shortName}</div>}
      <div style={popupStyles.grid}>
        <span style={popupStyles.label}>ID</span>
        <span style={popupStyles.mono}>{nodeHex(node.nodeId)}</span>

        <span style={popupStyles.label}>Last heard</span>
        <span>{formatLastHeard(node.lastHeard)}</span>

        <span style={popupStyles.label}>Hops</span>
        <span>
          {node.hopsAway === null ? "—" : node.hopsAway === 0 ? "Direct" : `${node.hopsAway} away`}
        </span>

        {node.snr != null && (
          <>
            <span style={popupStyles.label}>SNR</span>
            <span>{node.snr.toFixed(1)} dB</span>
          </>
        )}

        {node.hwModel != null && (
          <>
            <span style={popupStyles.label}>Model</span>
            <span>{HW_MODEL[node.hwModel] ?? `#${node.hwModel}`}</span>
          </>
        )}

        <span style={popupStyles.label}>GPS</span>
        <span style={popupStyles.mono}>
          {node.latitude!.toFixed(5)}, {node.longitude!.toFixed(5)}
          {node.altitude != null && ` (${node.altitude}m)`}
        </span>
      </div>

      <div style={popupStyles.actions}>
        {onFocusCoverage && (
          <button
            style={{ ...popupActionBtnStyle(false), borderColor: "#166534", color: "#15803d" }}
            onClick={onFocusCoverage}
          >
            🗺 Coverage Map
          </button>
        )}
        {deviceId && (
          <>
            <button
              style={popupActionBtnStyle(pending === "ping")}
              disabled={!!pending}
              onClick={onRequestPosition}
            >
              {pending === "ping" ? "Requesting…" : "📍 Request Position"}
            </button>
            <button
              style={popupActionBtnStyle(pending === "traceroute")}
              disabled={!!pending}
              onClick={onTraceroute}
            >
              {pending === "traceroute" ? "Tracing…" : "🔍 Traceroute"}
            </button>
            {onMessage && (
              <button style={popupActionBtnStyle(false)} onClick={onMessage}>
                ✉ Messages Tab
              </button>
            )}
          </>
        )}
        {onRefreshTerrain && (
          <button
            style={popupActionBtnStyle(terrainRefreshing === true)}
            disabled={terrainRefreshing}
            onClick={onRefreshTerrain}
            title="Clear cached terrain data and recompute line-of-sight from fresh elevation data"
          >
            {terrainRefreshing ? "⛰ Recalculating…" : "⛰ Recalculate Terrain"}
          </button>
        )}
      </div>
    </div>
  );
}

function MqttPopup({
  node,
  onFocusCoverage,
  onRefreshTerrain,
  terrainRefreshing,
}: {
  node: MqttNode;
  onFocusCoverage?: () => void;
  onRefreshTerrain?: () => void;
  terrainRefreshing?: boolean;
}) {
  return (
    <div style={popupStyles.popup}>
      <div style={popupStyles.name}>
        {resolveNodeName(node.nodeId, node, { preference: ["longName"] })}
      </div>
      {node.shortName && node.longName && <div style={popupStyles.muted}>{node.shortName}</div>}
      <div style={popupStyles.tag}>MQTT</div>
      <div style={popupStyles.grid}>
        <span style={popupStyles.label}>ID</span>
        <span style={popupStyles.mono}>{nodeHex(node.nodeId)}</span>

        <span style={popupStyles.label}>Last heard</span>
        <span>{formatLastHeard(node.lastHeard)}</span>

        <span style={popupStyles.label}>Gateway</span>
        <span style={popupStyles.mono}>{node.lastGateway ?? "—"}</span>

        {node.snr != null && (
          <>
            <span style={popupStyles.label}>SNR</span>
            <span>{node.snr.toFixed(1)} dB</span>
          </>
        )}

        {node.hwModel != null && (
          <>
            <span style={popupStyles.label}>Model</span>
            <span>{HW_MODEL[node.hwModel] ?? `#${node.hwModel}`}</span>
          </>
        )}

        <span style={popupStyles.label}>GPS</span>
        <span style={popupStyles.mono}>
          {node.latitude!.toFixed(5)}, {node.longitude!.toFixed(5)}
          {node.altitude != null && ` (${node.altitude}m)`}
        </span>
      </div>
      {(onFocusCoverage || onRefreshTerrain) && (
        <div style={popupStyles.actions}>
          {onFocusCoverage && (
            <button
              style={{ ...popupActionBtnStyle(false), borderColor: "#166534", color: "#15803d" }}
              onClick={onFocusCoverage}
            >
              🗺 Coverage Map
            </button>
          )}
          {onRefreshTerrain && (
            <button
              style={popupActionBtnStyle(terrainRefreshing === true)}
              disabled={terrainRefreshing}
              onClick={onRefreshTerrain}
              title="Clear cached terrain data and recompute line-of-sight from fresh elevation data"
            >
              {terrainRefreshing ? "⛰ Recalculating…" : "⛰ Recalculate Terrain"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proposal popup component
// ---------------------------------------------------------------------------

function ProposalPopup({
  proposal,
  onUpdate,
  onDelete,
}: {
  proposal: CoverageProposal;
  onUpdate: (updated: CoverageProposal) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(proposal.name);
  const [altitudeM, setAltitudeM] = useState(proposal.altitudeM);
  const [modemPreset, setModemPreset] = useState(proposal.modemPreset);
  const [notes, setNotes] = useState(proposal.notes ?? "");
  const [dirty, setDirty] = useState(false);

  const handleSave = () => {
    onUpdate({
      ...proposal,
      name: name.trim() || proposal.name,
      altitudeM,
      modemPreset,
      notes: notes.trim() || null,
    });
    setDirty(false);
  };

  const handleCopyGeoJSON = () => {
    const feature: GeoJSON.Feature = {
      type: "Feature",
      geometry: { type: "Point", coordinates: [proposal.lon, proposal.lat, altitudeM] },
      properties: {
        name: name.trim() || proposal.name,
        altitudeM,
        modemPreset,
        modemPresetLabel: MODEM_PRESET_LABEL[modemPreset] ?? `#${modemPreset}`,
        coverageRadiusKm: MODEM_PRESET_RADIUS_KM[modemPreset] ?? 10,
        notes: notes.trim() || null,
      },
    };
    navigator.clipboard.writeText(JSON.stringify(feature, null, 2)).catch(console.error);
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    background: "#f8fafc",
    border: "1px solid #cbd5e1",
    borderRadius: "0.25rem",
    padding: "0.2rem 0.4rem",
    fontFamily: "monospace",
    fontSize: "0.75rem",
    color: "#1e293b",
    boxSizing: "border-box",
  };

  return (
    <div style={{ ...popupStyles.popup, minWidth: "220px" }}>
      <div style={{ ...popupStyles.tag, background: "#fef3c7", color: "#92400e" }}>Proposal</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
        <div>
          <label style={popupStyles.label}>Name</label>
          <input
            style={inputStyle}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
          />
        </div>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          <div style={{ flex: 1 }}>
            <label style={popupStyles.label}>Altitude (m)</label>
            <input
              style={inputStyle}
              type="number"
              min={0}
              max={9000}
              value={altitudeM}
              onChange={(e) => {
                setAltitudeM(Number(e.target.value));
                setDirty(true);
              }}
            />
          </div>
          <div style={{ flex: 2 }}>
            <label style={popupStyles.label}>Modem Preset</label>
            <select
              style={inputStyle}
              value={modemPreset}
              onChange={(e) => {
                setModemPreset(Number(e.target.value));
                setDirty(true);
              }}
            >
              {Object.entries(MODEM_PRESET_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label style={popupStyles.label}>Notes</label>
          <textarea
            style={{ ...inputStyle, resize: "vertical", minHeight: "2.5rem" }}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setDirty(true);
            }}
          />
        </div>
        <div style={{ color: "#64748b", fontSize: "0.65rem", fontFamily: "monospace" }}>
          {proposal.lat.toFixed(5)}, {proposal.lon.toFixed(5)}
          &nbsp;·&nbsp;{MODEM_PRESET_RADIUS_KM[modemPreset] ?? 10}km radius
        </div>
      </div>
      <div style={popupStyles.actions}>
        {dirty && (
          <button style={popupActionBtnStyle(false)} onClick={handleSave}>
            Save Changes
          </button>
        )}
        <button style={popupActionBtnStyle(false)} onClick={handleCopyGeoJSON}>
          Copy GeoJSON
        </button>
        <button
          style={{ ...popupActionBtnStyle(false), borderColor: "#fca5a5", color: "#dc2626" }}
          onClick={onDelete}
        >
          Delete Proposal
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    flex: 1,
    position: "relative",
    minHeight: 0,
    overflow: "hidden",
  },
  markerOuter: {
    position: "relative",
    borderRadius: "50%",
  },
  markerInner: {
    width: "2rem",
    height: "2rem",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: "0.6rem",
    fontWeight: "bold",
    fontFamily: "monospace",
    userSelect: "none",
  },
  localRing: {
    position: "absolute",
    inset: "-4px",
    borderRadius: "50%",
    border: "2px dashed #22c55e",
    pointerEvents: "none",
  },
  stackBadge: {
    position: "absolute",
    top: "-5px",
    right: "-5px",
    background: "#f59e0b",
    color: "#000",
    fontSize: "0.5rem",
    fontWeight: "bold",
    fontFamily: "monospace",
    borderRadius: "0.6rem",
    padding: "0 0.25rem",
    minWidth: "1rem",
    height: "1rem",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    pointerEvents: "none",
    lineHeight: 1,
  },
  controls: {
    position: "absolute",
    top: "1rem",
    left: "1rem",
    background: "#0f172acc",
    backdropFilter: "blur(4px)",
    color: "#e2e8f0",
    padding: "0.4rem 0.6rem",
    borderRadius: "0.5rem",
    fontSize: "0.75rem",
    display: "flex",
    gap: "0.3rem",
    alignItems: "center",
    zIndex: 10,
  },
  controlPanel: {
    background: "#0f172acc",
    backdropFilter: "blur(4px)",
    color: "#e2e8f0",
    padding: "0.4rem 0.6rem",
    borderRadius: "0.5rem",
    fontSize: "0.75rem",
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.35rem",
    alignItems: "flex-start",
  },
  summaryPill: {
    fontSize: "0.7rem",
    color: "#cbd5e1",
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "0.3rem",
    padding: "0.15rem 0.45rem",
    fontFamily: "monospace",
  },
  controlLabel: {
    color: "#94a3b8",
    marginRight: "0.15rem",
    fontSize: "0.7rem",
  },
  legend: {
    position: "absolute",
    bottom: "1rem",
    left: "1rem",
    background: "#0f172acc",
    backdropFilter: "blur(4px)",
    color: "#e2e8f0",
    padding: "0.5rem 0.75rem",
    borderRadius: "0.5rem",
    fontSize: "0.75rem",
    display: "flex",
    gap: "1rem",
    alignItems: "center",
    zIndex: 10,
  },
  legendItem: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
  },
  legendDot: {
    width: "0.75rem",
    height: "0.75rem",
    borderRadius: "50%",
    display: "inline-block",
  },
  legendLine: {
    display: "inline-block",
    width: "1.5rem",
    height: 0,
    borderTop: "2px solid #94a3b8",
  },
  proposalMarker: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    cursor: "pointer",
  },
  proposalDiamond: {
    width: "14px",
    height: "14px",
    background: "#f59e0b",
    border: "2px solid #fff",
    transform: "rotate(45deg)",
    boxShadow: "0 0 4px #f59e0b88",
    flexShrink: 0,
  },
  proposalPole: {
    width: "2px",
    height: "18px",
    background: "#f59e0b",
    flexShrink: 0,
  },
  proposalLabel: {
    fontSize: "0.6rem",
    fontFamily: "monospace",
    color: "#fef3c7",
    fontWeight: "bold",
    background: "#78350fdd",
    borderRadius: "0.2rem",
    padding: "0 0.25rem",
    marginTop: "2px",
    whiteSpace: "nowrap" as const,
    pointerEvents: "none" as const,
    boxShadow: "0 1px 3px #00000066",
  },
};

function popupActionBtnStyle(active: boolean): React.CSSProperties {
  return {
    display: "block",
    width: "100%",
    textAlign: "left",
    background: active ? "#dbeafe" : "#f1f5f9",
    border: `1px solid ${active ? "#93c5fd" : "#cbd5e1"}`,
    color: active ? "#1d4ed8" : "#334155",
    borderRadius: "0.25rem",
    padding: "0.3rem 0.5rem",
    cursor: active ? "not-allowed" : "pointer",
    fontFamily: "monospace",
    fontSize: "0.75rem",
  };
}

const popupStyles: Record<string, React.CSSProperties> = {
  popup: { minWidth: "200px", fontSize: "0.8rem", color: "#1e293b" },
  name: { fontWeight: "bold", fontSize: "0.9rem", marginBottom: "0.1rem" },
  muted: { color: "#64748b", marginBottom: "0.25rem" },
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: "0.3rem",
    marginTop: "0.6rem",
    paddingTop: "0.5rem",
    borderTop: "1px solid #e2e8f0",
  },
  tag: {
    display: "inline-block",
    background: "#dbeafe",
    color: "#1d4ed8",
    borderRadius: "0.25rem",
    padding: "0 0.35rem",
    fontSize: "0.65rem",
    fontWeight: "bold",
    marginBottom: "0.4rem",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "auto 1fr",
    gap: "0.2rem 0.75rem",
    alignItems: "baseline",
  },
  label: { color: "#64748b", fontSize: "0.75rem" },
  mono: { fontFamily: "monospace", fontSize: "0.75rem" },
};
