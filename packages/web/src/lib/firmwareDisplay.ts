import type { DeviceInfo } from "@foreman/shared";

export interface FirmwareDisplay {
  label: string;
  value: string;
  /** False when `value` is the "not reported" message rather than a version. */
  known: boolean;
}

const LABEL = "Firmware version";

/** The saved version is only current while the radio is connected. */
export function firmwareDisplay(
  device: Pick<DeviceInfo, "status" | "firmwareVersion">,
): FirmwareDisplay {
  const version = device.firmwareVersion?.trim();
  if (!version) return { label: LABEL, value: "Not reported yet", known: false };
  const label = device.status === "connected" ? LABEL : `${LABEL} (last reported)`;
  return { label, value: version, known: true };
}
