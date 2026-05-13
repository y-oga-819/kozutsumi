import type { Page } from "@playwright/test";

import {
  assertTimeEntriesInvariants,
  createAdminClient,
  expectTaskStatus,
  getActionLogs,
  getTaskByTitle,
  waitForActionLog,
  waitForTimeEntries,
} from "./db";
import { expect, test } from "./fixtures";

/**
 * Issue #239 / ADR-0059:
 *   1-tap 割り込みボタンは active な timer を 1 タップで paused に落とし、
 *   action_log に `task_interrupted` を 1 件だけ記録する。
 *
 * 不変条件 (= 本 spec が CI で踏み続ける):
 *   1. `中断の理由` モーダル (PauseReasonModal) は経由しない (= reason 選択を要求しない)
 *   2. time_entries は `pause_reason="interruption"` で close される
 *   3. action_logs には `task_interrupted` が積まれ、`task_paused` は積まれない
 *      (= モーダル経由の中断と区別できる)
 *   4. 停止後の任意の再開は user 操作 (= 「再開」ボタン押下) でのみ起きる
 *
 * ADR-0058 (timer 3 動詞 + 能動 AI 介入禁止) の guard rail は
 * timer-no-ai-intervention.spec.ts が別途踏んでいる。本 spec は ADR-0059 の
 * 1-tap シグナルが DB に正確に落ちる側を担保する。
 */
test.describe("ADR-0059: 1-tap 割り込みボタン", () => {
  test("active 中の 1-tap で paused へ落ち、task_interrupted のみ記録される (モーダルは経由しない)", async ({
    signedInPageWithProject: page,
    projectName,
    testUserId: userId,
  }) => {
    const taskTitle = "1-tap 割り込み検証";
    const admin = createAdminClient();

    await createTask(page, taskTitle, projectName);
    const task = await getTaskByTitle(admin, userId, taskTitle);
    const taskId = task.id;

    // --- start ----
    await page.getByRole("button", { name: "開始" }).click();
    await expect(page.getByRole("button", { name: "中断" })).toBeVisible();
    await expectTaskStatus(admin, taskId, "active");
    // 割り込みボタンが active 中だけ表示される (=ADR-0059 不変条件: 1-tap)
    const interruptButton = page.getByRole("button", { name: "割り込み" });
    await expect(interruptButton).toBeVisible();

    // --- 1-tap 割り込み ----
    await interruptButton.click();
    // モーダルは出ない (= 事前分類を要求しない / ADR-0059 Decision 2)
    await expect(page.getByRole("dialog", { name: "中断の理由" })).toHaveCount(0);
    // active → paused に遷移
    await expect(page.getByRole("button", { name: "再開" })).toBeVisible();
    await expectTaskStatus(admin, taskId, "paused");
    // 停止後は割り込みボタンも消える (paused では押せない)
    await expect(page.getByRole("button", { name: "割り込み" })).toHaveCount(0);

    // --- action_log: task_interrupted が積まれる ----
    const interruptedLog = await waitForActionLog(
      admin,
      userId,
      (l) => l.action_type === "task_interrupted" && l.task_id === taskId,
      { description: "task_interrupted log" },
    );
    expect((interruptedLog.metadata as { task_id?: string }).task_id).toBe(taskId);

    // task_paused は積まれない (= ADR-0059 のシグナル分離)。
    // waitForActionLog で待つと「来なかったこと」を確認できないため、interrupted を
    // 観測した直後の time-entry 更新まで待ってから getActionLogs で集合確認する。
    const entries = await waitForTimeEntries(
      admin,
      taskId,
      (es) => es.length === 1 && es[0].paused_at !== null,
      { description: "entry closed after interrupt" },
    );
    assertTimeEntriesInvariants(entries);
    expect(entries[0].pause_reason).toBe("interruption");
    expect(entries[0].duration_seconds).not.toBeNull();

    // 集合 assert: task に対する action_log は task_started → task_interrupted のみ
    // (task_paused は出ない)。
    const allLogs = await getActionLogs(admin, userId);
    const ourTypes = allLogs.filter((l) => l.task_id === taskId).map((l) => l.action_type);
    expect(ourTypes).toEqual(["task_started", "task_interrupted"]);
  });

  test("割り込み後の resume は user 操作 (再開ボタン押下) でのみ起きる (= 自動再開しない)", async ({
    signedInPageWithProject: page,
    projectName,
    testUserId: userId,
  }) => {
    const taskTitle = "割り込み後 manual resume 検証";
    const admin = createAdminClient();
    await createTask(page, taskTitle, projectName);
    const task = await getTaskByTitle(admin, userId, taskTitle);
    const taskId = task.id;

    await page.getByRole("button", { name: "開始" }).click();
    await expect(page.getByRole("button", { name: "中断" })).toBeVisible();
    await page.getByRole("button", { name: "割り込み" }).click();
    await expect(page.getByRole("button", { name: "再開" })).toBeVisible();
    await expectTaskStatus(admin, taskId, "paused");

    // 自動再開が万一仕込まれていれば踏める下限の長さ。
    await page.waitForTimeout(1_500);
    await expectTaskStatus(admin, taskId, "paused");
    await expect(page.getByRole("button", { name: "再開" })).toBeVisible();

    // user が「再開」を押すと active に戻る (= calendar-event の非対称 stop と同じ原則)。
    await page.getByRole("button", { name: "再開" }).click();
    await expect(page.getByRole("button", { name: "中断" })).toBeVisible();
    await expectTaskStatus(admin, taskId, "active");
  });
});

async function createTask(page: Page, title: string, projectName: string): Promise<void> {
  await page.getByRole("button", { name: "新規追加" }).click();
  const addDialog = page.getByRole("dialog", { name: "追加メニュー" });
  await addDialog.getByRole("tab", { name: "タスク" }).click();
  await addDialog.getByLabel("タイトル").fill(title);
  // #170 / ADR 0038: task_size は登録時必須。テスト範囲外なので任意の値 (30分) を選ぶ。
  await addDialog.getByRole("radio", { name: "30分" }).click();
  await addDialog.getByLabel("プロジェクト (任意)").selectOption({ label: projectName });
  await addDialog.getByRole("button", { name: "追加" }).click();
  await expect(addDialog).toHaveCount(0);
}
