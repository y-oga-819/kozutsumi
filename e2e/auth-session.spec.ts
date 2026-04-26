import { expect, test } from "./fixtures";

/**
 * Issue #67 🟨 7 (auth セッション保全):
 *   middleware (`src/shared/supabase/middleware.ts`) が PUBLIC_PATHS 以外を
 *   未ログインで弾き、`/login` に redirect する経路。UserMenu からのログアウト後に
 *   ブラウザバックで保護ページに戻れないことも併せて踏む。
 *
 * これは「実装が壊れていることに気づきにくい」典型例。session 検証ロジックの
 * regression が起きると未ログイン状態でホームが表示される事故が発生し得る。
 */
test.describe("auth セッション保全 (middleware redirect / logout)", () => {
  test("未ログインで `/` にアクセスすると `/login` に redirect される", async ({
    page,
    baseURL,
  }) => {
    // signedInPage を意図的に使わず素の page。Cookie / session が無い状態で
    // 保護パスに踏み込む。middleware が 302 で /login に飛ばす想定。
    await page.goto(`${baseURL ?? ""}/`);
    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
    // login ページの目印 (E2E ログインフォーム or Google OAuth ボタン)
    // が見えることまで踏んで「render が間に合わずに / が一瞬出た」を弾く。
    await expect(page.getByTestId("e2e-login-form")).toBeVisible();
  });

  test("`/tree` のような保護パスも未ログインでは `/login` に redirect される", async ({
    page,
    baseURL,
  }) => {
    // PUBLIC_PATHS の前方一致境界を踏む。`/login`/`/auth/callback` 以外は
    // 全て保護される (middleware.ts L42)。
    await page.goto(`${baseURL ?? ""}/tree`);
    await expect(page).toHaveURL(/\/login(?:\?.*)?$/);
  });

  test("UserMenu からログアウトすると `/login` に戻り、ブラウザバックでも保護ページに戻れない", async ({
    signedInPage: page,
  }) => {
    // ログイン済み状態でホームを開いたところからスタート
    // (signedInPage は / への hard nav を待ってから返す)。
    await expect(page).toHaveURL(/\/$/);

    // UserMenu を開く: アバターは aria-label="アカウントメニュー"
    // (UserMenu.tsx L50)。
    await page.getByRole("button", { name: "アカウントメニュー" }).click();

    // ログアウトボタン: pending 中は文言が「ログアウト中...」になるが、
    // 押下時点では "ログアウト" のはず (UserMenu.tsx L100)。
    await page.getByRole("button", { name: "ログアウト", exact: true }).click();

    // signOut → router.replace("/login") の遷移を待つ。
    await page.waitForURL((url) => url.pathname === "/login", { timeout: 15_000 });
    await expect(page.getByTestId("e2e-login-form")).toBeVisible();

    // ブラウザバック: 直前の history は `/`。middleware が再度 session を検証し、
    // 失効済みなので /login に再 redirect する想定。client routing で戻るため、
    // URL が `/login` のままになる (or 一瞬 `/` を経由してから戻る) のを待つ。
    await page.goBack();
    await page.waitForURL((url) => url.pathname === "/login", { timeout: 15_000 });
    await expect(page.getByTestId("e2e-login-form")).toBeVisible();
  });
});
