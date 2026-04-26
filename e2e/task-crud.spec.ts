import {
  createAdminClient,
  getActionLogs,
  getProjectByName,
  getTaskByTitle,
  getTimeEntries,
  waitForActionLog,
} from "./db";
import { expect, test } from "./fixtures";

/**
 * Issue #67 🟧 / ADR 0001:
 *   タスク作成フローの DB 整合 (tasks 行 + projects FK + estimated_minutes)。
 *
 * golden-path.spec はタスク作成を踏むが UI 側しか見ていない。ここでは
 * 「title / project_id / estimated_minutes / status=idle / stack_order」が
 * tasks 行に正しく落ちることを service_role で踏む。
 * estimated_minutes は DB 制約 (tasks_estimated_minutes_positive) で守られて
 * いるが、Form は分単位で受けて DB も分単位で保存する (gateway の素通し)。
 */
test.describe("タスク作成 (tasks 行整合)", () => {
  test("title / project / 見積もり時間 が tasks 行に正しく落ちる", async ({
    signedInPageWithProject: page,
    projectName,
    testUserId: userId,
  }) => {
    const taskTitle = "見積もり付きタスク";
    const estimatedMinutes = 45;

    const admin = createAdminClient();

    const project = await getProjectByName(admin, userId, projectName);

    await page.getByRole("button", { name: "新規追加" }).click();
    const addDialog = page.getByRole("dialog", { name: "追加メニュー" });
    await addDialog.getByRole("tab", { name: "タスク" }).click();
    await addDialog.getByLabel("タイトル").fill(taskTitle);
    await addDialog.getByLabel("プロジェクト").selectOption({ label: projectName });
    await addDialog.getByLabel("見積もり (分)").fill(String(estimatedMinutes));
    await addDialog.getByRole("button", { name: "追加" }).click();
    await expect(addDialog).toHaveCount(0);

    const stack = page.getByRole("list", { name: "タスクスタック" });
    await expect(stack.getByRole("listitem").filter({ hasText: taskTitle })).toBeVisible();

    const task = await getTaskByTitle(admin, userId, taskTitle);
    expect(task.title).toBe(taskTitle);
    expect(task.project_id).toBe(project.id);
    expect(task.estimated_minutes).toBe(estimatedMinutes);
    expect(task.body).toBe("");
    expect(task.status).toBe("idle");
    // AppShell.onCreateTask は pending 件数を stackOrder に渡す。
    // 直前まで pending タスクは 0 件だったので 0 が入るはず。
    expect(task.stack_order).toBe(0);
    expect(task.depends_on_event_id).toBeNull();

    // 作成自体は action_log を吐かない (ADR 0001 の対象 type に task_created が無い)。
    // 他の action_log が混入していないことだけ軽く担保しておく。
    const logs = await getActionLogs(admin, userId);
    expect(logs.filter((l) => l.task_id === task.id)).toHaveLength(0);
  });
});

/**
 * Issue #67 🟧:
 *   TaskDetailPanel から body を編集すると DB に永続化される。
 *
 * TaskDetailPanel は body のみ編集可。estimated_minutes / title の編集 UI は
 * 現状無い (TaskDetailPanel.tsx)。ユーザーの「タスクの中身を書く」体験は
 * Phase 1 の体験仕様に含まれるので、UI から DB まで通ることを踏む。
 */
test.describe("タスク編集 (TaskDetailPanel body)", () => {
  test("body を編集して保存すると tasks.body が更新される", async ({
    signedInPageWithProject: page,
    projectName,
    testUserId: userId,
  }) => {
    const taskTitle = "詳細を書くタスク";
    const newBody = "## 準備\n- 資料を集める\n- アジェンダを書く";

    const admin = createAdminClient();

    await page.getByRole("button", { name: "新規追加" }).click();
    const addDialog = page.getByRole("dialog", { name: "追加メニュー" });
    await addDialog.getByRole("tab", { name: "タスク" }).click();
    await addDialog.getByLabel("タイトル").fill(taskTitle);
    await addDialog.getByLabel("プロジェクト").selectOption({ label: projectName });
    await addDialog.getByRole("button", { name: "追加" }).click();
    await expect(addDialog).toHaveCount(0);

    const stack = page.getByRole("list", { name: "タスクスタック" });
    const row = stack.getByRole("listitem").filter({ hasText: taskTitle });
    await expect(row).toBeVisible();

    const task = await getTaskByTitle(admin, userId, taskTitle);
    expect(task.body).toBe("");

    // 詳細パネルを開く (TopTaskCard 全体が onClick、title 文字を狙う)。
    await row.getByText(taskTitle).first().click();

    await page.getByRole("button", { name: "編集" }).click();
    // textarea は role=textbox では取れない (placeholder ベース)。
    const textarea = page.getByPlaceholder("Markdownで詳細を入力...");
    await expect(textarea).toBeVisible();
    await textarea.fill(newBody);
    await page.getByRole("button", { name: "保存" }).click();

    // 保存後はパネルが view モードに戻り「編集」ボタンが再度見える。
    await expect(page.getByRole("button", { name: "編集" })).toBeVisible();

    // DB は楽観的更新と非同期 mutation の間に小ラグがあり得るので poll。
    await expect
      .poll(
        async () => {
          const t = await getTaskByTitle(admin, userId, taskTitle);
          return t.body;
        },
        { message: "tasks.body が新しい本文に更新される", timeout: 5_000 },
      )
      .toBe(newBody);
  });
});

/**
 * Issue #67 🟥 / 🟧 / ADR 0001:
 *   タスク削除フローの DB 整合 (task_deleted action_log + cascade)。
 *
 * 削除はリグレで一番気付きにくい (UI からは消える / DB を見ないとわからない) が、
 * Phase 3 の学習で「ユーザーが何を捨てたか」を学ぶには task_deleted ログの
 * 存続が必須 (vision.md / ADR 0001)。タスク本体の消失と time_entries の
 * cascade、ログの永続化を 1 セットで踏む。
 */
test.describe("タスク削除 (task_deleted + cascade)", () => {
  test("削除すると task_time_entries が cascade で消え、task_deleted ログが残る", async ({
    signedInPageWithProject: page,
    projectName,
    testUserId: userId,
  }) => {
    const taskTitle = "削除されるタスク";

    const admin = createAdminClient();

    // --- タスク追加 ----------------------------------------------------------
    await page.getByRole("button", { name: "新規追加" }).click();
    const addDialog = page.getByRole("dialog", { name: "追加メニュー" });
    await addDialog.getByRole("tab", { name: "タスク" }).click();
    await addDialog.getByLabel("タイトル").fill(taskTitle);
    await addDialog.getByLabel("プロジェクト").selectOption({ label: projectName });
    await addDialog.getByRole("button", { name: "追加" }).click();
    await expect(addDialog).toHaveCount(0);

    const stack = page.getByRole("list", { name: "タスクスタック" });
    const row = stack.getByRole("listitem").filter({ hasText: taskTitle });
    await expect(row).toBeVisible();

    const task = await getTaskByTitle(admin, userId, taskTitle);
    const taskId = task.id;

    // --- 開始 → 中断: task_time_entries を 1 件 close 状態で残す --------------
    // cascade を確認するため、先に time_entries が DB に存在する状態を作る。
    await page.getByRole("button", { name: "開始" }).click();
    await expect(page.getByRole("button", { name: "中断" })).toBeVisible();

    await page.getByRole("button", { name: "中断" }).click();
    const pauseDialog = page.getByRole("dialog", { name: "中断の理由" });
    await pauseDialog.getByRole("button", { name: /自発的に中断/ }).click();
    await expect(page.getByRole("button", { name: "再開" })).toBeVisible();

    // pause 後、entry が DB に書かれるまで待つ。
    await expect
      .poll(async () => (await getTimeEntries(admin, taskId)).length, {
        message: "task_time_entries should have at least 1 row after pause",
        timeout: 5_000,
      })
      .toBeGreaterThanOrEqual(1);

    // --- TaskDetailPanel から削除 -------------------------------------------
    // ブラウザ標準 confirm を accept する。
    page.once("dialog", (d) => d.accept());

    // タイトル文字をクリックして詳細パネルを開く (TopTaskCard 全体が onClick)。
    // アクションボタン領域を避けるため title 文字を狙う。
    await row.getByText(taskTitle).first().click();

    // TaskDetailPanel には role=dialog が無いので button 名で取る。
    // この時点で他に「削除」ボタンが出る画面要素は無い。
    await page.getByRole("button", { name: "削除" }).click();

    // 削除すると pending stack から消える。
    await expect(row).toHaveCount(0);

    // --- DB 整合 -------------------------------------------------------------
    // tasks 行が消える (poll: 楽観的更新と DB 反映の間に小さなラグがある)。
    await expect
      .poll(
        async () => {
          const { data } = await admin.from("tasks").select("id").eq("id", taskId).maybeSingle();
          return data;
        },
        { message: "tasks row should be deleted", timeout: 5_000 },
      )
      .toBeNull();

    // task_time_entries は ON DELETE CASCADE で同時に消える (initial_schema.sql)。
    expect(await getTimeEntries(admin, taskId)).toHaveLength(0);

    // task_deleted の action_log が残る。
    // ADR 0001: 削除イベント自体を Phase 3 学習の入力として保持したい。
    // FK 制約 (ON DELETE SET NULL) は INSERT 時に効かないので、column.task_id
    // に削除済み id を書こうとすると FK 違反で insert 自体が落ちる。logger は
    // task_deleted のときだけ column を null にして metadata.task_id を一次の
    // 真実として残す (logger.ts: extractTaskId)。
    const deletedLog = await waitForActionLog(
      admin,
      userId,
      (l) =>
        l.action_type === "task_deleted" && (l.metadata as { task_id?: string }).task_id === taskId,
      { description: "task_deleted log with metadata.task_id" },
    );
    expect((deletedLog.metadata as { task_id?: string }).task_id).toBe(taskId);
    expect(deletedLog.task_id).toBeNull();

    // 過去の task_started ログは SET NULL で task_id 列が NULL になっている
    // はずだが、metadata.task_id は jsonb なので残る (Phase 3 で metadata
    // 経由の相関を取れるかの基盤)。
    const allLogs = await getActionLogs(admin, userId);
    const startedForThisTask = allLogs.filter(
      (l) =>
        l.action_type === "task_started" && (l.metadata as { task_id?: string }).task_id === taskId,
    );
    expect(startedForThisTask).toHaveLength(1);
    expect(startedForThisTask[0].task_id).toBeNull();
  });
});
