import { describe, expect, it } from "vitest";

import { formatNodeId, MODEM_PRESET_LABELS, resolveNodeName } from "./domain-utils.js";

describe("formatNodeId", () => {
  it("formats node IDs as lowercase, eight-digit, exclamation-prefixed hex", () => {
    expect(formatNodeId(0)).toBe("!00000000");
    expect(formatNodeId(0x1a2b)).toBe("!00001a2b");
    expect(formatNodeId(0xabcdef01)).toBe("!abcdef01");
    expect(formatNodeId(0x1a2b, 0)).toBe("!1a2b");
  });
});

describe("resolveNodeName", () => {
  it("uses long name, short name, then the formatted node ID by default", () => {
    expect(resolveNodeName(1, { longName: "Long", shortName: "SHRT" })).toBe("Long");
    expect(resolveNodeName(1, { longName: null, shortName: "SHRT" })).toBe("SHRT");
    expect(resolveNodeName(1, { longName: null, shortName: null })).toBe("!00000001");
  });

  it("preserves caller-specific source order, name preference, and fallback", () => {
    expect(
      resolveNodeName(
        1,
        [
          { longName: "Mesh Long", shortName: "MESH" },
          { longName: "MQTT Long", shortName: "MQTT" },
        ],
        { preference: ["shortName", "longName"] },
      ),
    ).toBe("MESH");
    expect(resolveNodeName(1, {}, { fallback: "Unknown" })).toBe("Unknown");
  });
});

describe("MODEM_PRESET_LABELS", () => {
  it("maps every supported modem preset to its canonical enum label", () => {
    expect(Object.entries(MODEM_PRESET_LABELS)).toEqual([
      ["0", "LONG_FAST"],
      ["1", "LONG_SLOW"],
      ["2", "VERY_LONG_SLOW"],
      ["3", "MEDIUM_SLOW"],
      ["4", "MEDIUM_FAST"],
      ["5", "SHORT_SLOW"],
      ["6", "SHORT_FAST"],
      ["7", "LONG_MODERATE"],
      ["8", "SHORT_TURBO"],
    ]);
  });
});
