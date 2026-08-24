import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

import type { ProxyOptions } from "vite";

const require = createRequire(import.meta.url);
const rootPkg = require("../../package.json") as { version: string };

const __dirname = dirname(fileURLToPath(import.meta.url));

const suppress: ProxyOptions["configure"] = (proxy) => {
  proxy.on("error", () => {});
  proxy.on("proxyReqWs", (_req, _socket, _head, _opts, err) => {
    if (err) (err as Error & { handled?: boolean }).handled = true;
  });
};

export default defineConfig(({ mode }) => {
  // Load root .env so all API_* and FRONTEND_* vars are available
  const env = loadEnv(mode, resolve(__dirname, "../../"), "");

  const apiPort = env.API_PORT ?? "3750";
  const apiUri = env.API_URI ?? "http://localhost";
  const frontendHost = env.FRONTEND_HOST ?? "0.0.0.0";
  const frontendPort = Number(env.FRONTEND_PORT ?? 5173);

  const apiBase = `${apiUri}:${apiPort}`;
  const wsBase = apiBase.replace(/^http/, "ws");

  return {
    plugins: [react()],
    server: {
      host: frontendHost,
      port: frontendPort,
      proxy: {
        "/api": {
          target: apiBase,
          configure: suppress,
        },
        "/ws": {
          target: wsBase,
          ws: true,
          configure: suppress,
        },
      },
    },
    define: {
      __APP_VERSION__: JSON.stringify(rootPkg.version),
    },
    envDir: resolve(__dirname, "../../"),
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
  };
});
