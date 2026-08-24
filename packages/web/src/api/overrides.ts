import { request } from "./client.js";

import type { NodeOverride } from "@foreman/shared";

export type NodeOverridePatch = Partial<
  Pick<NodeOverride, "aliasName" | "latitude" | "longitude" | "altitude" | "notes">
>;

export function listOverrides(signal?: AbortSignal): Promise<NodeOverride[] | undefined> {
  return request<NodeOverride[]>("/api/node-overrides", { signal });
}

export function updateOverride(
  nodeId: number,
  patch: NodeOverridePatch,
  signal?: AbortSignal,
): Promise<NodeOverride | undefined> {
  return request<NodeOverride>(`/api/node-overrides/${nodeId}`, {
    method: "PUT",
    body: patch,
    signal,
  });
}

export function deleteOverride(nodeId: number, signal?: AbortSignal): Promise<void> {
  return request<void>(`/api/node-overrides/${nodeId}`, { method: "DELETE", signal });
}
