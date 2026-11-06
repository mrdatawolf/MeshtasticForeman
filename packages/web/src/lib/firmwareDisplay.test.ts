import { describe, expect, it } from "vitest";

import { firmwareDisplay } from "./firmwareDisplay.js";

describe("firmwareDisplay", () => {
  it("shows a connected radio's version as current", () => {
    expect(firmwareDisplay({ status: "connected", firmwareVersion: "2.7.15.567b8ea" })).toEqual({
      label: "Firmware version",
      value: "2.7.15.567b8ea",
      known: true,
    });
  });

  it.each(["disconnected", "connecting", "error"] as const)(
    "labels the saved version as last reported while %s",
    (status) => {
      expect(firmwareDisplay({ status, firmwareVersion: "2.7.15" })).toEqual({
        label: "Firmware version (last reported)",
        value: "2.7.15",
        known: true,
      });
    },
  );

  it.each([null, "", "   "])("says not reported for %j", (firmwareVersion) => {
    expect(firmwareDisplay({ status: "connected", firmwareVersion })).toEqual({
      label: "Firmware version",
      value: "Not reported yet",
      known: false,
    });
  });

  it("does not call an unknown version last reported on a disconnected radio", () => {
    expect(firmwareDisplay({ status: "disconnected", firmwareVersion: null }).label).toBe(
      "Firmware version",
    );
  });
});
