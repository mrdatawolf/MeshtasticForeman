import { PGlite } from "@electric-sql/pglite";
import { parentPort, workerData } from "node:worker_threads";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";

if (!parentPort) throw new Error("Must be run as a worker thread");

const port = parentPort;
const { dataDir } = workerData;

function prepareDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
  // Remove stale postmaster.pid left by a previous unclean shutdown.
  const pidFile = join(dir, "postmaster.pid");
  if (existsSync(pidFile)) rmSync(pidFile);
}

async function init(reset = false): Promise<void> {
  if (reset) {
    console.warn("[db] WASM abort on previous attempt — wiping data dir and starting fresh");
    rmSync(dataDir, { recursive: true, force: true });
  }
  prepareDir(dataDir);

  const db = new PGlite(dataDir);

  port.on("message", async (msg: { id: string; type: "query" | "exec" | "close"; sql?: string; params?: unknown[] }) => {
    const { id, type, sql, params } = msg;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let result: any = null;
      if (type === "query") {
        result = await db.query(sql!, params);
      } else if (type === "exec") {
        await db.exec(sql!);
      } else if (type === "close") {
        await db.close();
      }
      port.postMessage({ id, result });
    } catch (err: unknown) {
      const e = err as { message?: string; code?: string };
      port.postMessage({ id, error: { message: e.message, code: e.code } });
    }
  });

  try {
    await db.waitReady;
    port.postMessage({ type: "ready" });
  } catch (err) {
    if (!reset && String(err).includes("RuntimeError")) {
      // Corrupted data dir — remove all listeners so retry won't double-handle msgs
      port.removeAllListeners("message");
      return init(true);
    }
    port.postMessage({ type: "init-error", error: String(err) });
    process.exit(1);
  }
}

await init();
