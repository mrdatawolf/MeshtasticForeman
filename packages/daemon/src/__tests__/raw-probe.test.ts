/**
 * Raw serial probe tests. `serialport` is replaced with a fake, so nothing here
 * can touch a real port.
 */

import { EventEmitter } from "node:events";

import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { Protobuf } from "@meshtastic/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProbeFrameReader,
  encodeWantConfig,
  runRawProbe,
  RADIO_RESPONSE_WINDOW_MS,
} from "../device/raw-probe.js";

const serial = vi.hoisted(() => ({
  instances: [] as FakeSerial[],
  openError: null as Error | null,
  writeError: null as Error | null,
  onWrite: null as ((port: FakeSerial, data: Buffer) => void) | null,
}));

interface FakeSerial extends EventEmitter {
  options: { path: string; baudRate: number };
  isOpen: boolean;
  closeCalls: number;
  written: Buffer[];
}

vi.mock("serialport", async () => {
  const { EventEmitter: Emitter } = await import("node:events");
  class SerialPort extends Emitter {
    isOpen = false;
    closeCalls = 0;
    written: Buffer[] = [];
    constructor(public options: { path: string; baudRate: number }) {
      super();
      serial.instances.push(this as unknown as FakeSerial);
    }
    open(callback: (err: Error | null) => void) {
      this.isOpen = serial.openError === null;
      callback(serial.openError);
    }
    write(data: Buffer, callback?: (err: Error | null) => void) {
      this.written.push(data);
      callback?.(serial.writeError);
      serial.onWrite?.(this as unknown as FakeSerial, data);
    }
    close(callback: (err: Error | null) => void) {
      this.closeCalls += 1;
      this.isOpen = false;
      callback(null);
    }
  }
  return { SerialPort };
});

function frame(payload: Uint8Array): Buffer {
  const header = Buffer.from([0x94, 0xc3, payload.length >> 8, payload.length & 0xff]);
  return Buffer.concat([header, payload]);
}

function configComplete(id: number): Buffer {
  const message = create(Protobuf.Mesh.FromRadioSchema, {
    payloadVariant: { case: "configCompleteId", value: id },
  });
  return frame(toBinary(Protobuf.Mesh.FromRadioSchema, message));
}

function myInfo(myNodeNum: number): Buffer {
  const message = create(Protobuf.Mesh.FromRadioSchema, {
    id: 5,
    payloadVariant: {
      case: "myInfo",
      value: create(Protobuf.Mesh.MyNodeInfoSchema, { myNodeNum }),
    },
  });
  return frame(toBinary(Protobuf.Mesh.FromRadioSchema, message));
}

/** Reads the nonce back out of the request the probe wrote, using the real schema. */
function sentNonce(data: Buffer): number {
  const message = fromBinary(Protobuf.Mesh.ToRadioSchema, data.subarray(4));
  expect(message.payloadVariant.case).toBe("wantConfigId");
  return message.payloadVariant.value as number;
}

const answerWith = (build: (nonce: number) => Buffer[]) => (port: FakeSerial, data: Buffer) => {
  if (data[0] !== 0x94) return;
  for (const chunk of build(sentNonce(data))) port.emit("data", chunk);
};

describe("probe wire format", () => {
  it("encodes wantConfigId so the real schema reads it back", () => {
    for (const nonce of [1, 127, 128, 0x7fff_ffff, 0xffff_fffe]) {
      expect(sentNonce(encodeWantConfig(nonce))).toBe(nonce);
    }
  });

  it("reads real FromRadio messages", () => {
    const reader = new ProbeFrameReader(0xfedc_ba98);
    reader.push(myInfo(0xdead_beef));
    reader.push(configComplete(0xfedc_ba98));
    expect(reader.framesReceived).toBe(2);
    expect(reader.ownNodeId).toBe(0xdead_beef);
    expect(reader.configCompleted).toBe(true);
  });

  it("reassembles frames split across chunks and skips debug text between them", () => {
    const reader = new ProbeFrameReader(99);
    const stream = Buffer.concat([
      Buffer.from("INFO | booting\r\n"),
      myInfo(42),
      Buffer.from("more log text"),
      configComplete(99),
    ]);
    for (const byte of stream) reader.push(Buffer.from([byte]));
    expect(reader.framesReceived).toBe(2);
    expect(reader.configCompleted).toBe(true);
  });

  it("does not stall on a false frame start with an impossible length", () => {
    const reader = new ProbeFrameReader(7);
    reader.push(Buffer.from([0x94, 0xc3, 0xff, 0xff]));
    reader.push(configComplete(7));
    expect(reader.configCompleted).toBe(true);
  });

  it("does not accept a completion with a different nonce", () => {
    const reader = new ProbeFrameReader(7);
    reader.push(configComplete(8));
    expect(reader.configCompleted).toBe(false);
    expect(reader.framesReceived).toBe(1);
  });
});

describe("runRawProbe", () => {
  const signal = new AbortController().signal;

  beforeEach(() => {
    vi.useFakeTimers();
    serial.instances.length = 0;
    serial.openError = null;
    serial.writeError = null;
    serial.onWrite = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports healthy and stops as soon as config completes with the nonce", async () => {
    serial.onWrite = answerWith((nonce) => [myInfo(1234), configComplete(nonce)]);

    const result = await runRawProbe("/dev/ttyUSB0", signal);

    expect(result.outcome).toBe("healthy");
    expect(result.framesReceived).toBe(2);
    expect(result.ownNodeId).toBe(1234);
    expect(result.bytesReceived).toBeGreaterThan(0);
    expect(result.durationMs).toBe(0);
    expect(serial.instances[0].isOpen).toBe(false);
  });

  it("opens only the given port, at 115200, once", async () => {
    serial.onWrite = answerWith((nonce) => [configComplete(nonce)]);
    await runRawProbe("/dev/ttyUSB3", signal);

    expect(serial.instances).toHaveLength(1);
    expect(serial.instances[0].options).toMatchObject({ path: "/dev/ttyUSB3", baudRate: 115200 });
  });

  it("sends wake bytes and the request at once, with no passive wait, and nothing else", async () => {
    const probe = runRawProbe("/dev/ttyUSB0", signal);
    await Promise.resolve();
    await Promise.resolve();

    const port = serial.instances[0];
    expect(port.written).toHaveLength(2);
    expect([...port.written[0]].every((byte) => byte === 0xc3)).toBe(true);
    sentNonce(port.written[1]);

    await vi.advanceTimersByTimeAsync(RADIO_RESPONSE_WINDOW_MS);
    await probe;
    expect(port.written).toHaveLength(2);
  });

  it("uses a fresh nonce each run", async () => {
    const nonces: number[] = [];
    serial.onWrite = answerWith((nonce) => {
      nonces.push(nonce);
      return [configComplete(nonce)];
    });
    await runRawProbe("/dev/ttyUSB0", signal);
    await runRawProbe("/dev/ttyUSB0", signal);
    expect(nonces[0]).not.toBe(nonces[1]);
  });

  it("reports no-response after the window when no bytes arrive", async () => {
    const probe = runRawProbe("/dev/ttyUSB0", signal);
    await vi.advanceTimersByTimeAsync(RADIO_RESPONSE_WINDOW_MS);

    await expect(probe).resolves.toMatchObject({
      outcome: "no-response",
      bytesReceived: 0,
      framesReceived: 0,
      ownNodeId: null,
      durationMs: RADIO_RESPONSE_WINDOW_MS,
    });
    expect(serial.instances[0].isOpen).toBe(false);
  });

  it("reports partial when bytes arrive but config does not complete", async () => {
    serial.onWrite = answerWith(() => [myInfo(55), Buffer.from([0x94, 0xc3, 0x00])]);
    const probe = runRawProbe("/dev/ttyUSB0", signal);
    await vi.advanceTimersByTimeAsync(RADIO_RESPONSE_WINDOW_MS);

    await expect(probe).resolves.toMatchObject({
      outcome: "partial",
      framesReceived: 1,
      ownNodeId: 55,
    });
    expect(serial.instances[0].isOpen).toBe(false);
  });

  it("reports partial when config completes with the wrong nonce", async () => {
    serial.onWrite = answerWith((nonce) => [configComplete(nonce + 1)]);
    const probe = runRawProbe("/dev/ttyUSB0", signal);
    await vi.advanceTimersByTimeAsync(RADIO_RESPONSE_WINDOW_MS);
    await expect(probe).resolves.toMatchObject({ outcome: "partial", framesReceived: 1 });
  });

  it("reports open-failed when the port cannot be opened", async () => {
    serial.openError = new Error("Cannot lock port");

    await expect(runRawProbe("/dev/ttyUSB0", signal)).resolves.toMatchObject({
      outcome: "open-failed",
      bytesReceived: 0,
    });
    expect(serial.instances[0].written).toHaveLength(0);
    expect(serial.instances[0].closeCalls).toBe(0);
  });

  it("closes the port when a write fails", async () => {
    serial.writeError = new Error("write failed");

    await expect(runRawProbe("/dev/ttyUSB0", signal)).resolves.toMatchObject({
      outcome: "no-response",
    });
    expect(serial.instances[0].closeCalls).toBe(1);
  });

  it("stops early and closes when the port goes away mid-read", async () => {
    serial.onWrite = (port, data) => {
      if (data[0] !== 0x94) return;
      port.emit("data", Buffer.from("x"));
      port.emit("error", new Error("device unplugged"));
      port.emit("close");
    };

    await expect(runRawProbe("/dev/ttyUSB0", signal)).resolves.toMatchObject({
      outcome: "partial",
    });
    expect(serial.instances[0].isOpen).toBe(false);
  });

  it("stops early and closes when aborted", async () => {
    const abort = new AbortController();
    const probe = runRawProbe("/dev/ttyUSB0", abort.signal);
    await Promise.resolve();
    await Promise.resolve();
    abort.abort();

    await expect(probe).resolves.toMatchObject({ outcome: "no-response", durationMs: 0 });
    expect(serial.instances[0].closeCalls).toBe(1);
  });

  it("writes nothing when aborted before the port opened", async () => {
    const abort = new AbortController();
    abort.abort();

    await runRawProbe("/dev/ttyUSB0", abort.signal);
    expect(serial.instances[0].written).toHaveLength(0);
    expect(serial.instances[0].closeCalls).toBe(1);
  });
});
