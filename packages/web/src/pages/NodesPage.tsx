import { useState, useEffect, Fragment } from "react";
import type { DeviceInfo, NodeInfo, MqttNode } from "@foreman/shared";
import logo from "../assets/logo.png";
import { NodeDetailPanel } from "./NodeDetailPanel.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatLastHeard(iso: string | null): string {
  if (!iso) return "—";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function nodeHex(nodeId: number): string {
  return `!${nodeId.toString(16).padStart(8, "0")}`;
}

function formatDistance(distanceM: number | null): string {
  if (distanceM === null) return "—";
  if (distanceM < 1000) return `${Math.round(distanceM)} m`;
  return `${(distanceM / 1000).toFixed(1)} km`;
}

function formatHops(hopsAway: number | null): string {
  if (hopsAway === null) return "—";
  if (hopsAway === 0) return "Direct";
  return `${hopsAway} hop${hopsAway > 1 ? "s" : ""}`;
}

// Complete HardwareModel enum extracted from @meshtastic/core protobufs.
// Keys are the numeric protobuf values; values are the canonical enum names.
const HW_MODEL: Record<number, string> = {
  0:   "UNSET",
  1:   "TLORA_V2",
  2:   "TLORA_V1",
  3:   "TLORA_V2_1_1P6",
  4:   "TBEAM",
  5:   "HELTEC_V2_0",
  6:   "TBEAM_V0P7",
  7:   "T_ECHO",
  8:   "TLORA_V1_1P3",
  9:   "RAK4631",
  10:  "HELTEC_V2_1",
  11:  "HELTEC_V1",
  12:  "LILYGO_TBEAM_S3_CORE",
  13:  "RAK11200",
  14:  "NANO_G1",
  15:  "TLORA_V2_1_1P8",
  16:  "TLORA_T3_S3",
  17:  "NANO_G1_EXPLORER",
  18:  "NANO_G2_ULTRA",
  19:  "LORA_TYPE",
  20:  "WIPHONE",
  21:  "WIO_WM1110",
  22:  "RAK2560",
  23:  "HELTEC_HRU_3601",
  24:  "HELTEC_WIRELESS_BRIDGE",
  25:  "STATION_G1",
  26:  "RAK11310",
  27:  "SENSELORA_RP2040",
  28:  "SENSELORA_S3",
  29:  "CANARYONE",
  30:  "RP2040_LORA",
  31:  "STATION_G2",
  32:  "LORA_RELAY_V1",
  33:  "NRF52840DK",
  34:  "PPR",
  35:  "GENIEBLOCKS",
  36:  "NRF52_UNKNOWN",
  37:  "PORTDUINO",
  38:  "ANDROID_SIM",
  39:  "DIY_V1",
  40:  "NRF52840_PCA10059",
  41:  "DR_DEV",
  42:  "M5STACK",
  43:  "HELTEC_V3",
  44:  "HELTEC_WSL_V3",
  45:  "BETAFPV_2400_TX",
  46:  "BETAFPV_900_NANO_TX",
  47:  "RPI_PICO",
  48:  "HELTEC_WIRELESS_TRACKER",
  49:  "HELTEC_WIRELESS_PAPER",
  50:  "T_DECK",
  51:  "T_WATCH_S3",
  52:  "PICOMPUTER_S3",
  53:  "HELTEC_HT62",
  54:  "EBYTE_ESP32_S3",
  55:  "ESP32_S3_PICO",
  56:  "CHATTER_2",
  57:  "HELTEC_WIRELESS_PAPER_V1_0",
  58:  "HELTEC_WIRELESS_TRACKER_V1_0",
  59:  "UNPHONE",
  60:  "TD_LORAC",
  61:  "CDEBYTE_EORA_S3",
  62:  "TWC_MESH_V4",
  63:  "NRF52_PROMICRO_DIY",
  64:  "RADIOMASTER_900_BANDIT_NANO",
  65:  "HELTEC_CAPSULE_SENSOR_V3",
  66:  "HELTEC_VISION_MASTER_T190",
  67:  "HELTEC_VISION_MASTER_E213",
  68:  "HELTEC_VISION_MASTER_E290",
  69:  "HELTEC_MESH_NODE_T114",
  70:  "SENSECAP_INDICATOR",
  71:  "TRACKER_T1000_E",
  72:  "RAK3172",
  73:  "WIO_E5",
  74:  "RADIOMASTER_900_BANDIT",
  75:  "ME25LS01_4Y10TD",
  76:  "RP2040_FEATHER_RFM95",
  77:  "M5STACK_COREBASIC",
  78:  "M5STACK_CORE2",
  79:  "RPI_PICO2",
  80:  "M5STACK_CORES3",
  81:  "SEEED_XIAO_S3",
  82:  "MS24SF1",
  83:  "TLORA_C6",
  84:  "WISMESH_TAP",
  85:  "ROUTASTIC",
  86:  "MESH_TAB",
  87:  "MESHLINK",
  88:  "XIAO_NRF52_KIT",
  89:  "THINKNODE_M1",
  90:  "THINKNODE_M2",
  91:  "T_ETH_ELITE",
  92:  "HELTEC_SENSOR_HUB",
  93:  "RESERVED_FRIED_CHICKEN",
  94:  "HELTEC_MESH_POCKET",
  95:  "SEEED_SOLAR_NODE",
  96:  "NOMADSTAR_METEOR_PRO",
  97:  "CROWPANEL",
  98:  "LINK_32",
  99:  "SEEED_WIO_TRACKER_L1",
  100: "SEEED_WIO_TRACKER_L1_EINK",
  101: "MUZI_R1_NEO",
  102: "T_DECK_PRO",
  103: "T_LORA_PAGER",
  104: "M5STACK_RESERVED",
  105: "WISMESH_TAG",
  106: "RAK3312",
  107: "THINKNODE_M5",
  108: "HELTEC_MESH_SOLAR",
  109: "T_ECHO_LITE",
  110: "HELTEC_V4",
  111: "M5STACK_C6L",
  112: "M5STACK_CARDPUTER_ADV",
  113: "HELTEC_WIRELESS_TRACKER_V2",
  114: "T_WATCH_ULTRA",
  115: "THINKNODE_M3",
  116: "WISMESH_TAP_V2",
  117: "RAK3401",
  118: "RAK6421",
  119: "THINKNODE_M4",
  120: "THINKNODE_M6",
  121: "MESHSTICK_1262",
  122: "TBEAM_1_WATT",
  123: "T5_S3_EPAPER_PRO",
  124: "TBEAM_BPF",
  125: "MINI_EPAPER_S3",
  126: "TDISPLAY_S3_PRO",
  127: "HELTEC_MESH_NODE_T096",
  128: "TRACKER_T1000_E_PRO",
  255: "PRIVATE_HW",
};

/** Convert a snake_case enum name to a readable label, e.g. TRACKER_T1000_E → Tracker T1000-E */
function formatHwModelName(raw: string): string {
  return raw
    .split("_")
    .map((word) => {
      // Keep purely numeric or version-like tokens as-is (e.g. "V2", "S3", "1P6")
      if (/^[0-9]/.test(word)) return word;
      // Capitalise first letter, lowercase the rest
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

// ---------------------------------------------------------------------------
// Live fallback — queries the daemon's /api/hw-models endpoint, which is
// populated server-side from the upstream protobufs repo (refreshed every 72 h).
// ---------------------------------------------------------------------------

let _hwModelFetch: Promise<Map<number, string>> | null = null;

function fetchHwModelsFromApi(): Promise<Map<number, string>> {
  if (_hwModelFetch) return _hwModelFetch;
  _hwModelFetch = fetch("/api/hw-models")
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<Record<string, string>>;
    })
    .then((data) => new Map(Object.entries(data).map(([k, v]) => [Number(k), v])))
    .catch(() => new Map());
  return _hwModelFetch;
}

function hwModel(model: number | null, protoMap: Map<number, string>): string {
  if (model === null) return "—";
  const name = HW_MODEL[model] ?? protoMap.get(model);
  if (!name) return `#${model}`;
  if (name === "UNSET") return "—";
  return formatHwModelName(name);
}

// ---------------------------------------------------------------------------
// Data merging
// ---------------------------------------------------------------------------

interface MergedNode {
  nodeId: number;
  mesh: NodeInfo | null;
  mqtt: MqttNode | null;
}

function buildMergedNodes(nodes: NodeInfo[], mqttNodes: MqttNode[]): MergedNode[] {
  const map = new Map<number, MergedNode>();
  for (const n of nodes) map.set(n.nodeId, { nodeId: n.nodeId, mesh: n, mqtt: null });
  for (const n of mqttNodes) {
    const existing = map.get(n.nodeId);
    if (existing) {
      existing.mqtt = n;
    } else {
      map.set(n.nodeId, { nodeId: n.nodeId, mesh: null, mqtt: n });
    }
  }
  return [...map.values()];
}

function lastHeardMs(m: MergedNode): number {
  const meshMs = m.mesh?.lastHeard ? new Date(m.mesh.lastHeard).getTime() : 0;
  const mqttMs = m.mqtt?.lastHeard ? new Date(m.mqtt.lastHeard).getTime() : 0;
  return Math.max(meshMs, mqttMs);
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

function filterNodes(list: MergedNode[], query: string): MergedNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter((m) => {
    const p = m.mesh ?? m.mqtt!;
    const longName  = (p.longName  ?? "").toLowerCase();
    const shortName = (p.shortName ?? "").toLowerCase();
    const hexFull   = nodeHex(m.nodeId).toLowerCase(); // "!abcdef01"
    const hexBare   = hexFull.slice(1);                // "abcdef01"
    const dec       = String(m.nodeId);
    const searchHex = q.startsWith("!") ? q.slice(1) : q;
    return (
      longName.includes(q)  ||
      shortName.includes(q) ||
      hexFull.includes(q)   ||
      hexBare.includes(searchHex) ||
      dec.includes(q)
    );
  });
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

type SortCol = "name" | "id" | "connection" | "lastHeard" | "snr" | "model" | "location" | "distance";

function sortMerged(list: MergedNode[], col: SortCol, dir: "asc" | "desc", protoMap: Map<number, string>): MergedNode[] {
  return [...list].sort((a, b) => {
    const pa = a.mesh ?? a.mqtt!;
    const pb = b.mesh ?? b.mqtt!;
    let cmp = 0;
    switch (col) {
      case "name": {
        const na = (pa.longName ?? pa.shortName ?? "").toLowerCase();
        const nb = (pb.longName ?? pb.shortName ?? "").toLowerCase();
        cmp = na.localeCompare(nb);
        break;
      }
      case "id":
        cmp = a.nodeId - b.nodeId;
        break;
      case "connection": {
        // Sort by hops (nulls last), MQTT-only after mesh
        const ha = a.mesh != null ? (a.mesh.hopsAway ?? 999) : 9999;
        const hb = b.mesh != null ? (b.mesh.hopsAway ?? 999) : 9999;
        cmp = ha - hb;
        break;
      }
      case "lastHeard":
        cmp = lastHeardMs(a) - lastHeardMs(b);
        break;
      case "snr": {
        const sa = pa.snr ?? -Infinity;
        const sb = pb.snr ?? -Infinity;
        cmp = sa - sb;
        break;
      }
      case "model": {
        const ma = hwModel(pa.hwModel, protoMap);
        const mb = hwModel(pb.hwModel, protoMap);
        cmp = ma.localeCompare(mb);
        break;
      }
      case "location": {
        const la = pa.latitude ?? -Infinity;
        const lb = pb.latitude ?? -Infinity;
        cmp = la - lb;
        break;
      }
      case "distance": {
        const da = a.mqtt?.distanceM ?? Infinity;
        const db = b.mqtt?.distanceM ?? Infinity;
        cmp = da - db;
        break;
      }
    }
    return dir === "asc" ? cmp : -cmp;
  });
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  devices: DeviceInfo[];
  nodes: NodeInfo[];
  mqttNodes: MqttNode[];
  onMessage?: (nodeId: number) => void;
  onCoverageMap?: (nodeId: number) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function NodesPage({ devices, nodes, mqttNodes, onMessage, onCoverageMap }: Props) {
  const [filter, setFilter] = useState("");
  const [sortCol, setSortCol] = useState<SortCol>("distance");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [selectedNodeId, setSelectedNodeId] = useState<number | null>(null);
  const [protoMap, setProtoMap] = useState<Map<number, string>>(new Map());

  // Fetch the DB-backed hw-models map once on mount. The daemon syncs it from
  // the protobufs repo at startup (throttled to once per 72 h), so this is
  // just a cheap local API call — no GitHub traffic from the browser.
  useEffect(() => {
    fetchHwModelsFromApi().then(setProtoMap);
  }, []);

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem("nodes-sections-collapsed");
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });

  function toggleSection(key: string) {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem("nodes-sections-collapsed", JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  function handleSort(col: SortCol) {
    if (sortCol === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortCol(col);
      setSortDir(col === "name" || col === "model" || col === "id" || col === "distance" ? "asc" : "desc");
    }
  }

  // Build, filter, sort, then section
  const allMerged = buildMergedNodes(nodes, mqttNodes);
  const filtered  = filterNodes(allMerged, filter);

  const apply = (list: MergedNode[]) => sortMerged(list, sortCol, sortDir, protoMap);

  const isUnknown = (n: MergedNode) =>
    (n.mesh ?? n.mqtt)?.longName?.toLowerCase() === "unknown";

  const matched      = apply(filtered.filter((n) => n.mesh && n.mqtt && !isUnknown(n)));
  const meshOnly     = apply(filtered.filter((n) => n.mesh && !n.mqtt && !isUnknown(n)));
  const mqttOnly     = apply(filtered.filter((n) => !n.mesh && n.mqtt && !isUnknown(n)));
  const unknownNodes = apply(filtered.filter(isUnknown));

  const totalUnique = nodes.length + allMerged.filter((n) => !n.mesh && n.mqtt).length;
  const isEmpty = nodes.length === 0 && mqttNodes.length === 0;
  const noResults = !isEmpty && filtered.length === 0;

  const sharedHeaderProps = { sortCol, sortDir, onSort: handleSort };

  const nodeRowProps = {
    selectedNodeId, protoMap,
    onRowClick: (id: number) => setSelectedNodeId((prev) => prev === id ? null : id),
  };

  const selectedMerged = selectedNodeId != null
    ? allMerged.find((m) => m.nodeId === selectedNodeId) ?? null
    : null;

  return (
    <div style={styles.page}>
      {selectedMerged && (
        <NodeDetailPanel
          nodeId={selectedMerged.nodeId}
          mesh={selectedMerged.mesh}
          mqtt={selectedMerged.mqtt}
          devices={devices}
          onClose={() => setSelectedNodeId(null)}
          onMessage={onMessage}
          onCoverageMap={onCoverageMap}
        />
      )}
      <section style={styles.section}>
        {/* Title + search bar row */}
        <div style={styles.titleRow}>
          <h2 style={styles.sectionTitle}>
            Nodes
            <span style={{ ...styles.badge, background: "#334155", marginLeft: "0.5rem" }}>
              {filter ? `${filtered.length} / ${totalUnique}` : totalUnique}
            </span>
            {matched.length > 0 && !filter && (
              <span style={{ ...styles.badge, background: "#1e3a5f", color: "#60a5fa", marginLeft: "0.4rem", fontSize: "0.65rem" }}>
                {matched.length} matched
              </span>
            )}
          </h2>

          <div style={styles.searchWrap}>
            <input
              style={styles.searchInput}
              placeholder="Search name, short name, !hex or decimal ID…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {filter && (
              <button style={styles.clearBtn} onClick={() => setFilter("")} title="Clear search">✕</button>
            )}
          </div>
        </div>

        {isEmpty ? (
          <div style={styles.emptyState}>
            <img src={logo} alt="" style={styles.emptyLogo} />
            <p style={styles.muted}>No nodes seen yet.</p>
          </div>
        ) : noResults ? (
          <div style={styles.emptyState}>
            <p style={styles.muted}>No nodes match &ldquo;{filter}&rdquo;</p>
          </div>
        ) : (
          <div style={styles.tableWrap}>
            <table style={styles.table}>
              <thead>
                <tr>
                  <SortableHeader col="name"       label="Node"        {...sharedHeaderProps} />
                  <SortableHeader col="id"         label="ID"          {...sharedHeaderProps} />
                  <SortableHeader col="connection" label="Connection"  {...sharedHeaderProps} />
                  <SortableHeader col="lastHeard"  label="Last Heard"  {...sharedHeaderProps} />
                  <SortableHeader col="snr"        label="SNR"         {...sharedHeaderProps} />
                  <SortableHeader col="model"      label="Model"       {...sharedHeaderProps} />
                  <SortableHeader col="distance"   label="Distance"    {...sharedHeaderProps} />
                  <SortableHeader col="location"   label="Location"    {...sharedHeaderProps} />
                </tr>
              </thead>
              <tbody>
                {matched.length > 0 && (
                  <>
                    <SectionHeader label="Mesh + MQTT" count={matched.length} colCount={8} color="#60a5fa"
                      collapsed={!!collapsed["both"]} onToggle={() => toggleSection("both")} />
                    {!collapsed["both"] && matched.map((m) => <NodeRows key={m.nodeId} merged={m} {...nodeRowProps} />)}
                  </>
                )}
                {meshOnly.length > 0 && (
                  <>
                    <SectionHeader label="Mesh only" count={meshOnly.length} colCount={8} color="#94a3b8"
                      collapsed={!!collapsed["mesh"]} onToggle={() => toggleSection("mesh")} />
                    {!collapsed["mesh"] && meshOnly.map((m) => <NodeRows key={m.nodeId} merged={m} {...nodeRowProps} />)}
                  </>
                )}
                {mqttOnly.length > 0 && (
                  <>
                    <SectionHeader label="MQTT only" count={mqttOnly.length} colCount={8} color="#34d399"
                      collapsed={!!collapsed["mqtt"]} onToggle={() => toggleSection("mqtt")} />
                    {!collapsed["mqtt"] && mqttOnly.map((m) => <NodeRows key={m.nodeId} merged={m} {...nodeRowProps} />)}
                  </>
                )}
                {unknownNodes.length > 0 && (
                  <>
                    <SectionHeader label="Unknown" count={unknownNodes.length} colCount={8} color="#6b7280"
                      collapsed={!!collapsed["unknown"]} onToggle={() => toggleSection("unknown")} />
                    {!collapsed["unknown"] && unknownNodes.map((m) => <NodeRows key={m.nodeId} merged={m} {...nodeRowProps} />)}
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable column header
// ---------------------------------------------------------------------------

function SortableHeader({ col, label, sortCol, sortDir, onSort }: {
  col: SortCol; label: string; sortCol: SortCol; sortDir: "asc" | "desc";
  onSort: (col: SortCol) => void;
}) {
  const active = sortCol === col;
  return (
    <th
      style={{ ...styles.th, cursor: "pointer", userSelect: "none", color: active ? "#e2e8f0" : "#94a3b8" }}
      onClick={() => onSort(col)}
    >
      {label}
      <span style={{ marginLeft: "0.3rem", fontSize: "0.65rem", opacity: active ? 1 : 0.35 }}>
        {active ? (sortDir === "asc" ? "▲" : "▼") : "▲▼"}
      </span>
    </th>
  );
}

// ---------------------------------------------------------------------------
// Accordion section header row
// ---------------------------------------------------------------------------

function SectionHeader({ label, count, colCount, color, collapsed, onToggle }: {
  label: string; count: number; colCount: number; color: string;
  collapsed: boolean; onToggle: () => void;
}) {
  return (
    <tr
      style={{ background: "#0f172a", cursor: "pointer", userSelect: "none" }}
      onClick={onToggle}
    >
      <td
        colSpan={colCount}
        style={{
          padding: "0.4rem 0.75rem",
          fontSize: "0.7rem",
          fontWeight: "bold",
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color,
          borderTop: "1px solid #1e293b",
          borderBottom: "1px solid #1e293b",
        }}
      >
        <span style={{ marginRight: "0.5rem", fontSize: "0.6rem", opacity: 0.7 }}>
          {collapsed ? "▶" : "▼"}
        </span>
        {label}
        <span style={{
          marginLeft: "0.5rem",
          background: "#1e293b",
          borderRadius: "9999px",
          padding: "0.1rem 0.4rem",
          fontSize: "0.65rem",
          color: "#64748b",
          fontWeight: "normal",
          letterSpacing: 0,
          textTransform: "none",
        }}>
          {count}
        </span>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Node row(s) — mesh primary + optional MQTT sub-row + optional traceroute row
// ---------------------------------------------------------------------------

interface NodeRowsProps {
  merged: MergedNode;
  selectedNodeId: number | null;
  protoMap: Map<number, string>;
  onRowClick: (id: number) => void;
}

function NodeRows({ merged, selectedNodeId, protoMap, onRowClick }: NodeRowsProps) {
  const { nodeId, mesh, mqtt } = merged;
  const primary = mesh ?? mqtt!;
  const isMqttOnly = !mesh;
  const isSelected = selectedNodeId === nodeId;

  return (
    <Fragment>
      <tr
        style={{ ...styles.tr, background: isSelected ? "#0f2a4a" : undefined, cursor: "pointer" }}
        onClick={() => onRowClick(nodeId)}
      >
        <td style={styles.td}>
          <strong>{primary.longName ?? primary.shortName ?? "Unknown"}</strong>
          {primary.shortName && primary.longName && (
            <span style={{ ...styles.muted, marginLeft: "0.4rem" }}>({primary.shortName})</span>
          )}
        </td>
        <td style={{ ...styles.td, ...styles.mono }}>{nodeHex(nodeId)}</td>
        <td style={styles.td}>
          {isMqttOnly ? (
            <span style={styles.mqttChip}>MQTT</span>
          ) : (
            <>
              {formatHops(mesh!.hopsAway)}
              {mqtt && <span style={{ ...styles.mqttChip, marginLeft: "0.4rem" }}>+MQTT</span>}
            </>
          )}
        </td>
        <td style={styles.td}>{formatLastHeard(primary.lastHeard)}</td>
        <td style={styles.td}>{primary.snr != null ? `${primary.snr.toFixed(1)} dB` : "—"}</td>
        <td style={styles.td}>{hwModel(primary.hwModel, protoMap)}</td>
        <td style={styles.td}>{formatDistance(mqtt?.distanceM ?? null)}</td>
        <td style={{ ...styles.td, ...styles.mono }}>
          {primary.latitude != null && primary.longitude != null
            ? `${primary.latitude.toFixed(5)}, ${primary.longitude.toFixed(5)}`
            : "—"}
        </td>
      </tr>

      {mesh && mqtt && (
        <tr style={{ background: "#080f1a", borderBottom: "1px solid #1e293b" }}>
          <td colSpan={8} style={{ ...styles.td, paddingLeft: "2.25rem", paddingTop: "0.25rem", paddingBottom: "0.3rem", fontSize: "0.75rem", color: "#64748b" }}>
            <span style={{ color: "#34d399", fontWeight: "bold", marginRight: "0.5rem" }}>↳ MQTT</span>
            {mqtt.lastGateway && <>via <span style={{ fontFamily: "monospace", color: "#94a3b8" }}>{mqtt.lastGateway}</span>{" · "}</>}
            {formatLastHeard(mqtt.lastHeard)}
            {mqtt.snr != null && mqtt.snr !== 0 && ` · SNR ${mqtt.snr.toFixed(1)} dB`}
            {mqtt.regionPath && <span style={{ marginLeft: "0.5rem", color: "#475569" }}>{mqtt.regionPath}</span>}
            {mqtt.latitude != null && mqtt.longitude != null && mesh.latitude == null && (
              <span style={{ marginLeft: "0.5rem", fontFamily: "monospace", color: "#94a3b8" }}>
                · GPS {mqtt.latitude.toFixed(5)}, {mqtt.longitude.toFixed(5)}
              </span>
            )}
          </td>
        </tr>
      )}
    </Fragment>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  page: { padding: "1.5rem 2rem" },
  section: { marginBottom: "2rem" },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: "1rem",
    marginBottom: "0.75rem",
    flexWrap: "wrap",
  },
  sectionTitle: {
    fontSize: "1rem",
    color: "#94a3b8",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    margin: 0,
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
  },
  badge: {
    padding: "0.15rem 0.5rem",
    borderRadius: "9999px",
    fontSize: "0.75rem",
    color: "#fff",
    fontWeight: "bold",
  },
  searchWrap: {
    position: "relative",
    flex: 1,
    minWidth: "200px",
    maxWidth: "400px",
  },
  searchInput: {
    width: "100%",
    background: "#1e293b",
    border: "1px solid #334155",
    borderRadius: "0.375rem",
    color: "#e2e8f0",
    padding: "0.3rem 2rem 0.3rem 0.6rem",
    fontFamily: "monospace",
    fontSize: "0.8rem",
    boxSizing: "border-box" as const,
    outline: "none",
  },
  clearBtn: {
    position: "absolute",
    right: "0.4rem",
    top: "50%",
    transform: "translateY(-50%)",
    background: "none",
    border: "none",
    color: "#64748b",
    cursor: "pointer",
    fontSize: "0.75rem",
    padding: "0 0.2rem",
    lineHeight: 1,
  },
  muted: { color: "#64748b", fontSize: "0.85rem" },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: "0.875rem" },
  th: {
    textAlign: "left",
    padding: "0.5rem 0.75rem",
    background: "#1e293b",
    color: "#94a3b8",
    fontWeight: "normal",
    borderBottom: "1px solid #334155",
    whiteSpace: "nowrap",
    position: "sticky" as const,
    top: 0,
    zIndex: 1,
  },
  tr: { borderBottom: "1px solid #1e293b" },
  td: { padding: "0.5rem 0.75rem", verticalAlign: "middle" },
  emptyState: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    padding: "4rem 2rem",
    gap: "1.5rem",
  },
  emptyLogo: { width: "12rem", opacity: 0.15 },
  mono: { fontFamily: "monospace", fontSize: "0.8rem", color: "#94a3b8" },
  mqttChip: {
    display: "inline-block",
    background: "#052e16",
    color: "#34d399",
    border: "1px solid #166534",
    borderRadius: "0.2rem",
    padding: "0 0.3rem",
    fontSize: "0.65rem",
    fontWeight: "bold",
    verticalAlign: "middle",
  },
};
