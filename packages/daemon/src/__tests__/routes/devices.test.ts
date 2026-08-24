/**
 * REST route tests for /api/devices
 *
 * Uses Fastify's built-in inject() — no network socket needed.
 * DeviceManager is replaced with a plain vi.fn() stub.
 */

import Fastify from "fastify";
import { describe, it, expect, beforeEach, vi } from "vitest";

import { registerDeviceRoutes } from "../../routes/devices.js";

// ---------------------------------------------------------------------------
// Stub DeviceManager — only the methods that the route handlers call
// ---------------------------------------------------------------------------

function makeMockDeviceManager() {
  return {
    listDevices: vi.fn().mockResolvedValue([]),
    connect: vi.fn().mockResolvedValue({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Test Node",
      port: "/dev/ttyUSB0",
      connectedAt: new Date().toISOString(),
    }),
    disconnect: vi.fn().mockResolvedValue(undefined),
    getDevice: vi.fn().mockReturnValue(undefined),
  };
}

type MockDeviceManager = ReturnType<typeof makeMockDeviceManager>;

async function buildApp(mock: MockDeviceManager) {
  const app = Fastify({ logger: false });
  // Cast: registerDeviceRoutes only uses the methods above
  await registerDeviceRoutes(app, mock as never);
  return app;
}

// ---------------------------------------------------------------------------

describe("GET /api/devices", () => {
  let mock: MockDeviceManager;

  beforeEach(() => {
    mock = makeMockDeviceManager();
  });

  it("returns 200 with empty array when no devices", async () => {
    const app = await buildApp(mock);
    const res = await app.inject({ method: "GET", url: "/api/devices" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it("returns the device list from DeviceManager", async () => {
    mock.listDevices.mockResolvedValue([
      {
        id: "id1",
        name: "Node A",
        port: "/dev/ttyUSB0",
        hw_model: null,
        firmware: null,
        last_seen: null,
      },
    ]);
    const app = await buildApp(mock);
    const res = await app.inject({ method: "GET", url: "/api/devices" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as Array<{ name: string }>;
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("Node A");
  });
});

// ---------------------------------------------------------------------------

describe("POST /api/devices/connect", () => {
  let mock: MockDeviceManager;

  beforeEach(() => {
    mock = makeMockDeviceManager();
  });

  it("returns 200 with the connected device on valid input", async () => {
    const app = await buildApp(mock);
    const res = await app.inject({
      method: "POST",
      url: "/api/devices/connect",
      payload: { port: "/dev/ttyUSB0", name: "Test Node" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { id: string; name: string };
    expect(body.name).toBe("Test Node");
    expect(mock.connect).toHaveBeenCalledWith("/dev/ttyUSB0", "Test Node");
  });

  it("returns 400 when port is missing", async () => {
    const app = await buildApp(mock);
    const res = await app.inject({
      method: "POST",
      url: "/api/devices/connect",
      payload: { name: "Test Node" }, // port absent
    });
    expect(res.statusCode).toBe(400);
    expect(mock.connect).not.toHaveBeenCalled();
  });

  it("returns 400 when name is missing", async () => {
    const app = await buildApp(mock);
    const res = await app.inject({
      method: "POST",
      url: "/api/devices/connect",
      payload: { port: "/dev/ttyUSB0" }, // name absent
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when body is empty", async () => {
    const app = await buildApp(mock);
    const res = await app.inject({
      method: "POST",
      url: "/api/devices/connect",
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("returns 400 when port is an empty string", async () => {
    const app = await buildApp(mock);
    const res = await app.inject({
      method: "POST",
      url: "/api/devices/connect",
      payload: { port: "", name: "Node" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------

describe("DELETE /api/devices/:id", () => {
  let mock: MockDeviceManager;

  beforeEach(() => {
    mock = makeMockDeviceManager();
  });

  it("returns 204 and calls disconnect()", async () => {
    const app = await buildApp(mock);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/devices/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(res.statusCode).toBe(204);
    expect(mock.disconnect).toHaveBeenCalledWith("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("returns 204 even for an unknown id (graceful no-op)", async () => {
    // disconnect() resolves undefined for unknown ids
    const app = await buildApp(mock);
    const res = await app.inject({
      method: "DELETE",
      url: "/api/devices/00000000-0000-0000-0000-000000000000",
    });
    expect(res.statusCode).toBe(204);
  });
});
