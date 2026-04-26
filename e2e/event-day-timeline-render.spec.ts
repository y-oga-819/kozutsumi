import { expect, test } from "./fixtures";

/**
 * Issue #77:
 *   AddPanel「イベント」タブから作った manual イベントが DayTimeline に
 *   描画されることを semantic locator で踏む。
 *
 * `project-event-crud.spec.ts` は DB (events 行) への insert 整合を見る spec で、
 * UI 表示までは検証していない。ここでは UI 表示の責務だけに絞る (DB assert は
 * 重複させない)。
 *
 * DayTimeline は「今日」のローカル日付のイベントしか描画しないので、開始日付は
 * 実行日に揃える必要がある。
 *
 * semantic 構造 (kozutsumi-frontend-a11y skill):
 *   - DayTimeline 全体: <section aria-label="本日のタイムライン"> → role="region"
 *   - EventCard 群:     <ul role="list" aria-label="本日のイベント"> / <li>
 */
test.describe("AddPanel イベントタブ → DayTimeline 表示 (Issue #77)", () => {
  test("manual event を作ると DayTimeline の listitem として表示される", async ({
    signedInPageWithProject: page,
    projectName,
  }) => {
    const eventTitle = "E2E DayTimeline 表示確認 MTG";
    const todayLocal = todayDateStr();
    const startLocal = `${todayLocal}T13:00`;
    const endLocal = `${todayLocal}T14:30`;

    // --- AddPanel イベントタブから 1 件作る --------------------------------
    await page.getByRole("button", { name: "新規追加" }).click();
    const addDialog = page.getByRole("dialog", { name: "追加メニュー" });
    await addDialog.getByRole("tab", { name: "イベント" }).click();
    await addDialog.getByLabel("タイトル").fill(eventTitle);
    await addDialog.getByLabel("開始").fill(startLocal);
    await addDialog.getByLabel("終了").fill(endLocal);
    await addDialog.getByLabel("プロジェクト (任意)").selectOption({ label: projectName });
    await addDialog.getByRole("button", { name: "追加" }).click();
    await expect(addDialog).toHaveCount(0);

    // --- DayTimeline 配下で listitem として描画されている --------------------
    // region scope で他の list (TreeView の凡例 / 履歴) と衝突しないように絞る。
    const timeline = page.getByRole("region", { name: "本日のタイムライン" });
    await expect(timeline).toBeVisible();

    const eventItem = timeline.getByRole("listitem").filter({ hasText: eventTitle });
    await expect(eventItem).toHaveCount(1);
    await expect(eventItem).toBeVisible();

    // --- EventCard 内の時刻レンジが描画される -------------------------------
    // EventCard.tsx は formatClock で "13:00–14:30" の形で表示する (en dash)。
    // 開始時刻 / 終了時刻が正しく時間帯ラベルに反映されることを listitem スコープで
    // 確認する (locator が取りやすいので DB assert に委ねず UI 側で踏む)。
    await expect(eventItem).toContainText("13:00");
    await expect(eventItem).toContainText("14:30");
  });
});

/**
 * DayTimeline は「今日」のローカル日付のイベントしか描画しないので、開始日付を
 * 実行日に揃える。`project-event-crud.spec.ts` の `todayDateStr` と同じ実装。
 */
function todayDateStr(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
