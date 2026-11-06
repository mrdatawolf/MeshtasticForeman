import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    // Lets textContrast.test.ts read stylesheets as text. Normal CSS imports stay stubbed.
    css: { include: [/\?raw/] },
  },
});
