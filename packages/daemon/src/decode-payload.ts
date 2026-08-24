/**
 * Shared payload decoding utilities for Meshtastic protobuf packets.
 *
 * Used by both device-manager (serial/BLE) and gateway (MQTT) to decode
 * known packet types into plain JSON-serialisable objects.
 */

import { Buffer } from "node:buffer";

import { fromBinary } from "@bufbuild/protobuf";
import { Protobuf } from "@meshtastic/core";

/**
 * Convert a protobuf object to a plain, JSON-serialisable value.
 * Handles BigInt → number and Uint8Array → base64 string, both of which
 * appear in Meshtastic protobuf messages.
 */
export function toPlainObject(obj: unknown): unknown {
  return JSON.parse(
    JSON.stringify(obj, (_, v) => {
      if (typeof v === "bigint") return Number(v);
      if (v instanceof Uint8Array) return Buffer.from(v).toString("base64");
      return v;
    }),
  );
}

/**
 * Attempt to decode a packet payload based on its portnum name.
 *
 * Returns a plain JSON-serialisable object on success, or null if the portnum
 * is not handled or decoding fails (encrypted / truncated / wrong schema).
 *
 * Portnums decoded:
 *   TELEMETRY_APP    — device metrics, environment metrics, power metrics, air quality
 *   NEIGHBORINFO_APP — neighbor list with per-link SNR
 *   POSITION_APP     — GPS position fix
 */
export function decodePayload(portnumName: string, payload: Uint8Array): unknown {
  if (!payload.length) return null;
  try {
    switch (portnumName) {
      case "TELEMETRY_APP":
        return toPlainObject(fromBinary(Protobuf.Telemetry.TelemetrySchema, payload));
      case "NEIGHBORINFO_APP":
        return toPlainObject(fromBinary(Protobuf.Mesh.NeighborInfoSchema, payload));
      case "POSITION_APP":
        return toPlainObject(fromBinary(Protobuf.Mesh.PositionSchema, payload));
      default:
        return null;
    }
  } catch {
    // Silently ignore — encrypted or malformed payloads are expected
    return null;
  }
}
