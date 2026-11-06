import { randomInt } from "node:crypto";

import { SerialPort } from "serialport";

import { createLogger } from "../logger.js";

import type { RawProbeResult } from "@foreman/shared";

/** How long a radio has to answer a config request (CONTRACT-013). */
export const RADIO_RESPONSE_WINDOW_MS = 25_000;

/** Some boards treat a 1200 baud open as a bootloader request, so this is the only rate used. */
const PROBE_BAUD_RATE = 115_200;
const PORT_CLOSE_TIMEOUT_MS = 3_000;

const FRAME_START_1 = 0x94;
const FRAME_START_2 = 0xc3;
const MAX_FRAME_PAYLOAD = 512;
/** Wake bytes, as sent by the Meshtastic clients: a run of the second start byte. */
const WAKE_BYTES = Buffer.alloc(32, FRAME_START_2);

// Protobuf field numbers from the Meshtastic mesh.proto. The probe decodes these
// by hand so that it shares no code with the path it is testing. A test checks
// them against the schema in @meshtastic/core.
const TO_RADIO_WANT_CONFIG_ID = 3;
const FROM_RADIO_MY_INFO = 3;
const FROM_RADIO_CONFIG_COMPLETE_ID = 7;
const MY_NODE_INFO_MY_NODE_NUM = 1;

const WIRE_VARINT = 0;
const WIRE_FIXED64 = 1;
const WIRE_LENGTH_DELIMITED = 2;
const WIRE_FIXED32 = 5;

const log = createLogger("devices");

export type RawProbeReading = Omit<RawProbeResult, "reconnecting">;

function encodeVarint(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value;
  while (remaining >= 0x80) {
    bytes.push((remaining % 0x80) | 0x80);
    remaining = Math.floor(remaining / 0x80);
  }
  bytes.push(remaining);
  return bytes;
}

/** Builds a framed ToRadio message holding only `wantConfigId`. */
export function encodeWantConfig(nonce: number): Buffer {
  const payload = [(TO_RADIO_WANT_CONFIG_ID << 3) | WIRE_VARINT, ...encodeVarint(nonce)];
  return Buffer.from([FRAME_START_1, FRAME_START_2, 0, payload.length, ...payload]);
}

function readVarint(data: Buffer, start: number): { value: number; next: number } | null {
  let value = 0;
  let scale = 1;
  for (let index = start; index < data.length && index < start + 10; index++) {
    const byte = data[index];
    value += (byte & 0x7f) * scale;
    scale *= 0x80;
    if (byte < 0x80) return { value, next: index + 1 };
  }
  return null;
}

/** Calls `visit` for each top-level protobuf field and stops at malformed data. */
function forEachField(data: Buffer, visit: (field: number, value: number | Buffer) => void): void {
  let offset = 0;
  while (offset < data.length) {
    const tag = readVarint(data, offset);
    if (!tag) return;
    const field = Math.floor(tag.value / 8);
    const wireType = tag.value % 8;
    offset = tag.next;

    if (wireType === WIRE_VARINT) {
      const varint = readVarint(data, offset);
      if (!varint) return;
      visit(field, varint.value);
      offset = varint.next;
    } else if (wireType === WIRE_LENGTH_DELIMITED) {
      const length = readVarint(data, offset);
      if (!length || length.next + length.value > data.length) return;
      visit(field, data.subarray(length.next, length.next + length.value));
      offset = length.next + length.value;
    } else if (wireType === WIRE_FIXED64) {
      offset += 8;
    } else if (wireType === WIRE_FIXED32) {
      offset += 4;
    } else {
      return;
    }
  }
}

/** Reassembles FromRadio frames from the raw byte stream, skipping debug text between them. */
export class ProbeFrameReader {
  framesReceived = 0;
  ownNodeId: number | null = null;
  configCompleted = false;
  private buffer: Buffer = Buffer.alloc(0);

  constructor(private readonly nonce: number) {}

  push(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const start = this.buffer.indexOf(FRAME_START_1);
      if (start === -1) {
        this.buffer = Buffer.alloc(0);
        return;
      }
      this.buffer = this.buffer.subarray(start);
      if (this.buffer.length < 4) return;

      const length = this.buffer.readUInt16BE(2);
      if (this.buffer[1] !== FRAME_START_2 || length > MAX_FRAME_PAYLOAD) {
        this.buffer = this.buffer.subarray(1);
        continue;
      }
      if (this.buffer.length < 4 + length) return;

      this.readFrame(this.buffer.subarray(4, 4 + length));
      this.buffer = this.buffer.subarray(4 + length);
    }
  }

  private readFrame(payload: Buffer): void {
    this.framesReceived += 1;
    forEachField(payload, (field, value) => {
      if (field === FROM_RADIO_CONFIG_COMPLETE_ID && value === this.nonce) {
        this.configCompleted = true;
      }
      if (field === FROM_RADIO_MY_INFO && Buffer.isBuffer(value)) {
        forEachField(value, (infoField, infoValue) => {
          if (infoField === MY_NODE_INFO_MY_NODE_NUM && typeof infoValue === "number") {
            this.ownNodeId = infoValue === 0 ? this.ownNodeId : infoValue;
          }
        });
      }
    });
  }
}

function openPort(serial: SerialPort): Promise<void> {
  return new Promise((resolve, reject) => {
    serial.open((err) => (err ? reject(err) : resolve()));
  });
}

function closePort(serial: SerialPort, path: string): Promise<void> {
  if (!serial.isOpen) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      log.warn({ operation: "raw-probe", port: path }, "probe port did not confirm close");
      resolve();
    }, PORT_CLOSE_TIMEOUT_MS);
    serial.close((err) => {
      clearTimeout(timeout);
      if (err) log.warn({ operation: "raw-probe", port: path, err }, "probe port close failed");
      resolve();
    });
  });
}

/**
 * Opens the port directly, asks the radio for its config, and reads until config
 * completes with our nonce or the window ends. This deliberately avoids
 * @meshtastic/core and keeps no decoded payloads, so a result says something about
 * the radio and the link rather than about the daemon's read path.
 *
 * The caller must already have released the port.
 */
export async function runRawProbe(
  path: string,
  signal: AbortSignal,
  windowMs = RADIO_RESPONSE_WINDOW_MS,
): Promise<RawProbeReading> {
  const startedAt = Date.now();
  const nonce = randomInt(1, 0xffff_ffff);
  const reader = new ProbeFrameReader(nonce);
  let bytesReceived = 0;

  const reading = (outcome: RawProbeReading["outcome"]): RawProbeReading => ({
    outcome,
    bytesReceived,
    framesReceived: reader.framesReceived,
    ownNodeId: reader.ownNodeId,
    durationMs: Date.now() - startedAt,
  });

  const serial = new SerialPort({ path, baudRate: PROBE_BAUD_RATE, autoOpen: false });
  // A serial error during the read or close must not become an uncaught 'error'.
  serial.on("error", (err) => log.warn({ operation: "raw-probe", port: path, err }, "probe error"));

  try {
    await openPort(serial);
  } catch (err) {
    log.warn({ operation: "raw-probe", port: path, err }, "probe could not open port");
    return reading("open-failed");
  }

  try {
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", finish);
        serial.off("close", finish);
        serial.off("data", onData);
        resolve();
      };
      const onData = (chunk: Buffer) => {
        bytesReceived += chunk.length;
        reader.push(chunk);
        if (reader.configCompleted) finish();
      };
      const timeout = setTimeout(finish, windowMs);

      serial.on("data", onData);
      serial.once("close", finish);
      signal.addEventListener("abort", finish, { once: true });
      if (signal.aborted) {
        finish();
        return;
      }

      serial.write(WAKE_BYTES);
      serial.write(encodeWantConfig(nonce), (err) => {
        if (!err) return;
        log.warn({ operation: "raw-probe", port: path, err }, "probe write failed");
        finish();
      });
    });
  } finally {
    await closePort(serial, path);
  }

  if (reader.configCompleted) return reading("healthy");
  return reading(bytesReceived > 0 ? "partial" : "no-response");
}
