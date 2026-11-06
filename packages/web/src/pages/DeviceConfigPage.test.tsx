import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DeviceConfigPage } from "./DeviceConfigPage.js";

import type { DeviceConfig, DeviceInfo } from "@foreman/shared";

function device(overrides: Partial<DeviceInfo> & { id: string }): DeviceInfo {
  return {
    name: "Radio",
    port: `/dev/${overrides.id}`,
    status: "connected",
    connectedAt: null,
    lastSeenAt: null,
    hardwareModel: null,
    firmwareVersion: null,
    batteryLevel: null,
    hasGpsPosition: false,
    gpsDetail: null,
    ownNodeId: null,
    ...overrides,
  };
}

function renderPage(devices: DeviceInfo[], configs = new Map<string, DeviceConfig>()) {
  const container = document.createElement("div");
  container.innerHTML = renderToStaticMarkup(
    <DeviceConfigPage devices={devices} configs={configs} />,
  );
  return {
    label: container.querySelector("dt")?.textContent,
    value: container.querySelector("dd")?.textContent,
    text: container.textContent,
  };
}

describe("DeviceConfigPage firmware version", () => {
  it("shows the version before any config has been received", () => {
    const page = renderPage([device({ id: "a", firmwareVersion: "2.7.15" })]);

    expect(page.text).toContain("No config received yet");
    expect(page.value).toBe("2.7.15");
  });

  it("shows the version alongside a received config", () => {
    const config = { radioConfig: {}, moduleConfig: {}, channels: [] } as unknown as DeviceConfig;
    const page = renderPage(
      [device({ id: "a", firmwareVersion: "2.7.15" })],
      new Map([["a", config]]),
    );

    expect(page.text).toContain("Setup Wizard");
    expect(page.value).toBe("2.7.15");
  });

  it("matches the selected device when several are present", () => {
    const page = renderPage([
      device({ id: "a", status: "disconnected", firmwareVersion: "2.5.0" }),
      device({ id: "b", firmwareVersion: "2.7.15" }),
    ]);

    expect(page.label).toBe("Firmware version");
    expect(page.value).toBe("2.7.15");
  });

  it("says when the version is unknown", () => {
    expect(renderPage([device({ id: "a" })]).value).toBe("Not reported yet");
  });

  it("shows nothing when no device is selected", () => {
    expect(renderPage([device({ id: "a", status: "disconnected" })]).value).toBeUndefined();
  });
});
