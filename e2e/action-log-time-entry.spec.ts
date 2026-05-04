import {
  assertTimeEntriesInvariants,
  createAdminClient,
  expectTaskStatus,
  getActionLogs,
  getTaskByTitle,
  getTimeEntries,
  waitForActionLog,
  waitForTimeEntries,
} from "./db";
import { expect, test } from "./fixtures";

/**
 * Issue #67 🟥 最優先 / ADR 0001 / ADR 0004:
 *   行動データ (action_logs / task_time_entries / tasks.status) の整合を踏む。
 *
 * UI が "それっぽく" 動いていても DB に正しく落ちていなければ Phase 3 の
 * 学習基盤 (vision.md の差別化の核) が壊れる。ここでは start → pause(voluntary)
 *  → resume → complete の golden path を回しつつ、各操作の直後に DB を
 * service_role で query して以下を assert する:
 *   - action_logs に正しい action_type + metadata.task_id が積まれる
 *   - task_time_entries が ADR 0004 の状態機械通りに分割される
 *   - tasks.status が idle → active → paused → active → done を辿る
 */
test.describe("行動データ整合 (action_logs / task_time_entries / tasks.status)", () => {
  test("start → pause → resume → complete で DB が ADR 通りに更新される", async ({
    signedInPage: page,
    testUserId: userId,
  }) => {
    const projectName = "行動ログ検証プロジェクト";
    const taskTitle = "行動ログ検証タスク";

    const admin = createAdminClient();

    // --- セットアップ: プロジェクト + タスク 1 件を UI から作る ---------------
    await page.getByRole("button", { name: "新規追加" }).click();
    const addDialog = page.getByRole("dialog", { name: "追加メニュー" });
    await addDialog.getByRole("tab", { name: "プロジェクト" }).click();
    await addDialog.getByLabel("名前").fill(projectName);
    await addDialog.getByRole("button", { name: "追加" }).click();
    await expect(addDialog).toHaveCount(0);

    await page.getByRole("button", { name: "新規追加" }).click();
    const addDialog2 = page.getByRole("dialog", { name: "追加メニュー" });
    await addDialog2.getByRole("tab", { name: "タスク" }).click();
    await addDialog2.getByLabel("タイトル").fill(taskTitle);
    // #170 / ADR 0038: task_size は登録時必須。テスト範囲外なので任意の値 (30分) を選ぶ。
    await addDialog2.getByRole("radio", { name: "30分" }).click();
    await addDialog2.getByLabel("プロジェクト (任意)").selectOption({ label: projectName });
    await addDialog2.getByRole("button", { name: "追加" }).click();
    await expect(addDialog2).toHaveCount(0);

    const stack = page.getByRole("list", { name: "タスクスタック" });
    await expect(stack.getByRole("listitem").filter({ hasText: taskTitle })).toBeVisible();

    // 作成直後は idle, entry なし。
    const taskInitial = await getTaskByTitle(admin, userId, taskTitle);
    expect(taskInitial.status).toBe("idle");
    expect(await getTimeEntries(admin, taskInitial.id)).toHaveLength(0);
    const taskId = taskInitial.id;

    // --- start ---------------------------------------------------------------
    await page.getByRole("button", { name: "開始" }).click();
    await expect(page.getByRole("button", { name: "中断" })).toBeVisible();

    await expectTaskStatus(admin, taskId, "active");

    const startedLog = await waitForActionLog(
      admin,
      userId,
      (l) => l.action_type === "task_started" && l.task_id === taskId,
      { description: "task_started log" },
    );
    expect((startedLog.metadata as { task_id?: string }).task_id).toBe(taskId);

    const afterStart = await waitForTimeEntries(
      admin,
      taskId,
      (es) => es.length === 1 && es[0].paused_at === null,
      { description: "1 open entry after start" },
    );
    assertTimeEntriesInvariants(afterStart);
    expect(afterStart[0].pause_reason).toBeNull();
    expect(afterStart[0].duration_seconds).toBeNull();

    // --- pause (voluntary) ---------------------------------------------------
    await page.getByRole("button", { name: "中断" }).click();
    const pauseDialog = page.getByRole("dialog", { name: "中断の理由" });
    await pauseDialog.getByRole("button", { name: /自発的に中断/ }).click();

    await expect(page.getByRole("button", { name: "再開" })).toBeVisible();
    await expectTaskStatus(admin, taskId, "paused");

    const pausedLog = await waitForActionLog(
      admin,
      userId,
      (l) => l.action_type === "task_paused" && l.task_id === taskId,
      { description: "task_paused log" },
    );
    expect((pausedLog.metadata as { pause_reason?: string }).pause_reason).toBe("voluntary");

    const afterPause = await waitForTimeEntries(
      admin,
      taskId,
      (es) => es.length === 1 && es[0].paused_at !== null,
      { description: "entry closed after pause" },
    );
    assertTimeEntriesInvariants(afterPause);
    expect(afterPause[0].pause_reason).toBe("voluntary");
    expect(afterPause[0].duration_seconds).not.toBeNull();
    expect(afterPause[0].duration_seconds ?? -1).toBeGreaterThanOrEqual(0);

    // --- resume --------------------------------------------------------------
    await page.getByRole("button", { name: "再開" }).click();
    await expect(page.getByRole("button", { name: "中断" })).toBeVisible();
    await expectTaskStatus(admin, taskId, "active");

    await waitForActionLog(
      admin,
      userId,
      (l) => l.action_type === "task_resumed" && l.task_id === taskId,
      { description: "task_resumed log" },
    );

    // ADR 0004: 再開のたびに新規 entry を insert する (= 1タスクに複数 entry)
    const afterResume = await waitForTimeEntries(
      admin,
      taskId,
      (es) => es.length === 2 && es.some((e) => e.paused_at === null),
      { description: "2 entries after resume (1 closed + 1 open)" },
    );
    assertTimeEntriesInvariants(afterResume);
    const closed = afterResume.filter((e) => e.paused_at !== null);
    const open = afterResume.filter((e) => e.paused_at === null);
    expect(closed).toHaveLength(1);
    expect(open).toHaveLength(1);
    expect(closed[0].pause_reason).toBe("voluntary");

    // --- complete ------------------------------------------------------------
    await page.getByRole("button", { name: "完了" }).click();
    // 完了したタスクは pending stack から消える
    await expect(stack.getByRole("listitem").filter({ hasText: taskTitle })).toHaveCount(0);

    await expectTaskStatus(admin, taskId, "done");

    const completedLog = await waitForActionLog(
      admin,
      userId,
      (l) => l.action_type === "task_completed" && l.task_id === taskId,
      { description: "task_completed log" },
    );
    expect((completedLog.metadata as { task_id?: string }).task_id).toBe(taskId);

    // 完了時は最後の open entry を close する。pause_reason は null のままでよい
    // (ADR 0004 Notes / DB 制約 task_time_entries_pause_reason_requires_paused)。
    const afterComplete = await waitForTimeEntries(
      admin,
      taskId,
      (es) => es.length === 2 && es.every((e) => e.paused_at !== null),
      { description: "all entries closed after complete" },
    );
    assertTimeEntriesInvariants(afterComplete);
    const completedTask = await getTaskByTitle(admin, userId, taskTitle);
    expect(completedTask.completed_at).not.toBeNull();
    const lastEntry = afterComplete[afterComplete.length - 1];
    expect(lastEntry.paused_at).not.toBeNull();
    expect(lastEntry.duration_seconds).not.toBeNull();

    // --- 全体: action_logs の順序が UI 操作と一致 ---------------------------
    const allLogs = await getActionLogs(admin, userId);
    const ourLogs = allLogs.filter((l) => l.task_id === taskId).map((l) => l.action_type);
    expect(ourLogs).toEqual(["task_started", "task_paused", "task_resumed", "task_completed"]);
  });
});
