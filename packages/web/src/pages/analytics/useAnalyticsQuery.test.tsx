import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { useAnalyticsQuery, type AnalyticsQueryState } from "./useAnalyticsQuery.js";

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

function renderQuery<T>(
  fetcher: (signal: AbortSignal) => Promise<T>,
  dependency: string,
  onState: (state: AnalyticsQueryState<T>) => void,
  fallbackData?: T,
) {
  function Harness({ value }: { value: string }) {
    onState(useAnalyticsQuery(fetcher, [value], fallbackData));
    return null;
  }

  if (!root) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  act(() => root?.render(<Harness value={dependency} />));
}

async function flush() {
  await act(async () => Promise.resolve());
}

describe("useAnalyticsQuery", () => {
  it("loads data successfully and refreshes on demand", async () => {
    const fetcher = vi.fn(async () => fetcher.mock.calls.length);
    let state!: AnalyticsQueryState<number>;
    renderQuery(fetcher, "same", (next) => (state = next));
    await flush();

    expect(state.data).toBe(1);
    expect(state.loading).toBe(false);
    expect(state.error).toBeNull();

    act(() => state.refresh());
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(state.data).toBe(2);
  });

  it("records a request error and preserves the caller's display fallback", async () => {
    const failure = new Error("offline");
    let state!: AnalyticsQueryState<string[]>;
    renderQuery(
      () => Promise.reject(failure),
      "error",
      (next) => (state = next),
      [],
    );
    await flush();

    expect(state.data).toEqual([]);
    expect(state.error).toBe(failure);
    expect(state.loading).toBe(false);
  });

  it("aborts a stale request and prevents its later resolution from overwriting data", async () => {
    const requests: Array<{
      signal: AbortSignal;
      resolve: (value: string) => void;
    }> = [];
    const fetcher = (signal: AbortSignal) =>
      new Promise<string>((resolve) => requests.push({ signal, resolve }));
    let state!: AnalyticsQueryState<string>;

    renderQuery(fetcher, "first", (next) => (state = next));
    expect(requests[0].signal.aborted).toBe(false);
    renderQuery(fetcher, "second", (next) => (state = next));
    expect(requests[0].signal.aborted).toBe(true);

    await act(async () => requests[1].resolve("fresh"));
    expect(state.data).toBe("fresh");
    await act(async () => requests[0].resolve("stale"));
    expect(state.data).toBe("fresh");
    expect(state.error).toBeNull();
  });

  it("does not expose AbortError as a query error", async () => {
    const abortError = new DOMException("aborted", "AbortError");
    let state!: AnalyticsQueryState<string>;
    renderQuery(
      () => Promise.reject(abortError),
      "abort",
      (next) => (state = next),
    );
    await flush();
    expect(state.error).toBeNull();
  });
});
