import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { registerWsRoute } from "../routes/websocket.js";

import type { DeviceManager } from "../device/device-manager.js";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";

describe("WsRouteHandle", () => {
  it("closes only currently-open clients and is safe with zero clients", async () => {
    let route: ((socket: WebSocket) => void) | undefined;
    const app = {
      get: vi.fn((_path, _options, handler) => {
        route = handler as (socket: WebSocket) => void;
      }),
    } as unknown as FastifyInstance;
    const deviceManager = Object.assign(new EventEmitter(), {
      listDevices: vi.fn().mockResolvedValue([]),
    }) as unknown as DeviceManager;
    const handle = await registerWsRoute(app, deviceManager);

    expect(() => handle.closeAll(1001, "server shutting down")).not.toThrow();

    const openSocket = Object.assign(new EventEmitter(), {
      readyState: 1,
      close: vi.fn(),
      send: vi.fn(),
    }) as unknown as WebSocket;
    const closingSocket = Object.assign(new EventEmitter(), {
      readyState: 2,
      close: vi.fn(),
      send: vi.fn(),
    }) as unknown as WebSocket;
    route!(openSocket);
    route!(closingSocket);

    handle.closeAll(1001, "server shutting down");

    expect(openSocket.close).toHaveBeenCalledWith(1001, "server shutting down");
    expect(closingSocket.close).not.toHaveBeenCalled();
  });
});
