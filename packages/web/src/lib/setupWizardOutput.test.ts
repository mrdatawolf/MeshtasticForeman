import { describe, expect, it } from "vitest";

import { buildWizardChanges } from "./setupWizardOutput.js";

describe("buildWizardChanges", () => {
  it("constructs the complete ordered wizard output", () => {
    expect(
      buildWizardChanges(
        2,
        {
          radio: { lora: { region: 1, modemPreset: 0 } },
          module: { mqtt: { mapReportingEnabled: true } },
        },
        { enabled: true, address: "mqtt.example", user: "mesh", pass: "secret" },
        true,
        true,
      ),
    ).toEqual([
      { namespace: "radio", section: "device", value: { role: 2 } },
      { namespace: "radio", section: "lora", value: { region: 1, modemPreset: 0 } },
      {
        namespace: "module",
        section: "mqtt",
        value: {
          mapReportingEnabled: true,
          enabled: true,
          encryptionEnabled: true,
          proxyToClientEnabled: true,
          address: "mqtt.example",
          username: "mesh",
          password: "secret",
        },
      },
      {
        namespace: "module",
        section: "neighborInfo",
        value: { enabled: true, updateInterval: 900 },
      },
      {
        namespace: "module",
        section: "storeForward",
        value: { enabled: true, isServer: true, heartbeat: true },
      },
    ]);
  });

  it("omits unselected options and blank MQTT credentials", () => {
    expect(
      buildWizardChanges(
        null,
        {},
        { enabled: true, address: "", user: "", pass: "" },
        false,
        false,
      ),
    ).toEqual([
      {
        namespace: "module",
        section: "mqtt",
        value: { enabled: true, encryptionEnabled: true, proxyToClientEnabled: true },
      },
    ]);
  });

  it("returns no changes when the wizard has no selections", () => {
    expect(
      buildWizardChanges(
        null,
        {},
        { enabled: false, address: "ignored", user: "ignored", pass: "ignored" },
        false,
        false,
      ),
    ).toEqual([]);
  });
});
