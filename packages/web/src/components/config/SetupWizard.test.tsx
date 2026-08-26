import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { SetupWizard } from "./SetupWizard.js";

import type { ServerEvent } from "@foreman/shared";

const client = vi.hoisted(() => ({
  handler: undefined as ((event: ServerEvent) => void) | undefined,
  send: vi.fn(),
  on: vi.fn((handler: (event: ServerEvent) => void) => {
    client.handler = handler;
    return () => {
      client.handler = undefined;
    };
  }),
  emit: (event: ServerEvent) => client.handler?.(event),
}));

vi.mock("../../ws/client.js", () => ({ foremanClient: client }));

beforeAll(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  client.handler = undefined;
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function clickButton(label: string) {
  const button = [...(container?.querySelectorAll("button") ?? [])].find((candidate) =>
    candidate.textContent?.trim().startsWith(label),
  );
  expect(button).toBeDefined();
  act(() => button?.click());
}

describe("SetupWizard", () => {
  it("ignores config completion events for another device while apply is pending", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          regions: [{ id: "us", label: "United States", settings: { lora: { region: 1 } } }],
        }),
      }),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(<SetupWizard deviceId="device-1" onClose={vi.fn()} />));
    await act(async () => Promise.resolve());
    clickButton("Client");
    clickButton("Next →");

    const regionButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("United States"),
    );
    expect(regionButton).toBeDefined();
    act(() => regionButton?.click());
    clickButton("Next →");
    clickButton("Review →");
    clickButton("Apply to device");

    act(() => {
      client.emit({
        type: "device:config",
        payload: { deviceId: "device-2", radioConfig: {}, moduleConfig: {}, channels: [] },
      });
    });

    expect(container.textContent).toContain("Applying…");
    expect(container.textContent).not.toContain("Config applied");
    expect(client.handler).toBeDefined();
  });

  it("completes apply for a config event from the target device", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          regions: [{ id: "us", label: "United States", settings: { lora: { region: 1 } } }],
        }),
      }),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(<SetupWizard deviceId="device-1" onClose={vi.fn()} />));
    await act(async () => Promise.resolve());
    clickButton("Client");
    clickButton("Next →");

    const regionButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("United States"),
    );
    expect(regionButton).toBeDefined();
    act(() => regionButton?.click());
    clickButton("Next →");
    clickButton("Review →");
    clickButton("Apply to device");

    act(() => {
      client.emit({
        type: "device:config",
        payload: { deviceId: "device-1", radioConfig: {}, moduleConfig: {}, channels: [] },
      });
    });

    expect(container.textContent).toContain("Config applied");
    expect(container.textContent).not.toContain("Applying…");
  });

  it("surfaces SET_CONFIG_FAILED as a full apply failure and allows retry", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          regions: [{ id: "us", label: "United States", settings: { lora: { region: 1 } } }],
        }),
      }),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(<SetupWizard deviceId="device-1" onClose={vi.fn()} />));
    await act(async () => Promise.resolve());
    clickButton("Client");
    clickButton("Next →");

    const regionButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("United States"),
    );
    expect(regionButton).toBeDefined();
    act(() => regionButton?.click());
    clickButton("Next →");
    clickButton("Review →");
    clickButton("Apply to device");

    expect(client.send).toHaveBeenCalled();
    expect(client.handler).toBeDefined();

    act(() => {
      client.emit({
        type: "error",
        payload: { code: "SET_CONFIG_FAILED", message: "device rejected config" },
      });
      client.emit({
        type: "device:config",
        payload: { deviceId: "device-1", radioConfig: {}, moduleConfig: {}, channels: [] },
      });
    });

    expect(container.textContent).toContain("Apply failed — check device connection and try again");
    expect(container.textContent).toContain("Apply to device");
    expect(container.textContent).not.toContain("Config applied");
  });

  it("lets SET_CONFIG_FAILED override an earlier config success event", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          regions: [{ id: "us", label: "United States", settings: { lora: { region: 1 } } }],
        }),
      }),
    );
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => root?.render(<SetupWizard deviceId="device-1" onClose={vi.fn()} />));
    await act(async () => Promise.resolve());
    clickButton("Client");
    clickButton("Next →");

    const regionButton = [...container.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("United States"),
    );
    expect(regionButton).toBeDefined();
    act(() => regionButton?.click());
    clickButton("Next →");
    clickButton("Review →");
    clickButton("Apply to device");

    act(() => {
      client.emit({
        type: "device:config",
        payload: { deviceId: "device-1", radioConfig: {}, moduleConfig: {}, channels: [] },
      });
      client.emit({
        type: "error",
        payload: { code: "SET_CONFIG_FAILED", message: "device rejected config" },
      });
    });

    expect(container.textContent).toContain("Apply failed — check device connection and try again");
    expect(container.textContent).toContain("Apply to device");
    expect(container.textContent).not.toContain("Config applied");
  });
});
