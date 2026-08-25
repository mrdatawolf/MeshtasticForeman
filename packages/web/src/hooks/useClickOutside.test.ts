import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { useClickOutside } from "./useClickOutside.js";

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
});

function renderHook(onOutside: () => void, enabled: boolean) {
  function Harness() {
    const ref = useRef<HTMLDivElement>(null);
    useClickOutside(ref, onOutside, enabled);
    return createElement("div", { ref, "data-inside": true });
  }

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(createElement(Harness)));
}

describe("useClickOutside", () => {
  it("calls the callback for an outside mousedown when enabled", () => {
    const onOutside = vi.fn();
    renderHook(onOutside, true);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onOutside).toHaveBeenCalledOnce();
  });

  it("does not call the callback for a mousedown inside the referenced element", () => {
    const onOutside = vi.fn();
    renderHook(onOutside, true);
    container
      ?.querySelector("[data-inside]")
      ?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onOutside).not.toHaveBeenCalled();
  });

  it("does nothing when disabled", () => {
    const onOutside = vi.fn();
    const addEventListener = vi.spyOn(document, "addEventListener");
    renderHook(onOutside, false);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onOutside).not.toHaveBeenCalled();
    expect(addEventListener).not.toHaveBeenCalledWith("mousedown", expect.any(Function));
    addEventListener.mockRestore();
  });

  it("removes the listener on unmount", () => {
    const onOutside = vi.fn();
    renderHook(onOutside, true);
    act(() => root?.unmount());
    root = undefined;
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onOutside).not.toHaveBeenCalled();
  });
});
