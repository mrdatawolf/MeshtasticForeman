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

import appShellStyles from "./AppShell.module.css";
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
    <div className={styles.page}>
      <header className={styles.header}>
        <img src={logo} alt="Meshtastic Foreman" className={styles.logo} />
        <h1 className={styles.title}>Meshtastic Foreman</h1>
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
          className={appShellStyles.introButton}
          title="Open introduction guide"
        >
          ?
        </button>
        <SettingsMenu tab={tab} overrideCount={overrides.size} onNavigate={navigate} />
      </header>

      {tab === "nodes" && (
        <div className={appShellStyles.tabPanelScroll}>
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
        <div className={appShellStyles.tabPanelColumn}>
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
        <div className={appShellStyles.tabPanelScroll}>
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
        <div className={appShellStyles.tabPanelColumn}>
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
        <div className={appShellStyles.tabPanelScroll}>
          <NodeOverridesPage
            overrides={[...overrides.values()]}
            noLocationNodes={noLocationNodes}
            onChanged={loadOverrides}
          />
        </div>
      )}
      {tab === "config" && (
        <div className={appShellStyles.tabPanelScroll}>
          <DeviceConfigPage
            devices={devices}
            configs={deviceConfigs}
            autoOpenWizard={pendingWizard}
            onWizardOpened={() => setPendingWizard(false)}
          />
        </div>
      )}
      {tab === "analytics" && (
        <div className={appShellStyles.tabPanelColumn}>
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
    <div className={appShellStyles.modalOverlay} onClick={onClose}>
      <div className={appShellStyles.modalPanel} onClick={(event) => event.stopPropagation()}>
        <div className={appShellStyles.modalHeader}>
          <span className={appShellStyles.modalTitle}>API Reference</span>
          <button onClick={onClose} className={appShellStyles.modalClose}>
            ✕ close
          </button>
        </div>
        <div className={appShellStyles.modalBody}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {apiPromisesRaw}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}

const mdComponents: React.ComponentProps<typeof ReactMarkdown>["components"] = {
  h1: ({ children }) => <h1 className={appShellStyles.mdH1}>{children}</h1>,
  h2: ({ children }) => <h2 className={appShellStyles.mdH2}>{children}</h2>,
  h3: ({ children }) => <h3 className={appShellStyles.mdH3}>{children}</h3>,
  h4: ({ children }) => <h4 className={appShellStyles.mdH4}>{children}</h4>,
  p: ({ children }) => <p className={appShellStyles.mdP}>{children}</p>,
  a: ({ href, children }) => (
    <a href={href} className={appShellStyles.mdA} target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className={appShellStyles.mdStrong}>{children}</strong>,
  code: ({ children, className }) =>
    className?.startsWith("language-") ? (
      <code className={appShellStyles.mdCodeBlock}>{children}</code>
    ) : (
      <code className={appShellStyles.mdCodeInline}>{children}</code>
    ),
  pre: ({ children }) => <pre className={appShellStyles.mdPre}>{children}</pre>,
  blockquote: ({ children }) => (
    <blockquote className={appShellStyles.mdBlockquote}>{children}</blockquote>
  ),
  hr: () => <hr className={appShellStyles.mdHr} />,
  ul: ({ children }) => <ul className={appShellStyles.mdUl}>{children}</ul>,
  ol: ({ children }) => <ol className={appShellStyles.mdOl}>{children}</ol>,
  li: ({ children }) => <li className={appShellStyles.mdLi}>{children}</li>,
  table: ({ children }) => (
    <div className={appShellStyles.mdTableWrap}>
      <table className={appShellStyles.mdTable}>{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className={appShellStyles.mdThead}>{children}</thead>,
  th: ({ children }) => <th className={appShellStyles.mdTh}>{children}</th>,
  td: ({ children }) => <td className={appShellStyles.mdTd}>{children}</td>,
  tr: ({ children }) => <tr className={appShellStyles.mdTr}>{children}</tr>,
};
