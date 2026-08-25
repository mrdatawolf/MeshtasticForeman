import { mergeConfig } from "./configMerge.js";

// Mirrors region-presets.json's node shape.
export interface RegionNode {
  id: string;
  label: string;
  description?: string;
  settings?: Record<string, Record<string, Record<string, unknown>>>;
  mqttDefaults?: { address?: string; username?: string; password?: string };
  children?: RegionNode[];
}

export interface RegionPresets {
  version: number;
  regions: RegionNode[];
}

/**
 * Fold the selected region breadcrumb (root first, leaf last) through `mergeConfig`.
 * `mergeConfig`'s second argument wins on any real conflict, so the leaf-most selected
 * region's settings are applied last and win — matching region-presets.json's own
 * documented root-to-leaf override contract. A region node with no `settings` property
 * (a purely navigational node) contributes nothing to the merge.
 */
export function mergeSelectedRegionSettings(
  selectedRegions: RegionNode[],
): Record<string, unknown> {
  return selectedRegions.reduce<Record<string, unknown>>(
    (acc, node) =>
      node.settings ? mergeConfig(acc, node.settings as Record<string, unknown>) : acc,
    {},
  );
}
