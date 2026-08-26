import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { z } from "zod";

export interface DaemonConfig {
  api: {
    port: number; // API_PORT, default 3750
    host: string; // API_HOST, default "0.0.0.0"
    webDist: string; // WEB_DIST, default "<repo-root>/packages/web/dist"
  };
  db: {
    pgliteDir: string; // PGLITE_DIR, default "<repo-root>/pglite-data"
  };
  mqtt: {
    enabled: boolean; // ENABLE_MQTT, default false (exact "true" match only)
    broker: string | undefined; // MQTT_BROKER, no default
    port: number; // MQTT_PORT, default 1883
    username: string; // MQTT_USER, default "meshdev"
    password: string; // MQTT_PASS, default "large4cats"
    rootTopic: string; // MQTT_ROOT, default "msh/US"
  };
  meshtastic: {
    port: string | undefined; // MESHTASTIC_PORT, no default
    name: string | undefined; // MESHTASTIC_NAME, no default (raw)
  };
  bot: {
    enabled: boolean; // BOT_ENABLED, default false (exact "true" match only)
  };
  coverage: {
    elevationApiUrl: string; // ELEVATION_API_URL, default public Open-Elevation API
  };
  retention: {
    enabled: boolean; // RETENTION_ENABLED, default false
    sweepIntervalHours: number; // RETENTION_SWEEP_INTERVAL_HOURS, default 24
    packets: {
      maxRowsPerDevice: number; // RETENTION_PACKETS_MAX_ROWS_PER_DEVICE, default 100000
    };
    telemetry: {
      windowDays: number; // RETENTION_TELEMETRY_WINDOW_DAYS, default 365
    };
    cache: {
      windowDays: number; // RETENTION_CACHE_WINDOW_DAYS, default 180
    };
  };
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const defaultWebDist = resolve(repoRoot, "packages/web/dist");
const defaultPgliteDir = resolve(repoRoot, "pglite-data");

const positiveInteger = (defaultValue: string) =>
  z
    .string()
    .regex(/^\d+$/, "expected a positive integer")
    .transform(Number)
    .pipe(z.number().int().positive("expected a positive integer"))
    .default(defaultValue);

const exactTrue = z
  .string()
  .optional()
  .transform((value) => value === "true");

export const daemonConfigSchema = z
  .object({
    API_PORT: positiveInteger("3750"),
    API_HOST: z.string().default("0.0.0.0"),
    WEB_DIST: z.string().default(defaultWebDist),
    MQTT_BROKER: z.string().optional(),
    MQTT_PORT: positiveInteger("1883"),
    MQTT_USER: z.string().default("meshdev"),
    MQTT_PASS: z.string().default("large4cats"),
    MQTT_ROOT: z.string().default("msh/US"),
    ENABLE_MQTT: exactTrue,
    MESHTASTIC_PORT: z.string().optional(),
    MESHTASTIC_NAME: z.string().optional(),
    PGLITE_DIR: z.string().default(defaultPgliteDir),
    ELEVATION_API_URL: z.string().url().default("https://api.open-elevation.com/api/v1/lookup"),
    BOT_ENABLED: exactTrue,
    RETENTION_ENABLED: exactTrue,
    RETENTION_SWEEP_INTERVAL_HOURS: positiveInteger("24"),
    RETENTION_PACKETS_MAX_ROWS_PER_DEVICE: positiveInteger("100000"),
    RETENTION_TELEMETRY_WINDOW_DAYS: positiveInteger("365"),
    RETENTION_CACHE_WINDOW_DAYS: positiveInteger("180"),
  })
  .transform((env): DaemonConfig => ({
    api: { port: env.API_PORT, host: env.API_HOST, webDist: env.WEB_DIST },
    db: { pgliteDir: env.PGLITE_DIR },
    mqtt: {
      enabled: env.ENABLE_MQTT,
      broker: env.MQTT_BROKER,
      port: env.MQTT_PORT,
      username: env.MQTT_USER,
      password: env.MQTT_PASS,
      rootTopic: env.MQTT_ROOT,
    },
    meshtastic: { port: env.MESHTASTIC_PORT, name: env.MESHTASTIC_NAME },
    bot: { enabled: env.BOT_ENABLED },
    coverage: { elevationApiUrl: env.ELEVATION_API_URL },
    retention: {
      enabled: env.RETENTION_ENABLED,
      sweepIntervalHours: env.RETENTION_SWEEP_INTERVAL_HOURS,
      packets: { maxRowsPerDevice: env.RETENTION_PACKETS_MAX_ROWS_PER_DEVICE },
      telemetry: { windowDays: env.RETENTION_TELEMETRY_WINDOW_DAYS },
      cache: { windowDays: env.RETENTION_CACHE_WINDOW_DAYS },
    },
  }));

/** Throws a formatted, multi-issue error when environment validation fails. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): DaemonConfig {
  const result = daemonConfigSchema.safeParse(env);
  if (result.success) return result.data;

  const violations = result.error.issues.map((issue) => {
    const variable = issue.path[0] ?? "configuration";
    return `  - ${String(variable)}: ${issue.message}`;
  });
  throw new Error(`Invalid daemon configuration:\n${violations.join("\n")}`);
}
