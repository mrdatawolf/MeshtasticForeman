import { useRef, useState } from "react";

import { useClickOutside } from "../../hooks/useClickOutside.js";
import { formatRelativeTime } from "../../lib/relativeTime.js";

import deviceStyles from "./DeviceMenu.module.css";
import {
  badgeClass,
  deviceActionClass,
  hdrFilterActiveWhiteClass,
  hdrFilterClass,
  KNOWN_TAGS,
  menuBtnClass,
  menuNavClass,
  styles,
  TAG_COLOR_CLASS,
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

function batteryClass(level: number) {
  return level <= 20
    ? deviceStyles.batteryLow
    : level <= 50
      ? deviceStyles.batteryMid
      : deviceStyles.batteryHigh;
}
function BatteryBar({ level }: { level: number }) {
  const levelClass = batteryClass(level);
  return (
    <span className={deviceStyles.batteryWrap}>
      <span className={`${deviceStyles.batteryPercent} ${levelClass}`}>{level}%</span>
      <span className={`${deviceStyles.batteryBarOuter} ${levelClass}`}>
        <span
          className={`${deviceStyles.batteryBarFill} ${levelClass}`}
          style={{ "--battery-width": `${level}%` } as React.CSSProperties}
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

function statusClass(status: DeviceInfo["status"]) {
  return status === "connected"
    ? deviceStyles.statusConnected
    : status === "connecting"
      ? deviceStyles.statusConnecting
      : deviceStyles.statusDisconnected;
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
    <div ref={ref} className={styles.menuContainer}>
      <button
        onClick={() => setOpen((value) => !value)}
        className={menuBtnClass(open, props.connected)}
      >
        <span className={props.connected ? deviceStyles.apiDotOn : deviceStyles.apiDotOff}>●</span>
        API<span className={styles.caret}>▾</span>
      </button>
      {open && (
        <div className={styles.menuPanel}>
          <div className={styles.menuSection}>
            <span className={styles.menuSectionLabel}>Devices</span>
            {props.devices.length === 0 ? (
              <span className={styles.muted72}>No devices — POST /api/devices/connect</span>
            ) : (
              props.devices.map((device) => (
                <div key={device.id} className={deviceStyles.deviceEntry}>
                  <div className={deviceStyles.deviceRow}>
                    <span className={statusClass(device.status)}>●</span>
                    <span className={deviceStyles.deviceId}>{device.port}</span>
                    <span className={deviceStyles.deviceStatusLabel}>{device.status}</span>
                    {device.firmwareVersion && (
                      <span className={deviceStyles.deviceMeta}>fw {device.firmwareVersion}</span>
                    )}
                    {device.lastSeenAt && (
                      <span className={deviceStyles.deviceMeta}>
                        {formatRelativeTime(device.lastSeenAt)}
                      </span>
                    )}
                    {device.batteryLevel != null && <BatteryBar level={device.batteryLevel} />}
                  </div>
                  <div className={deviceStyles.deviceActions}>
                    {device.status === "connected" ? (
                      <button
                        className={deviceActionClass("disconnect")}
                        onClick={() => apiDisconnect(device.id)}
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        className={deviceActionClass("connect")}
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
          <div className={styles.menuDivider} />
          <div className={styles.menuSection}>
            <span className={styles.menuSectionLabel}>Navigate</span>
            <button
              className={menuNavClass(props.tab === "activity")}
              onClick={() => navigate("activity")}
            >
              Activity
              {props.activity.length > 0 && (
                <span className={styles.menuCount}>{props.activity.length}</span>
              )}
            </button>
            <button className={menuNavClass(props.tab === "logs")} onClick={() => navigate("logs")}>
              Logs
              {props.logs.length > 0 && (
                <span className={styles.menuCount}>{props.logs.length}</span>
              )}
            </button>
            <button
              className={menuNavClass(false)}
              onClick={() => {
                props.onOpenApiDocs();
                setOpen(false);
              }}
            >
              API Docs
            </button>
          </div>
          {hasTabFilters && <div className={styles.menuDivider} />}
          {props.tab === "map" && (
            <div className={styles.menuSection}>
              <span className={styles.menuSectionLabel}>Map filters</span>
              <button
                className={hdrFilterClass(props.showMesh)}
                onClick={() => props.setShowMesh((value) => !value)}
              >
                <span className={`${styles.dotBase} ${deviceStyles.dotMesh}`} />
                Mesh
                {props.mappableMeshCount > 0 && (
                  <span className={styles.hdrCount}>{props.mappableMeshCount}</span>
                )}
              </button>
              <button
                className={hdrFilterClass(props.showMqtt)}
                onClick={() => props.setShowMqtt((value) => !value)}
              >
                <span className={`${styles.dotBase} ${deviceStyles.dotMqtt}`} />
                MQTT
                {props.mappableMqttCount > 0 && (
                  <span className={styles.hdrCount}>{props.mappableMqttCount}</span>
                )}
              </button>
            </div>
          )}
          {props.tab === "activity" && (
            <div className={styles.menuSection}>
              <span className={styles.menuSectionLabel}>Activity filters</span>
              <span className={styles.filterLabel}>Window:</span>
              {(["5m", "15m", "1h", "all"] as ActivityWindow[]).map((window) => (
                <button
                  key={window}
                  className={hdrFilterClass(props.activityWindow === window)}
                  onClick={() => props.setActivityWindow(window)}
                >
                  {window}
                </button>
              ))}
              <span className={`${styles.filterLabel} ${styles.mlMed}`}>Source:</span>
              {(["all", "mesh", "mqtt"] as ActivitySource[]).map((source) => (
                <button
                  key={source}
                  className={hdrFilterActiveWhiteClass(
                    props.activitySource === source,
                    source === "mesh"
                      ? styles.colorMesh
                      : source === "mqtt"
                        ? styles.colorMqtt
                        : undefined,
                  )}
                  onClick={() => props.setActivitySource(source)}
                >
                  {source}
                </button>
              ))}
              <button
                className={`${hdrFilterClass(props.activityPaused)} ${styles.mlSmall}`}
                onClick={() => props.setActivityPaused((value) => !value)}
              >
                {props.activityPaused ? "▶ Resume" : "⏸ Pause"}
              </button>
            </div>
          )}
          {props.tab === "logs" && (
            <div className={styles.menuSection}>
              <span className={styles.menuSectionLabel}>Log filters</span>
              <span className={styles.filterLabel}>Level:</span>
              {(["all", "log", "warn", "error"] as LogsLevel[]).map((level) => (
                <button
                  key={level}
                  className={hdrFilterActiveWhiteClass(
                    props.logsLevel === level,
                    level === "warn"
                      ? styles.colorWarn
                      : level === "error"
                        ? styles.colorError
                        : undefined,
                  )}
                  onClick={() => props.setLogsLevel(level)}
                >
                  {level}
                </button>
              ))}
              <span className={`${styles.filterLabel} ${styles.mlMed}`}>Tag:</span>
              <button
                className={hdrFilterClass(props.logsTag === "all")}
                onClick={() => props.setLogsTag("all")}
              >
                all
              </button>
              {KNOWN_TAGS.map((tag) => (
                <button
                  key={tag}
                  className={hdrFilterActiveWhiteClass(props.logsTag === tag, TAG_COLOR_CLASS[tag])}
                  onClick={() => props.setLogsTag(tag)}
                >
                  {tag}
                  {props.logTagCounts[tag] ? (
                    <span className={styles.hdrCount}>{props.logTagCounts[tag]}</span>
                  ) : null}
                </button>
              ))}
              <button
                className={`${hdrFilterClass(props.logsPaused)} ${styles.mlSmall}`}
                onClick={() => props.setLogsPaused((value) => !value)}
              >
                {props.logsPaused ? "▶ Resume" : "⏸ Pause"}
              </button>
            </div>
          )}
          <div className={styles.menuDivider} />
          <div className={`${styles.menuSection} ${styles.justifyEnd}`}>
            <span className={badgeClass(props.connected)}>
              {props.connected ? "API connected" : "API disconnected"}
            </span>
          </div>
          <div className={styles.menuDivider} />
          <div className={deviceStyles.versionRow}>
            <span className={deviceStyles.versionText}>v{__APP_VERSION__}</span>
          </div>
        </div>
      )}
    </div>
  );
}
