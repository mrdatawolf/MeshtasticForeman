import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Each file runs in its own fork so in-memory PGlite state is isolated
    pool: "forks",
    // PGlite startup and the TypeScript database worker are CPU heavy. Under
    // `pnpm test`, which runs every package at once, they can exceed the 5 s default.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
