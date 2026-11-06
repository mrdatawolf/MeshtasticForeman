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
  /** Unfiltered, so names resolve in data for nodes the last-seen filter hides. */
  nodes: NodeInfo[];
  mqttNodes: MqttNode[];
  hiddenNodeIds: ReadonlySet<number>;
  devices: DeviceInfo[];
}

function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export function AnalyticsPage({ nodes, mqttNodes, hiddenNodeIds, devices }: Props) {
  const tabProps = { nodes, mqttNodes, hiddenNodeIds };
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
      {tab === "signal" && <SignalTab {...tabProps} />}
      {tab === "messages" && <MessagesTab {...tabProps} />}
      {tab === "network" && <NetworkTab {...tabProps} />}
      {tab === "telemetry" && <TelemetryTab {...tabProps} />}
      {tab === "packets" && <PacketsTab />}
      {tab === "linkquality" && <LinkQualityTab {...tabProps} />}
      {tab === "timeline" && <ActivityTimelineTab {...tabProps} devices={devices} />}
      {tab === "positions" && <PositionsTab {...tabProps} />}
    </div>
  );
}
