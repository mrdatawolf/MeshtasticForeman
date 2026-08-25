import { Buffer } from "node:buffer";

/* eslint-disable @typescript-eslint/no-explicit-any -- TASK-024 preserves these untyped SDK config boundaries. */

import { Protobuf } from "@meshtastic/core";

import { toPlainObject } from "../decode-payload.js";
import { createLogger } from "../logger.js";

import type { PGlite } from "@electric-sql/pglite";
import type { Channel, DeviceConfig, ServerEvent } from "@foreman/shared";
import type { MeshDevice } from "@meshtastic/core";

export interface ConfigurationHandlerDeps {
  db: PGlite;
  emit: (event: ServerEvent) => void;
  getMeshDevice: (deviceId: string) => MeshDevice | undefined;
}
const log = createLogger("devices");

// SDK config packet types remain intentionally unchanged from DeviceManager.
export async function handleConfigPacket(
  deps: ConfigurationHandlerDeps,
  deviceId: string,
  name: string,
  pkt: any,
) {
  const variant = pkt?.payloadVariant;
  if (!variant?.case || variant.value == null) return;
  const section: string = variant.case;
  const value = toPlainObject(variant.value);
  await deps.db.query(
    `UPDATE devices
     SET radio_config = jsonb_set(COALESCE(radio_config, '{}'), ARRAY[$1], $2::jsonb)
     WHERE id = $3`,
    [section, JSON.stringify(value), deviceId],
  );
  log.info(
    { deviceId, operation: "receive-radio-config", section },
    "radio configuration received",
  );
}

export async function handleModuleConfigPacket(
  deps: ConfigurationHandlerDeps,
  deviceId: string,
  name: string,
  pkt: any,
) {
  const variant = pkt?.payloadVariant;
  if (!variant?.case || variant.value == null) return;
  const section: string = variant.case;
  const value = toPlainObject(variant.value);
  await deps.db.query(
    `UPDATE devices
     SET module_config = jsonb_set(COALESCE(module_config, '{}'), ARRAY[$1], $2::jsonb)
     WHERE id = $3`,
    [section, JSON.stringify(value), deviceId],
  );
  log.info(
    { deviceId, operation: "receive-module-config", section },
    "module configuration received",
  );
}

export async function handleChannelPacket(
  deps: ConfigurationHandlerDeps,
  deviceId: string,
  name: string,
  pkt: any,
) {
  const ch = pkt;
  if (ch == null || ch.index == null) return;
  const idx = Number(ch.index);
  const chName: string | null = ch.settings?.name ?? null;
  const role = Number(ch.role ?? 0);
  const pskBytes: Uint8Array | null = ch.settings?.psk ?? null;
  const psk = pskBytes?.length ? Buffer.from(pskBytes).toString("base64") : null;
  await deps.db.query(
    `INSERT INTO channels(device_id, idx, name, role, psk)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(device_id, idx) DO UPDATE
       SET name = EXCLUDED.name, role = EXCLUDED.role, psk = EXCLUDED.psk`,
    [deviceId, idx, chName, role, psk],
  );
  log.info(
    { deviceId, operation: "receive-channel", channelIndex: idx, channelName: chName, role },
    "channel configuration received",
  );
}

export async function getDeviceConfig(db: PGlite, deviceId: string): Promise<DeviceConfig | null> {
  const { rows } = await db.query<{
    radio_config: Record<string, unknown> | null;
    module_config: Record<string, unknown> | null;
  }>("SELECT radio_config, module_config FROM devices WHERE id = $1", [deviceId]);
  if (!rows[0]) return null;
  const { rows: chRows } = await db.query<{
    idx: number;
    name: string | null;
    role: number;
    psk: string | null;
  }>("SELECT idx, name, role, psk FROM channels WHERE device_id = $1 ORDER BY idx", [deviceId]);
  const channels: Channel[] = chRows.map((r) => ({
    index: r.idx,
    name: r.name,
    role: r.role,
    psk: r.psk,
  }));
  return {
    deviceId,
    radioConfig: rows[0].radio_config ?? {},
    moduleConfig: rows[0].module_config ?? {},
    channels,
  };
}

export async function emitDeviceConfig(deps: ConfigurationHandlerDeps, deviceId: string) {
  const config = await getDeviceConfig(deps.db, deviceId);
  if (!config) return;
  deps.emit({ type: "device:config", payload: config });
}

export async function applyConfigSection(
  deps: ConfigurationHandlerDeps,
  deviceId: string,
  namespace: "radio" | "module",
  section: string,
  value: Record<string, unknown>,
): Promise<void> {
  const meshDevice = deps.getMeshDevice(deviceId);
  if (!meshDevice) throw new Error(`Device ${deviceId} not connected`);

  const { create } = (await import("@bufbuild/protobuf")) as any;
  if (namespace === "radio") {
    const ConfigSchema = (Protobuf.Config as any).ConfigSchema;
    await meshDevice.setConfig(create(ConfigSchema, { payloadVariant: { case: section, value } }));
  } else {
    const ModuleConfigSchema = (Protobuf.ModuleConfig as any).ModuleConfigSchema;
    await meshDevice.setModuleConfig(
      create(ModuleConfigSchema, { payloadVariant: { case: section, value } }),
    );
  }
  await meshDevice.commitEditSettings();
  const col = namespace === "radio" ? "radio_config" : "module_config";
  await deps.db.query(
    `UPDATE devices SET ${col} = jsonb_set(COALESCE(${col}, '{}'), ARRAY[$1], $2::jsonb) WHERE id = $3`,
    [section, JSON.stringify(value), deviceId],
  );
  log.info({ deviceId, operation: "apply-config", namespace, section }, "configuration applied");
  await emitDeviceConfig(deps, deviceId);
}
