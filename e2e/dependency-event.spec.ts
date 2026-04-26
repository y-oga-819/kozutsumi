import { createAdminClient, getEventByTitle, getTaskByTitle, waitForActionLog } from "./db";
import { expect, test } from "./fixtures";

/**
 * Issue #67 🟨 9 / P2-5 (#53):
 *   タスクの依存イベント設定 UI (TaskDetailPanel) と DB / バッジ表示の整合。
 *
 * `tasks.depends_on_event_id` は Phase 4 の「依存設定が着手順に効いたか」の
 * 学習データになる (AppShell.tsx L204-234 / ADR 0001 の TASK_DEPENDENCY_*)。
 * UI が壊れて action_log を吐かない / DB に書かない regression が起きると、
 * Phase 4 の学習基盤が静かに腐る。
 *
 * バッジは TopTaskCard / TaskRow の双方に出る (TopTaskCard.tsx L87-96 /
 * TaskRow.tsx L59-68)。両方の経路を踏む。
 */
test.describe("依存イベント設定 (TaskDetailPanel → DB → バッジ)", () => {
  test("TopTaskCard でタスク → イベントの依存設定が DB / action_log / バッジに反映される", async ({
    signedInPageWithProject: page,
    projectName,
    testUserId: userId,
  }) => {
    const taskTitle = "依存先を持つタスク";
    const eventTitle = "依存先 MTG";
    const startLocal = "2030-06-15T13:00";
    const endLocal = "2030-06-15T14:00";

    const admin = createAdminClient();

    // --- 依存先イベントを先に作る (depCandidates は startTime >= now で絞られる) ---
    await page.getByRole("button", { name: "新規追加" }).click();
    const addEvent = page.getByRole("dialog", { name: "追加メニュー" });
    await addEvent.getByRole("tab", { name: "イベント" }).click();
    await addEvent.getByLabel("タイトル").fill(eventTitle);
    await addEvent.getByLabel("開始").fill(startLocal);
    await addEvent.getByLabel("終了").fill(endLocal);
    await addEvent.getByRole("button", { name: "追加" }).click();
    await expect(addEvent).toHaveCount(0);

    const event = await getEventByTitle(admin, userId, eventTitle);

    // --- タスクを 1 件 (= TopTaskCard) ----------------------------------------
    await page.getByRole("button", { name: "新規追加" }).click();
    const addTask = page.getByRole("dialog", { name: "追加メニュー" });
    await addTask.getByRole("tab", { name: "タスク" }).click();
    await addTask.getByLabel("タイトル").fill(taskTitle);
    await addTask.getByLabel("プロジェクト").selectOption({ label: projectName });
    await addTask.getByRole("button", { name: "追加" }).click();
    await expect(addTask).toHaveCount(0);

    const stack = page.getByRole("list", { name: "タスクスタック" });
    const row = stack.getByRole("listitem").filter({ hasText: taskTitle });
    await expect(row).toBeVisible();

    const task = await getTaskByTitle(admin, userId, taskTitle);
    expect(task.depends_on_event_id).toBeNull();

    // --- 詳細パネルを開いて依存イベントを設定 -------------------------------
    // TopTaskCard 全体に onClick (詳細を開く) があり、grip / アクションボタンは
    // stopPropagation 済み。タイトル文字を狙うと detail に遷移する (task-crud
    // spec と同じパターン)。
    await row.getByText(taskTitle).first().click();

    // 初期状態の依存編集ボタンは「なし を変更」(TaskDetailPanel.tsx L142-144)。
    await page.getByRole("button", { name: /なし\s+を変更/ }).click();

    // editingDep=true で <select autoFocus> が render される。option の value は
    // event.id なので relative-time の表記揺れに依存しない (TaskDetailPanel.tsx L131)。
    await page.locator("select").first().selectOption({ value: event.id });

    // --- DB: tasks.depends_on_event_id 更新 ---------------------------------
    await expect
      .poll(async () => (await getTaskByTitle(admin, userId, taskTitle)).depends_on_event_id, {
        message: "tasks.depends_on_event_id should equal the selected event id",
        timeout: 5_000,
      })
      .toBe(event.id);

    // --- action_log: task_dependency_set ------------------------------------
    const setLog = await waitForActionLog(
      admin,
      userId,
      (l) =>
        l.action_type === "task_dependency_set" &&
        (l.metadata as { event_id?: string }).event_id === event.id,
      { description: "task_dependency_set log" },
    );
    expect((setLog.metadata as { task_id?: string }).task_id).toBe(task.id);
    expect((setLog.metadata as { was?: string | null }).was).toBeNull();

    // --- TopTaskCard のバッジに依存先イベントの title が表示される ----------
    // panel は overlay で前面にあるが listitem 自体は DOM にあるので textContent
    // は取れる (toContainText は表示有無に関係なく DOM を見る)。
    await expect(row).toContainText(eventTitle);

    // --- 依存をクリアして task_dependency_cleared が記録される -------------
    // 依存設定後はボタン文言が "<relative> <title> を変更" になる。
    // 文言の relative-time 部分 (例: "5/14" / "3年後" など) に依存しないよう
    // suffix `を変更` で取る。
    await page.getByRole("button", { name: /を変更$/ }).click();
    await page.locator("select").first().selectOption({ value: "" });

    await expect
      .poll(async () => (await getTaskByTitle(admin, userId, taskTitle)).depends_on_event_id, {
        message: "tasks.depends_on_event_id should be null after clear",
        timeout: 5_000,
      })
      .toBeNull();

    const clearedLog = await waitForActionLog(
      admin,
      userId,
      (l) =>
        l.action_type === "task_dependency_cleared" &&
        (l.metadata as { task_id?: string }).task_id === task.id,
      { description: "task_dependency_cleared log" },
    );
    expect((clearedLog.metadata as { was?: string }).was).toBe(event.id);
  });

  test("TaskRow (非トップ) のタスクにも依存イベントバッジが表示される", async ({
    signedInPageWithProject: page,
    projectName,
    testUserId: userId,
  }) => {
    const topTaskTitle = "トップのダミータスク";
    const subTaskTitle = "依存先を持つサブタスク";
    const eventTitle = "サブタスクの依存先";
    const startLocal = "2030-08-01T10:00";
    const endLocal = "2030-08-01T11:00";

    const admin = createAdminClient();

    // --- 依存先イベント -----------------------------------------------------
    await page.getByRole("button", { name: "新規追加" }).click();
    const addEvent = page.getByRole("dialog", { name: "追加メニュー" });
    await addEvent.getByRole("tab", { name: "イベント" }).click();
    await addEvent.getByLabel("タイトル").fill(eventTitle);
    await addEvent.getByLabel("開始").fill(startLocal);
    await addEvent.getByLabel("終了").fill(endLocal);
    await addEvent.getByRole("button", { name: "追加" }).click();
    await expect(addEvent).toHaveCount(0);

    const event = await getEventByTitle(admin, userId, eventTitle);

    // --- タスクを 2 件作る (1件目=TopTaskCard, 2件目=TaskRow) -----------------
    for (const title of [topTaskTitle, subTaskTitle]) {
      await page.getByRole("button", { name: "新規追加" }).click();
      const addTask = page.getByRole("dialog", { name: "追加メニュー" });
      await addTask.getByRole("tab", { name: "タスク" }).click();
      await addTask.getByLabel("タイトル").fill(title);
      await addTask.getByLabel("プロジェクト").selectOption({ label: projectName });
      await addTask.getByRole("button", { name: "追加" }).click();
      await expect(addTask).toHaveCount(0);
    }

    const stack = page.getByRole("list", { name: "タスクスタック" });
    const subRow = stack.getByRole("listitem").filter({ hasText: subTaskTitle });
    await expect(subRow).toBeVisible();

    // --- 2件目 (TaskRow) を開いて依存設定 -----------------------------------
    await subRow.getByText(subTaskTitle).first().click();
    await page.getByRole("button", { name: /なし\s+を変更/ }).click();
    await page.locator("select").first().selectOption({ value: event.id });

    const subTask = await getTaskByTitle(admin, userId, subTaskTitle);
    await expect
      .poll(async () => (await getTaskByTitle(admin, userId, subTaskTitle)).depends_on_event_id, {
        message: "sub task depends_on_event_id reflects in DB",
        timeout: 5_000,
      })
      .toBe(event.id);

    // --- TaskRow のバッジに event title が乗る ------------------------------
    // TaskRow.tsx L59-68: `← {relative} {title}` の <span>。
    await expect(subRow).toContainText(eventTitle);
    // top の row に同じ文字列が紛れ込んでないことも軽く担保 (依存設定したのは sub のみ)
    const topRow = stack.getByRole("listitem").filter({ hasText: topTaskTitle });
    await expect(topRow).not.toContainText(eventTitle);

    // metadata にも task_id が乗っていることを確認 (Phase 4 学習で task との
    // 紐付けが取れる必要がある)
    const setLog = await waitForActionLog(
      admin,
      userId,
      (l) =>
        l.action_type === "task_dependency_set" &&
        (l.metadata as { task_id?: string }).task_id === subTask.id,
      { description: "task_dependency_set log for sub task" },
    );
    expect((setLog.metadata as { event_id?: string }).event_id).toBe(event.id);
  });
});
