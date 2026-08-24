import { request } from "./client.js";

import type { DeviceConfig, DeviceInfo, NodeInfo } from "@foreman/shared";

export function listDevices(signal?: AbortSignal): Promise<DeviceInfo[] | undefined> {
  return request<DeviceInfo[]>("/api/devices", { signal });
}

export function connectDevice(
  port: string,
  name: string,
  signal?: AbortSignal,
): Promise<DeviceInfo | undefined> {
  return request<DeviceInfo>("/api/devices/connect", {
    method: "POST",
    body: { port, name },
    signal,
  });
}

export function getDevice(id: string, signal?: AbortSignal): Promise<DeviceInfo | undefined> {
  return request<DeviceInfo>(`/api/devices/${encodeURIComponent(id)}`, { signal });
}

export function listDeviceNodes(id: string, signal?: AbortSignal): Promise<NodeInfo[] | undefined> {
  return request<NodeInfo[]>(`/api/devices/${encodeURIComponent(id)}/nodes`, { signal });
}

export function getDeviceConfig(
  id: string,
  signal?: AbortSignal,
): Promise<DeviceConfig | undefined> {
  return request<DeviceConfig>(`/api/devices/${encodeURIComponent(id)}/config`, { signal });
}

export function disconnectDevice(id: string, signal?: AbortSignal): Promise<void> {
  return request<void>(`/api/devices/${encodeURIComponent(id)}`, { method: "DELETE", signal });
}
