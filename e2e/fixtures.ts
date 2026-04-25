import { test as base, expect, type Page } from "@playwright/test";

/**
 * e2e 共通 fixture (ADR 0011)。
 *
 * `signedInPage` を使うと:
 *   1. localStorage に `kozutsumi.sample-data.v1=cleared` を先行書き込み
 *      (AppShell の自動 seed を止める)
 *   2. /login に遷移し、テスト用 password sign-in フォームで認証
 *   3. / へリダイレクトされるのを待って返す
 */
type Fixtures = {
  signedInPage: Page;
};

export const test = base.extend<Fixtures>({
  signedInPage: async ({ page, baseURL }, use) => {
    const email = process.env.E2E_TEST_USER_EMAIL;
    const password = process.env.E2E_TEST_USER_PASSWORD;
    if (!email || !password) {
      throw new Error("[e2e] E2E_TEST_USER_EMAIL / E2E_TEST_USER_PASSWORD are required");
    }

    // Next.js の localStorage アクセスは navigation 後でないと許可されない。
    // origin を content 付きで渡せる addInitScript を使って、次の goto の前にセット。
    await page.addInitScript(() => {
      try {
        window.localStorage.setItem("kozutsumi.sample-data.v1", "cleared");
      } catch {
        // private mode 等で書けなくても test は続行できる
      }
    });

    await page.goto(`${baseURL ?? ""}/login`);
    await expect(page.getByTestId("e2e-login-form")).toBeVisible();
    await page.getByTestId("e2e-login-email").fill(email);
    await page.getByTestId("e2e-login-password").fill(password);
    await page.getByTestId("e2e-login-submit").click();

    await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });

    await use(page);
  },
});

export { expect };
