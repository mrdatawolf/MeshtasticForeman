import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useNow } from "./useNow.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("useNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes on its interval with no other change, and stops on unmount", () => {
    const seen: number[] = [];
    function Probe() {
      seen.push(useNow(60_000));
      return null;
    }

    const root = createRoot(document.createElement("div"));
    act(() => root.render(createElement(Probe)));
    expect(seen.at(-1)).toBe(1_000_000);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(seen.at(-1)).toBe(1_060_000);

    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
  });
});
