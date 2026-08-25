import { useRef, useState } from "react";

import { useClickOutside } from "../../hooks/useClickOutside.js";
import { formatRelativeTime } from "../../lib/relativeTime.js";

import {
  deviceActionBtn,
  hdrFilterBtn,
  KNOWN_TAGS,
  menuBtnStyle,
  menuNavBtn,
  styles,
  TAG_COLORS,
} from "./shellStyles.js";

import type { ActivitySource, ActivityWindow, LogsLevel, Tab, TagFilter } from "./types.js";
import type { ActivityEntry, DeviceInfo, LogEntry } from "@foreman/shared";

interface Props {
  connected: boolean;
  devices: DeviceInfo[];
  activity: ActivityEntry[];
  logs: LogEntry[];
  tab: Tab;
  showMesh: boolean;
  setShowMesh: React.Dispatch<React.SetStateAction<boolean>>;
  showMqtt: boolean;
  setShowMqtt: React.Dispatch<React.SetStateAction<boolean>>;
  mappableMeshCount: number;
  mappableMqttCount: number;
  activityWindow: ActivityWindow;
  setActivityWindow: (value: ActivityWindow) => void;
  activitySource: ActivitySource;
  setActivitySource: (value: ActivitySource) => void;
  activityPaused: boolean;
  setActivityPaused: React.Dispatch<React.SetStateAction<boolean>>;
  logsLevel: LogsLevel;
  setLogsLevel: (value: LogsLevel) => void;
  logsTag: TagFilter;
  setLogsTag: (value: TagFilter) => void;
  logsPaused: boolean;
  setLogsPaused: React.Dispatch<React.SetStateAction<boolean>>;
  logTagCounts: Record<string, number>;
  onNavigate: (tab: Tab) => void;
  onOpenApiDocs: () => void;
}

function batteryColor(level: number) {
  return level <= 20 ? "#ef4444" : level <= 50 ? "#f59e0b" : "#22c55e";
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

export function DeviceMenu(props: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickOutside(ref, () => setOpen(false), open);
  const navigate = (tab: Tab) => {
    props.onNavigate(tab);
    setOpen(false);
  };
  const hasTabFilters = props.tab === "map" || props.tab === "activity" || props.tab === "logs";
  return (
    <div ref={ref} style={styles.menuContainer}>
      <button
        onClick={() => setOpen((value) => !value)}
        style={menuBtnStyle(open, props.connected)}
      >
        <span style={{ color: props.connected ? "#22c55e" : "#ef4444", fontSize: "0.65rem" }}>
          ●
        </span>
        API<span style={{ color: "#475569", marginLeft: "0.3rem", fontSize: "0.65rem" }}>▾</span>
      </button>
      {open && (
        <div style={styles.menuPanel}>
          <div style={styles.menuSection}>
            <span style={styles.menuSectionLabel}>Devices</span>
            {props.devices.length === 0 ? (
              <span style={{ color: "#475569", fontSize: "0.72rem" }}>
                No devices — POST /api/devices/connect
              </span>
            ) : (
              props.devices.map((device) => (
                <div
                  key={device.id}
                  style={{
                    ...styles.menuDevice,
                    flexDirection: "column",
                    alignItems: "flex-start",
                    gap: "0.25rem",
                  }}
                >
                  <div
                    style={{ display: "flex", alignItems: "center", gap: "0.4rem", width: "100%" }}
                  >
                    <span
                      style={{
                        color:
                          device.status === "connected"
                            ? "#22c55e"
                            : device.status === "connecting"
                              ? "#f59e0b"
                              : "#ef4444",
                      }}
                    >
                      ●
                    </span>
                    <span style={{ color: "#e2e8f0", fontWeight: "bold" }}>{device.port}</span>
                    <span style={{ color: "#64748b", textTransform: "capitalize" }}>
                      {device.status}
                    </span>
                    {device.firmwareVersion && (
                      <span style={{ color: "#475569" }}>fw {device.firmwareVersion}</span>
                    )}
                    {device.lastSeenAt && (
                      <span style={{ color: "#475569" }}>
                        {formatRelativeTime(device.lastSeenAt)}
                      </span>
                    )}
                    {device.batteryLevel != null && <BatteryBar level={device.batteryLevel} />}
                  </div>
                  <div style={{ display: "flex", gap: "0.3rem" }}>
                    {device.status === "connected" ? (
                      <button
                        style={deviceActionBtn("disconnect")}
                        onClick={() => apiDisconnect(device.id)}
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        style={deviceActionBtn("connect")}
                        onClick={() => apiConnect(device.port, device.name)}
                        disabled={device.status === "connecting"}
                      >
                        {device.status === "connecting" ? "Connecting…" : "Connect"}
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
          <div style={styles.menuDivider} />
          <div style={styles.menuSection}>
            <span style={styles.menuSectionLabel}>Navigate</span>
            <button
              style={menuNavBtn(props.tab === "activity")}
              onClick={() => navigate("activity")}
            >
              Activity
              {props.activity.length > 0 && (
                <span style={styles.menuCount}>{props.activity.length}</span>
              )}
            </button>
            <button style={menuNavBtn(props.tab === "logs")} onClick={() => navigate("logs")}>
              Logs
              {props.logs.length > 0 && <span style={styles.menuCount}>{props.logs.length}</span>}
            </button>
            <button
              style={menuNavBtn(false)}
              onClick={() => {
                props.onOpenApiDocs();
                setOpen(false);
              }}
            >
              API Docs
            </button>
          </div>
          {hasTabFilters && <div style={styles.menuDivider} />}
          {props.tab === "map" && (
            <div style={styles.menuSection}>
              <span style={styles.menuSectionLabel}>Map filters</span>
              <button
                style={hdrFilterBtn(props.showMesh)}
                onClick={() => props.setShowMesh((value) => !value)}
              >
                <span
                  style={{ ...styles.dotBase, border: "2px solid #94a3b8", background: "#0f172a" }}
                />
                Mesh
                {props.mappableMeshCount > 0 && (
                  <span style={styles.hdrCount}>{props.mappableMeshCount}</span>
                )}
              </button>
              <button
                style={hdrFilterBtn(props.showMqtt)}
                onClick={() => props.setShowMqtt((value) => !value)}
              >
                <span
                  style={{ ...styles.dotBase, border: "2px dashed #94a3b8", background: "#0f172a" }}
                />
                MQTT
                {props.mappableMqttCount > 0 && (
                  <span style={styles.hdrCount}>{props.mappableMqttCount}</span>
                )}
              </button>
            </div>
          )}
          {props.tab === "activity" && (
            <div style={styles.menuSection}>
              <span style={styles.menuSectionLabel}>Activity filters</span>
              <span style={styles.filterLabel}>Window:</span>
              {(["5m", "15m", "1h", "all"] as ActivityWindow[]).map((window) => (
                <button
                  key={window}
                  style={hdrFilterBtn(props.activityWindow === window)}
                  onClick={() => props.setActivityWindow(window)}
                >
                  {window}
                </button>
              ))}
              <span style={{ ...styles.filterLabel, marginLeft: "0.4rem" }}>Source:</span>
              {(["all", "mesh", "mqtt"] as ActivitySource[]).map((source) => (
                <button
                  key={source}
                  style={{
                    ...hdrFilterBtn(props.activitySource === source),
                    color:
                      props.activitySource === source
                        ? "#fff"
                        : source === "mesh"
                          ? "#60a5fa"
                          : source === "mqtt"
                            ? "#34d399"
                            : undefined,
                  }}
                  onClick={() => props.setActivitySource(source)}
                >
                  {source}
                </button>
              ))}
              <button
                style={{ ...hdrFilterBtn(props.activityPaused), marginLeft: "0.25rem" }}
                onClick={() => props.setActivityPaused((value) => !value)}
              >
                {props.activityPaused ? "▶ Resume" : "⏸ Pause"}
              </button>
            </div>
          )}
          {props.tab === "logs" && (
            <div style={styles.menuSection}>
              <span style={styles.menuSectionLabel}>Log filters</span>
              <span style={styles.filterLabel}>Level:</span>
              {(["all", "log", "warn", "error"] as LogsLevel[]).map((level) => (
                <button
                  key={level}
                  style={{
                    ...hdrFilterBtn(props.logsLevel === level),
                    color:
                      props.logsLevel === level
                        ? "#fff"
                        : level === "warn"
                          ? "#fbbf24"
                          : level === "error"
                            ? "#f87171"
                            : undefined,
                  }}
                  onClick={() => props.setLogsLevel(level)}
                >
                  {level}
                </button>
              ))}
              <span style={{ ...styles.filterLabel, marginLeft: "0.4rem" }}>Tag:</span>
              <button
                style={hdrFilterBtn(props.logsTag === "all")}
                onClick={() => props.setLogsTag("all")}
              >
                all
              </button>
              {KNOWN_TAGS.map((tag) => (
                <button
                  key={tag}
                  style={{
                    ...hdrFilterBtn(props.logsTag === tag),
                    color: props.logsTag === tag ? "#fff" : TAG_COLORS[tag],
                  }}
                  onClick={() => props.setLogsTag(tag)}
                >
                  {tag}
                  {props.logTagCounts[tag] ? (
                    <span style={styles.hdrCount}>{props.logTagCounts[tag]}</span>
                  ) : null}
                </button>
              ))}
              <button
                style={{ ...hdrFilterBtn(props.logsPaused), marginLeft: "0.25rem" }}
                onClick={() => props.setLogsPaused((value) => !value)}
              >
                {props.logsPaused ? "▶ Resume" : "⏸ Pause"}
              </button>
            </div>
          )}
          <div style={styles.menuDivider} />
          <div style={{ ...styles.menuSection, justifyContent: "flex-end" }}>
            <span style={{ ...styles.badge, background: props.connected ? "#22c55e" : "#ef4444" }}>
              {props.connected ? "API connected" : "API disconnected"}
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
  );
}
