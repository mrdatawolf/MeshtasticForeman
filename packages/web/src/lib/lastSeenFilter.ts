import { buildMergedNodes, lastHeardMs } from "./mergedNodes.js";

import type { MqttNode, NodeInfo } from "@foreman/shared";

export type LastSeenWindow = "week" | "month" | "quarter" | "year" | "all";

export const DEFAULT_LAST_SEEN_WINDOW: LastSeenWindow = "week";

export const LAST_SEEN_OPTIONS: ReadonlyArray<{
  value: LastSeenWindow;
  label: string;
  /** Oldest age shown, in days. Null means nothing is hidden. */
  days: number | null;
}> = [
  { value: "week", label: "Week", days: 7 },
  { value: "month", label: "Month", days: 30 },
  { value: "quarter", label: "Quarter", days: 90 },
  { value: "year", label: "Year", days: 365 },
  { value: "all", label: "All", days: null },
];

const STORAGE_KEY = "foreman_last_seen_window";
const DAY_MS = 86_400_000;

/** Read the remembered window, falling back to the default for any storage problem. */
export function loadLastSeenWindow(): LastSeenWindow {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const option = LAST_SEEN_OPTIONS.find(({ value }) => value === stored);
    return option?.value ?? DEFAULT_LAST_SEEN_WINDOW;
  } catch {
    return DEFAULT_LAST_SEEN_WINDOW;
  }
}

/** Remember the window. A storage failure only means the choice lasts until reload. */
export function saveLastSeenWindow(window: LastSeenWindow): void {
  try {
    localStorage.setItem(STORAGE_KEY, window);
  } catch {
    /* ignore */
  }
}

/**
 * IDs of the nodes the window hides. Pass the complete mesh and MQTT lists: a
 * node's age is the most recent of both, so judging from a partial list, such as
 * one narrowed by MQTT region scope, would hide nodes that are still being heard.
 * Nodes in `alwaysShownIds` are never hidden.
 */
export function findHiddenNodeIds(
  nodes: NodeInfo[],
  mqttNodes: MqttNode[],
  window: LastSeenWindow,
  nowMs: number,
  alwaysShownIds: ReadonlySet<number>,
): Set<number> {
  const hidden = new Set<number>();
  const days = LAST_SEEN_OPTIONS.find(({ value }) => value === window)?.days ?? null;
  if (days === null) return hidden;
  const cutoffMs = nowMs - days * DAY_MS;
  for (const merged of buildMergedNodes(nodes, mqttNodes)) {
    if (alwaysShownIds.has(merged.nodeId)) continue;
    const heardMs = lastHeardMs(merged);
    if (heardMs === 0 || heardMs < cutoffMs) hidden.add(merged.nodeId);
  }
  return hidden;
}

/** The list without hidden nodes. Keep the original list for name and position lookups. */
export function withoutHiddenNodes<T extends { nodeId: number }>(
  list: T[],
  hiddenIds: ReadonlySet<number>,
): T[] {
  return list.filter((node) => !hiddenIds.has(node.nodeId));
}

/** Nodes across the lists, counting a node in more than one list once. */
export function countUniqueNodes(...lists: Array<Array<{ nodeId: number }>>): number {
  return new Set(lists.flat().map((node) => node.nodeId)).size;
}
