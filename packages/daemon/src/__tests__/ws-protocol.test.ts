/**
 * WebSocket protocol schema tests
 *
 * Validates the Zod schemas in @foreman/shared against valid and invalid
 * payloads.  Pure unit tests — no network, no mocks.
 */

import { clientCommandSchema } from "@foreman/shared";
import { describe, it, expect } from "vitest";

const DEVICE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

describe("clientCommandSchema", () => {
  // -------------------------------------------------------------------------
  describe("message:send", () => {
    it("accepts a valid payload", () => {
      const result = clientCommandSchema.safeParse({
        type: "message:send",
        payload: {
          deviceId: DEVICE_ID,
          text: "Hello world",
          toNodeId: 100,
          channelIndex: 0,
          wantAck: true,
        },
      });
      expect(result.success).toBe(true);
    });

    it("defaults wantAck to true when omitted", () => {
      const result = clientCommandSchema.safeParse({
        type: "message:send",
        payload: {
          deviceId: DEVICE_ID,
          text: "Hi",
          toNodeId: 1,
          channelIndex: 0,
          // wantAck omitted
        },
      });
      expect(result.success).toBe(true);
      if (result.success && result.data.type === "message:send") {
        expect(result.data.payload.wantAck).toBe(true);
      }
    });

    it("accepts an optional clientMsgId", () => {
      const result = clientCommandSchema.safeParse({
        type: "message:send",
        payload: {
          deviceId: DEVICE_ID,
          text: "Hi",
          toNodeId: 1,
          channelIndex: 0,
          clientMsgId: "local-123",
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects empty text", () => {
      const result = clientCommandSchema.safeParse({
        type: "message:send",
        payload: { deviceId: DEVICE_ID, text: "", toNodeId: 1, channelIndex: 0 },
      });
      expect(result.success).toBe(false);
    });

    it("rejects text over 228 characters", () => {
      const result = clientCommandSchema.safeParse({
        type: "message:send",
        payload: {
          deviceId: DEVICE_ID,
          text: "x".repeat(229),
          toNodeId: 1,
          channelIndex: 0,
        },
      });
      expect(result.success).toBe(false);
    });

    it("accepts text exactly 228 characters", () => {
      const result = clientCommandSchema.safeParse({
        type: "message:send",
        payload: {
          deviceId: DEVICE_ID,
          text: "x".repeat(228),
          toNodeId: 1,
          channelIndex: 0,
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects channelIndex above 7", () => {
      const result = clientCommandSchema.safeParse({
        type: "message:send",
        payload: {
          deviceId: DEVICE_ID,
          text: "Hi",
          toNodeId: 1,
          channelIndex: 8,
        },
      });
      expect(result.success).toBe(false);
    });

    it("rejects a non-UUID deviceId", () => {
      const result = clientCommandSchema.safeParse({
        type: "message:send",
        payload: { deviceId: "not-a-uuid", text: "Hi", toNodeId: 1, channelIndex: 0 },
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing deviceId", () => {
      const result = clientCommandSchema.safeParse({
        type: "message:send",
        payload: { text: "Hi", toNodeId: 1, channelIndex: 0 },
      });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("packets:subscribe", () => {
    it("accepts enabled=true", () => {
      const result = clientCommandSchema.safeParse({
        type: "packets:subscribe",
        payload: { deviceId: DEVICE_ID, enabled: true },
      });
      expect(result.success).toBe(true);
    });

    it("accepts enabled=false", () => {
      const result = clientCommandSchema.safeParse({
        type: "packets:subscribe",
        payload: { deviceId: DEVICE_ID, enabled: false },
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing enabled", () => {
      const result = clientCommandSchema.safeParse({
        type: "packets:subscribe",
        payload: { deviceId: DEVICE_ID },
      });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("messages:request-history", () => {
    it("accepts minimal payload (only required fields)", () => {
      const result = clientCommandSchema.safeParse({
        type: "messages:request-history",
        payload: { deviceId: DEVICE_ID },
      });
      expect(result.success).toBe(true);
    });

    it("defaults limit to 100 when omitted", () => {
      const result = clientCommandSchema.safeParse({
        type: "messages:request-history",
        payload: { deviceId: DEVICE_ID },
      });
      expect(result.success).toBe(true);
      if (result.success && result.data.type === "messages:request-history") {
        expect(result.data.payload.limit).toBe(100);
      }
    });

    it("accepts all optional fields", () => {
      const result = clientCommandSchema.safeParse({
        type: "messages:request-history",
        payload: {
          deviceId: DEVICE_ID,
          channelIndex: 2,
          toNodeId: 9999,
          limit: 50,
          before: "2025-01-01T00:00:00.000Z",
        },
      });
      expect(result.success).toBe(true);
    });

    it("rejects limit of 0", () => {
      const result = clientCommandSchema.safeParse({
        type: "messages:request-history",
        payload: { deviceId: DEVICE_ID, limit: 0 },
      });
      expect(result.success).toBe(false);
    });

    it("rejects limit above 500", () => {
      const result = clientCommandSchema.safeParse({
        type: "messages:request-history",
        payload: { deviceId: DEVICE_ID, limit: 501 },
      });
      expect(result.success).toBe(false);
    });

    it("rejects a non-ISO-8601 before timestamp", () => {
      const result = clientCommandSchema.safeParse({
        type: "messages:request-history",
        payload: { deviceId: DEVICE_ID, before: "not-a-date" },
      });
      expect(result.success).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  describe("unknown type", () => {
    it("rejects a completely unknown command type", () => {
      const result = clientCommandSchema.safeParse({
        type: "device:explode",
        payload: {},
      });
      expect(result.success).toBe(false);
    });

    it("rejects a missing type field", () => {
      const result = clientCommandSchema.safeParse({ payload: {} });
      expect(result.success).toBe(false);
    });

    it("rejects non-object input", () => {
      expect(clientCommandSchema.safeParse(null).success).toBe(false);
      expect(clientCommandSchema.safeParse("string").success).toBe(false);
      expect(clientCommandSchema.safeParse(42).success).toBe(false);
    });
  });
});
