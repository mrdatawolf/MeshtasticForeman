import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DeviceMenu } from "./DeviceMenu.js";
import { GpsMenu } from "./GpsMenu.js";

import type { Tab } from "./types.js";
import type { DeviceInfo } from "@foreman/shared";
import type { ComponentProps, ReactNode } from "react";

const RECONNECT_ADVICE = /reconnect/i;

function device(overrides: Partial<DeviceInfo> & { id: string }): DeviceInfo {
  return {
    name: "Radio",
    port: `/dev/${overrides.id}`,
    status: "connected",
    notResponding: false,
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

describe("not responding in the header menus", () => {
  let container: HTMLDivElement;
  let root: Root;

  const render = (element: ReactNode) => act(() => root.render(element));
  const buttonNamed = (name: string) =>
    [...container.querySelectorAll("button")].find((button) => button.textContent?.includes(name));
  const click = (name: string) => act(() => buttonNamed(name)?.click());
  /** The device menu's text for one device. Class names are not stable in tests. */
  const entryText = (port: string) => {
    const label = [...container.querySelectorAll("span")].find((el) => el.textContent === port);
    return label?.parentElement?.parentElement?.textContent;
  };

  const deviceMenu = (devices: DeviceInfo[], onNavigate: (tab: Tab) => void = () => {}) =>
    ({
      connected: true,
      devices,
      activity: [],
      logs: [],
      tab: "nodes",
      showMesh: true,
      setShowMesh: () => {},
      showMqtt: true,
      setShowMqtt: () => {},
      mappableMeshCount: 0,
      mappableMqttCount: 0,
      activityWindow: "5m",
      setActivityWindow: () => {},
      activitySource: "all",
      setActivitySource: () => {},
      activityPaused: false,
      setActivityPaused: () => {},
      logsLevel: "all",
      setLogsLevel: () => {},
      logsTag: "all",
      setLogsTag: () => {},
      logsPaused: false,
      setLogsPaused: () => {},
      logTagCounts: {},
      onNavigate,
      onOpenApiDocs: () => {},
    }) satisfies ComponentProps<typeof DeviceMenu>;

  const renderGpsMenu = (devices: DeviceInfo[], onOpenDebug: () => void = () => {}) => {
    render(
      <GpsMenu
        devices={devices}
        pending={new Set()}
        setPending={() => {}}
        onOpenDebug={onOpenDebug}
      />,
    );
    click("GPS");
  };

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("__APP_VERSION__", "0.0.0");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  describe("device menu", () => {
    it("shows not responding in place of connected", () => {
      render(<DeviceMenu {...deviceMenu([device({ id: "a", notResponding: true })])} />);
      click("API");

      expect(entryText("/dev/a")).toContain("not responding");
      expect(entryText("/dev/a")).not.toContain("connected");
    });

    it("shows not responding in place of connecting", () => {
      render(
        <DeviceMenu
          {...deviceMenu([device({ id: "a", status: "connecting", notResponding: true })])}
        />,
      );
      click("API");

      expect(entryText("/dev/a")).toContain("not responding");
      expect(entryText("/dev/a")).not.toContain("connecting");
    });

    it("shows nothing extra for a responding radio", () => {
      render(<DeviceMenu {...deviceMenu([device({ id: "a" })])} />);
      click("API");

      expect(entryText("/dev/a")).toContain("connected");
      expect(entryText("/dev/a")).not.toContain("not responding");
      expect(buttonNamed("Open Debug page")).toBeUndefined();
    });

    it("clears when a new status arrives", () => {
      render(<DeviceMenu {...deviceMenu([device({ id: "a", notResponding: true })])} />);
      click("API");

      render(<DeviceMenu {...deviceMenu([device({ id: "a" })])} />);

      expect(container.textContent).not.toContain("not responding");
    });

    it("links to the Debug page and closes", () => {
      const onNavigate = vi.fn();
      render(
        <DeviceMenu {...deviceMenu([device({ id: "a", notResponding: true })], onNavigate)} />,
      );
      click("API");

      click("Open Debug page");

      expect(onNavigate).toHaveBeenCalledWith("debug");
      expect(buttonNamed("Open Debug page")).toBeUndefined();
    });

    it("shows each device's own state", () => {
      render(
        <DeviceMenu
          {...deviceMenu([device({ id: "hung", notResponding: true }), device({ id: "healthy" })])}
        />,
      );
      click("API");

      expect(entryText("/dev/hung")).toContain("not responding");
      expect(entryText("/dev/healthy")).not.toContain("not responding");
    });
  });

  describe("GPS menu", () => {
    it("does not suggest reconnecting when the radio is not responding", () => {
      renderGpsMenu([device({ id: "a", notResponding: true, ownNodeId: null })]);

      expect(container.textContent).toContain("Radio not responding");
      expect(container.textContent).not.toMatch(RECONNECT_ADVICE);
    });

    it("keeps the node ID hint for a radio that is responding", () => {
      renderGpsMenu([device({ id: "a", ownNodeId: null })]);

      expect(container.textContent).toMatch(RECONNECT_ADVICE);
      expect(container.textContent).not.toContain("Radio not responding");
    });

    it("explains the state even when the node ID is known", () => {
      renderGpsMenu([device({ id: "a", notResponding: true, ownNodeId: 123 })]);

      expect(container.textContent).toContain("Radio not responding");
    });

    it("links to the Debug page and closes", () => {
      const onOpenDebug = vi.fn();
      renderGpsMenu([device({ id: "a", notResponding: true })], onOpenDebug);

      click("Open Debug page");

      expect(onOpenDebug).toHaveBeenCalledOnce();
      expect(buttonNamed("Open Debug page")).toBeUndefined();
    });

    it("shows each device's own state", () => {
      renderGpsMenu([
        device({ id: "hung", notResponding: true }),
        device({ id: "healthy", ownNodeId: 1 }),
      ]);

      expect(container.textContent?.match(/Radio not responding/g)).toHaveLength(1);
    });
  });
});
