import { describe, expect, it } from "vitest";

import { mergeSelectedRegionSettings, type RegionNode } from "./regionMerge.js";
import { buildWizardChanges } from "./setupWizardOutput.js";

// Fixtures mirror region-presets.json's shipped US -> US-CA -> US-CA-Humboldt chain,
// which CONTRACT-012 names as the region-merge collision case to validate.
const US: RegionNode = {
  id: "US",
  label: "United States",
  settings: { radio: { lora: { region: 1 } } },
};
const US_CA: RegionNode = {
  id: "US-CA",
  label: "California",
  settings: { radio: { device: { tzdef: "PST8PDT,M3.2.0/2:00:00,M11.1.0/2:00:00" } } },
};
const US_CA_HUMBOLDT: RegionNode = {
  id: "US-CA-Humboldt",
  label: "Humboldt County",
  settings: {
    radio: { lora: { modemPreset: 0 } },
    module: { mqtt: { root: "msh/US/CA/Humboldt/Eureka" } },
  },
};
const NAV_ONLY_REGION: RegionNode = { id: "US-generic", label: "Other US region" };

describe("mergeSelectedRegionSettings", () => {
  it("folds root-to-leaf, letting the leaf-most region win on key collisions", () => {
    expect(mergeSelectedRegionSettings([US, US_CA, US_CA_HUMBOLDT])).toEqual({
      radio: {
        lora: { region: 1, modemPreset: 0 },
        device: { tzdef: "PST8PDT,M3.2.0/2:00:00,M11.1.0/2:00:00" },
      },
      module: { mqtt: { root: "msh/US/CA/Humboldt/Eureka" } },
    });
  });

  it("skips a region node with no settings (a purely navigational node)", () => {
    expect(mergeSelectedRegionSettings([US, NAV_ONLY_REGION])).toEqual({
      radio: { lora: { region: 1 } },
    });
  });

  it("returns {} for an empty selection", () => {
    expect(mergeSelectedRegionSettings([])).toEqual({});
  });
});

describe("mergeSelectedRegionSettings composed with buildWizardChanges", () => {
  // These two cases are CONTRACT-012's named payload-equivalence validation matrix:
  // (a) a multi-level region breadcrumb, and (b) a role+region same-section collision.
  it("(a) produces the ordered device:set-config payload for a multi-level region breadcrumb", () => {
    const merged = mergeSelectedRegionSettings([US, US_CA, US_CA_HUMBOLDT]);
    const changes = buildWizardChanges(
      null,
      merged,
      { enabled: false, address: "", user: "", pass: "" },
      false,
      false,
    );
    expect(changes).toEqual([
      { namespace: "radio", section: "lora", value: { region: 1, modemPreset: 0 } },
      {
        namespace: "radio",
        section: "device",
        value: { tzdef: "PST8PDT,M3.2.0/2:00:00,M11.1.0/2:00:00" },
      },
      { namespace: "module", section: "mqtt", value: { root: "msh/US/CA/Humboldt/Eureka" } },
    ]);
  });

  it("(b) shallow-merges a role selection with a region collision on the same section (radio.device)", () => {
    const merged = mergeSelectedRegionSettings([US, US_CA]);
    const changes = buildWizardChanges(
      0,
      merged,
      { enabled: false, address: "", user: "", pass: "" },
      false,
      false,
    );
    expect(changes).toEqual([
      {
        namespace: "radio",
        section: "device",
        value: { role: 0, tzdef: "PST8PDT,M3.2.0/2:00:00,M11.1.0/2:00:00" },
      },
      { namespace: "radio", section: "lora", value: { region: 1 } },
    ]);
  });
});
