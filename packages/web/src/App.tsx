import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import apiPromisesRaw from "../../../API_PROMISES.md?raw";

import logo from "./assets/logo.png";
import { applyNodeOverrides } from "./lib/nodeOverrides.js";
import { formatRelativeTime } from "./lib/relativeTime.js";
import { ActivityPage } from "./pages/ActivityPage.js";
import { AnalyticsPage } from "./pages/AnalyticsPage.js";
import { DeviceConfigPage } from "./pages/DeviceConfigPage.js";
import { IntroModal } from "./pages/IntroModal.js";
import { LogsPage } from "./pages/LogsPage.js";
import { MapPage } from "./pages/MapPage.js";
import { MessagesPage } from "./pages/MessagesPage.js";
import { NodeOverridesPage } from "./pages/NodeOverridesPage.js";
import { NodesPage } from "./pages/NodesPage.js";
import { initMessageStore, loadRecentMessages } from "./store/messages.js";
import { foremanClient } from "./ws/client.js";

import type {
  DeviceInfo,
  NodeInfo,
  MqttNode,
  NodeOverride,
  ActivityEntry,
  LogEntry,
  DeviceConfig,
} from "@foreman/shared";

type MqttScope = "city" | "county" | "state" | "country" | "all";

// Initialize message store once at module load
initMessageStore();

type Tab =
  "nodes" | "map" | "messages" | "activity" | "logs" | "overrides" | "config" | "analytics";
type ActivityWindow = "5m" | "15m" | "1h" | "all";
type ActivitySource = "all" | "mesh" | "mqtt";
type LogsLevel = "all" | "log" | "warn" | "error";

const KNOWN_TAGS = ["devices", "mqtt", "ws", "db", "foreman"] as const;
type TagFilter = "all" | (typeof KNOWN_TAGS)[number];

const TAG_COLORS: Record<string, string> = {
  devices: "#60a5fa",
  mqtt: "#34d399",
  ws: "#a78bfa",
  db: "#fb923c",
  foreman: "#94a3b8",
};

function batteryColor(level: number): string {
  if (level <= 20) return "#ef4444";
  if (level <= 50) return "#f59e0b";
  return "#22c55e";
}

function BatteryBar({ level }: { level: number }) {
  const color = batteryColor(level);
  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", marginLeft: "auto" }}
    >
      <span style={{ color, fontSize: "0.7rem" }}>{level}%</span>
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          width: "2.5rem",
          height: "0.65rem",
          border: `1px solid ${color}`,
          borderRadius: "0.15rem",
          padding: "0.08rem",
          position: "relative",
        }}
      >
        <span
          style={{
            display: "block",
            width: `${level}%`,
            height: "100%",
            background: color,
            borderRadius: "0.08rem",
            transition: "width 0.5s ease",
          }}
        />
      </span>
    </span>
  );
}

async function apiDisconnect(id: string) {
  await fetch(`/api/devices/${id}`, { method: "DELETE" });
}

async function apiConnect(port: string, name: string) {
  await fetch("/api/devices/connect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ port, name }),
  });
}

export function App() {
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [nodes, setNodes] = useState<NodeInfo[]>([]);
  const [mqttNodes, setMqttNodes] = useState<MqttNode[]>([]);
  const [overrides, setOverrides] = useState<Map<number, NodeOverride>>(new Map());
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [mqttEnabled, setMqttEnabled] = useState(false);
  const [connected, setConnected] = useState(false);
  const [tab, setTab] = useState<Tab>("nodes");
  const [deviceConfigs, setDeviceConfigs] = useState<Map<string, DeviceConfig>>(new Map());
  const [introOpen, setIntroOpen] = useState(() => !localStorage.getItem("foreman_intro_seen"));
  const [pendingWizard, setPendingWizard] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRef = useRef<HTMLDivElement>(null);
  const [mqttOpen, setMqttOpen] = useState(false);
  const mqttRef = useRef<HTMLDivElement>(null);
  const [mqttScope, setMqttScope] = useState<MqttScope>("county");
  const [apiDocsOpen, setApiDocsOpen] = useState(false);
  const [gpsOpen, setGpsOpen] = useState(false);
  const gpsRef = useRef<HTMLDivElement>(null);
  const [gpsPending, setGpsPending] = useState<Set<string>>(new Set());
  const [messageTarget, setMessageTarget] = useState<number | null>(null);
  const [focusedCoverageNodeId, setFocusedCoverageNodeId] = useState<number | null>(null);

  // ── Map filters ────────────────────────────────────────────────────────────
  const [showMesh, setShowMesh] = useState(true);
  const [showMqtt, setShowMqtt] = useState(true);
  /** null = show all presets */
  const [presetFilter, setPresetFilter] = useState<number | null>(null);

  // ── Activity filters ───────────────────────────────────────────────────────
  const [activityWindow, setActivityWindow] = useState<ActivityWindow>("15m");
  const [activitySource, setActivitySource] = useState<ActivitySource>("all");
  const [activityPaused, setActivityPaused] = useState(false);

  // ── Logs filters ───────────────────────────────────────────────────────────
  const [logsLevel, setLogsLevel] = useState<LogsLevel>("all");
  const [logsTag, setLogsTag] = useState<TagFilter>("all");
  const [logsPaused, setLogsPaused] = useState(false);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // Close MQTT panel on outside click
  useEffect(() => {
    if (!mqttOpen) return;
    const handler = (e: MouseEvent) => {
      if (mqttRef.current && !mqttRef.current.contains(e.target as Node)) {
        setMqttOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [mqttOpen]);

  // Close settings panel on outside click
  useEffect(() => {
    if (!settingsOpen) return;
    const handler = (e: MouseEvent) => {
      if (settingsRef.current && !settingsRef.current.contains(e.target as Node)) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [settingsOpen]);

  // Close GPS panel on outside click
  useEffect(() => {
    if (!gpsOpen) return;
    const handler = (e: MouseEvent) => {
      if (gpsRef.current && !gpsRef.current.contains(e.target as Node)) {
        setGpsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [gpsOpen]);

  const loadOverrides = useCallback(async () => {
    try {
      const res = await fetch("/api/node-overrides");
      if (!res.ok) return;
      const list: NodeOverride[] = await res.json();
      setOverrides(new Map(list.map((o) => [o.nodeId, o])));
    } catch {
      // daemon may not be up yet — silently ignore
    }
  }, []);

  useEffect(() => {
    loadOverrides();
  }, [loadOverrides]);

  useEffect(() => {
    foremanClient.connect();

    const offConn = foremanClient.onConnection((isConnected) => setConnected(isConnected));
    const off = foremanClient.on((event) => {
      if (event.type === "device:list") {
        setDevices(event.payload);
        for (const device of event.payload) {
          loadRecentMessages(device.id);
        }
      }
      if (event.type === "device:status") {
        setDevices((prev) => {
          const exists = prev.find((d) => d.id === event.payload.id);
          if (exists) return prev.map((d) => (d.id === event.payload.id ? event.payload : d));
          return [...prev, event.payload];
        });
        if (event.payload.gpsDetail) {
          setGpsPending((prev) => {
            const next = new Set(prev);
            next.delete(event.payload.id);
            return next;
          });
        }
      }
      if (event.type === "node:list") {
        setNodes(sortNodes(event.payload));
      }
      if (event.type === "node:update") {
        setNodes((prev) => {
          const exists = prev.find((n) => n.nodeId === event.payload.nodeId);
          const updated = exists
            ? prev.map((n) => (n.nodeId === event.payload.nodeId ? event.payload : n))
            : [...prev, event.payload];
          return sortNodes(updated);
        });
      }
      if (event.type === "mqtt_node:list") {
        setMqttNodes(sortMqttNodes(event.payload));
      }
      if (event.type === "mqtt_node:update") {
        setMqttNodes((prev) => {
          const exists = prev.find((n) => n.nodeId === event.payload.nodeId);
          const updated = exists
            ? prev.map((n) => (n.nodeId === event.payload.nodeId ? event.payload : n))
            : [...prev, event.payload];
          return sortMqttNodes(updated);
        });
      }
      if (event.type === "activity:snapshot") {
        setActivity(event.payload);
      }
      if (event.type === "activity:entry") {
        setActivity((prev) => {
          const next = [...prev, event.payload];
          return next.length > 500 ? next.slice(next.length - 500) : next;
        });
      }
      if (event.type === "log:snapshot") {
        setLogs(event.payload);
      }
      if (event.type === "log:entry") {
        setLogs((prev) => {
          const next = [...prev, event.payload];
          return next.length > 500 ? next.slice(next.length - 500) : next;
        });
      }
      if (event.type === "mqtt:status") {
        setMqttEnabled(event.payload.enabled);
      }
      if (event.type === "device:config") {
        setDeviceConfigs((prev) => new Map(prev).set(event.payload.deviceId, event.payload));
      }
      if (event.type === "error") {
        console.error(`[ws] server error ${event.payload.code}: ${event.payload.message}`);
      }
    });

    return () => {
      off();
      offConn();
      foremanClient.disconnect();
      setConnected(false);
    };
  }, []);

  const toggleMqtt = useCallback(() => {
    foremanClient.send({ type: "mqtt:toggle", payload: { enabled: !mqttEnabled } });
  }, [mqttEnabled]);

  const navigate = useCallback((t: Tab) => {
    setTab(t);
    setMenuOpen(false);
    setSettingsOpen(false);
  }, []);

  // Merge override fallbacks before passing to pages
  const effectiveNodes = applyNodeOverrides(nodes, overrides);
  const effectiveMqttNodes = applyNodeOverrides(mqttNodes, overrides);

  // Derive gateway region from the connected device's own node in MQTT
  const gatewayRegion = useMemo(() => {
    const ownNodeId = devices.find((d) => d.status === "connected")?.ownNodeId;
    if (ownNodeId == null) return null;
    return mqttNodes.find((n) => n.nodeId === ownNodeId)?.regionPath ?? null;
  }, [devices, mqttNodes]);

  // Region prefix to match against, based on selected scope
  const mqttRegionPrefix = useMemo(() => {
    if (mqttScope === "all" || gatewayRegion == null) return null;
    const parts = gatewayRegion.split("/");
    const depth: Record<MqttScope, number> = { city: 4, county: 3, state: 2, country: 1, all: 0 };
    return parts.slice(0, depth[mqttScope]).join("/");
  }, [mqttScope, gatewayRegion]);

  // Apply scope filter on top of overrides
  const scopedMqttNodes = useMemo(() => {
    if (mqttRegionPrefix === null) return effectiveMqttNodes;
    return effectiveMqttNodes.filter(
      (n) => n.regionPath != null && n.regionPath.startsWith(mqttRegionPrefix),
    );
  }, [effectiveMqttNodes, mqttRegionPrefix]);

  // Counts for map filter buttons
  const mappableMeshCount = effectiveNodes.filter(
    (n) => n.latitude != null && n.longitude != null,
  ).length;
  const mappableMqttCount = scopedMqttNodes.filter(
    (n) => n.latitude != null && n.longitude != null,
  ).length;

  // Tag counts for log filter buttons
  const logTagCounts: Record<string, number> = {};
  for (const e of logs) logTagCounts[e.tag] = (logTagCounts[e.tag] ?? 0) + 1;

  const noLocationNodes: Array<{
    nodeId: number;
    longName: string | null;
    shortName: string | null;
  }> = (() => {
    const seen = new Map<
      number,
      { nodeId: number; longName: string | null; shortName: string | null }
    >();
    for (const n of nodes) {
      if (n.latitude == null)
        seen.set(n.nodeId, { nodeId: n.nodeId, longName: n.longName, shortName: n.shortName });
    }
    for (const [id, ov] of overrides) {
      if (ov.latitude != null) seen.delete(id);
    }
    return [...seen.values()].sort((a, b) => a.nodeId - b.nodeId);
  })();

  const hasTabFilters = tab === "map" || tab === "activity" || tab === "logs";

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <img src={logo} alt="Meshtastic Foreman" style={styles.logo} />
        <h1 style={styles.title}>Meshtastic Foreman</h1>

        <nav style={styles.nav}>
          <button style={tabStyle(tab === "nodes")} onClick={() => setTab("nodes")}>
            Nodes
          </button>
          <button style={tabStyle(tab === "map")} onClick={() => setTab("map")}>
            Map
          </button>
          <button style={tabStyle(tab === "messages")} onClick={() => setTab("messages")}>
            Messages
          </button>
          <button style={tabStyle(tab === "analytics")} onClick={() => setTab("analytics")}>
            Analytics
          </button>
        </nav>

        {/* ── GPS panel ─────────────────────────────────────────────────────── */}
        {(() => {
          const hasAnyGps = devices.some((d) => d.status === "connected" && d.hasGpsPosition);
          const gpsColor = hasAnyGps ? "#22c55e" : "#ef4444";
          return (
            <div ref={gpsRef} style={{ position: "relative", flexShrink: 0, marginLeft: "auto" }}>
              <button
                onClick={() => setGpsOpen((v) => !v)}
                style={menuBtnStyle(gpsOpen, hasAnyGps)}
              >
                <span style={{ color: gpsColor, fontSize: "0.65rem" }}>●</span>
                GPS
                <span style={{ color: "#475569", marginLeft: "0.3rem", fontSize: "0.65rem" }}>
                  ▾
                </span>
              </button>

              {gpsOpen && (
                <div style={{ ...styles.menuPanel, minWidth: "300px" }}>
                  <style>{`@keyframes _spin { to { transform: rotate(360deg); } }`}</style>
                  {devices.filter((d) => d.status === "connected").length === 0 ? (
                    <div style={styles.menuSection}>
                      <span style={{ color: "#475569", fontSize: "0.72rem" }}>
                        No connected devices
                      </span>
                    </div>
                  ) : (
                    devices
                      .filter((d) => d.status === "connected")
                      .map((d) => (
                        <div key={d.id}>
                          <div style={styles.menuSection}>
                            <span style={styles.menuSectionLabel}>{d.port}</span>
                            {d.gpsDetail ? (
                              <table
                                style={{
                                  width: "100%",
                                  fontSize: "0.75rem",
                                  borderCollapse: "collapse",
                                }}
                              >
                                <tbody>
                                  {[
                                    ["Latitude", d.gpsDetail.latitude.toFixed(6)],
                                    ["Longitude", d.gpsDetail.longitude.toFixed(6)],
                                    [
                                      "Altitude",
                                      d.gpsDetail.altitude != null
                                        ? `${d.gpsDetail.altitude} m`
                                        : "—",
                                    ],
                                    ["Sats in view", d.gpsDetail.satsInView ?? "—"],
                                    [
                                      "PDOP",
                                      d.gpsDetail.pdop != null
                                        ? (d.gpsDetail.pdop / 100).toFixed(2)
                                        : "—",
                                    ],
                                    [
                                      "HDOP",
                                      d.gpsDetail.hdop != null
                                        ? (d.gpsDetail.hdop / 100).toFixed(2)
                                        : "— (enable HVDOP flag)",
                                    ],
                                    [
                                      "Source",
                                      d.gpsDetail.locationSource != null
                                        ? (["Unset", "Manual", "Internal", "External"][
                                            d.gpsDetail.locationSource
                                          ] ?? d.gpsDetail.locationSource)
                                        : "—",
                                    ],
                                    [
                                      "GPS time",
                                      d.gpsDetail.gpsTimestamp
                                        ? new Date(d.gpsDetail.gpsTimestamp).toLocaleTimeString()
                                        : "—",
                                    ],
                                  ].map(([label, value]) => (
                                    <tr key={String(label)}>
                                      <td
                                        style={{
                                          color: "#475569",
                                          paddingRight: "0.75rem",
                                          paddingBottom: "0.15rem",
                                        }}
                                      >
                                        {label}
                                      </td>
                                      <td style={{ color: "#e2e8f0", fontFamily: "monospace" }}>
                                        {String(value)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            ) : (
                              <span style={{ color: "#475569", fontSize: "0.75rem" }}>
                                Waiting for GPS fix…
                              </span>
                            )}
                            {d.ownNodeId != null &&
                              (() => {
                                const pending = gpsPending.has(d.id);
                                return (
                                  <button
                                    style={{
                                      background: "#1e293b",
                                      border: "1px solid #334155",
                                      color: "#94a3b8",
                                      padding: "0.2rem 0.6rem",
                                      borderRadius: "0.25rem",
                                      cursor: pending ? "default" : "pointer",
                                      fontFamily: "monospace",
                                      fontSize: "0.75rem",
                                      marginTop: "0.5rem",
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: "0.35rem",
                                      opacity: pending ? 0.7 : 1,
                                    }}
                                    disabled={pending}
                                    onClick={() => {
                                      console.log(
                                        `[gps] requesting position for device ${d.id} nodeId=${d.ownNodeId}`,
                                      );
                                      setGpsPending((prev) => new Set(prev).add(d.id));
                                      foremanClient.send({
                                        type: "node:request-position",
                                        payload: { deviceId: d.id, nodeId: d.ownNodeId! },
                                      });
                                      setTimeout(
                                        () =>
                                          setGpsPending((prev) => {
                                            const next = new Set(prev);
                                            next.delete(d.id);
                                            return next;
                                          }),
                                        15000,
                                      );
                                    }}
                                  >
                                    {pending && (
                                      <span
                                        style={{
                                          display: "inline-block",
                                          width: "0.7rem",
                                          height: "0.7rem",
                                          border: "2px solid #475569",
                                          borderTopColor: "#94a3b8",
                                          borderRadius: "50%",
                                          animation: "_spin 0.7s linear infinite",
                                        }}
                                      />
                                    )}
                                    {pending ? "Refreshing…" : "Refresh GPS"}
                                  </button>
                                );
                              })()}
                            {d.ownNodeId == null && (
                              <span
                                style={{
                                  color: "#475569",
                                  fontSize: "0.7rem",
                                  marginTop: "0.4rem",
                                  display: "block",
                                }}
                              >
                                Node ID not yet known — reconnect to enable position request
                              </span>
                            )}
                          </div>
                          <div style={styles.menuDivider} />
                        </div>
                      ))
                  )}
                </div>
              )}
            </div>
          );
        })()}

        {/* ── MQTT dropdown ─────────────────────────────────────────────────── */}
        <div ref={mqttRef} style={styles.menuContainer}>
          <button
            onClick={() => setMqttOpen((v) => !v)}
            style={menuBtnStyle(mqttOpen, mqttEnabled)}
          >
            <span style={{ color: mqttEnabled ? "#4ade80" : "#ef4444", fontSize: "0.65rem" }}>
              ●
            </span>
            MQTT
            <span style={{ color: "#94a3b8", fontSize: "0.7rem" }}>
              {mqttScope !== "all" ? mqttScope : "all"}
            </span>
            <span style={{ color: "#475569", marginLeft: "0.1rem", fontSize: "0.65rem" }}>▾</span>
          </button>

          {mqttOpen && (
            <div style={styles.menuPanel}>
              <div style={styles.menuSection}>
                <span style={styles.menuSectionLabel}>MQTT broker</span>
                <button
                  onClick={toggleMqtt}
                  style={{
                    ...menuNavBtn(mqttEnabled),
                    color: mqttEnabled ? "#4ade80" : "#f87171",
                    borderColor: mqttEnabled ? "#16a34a" : "#ef4444",
                    background: mqttEnabled ? "#166534" : "#1e293b",
                  }}
                >
                  {mqttEnabled ? "On" : "Off"}
                </button>
              </div>

              <div style={styles.menuDivider} />

              <div style={styles.menuSection}>
                <span style={styles.menuSectionLabel}>
                  Region scope
                  {gatewayRegion == null && (
                    <span style={{ color: "#f59e0b", marginLeft: "0.4rem", fontSize: "0.65rem" }}>
                      (no gateway region)
                    </span>
                  )}
                </span>
                {gatewayRegion != null && (
                  <span
                    style={{
                      color: "#475569",
                      fontSize: "0.65rem",
                      fontFamily: "monospace",
                      marginBottom: "0.25rem",
                    }}
                  >
                    {gatewayRegion}
                  </span>
                )}
                {(["city", "county", "state", "country", "all"] as MqttScope[]).map((s) => (
                  <button
                    key={s}
                    style={menuNavBtn(mqttScope === s)}
                    onClick={() => setMqttScope(s)}
                    title={
                      gatewayRegion == null && s !== "all"
                        ? "Gateway region not yet known"
                        : undefined
                    }
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)}
                  </button>
                ))}
                <span style={{ color: "#475569", fontSize: "0.65rem", marginTop: "0.2rem" }}>
                  {mqttScope !== "all" && gatewayRegion != null
                    ? `${scopedMqttNodes.length} / ${effectiveMqttNodes.length} nodes`
                    : `${effectiveMqttNodes.length} nodes`}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* ── System menu ───────────────────────────────────────────────────── */}
        <div ref={menuRef} style={styles.menuContainer}>
          <button onClick={() => setMenuOpen((v) => !v)} style={menuBtnStyle(menuOpen, connected)}>
            <span style={{ color: connected ? "#22c55e" : "#ef4444", fontSize: "0.65rem" }}>●</span>
            API
            <span style={{ color: "#475569", marginLeft: "0.3rem", fontSize: "0.65rem" }}>▾</span>
          </button>

          {menuOpen && (
            <div style={styles.menuPanel}>
              {/* COM port details */}
              <div style={styles.menuSection}>
                <span style={styles.menuSectionLabel}>Devices</span>
                {devices.length === 0 ? (
                  <span style={{ color: "#475569", fontSize: "0.72rem" }}>
                    No devices — POST /api/devices/connect
                  </span>
                ) : (
                  devices.map((d) => (
                    <div
                      key={d.id}
                      style={{
                        ...styles.menuDevice,
                        flexDirection: "column",
                        alignItems: "flex-start",
                        gap: "0.25rem",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.4rem",
                          width: "100%",
                        }}
                      >
                        <span
                          style={{
                            color:
                              d.status === "connected"
                                ? "#22c55e"
                                : d.status === "connecting"
                                  ? "#f59e0b"
                                  : "#ef4444",
                          }}
                        >
                          ●
                        </span>
                        <span style={{ color: "#e2e8f0", fontWeight: "bold" }}>{d.port}</span>
                        <span style={{ color: "#64748b", textTransform: "capitalize" }}>
                          {d.status}
                        </span>
                        {d.firmwareVersion && (
                          <span style={{ color: "#475569" }}>fw {d.firmwareVersion}</span>
                        )}
                        {d.lastSeenAt && (
                          <span style={{ color: "#475569" }}>
                            {formatRelativeTime(d.lastSeenAt)}
                          </span>
                        )}
                        {d.batteryLevel != null && <BatteryBar level={d.batteryLevel} />}
                      </div>
                      <div style={{ display: "flex", gap: "0.3rem" }}>
                        {d.status === "connected" ? (
                          <button
                            style={deviceActionBtn("disconnect")}
                            onClick={() => apiDisconnect(d.id)}
                          >
                            Disconnect
                          </button>
                        ) : (
                          <button
                            style={deviceActionBtn("connect")}
                            onClick={() => apiConnect(d.port, d.name)}
                            disabled={d.status === "connecting"}
                          >
                            {d.status === "connecting" ? "Connecting…" : "Connect"}
                          </button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div style={styles.menuDivider} />

              {/* Navigation */}
              <div style={styles.menuSection}>
                <span style={styles.menuSectionLabel}>Navigate</span>
                <button style={menuNavBtn(tab === "activity")} onClick={() => navigate("activity")}>
                  Activity
                  {activity.length > 0 && <span style={styles.menuCount}>{activity.length}</span>}
                </button>
                <button style={menuNavBtn(tab === "logs")} onClick={() => navigate("logs")}>
                  Logs
                  {logs.length > 0 && <span style={styles.menuCount}>{logs.length}</span>}
                </button>
                <button
                  style={menuNavBtn(false)}
                  onClick={() => {
                    setApiDocsOpen(true);
                    setMenuOpen(false);
                  }}
                >
                  API Docs
                </button>
              </div>

              {/* Tab-specific filters */}
              {hasTabFilters && <div style={styles.menuDivider} />}

              {tab === "map" && (
                <div style={styles.menuSection}>
                  <span style={styles.menuSectionLabel}>Map filters</span>
                  <button style={hdrFilterBtn(showMesh)} onClick={() => setShowMesh((v) => !v)}>
                    <span
                      style={{
                        ...styles.dotBase,
                        border: "2px solid #94a3b8",
                        background: "#0f172a",
                      }}
                    />
                    Mesh
                    {mappableMeshCount > 0 && (
                      <span style={styles.hdrCount}>{mappableMeshCount}</span>
                    )}
                  </button>
                  <button style={hdrFilterBtn(showMqtt)} onClick={() => setShowMqtt((v) => !v)}>
                    <span
                      style={{
                        ...styles.dotBase,
                        border: "2px dashed #94a3b8",
                        background: "#0f172a",
                      }}
                    />
                    MQTT
                    {mappableMqttCount > 0 && (
                      <span style={styles.hdrCount}>{mappableMqttCount}</span>
                    )}
                  </button>
                </div>
              )}

              {tab === "activity" && (
                <div style={styles.menuSection}>
                  <span style={styles.menuSectionLabel}>Activity filters</span>
                  <span style={styles.filterLabel}>Window:</span>
                  {(["5m", "15m", "1h", "all"] as ActivityWindow[]).map((w) => (
                    <button
                      key={w}
                      style={hdrFilterBtn(activityWindow === w)}
                      onClick={() => setActivityWindow(w)}
                    >
                      {w}
                    </button>
                  ))}
                  <span style={{ ...styles.filterLabel, marginLeft: "0.4rem" }}>Source:</span>
                  {(["all", "mesh", "mqtt"] as ActivitySource[]).map((s) => (
                    <button
                      key={s}
                      style={{
                        ...hdrFilterBtn(activitySource === s),
                        color:
                          activitySource === s
                            ? "#fff"
                            : s === "mesh"
                              ? "#60a5fa"
                              : s === "mqtt"
                                ? "#34d399"
                                : undefined,
                      }}
                      onClick={() => setActivitySource(s)}
                    >
                      {s}
                    </button>
                  ))}
                  <button
                    style={{ ...hdrFilterBtn(activityPaused), marginLeft: "0.25rem" }}
                    onClick={() => setActivityPaused((p) => !p)}
                  >
                    {activityPaused ? "▶ Resume" : "⏸ Pause"}
                  </button>
                </div>
              )}

              {tab === "logs" && (
                <div style={styles.menuSection}>
                  <span style={styles.menuSectionLabel}>Log filters</span>
                  <span style={styles.filterLabel}>Level:</span>
                  {(["all", "log", "warn", "error"] as LogsLevel[]).map((l) => (
                    <button
                      key={l}
                      style={{
                        ...hdrFilterBtn(logsLevel === l),
                        color:
                          logsLevel === l
                            ? "#fff"
                            : l === "warn"
                              ? "#fbbf24"
                              : l === "error"
                                ? "#f87171"
                                : undefined,
                      }}
                      onClick={() => setLogsLevel(l)}
                    >
                      {l}
                    </button>
                  ))}
                  <span style={{ ...styles.filterLabel, marginLeft: "0.4rem" }}>Tag:</span>
                  <button style={hdrFilterBtn(logsTag === "all")} onClick={() => setLogsTag("all")}>
                    all
                  </button>
                  {KNOWN_TAGS.map((t) => (
                    <button
                      key={t}
                      style={{
                        ...hdrFilterBtn(logsTag === t),
                        color: logsTag === t ? "#fff" : TAG_COLORS[t],
                      }}
                      onClick={() => setLogsTag(t)}
                    >
                      {t}
                      {logTagCounts[t] ? (
                        <span style={styles.hdrCount}>{logTagCounts[t]}</span>
                      ) : null}
                    </button>
                  ))}
                  <button
                    style={{ ...hdrFilterBtn(logsPaused), marginLeft: "0.25rem" }}
                    onClick={() => setLogsPaused((p) => !p)}
                  >
                    {logsPaused ? "▶ Resume" : "⏸ Pause"}
                  </button>
                </div>
              )}

              <div style={styles.menuDivider} />

              {/* WS status */}
              <div style={{ ...styles.menuSection, justifyContent: "flex-end" }}>
                <span style={{ ...styles.badge, background: connected ? "#22c55e" : "#ef4444" }}>
                  {connected ? "API connected" : "API disconnected"}
                </span>
              </div>

              <div style={styles.menuDivider} />

              <div style={{ padding: "0.4rem 0.75rem", textAlign: "right" }}>
                <span style={{ color: "#1e293b", fontSize: "0.65rem", fontFamily: "monospace" }}>
                  v{__APP_VERSION__}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* ── Help button ───────────────────────────────────────────────────── */}
        <button
          onClick={() => setIntroOpen(true)}
          style={{
            background: "#0f172a",
            border: "1px solid #1e293b",
            color: "#475569",
            padding: "0.25rem 0.55rem",
            borderRadius: "0.375rem",
            cursor: "pointer",
            fontFamily: "monospace",
            fontSize: "0.78rem",
            flexShrink: 0,
          }}
          title="Open introduction guide"
        >
          ?
        </button>

        {/* ── Settings menu ─────────────────────────────────────────────────── */}
        <div ref={settingsRef} style={styles.menuContainer}>
          <button
            onClick={() => setSettingsOpen((v) => !v)}
            style={menuBtnStyle(settingsOpen, true)}
          >
            Settings
            <span style={{ color: "#475569", marginLeft: "0.3rem", fontSize: "0.65rem" }}>▾</span>
          </button>

          {settingsOpen && (
            <div style={styles.menuPanel}>
              <div style={styles.menuSection}>
                <span style={styles.menuSectionLabel}>Configure</span>
                <button
                  style={menuNavBtn(tab === "overrides")}
                  onClick={() => navigate("overrides")}
                >
                  Overrides
                  {overrides.size > 0 && <span style={styles.menuCount}>{overrides.size}</span>}
                </button>
                <button style={menuNavBtn(tab === "config")} onClick={() => navigate("config")}>
                  Device Config
                </button>
              </div>
            </div>
          )}
        </div>
      </header>

      {tab === "nodes" && (
        <div style={{ flex: 1, overflowY: "auto" }}>
          <NodesPage
            devices={devices}
            nodes={effectiveNodes}
            mqttNodes={scopedMqttNodes}
            onMessage={(nodeId) => {
              setMessageTarget(nodeId);
              setTab("messages");
            }}
            onCoverageMap={(nodeId) => {
              setFocusedCoverageNodeId(nodeId);
              setTab("map");
            }}
          />
        </div>
      )}
      {tab === "map" && (
        <MapPage
          nodes={effectiveNodes}
          mqttNodes={scopedMqttNodes}
          showMesh={showMesh}
          setShowMesh={setShowMesh}
          showMqtt={showMqtt}
          setShowMqtt={setShowMqtt}
          deviceId={devices.find((d) => d.status === "connected")?.id ?? null}
          deviceConfigs={deviceConfigs}
          focusedNodeId={focusedCoverageNodeId}
          onClearFocusedNode={() => setFocusedCoverageNodeId(null)}
          onMessage={(nodeId) => {
            setMessageTarget(nodeId);
            setTab("messages");
          }}
          presetFilter={presetFilter}
          setPresetFilter={setPresetFilter}
        />
      )}
      {tab === "messages" && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <MessagesPage
            devices={devices}
            nodes={effectiveNodes}
            mqttNodes={scopedMqttNodes}
            initialNodeId={messageTarget}
            onInitialNodeConsumed={() => setMessageTarget(null)}
          />
        </div>
      )}
      {tab === "activity" && (
        <div style={{ flex: 1, overflowY: "auto" }}>
          <ActivityPage
            entries={activity}
            window={activityWindow}
            sourceFilter={activitySource}
            paused={activityPaused}
            setPaused={setActivityPaused}
          />
        </div>
      )}
      {tab === "logs" && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <LogsPage
            entries={logs}
            levelFilter={logsLevel}
            tagFilter={logsTag}
            paused={logsPaused}
            setPaused={setLogsPaused}
          />
        </div>
      )}
      {tab === "overrides" && (
        <div style={{ flex: 1, overflowY: "auto" }}>
          <NodeOverridesPage
            overrides={[...overrides.values()]}
            noLocationNodes={noLocationNodes}
            onChanged={loadOverrides}
          />
        </div>
      )}
      {tab === "config" && (
        <div style={{ flex: 1, overflowY: "auto" }}>
          <DeviceConfigPage
            devices={devices}
            configs={deviceConfigs}
            autoOpenWizard={pendingWizard}
            onWizardOpened={() => setPendingWizard(false)}
          />
        </div>
      )}
      {tab === "analytics" && (
        <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
          <AnalyticsPage nodes={effectiveNodes} mqttNodes={effectiveMqttNodes} devices={devices} />
        </div>
      )}

      {/* ── Intro modal ───────────────────────────────────────────────────── */}
      {introOpen && (
        <IntroModal
          onClose={() => {
            localStorage.setItem("foreman_intro_seen", "1");
            setIntroOpen(false);
          }}
          onSetupWizard={() => {
            localStorage.setItem("foreman_intro_seen", "1");
            setIntroOpen(false);
            navigate("config");
            setPendingWizard(true);
          }}
        />
      )}

      {/* ── API Docs modal ─────────────────────────────────────────────────── */}
      {apiDocsOpen && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 200,
            background: "rgba(0,0,0,0.75)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => setApiDocsOpen(false)}
        >
          <div
            style={{
              background: "#0f172a",
              border: "1px solid #1e293b",
              borderRadius: "0.5rem",
              width: "90vw",
              maxWidth: "900px",
              height: "90vh",
              display: "flex",
              flexDirection: "column",
              boxShadow: "0 16px 48px rgba(0,0,0,0.8)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "0.6rem 1rem",
                borderBottom: "1px solid #1e293b",
                flexShrink: 0,
              }}
            >
              <span
                style={{
                  fontFamily: "monospace",
                  color: "#94a3b8",
                  fontSize: "0.75rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                API Reference
              </span>
              <button
                onClick={() => setApiDocsOpen(false)}
                style={{
                  background: "none",
                  border: "1px solid #1e293b",
                  color: "#64748b",
                  cursor: "pointer",
                  fontSize: "0.8rem",
                  borderRadius: "0.25rem",
                  padding: "0.15rem 0.5rem",
                  fontFamily: "monospace",
                }}
              >
                ✕ close
              </button>
            </div>
            <div style={{ flex: 1, overflowY: "auto", padding: "1.25rem 1.75rem" }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
                {apiPromisesRaw}
              </ReactMarkdown>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function sortMqttNodes(nodes: MqttNode[]): MqttNode[] {
  return [...nodes].sort((a, b) => {
    if (!a.lastHeard) return 1;
    if (!b.lastHeard) return -1;
    return new Date(b.lastHeard).getTime() - new Date(a.lastHeard).getTime();
  });
}

function sortNodes(nodes: NodeInfo[]): NodeInfo[] {
  return [...nodes].sort((a, b) => {
    if (!a.lastHeard) return 1;
    if (!b.lastHeard) return -1;
    return new Date(b.lastHeard).getTime() - new Date(a.lastHeard).getTime();
  });
}

// Markdown component overrides — dark-theme inline styles for react-markdown output
const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  h1: ({ children }) => (
    <h1
      style={{
        color: "#f8fafc",
        fontSize: "1.4rem",
        fontFamily: "monospace",
        borderBottom: "1px solid #1e293b",
        paddingBottom: "0.4rem",
        marginTop: "1.5rem",
      }}
    >
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2
      style={{
        color: "#e2e8f0",
        fontSize: "1.1rem",
        fontFamily: "monospace",
        borderBottom: "1px solid #1e293b",
        paddingBottom: "0.25rem",
        marginTop: "1.5rem",
      }}
    >
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3
      style={{
        color: "#cbd5e1",
        fontSize: "0.95rem",
        fontFamily: "monospace",
        marginTop: "1.25rem",
      }}
    >
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4
      style={{ color: "#94a3b8", fontSize: "0.875rem", fontFamily: "monospace", marginTop: "1rem" }}
    >
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p style={{ color: "#94a3b8", fontSize: "0.85rem", lineHeight: 1.65, margin: "0.5rem 0" }}>
      {children}
    </p>
  ),
  a: ({ href, children }) => (
    <a href={href} style={{ color: "#3b82f6" }} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  strong: ({ children }) => <strong style={{ color: "#e2e8f0" }}>{children}</strong>,
  code: ({ children, className }) => {
    const isBlock = className?.startsWith("language-");
    return isBlock ? (
      <code
        style={{
          display: "block",
          background: "#0d1420",
          border: "1px solid #1e293b",
          borderRadius: "0.375rem",
          padding: "0.75rem 1rem",
          fontSize: "0.78rem",
          color: "#94a3b8",
          overflowX: "auto",
          whiteSpace: "pre",
        }}
      >
        {children}
      </code>
    ) : (
      <code
        style={{
          background: "#1e293b",
          borderRadius: "0.2rem",
          padding: "0.1rem 0.35rem",
          fontSize: "0.8rem",
          color: "#7dd3fc",
        }}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre style={{ margin: "0.6rem 0" }}>{children}</pre>,
  blockquote: ({ children }) => (
    <blockquote
      style={{
        borderLeft: "3px solid #334155",
        paddingLeft: "1rem",
        margin: "0.5rem 0",
        color: "#64748b",
        fontSize: "0.85rem",
      }}
    >
      {children}
    </blockquote>
  ),
  hr: () => <hr style={{ border: "none", borderTop: "1px solid #1e293b", margin: "1.25rem 0" }} />,
  ul: ({ children }) => (
    <ul
      style={{ paddingLeft: "1.25rem", margin: "0.4rem 0", color: "#94a3b8", fontSize: "0.85rem" }}
    >
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol
      style={{ paddingLeft: "1.25rem", margin: "0.4rem 0", color: "#94a3b8", fontSize: "0.85rem" }}
    >
      {children}
    </ol>
  ),
  li: ({ children }) => <li style={{ margin: "0.15rem 0" }}>{children}</li>,
  table: ({ children }) => (
    <div style={{ overflowX: "auto", margin: "0.75rem 0" }}>
      <table
        style={{
          borderCollapse: "collapse",
          width: "100%",
          fontSize: "0.8rem",
          fontFamily: "monospace",
        }}
      >
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead style={{ background: "#0d1420" }}>{children}</thead>,
  th: ({ children }) => (
    <th
      style={{
        color: "#64748b",
        textAlign: "left",
        padding: "0.35rem 0.75rem",
        borderBottom: "1px solid #1e293b",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td
      style={{
        color: "#94a3b8",
        padding: "0.3rem 0.75rem",
        borderBottom: "1px solid #0f172a",
        verticalAlign: "top",
      }}
    >
      {children}
    </td>
  ),
  tr: ({ children }) => <tr style={{ borderBottom: "1px solid #1e293b" }}>{children}</tr>,
};

function tabStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? "#3b82f6" : "transparent",
    color: active ? "#fff" : "#94a3b8",
    border: "none",
    padding: "0.35rem 1rem",
    borderRadius: "0.375rem",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: "0.875rem",
  };
}

function menuBtnStyle(open: boolean, connected: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    background: open ? "#1e293b" : "#0f172a",
    border: `1px solid ${connected ? (open ? "#3b82f6" : "#1e293b") : "#ef4444"}`,
    color: "#e2e8f0",
    padding: "0.25rem 0.65rem",
    borderRadius: "0.375rem",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: "0.8rem",
    whiteSpace: "nowrap",
  };
}

function menuNavBtn(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    background: active ? "#1e3a5f" : "#0f172a",
    border: `1px solid ${active ? "#3b82f6" : "#1e293b"}`,
    color: active ? "#e2e8f0" : "#94a3b8",
    padding: "0.2rem 0.6rem",
    borderRadius: "0.25rem",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: "0.8rem",
  };
}

function deviceActionBtn(action: "connect" | "disconnect"): React.CSSProperties {
  return {
    background: action === "connect" ? "#14532d" : "#450a0a",
    border: `1px solid ${action === "connect" ? "#16a34a" : "#991b1b"}`,
    color: action === "connect" ? "#4ade80" : "#f87171",
    padding: "0.15rem 0.6rem",
    borderRadius: "0.25rem",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: "0.72rem",
  };
}

function hdrFilterBtn(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.3rem",
    background: active ? "#1e3a5f" : "#0f172a",
    border: `1px solid ${active ? "#3b82f6" : "#1e293b"}`,
    color: active ? "#e2e8f0" : "#64748b",
    padding: "0.15rem 0.5rem",
    borderRadius: "0.25rem",
    cursor: "pointer",
    fontSize: "0.72rem",
    fontFamily: "monospace",
  };
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    fontFamily: "monospace",
    background: "#0f172a",
    color: "#e2e8f0",
    height: "100%",
    display: "flex",
    flexDirection: "column",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.65rem 1.25rem",
    borderBottom: "1px solid #1e293b",
    flexShrink: 0,
  },
  logo: {
    height: "2rem",
    width: "auto",
    flexShrink: 0,
  },
  title: {
    margin: 0,
    fontSize: "1.25rem",
    color: "#f8fafc",
    whiteSpace: "nowrap",
  },
  nav: {
    display: "flex",
    gap: "0.25rem",
  },
  menuContainer: {
    position: "relative",
    flexShrink: 0,
  },
  menuPanel: {
    position: "absolute",
    top: "calc(100% + 0.4rem)",
    right: 0,
    minWidth: "280px",
    background: "#0f172a",
    border: "1px solid #1e293b",
    borderRadius: "0.5rem",
    boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
    zIndex: 100,
    overflow: "hidden",
  },
  menuSection: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: "0.3rem",
    padding: "0.6rem 0.75rem",
  },
  menuSectionLabel: {
    width: "100%",
    color: "#334155",
    fontSize: "0.65rem",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    marginBottom: "0.15rem",
  },
  menuDevice: {
    width: "100%",
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    fontSize: "0.8rem",
    padding: "0.1rem 0",
  },
  menuDivider: {
    height: "1px",
    background: "#1e293b",
  },
  menuCount: {
    background: "#334155",
    borderRadius: "9999px",
    padding: "0 0.35rem",
    fontSize: "0.65rem",
  },
  filterLabel: {
    color: "#475569",
    fontSize: "0.7rem",
    whiteSpace: "nowrap",
  },
  dotBase: {
    width: "0.6rem",
    height: "0.6rem",
    borderRadius: "50%",
    display: "inline-block",
    flexShrink: 0,
  },
  hdrCount: {
    background: "#334155",
    borderRadius: "9999px",
    padding: "0 0.3rem",
    fontSize: "0.6rem",
    marginLeft: "0.1rem",
  },
  badge: {
    padding: "0.15rem 0.5rem",
    borderRadius: "9999px",
    fontSize: "0.75rem",
    color: "#fff",
    fontWeight: "bold",
  },
  tabCount: {
    background: "#334155",
    borderRadius: "9999px",
    padding: "0 0.35rem",
    fontSize: "0.7rem",
    marginLeft: "0.3rem",
  },
};
