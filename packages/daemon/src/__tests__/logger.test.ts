import { afterEach, describe, expect, it, vi } from "vitest";

import { ConsoleLog } from "../activity/console-log.js";
import { createLogger } from "../logger.js";

describe("structured logger", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits tagged human-readable output with structured context", () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const logger = createLogger("devices");

    logger.error(
      { deviceId: "dev-1", packetId: 42, operation: "decode", err: new Error("bad packet") },
      "packet handling failed",
    );

    expect(output).toHaveBeenCalledWith(
      '[devices] packet handling failed {"deviceId":"dev-1","packetId":42,"operation":"decode","err":{"name":"Error","message":"bad packet"}}',
    );
  });

  it("continues feeding ConsoleLog tag/text entries through console output", () => {
    const consoleLog = new ConsoleLog();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    consoleLog.install();

    createLogger("mqtt").info({ operation: "connect" }, "connected");

    expect(consoleLog.snapshot()).toMatchObject([
      {
        level: "log",
        tag: "mqtt",
        text: '[mqtt] connected {"operation":"connect"}',
      },
    ]);
  });
});
