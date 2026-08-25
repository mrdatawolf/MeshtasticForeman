export interface DeviceRow {
  id: string;
  name: string;
  port: string;
  hw_model: string | null;
  firmware: string | null;
  last_seen: string | null;
}

/** Preserve the persisted device-list shape exposed by the existing API. */
export function mapDeviceRow(row: DeviceRow): DeviceRow {
  return {
    id: row.id,
    name: row.name,
    port: row.port,
    hw_model: row.hw_model,
    firmware: row.firmware,
    last_seen: row.last_seen,
  };
}
