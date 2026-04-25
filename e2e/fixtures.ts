import { test as base, expect, type Page } from "@playwright/test";

import { createAdminClient, findTestUserId, purgeUserData, requiredEnv } from "./db";

/**
 * e2e 共通 fixture (ADR 0011)。
 *
 * `signedInPage` を使うと:
 *   1. service_role で当該ユーザーの projects / tasks / events / action_logs を purge する
 *      (前回テスト or リトライから残ったデータでアサーションが壊れないように)
 *   2. localStorage に `kozutsumi.sample-data.v1=cleared` を先行書き込み
 *      (AppShell の自動 seed を止める)
 *   3. /login に遷移し、テスト用 password sign-in フォームで認証
 *   4. / へリダイレクトされるのを待って返す
 */
type Fixtures = {
  signedInPage: Page;
};

export const test = base.extend<Fixtures>({
  signedInPage: async ({ page, baseURL }, use) => {
    const email = requiredEnv("E2E_TEST_USER_EMAIL");
    const password = requiredEnv("E2E_TEST_USER_PASSWORD");

    // --- 1. DB を per-test で clean に戻す ---------------------------------
    // global-setup の purge は 1 回しか走らないため、retry や複数 spec 間で
    // データが持ち越される。ここで毎回 purge して isolation を保つ。
    const admin = createAdminClient();
    const userId = await findTestUserId(admin, email);
    if (userId) {
      await purgeUserData(admin, userId);
    }

    // --- 2. AppShell の自動 seed を止める -----------------------------------
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("kozutsumi.sample-data.v1", "cleared");
      } catch {
        // private mode 等で書けなくても test は続行できる
      }
    });

    // --- 3. password sign-in でログイン ------------------------------------
    await page.goto(`${baseURL ?? ""}/login`);
    await expect(page.getByTestId("e2e-login-form")).toBeVisible();
    await page.getByTestId("e2e-login-email").fill(email);
    await page.getByTestId("e2e-login-password").fill(password);
    await page.getByTestId("e2e-login-submit").click();

    // hard nav (window.location.assign) で / に遷移するので load イベントが取れる。
    await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });

    await use(page);
  },
});

export { expect };
