import { describe, expect, it } from "vitest";

import { mergeConfig } from "./configMerge.js";

describe("mergeConfig", () => {
  it("preserves nested defaults while applying nested overrides", () => {
    const defaults = {
      radio: { lora: { region: 1, modemPreset: 0 }, device: { role: 0 } },
      module: { mqtt: { enabled: false } },
    };
    const overrides = { radio: { lora: { modemPreset: 2 } } };

    expect(mergeConfig(defaults, overrides)).toEqual({
      radio: { lora: { region: 1, modemPreset: 2 }, device: { role: 0 } },
      module: { mqtt: { enabled: false } },
    });
  });

  it("replaces arrays, scalars, and null values instead of merging them", () => {
    expect(
      mergeConfig(
        { channels: [1, 2], value: "default", optional: { enabled: true } },
        { channels: [3], value: 0, optional: null },
      ),
    ).toEqual({ channels: [3], value: 0, optional: null });
  });

  it("does not mutate either input", () => {
    const defaults = { nested: { one: 1 } };
    const overrides = { nested: { two: 2 } };
    mergeConfig(defaults, overrides);
    expect(defaults).toEqual({ nested: { one: 1 } });
    expect(overrides).toEqual({ nested: { two: 2 } });
  });
});
