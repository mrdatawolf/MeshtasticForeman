import { describe, expect, it } from "vitest";

import { buildMergedNodes, resolvedLastHeard, sortMerged } from "./NodesPage.js";

import type { MqttNode, NodeInfo } from "@foreman/shared";

function meshNode(overrides: Partial<NodeInfo> & { nodeId: number }): NodeInfo {
  return {
    longName: null,
    shortName: null,
    macAddress: null,
    hwModel: null,
    publicKey: null,
    lastHeard: null,
    snr: null,
    hopsAway: null,
    latitude: null,
    longitude: null,
    altitude: null,
    ...overrides,
  };
}

function mqttNode(overrides: Partial<MqttNode> & { nodeId: number }): MqttNode {
  return {
    longName: null,
    shortName: null,
    hwModel: null,
    publicKey: null,
    lastHeard: null,
    latitude: null,
    longitude: null,
    altitude: null,
    lastGateway: null,
    regionPath: null,
    channelName: null,
    snr: null,
    hopsAway: null,
    distanceM: null,
    ...overrides,
  };
}

describe("resolvedLastHeard (TASK-045)", () => {
  it("resolves to the fresher MQTT time for a matched node with a stale mesh time", () => {
    const merged = {
      nodeId: 1,
      mesh: meshNode({ nodeId: 1, lastHeard: "2026-07-08T00:00:00.000Z" }), // ~48 days stale
      mqtt: mqttNode({ nodeId: 1, lastHeard: "2026-08-26T11:59:04.000Z" }), // 56s ago
    };
    expect(resolvedLastHeard(merged)).toBe("2026-08-26T11:59:04.000Z");
  });

  it("resolves to the mesh time when mesh is fresher than MQTT", () => {
    const merged = {
      nodeId: 2,
      mesh: meshNode({ nodeId: 2, lastHeard: "2026-08-26T11:59:30.000Z" }),
      mqtt: mqttNode({ nodeId: 2, lastHeard: "2026-08-20T00:00:00.000Z" }),
    };
    expect(resolvedLastHeard(merged)).toBe("2026-08-26T11:59:30.000Z");
  });

  it("falls back to whichever single source is present", () => {
    const meshOnly = {
      nodeId: 3,
      mesh: meshNode({ nodeId: 3, lastHeard: "2026-08-26T00:00:00.000Z" }),
      mqtt: null,
    };
    const mqttOnly = {
      nodeId: 4,
      mesh: null,
      mqtt: mqttNode({ nodeId: 4, lastHeard: "2026-08-25T00:00:00.000Z" }),
    };
    expect(resolvedLastHeard(meshOnly)).toBe("2026-08-26T00:00:00.000Z");
    expect(resolvedLastHeard(mqttOnly)).toBe("2026-08-25T00:00:00.000Z");
  });

  it("returns null when neither source has a last-heard time", () => {
    const merged = { nodeId: 5, mesh: meshNode({ nodeId: 5 }), mqtt: null };
    expect(resolvedLastHeard(merged)).toBeNull();
  });
});

describe("sortMerged by lastHeard agrees with resolvedLastHeard (TASK-045)", () => {
  it("sorts a matched node by its fresh MQTT time rather than its stale mesh time", () => {
    // Reproduces the reported screenshot: a matched node whose mesh.lastHeard
    // is ~48 days stale but whose mqtt.lastHeard is 56s ago should sort as the
    // most-recently-heard node, and its resolved display value should agree.
    const staleMeshFreshMqtt: NodeInfo & { __mqtt?: never } = meshNode({
      nodeId: 100,
      lastHeard: "2026-07-08T00:00:00.000Z",
    });
    const nodes: NodeInfo[] = [
      staleMeshFreshMqtt,
      meshNode({ nodeId: 200, lastHeard: "2026-08-26T11:14:00.000Z" }), // 45m ago
      meshNode({ nodeId: 300, lastHeard: "2026-08-26T11:36:00.000Z" }), // 23m ago
    ];
    const mqttNodes: MqttNode[] = [
      mqttNode({ nodeId: 100, lastHeard: "2026-08-26T11:59:04.000Z" }), // 56s ago — freshest overall
    ];

    const merged = buildMergedNodes(nodes, mqttNodes);
    const sortedDesc = sortMerged(merged, "lastHeard", "desc", new Map());

    // Most-recently-heard first: node 100 (via MQTT), then 300, then 200.
    expect(sortedDesc.map((m) => m.nodeId)).toEqual([100, 300, 200]);

    // The value used for sorting the top row must be the same value the UI
    // will display for it — the resolved (max of mesh/MQTT) timestamp, not
    // unconditionally the mesh timestamp.
    expect(resolvedLastHeard(sortedDesc[0])).toBe("2026-08-26T11:59:04.000Z");
    expect(resolvedLastHeard(sortedDesc[0])).not.toBe(sortedDesc[0].mesh?.lastHeard);
  });
});
