import { createAdminClient, getTaskByTitle, waitForActionLog } from "./db";
import { expect, test } from "./fixtures";

/**
 * P3-5 (#90) / ADR 0015:
 *   タスク詳細パネルからの `task_category` override の DB / action_log 整合。
 *
 * `task_category` は Phase 3 / 4 の見積もり補正・行動パターン分析の入力軸で、
 * 「人間が AI 初期ラベルを訂正した」操作自体が暗黙的フィードバックとして
 * Phase 4 のラベリング精度改善ループに流れる (ADR 0015 / ADR 0001 延長)。
 *
 * 不変条件:
 * - AddPanel には category 入力が出ない (vision §1.7「承認ステップは挟まない」)
 * - 詳細パネル (`<select>` "タスク種類") から override すると
 *   - tasks.task_category が更新される
 *   - action_logs に `task_category_changed` が `{ from, to }` で記録される
 */
test.describe("task_category override (TaskDetailPanel → DB → action_log)", () => {
  test("AddPanel のタスクタブには category 入力が出ない (ADR 0015 暗黙的フィードバック原則)", async ({
    signedInPageWithProject: page,
  }) => {
    await page.getByRole("button", { name: "新規追加" }).click();
    const addDialog = page.getByRole("dialog", { name: "追加メニュー" });
    await addDialog.getByRole("tab", { name: "タスク" }).click();

    // タイトル / プロジェクト / 見積もり / 依存イベント等は出るが、タスク種類はここに置かない。
    // category を AddPanel から消しているのが ADR 0015 の核 (人間に「分類を選べ」という
    // 明示プロンプトを出さない / AI 初期ラベル + override で済ませる) なので、
    // ここに category 入力が紛れたら設計が崩れている = 落とす。
    await expect(addDialog.getByLabel(/タスク種類|分類|カテゴリ/)).toHaveCount(0);
  });

  test("詳細パネルから category を override → tasks.task_category と task_category_changed が一致する", async ({
    signedInPageWithProject: page,
    projectName,
    testUserId: userId,
  }) => {
    const taskTitle = "category override 対象";

    const admin = createAdminClient();

    // --- タスクを 1 件追加 -------------------------------------------------
    await page.getByRole("button", { name: "新規追加" }).click();
    const addDialog = page.getByRole("dialog", { name: "追加メニュー" });
    await addDialog.getByRole("tab", { name: "タスク" }).click();
    await addDialog.getByLabel("タイトル").fill(taskTitle);
    // #170 / ADR 0038: task_size は登録時必須。
    await addDialog.getByRole("radio", { name: "30分" }).click();
    await addDialog.getByLabel("プロジェクト (任意)").selectOption({ label: projectName });
    await addDialog.getByRole("button", { name: "追加" }).click();
    await expect(addDialog).toHaveCount(0);

    const stack = page.getByRole("list", { name: "タスクスタック" });
    const row = stack.getByRole("listitem").filter({ hasText: taskTitle });
    await expect(row).toBeVisible();

    // 初期状態: AI 経路は AI_ENABLED=false でバイパスされる (ADR 0014) ので
    // task_category は null のまま。これが「override の `from`」になる。
    const created = await getTaskByTitle(admin, userId, taskTitle);
    expect(created.task_category).toBeNull();

    // --- 詳細パネルを開いて category を override ---------------------------
    // タイトル文字を狙うと TopTaskCard onClick で詳細パネルに遷移する
    // (dependency-event.spec.ts と同じパターン)。
    await row.getByText(taskTitle).first().click();

    // 依存イベントと同じ「ボタン → select」パターン。デフォルトは「未分類 を変更」。
    // 依存編集の「なし を変更」と substring で衝突しないので role + name で取れる。
    await page.getByRole("button", { name: /未分類\s+を変更/ }).click();
    // editingCategory=true で <select autoFocus> が render される。
    await page.locator("select").first().selectOption({ value: "doc" });

    // --- DB: tasks.task_category 更新 --------------------------------------
    await expect
      .poll(async () => (await getTaskByTitle(admin, userId, taskTitle)).task_category, {
        message: "tasks.task_category should equal the overridden value",
        timeout: 5_000,
      })
      .toBe("doc");

    // --- action_log: task_category_changed --------------------------------
    const log = await waitForActionLog(
      admin,
      userId,
      (l) =>
        l.action_type === "task_category_changed" &&
        (l.metadata as { task_id?: string }).task_id === created.id,
      { description: "task_category_changed log" },
    );
    // from は AI 失敗 / 既存タスクで null になり得る (ADR 0015)。
    // 本ケースは AI_ENABLED=false で null から override したので from=null。
    expect((log.metadata as { from?: string | null }).from).toBeNull();
    expect((log.metadata as { to?: string }).to).toBe("doc");
  });

  test("override → 同じ値で再選択しても重複ログを出さない", async ({
    signedInPageWithProject: page,
    projectName,
    testUserId: userId,
  }) => {
    const taskTitle = "category 同値再選択";

    const admin = createAdminClient();

    await page.getByRole("button", { name: "新規追加" }).click();
    const addDialog = page.getByRole("dialog", { name: "追加メニュー" });
    await addDialog.getByRole("tab", { name: "タスク" }).click();
    await addDialog.getByLabel("タイトル").fill(taskTitle);
    // #170 / ADR 0038: task_size は登録時必須。
    await addDialog.getByRole("radio", { name: "30分" }).click();
    await addDialog.getByLabel("プロジェクト (任意)").selectOption({ label: projectName });
    await addDialog.getByRole("button", { name: "追加" }).click();
    await expect(addDialog).toHaveCount(0);

    const stack = page.getByRole("list", { name: "タスクスタック" });
    const row = stack.getByRole("listitem").filter({ hasText: taskTitle });
    await row.getByText(taskTitle).first().click();

    // 1 回目の override: 未分類 → research
    await page.getByRole("button", { name: /未分類\s+を変更/ }).click();
    await page.locator("select").first().selectOption({ value: "research" });

    const created = await getTaskByTitle(admin, userId, taskTitle);
    await expect
      .poll(async () => (await getTaskByTitle(admin, userId, taskTitle)).task_category, {
        timeout: 5_000,
      })
      .toBe("research");

    // 2 回目: ボタン文言は「調査 を変更」になっているはず。同じ値で確定 (no-op)
    await page.getByRole("button", { name: /調査\s+を変更/ }).click();
    await page.locator("select").first().selectOption({ value: "research" });

    // 少し待って action_logs を取得
    await page.waitForTimeout(500);
    const { data } = await admin
      .from("action_logs")
      .select("*")
      .eq("user_id", userId)
      .eq("action_type", "task_category_changed")
      .eq("task_id", created.id);
    expect(data?.length).toBe(1);
  });
});
