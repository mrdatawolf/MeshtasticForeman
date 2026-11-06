import type {
  CheckStatus,
  DebugCheck,
  DebugChecksResponse,
  DebugDeviceReport,
  DebugToolId,
  RawProbeOutcome,
  RawProbeResult,
} from "@foreman/shared";

export const STATUS_LABELS: Record<CheckStatus, string> = {
  pass: "Pass",
  warn: "Warning",
  fail: "Fail",
  skipped: "Skipped",
};

export const TOOL_LABELS: Record<DebugToolId, string> = {
  reconfigure: "Re-request config",
  disconnect: "Disconnect serial",
  reconnect: "Reconnect serial",
  "raw-probe": "Raw serial probe",
};

export const TOOL_CONFIRMATIONS: Partial<Record<DebugToolId, string>> = {
  disconnect:
    "Disconnect serial?\n\nThe daemon releases the port and stops using this radio until you reconnect it or restart the daemon.",
  "raw-probe":
    "Run the raw serial probe?\n\nThis drops the connection for up to about 30 seconds, then reconnects.",
};

export const PROBE_OUTCOMES: Record<RawProbeOutcome, { title: string; guidance: string }> = {
  healthy: {
    title: "The radio is healthy",
    guidance:
      "The radio answered and finished sending its config. The next thing to check is the daemon's connection to it.",
  },
  partial: {
    title: "The radio answered, but did not finish",
    guidance:
      "Some data arrived, but the config request did not complete. The link or firmware is unreliable. Retry the probe, then power-cycle the radio.",
  },
  "no-response": {
    title: "The radio did not answer",
    guidance: "No bytes came back. Power-cycle the radio, including its battery if it has one.",
  },
  "open-failed": {
    title: "The port could not be opened",
    guidance: "Check whether another program is holding the port.",
  },
};

/** Whether a tool's CONTRACT-013 requirement is met, so the page can avoid offering it. */
export function toolAvailable(toolId: DebugToolId, portHeld: boolean): boolean {
  if (toolId === "reconfigure") return portHeld;
  if (toolId === "reconnect") return !portHeld;
  return true;
}

/**
 * Age of a timestamp as of `nowMs`. The daemon's clock is the reference, because a
 * viewer elsewhere on the LAN may have a different one: `generatedAt` is the daemon's
 * time when the report was built, and `receivedAtMs` is the viewer's.
 */
export function formatFrameAge(
  timestamp: string | null,
  generatedAt: string,
  receivedAtMs: number,
  nowMs: number,
): string {
  if (timestamp === null) return "None this connection";
  const ageMs = Date.parse(generatedAt) - Date.parse(timestamp) + (nowMs - receivedAtMs);
  const seconds = Math.max(0, Math.floor(ageMs / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s ago`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m ago`;
}

function formatCheck(check: DebugCheck): string[] {
  const lines = [`[${STATUS_LABELS[check.status]}] ${check.title}: ${check.summary}`];
  if (check.cause) lines.push(`  Cause: ${check.cause}`);
  if (check.fix) lines.push(`  Fix: ${check.fix}`);
  return lines;
}

export function formatProbeResult(result: RawProbeResult): string[] {
  const { title, guidance } = PROBE_OUTCOMES[result.outcome];
  return [
    `Raw serial probe: ${title}`,
    `  ${guidance}`,
    `  Bytes received: ${result.bytesReceived}`,
    `  Frames received: ${result.framesReceived}`,
    `  Took: ${(result.durationMs / 1000).toFixed(1)}s`,
  ];
}

function formatDevice(device: DebugDeviceReport, probe: RawProbeResult | undefined): string[] {
  return [
    `Device ${device.port}`,
    `  Port held: ${device.portHeld ? "yes" : "no"}`,
    `  Last frame: ${device.lastFrameAt ?? "none this connection"}`,
    `  Frames this connection: ${device.framesThisConnection}`,
    `  Last config request: ${device.lastConfigRequestAt ?? "none"}`,
    `  Configured: ${device.configured ? "yes" : "no"}`,
    ...device.checks.flatMap(formatCheck),
    ...(probe ? formatProbeResult(probe) : []),
  ];
}

/** Plain text for sharing. It only holds what the page shows, which has no secrets in it. */
export function formatDebugReport(
  report: DebugChecksResponse,
  probes: Record<string, RawProbeResult>,
): string {
  const sections = [
    [`Meshtastic Foreman debug report, ${report.generatedAt}`],
    ...report.devices.map((device) => formatDevice(device, probes[device.deviceId])),
    ["System", ...report.system.flatMap(formatCheck)],
  ];
  return sections.map((lines) => lines.join("\n")).join("\n\n");
}
