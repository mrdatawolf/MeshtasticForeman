import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { daemonConfigSchema, loadConfig } from "../config.js";

const repoRoot = resolve(import.meta.dirname, "../../../..");

describe("daemon configuration", () => {
  it("applies every current runtime default when variables are unset", () => {
    expect(loadConfig({})).toEqual({
      api: {
        port: 3750,
        host: "0.0.0.0",
        webDist: resolve(repoRoot, "packages/web/dist"),
      },
      db: { pgliteDir: resolve(repoRoot, "pglite-data") },
      mqtt: {
        enabled: false,
        broker: undefined,
        port: 1883,
        username: "meshdev",
        password: "large4cats",
        rootTopic: "msh/US",
      },
      meshtastic: { port: undefined, name: undefined },
      bot: { enabled: false },
      coverage: {
        elevationApiUrl: "https://api.open-elevation.com/api/v1/lookup",
      },
      retention: {
        enabled: false,
        sweepIntervalHours: 24,
        packets: { maxRowsPerDevice: 100000 },
        telemetry: { windowDays: 365 },
        cache: { windowDays: 180 },
      },
    });
  });

  it.each(["false", "1", "TRUE", ""])(
    "parses boolean value %j as false using exact string equality",
    (value) => {
      const config = loadConfig({
        ENABLE_MQTT: value,
        BOT_ENABLED: value,
        RETENTION_ENABLED: value,
      });
      expect(config.mqtt.enabled).toBe(false);
      expect(config.bot.enabled).toBe(false);
      expect(config.retention.enabled).toBe(false);
    },
  );

  it('parses only the exact boolean string "true" as true', () => {
    const config = loadConfig({
      ENABLE_MQTT: "true",
      BOT_ENABLED: "true",
      RETENTION_ENABLED: "true",
    });
    expect(config.mqtt.enabled).toBe(true);
    expect(config.bot.enabled).toBe(true);
    expect(config.retention.enabled).toBe(true);
  });

  it("parses valid numeric port strings as positive integers", () => {
    const config = loadConfig({ API_PORT: "4000", MQTT_PORT: "2883" });
    expect(config.api.port).toBe(4000);
    expect(config.mqtt.port).toBe(2883);
  });

  it.each(["API_PORT", "MQTT_PORT"] as const)("rejects non-numeric %s", (variable) => {
    const result = daemonConfigSchema.safeParse({ [variable]: "abc" });
    expect(result.success).toBe(false);
    expect(() => loadConfig({ [variable]: "abc" })).toThrow(variable);
  });

  it("throws one aggregated error listing every invalid variable", () => {
    let thrown: unknown;
    try {
      loadConfig({
        API_PORT: "notanumber",
        MQTT_PORT: "also-bad",
        RETENTION_SWEEP_INTERVAL_HOURS: "0",
        RETENTION_PACKETS_MAX_ROWS_PER_DEVICE: "also-bad",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain("  - API_PORT: expected a positive integer");
    expect((thrown as Error).message).toContain("  - MQTT_PORT: expected a positive integer");
    expect((thrown as Error).message).toContain(
      "  - RETENTION_SWEEP_INTERVAL_HOURS: expected a positive integer",
    );
    expect((thrown as Error).message).toContain(
      "  - RETENTION_PACKETS_MAX_ROWS_PER_DEVICE: expected a positive integer",
    );
  });

  it("resolves path defaults independently to the historical absolute locations", () => {
    const config = loadConfig({});
    expect(config.api.webDist).toBe(resolve(repoRoot, "packages/web/dist"));
    expect(config.db.pgliteDir).toBe(resolve(repoRoot, "pglite-data"));
  });

  it("keeps optional Meshtastic values independent and accepts all explicit overrides", () => {
    const config = loadConfig({
      API_PORT: "4001",
      API_HOST: "127.0.0.1",
      WEB_DIST: "/srv/web",
      MQTT_BROKER: "mqtt.example.com",
      MQTT_PORT: "1884",
      MQTT_USER: "operator",
      MQTT_PASS: "secret",
      MQTT_ROOT: "msh/test",
      ENABLE_MQTT: "true",
      MESHTASTIC_PORT: "/dev/ttyUSB0",
      MESHTASTIC_NAME: "Field Node",
      PGLITE_DIR: "/srv/pglite",
      ELEVATION_API_URL: "https://elevation.example.com/lookup",
      BOT_ENABLED: "true",
    });

    expect(config.meshtastic).toEqual({ port: "/dev/ttyUSB0", name: "Field Node" });
    expect(config.mqtt.broker).toBe("mqtt.example.com");
    expect(config.coverage.elevationApiUrl).toBe("https://elevation.example.com/lookup");
  });
});
