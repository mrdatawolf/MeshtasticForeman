import type { DeviceConfig } from "@foreman/shared";

export const MAP_STYLE =
  import.meta.env.VITE_MAP_STYLE ?? "https://tiles.openfreemap.org/styles/liberty";
export const TERRAIN_MAP_STYLE = "https://tiles.stadiamaps.com/styles/stamen_terrain.json";

export const COVERAGE_RADII_KM = [1, 2, 3, 5, 7, 10, 12, 15, 20];

export const MODEM_PRESET_RADIUS_KM: Record<number, number> = {
  0: 10,
  1: 15,
  2: 20,
  3: 7,
  4: 5,
  5: 3,
  6: 2,
  7: 12,
  8: 1,
};

export const DEFAULT_RADIUS_KM = 10;
export const TERRAIN_FETCH_RADIUS_KM = 20;

export function channelNameToPreset(name: string | null | undefined): number | null {
  if (!name) return null;
  const key = name.toLowerCase().replace(/[_\-\s]/g, "");
  const map: Record<string, number> = {
    longfast: 0,
    longslow: 1,
    verylongslow: 2,
    mediumslow: 3,
    mediumfast: 4,
    shortslow: 5,
    shortfast: 6,
    longmoderate: 7,
    shortturbo: 8,
  };
  return map[key] ?? null;
}

export function presetRadiusKm(
  deviceConfigs: Map<string, DeviceConfig>,
  deviceId: string | null | undefined,
): number {
  if (!deviceId) return DEFAULT_RADIUS_KM;
  const cfg = deviceConfigs.get(deviceId);
  const preset = (cfg?.radioConfig as { lora?: { modemPreset?: number } } | undefined)?.lora
    ?.modemPreset;
  if (preset == null) return DEFAULT_RADIUS_KM;
  return MODEM_PRESET_RADIUS_KM[preset] ?? DEFAULT_RADIUS_KM;
}
