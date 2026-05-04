import { createAdminClient, waitForActionLog } from "./db";
import { expect, test } from "./fixtures";

/**
 * Issue #145 / ADR 0031 Layer 3 / ADR 0032 / ADR 0035:
 * 個別 event の予定化 / 解除 (visibility_override) を切り替える wiring を踏む。
 *
 * シナリオ:
 *   1. service_role で external_account + subscription (auto_promote=true) + event を seed
 *   2. /events ページに遷移して「予定管理」リストに event が出ることを確認
 *   3. 「予定化解除」ボタンを押す
 *   4. DB の events.visibility_override が 'hidden' に更新される
 *   5. action_log に event_demoted (is_override_of_default=true) が記録される
 *   6. ボタンが「予定化する」に切り替わり、押すと visibility_override='shown' に戻る
 *
 * tree → events への動線置換: stack ↔ events タブが Header に出ていることも確認する。
 */
test.describe("予定管理ページでの visibility_override 切替 (Issue #145)", () => {
  test("event を予定化解除 → DB / action_log 反映 → 再度予定化", async ({
    signedInPage: page,
    testEmail,
    testUserId,
  }) => {
    const eventTitle = "可視性切替テスト MTG";
    const externalId = "ext-visibility-toggle-e2e";

    const admin = createAdminClient();

    // --- service_role で external_account + subscription + event を seed ---
    const { data: account, error: accErr } = await admin
      .from("external_accounts")
      .upsert(
        {
          user_id: testUserId,
          source: "google_calendar",
          external_account_id: testEmail,
          display_name: "(primary)",
        },
        { onConflict: "user_id,source,external_account_id" },
      )
      .select("id")
      .single();
    if (accErr) throw new Error(`[e2e] seed external_account failed: ${accErr.message}`);

    const { error: subErr } = await admin.from("user_calendar_subscriptions").upsert(
      {
        user_id: testUserId,
        external_account_id: account!.id,
        source: "google_calendar",
        external_calendar_id: "primary",
        auto_promote_to_timeline: true,
        display_name: "(primary)",
      },
      { onConflict: "user_id,external_account_id,external_calendar_id" },
    );
    if (subErr) throw new Error(`[e2e] seed subscription failed: ${subErr.message}`);

    const start = todayAt(14, 0);
    const end = todayAt(15, 0);
    const { error: evErr } = await admin.from("events").insert({
      user_id: testUserId,
      title: eventTitle,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      project_id: null,
      meet_url: null,
      has_attachments: false,
      description: "",
      source: "google_calendar",
      external_id: externalId,
      external_calendar_id: "primary",
      visibility_override: "none",
    });
    if (evErr) throw new Error(`[e2e] seed event failed: ${evErr.message}`);

    // --- /events ページに遷移 ---
    await page.getByRole("link", { name: "予定" }).click();
    await page.waitForURL((url) => url.pathname === "/events", { timeout: 10_000 });

    const heading = page.getByRole("heading", { name: "予定管理" });
    await expect(heading).toBeVisible();

    // 当該 event の row が default で表示される (auto_promote=true なので 予定化中)
    const row = page
      .getByRole("listitem")
      .filter({ hasText: eventTitle })
      // 内側 li (date group) と紛らわしいので、ボタンを含む leaf を取る
      .filter({ has: page.getByRole("button", { name: /予定化(解除|する)/ }) });
    await expect(row).toBeVisible();
    await expect(row.getByText("予定化中").first()).toBeVisible();

    // --- 予定化解除を押す ---
    const adminBefore = await admin
      .from("events")
      .select("visibility_override")
      .eq("user_id", testUserId)
      .eq("external_id", externalId)
      .single();
    expect(adminBefore.data?.visibility_override).toBe("none");

    await row.getByRole("button", { name: "予定化解除" }).click();

    // --- DB 反映を待つ ---
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("events")
            .select("visibility_override")
            .eq("user_id", testUserId)
            .eq("external_id", externalId)
            .single();
          return data?.visibility_override;
        },
        { message: "visibility_override should flip to hidden", timeout: 5_000 },
      )
      .toBe("hidden");

    // --- action_log: event_demoted (is_override_of_default=true) ---
    const demoted = await waitForActionLog(
      admin,
      testUserId,
      (r) =>
        r.action_type === "event_demoted" &&
        (r.metadata as Record<string, unknown>)["external_id"] === externalId,
      { description: "event_demoted action_log" },
    );
    expect(demoted.metadata).toMatchObject({
      source: "google_calendar",
      external_calendar_id: "primary",
      external_id: externalId,
      from: "none",
      to: "hidden",
      subscription_auto_promote: true,
      // auto_promote=true で hidden へは default 逸脱
      is_override_of_default: true,
    });

    // --- UI 側でラベル / ボタン文言が切り替わる ---
    await expect(row.getByText("予定化解除中").first()).toBeVisible();
    await expect(row.getByRole("button", { name: "予定化する" })).toBeVisible();

    // --- 再度予定化 → shown ---
    await row.getByRole("button", { name: "予定化する" }).click();

    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("events")
            .select("visibility_override")
            .eq("user_id", testUserId)
            .eq("external_id", externalId)
            .single();
          return data?.visibility_override;
        },
        { message: "visibility_override should flip to shown", timeout: 5_000 },
      )
      .toBe("shown");

    const promoted = await waitForActionLog(
      admin,
      testUserId,
      (r) =>
        r.action_type === "event_promoted" &&
        (r.metadata as Record<string, unknown>)["external_id"] === externalId,
      { description: "event_promoted action_log" },
    );
    expect(promoted.metadata).toMatchObject({
      from: "hidden",
      to: "shown",
      subscription_auto_promote: true,
      // auto_promote=true で shown は default 一致
      is_override_of_default: false,
    });
  });

  test("ヘッダーから tree 動線が消えて events 動線に置き換わっている", async ({
    signedInPage: page,
  }) => {
    // 動線置換: stack / 予定 のみ (tree は無し)。
    await expect(page.getByRole("link", { name: "Stack" })).toBeVisible();
    await expect(page.getByRole("link", { name: "予定" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Tree" })).toHaveCount(0);
  });
});

function todayAt(hour: number, minute: number): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}
