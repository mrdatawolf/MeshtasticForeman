/** The snapshot a client gets on connect. The device manager is a stub, so no port is opened. */

import { EventEmitter } from "node:events";

import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { afterEach, describe, expect, it } from "vitest";

import { registerWsRoute } from "../../routes/websocket.js";

import type { DeviceManager } from "../../device/device-manager.js";
import type { DeviceInfo, ServerEvent } from "@foreman/shared";
import type { FastifyInstance } from "fastify";

const row = (id: string) => ({
  id,
  name: id,
  port: `/dev/${id}`,
  hw_model: null,
  firmware: null,
  last_seen: null,
});

function stubManager(silentIds: string[]): DeviceManager {
  return Object.assign(new EventEmitter(), {
    listDevices: async () => [row("hung"), row("healthy")],
    getDevice: (id: string) => ({ id, connectedAt: "2026-11-06T00:00:00.000Z" }),
    getBatteryLevel: () => null,
    hasGpsPosition: () => false,
    getGpsDetail: () => null,
    getMyNodeId: () => undefined,
    isNotResponding: (id: string) => silentIds.includes(id),
    listNodes: async () => [],
    getDeviceConfig: async () => null,
  }) as unknown as DeviceManager;
}

describe("WebSocket snapshot", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    await app.close();
  });

  it("gives a client that connects late each device's not-responding state", async () => {
    app = Fastify();
    await app.register(websocket);
    await registerWsRoute(app, stubManager(["hung"]));
    await app.ready();

    // The snapshot can arrive before the socket reports open, so listen from the start.
    let closeSocket = () => {};
    const devices = await new Promise<DeviceInfo[]>((resolve) => {
      void app
        .injectWS(
          "/ws",
          {},
          {
            onInit(ws) {
              closeSocket = () => ws.terminate();
              ws.on("message", (data: Buffer) => {
                const event = JSON.parse(data.toString()) as ServerEvent;
                if (event.type === "device:list") resolve(event.payload);
              });
            },
          },
        )
        .catch(() => {});
    });
    closeSocket();

    expect(devices.map(({ id, notResponding }) => [id, notResponding])).toEqual([
      ["hung", true],
      ["healthy", false],
    ]);
  });
});
