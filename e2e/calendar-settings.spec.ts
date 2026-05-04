import { expect, test } from "./fixtures";
import { createAdminClient, requiredEnv } from "./db";

/**
 * Issue #144: 設定パネル (SettingsPanel) の wiring e2e。
 *
 * 設計上、Google `calendarList.list` を呼ぶ subscribe フローは provider_token を要求するため
 * password sign-in test user (ADR 0011) では踏めない。本 spec は以下に絞る:
 *
 * 1. UserMenu の「設定」から SettingsPanel が開く
 * 2. service_role で先回りに seed した subscription が一覧表示される
 * 3. 「自動予定化」トグルが PATCH /api/calendar/subscriptions/[id] を発火させる
 *    (期待は API 200 が返ること。RLS と RPC の atomic 切替の挙動はサーバー側 unit / RPC で検証)
 *
 * subscribe / unsubscribe / Google calendarList の経路は本 spec のスコープ外。
 * (Google OAuth を踏まない以上、provider_token_missing でショートサーキットされるため)
 */
test.describe("設定パネル (calendar subscriptions)", () => {
  test("UserMenu → 設定 で SettingsPanel が開き、subscription が表示される", async ({
    signedInPage: page,
    testUserId,
  }) => {
    // service_role で external_account + subscription を seed (test user は migration seed の対象外)
    const admin = createAdminClient();
    const email = requiredEnv("E2E_TEST_USER_EMAIL");

    const { data: account, error: accErr } = await admin
      .from("external_accounts")
      .upsert(
        {
          user_id: testUserId,
          source: "google_calendar",
          external_account_id: email,
          display_name: "(primary)",
        },
        { onConflict: "user_id,source,external_account_id" },
      )
      .select("id")
      .single();
    if (accErr) throw new Error(`[e2e] seed external_account failed: ${accErr.message}`);

    const { data: sub, error: subErr } = await admin
      .from("user_calendar_subscriptions")
      .upsert(
        {
          user_id: testUserId,
          external_account_id: account!.id,
          source: "google_calendar",
          external_calendar_id: "primary",
          auto_promote_to_timeline: true,
          display_name: "(primary)",
        },
        { onConflict: "user_id,external_account_id,external_calendar_id" },
      )
      .select("id, auto_promote_to_timeline")
      .single();
    if (subErr) throw new Error(`[e2e] seed subscription failed: ${subErr.message}`);

    // SettingsPanel は subscriptions/list を fetch するので reload で新鮮な state を取り直す
    await page.reload();

    await page.getByRole("button", { name: "アカウントメニュー" }).click();
    await page.getByRole("button", { name: "設定" }).click();

    const dialog = page.getByRole("dialog", { name: "設定" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("カレンダー連携")).toBeVisible();
    await expect(dialog.getByText("(primary)").first()).toBeVisible();

    // 自動予定化 toggle: 押下で PATCH が飛ぶ。戻り値はサーバー側 atomic で
    // value: true → false へ反転。e2e は PATCH 発火 + DB 反映まで踏む。
    // aria-label は SettingsPanel.tsx の `${label} を自動で予定化` で、displayName が
    // 括弧入りの "(primary)" なので exact string で受ける (regex リテラルだと括弧が
    // capture group 扱いされてマッチしない)。
    const patches: Array<{ url: string; status: number }> = [];
    page.on("response", async (res) => {
      const url = res.url();
      if (res.request().method() === "PATCH" && url.includes("/api/calendar/subscriptions/")) {
        patches.push({ url, status: res.status() });
      }
    });

    const toggle = dialog.getByLabel("(primary) を自動で予定化").first();
    await expect(toggle).toBeChecked();
    await toggle.click();

    await expect
      .poll(() => patches.length, { message: "PATCH should fire", timeout: 5_000 })
      .toBeGreaterThanOrEqual(1);
    expect(patches[0]!.status).toBe(200);

    // DB 側で auto_promote_to_timeline=false に切り替わったか確認 (RLS bypass: service role)
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("user_calendar_subscriptions")
            .select("auto_promote_to_timeline")
            .eq("id", sub!.id)
            .single();
          return data?.auto_promote_to_timeline;
        },
        { message: "auto_promote should flip to false", timeout: 5_000 },
      )
      .toBe(false);
  });
});
