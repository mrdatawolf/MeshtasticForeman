import { createLogger } from "../logger.js";

import type { AdaptedTelemetry } from "./meshtastic-adapter.js";
import type { PGlite } from "@electric-sql/pglite";
import type { ServerEvent, GpsDetail } from "@foreman/shared";

interface DeviceStatusSource {
  name: string;
  port: string;
  connectedAt: string;
}
const log = createLogger("devices");

export interface TelemetryHandlerDeps {
  db: PGlite;
  emit: (event: ServerEvent) => void;
  getDevice: (deviceId: string) => DeviceStatusSource | undefined;
  getMyNodeId: (deviceId: string) => number | undefined;
  getBatteryLevel: (deviceId: string) => number | undefined;
  setBatteryLevel: (deviceId: string, level: number) => void;
  hasGpsPosition: (deviceId: string) => boolean;
  getGpsDetail: (deviceId: string) => GpsDetail | undefined;
}

export async function handleTelemetry(
  deps: TelemetryHandlerDeps,
  deviceId: string,
  name: string,
  pkt: AdaptedTelemetry,
): Promise<void> {
  const variant = pkt.data?.variant;
  if (variant?.case !== "deviceMetrics") return;
  const batteryLevel = variant.value?.batteryLevel;
  if (batteryLevel == null || batteryLevel === 0) return;
  const fromNodeId = pkt.from ?? 0;
  const myNodeId = deps.getMyNodeId(deviceId);
  if (myNodeId === undefined || fromNodeId !== myNodeId) return;
  if (deps.getBatteryLevel(deviceId) === batteryLevel) return;

  deps.setBatteryLevel(deviceId, batteryLevel);
  log.info({ deviceId, operation: "battery-update", batteryLevel }, "device battery updated");
  const device = deps.getDevice(deviceId);
  if (!device) return;
  const { rows } = await deps.db.query<{ hw_model: string | null; firmware: string | null }>(
    "SELECT hw_model, firmware FROM devices WHERE id = $1",
    [deviceId],
  );
  const row = rows[0];
  deps.emit({
    type: "device:status",
    payload: {
      id: deviceId,
      name: device.name,
      port: device.port,
      status: "connected",
      connectedAt: device.connectedAt,
      lastSeenAt: null,
      hardwareModel: row?.hw_model ?? null,
      firmwareVersion: row?.firmware ?? null,
      batteryLevel,
      hasGpsPosition: deps.hasGpsPosition(deviceId),
      gpsDetail: deps.getGpsDetail(deviceId) ?? null,
      ownNodeId: deps.getMyNodeId(deviceId) ?? null,
    },
  });
}
