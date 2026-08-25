import { afterEach, describe, expect, it, vi } from "vitest";

import { formatRelativeTime } from "./relativeTime.js";

describe("formatRelativeTime", () => {
  afterEach(() => vi.useRealTimers());

  it("preserves the existing seconds, minutes, hours, and days output", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T12:00:00.000Z"));

    expect(formatRelativeTime("2026-08-24T11:59:31.000Z")).toBe("29s ago");
    expect(formatRelativeTime("2026-08-24T11:30:00.000Z")).toBe("30m ago");
    expect(formatRelativeTime("2026-08-24T09:00:00.000Z")).toBe("3h ago");
    expect(formatRelativeTime("2026-08-22T12:00:00.000Z")).toBe("2d ago");
  });

  it("supports the existing page-specific empty values", () => {
    expect(formatRelativeTime(null)).toBe("—");
    expect(formatRelativeTime(null, "never")).toBe("never");
  });
});
