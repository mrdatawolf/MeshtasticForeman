import type { NodeOverride } from "@foreman/shared";

export interface OverrideableNode {
  nodeId: number;
  latitude: number | null;
  longitude: number | null;
  altitude: number | null;
  longName?: string | null;
  shortName?: string | null;
}

/** Apply override values only where a node has not supplied its own value. */
export function applyNodeOverrides<T extends OverrideableNode>(
  nodes: T[],
  overrides: Map<number, NodeOverride>,
): T[] {
  return nodes.map((node) => {
    const override = overrides.get(node.nodeId);
    if (!override) return node;
    return {
      ...node,
      latitude: node.latitude ?? override.latitude,
      longitude: node.longitude ?? override.longitude,
      altitude: node.altitude ?? override.altitude,
      longName: ("longName" in node ? node.longName : null) ?? override.aliasName ?? null,
      shortName: ("shortName" in node ? node.shortName : null) ?? null,
    };
  });
}
