import { EventEmitter } from "node:events";

import type { LogEntry } from "@foreman/shared";

const MAX_ENTRIES = 500;
// Matches "[tag]" at the start of a log line, e.g. "[devices]", "[mqtt]"
const TAG_RE = /^\[([^\]]+)\]/;

export class ConsoleLog extends EventEmitter {
  private entries: LogEntry[] = [];
  private seq = 0;

  add(level: LogEntry["level"], args: unknown[]): void {
    const text = args
      .map((a) => (typeof a === "string" ? a : a instanceof Error ? a.message : String(a)))
      .join(" ");
    const match = TAG_RE.exec(text);
    const tag = match ? match[1] : "";
    const entry: LogEntry = { id: ++this.seq, ts: new Date().toISOString(), level, tag, text };
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    this.emit("entry", entry);
  }

  snapshot(): LogEntry[] {
    return [...this.entries];
  }

  /** Monkey-patch console.log/warn/error to also feed this buffer. */
  install(): void {
    const origLog = console.log.bind(console);
    const origWarn = console.warn.bind(console);
    const origError = console.error.bind(console);
    console.log = (...args: unknown[]) => {
      origLog(...args);
      this.add("log", args);
    };
    console.warn = (...args: unknown[]) => {
      origWarn(...args);
      this.add("warn", args);
    };
    console.error = (...args: unknown[]) => {
      origError(...args);
      this.add("error", args);
    };
  }
}

export const consoleLog = new ConsoleLog();
