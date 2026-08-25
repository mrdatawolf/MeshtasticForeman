import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { registerHealthRoutes } from "../../routes/health.js";

function makeDb(query = vi.fn().mockResolvedValue([])) {
  return { query };
}

async function buildApp(
  db = makeDb(),
  mqttGateway: { isRunning: boolean; connected: boolean } | null = null,
) {
  const app = Fastify({ logger: false });
  await registerHealthRoutes(app, db as never, mqttGateway as never);
  return app;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("GET /api/health", () => {
  it("always returns the liveness response without checking dependencies", async () => {
    const query = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const app = await buildApp(makeDb(query), { isRunning: true, connected: false });

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
    expect(query).not.toHaveBeenCalled();
  });
});

describe("GET /api/ready", () => {
  it("is healthy and omits MQTT when no gateway exists", async () => {
    const app = await buildApp();
    const response = await app.inject({ method: "GET", url: "/api/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "healthy", checks: { pglite: "ok" } });
  });

  it("is healthy when MQTT is running and connected", async () => {
    const app = await buildApp(makeDb(), { isRunning: true, connected: true });
    const response = await app.inject({ method: "GET", url: "/api/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "healthy",
      checks: { pglite: "ok", mqtt: "ok" },
    });
  });

  it("is degraded when MQTT is running but disconnected", async () => {
    const app = await buildApp(makeDb(), { isRunning: true, connected: false });
    const response = await app.inject({ method: "GET", url: "/api/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "degraded",
      checks: { pglite: "ok", mqtt: "disconnected" },
    });
  });

  it("omits MQTT when the gateway exists but is not running", async () => {
    const app = await buildApp(makeDb(), { isRunning: false, connected: false });
    const response = await app.inject({ method: "GET", url: "/api/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "healthy", checks: { pglite: "ok" } });
  });

  it("fails when the PGlite query rejects", async () => {
    const app = await buildApp(makeDb(vi.fn().mockRejectedValue(new Error("worker stopped"))));
    const response = await app.inject({ method: "GET", url: "/api/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "failed", checks: { pglite: "failed" } });
  });

  it("fails when the PGlite query times out", async () => {
    vi.useFakeTimers();
    const app = await buildApp(makeDb(vi.fn().mockReturnValue(new Promise(() => undefined))));
    const responsePromise = app.inject({ method: "GET", url: "/api/ready" });

    await vi.advanceTimersByTimeAsync(2000);
    const response = await responsePromise;

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: "failed", checks: { pglite: "failed" } });
  });

  it("lets PGlite failure dominate while retaining disconnected MQTT diagnostics", async () => {
    const app = await buildApp(makeDb(vi.fn().mockRejectedValue(new Error("worker stopped"))), {
      isRunning: true,
      connected: false,
    });
    const response = await app.inject({ method: "GET", url: "/api/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: "failed",
      checks: { pglite: "failed", mqtt: "disconnected" },
    });
  });
});
