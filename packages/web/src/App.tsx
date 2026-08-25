import { useCallback, useEffect, useReducer, useState } from "react";

import { appStateReducer, initialAppState } from "./appState.js";
import { AppShell } from "./components/shell/AppShell.js";
import { initMessageStore, loadRecentMessages } from "./store/messages.js";
import { foremanClient } from "./ws/client.js";

import type { NodeOverride } from "@foreman/shared";

initMessageStore();

export function App() {
  const [appState, dispatch] = useReducer(appStateReducer, initialAppState);
  const [overrides, setOverrides] = useState<Map<number, NodeOverride>>(new Map());
  const [connected, setConnected] = useState(false);
  const [gpsPending, setGpsPending] = useState<Set<string>>(new Set());

  const loadOverrides = useCallback(async () => {
    try {
      const response = await fetch("/api/node-overrides");
      if (!response.ok) return;
      const list: NodeOverride[] = await response.json();
      setOverrides(new Map(list.map((override) => [override.nodeId, override])));
    } catch {
      // daemon may not be up yet — silently ignore
    }
  }, []);

  useEffect(() => {
    loadOverrides();
  }, [loadOverrides]);

  useEffect(() => {
    foremanClient.connect();
    const offConnection = foremanClient.onConnection(setConnected);
    const offEvent = foremanClient.on((event) => {
      dispatch(event);
      if (event.type === "device:list") {
        for (const device of event.payload) loadRecentMessages(device.id);
      }
      if (event.type === "device:status" && event.payload.gpsDetail) {
        setGpsPending((previous) => {
          const next = new Set(previous);
          next.delete(event.payload.id);
          return next;
        });
      }
    });
    return () => {
      offEvent();
      offConnection();
      foremanClient.disconnect();
      setConnected(false);
    };
  }, []);

  return (
    <AppShell
      appState={appState}
      overrides={overrides}
      connected={connected}
      gpsPending={gpsPending}
      setGpsPending={setGpsPending}
      loadOverrides={loadOverrides}
    />
  );
}
