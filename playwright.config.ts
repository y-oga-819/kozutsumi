import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright e2e 設定 (ADR 0011)。
 *
 * 想定環境変数 (CI / ローカル両方):
 *   NEXT_PUBLIC_SUPABASE_URL       — supabase status の API URL
 *   NEXT_PUBLIC_SUPABASE_ANON_KEY  — supabase status の anon key
 *   SUPABASE_SERVICE_ROLE_KEY      — supabase status の service_role key (test user 作成用)
 *   E2E_TEST_USER_EMAIL            — 例: e2e@kozutsumi.local
 *   E2E_TEST_USER_PASSWORD         — 任意のローカル専用パスワード
 *
 * webServer は dev サーバーを起動する。NEXT_PUBLIC_E2E_TEST_AUTH=true を渡して
 * login page にテスト用フォームを描画させる。
 */
const PORT = 3000;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 3000",
    url: BASE_URL,
    timeout: 120_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_PUBLIC_E2E_TEST_AUTH: "true",
    },
  },
});
