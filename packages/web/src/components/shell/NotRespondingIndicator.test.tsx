import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotRespondingIndicator } from "./NotRespondingIndicator.js";

import type { DeviceInfo } from "@foreman/shared";

function device(name: string, notResponding: boolean): DeviceInfo {
  return {
    id: name,
    name,
    port: `/dev/${name}`,
    status: "connected",
    notResponding,
    connectedAt: null,
    lastSeenAt: null,
    hardwareModel: null,
    firmwareVersion: null,
    batteryLevel: null,
    hasGpsPosition: false,
    gpsDetail: null,
    ownNodeId: null,
  };
}

describe("NotRespondingIndicator", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onOpenDebug = vi.fn();

  function render(devices: DeviceInfo[]) {
    act(() => root.render(<NotRespondingIndicator devices={devices} onOpenDebug={onOpenDebug} />));
  }

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    onOpenDebug.mockClear();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("shows nothing for healthy radios", () => {
    render([device("Alpha", false)]);
    expect(container.textContent).toBe("");
  });

  it("names only the radios that are not responding", () => {
    render([device("Alpha", true), device("Bravo", false), device("Charlie", true)]);
    expect(container.textContent).toBe("Not responding: Alpha, Charlie");
  });

  it("clears when the radio answers again", () => {
    render([device("Alpha", true)]);
    render([device("Alpha", false)]);
    expect(container.textContent).toBe("");
  });

  it("opens the Debug page", () => {
    render([device("Alpha", true)]);
    act(() => container.querySelector("button")?.click());
    expect(onOpenDebug).toHaveBeenCalledOnce();
  });

  it("announces itself to screen readers", () => {
    render([device("Alpha", true)]);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
  });
});
