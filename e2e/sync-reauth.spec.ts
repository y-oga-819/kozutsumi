import { expect, test } from "./fixtures";

/**
 * Issue #67 🟨 11:
 *   `/api/calendar/sync` が 401 (provider_token_missing) を返した時に
 *   `ReauthBanner` が表示され、ユーザーが Google と再連携できる状態に戻れること。
 *
 * 構造的に幸いなことに、e2e テストユーザーは password sign-in (ADR 0011) で
 * 作られていて Google OAuth を経ていないため、`provider_token` を持っていない。
 * そのため `/api/calendar/sync` は **本物の** 401 (provider_token_missing) を
 * 返す。`useLazyCalendarSync` (起動時遅延同期, ADR 0007) が初回マウント時に
 * 必ず発火するので、それだけで 401 → ReauthBanner の経路が踏める。
 *
 * これは「e2e で 401 を再現するために fetch を mock する」より素直で、
 * 本番経路 (route handler / useCalendarSync) のロジックを実物のまま通せる。
 */
test.describe("calendar 同期 401 ハンドリング (ReauthBanner)", () => {
  test("provider_token を持たない state で 401 を受けると ReauthBanner が表示される", async ({
    signedInPage: page,
  }) => {
    // ReauthBanner の root は role="alert"、文言は固定 (ReauthBanner.tsx L51-56)。
    const banner = page
      .getByRole("alert")
      .filter({ hasText: "Google カレンダーの連携が失効しました" });

    // useLazyCalendarSync は mount 後の useEffect で fire するので少し待つ。
    // 401 → setNeedsReauth(true) → banner 描画までを 15s で待つ。
    await expect(banner).toBeVisible({ timeout: 15_000 });

    // 再連携ボタンも見えていること (押下で signInWithOAuth が走る経路は OAuth 本体
    // を踏むので e2e のスコープ外。ボタン presence までで止める)。
    await expect(banner.getByRole("button", { name: /Google と連携し直す/ })).toBeVisible();
  });

  test("ReauthBanner は × ボタンで dismiss できる", async ({ signedInPage: page }) => {
    const banner = page
      .getByRole("alert")
      .filter({ hasText: "Google カレンダーの連携が失効しました" });
    await expect(banner).toBeVisible({ timeout: 15_000 });

    await banner.getByRole("button", { name: "バナーを閉じる" }).click();
    await expect(banner).toHaveCount(0);
  });

  test("手動同期ボタン押下で /api/calendar/sync に POST が再度飛ぶ", async ({
    signedInPage: page,
  }) => {
    const posts: string[] = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().endsWith("/api/calendar/sync")) {
        posts.push(req.url());
      }
    });

    // signedInPage は既に / にいるので、リロードで request listener 設置後に
    // mount を一度通す (lazy sync の POST を確実に補足するため)。
    await page.reload();

    // lazy sync の POST が飛ぶ。応答 (本物の 401) を待ってボタンが enable に
    // 戻るところまで踏む。
    await expect
      .poll(() => posts.length, { message: "lazy sync POST should fire", timeout: 15_000 })
      .toBeGreaterThanOrEqual(1);
    const syncButton = page.getByRole("button", { name: "カレンダーを同期" });
    await expect(syncButton).toBeEnabled({ timeout: 15_000 });

    const before = posts.length;
    await syncButton.click();

    await expect
      .poll(() => posts.length, { message: "manual sync POST should fire", timeout: 15_000 })
      .toBeGreaterThanOrEqual(before + 1);
  });
});
