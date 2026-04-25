import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    css: false,
    // e2e/ は Playwright (playwright.config.ts) で動かすので vitest 対象外。
    exclude: ["node_modules/**", "e2e/**", ".next/**", "dist/**"],
  },
});
