import { test as base, expect, type Page } from "@playwright/test";

import { createAdminClient, findTestUserId, purgeUserData, requiredEnv } from "./db";
import { getWorkerEmail } from "./users";

/**
 * e2e 共通 fixture (ADR 0011)。
 *
 * `testEmail` / `testUserId`: workers >1 化に伴う per-worker test user。
 *   Playwright の testInfo.parallelIndex で worker を識別し、各 worker は
 *   別 user (e2e-w0@... / e2e-w1@... / ...) を扱う。これによって purge / DB
 *   assert が干渉しない。spec 側は env を読まずに `testEmail` / `testUserId`
 *   を destructure するだけで自分の worker の user に届く。
 *
 * `signedInPage` を使うと:
 *   1. service_role で当該ユーザーの projects / tasks / events / action_logs を purge する
 *      (前回テスト or リトライから残ったデータでアサーションが壊れないように)
 *   2. localStorage に `kozutsumi.sample-data.v1=cleared` を先行書き込み
 *      (AppShell の自動 seed を止める)
 *   3. /login に遷移し、テスト用 password sign-in フォームで認証
 *   4. / へリダイレクトされるのを待って返す
 *
 * `signedInPageWithProject` は `signedInPage` の上にプロジェクト 1 件を作った
 * 状態を返す。プロジェクト名は `projectName` で受け取る (各テストで上書き可)。
 * Issue #67 構造改善: タスク CRUD / DnD / 中断テスト群でプロジェクト作成の
 * 重複セットアップを減らすための fixture。
 */
type Fixtures = {
  testEmail: string;
  testUserId: string;
  signedInPage: Page;
  projectName: string;
  signedInPageWithProject: Page;
};

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  testEmail: async ({}, use, testInfo) => {
    const baseEmail = requiredEnv("E2E_TEST_USER_EMAIL");
    await use(getWorkerEmail(baseEmail, testInfo.parallelIndex));
  },

  testUserId: async ({ testEmail }, use) => {
    const admin = createAdminClient();
    const id = await findTestUserId(admin, testEmail);
    if (!id) {
      throw new Error(`[e2e] test user ${testEmail} must exist (created by global-setup)`);
    }
    await use(id);
  },

  signedInPage: async ({ page, baseURL, testEmail }, use) => {
    const password = requiredEnv("E2E_TEST_USER_PASSWORD");

    // --- 1. DB を per-test で clean に戻す ---------------------------------
    // global-setup の purge は 1 回しか走らないため、retry や複数 spec 間で
    // データが持ち越される。ここで毎回 purge して isolation を保つ。
    const admin = createAdminClient();
    const userId = await findTestUserId(admin, testEmail);
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
    await page.getByTestId("e2e-login-email").fill(testEmail);
    await page.getByTestId("e2e-login-password").fill(password);
    await page.getByTestId("e2e-login-submit").click();

    // hard nav (window.location.assign) で / に遷移するので load イベントが取れる。
    await page.waitForURL((url) => url.pathname === "/", { timeout: 15_000 });

    await use(page);
  },

  // テスト側で `({ projectName: "..." }) => {}` の形で上書きできる。
  // eslint-disable-next-line no-empty-pattern
  projectName: async ({}, use) => {
    await use("E2E プロジェクト");
  },

  signedInPageWithProject: async ({ signedInPage, projectName }, use) => {
    const page = signedInPage;

    // AddPanel を開いて「プロジェクト」タブから 1 件作る。
    // golden-path / action-log spec と同じ a11y locator を使う
    // (skill: kozutsumi-frontend-a11y)。
    await page.getByRole("button", { name: "新規追加" }).click();
    const addDialog = page.getByRole("dialog", { name: "追加メニュー" });
    await addDialog.getByRole("tab", { name: "プロジェクト" }).click();
    await addDialog.getByLabel("名前").fill(projectName);
    await addDialog.getByRole("button", { name: "追加" }).click();
    await expect(addDialog).toHaveCount(0);

    await use(page);
  },
});

export { expect };
