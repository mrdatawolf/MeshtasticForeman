import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ConfigCard } from "./ConfigCard.js";

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
});

function clickButton(label: string) {
  const button = [...(container?.querySelectorAll("button") ?? [])].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  expect(button).toBeDefined();
  act(() => button?.click());
}

function startSave() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() =>
    root?.render(
      <ConfigCard section="lora" namespace="radio" data={{ enabled: true }} deviceId="device-1" />,
    ),
  );
  clickButton("Edit");
  clickButton("ON");
  clickButton("Save");
  expect(client.send).toHaveBeenCalled();
  expect(container.textContent).toContain("Saving…");
}

describe("ConfigCard", () => {
  it("ignores config completion events for another device while save is pending", () => {
    startSave();

    act(() => {
      client.emit({
        type: "device:config",
        payload: {
          deviceId: "device-2",
          radioConfig: { lora: { enabled: false } },
          moduleConfig: {},
          channels: [],
        },
      });
    });

    expect(container?.textContent).toContain("Saving…");
    expect(container?.textContent).not.toContain("Saved ✓");
    expect(client.handler).toBeDefined();
  });

  it("ignores target-device snapshots that do not contain the saved section", () => {
    startSave();

    act(() => {
      client.emit({
        type: "device:config",
        payload: {
          deviceId: "device-1",
          radioConfig: { device: {} },
          moduleConfig: {},
          channels: [],
        },
      });
    });

    expect(container?.textContent).toContain("Saving…");
    expect(container?.textContent).not.toContain("Saved ✓");
  });

  it("completes save for a target-device snapshot containing the saved section", () => {
    startSave();

    act(() => {
      client.emit({
        type: "device:config",
        payload: {
          deviceId: "device-1",
          radioConfig: { lora: { enabled: false } },
          moduleConfig: {},
          channels: [],
        },
      });
    });

    expect(container?.textContent).toContain("Saved ✓");
    expect(container?.textContent).not.toContain("Saving…");
  });
});
