import { useCallback, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import apiPromisesRaw from "../../../../../API_PROMISES.md?raw";
import logo from "../../assets/logo.png";
import { useNow } from "../../hooks/useNow.js";
import {
  countUniqueNodes,
  findHiddenNodeIds,
  loadLastSeenWindow,
  saveLastSeenWindow,
  withoutHiddenNodes,
} from "../../lib/lastSeenFilter.js";
import { applyNodeOverrides } from "../../lib/nodeOverrides.js";
import { ActivityPage } from "../../pages/ActivityPage.js";
import { AnalyticsPage } from "../../pages/AnalyticsPage.js";
import { DebugPage } from "../../pages/DebugPage.js";
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
import { LastSeenFilter } from "./LastSeenFilter.js";
import { MainNavigation } from "./MainNavigation.js";
import { MqttMenu } from "./MqttMenu.js";
import { NotRespondingIndicator } from "./NotRespondingIndicator.js";
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
import type { LastSeenWindow } from "../../lib/lastSeenFilter.js";
import type { NodeOverride } from "@foreman/shared";

const INTRO_SEEN_KEY = "foreman_intro_seen";
/** How often nodes are re-checked, so they age out without new data arriving. */
const LAST_SEEN_REFRESH_MS = 60_000;

function hasSeenIntro(): boolean {
  try {
    return Boolean(localStorage.getItem(INTRO_SEEN_KEY));
  } catch {
    return false;
  }
}

function markIntroSeen(): void {
  try {
    localStorage.setItem(INTRO_SEEN_KEY, "1");
  } catch {
    /* ignore */
  }
}

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
  const [introOpen, setIntroOpen] = useState(() => !hasSeenIntro());
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
  const [lastSeenWindow, setLastSeenWindow] = useState<LastSeenWindow>(loadLastSeenWindow);
  const now = useNow(LAST_SEEN_REFRESH_MS);

  const navigate = useCallback((next: Tab) => setTab(next), []);
  const handleLastSeenChange = useCallback((next: LastSeenWindow) => {
    setLastSeenWindow(next);
    saveLastSeenWindow(next);
  }, []);
  const effectiveNodes = useMemo(() => applyNodeOverrides(nodes, overrides), [nodes, overrides]);
  const effectiveMqttNodes = useMemo(
    () => applyNodeOverrides(mqttNodes, overrides),
    [mqttNodes, overrides],
  );
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
  // Hidden IDs come from the unscoped lists, because a node's age is the most recent
  // of its mesh and MQTT times even when region scope removes its MQTT record. The
  // unfiltered lists stay in use for lookups, gatewayRegion, and Overrides.
  const hiddenNodeIds = useMemo(() => {
    const ownNodeIds = new Set(
      devices.flatMap((device) =>
        device.status === "connected" && device.ownNodeId != null ? [device.ownNodeId] : [],
      ),
    );
    return findHiddenNodeIds(effectiveNodes, effectiveMqttNodes, lastSeenWindow, now, ownNodeIds);
  }, [devices, effectiveNodes, effectiveMqttNodes, lastSeenWindow, now]);
  const visibleNodes = useMemo(
    () => withoutHiddenNodes(effectiveNodes, hiddenNodeIds),
    [effectiveNodes, hiddenNodeIds],
  );
  const visibleScopedMqttNodes = useMemo(
    () => withoutHiddenNodes(scopedMqttNodes, hiddenNodeIds),
    [scopedMqttNodes, hiddenNodeIds],
  );
  const visibleMqttNodeCount = withoutHiddenNodes(effectiveMqttNodes, hiddenNodeIds).length;
  const shownNodeCount = countUniqueNodes(visibleNodes, visibleScopedMqttNodes);
  const totalNodeCount = countUniqueNodes(effectiveNodes, scopedMqttNodes);
  const mappableMeshCount = visibleNodes.filter(
    (node) => node.latitude != null && node.longitude != null,
  ).length;
  const mappableMqttCount = visibleScopedMqttNodes.filter(
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
        <LastSeenFilter
          window={lastSeenWindow}
          shownCount={shownNodeCount}
          totalCount={totalNodeCount}
          onChange={handleLastSeenChange}
        />
        <NotRespondingIndicator devices={devices} onOpenDebug={() => navigate("debug")} />
        <GpsMenu
          devices={devices}
          pending={gpsPending}
          setPending={setGpsPending}
          onOpenDebug={() => navigate("debug")}
        />
        <MqttMenu
          enabled={mqttEnabled}
          scope={mqttScope}
          gatewayRegion={gatewayRegion}
          scopedNodeCount={visibleScopedMqttNodes.length}
          totalNodeCount={visibleMqttNodeCount}
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
            nodes={visibleNodes}
            mqttNodes={visibleScopedMqttNodes}
            hiddenNodeCount={totalNodeCount - shownNodeCount}
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
          nodes={visibleNodes}
          mqttNodes={visibleScopedMqttNodes}
          lookupNodes={effectiveNodes}
          lookupMqttNodes={scopedMqttNodes}
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
            pickerNodes={visibleNodes}
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
      {tab === "debug" && (
        <div className={appShellStyles.tabPanelScroll}>
          <DebugPage devices={devices} />
        </div>
      )}
      {tab === "analytics" && (
        <div className={appShellStyles.tabPanelColumn}>
          <AnalyticsPage
            nodes={effectiveNodes}
            mqttNodes={effectiveMqttNodes}
            hiddenNodeIds={hiddenNodeIds}
            devices={devices}
          />
        </div>
      )}
      {introOpen && (
        <IntroModal
          onClose={() => {
            markIntroSeen();
            setIntroOpen(false);
          }}
          onSetupWizard={() => {
            markIntroSeen();
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
