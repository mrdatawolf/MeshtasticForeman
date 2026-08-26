import { EventEmitter } from "node:events";

import { describe, expect, it, vi } from "vitest";

import { registerWsRoute } from "../routes/websocket.js";

import type { DeviceManager } from "../device/device-manager.js";
import type { ServerEvent } from "@foreman/shared";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";

const deviceId = "123e4567-e89b-12d3-a456-426614174000";

describe("message:send failure", () => {
  it("returns a correlated failure event without a generic command error", async () => {
    let route: ((socket: WebSocket) => void) | undefined;
    const app = {
      get: vi.fn((_path, _options, handler) => {
        route = handler as (socket: WebSocket) => void;
      }),
    } as unknown as FastifyInstance;
    const sendText = vi.fn().mockRejectedValue(new Error("radio unavailable"));
    const deviceManager = Object.assign(new EventEmitter(), {
      listDevices: vi.fn().mockResolvedValue([]),
      getDevice: vi.fn().mockReturnValue({ meshDevice: { sendText } }),
    }) as unknown as DeviceManager;
    await registerWsRoute(app, deviceManager);

    const socket = Object.assign(new EventEmitter(), {
      readyState: 1,
      send: vi.fn(),
    }) as unknown as WebSocket;
    route!(socket);
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "message:send",
          payload: {
            deviceId,
            text: "hello",
            toNodeId: 42,
            channelIndex: 0,
            wantAck: false,
            clientMsgId: "local-123",
          },
        }),
      ),
    );
    await vi.waitFor(() => expect(sendText).toHaveBeenCalledOnce());

    const events = vi
      .mocked(socket.send)
      .mock.calls.map(([json]) => JSON.parse(String(json)) as ServerEvent);
    expect(events).toContainEqual({
      type: "message:send-failed",
      payload: {
        clientMsgId: "local-123",
        deviceId,
        message: "radio unavailable",
      },
    });
    expect(events).not.toContainEqual(
      expect.objectContaining({
        type: "error",
        payload: expect.objectContaining({ code: "COMMAND_ERROR" }),
      }),
    );
  });
});
