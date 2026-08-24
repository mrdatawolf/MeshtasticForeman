import type { DeviceConfig } from "@foreman/shared";

import { request } from "./client.js";

export function getConfiguration(
  deviceId: string,
  signal?: AbortSignal,
): Promise<DeviceConfig | undefined> {
  return request<DeviceConfig>(`/api/devices/${encodeURIComponent(deviceId)}/config`, { signal });
}
