import { afterEach, describe, expect, it, vi } from "vitest";

import {
  countUniqueNodes,
  findHiddenNodeIds,
  loadLastSeenWindow,
  saveLastSeenWindow,
  withoutHiddenNodes,
} from "./lastSeenFilter.js";

import type { LastSeenWindow } from "./lastSeenFilter.js";
import type { MqttNode, NodeInfo } from "@foreman/shared";

const NOW = Date.parse("2026-11-06T12:00:00.000Z");
const DAY_MS = 86_400_000;
const NO_PINS = new Set<number>();

function daysAgo(days: number): string {
  return new Date(NOW - days * DAY_MS).toISOString();
}

function meshNode(nodeId: number, lastHeard: string | null): NodeInfo {
  return {
    nodeId,
    longName: null,
    shortName: null,
    macAddress: null,
    hwModel: null,
    publicKey: null,
    lastHeard,
    snr: null,
    hopsAway: null,
    latitude: null,
    longitude: null,
    altitude: null,
  };
}

function mqttNode(nodeId: number, lastHeard: string | null): MqttNode {
  return {
    nodeId,
    longName: null,
    shortName: null,
    hwModel: null,
    publicKey: null,
    lastHeard,
    latitude: null,
    longitude: null,
    altitude: null,
    lastGateway: null,
    regionPath: null,
    channelName: null,
    snr: null,
    hopsAway: null,
    distanceM: null,
  };
}

function hiddenIds(
  nodes: NodeInfo[],
  mqttNodes: MqttNode[],
  window: LastSeenWindow,
  pinned: ReadonlySet<number> = NO_PINS,
  now = NOW,
): number[] {
  return [...findHiddenNodeIds(nodes, mqttNodes, window, now, pinned)].sort((a, b) => a - b);
}

describe("findHiddenNodeIds", () => {
  it.each<[LastSeenWindow, number]>([
    ["week", 7],
    ["month", 30],
    ["quarter", 90],
    ["year", 365],
  ])("%s keeps a node exactly %i days old and hides an older one", (window, days) => {
    const nodes = [
      meshNode(1, daysAgo(days)),
      meshNode(2, new Date(NOW - days * DAY_MS - 1).toISOString()),
    ];
    expect(hiddenIds(nodes, [], window)).toEqual([2]);
  });

  it("hides nothing under All, including very old nodes and nodes with no time", () => {
    const nodes = [meshNode(1, daysAgo(4000)), meshNode(2, null)];
    expect(hiddenIds(nodes, [mqttNode(3, null)], "all")).toEqual([]);
  });

  it.each<LastSeenWindow>(["week", "month", "quarter", "year"])(
    "hides nodes with no last-heard time under %s",
    (window) => {
      const nodes = [meshNode(1, null)];
      expect(hiddenIds(nodes, [mqttNode(2, null)], window)).toEqual([1, 2]);
    },
  );

  it("treats an unparsable time as no time", () => {
    expect(hiddenIds([meshNode(1, "not a date")], [], "year")).toEqual([1]);
  });

  it("keeps a node with an unparsable mesh time and a recent MQTT time", () => {
    const nodes = [meshNode(1, "not a date")];
    expect(hiddenIds(nodes, [mqttNode(1, daysAgo(1))], "week")).toEqual([]);
  });

  it("keeps a node with a stale mesh time and a recent MQTT time", () => {
    const nodes = [meshNode(1, daysAgo(200))];
    const mqtt = [mqttNode(1, daysAgo(1))];
    expect(hiddenIds(nodes, mqtt, "week")).toEqual([]);
  });

  it("keeps a node with a recent mesh time and a stale MQTT time", () => {
    const nodes = [meshNode(1, daysAgo(1))];
    const mqtt = [mqttNode(1, daysAgo(200))];
    expect(hiddenIds(nodes, mqtt, "week")).toEqual([]);
  });

  it("hides a node when both of its times are stale", () => {
    const nodes = [meshNode(1, daysAgo(10))];
    const mqtt = [mqttNode(1, daysAgo(20))];
    expect(hiddenIds(nodes, mqtt, "week")).toEqual([1]);
  });

  it("never hides an always-shown node", () => {
    const nodes = [meshNode(1, daysAgo(500)), meshNode(2, null)];
    expect(hiddenIds(nodes, [], "week", new Set([1, 2]))).toEqual([]);
  });

  it("shows a hidden node again once a newer time arrives", () => {
    expect(hiddenIds([meshNode(1, daysAgo(10))], [], "week")).toEqual([1]);
    expect(hiddenIds([meshNode(1, daysAgo(0))], [], "week")).toEqual([]);
  });

  it("ages a node out as time passes with no new data", () => {
    const nodes = [meshNode(1, daysAgo(6))];
    expect(hiddenIds(nodes, [], "week")).toEqual([]);
    expect(hiddenIds(nodes, [], "week", NO_PINS, NOW + 2 * DAY_MS)).toEqual([1]);
  });
});

describe("withoutHiddenNodes", () => {
  it("removes a node from each list so it stays one row or disappears entirely", () => {
    const hidden = findHiddenNodeIds(
      [meshNode(1, daysAgo(1)), meshNode(2, daysAgo(9))],
      [mqttNode(1, daysAgo(9)), mqttNode(2, daysAgo(9))],
      "week",
      NOW,
      NO_PINS,
    );
    const mesh = withoutHiddenNodes([meshNode(1, null), meshNode(2, null)], hidden);
    const mqtt = withoutHiddenNodes([mqttNode(1, null), mqttNode(2, null)], hidden);
    expect(mesh.map((n) => n.nodeId)).toEqual([1]);
    expect(mqtt.map((n) => n.nodeId)).toEqual([1]);
  });

  it("does not change the list it was given, so lookups stay complete", () => {
    const list = [meshNode(1, null), meshNode(2, null)];
    withoutHiddenNodes(list, new Set([1]));
    expect(list).toHaveLength(2);
  });
});

describe("countUniqueNodes", () => {
  it("counts a node in both lists once", () => {
    expect(countUniqueNodes([{ nodeId: 1 }, { nodeId: 2 }], [{ nodeId: 2 }, { nodeId: 3 }])).toBe(
      3,
    );
  });
});

describe("remembered choice", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("defaults to week on first use", () => {
    expect(loadLastSeenWindow()).toBe("week");
  });

  it("returns a saved choice", () => {
    saveLastSeenWindow("quarter");
    expect(loadLastSeenWindow()).toBe("quarter");
  });

  it.each(["fortnight", "", "__proto__", "null"])("ignores the invalid value %j", (value) => {
    localStorage.setItem("foreman_last_seen_window", value);
    expect(loadLastSeenWindow()).toBe("week");
  });

  it("falls back to week when reading storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    expect(loadLastSeenWindow()).toBe("week");
  });

  it("does not throw when writing storage throws", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    expect(() => saveLastSeenWindow("year")).not.toThrow();
  });
});
