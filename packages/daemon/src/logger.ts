export interface LogContext {
  deviceId?: string;
  packetId?: string | number;
  operation?: string;
  err?: unknown;
  [key: string]: unknown;
}

export interface Logger {
  info(context: LogContext, message: string): void;
  warn(context: LogContext, message: string): void;
  error(context: LogContext, message: string): void;
}

/**
 * Application logging convention:
 * - create one logger per module with a stable UI tag;
 * - pass deviceId, packetId, operation, and err as structured context when applicable;
 * - keep the message human-readable and never place secrets or decrypted payloads in context.
 *
 * Output intentionally uses console so ConsoleLog continues feeding the live activity UI.
 */
export function createLogger(tag: string): Logger {
  const write = (level: "info" | "warn" | "error", context: LogContext, message: string) => {
    const fields = serializeContext(context);
    const line = `[${tag}] ${message}${fields ? ` ${fields}` : ""}`;
    if (level === "warn") console.warn(line);
    else if (level === "error") console.error(line);
    else console.log(line);
  };

  return {
    info: (context, message) => write("info", context, message),
    warn: (context, message) => write("warn", context, message),
    error: (context, message) => write("error", context, message),
  };
}

function serializeContext(context: LogContext): string {
  if (Object.keys(context).length === 0) return "";
  return JSON.stringify(context, (_key, value: unknown) => {
    if (value instanceof Error) {
      return {
        name: value.name,
        message: value.message,
        ...(value.cause === undefined ? {} : { cause: value.cause }),
      };
    }
    return typeof value === "bigint" ? value.toString() : value;
  });
}
