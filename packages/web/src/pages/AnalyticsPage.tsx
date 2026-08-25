import { useState } from "react";

import { styles } from "./analytics/analyticsStyles.js";
import { ActivityTimelineTab, MessagesTab } from "./analytics/messages.js";
import { NetworkTab } from "./analytics/network.js";
import { PacketsTab } from "./analytics/packets.js";
import { PositionsTab } from "./analytics/positions.js";
import { LinkQualityTab, SignalTab } from "./analytics/signal.js";
import { TelemetryTab } from "./analytics/telemetry.js";
import pageStyles from "./AnalyticsPage.module.css";

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

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function AnalyticsPage({ nodes, mqttNodes, devices }: Props) {
  const [tab, setTab] = useState<AnalyticsTab>("messages");
  return (
    <div className={styles.page}>
      <div className={styles.subNav}>
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
          <button
            key={t}
            className={cx(pageStyles.tab, tab === t && pageStyles.tabActive)}
            onClick={() => setTab(t)}
          >
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
