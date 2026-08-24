import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Message, ServerEvent } from "@foreman/shared";

const clientMock = vi.hoisted(() => {
  let eventHandler: ((event: ServerEvent) => void) | undefined;
  return {
    emit(event: ServerEvent) {
      eventHandler?.(event);
    },
    on(handler: (event: ServerEvent) => void) {
      eventHandler = handler;
      return () => {
        eventHandler = undefined;
      };
    },
    send: vi.fn(),
  };
});

vi.mock("../ws/client.js", () => ({ foremanClient: clientMock }));

import { clearConversation, getConversation, initMessageStore } from "./messages.js";

const message: Message = {
  id: "message-1",
  packetId: 100,
  fromNodeId: 42,
  toNodeId: 1,
  channelIndex: 0,
  text: "hello",
  rxTime: "2026-08-24T12:00:00.000Z",
  rxSnr: 4.5,
  rxRssi: -90,
  hopLimit: 3,
  wantAck: true,
  viaMqtt: false,
  role: "received",
  ackStatus: null,
  ackAt: null,
  ackError: null,
  replyToPacketId: 0,
};

describe("message store WebSocket events", () => {
  beforeEach(() => {
    clearConversation(message.fromNodeId);
    initMessageStore();
  });

  it("updates acknowledgement state when a message:ack event arrives", () => {
    clientMock.emit({ type: "message:received", payload: message });

    clientMock.emit({
      type: "message:ack",
      payload: {
        messageId: message.id,
        packetId: message.packetId,
        status: "error",
        ackAt: "2026-08-24T12:00:01.000Z",
        ackError: "delivery timed out",
      },
    });

    expect(getConversation(message.fromNodeId)).toEqual([
      {
        ...message,
        ackStatus: "error",
        ackAt: "2026-08-24T12:00:01.000Z",
        ackError: "delivery timed out",
      },
    ]);
  });
});
