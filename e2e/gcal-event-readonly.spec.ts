import { createAdminClient, getEventByTitle, getProjectByName } from "./db";
import { expect, test } from "./fixtures";

/**
 * Issue #67 🟨 10 / ADR 0010:
 *   `source='google_calendar'` のイベントに対する編集制約を踏む。
 *
 * ADR 0010 の挙動:
 *   - title / start_time / end_time / meet_url / description は kozutsumi 側で
 *     編集不可 (Google 側が正)
 *   - project_id だけ kozutsumi 側で書き換えできる
 *   - 削除ボタンも出さない (Google 側で削除すれば次回同期で消える)
 *
 * UI 経由で `source='google_calendar'` のイベントを作る正規ルートは Google
 * Calendar 同期 (OAuth) しか無いので、e2e では service_role で events 行を
 * 直接 insert して再現する。
 */
test.describe("google_calendar イベントの編集制約 (ADR 0010)", () => {
  test("title / 時刻 / meetUrl / description は read-only、削除ボタンも出ない", async ({
    signedInPage: page,
    testUserId: userId,
  }) => {
    const eventTitle = "GCal 由来の MTG";
    const meetUrl = "https://meet.google.com/gcal-readonly-e2e";
    const description = "## 議題\n- read-only テスト用";

    const admin = createAdminClient();

    // --- service_role で GCal イベントを 1 件 insert -------------------------
    // start_time は今日のローカル 14:00 とし、DayTimeline に確実に出すために
    // 必ず "minutesOfDay" の範囲内に収まる時間帯を選ぶ。
    const start = todayAt(14, 0);
    const end = todayAt(15, 0);
    const { error: insertErr } = await admin.from("events").insert({
      user_id: userId,
      title: eventTitle,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      project_id: null,
      meet_url: meetUrl,
      has_attachments: false,
      description,
      source: "google_calendar",
      external_id: "gcal-readonly-e2e",
      external_calendar_id: "primary",
    });
    if (insertErr) throw new Error(`[e2e] insert gcal event failed: ${insertErr.message}`);

    // events query は AppShell の `["events"]` キーで管理されるので、page.reload
    // で再 fetch させて DayTimeline に GCal イベントを出す。
    await page.reload();

    // --- DayTimeline の EventCard をクリックして詳細を開く -------------------
    // Issue #77 で立てた a11y 構造 (region 配下の listitem) で scope する。
    // 上部の "<title>中" インジケータ (`isNow` 時の <span>) と衝突しないよう
    // listitem に絞る (`getByText(...).first()` だと CI 実行時刻が event 範囲に
    // 被ったとき indicator span を拾って flake する)。
    const timeline = page.getByRole("region", { name: "本日のタイムライン" });
    await timeline.getByRole("listitem").filter({ hasText: eventTitle }).click();

    // EventDetailPanel が開く (Issue #76 で role="dialog" + aria-label="イベント詳細"
    // を付与済み)。GCal 由来であることを示すバッジ + 由来説明文の存在を踏む。
    const detailDialog = page.getByRole("dialog", { name: "イベント詳細" });
    await expect(detailDialog).toBeVisible();
    await expect(detailDialog.getByTestId("google-calendar-badge").first()).toBeVisible();
    await expect(
      detailDialog.getByText("Google Calendar で編集した内容は次回同期で反映されます"),
    ).toBeVisible();

    // --- 削除ボタン / 編集ボタンが出ない (ADR 0010) -------------------------
    // dialog 内に絞ることで TaskDetailPanel など他 panel との誤検知を防ぐ。
    await expect(detailDialog.getByRole("button", { name: "削除" })).toHaveCount(0);
    await expect(detailDialog.getByRole("button", { name: "編集" })).toHaveCount(0);

    // --- title は h2 表示 / 編集 input は無い -------------------------------
    // h2 element が title を持つ (EventDetailPanel.tsx L61-63)。
    const titleHeading = page.getByRole("heading", { level: 2, name: eventTitle });
    await expect(titleHeading).toBeVisible();
    // title 用の <input> や <textarea> は無い。
    await expect(page.locator("input[type='text']")).toHaveCount(0);
    await expect(page.locator("textarea")).toHaveCount(0);

    // --- 時刻は表示テキスト (anchor / button では無い) -----------------------
    // 編集用の datetime-local input が紛れ込んでいないことを確認する。
    await expect(page.locator("input[type='datetime-local']")).toHaveCount(0);

    // --- meet_url は anchor 表示 (リンクとしてだけ機能、編集不可) ------------
    const meetAnchor = page.getByRole("link", {
      name: /Google Meetに参加|Zoomに参加|会議リンクに参加/,
    });
    await expect(meetAnchor).toBeVisible();
    await expect(meetAnchor).toHaveAttribute("href", meetUrl);

    // --- description は markdown render (input/textarea ではない) -----------
    // renderMarkdown は h2 / li 等を生成する。本文の "議題" が見える時点で
    // 「テキスト表示」されていることが取れる。
    await expect(page.getByText("議題", { exact: false })).toBeVisible();

    // 補強: DB 側の制約も並走している (ADR 0010)。e2e から直接 update を投げると
    // SupabaseEventGateway.update が touchesGoogleOwned を見て弾く: ここでは UI の
    // 観測責務に留め、gateway 単体テスト (supabase-gateway.test.ts) と分担する。
  });

  test("project_id だけは編集可能で、events.project_id が DB に反映される", async ({
    signedInPageWithProject: page,
    projectName,
    testUserId: userId,
  }) => {
    const eventTitle = "GCal 由来のプロジェクト紐付けテスト";

    const admin = createAdminClient();
    const project = await getProjectByName(admin, userId, projectName);

    // --- GCal イベントを project_id=null で insert ---------------------------
    const start = todayAt(15, 0);
    const end = todayAt(16, 0);
    const { error: insertErr } = await admin.from("events").insert({
      user_id: userId,
      title: eventTitle,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      project_id: null,
      meet_url: null,
      has_attachments: false,
      description: "",
      source: "google_calendar",
      external_id: "gcal-project-edit-e2e",
      external_calendar_id: "primary",
    });
    if (insertErr) throw new Error(`[e2e] insert gcal event failed: ${insertErr.message}`);

    await page.reload();

    // --- DayTimeline → 詳細を開く -------------------------------------------
    // listitem scope で indicator span (`isNow` 時の `<title>中`) との衝突を回避。
    const timeline = page.getByRole("region", { name: "本日のタイムライン" });
    await timeline.getByRole("listitem").filter({ hasText: eventTitle }).click();
    await expect(page.getByTestId("google-calendar-badge").first()).toBeVisible();

    // --- 「未設定 を変更」 → select 表示 → プロジェクトを選ぶ ----------------
    await page.getByRole("button", { name: /未設定\s+を変更/ }).click();
    // ADR 0010: option の value は project.id。DB 値で選ぶことで relative 表記に
    // 依存しない。
    await page.locator("select").first().selectOption({ value: project.id });

    // --- DB: events.project_id 反映 -----------------------------------------
    await expect
      .poll(async () => (await getEventByTitle(admin, userId, eventTitle)).project_id, {
        message: "events.project_id should be updated for google_calendar source",
        timeout: 5_000,
      })
      .toBe(project.id);

    // --- title / 時刻 等は触っていないので変わっていない (regression check) -
    const after = await getEventByTitle(admin, userId, eventTitle);
    expect(after.title).toBe(eventTitle);
    expect(after.source).toBe("google_calendar");
    expect(after.external_id).toBe("gcal-project-edit-e2e");
  });
});

/** 今日のローカル時刻を H/M で組み立てた Date を返す。 */
function todayAt(hour: number, minute: number): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}
