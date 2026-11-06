/**
 * REST route tests for /api/debug. DeviceManager is a stub, so no tool here can
 * reach a port.
 */

import { PGlite } from "@electric-sql/pglite";
import Fastify from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { runMigrations } from "../../db/migrations.js";
import { ProbeInterruptedError } from "../../device/device-manager.js";
import { registerDebugRoutes } from "../../routes/debug.js";

import type { RawProbeResult } from "@foreman/shared";

const DEVICE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UNKNOWN_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PORT = "/dev/ttyUSB0";

const probeResult: RawProbeResult = {
  outcome: "healthy",
  bytesReceived: 15_893,
  framesReceived: 80,
  ownNodeId: 1234,
  durationMs: 900,
  reconnecting: true,
};

function makeManager(portHeld = true) {
  return {
    getConnectionFacts: vi.fn(() => ({
      portHeld,
      phase: portHeld ? ("held" as const) : ("released" as const),
      lastFrameAt: null,
      framesThisConnection: 0,
      lastConfigRequestAt: null,
      configured: false,
    })),
    getMyNodeId: vi.fn(() => undefined),
    hasGpsPosition: vi.fn(() => false),
    requestConfig: vi.fn(() => portHeld),
    reconnect: vi.fn(),
    disconnect: vi.fn().mockResolvedValue(undefined),
    rawProbe: vi.fn().mockResolvedValue(probeResult),
  };
}

type Manager = ReturnType<typeof makeManager>;

describe("debug routes", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = new PGlite();
    await runMigrations(db);
    await db.query("INSERT INTO devices(id, name, port) VALUES ($1, 'Test Node', $2)", [
      DEVICE_ID,
      PORT,
    ]);
  });

  afterAll(async () => {
    await db.close();
  });

  async function buildApp(manager: Manager) {
    const app = Fastify({ logger: false });
    const inspector = { isPresent: vi.fn(async () => true), canOpen: vi.fn(async () => true) };
    await registerDebugRoutes(app, manager as never, null, db, inspector);
    return app;
  }

  const post = (app: Awaited<ReturnType<typeof buildApp>>, toolId: string, body: unknown) =>
    app.inject({ method: "POST", url: `/api/debug/tools/${toolId}`, payload: body as object });

  describe("GET /api/debug/checks", () => {
    it("returns every saved device without a deviceId", async () => {
      const app = await buildApp(makeManager());
      const res = await app.inject({ method: "GET", url: "/api/debug/checks" });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.devices).toHaveLength(1);
      expect(body.devices[0]).toMatchObject({ deviceId: DEVICE_ID, port: PORT, portHeld: true });
      expect(body.system.map((check: { id: string }) => check.id)).toEqual([
        "mqtt-broker",
        "saved-devices",
      ]);
    });

    it("changes nothing and touches no tool", async () => {
      const manager = makeManager();
      const app = await buildApp(manager);
      await app.inject({ method: "GET", url: `/api/debug/checks?deviceId=${DEVICE_ID}` });

      expect(manager.requestConfig).not.toHaveBeenCalled();
      expect(manager.reconnect).not.toHaveBeenCalled();
      expect(manager.disconnect).not.toHaveBeenCalled();
      expect(manager.rawProbe).not.toHaveBeenCalled();
    });

    it("rejects an invalid deviceId with the validation body", async () => {
      const app = await buildApp(makeManager());
      const res = await app.inject({ method: "GET", url: "/api/debug/checks?deviceId=nope" });

      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({
        error: { fieldErrors: { deviceId: expect.any(Array) }, formErrors: [] },
      });
    });

    it("returns 404 for an unknown device", async () => {
      const app = await buildApp(makeManager());
      const res = await app.inject({
        method: "GET",
        url: `/api/debug/checks?deviceId=${UNKNOWN_ID}`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: expect.any(String) });
    });
  });

  describe("POST /api/debug/tools/:toolId", () => {
    let manager: Manager;

    beforeEach(() => {
      manager = makeManager();
    });

    it.each(["reboot", "factory-reset", "shell", "rerun-checks"])(
      "rejects %s, which is not on the allowlist",
      async (toolId) => {
        const app = await buildApp(manager);
        const res = await post(app, toolId, { deviceId: DEVICE_ID });

        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({
          error: { fieldErrors: { toolId: expect.any(Array) }, formErrors: [] },
        });
      },
    );

    it("rejects a missing or malformed deviceId", async () => {
      const app = await buildApp(manager);

      expect((await post(app, "disconnect", {})).statusCode).toBe(400);
      expect((await post(app, "disconnect", { deviceId: "nope" })).statusCode).toBe(400);
      expect(manager.disconnect).not.toHaveBeenCalled();
    });

    it("rejects a caller-supplied port", async () => {
      const app = await buildApp(manager);
      const res = await post(app, "raw-probe", { deviceId: DEVICE_ID, port: "/dev/other" });

      expect(res.statusCode).toBe(400);
      expect(manager.rawProbe).not.toHaveBeenCalled();
    });

    it("returns 404 for an unknown device", async () => {
      const app = await buildApp(manager);
      const res = await post(app, "raw-probe", { deviceId: UNKNOWN_ID });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toEqual({ error: expect.any(String) });
      expect(manager.rawProbe).not.toHaveBeenCalled();
    });

    it("reconfigure returns 202 at once", async () => {
      const app = await buildApp(manager);
      const res = await post(app, "reconfigure", { deviceId: DEVICE_ID });

      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ toolId: "reconfigure", status: "accepted" });
      expect(manager.requestConfig).toHaveBeenCalledWith(DEVICE_ID);
    });

    it("reconfigure returns 409 when the port is not held", async () => {
      const app = await buildApp(makeManager(false));
      const res = await post(app, "reconfigure", { deviceId: DEVICE_ID });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: expect.any(String) });
    });

    it("reconnect returns 202 at once and uses the saved port", async () => {
      const released = makeManager(false);
      const app = await buildApp(released);
      const res = await post(app, "reconnect", { deviceId: DEVICE_ID });

      expect(res.statusCode).toBe(202);
      expect(released.reconnect).toHaveBeenCalledWith(DEVICE_ID, PORT, "Test Node");
    });

    it("reconnect returns 409 when the port is already held", async () => {
      const app = await buildApp(manager);
      const res = await post(app, "reconnect", { deviceId: DEVICE_ID });

      expect(res.statusCode).toBe(409);
      expect(manager.reconnect).not.toHaveBeenCalled();
    });

    it("disconnect returns 200 once the port is released", async () => {
      let release = () => {};
      manager.disconnect.mockReturnValue(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      const app = await buildApp(manager);
      let finished = false;
      const response = post(app, "disconnect", { deviceId: DEVICE_ID }).then((res) => {
        finished = true;
        return res;
      });

      await vi.waitFor(() => expect(manager.disconnect).toHaveBeenCalled());
      expect(finished).toBe(false);
      release();

      const res = await response;
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ toolId: "disconnect", status: "released" });
    });

    it("disconnect works with no connection at all", async () => {
      const app = await buildApp(makeManager(false));
      expect((await post(app, "disconnect", { deviceId: DEVICE_ID })).statusCode).toBe(200);
    });

    it("raw-probe returns the result, using the saved port", async () => {
      const app = await buildApp(manager);
      const res = await post(app, "raw-probe", { deviceId: DEVICE_ID });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual(probeResult);
      expect(manager.rawProbe).toHaveBeenCalledWith(DEVICE_ID, PORT, "Test Node");
    });

    it("raw-probe interrupted by a disconnect or shutdown returns 409", async () => {
      manager.rawProbe.mockRejectedValue(new ProbeInterruptedError());
      const app = await buildApp(manager);

      const res = await post(app, "raw-probe", { deviceId: DEVICE_ID });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: expect.any(String) });
    });

    it("rejects a second tool on the device, then accepts one after it ends", async () => {
      let finish = (_result: RawProbeResult) => {};
      manager.rawProbe.mockReturnValue(
        new Promise<RawProbeResult>((resolve) => {
          finish = resolve;
        }),
      );
      const app = await buildApp(manager);

      const first = post(app, "raw-probe", { deviceId: DEVICE_ID });
      await vi.waitFor(() => expect(manager.rawProbe).toHaveBeenCalled());

      const second = await post(app, "disconnect", { deviceId: DEVICE_ID });
      expect(second.statusCode).toBe(409);
      expect(second.json()).toEqual({ error: expect.any(String) });
      expect(manager.disconnect).not.toHaveBeenCalled();

      finish(probeResult);
      expect((await first).statusCode).toBe(200);
      expect((await post(app, "disconnect", { deviceId: DEVICE_ID })).statusCode).toBe(200);
    });

    it("releases the tool lock when a tool throws", async () => {
      manager.disconnect.mockRejectedValueOnce(new Error("boom"));
      const app = await buildApp(manager);

      expect((await post(app, "disconnect", { deviceId: DEVICE_ID })).statusCode).toBe(500);
      expect((await post(app, "disconnect", { deviceId: DEVICE_ID })).statusCode).toBe(200);
    });
  });
});
