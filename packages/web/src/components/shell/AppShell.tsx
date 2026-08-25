import { useCallback, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import apiPromisesRaw from "../../../../../API_PROMISES.md?raw";
import logo from "../../assets/logo.png";
import { applyNodeOverrides } from "../../lib/nodeOverrides.js";
import { ActivityPage } from "../../pages/ActivityPage.js";
import { AnalyticsPage } from "../../pages/AnalyticsPage.js";
import { DeviceConfigPage } from "../../pages/DeviceConfigPage.js";
import { IntroModal } from "../../pages/IntroModal.js";
import { LogsPage } from "../../pages/LogsPage.js";
import { MapPage } from "../../pages/MapPage.js";
import { MessagesPage } from "../../pages/MessagesPage.js";
import { NodeOverridesPage } from "../../pages/NodeOverridesPage.js";
import { NodesPage } from "../../pages/NodesPage.js";
import { foremanClient } from "../../ws/client.js";

import { DeviceMenu } from "./DeviceMenu.js";
import { GpsMenu } from "./GpsMenu.js";
import { MainNavigation } from "./MainNavigation.js";
import { MqttMenu } from "./MqttMenu.js";
import { SettingsMenu } from "./SettingsMenu.js";
import { styles } from "./shellStyles.js";

import type {
  ActivitySource,
  ActivityWindow,
  LogsLevel,
  MqttScope,
  Tab,
  TagFilter,
} from "./types.js";
import type { AppState } from "../../appState.js";
import type { NodeOverride } from "@foreman/shared";

interface Props {
  appState: AppState;
  overrides: Map<number, NodeOverride>;
  connected: boolean;
  gpsPending: Set<string>;
  setGpsPending: React.Dispatch<React.SetStateAction<Set<string>>>;
  loadOverrides: () => Promise<void>;
}

export function AppShell({
  appState,
  overrides,
  connected,
  gpsPending,
  setGpsPending,
  loadOverrides,
}: Props) {
  const { devices, nodes, mqttNodes, activity, logs, mqttEnabled, deviceConfigs } = appState;
  const [tab, setTab] = useState<Tab>("nodes");
  const [introOpen, setIntroOpen] = useState(() => !localStorage.getItem("foreman_intro_seen"));
  const [pendingWizard, setPendingWizard] = useState(false);
  const [mqttScope, setMqttScope] = useState<MqttScope>("county");
  const [apiDocsOpen, setApiDocsOpen] = useState(false);
  const [messageTarget, setMessageTarget] = useState<number | null>(null);
  const [focusedCoverageNodeId, setFocusedCoverageNodeId] = useState<number | null>(null);
  const [showMesh, setShowMesh] = useState(true);
  const [showMqtt, setShowMqtt] = useState(true);
  const [presetFilter, setPresetFilter] = useState<number | null>(null);
  const [activityWindow, setActivityWindow] = useState<ActivityWindow>("15m");
  const [activitySource, setActivitySource] = useState<ActivitySource>("all");
  const [activityPaused, setActivityPaused] = useState(false);
  const [logsLevel, setLogsLevel] = useState<LogsLevel>("all");
  const [logsTag, setLogsTag] = useState<TagFilter>("all");
  const [logsPaused, setLogsPaused] = useState(false);

  const navigate = useCallback((next: Tab) => setTab(next), []);
  const effectiveNodes = applyNodeOverrides(nodes, overrides);
  const effectiveMqttNodes = applyNodeOverrides(mqttNodes, overrides);
  const gatewayRegion = useMemo(() => {
    const ownNodeId = devices.find((device) => device.status === "connected")?.ownNodeId;
    return ownNodeId == null
      ? null
      : (mqttNodes.find((node) => node.nodeId === ownNodeId)?.regionPath ?? null);
  }, [devices, mqttNodes]);
  const mqttRegionPrefix = useMemo(() => {
    if (mqttScope === "all" || gatewayRegion == null) return null;
    const parts = gatewayRegion.split("/");
    const depth: Record<MqttScope, number> = { city: 4, county: 3, state: 2, country: 1, all: 0 };
    return parts.slice(0, depth[mqttScope]).join("/");
  }, [mqttScope, gatewayRegion]);
  const scopedMqttNodes = useMemo(
    () =>
      mqttRegionPrefix === null
        ? effectiveMqttNodes
        : effectiveMqttNodes.filter(
            (node) => node.regionPath != null && node.regionPath.startsWith(mqttRegionPrefix),
          ),
    [effectiveMqttNodes, mqttRegionPrefix],
  );
  const mappableMeshCount = effectiveNodes.filter(
    (node) => node.latitude != null && node.longitude != null,
  ).length;
  const mappableMqttCount = scopedMqttNodes.filter(
    (node) => node.latitude != null && node.longitude != null,
  ).length;
  const logTagCounts: Record<string, number> = {};
  for (const entry of logs) logTagCounts[entry.tag] = (logTagCounts[entry.tag] ?? 0) + 1;
  const noLocationNodes = (() => {
    const seen = new Map<
      number,
      { nodeId: number; longName: string | null; shortName: string | null }
    >();
    for (const node of nodes)
      if (node.latitude == null)
        seen.set(node.nodeId, {
          nodeId: node.nodeId,
          longName: node.longName,
          shortName: node.shortName,
        });
    for (const [id, override] of overrides) if (override.latitude != null) seen.delete(id);
    return [...seen.values()].sort((a, b) => a.nodeId - b.nodeId);
  })();

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <img src={logo} alt="Meshtastic Foreman" style={styles.logo} />
        <h1 style={styles.title}>Meshtastic Foreman</h1>
        <MainNavigation tab={tab} onNavigate={setTab} />
        <GpsMenu devices={devices} pending={gpsPending} setPending={setGpsPending} />
        <MqttMenu
          enabled={mqttEnabled}
          scope={mqttScope}
          gatewayRegion={gatewayRegion}
          scopedNodeCount={scopedMqttNodes.length}
          totalNodeCount={effectiveMqttNodes.length}
          onToggle={() =>
            foremanClient.send({ type: "mqtt:toggle", payload: { enabled: !mqttEnabled } })
          }
          onScopeChange={setMqttScope}
        />
        <DeviceMenu
          connected={connected}
          devices={devices}
          activity={activity}
          logs={logs}
          tab={tab}
          showMesh={showMesh}
          setShowMesh={setShowMesh}
          showMqtt={showMqtt}
          setShowMqtt={setShowMqtt}
          mappableMeshCount={mappableMeshCount}
          mappableMqttCount={mappableMqttCount}
          activityWindow={activityWindow}
          setActivityWindow={setActivityWindow}
          activitySource={activitySource}
          setActivitySource={setActivitySource}
          activityPaused={activityPaused}
          setActivityPaused={setActivityPaused}
          logsLevel={logsLevel}
          setLogsLevel={setLogsLevel}
          logsTag={logsTag}
          setLogsTag={setLogsTag}
          logsPaused={logsPaused}
          setLogsPaused={setLogsPaused}
          logTagCounts={logTagCounts}
          onNavigate={navigate}
          onOpenApiDocs={() => setApiDocsOpen(true)}
        />
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
        <SettingsMenu tab={tab} overrideCount={overrides.size} onNavigate={navigate} />
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
          deviceId={devices.find((device) => device.status === "connected")?.id ?? null}
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
      {apiDocsOpen && <ApiDocsModal onClose={() => setApiDocsOpen(false)} />}
    </div>
  );
}

function ApiDocsModal({ onClose }: { onClose: () => void }) {
  return (
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
      onClick={onClose}
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
        onClick={(event) => event.stopPropagation()}
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
            onClick={onClose}
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
  );
}

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
  code: ({ children, className }) =>
    className?.startsWith("language-") ? (
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
    ),
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
