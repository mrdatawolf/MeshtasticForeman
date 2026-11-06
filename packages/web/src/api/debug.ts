import { request } from "./client.js";

import type {
  DebugChecksResponse,
  DebugToolId,
  DebugToolStatus,
  RawProbeResult,
} from "@foreman/shared";

export function getDebugChecks(signal?: AbortSignal): Promise<DebugChecksResponse | undefined> {
  return request<DebugChecksResponse>("/api/debug/checks", { signal });
}

export function runDebugTool(
  toolId: "raw-probe",
  deviceId: string,
): Promise<RawProbeResult | undefined>;
export function runDebugTool(
  toolId: Exclude<DebugToolId, "raw-probe">,
  deviceId: string,
): Promise<DebugToolStatus | undefined>;
export function runDebugTool(
  toolId: DebugToolId,
  deviceId: string,
): Promise<RawProbeResult | DebugToolStatus | undefined> {
  return request(`/api/debug/tools/${toolId}`, { method: "POST", body: { deviceId } });
}
