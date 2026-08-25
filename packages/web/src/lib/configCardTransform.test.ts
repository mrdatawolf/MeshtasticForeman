import { describe, expect, it } from "vitest";

import {
  applyDraftEdit,
  buildConfigCardSetConfigPayload,
  currentFieldValue,
} from "./configCardTransform.js";

describe("applyDraftEdit", () => {
  it("accumulates a new key without dropping previously-drafted keys", () => {
    const draft = { modemPreset: 2 };
    expect(applyDraftEdit(draft, "region", 1)).toEqual({ modemPreset: 2, region: 1 });
  });

  it("replaces an earlier edit to the same key rather than merging it", () => {
    const draft = { region: 1 };
    expect(applyDraftEdit(draft, "region", 3)).toEqual({ region: 3 });
  });

  it("does not mutate the original draft", () => {
    const draft = { region: 1 };
    applyDraftEdit(draft, "modemPreset", 2);
    expect(draft).toEqual({ region: 1 });
  });

  it("records falsy edited values (false, 0, empty string) rather than dropping them", () => {
    expect(applyDraftEdit({}, "enabled", false)).toEqual({ enabled: false });
    expect(applyDraftEdit({}, "updateInterval", 0)).toEqual({ updateInterval: 0 });
    expect(applyDraftEdit({}, "root", "")).toEqual({ root: "" });
  });
});

describe("currentFieldValue", () => {
  const data = { region: 1, modemPreset: 0 };

  it("returns the live data value when the key has no pending draft edit", () => {
    expect(currentFieldValue({}, data, "region")).toBe(1);
  });

  it("returns the pending draft edit when present, even if falsy", () => {
    expect(currentFieldValue({ region: 0 }, data, "region")).toBe(0);
  });

  it("prefers the draft over the live value when both are present", () => {
    expect(currentFieldValue({ region: 6 }, data, "region")).toBe(6);
  });
});

describe("buildConfigCardSetConfigPayload", () => {
  it("returns null for an empty draft (no write on a no-op save)", () => {
    expect(buildConfigCardSetConfigPayload("device-1", "radio", "lora", {})).toBeNull();
  });

  it("builds a payload containing only the edited keys, not the section's full contents", () => {
    expect(
      buildConfigCardSetConfigPayload("device-1", "radio", "lora", { modemPreset: 3 }),
    ).toEqual({
      deviceId: "device-1",
      namespace: "radio",
      section: "lora",
      value: { modemPreset: 3 },
    });
  });

  it("preserves deviceId/namespace/section verbatim alongside a multi-key draft", () => {
    expect(
      buildConfigCardSetConfigPayload("device-2", "module", "mqtt", {
        enabled: true,
        address: "mqtt.example",
      }),
    ).toEqual({
      deviceId: "device-2",
      namespace: "module",
      section: "mqtt",
      value: { enabled: true, address: "mqtt.example" },
    });
  });
});
