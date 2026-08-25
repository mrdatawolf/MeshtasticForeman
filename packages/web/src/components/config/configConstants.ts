import { MODEM_PRESET_LABELS } from "@foreman/shared";

// ---------------------------------------------------------------------------
// Enum display tables
// ---------------------------------------------------------------------------
export const DEVICE_ROLE: Record<number, string> = {
  0: "CLIENT",
  1: "CLIENT_MUTE",
  2: "ROUTER",
  3: "ROUTER_CLIENT",
  4: "REPEATER",
  5: "TRACKER",
  6: "SENSOR",
  7: "TAK",
  8: "CLIENT_HIDDEN",
  9: "LOST_AND_FOUND",
  10: "TAK_TRACKER",
};

export const LORA_REGION: Record<number, string> = {
  0: "UNSET",
  1: "US",
  2: "EU_433",
  3: "EU_868",
  4: "CN",
  5: "JP",
  6: "ANZ",
  7: "KR",
  8: "TW",
  9: "RU",
  10: "IN",
  11: "NZ_865",
  12: "TH",
  13: "LORA_24",
  14: "UA_433",
  15: "UA_868",
  16: "MY_433",
  17: "MY_919",
  18: "SG_923",
};

export const CHANNEL_ROLE: Record<number, string> = {
  0: "DISABLED",
  1: "PRIMARY",
  2: "SECONDARY",
};

export const ENUM_LOOKUPS: Record<string, Record<string, Record<number, string>>> = {
  device: { role: DEVICE_ROLE },
  lora: { region: LORA_REGION, modemPreset: MODEM_PRESET_LABELS },
};

export const SENSITIVE_KEYS = new Set([
  "privateKey",
  "publicKey",
  "adminKey",
  "password",
  "psk",
  "fixedPin",
]);

// ---------------------------------------------------------------------------
// Wizard role definitions
// ---------------------------------------------------------------------------
export const ROLES = [
  { value: 0, label: "Client", sub: "Normal user device. Sends and receives messages." },
  { value: 2, label: "Router", sub: "Dedicated relay. Rebroadcasts packets, no messages." },
  { value: 4, label: "Repeater", sub: "Pure relay. No NodeInfo or position broadcasts." },
  { value: 5, label: "Tracker", sub: "Location tracker. Broadcasts position frequently." },
];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
export function camelToLabel(key: string): string {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
}

export function visibleEntries(data: Record<string, unknown>): [string, unknown][] {
  return Object.entries(data).filter(([k]) => k !== "$typeName");
}
