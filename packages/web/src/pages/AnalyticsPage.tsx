import { useState } from "react";

import { styles } from "./analytics/components.js";
import { ActivityTimelineTab, MessagesTab } from "./analytics/messages.js";
import { NetworkTab } from "./analytics/network.js";
import { PacketsTab } from "./analytics/packets.js";
import { PositionsTab } from "./analytics/positions.js";
import { LinkQualityTab, SignalTab } from "./analytics/signal.js";
import { TelemetryTab } from "./analytics/telemetry.js";

import type { DeviceInfo, MqttNode, NodeInfo } from "@foreman/shared";

type AnalyticsTab =
  | "signal"
  | "messages"
  | "network"
  | "telemetry"
  | "packets"
  | "linkquality"
  | "timeline"
  | "positions";
interface Props {
  nodes: NodeInfo[];
  mqttNodes: MqttNode[];
  devices: DeviceInfo[];
}
export function AnalyticsPage({ nodes, mqttNodes, devices }: Props) {
  const [tab, setTab] = useState<AnalyticsTab>("messages");
  return (
    <div style={styles.page}>
      <div style={styles.subNav}>
        {(
          [
            "messages",
            "signal",
            "network",
            "telemetry",
            "packets",
            "linkquality",
            "timeline",
            "positions",
          ] as AnalyticsTab[]
        ).map((t) => (
          <button key={t} style={subTabStyle(tab === t)} onClick={() => setTab(t)}>
            {t === "linkquality"
              ? "Link Quality"
              : t === "timeline"
                ? "Timeline"
                : t === "positions"
                  ? "Positions"
                  : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === "signal" && <SignalTab nodes={nodes} mqttNodes={mqttNodes} />}
      {tab === "messages" && <MessagesTab nodes={nodes} mqttNodes={mqttNodes} />}
      {tab === "network" && <NetworkTab nodes={nodes} mqttNodes={mqttNodes} />}
      {tab === "telemetry" && <TelemetryTab nodes={nodes} mqttNodes={mqttNodes} />}
      {tab === "packets" && <PacketsTab />}
      {tab === "linkquality" && <LinkQualityTab nodes={nodes} mqttNodes={mqttNodes} />}
      {tab === "timeline" && (
        <ActivityTimelineTab nodes={nodes} mqttNodes={mqttNodes} devices={devices} />
      )}
      {tab === "positions" && <PositionsTab nodes={nodes} mqttNodes={mqttNodes} />}
    </div>
  );
}
function subTabStyle(active: boolean): React.CSSProperties {
  return {
    background: "transparent",
    color: active ? "#e2e8f0" : "#64748b",
    border: "none",
    borderBottom: active ? "2px solid #3b82f6" : "2px solid transparent",
    padding: "0.3rem 0.9rem",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: "0.8rem",
    marginBottom: "-1px",
  };
}
