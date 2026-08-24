import { randomUUID } from "node:crypto";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import type { PGlite, Results } from "@electric-sql/pglite";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.PGLITE_DIR ?? join(__dirname, "../../../../pglite-data");

// ---------------------------------------------------------------------------
// Worker-thread proxy — runs PGlite in a worker so WASM initdb works on Windows
// ---------------------------------------------------------------------------

class PGliteProxy {
  private pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >();
  private queue: Array<() => Promise<void>> = [];
  private draining = false;
  private dead = false;

  constructor(private readonly worker: Worker) {
    worker.on(
      "message",
      (msg: { id?: string; error?: { message: string; code?: string }; result?: unknown }) => {
        if (!msg.id) return;
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) {
          p.reject(Object.assign(new Error(msg.error.message), msg.error));
        } else {
          p.resolve(msg.result);
        }
      },
    );

    worker.on("error", (err) => {
      console.error("[db] PGlite worker error:", err.message);
      this._killPending(err);
    });

    worker.on("exit", (code) => {
      this.dead = true;
      if (code !== 0) console.error(`[db] PGlite worker exited with code ${code}`);
      this._killPending(new Error(`PGlite worker exited with code ${code}`));
    });
  }

  private _killPending(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }

  private _send<T>(type: string, sql?: string, params?: unknown[]): Promise<T> {
    if (this.dead) return Promise.reject(new Error("PGlite worker is not running"));
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ id, type, sql, params });
    });
  }

  private _enqueue<T>(fn: () => Promise<T>): Promise<T> {
    if (this.dead) return Promise.reject(new Error("PGlite worker is not running"));
    return new Promise((resolve, reject) => {
      this.queue.push(async () => {
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        }
      });
      this._drain();
    });
  }

  private async _drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    while (this.queue.length > 0) {
      const fn = this.queue.shift()!;
      await fn();
    }
    this.draining = false;
  }

  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<Results<T>> {
    return this._enqueue(() => this._send<Results<T>>("query", sql, params));
  }

  exec(sql: string): Promise<void> {
    return this._enqueue(() => this._send<void>("exec", sql));
  }

  async transaction<T>(
    callback: (tx: { query: PGliteProxy["query"]; exec: PGliteProxy["exec"] }) => Promise<T>,
  ): Promise<T> {
    return this._enqueue(async () => {
      await this._send("exec", "BEGIN");
      const tx = {
        query: <R extends Record<string, unknown> = Record<string, unknown>>(
          s: string,
          p?: unknown[],
        ) => this._send<Results<R>>("query", s, p),
        exec: (s: string) => this._send<void>("exec", s),
      };
      try {
        const result = await callback(tx as Parameters<typeof callback>[0]);
        await this._send("exec", "COMMIT");
        return result;
      } catch (err) {
        try {
          await this._send("exec", "ROLLBACK");
        } catch {
          /* ignore */
        }
        throw err;
      }
    });
  }

  async close(): Promise<void> {
    if (!this.dead) {
      await this._send("close").catch(() => {});
      await this.worker.terminate();
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

async function createDb(): Promise<PGlite> {
  const workerPath = resolve(__dirname, "pglite.thread.ts");

  const worker = new Worker(workerPath, {
    workerData: { dataDir: DATA_DIR },
    execArgv: [...process.execArgv],
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("PGlite worker failed to become ready in 30s")),
      30_000,
    );
    worker.once("message", (msg: { type: string }) => {
      clearTimeout(timer);
      if (msg.type === "ready") resolve();
      else reject(new Error(`Unexpected init message: ${JSON.stringify(msg)}`));
    });
    worker.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Worker exited during init with code ${code}`));
    });
  });

  console.log(`[db] PGlite ready at ${DATA_DIR}`);
  return new PGliteProxy(worker) as unknown as PGlite;
}

export const db = await createDb();
