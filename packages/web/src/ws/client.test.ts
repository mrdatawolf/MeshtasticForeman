import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ForemanClient } from "./client.js";

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = 0;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(url: string | URL) {
    this.url = url.toString();
    FakeWebSocket.instances.push(this);
  }

  close() {}
  send(_data: string) {}
}

describe("ForemanClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("opens a WebSocket for the configured URL and wires its event handlers", () => {
    const client = new ForemanClient("ws://localhost:3750/ws");

    client.connect();

    expect(FakeWebSocket.instances).toHaveLength(1);
    const socket = FakeWebSocket.instances[0]!;
    expect(socket.url).toBe("ws://localhost:3750/ws");
    expect(socket.onopen).toBeTypeOf("function");
    expect(socket.onmessage).toBeTypeOf("function");
    expect(socket.onclose).toBeTypeOf("function");
    expect(socket.onerror).toBeTypeOf("function");
  });

  it("reconnects two seconds after an unexpected close", () => {
    const client = new ForemanClient("ws://localhost:3750/ws");
    client.connect();

    FakeWebSocket.instances[0]!.onclose!({} as CloseEvent);
    expect(FakeWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(1999);
    expect(FakeWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(FakeWebSocket.instances[1]!.url).toBe("ws://localhost:3750/ws");
  });

  it("does not reconnect after a manual disconnect", () => {
    const client = new ForemanClient("ws://localhost:3750/ws");
    client.connect();
    const socket = FakeWebSocket.instances[0]!;

    client.disconnect();
    socket.onclose!({} as CloseEvent);
    vi.advanceTimersByTime(2000);

    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
