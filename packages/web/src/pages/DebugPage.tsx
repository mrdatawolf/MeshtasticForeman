import { useCallback, useEffect, useRef, useState } from "react";

import { getDebugChecks, runDebugTool } from "../api/debug.js";
import {
  formatDebugReport,
  formatFrameAge,
  PROBE_OUTCOMES,
  STATUS_LABELS,
  TOOL_CONFIRMATIONS,
  TOOL_LABELS,
  toolAvailable,
} from "../lib/debugReport.js";

import styles from "./DebugPage.module.css";

import type {
  CheckStatus,
  DebugCheck,
  DebugChecksResponse,
  DebugToolId,
  DeviceInfo,
  RawProbeResult,
} from "@foreman/shared";

const REFRESH_INTERVAL_MS = 5_000;
const TOOL_ORDER: DebugToolId[] = ["reconfigure", "reconnect", "disconnect", "raw-probe"];

const STATUS_CLASS: Record<CheckStatus, string> = {
  pass: styles.statusPass,
  warn: styles.statusWarn,
  fail: styles.statusFail,
  skipped: styles.statusSkipped,
};

function isToolId(value: string): value is DebugToolId {
  return value in TOOL_LABELS;
}

/** The async clipboard API only exists on HTTPS or localhost, not on a plain LAN address. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

function CheckRow({
  check,
  busy,
  portHeld,
  onTool,
}: {
  check: DebugCheck;
  busy: boolean;
  portHeld: boolean;
  onTool: (toolId: DebugToolId) => void;
}) {
  const tools = check.toolIds.filter(isToolId).filter((toolId) => toolAvailable(toolId, portHeld));
  return (
    <li className={styles.check}>
      <div className={styles.checkHeader}>
        <span className={`${styles.status} ${STATUS_CLASS[check.status]}`}>
          {STATUS_LABELS[check.status]}
        </span>
        <span className={styles.checkTitle}>{check.title}</span>
      </div>
      <p className={styles.checkSummary}>{check.summary}</p>
      {check.cause && <p className={styles.checkDetail}>Likely cause: {check.cause}</p>}
      {check.fix && <p className={styles.checkDetail}>Next step: {check.fix}</p>}
      {tools.length > 0 && (
        <div className={styles.tools}>
          {tools.map((toolId) => (
            <button
              key={toolId}
              className={styles.button}
              disabled={busy}
              onClick={() => onTool(toolId)}
            >
              {TOOL_LABELS[toolId]}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

function ProbeResultPanel({
  result,
  reconnecting,
}: {
  result: RawProbeResult;
  reconnecting: boolean;
}) {
  const { title, guidance } = PROBE_OUTCOMES[result.outcome];
  return (
    <section className={styles.panel} aria-labelledby="debug-probe-title">
      <h3 id="debug-probe-title" className={styles.panelTitle}>
        Raw serial probe
      </h3>
      <p className={styles.probeTitle}>{title}</p>
      <p className={styles.checkSummary}>{guidance}</p>
      <dl className={styles.facts}>
        <div>
          <dt>Bytes received</dt>
          <dd>{result.bytesReceived}</dd>
        </div>
        <div>
          <dt>Frames received</dt>
          <dd>{result.framesReceived}</dd>
        </div>
        <div>
          <dt>Took</dt>
          <dd>{(result.durationMs / 1000).toFixed(1)}s</dd>
        </div>
      </dl>
      {reconnecting && (
        <p className={styles.checkDetail}>The daemon is reconnecting to the radio.</p>
      )}
    </section>
  );
}

function ReleasedNote({
  port,
  onReconnect,
  busy,
}: {
  port: string;
  onReconnect: () => void;
  busy: boolean;
}) {
  return (
    <section className={styles.panel} aria-labelledby="debug-released-title">
      <h3 id="debug-released-title" className={styles.panelTitle}>
        The port is free
      </h3>
      <p className={styles.checkSummary}>
        The daemon has let go of {port} and will not reconnect until you ask it to or it restarts.
        Outside tools can use the port now:
      </p>
      <code className={styles.command}>meshtastic --port {port} --info</code>
      <p className={styles.checkSummary}>A radio that is still responding can be restarted with:</p>
      <code className={styles.command}>meshtastic --port {port} --reboot</code>
      <div className={styles.tools}>
        <button className={styles.button} disabled={busy} onClick={onReconnect}>
          {TOOL_LABELS.reconnect}
        </button>
      </div>
    </section>
  );
}

export function DebugPage({ devices }: { devices: DeviceInfo[] }) {
  const [report, setReport] = useState<DebugChecksResponse | null>(null);
  const [receivedAt, setReceivedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runningTool, setRunningTool] = useState<DebugToolId | null>(null);
  const [toolError, setToolError] = useState<string | null>(null);
  const [probes, setProbes] = useState<Record<string, RawProbeResult>>({});
  const [releasedIds, setReleasedIds] = useState<ReadonlySet<string>>(new Set());
  const [copied, setCopied] = useState(false);
  /** The report text, shown for manual copying when the browser refused to copy it. */
  const [copyFallback, setCopyFallback] = useState<string | null>(null);
  const latestRefresh = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    latestRefresh.current?.abort();
    const controller = new AbortController();
    latestRefresh.current = controller;
    try {
      const next = await getDebugChecks(controller.signal);
      if (controller.signal.aborted || !next) return;
      setReport(next);
      setReceivedAt(Date.now());
      setLoadError(null);
    } catch (error) {
      if (controller.signal.aborted) return;
      setLoadError(error instanceof Error ? error.message : "Could not load checks");
    }
  }, []);

  // Status changes arrive over the WebSocket, so a new status refreshes the checks
  // straight away rather than at the next interval.
  const statusKey = devices.map((device) => `${device.id}:${device.status}`).join(",");
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      latestRefresh.current?.abort();
    };
  }, [refresh, statusKey]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  // The "port is free" note only applies until the daemon holds the port again.
  useEffect(() => {
    if (!report) return;
    setReleasedIds((current) => {
      const held = report.devices.filter(
        (device) => device.portHeld && current.has(device.deviceId),
      );
      if (held.length === 0) return current;
      const next = new Set(current);
      for (const device of held) next.delete(device.deviceId);
      return next;
    });
  }, [report]);

  const reportDevices = report?.devices ?? [];
  const selected =
    reportDevices.find((device) => device.deviceId === selectedId) ??
    reportDevices.find(
      (device) =>
        device.portHeld ||
        devices.some((d) => d.id === device.deviceId && d.status === "connected"),
    ) ??
    reportDevices[0] ??
    null;
  const deviceName = (deviceId: string, port: string) =>
    devices.find((device) => device.id === deviceId)?.name ?? port;

  const runTool = async (toolId: DebugToolId) => {
    if (!selected) return;
    const confirmation = TOOL_CONFIRMATIONS[toolId];
    if (confirmation && !window.confirm(confirmation)) return;

    const { deviceId } = selected;
    setSelectedId(deviceId);
    setRunningTool(toolId);
    setToolError(null);
    try {
      if (toolId === "raw-probe") {
        const result = await runDebugTool(toolId, deviceId);
        if (result) setProbes((current) => ({ ...current, [deviceId]: result }));
      } else {
        await runDebugTool(toolId, deviceId);
      }
      setReleasedIds((current) => {
        const next = new Set(current);
        if (toolId === "disconnect") next.add(deviceId);
        else next.delete(deviceId);
        return next;
      });
    } catch (error) {
      setToolError(error instanceof Error ? error.message : "The tool failed");
    } finally {
      setRunningTool(null);
      void refresh();
    }
  };

  const copyReport = async () => {
    if (!report) return;
    const text = formatDebugReport(report, probes);
    const succeeded = await copyText(text);
    setCopied(succeeded);
    setCopyFallback(succeeded ? null : text);
  };

  const busy = runningTool !== null;
  const probe = selected ? probes[selected.deviceId] : undefined;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h2 className={styles.title}>Debug</h2>
        <div className={styles.tools}>
          <button className={styles.button} onClick={() => void refresh()}>
            Rerun checks
          </button>
          <button className={styles.button} disabled={!report} onClick={() => void copyReport()}>
            {copied ? "Copied" : "Copy results"}
          </button>
        </div>
      </div>

      {copyFallback !== null && (
        <label className={styles.copyFallback}>
          This browser blocked copying, so select the text here instead.
          <textarea readOnly rows={6} value={copyFallback} className={styles.copyArea} />
        </label>
      )}
      {loadError && (
        <p role="alert" className={styles.error}>
          Could not load checks: {loadError}
        </p>
      )}
      {!report && !loadError && <p className={styles.checkSummary}>Running checks…</p>}

      {reportDevices.length > 1 && (
        <label className={styles.picker}>
          Device
          <select
            className={styles.select}
            value={selected?.deviceId}
            onChange={(event) => setSelectedId(event.target.value)}
          >
            {reportDevices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {deviceName(device.deviceId, device.port)} ({device.port})
              </option>
            ))}
          </select>
        </label>
      )}

      {report && !selected && <p className={styles.checkSummary}>No devices are saved yet.</p>}

      {report && selected && (
        <>
          <section className={styles.panel} aria-labelledby="debug-connection-title">
            <h3 id="debug-connection-title" className={styles.panelTitle}>
              Connection
            </h3>
            <dl className={styles.facts}>
              <div>
                <dt>Port</dt>
                <dd>{selected.port}</dd>
              </div>
              <div>
                <dt>Port held</dt>
                <dd>{selected.portHeld ? "Yes" : "No"}</dd>
              </div>
              <div>
                <dt>Last frame</dt>
                <dd>{formatFrameAge(selected.lastFrameAt, report.generatedAt, receivedAt, now)}</dd>
              </div>
              <div>
                <dt>Frames this connection</dt>
                <dd>{selected.framesThisConnection}</dd>
              </div>
            </dl>
          </section>

          <section className={styles.panel} aria-labelledby="debug-tools-title">
            <h3 id="debug-tools-title" className={styles.panelTitle}>
              Tools
            </h3>
            <div className={styles.tools}>
              {TOOL_ORDER.map((toolId) => (
                <button
                  key={toolId}
                  className={styles.button}
                  disabled={busy || !toolAvailable(toolId, selected.portHeld)}
                  onClick={() => void runTool(toolId)}
                >
                  {runningTool === toolId ? "Running…" : TOOL_LABELS[toolId]}
                </button>
              ))}
            </div>
            <p className={styles.checkDetail}>
              The raw serial probe drops the connection for up to about 30 seconds, then reconnects.
            </p>
            <div aria-live="polite">
              {runningTool === "raw-probe" && (
                <p className={styles.checkSummary}>
                  Probing the radio. This can take up to about 30 seconds.
                </p>
              )}
              {runningTool === "reconfigure" && (
                <p className={styles.checkSummary}>Asking the radio for its config.</p>
              )}
            </div>
            {toolError && (
              <p role="alert" className={styles.error}>
                {toolError}
              </p>
            )}
          </section>

          {probe && (
            <ProbeResultPanel
              result={probe}
              reconnecting={
                probe.reconnecting && !selected.portHeld && !releasedIds.has(selected.deviceId)
              }
            />
          )}
          {releasedIds.has(selected.deviceId) && !selected.portHeld && (
            <ReleasedNote
              port={selected.port}
              busy={busy}
              onReconnect={() => void runTool("reconnect")}
            />
          )}

          <section className={styles.panel} aria-labelledby="debug-checks-title">
            <h3 id="debug-checks-title" className={styles.panelTitle}>
              Checks
            </h3>
            <ul className={styles.checkList}>
              {selected.checks.map((check) => (
                <CheckRow
                  key={check.id}
                  check={check}
                  busy={busy}
                  portHeld={selected.portHeld}
                  onTool={(toolId) => void runTool(toolId)}
                />
              ))}
            </ul>
          </section>
        </>
      )}

      {report && (
        <section className={styles.panel} aria-labelledby="debug-system-title">
          <h3 id="debug-system-title" className={styles.panelTitle}>
            System
          </h3>
          <ul className={styles.checkList}>
            {report.system.map((check) => (
              <CheckRow
                key={check.id}
                check={check}
                busy={busy}
                portHeld={selected?.portHeld ?? false}
                onTool={(toolId) => void runTool(toolId)}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
