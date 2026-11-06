import type { MqttNode, NodeInfo } from "@foreman/shared";

/** One physical node, combining its mesh and MQTT records when it has both. */
export interface MergedNode {
  nodeId: number;
  mesh: NodeInfo | null;
  mqtt: MqttNode | null;
}

export function buildMergedNodes(nodes: NodeInfo[], mqttNodes: MqttNode[]): MergedNode[] {
  const map = new Map<number, MergedNode>();
  for (const n of nodes) map.set(n.nodeId, { nodeId: n.nodeId, mesh: n, mqtt: null });
  for (const n of mqttNodes) {
    const existing = map.get(n.nodeId);
    if (existing) {
      existing.mqtt = n;
    } else {
      map.set(n.nodeId, { nodeId: n.nodeId, mesh: null, mqtt: n });
    }
  }
  return [...map.values()];
}

/** Epoch milliseconds for a last-heard value, or 0 when it is missing or unparsable. */
function heardMs(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? 0 : ms;
}

/** The most recent of a merged node's mesh and MQTT times, or 0 if it has neither. */
export function lastHeardMs(m: MergedNode): number {
  return Math.max(heardMs(m.mesh?.lastHeard), heardMs(m.mqtt?.lastHeard));
}

/**
 * The single "true last heard" timestamp for a merged node: whichever of its
 * mesh/MQTT sources is more recent, as an ISO string. Used for both the
 * displayed "Last Heard" column and the `lastHeard` sort key so the two never
 * disagree (see TASK-045). This is distinct from `mqtt.lastHeard`, which is
 * still shown on its own, unchanged, in the MQTT sub-row.
 */
export function resolvedLastHeard(m: MergedNode): string | null {
  const meshMs = heardMs(m.mesh?.lastHeard);
  const mqttMs = heardMs(m.mqtt?.lastHeard);
  if (meshMs === 0 && mqttMs === 0) return null;
  return mqttMs > meshMs ? m.mqtt!.lastHeard : m.mesh!.lastHeard;
}
