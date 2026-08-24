import { describe, expect, it } from "vitest";

import { applyNodeOverrides } from "./nodeOverrides.js";

import type { NodeOverride } from "@foreman/shared";

const override: NodeOverride = {
  nodeId: 1,
  aliasName: "Fallback",
  latitude: 40,
  longitude: -124,
  altitude: 100,
  notes: null,
};

describe("applyNodeOverrides", () => {
  it("fills missing node values from an override", () => {
    const [result] = applyNodeOverrides(
      [{ nodeId: 1, latitude: null, longitude: null, altitude: null, longName: null, shortName: null }],
      new Map([[1, override]]),
    );

    expect(result).toEqual({
      nodeId: 1,
      latitude: 40,
      longitude: -124,
      altitude: 100,
      longName: "Fallback",
      shortName: null,
    });
  });

  it("gives node-supplied values precedence over overrides", () => {
    const node = {
      nodeId: 1,
      latitude: 41,
      longitude: -123,
      altitude: 200,
      longName: "Broadcast",
      shortName: "BC",
    };

    expect(applyNodeOverrides([node], new Map([[1, override]]))).toEqual([node]);
  });

  it("returns the original node reference when no override exists", () => {
    const node = { nodeId: 2, latitude: null, longitude: null, altitude: null };
    expect(applyNodeOverrides([node], new Map([[1, override]]))[0]).toBe(node);
  });
});
