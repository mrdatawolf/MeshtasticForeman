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

// Must be imported after vi.mock() above so the mocked ../ws/client.js is in
// place before messages.js's own top-level import of it runs.
// eslint-disable-next-line import/order
import {
  addOptimisticMessage,
  clearConversation,
  getConversation,
  initMessageStore,
} from "./messages.js";

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

  it("marks the correlated optimistic message as failed", () => {
    const optimistic: Message = {
      ...message,
      id: "local-123",
      fromNodeId: 0,
      toNodeId: message.fromNodeId,
      role: "sent",
      ackStatus: "pending",
    };
    addOptimisticMessage(optimistic);

    clientMock.emit({
      type: "message:send-failed",
      payload: {
        clientMsgId: optimistic.id,
        deviceId: "123e4567-e89b-12d3-a456-426614174000",
        message: "radio unavailable",
      },
    });

    expect(getConversation(optimistic.toNodeId)).toEqual([
      { ...optimistic, ackStatus: "error", ackError: "radio unavailable" },
    ]);
  });
});
