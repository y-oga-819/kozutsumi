import { createAdminClient, waitForActionLog } from "./db";
import { expect, test } from "./fixtures";

/**
 * Issue #229 / ADR 0056:
 * recurring event に対する 3 択 modal (この予定だけ / これ以降 / すべて) を踏む e2e。
 *
 * シナリオ:
 *   1. service_role で external_account + subscription + recurring 系列 (instance3 件) を seed
 *      - 全 instance に共通の `recurring_event_id = 'rec-master-1'` を持たせる
 *   2. /events から中央 instance (#2) の詳細パネルを開き「予定化解除」を押すと modal が開く
 *   3. 「これ以降の予定もまとめて」を選択
 *      - DB: instance #2 / #3 の visibility_override = 'hidden' (instance #1 は 'none' のまま)
 *      - DB: event_visibility_override_rules に scope='this_and_following' / from_start_time=instance #2.start_time の rule が 1 行
 *      - action_log: event_demoted x2 (各 instance、bulk_operation_id 同一) + event_visibility_rule_added x1 (同 bulk_operation_id)
 *   4. 単発 override 保護: instance #1 を直接 hidden にした後、scope='all' で予定化を bulk apply しても
 *      instance #1 は hidden のまま (上書きされない)。残り (#2/#3) は shown に揃う。
 *   5. rule 削除: settings の rules セクションから rule を削除すると DB 行が消え、
 *      event_visibility_rule_removed action_log が記録される。既存 instance の visibility は変わらない。
 */
test.describe("recurring event の 3 択 modal (Issue #229 / ADR 0056)", () => {
  test("scope='this_and_following' で bulk apply + rule 永続化 + action_log 群が揃う", async ({
    signedInPage: page,
    testEmail,
    testUserId,
  }) => {
    const recurringEventId = "rec-master-1";
    const externalId1 = "ext-rec-i1";
    const externalId2 = "ext-rec-i2";
    const externalId3 = "ext-rec-i3";
    const titlePrefix = "繰り返し系列 e2e";

    const admin = createAdminClient();

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

    const start1 = todayPlus(0, 14, 0);
    const end1 = todayPlus(0, 15, 0);
    const start2 = todayPlus(7, 14, 0);
    const end2 = todayPlus(7, 15, 0);
    const start3 = todayPlus(14, 14, 0);
    const end3 = todayPlus(14, 15, 0);

    const insertInstance = async (
      externalId: string,
      titleSuffix: string,
      startIso: string,
      endIso: string,
    ) => {
      const { error } = await admin.from("events").insert({
        user_id: testUserId,
        title: `${titlePrefix} ${titleSuffix}`,
        start_time: startIso,
        end_time: endIso,
        project_id: null,
        meet_url: null,
        has_attachments: false,
        description: "",
        source: "google_calendar",
        external_id: externalId,
        external_calendar_id: "primary",
        visibility_override: "none",
        recurring_event_id: recurringEventId,
      });
      if (error) throw new Error(`[e2e] seed event ${externalId} failed: ${error.message}`);
    };
    await insertInstance(externalId1, "#1", start1.toISOString(), end1.toISOString());
    await insertInstance(externalId2, "#2", start2.toISOString(), end2.toISOString());
    await insertInstance(externalId3, "#3", start3.toISOString(), end3.toISOString());

    await page.getByRole("link", { name: "予定" }).click();
    await page.waitForURL((url) => url.pathname === "/events", { timeout: 10_000 });

    // 中央 instance (#2) の row → 「予定化解除」
    const row2 = page.getByRole("listitem").filter({ hasText: `${titlePrefix} #2` });
    await expect(row2).toBeVisible();
    await row2.getByRole("button", { name: "予定化解除" }).click();

    // 3 択 modal が開く
    const dialog = page.getByRole("dialog", { name: "繰り返し予定の予定化解除" });
    await expect(dialog).toBeVisible();

    // 「これ以降の予定もまとめて」を選ぶ
    await dialog.getByRole("button", { name: /これ以降の予定もまとめて/ }).click();

    // DB: instance #2 / #3 が hidden に、#1 は none のまま
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("events")
            .select("external_id, visibility_override")
            .eq("user_id", testUserId)
            .in("external_id", [externalId1, externalId2, externalId3]);
          const m = new Map<string, string>();
          for (const r of data ?? []) m.set(r.external_id ?? "", r.visibility_override);
          return `${m.get(externalId1)}/${m.get(externalId2)}/${m.get(externalId3)}`;
        },
        { message: "instance #1=none, #2/#3=hidden に揃う", timeout: 10_000 },
      )
      .toBe("none/hidden/hidden");

    // DB: rule が 1 行入っている
    const { data: rule } = await admin
      .from("event_visibility_override_rules")
      .select("scope, override_value, from_start_time")
      .eq("user_id", testUserId)
      .eq("recurring_event_id", recurringEventId)
      .single();
    expect(rule).toMatchObject({
      scope: "this_and_following",
      override_value: "hidden",
    });
    expect(rule!.from_start_time).toBeTruthy();
    expect(new Date(rule!.from_start_time!).toISOString()).toBe(start2.toISOString());

    // action_log: event_visibility_rule_added (bulk_operation_id 取得用)
    const ruleAdded = await waitForActionLog(
      admin,
      testUserId,
      (r) =>
        r.action_type === "event_visibility_rule_added" &&
        (r.metadata as Record<string, unknown>)["recurring_event_id"] === recurringEventId,
      { description: "event_visibility_rule_added" },
    );
    const bulkOpId = (ruleAdded.metadata as Record<string, unknown>)["bulk_operation_id"] as string;
    expect(typeof bulkOpId).toBe("string");
    expect(bulkOpId.length).toBeGreaterThan(0);

    // action_log: instance #2 と #3 にそれぞれ event_demoted (同 bulk_operation_id)
    const demoted2 = await waitForActionLog(
      admin,
      testUserId,
      (r) =>
        r.action_type === "event_demoted" &&
        (r.metadata as Record<string, unknown>)["external_id"] === externalId2,
      { description: "event_demoted #2" },
    );
    expect(demoted2.metadata).toMatchObject({
      scope: "this_and_following",
      recurring_event_id: recurringEventId,
      bulk_operation_id: bulkOpId,
      to: "hidden",
      // auto_promote=true で hidden は default 逸脱
      is_override_of_default: true,
    });
    const demoted3 = await waitForActionLog(
      admin,
      testUserId,
      (r) =>
        r.action_type === "event_demoted" &&
        (r.metadata as Record<string, unknown>)["external_id"] === externalId3,
      { description: "event_demoted #3" },
    );
    expect((demoted3.metadata as Record<string, unknown>)["bulk_operation_id"]).toBe(bulkOpId);
  });

  test("scope='all' でも単発 override 済 instance は保護される (ADR 0056 §5)", async ({
    signedInPage: page,
    testEmail,
    testUserId,
  }) => {
    const recurringEventId = "rec-master-2";
    const externalId1 = "ext-rec-protect-i1";
    const externalId2 = "ext-rec-protect-i2";
    const titlePrefix = "繰り返し protect e2e";

    const admin = createAdminClient();

    const { data: account } = await admin
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
    await admin.from("user_calendar_subscriptions").upsert(
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

    // instance #1 は最初から visibility_override='hidden' (= 単発 override 済)
    await admin.from("events").insert({
      user_id: testUserId,
      title: `${titlePrefix} #1`,
      start_time: todayPlus(0, 16, 0).toISOString(),
      end_time: todayPlus(0, 17, 0).toISOString(),
      project_id: null,
      meet_url: null,
      has_attachments: false,
      description: "",
      source: "google_calendar",
      external_id: externalId1,
      external_calendar_id: "primary",
      visibility_override: "hidden",
      recurring_event_id: recurringEventId,
    });
    await admin.from("events").insert({
      user_id: testUserId,
      title: `${titlePrefix} #2`,
      start_time: todayPlus(7, 16, 0).toISOString(),
      end_time: todayPlus(7, 17, 0).toISOString(),
      project_id: null,
      meet_url: null,
      has_attachments: false,
      description: "",
      source: "google_calendar",
      external_id: externalId2,
      external_calendar_id: "primary",
      visibility_override: "none",
      recurring_event_id: recurringEventId,
    });

    await page.getByRole("link", { name: "予定" }).click();
    await page.waitForURL((url) => url.pathname === "/events", { timeout: 10_000 });

    // instance #2 から「予定化解除」→ scope='all'
    const row2 = page.getByRole("listitem").filter({ hasText: `${titlePrefix} #2` });
    await row2.getByRole("button", { name: "予定化解除" }).click();
    const dialog = page.getByRole("dialog", { name: "繰り返し予定の予定化解除" });
    await dialog.getByRole("button", { name: /すべての繰り返し/ }).click();

    // instance #1 は 'hidden' のまま (元の単発 override は保護)、instance #2 も 'hidden' になっている
    await expect
      .poll(
        async () => {
          const { data } = await admin
            .from("events")
            .select("external_id, visibility_override")
            .eq("user_id", testUserId)
            .in("external_id", [externalId1, externalId2]);
          const m = new Map<string, string>();
          for (const r of data ?? []) m.set(r.external_id ?? "", r.visibility_override);
          return `${m.get(externalId1)}/${m.get(externalId2)}`;
        },
        { message: "instance #1 は hidden 維持、#2 は hidden に揃う", timeout: 10_000 },
      )
      .toBe("hidden/hidden");
  });
});

function todayPlus(addDays: number, hour: number, minute: number): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  d.setDate(d.getDate() + addDays);
  return d;
}
