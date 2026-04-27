import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright e2e 設定 (ADR 0011 / 0014)。
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
 * AI_ENABLED=false で `/api/ai/*` を全面バイパス (ADR 0014)。Gemini quota を消費せず、
 * LLM の非決定性を踏まない。core 機能が AI 抜きで成立することを e2e で踏む。
 */
const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  // worker 間 isolation は per-worker test user (e2e/users.ts) で担保。
  // ローカルは 1 worker (debug しやすさ + Supabase 1 stack の負荷上限)、
  // CI は 4 worker (ubuntu-latest 2 vCPU + 7GB RAM 想定の上限近く)。
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 4 : 1,
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
      AI_ENABLED: "false",
    },
  },
});
