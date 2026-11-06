import { describe, expect, it } from "vitest";

import { formatDebugReport, formatFrameAge, PROBE_OUTCOMES, toolAvailable } from "./debugReport.js";

import type { DebugChecksResponse, RawProbeResult } from "@foreman/shared";

const report: DebugChecksResponse = {
  generatedAt: "2026-11-06T12:00:00.000Z",
  devices: [
    {
      deviceId: "device-1",
      port: "/dev/ttyUSB0",
      portHeld: true,
      lastFrameAt: null,
      framesThisConnection: 0,
      lastConfigRequestAt: "2026-11-06T11:59:00.000Z",
      configured: false,
      checks: [
        {
          id: "radio-responding",
          title: "Radio responding",
          status: "fail",
          summary: "The radio sent nothing.",
          cause: "The firmware may have stopped.",
          fix: "Run the probe.",
          toolIds: ["raw-probe"],
        },
      ],
    },
  ],
  system: [
    {
      id: "mqtt-broker",
      title: "MQTT broker",
      status: "skipped",
      summary: "No MQTT broker is configured.",
      cause: null,
      fix: null,
      toolIds: [],
    },
  ],
};

const probe: RawProbeResult = {
  outcome: "no-response",
  bytesReceived: 0,
  framesReceived: 0,
  ownNodeId: null,
  durationMs: 25_000,
  reconnecting: true,
};

describe("formatDebugReport", () => {
  it("includes connection facts, every check, and cause and fix", () => {
    const text = formatDebugReport(report, {});

    expect(text).toContain("Device /dev/ttyUSB0");
    expect(text).toContain("Port held: yes");
    expect(text).toContain("Last frame: none this connection");
    expect(text).toContain("[Fail] Radio responding: The radio sent nothing.");
    expect(text).toContain("Cause: The firmware may have stopped.");
    expect(text).toContain("Fix: Run the probe.");
    expect(text).toContain("[Skipped] MQTT broker: No MQTT broker is configured.");
  });

  it("adds a probe result to its device", () => {
    const text = formatDebugReport(report, { "device-1": probe });

    expect(text).toContain("Raw serial probe: The radio did not answer");
    expect(text).toContain("Bytes received: 0");
    expect(text).toContain("Took: 25.0s");
  });
});

describe("PROBE_OUTCOMES", () => {
  it("tells the user to power-cycle, battery included, on no response", () => {
    expect(PROBE_OUTCOMES["no-response"].guidance).toContain(
      "Power-cycle the radio, including its battery if it has one",
    );
  });

  it("calls the radio healthy and points at the daemon connection", () => {
    expect(PROBE_OUTCOMES.healthy.title).toContain("healthy");
    expect(PROBE_OUTCOMES.healthy.guidance).toContain("daemon's connection");
  });
});

describe("toolAvailable", () => {
  it("matches each tool's requirement", () => {
    expect(toolAvailable("reconfigure", true)).toBe(true);
    expect(toolAvailable("reconfigure", false)).toBe(false);
    expect(toolAvailable("reconnect", true)).toBe(false);
    expect(toolAvailable("reconnect", false)).toBe(true);
    expect(toolAvailable("disconnect", false)).toBe(true);
    expect(toolAvailable("raw-probe", false)).toBe(true);
  });
});

describe("formatFrameAge", () => {
  const generatedAt = "2026-11-06T12:00:00.000Z";

  it("handles no frame yet", () => {
    expect(formatFrameAge(null, generatedAt, 0, 0)).toBe("None this connection");
  });

  it("measures against the daemon's clock, not the viewer's", () => {
    const viewerClock = Date.parse("2020-01-01T00:00:00.000Z");
    expect(
      formatFrameAge("2026-11-06T11:59:50.000Z", generatedAt, viewerClock, viewerClock + 5_000),
    ).toBe("15s ago");
  });

  it("uses minutes and hours for older frames", () => {
    expect(formatFrameAge("2026-11-06T11:57:30.000Z", generatedAt, 0, 0)).toBe("2m 30s ago");
    expect(formatFrameAge("2026-11-06T09:30:00.000Z", generatedAt, 0, 0)).toBe("2h 30m ago");
  });

  it("does not show a negative age", () => {
    expect(formatFrameAge("2026-11-06T12:00:05.000Z", generatedAt, 0, 0)).toBe("0s ago");
  });
});
