import { formatNodeId as nodeHex, resolveNodeName } from "@foreman/shared";

import { formatRelativeTime } from "../../lib/relativeTime.js";

import { popupActionBtnClass, styles } from "./popupStyles.js";

import type { NodeInfo, MqttNode } from "@foreman/shared";

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
    <div className={styles.popup}>
      <div className={styles.name}>
        {resolveNodeName(node.nodeId, node, { preference: ["longName"] })}
      </div>
      {node.shortName && node.longName && <div className={styles.muted}>{node.shortName}</div>}
      <div className={styles.grid}>
        <span className={styles.label}>ID</span>
        <span className={styles.mono}>{nodeHex(node.nodeId)}</span>

        <span className={styles.label}>Last heard</span>
        <span>{formatLastHeard(node.lastHeard)}</span>

        <span className={styles.label}>Hops</span>
        <span>
          {node.hopsAway === null ? "—" : node.hopsAway === 0 ? "Direct" : `${node.hopsAway} away`}
        </span>

        {node.snr != null && (
          <>
            <span className={styles.label}>SNR</span>
            <span>{node.snr.toFixed(1)} dB</span>
          </>
        )}

        {node.hwModel != null && (
          <>
            <span className={styles.label}>Model</span>
            <span>{HW_MODEL[node.hwModel] ?? `#${node.hwModel}`}</span>
          </>
        )}

        <span className={styles.label}>GPS</span>
        <span className={styles.mono}>
          {node.latitude!.toFixed(5)}, {node.longitude!.toFixed(5)}
          {node.altitude != null && ` (${node.altitude}m)`}
        </span>
      </div>

      <div className={styles.actions}>
        {onFocusCoverage && (
          <button className={popupActionBtnClass(false, "green")} onClick={onFocusCoverage}>
            🗺 Coverage Map
          </button>
        )}
        {deviceId && (
          <>
            <button
              className={popupActionBtnClass(pending === "ping")}
              disabled={!!pending}
              onClick={onRequestPosition}
            >
              {pending === "ping" ? "Requesting…" : "📍 Request Position"}
            </button>
            <button
              className={popupActionBtnClass(pending === "traceroute")}
              disabled={!!pending}
              onClick={onTraceroute}
            >
              {pending === "traceroute" ? "Tracing…" : "🔍 Traceroute"}
            </button>
            {onMessage && (
              <button className={popupActionBtnClass(false)} onClick={onMessage}>
                ✉ Messages Tab
              </button>
            )}
          </>
        )}
        {onRefreshTerrain && (
          <button
            className={popupActionBtnClass(terrainRefreshing === true)}
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
    <div className={styles.popup}>
      <div className={styles.name}>
        {resolveNodeName(node.nodeId, node, { preference: ["longName"] })}
      </div>
      {node.shortName && node.longName && <div className={styles.muted}>{node.shortName}</div>}
      <div className={styles.tag}>MQTT</div>
      <div className={styles.grid}>
        <span className={styles.label}>ID</span>
        <span className={styles.mono}>{nodeHex(node.nodeId)}</span>

        <span className={styles.label}>Last heard</span>
        <span>{formatLastHeard(node.lastHeard)}</span>

        <span className={styles.label}>Gateway</span>
        <span className={styles.mono}>{node.lastGateway ?? "—"}</span>

        {node.snr != null && (
          <>
            <span className={styles.label}>SNR</span>
            <span>{node.snr.toFixed(1)} dB</span>
          </>
        )}

        {node.hwModel != null && (
          <>
            <span className={styles.label}>Model</span>
            <span>{HW_MODEL[node.hwModel] ?? `#${node.hwModel}`}</span>
          </>
        )}

        <span className={styles.label}>GPS</span>
        <span className={styles.mono}>
          {node.latitude!.toFixed(5)}, {node.longitude!.toFixed(5)}
          {node.altitude != null && ` (${node.altitude}m)`}
        </span>
      </div>
      {(onFocusCoverage || onRefreshTerrain) && (
        <div className={styles.actions}>
          {onFocusCoverage && (
            <button className={popupActionBtnClass(false, "green")} onClick={onFocusCoverage}>
              🗺 Coverage Map
            </button>
          )}
          {onRefreshTerrain && (
            <button
              className={popupActionBtnClass(terrainRefreshing === true)}
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
