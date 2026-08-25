import { formatNodeId as nodeHex, resolveNodeName } from "@foreman/shared";

import { formatRelativeTime } from "../../lib/relativeTime.js";

import type { NodeInfo, MqttNode } from "@foreman/shared";
import type React from "react";

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

export function MeshPopup({
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

export function MqttPopup({
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
