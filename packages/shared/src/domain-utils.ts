export function formatNodeId(nodeId: number, minimumLength = 8): string {
  return `!${nodeId.toString(16).padStart(minimumLength, "0")}`;
}

export interface NodeNameSource {
  longName?: string | null;
  shortName?: string | null;
}

export interface ResolveNodeNameOptions {
  preference?: readonly (keyof NodeNameSource)[];
  fallback?: string;
}

export function resolveNodeName(
  nodeId: number,
  sources: NodeNameSource | readonly NodeNameSource[],
  options: ResolveNodeNameOptions = {},
): string {
  const candidates = Array.isArray(sources) ? sources : [sources];
  const preference = options.preference ?? (["longName", "shortName"] as const);

  for (const source of candidates) {
    for (const field of preference) {
      const value = source[field];
      if (value) return value;
    }
  }

  return options.fallback ?? formatNodeId(nodeId);
}

export const MODEM_PRESET_LABELS: Readonly<Record<number, string>> = {
  0: "LONG_FAST",
  1: "LONG_SLOW",
  2: "VERY_LONG_SLOW",
  3: "MEDIUM_SLOW",
  4: "MEDIUM_FAST",
  5: "SHORT_SLOW",
  6: "SHORT_FAST",
  7: "LONG_MODERATE",
  8: "SHORT_TURBO",
};
