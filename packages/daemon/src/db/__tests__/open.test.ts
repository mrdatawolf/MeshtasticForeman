import { mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Worker } from "node:worker_threads";

import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { clearDbLock, openDb } from "../open.js";

const originalExecArgv = [...process.execArgv];

beforeAll(() => {
  // The daemon normally runs under tsx. Vitest does not, and openDb forwards
  // this array to its TypeScript worker, so supply the existing loader here.
  process.execArgv.push("--import", "tsx/esm");
});

afterAll(() => {
  process.execArgv.splice(0, process.execArgv.length, ...originalExecArgv);
});

function makeDataDir(): string {
  return mkdtempSync(join(tmpdir(), "foreman-pglite-proxy-"));
}

function underlyingWorker(db: PGlite): Worker {
  // PGliteProxy intentionally keeps its Worker private. Reaching through that
  // compile-time boundary is the least invasive way to characterize its real
  // Worker error/exit handlers without adding a production-only test hook.
  return (db as unknown as { worker: Worker }).worker;
}

/*
 * db/client.ts uses an eager module-level singleton, so it cannot be cleanly
 * instantiated per test like openDb(). Its PGliteProxy query, exec,
 * transaction, queue/drain, pending-request, and worker error/exit methods are
 * structurally identical to open.ts at the time of this characterization.
 * This suite targets open.ts because TASK-012 will retain that module.
 */

describe("PGlite worker proxy", () => {
  const dataDir = makeDataDir();
  let db: PGlite;

  afterAll(async () => {
    await db?.close();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("executes query and propagates SQL errors from the worker", async () => {
    db = await openDb(dataDir);

    const result = await db.query<{ answer: number }>("SELECT 42::integer AS answer");
    expect(result.rows).toEqual([{ answer: 42 }]);

    await expect(db.query("SELECT FROM definitely invalid SQL")).rejects.toThrow();
  });

  it("executes SQL and makes its effects observable by query", async () => {
    await db.exec("CREATE TABLE exec_items (id integer PRIMARY KEY, value text NOT NULL)");
    await db.exec("INSERT INTO exec_items VALUES (1, 'created by exec')");

    const result = await db.query<{ id: number; value: string }>(
      "SELECT id, value FROM exec_items",
    );
    expect(result.rows).toEqual([{ id: 1, value: "created by exec" }]);
  });

  it("commits a successful transaction", async () => {
    await db.exec("CREATE TABLE committed_items (id integer PRIMARY KEY, value text NOT NULL)");

    const callbackResult = await db.transaction(async (tx) => {
      await tx.query("INSERT INTO committed_items VALUES ($1, $2)", [1, "committed"]);
      return "callback result";
    });

    expect(callbackResult).toBe("callback result");
    const result = await db.query<{ value: string }>("SELECT value FROM committed_items");
    expect(result.rows).toEqual([{ value: "committed" }]);
  });

  it("rolls back a transaction when its callback throws", async () => {
    await db.exec("CREATE TABLE rolled_back_items (id integer PRIMARY KEY)");
    const callbackError = new Error("abort transaction");

    await expect(
      db.transaction(async (tx) => {
        await tx.exec("INSERT INTO rolled_back_items VALUES (1)");
        throw callbackError;
      }),
    ).rejects.toBe(callbackError);

    const result = await db.query<{ count: number }>(
      "SELECT count(*)::integer AS count FROM rolled_back_items",
    );
    expect(result.rows).toEqual([{ count: 0 }]);
  });

  it("drains calls sequentially in submission order", async () => {
    const create = db.exec("CREATE TABLE queued_items (id integer PRIMARY KEY, value text)");
    const first = db.exec("INSERT INTO queued_items VALUES (1, 'first')");
    const second = db.exec("INSERT INTO queued_items VALUES (2, 'second')");
    const observed = db.query<{ id: number; value: string }>(
      "SELECT id, value FROM queued_items ORDER BY id",
    );

    await expect(Promise.all([create, first, second, observed])).resolves.toBeDefined();
    expect((await observed).rows).toEqual([
      { id: 1, value: "first" },
      { id: 2, value: "second" },
    ]);
  });
});

describe("PGlite worker lifecycle", () => {
  it("rejects a pending request when the worker emits an error", async () => {
    const dataDir = makeDataDir();
    const db = await openDb(dataDir);
    const worker = underlyingWorker(db);
    const pending = db.query("SELECT pg_sleep(30)");
    const workerError = new Error("injected worker failure");

    try {
      worker.emit("error", workerError);
      await expect(pending).rejects.toBe(workerError);
    } finally {
      await worker.terminate();
      await db.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("rejects pending and subsequent requests after the worker exits", async () => {
    const dataDir = makeDataDir();
    const db = await openDb(dataDir);
    const worker = underlyingWorker(db);
    const pending = db.query("SELECT pg_sleep(30)");

    try {
      await worker.terminate();
      await expect(pending).rejects.toThrow(/PGlite worker exited with code/);
      await expect(db.query("SELECT 1")).rejects.toThrow("PGlite worker is not running");
    } finally {
      await db.close();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe("clearDbLock", () => {
  it("removes a stale postmaster.pid", () => {
    const dataDir = makeDataDir();
    const lockFile = join(dataDir, "postmaster.pid");

    try {
      writeFileSync(lockFile, "stale lock");
      clearDbLock(dataDir);
      expect(existsSync(lockFile)).toBe(false);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("does not throw when postmaster.pid is absent", () => {
    const dataDir = makeDataDir();

    try {
      expect(() => clearDbLock(dataDir)).not.toThrow();
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
