import { createAdminClient, getTaskByTitle, seedTask, waitForActionLog } from "./db";
import { expect, test } from "./fixtures";

/**
 * Issue #171 / ADR-0039:
 *   タスク詳細パネルからの project 変更と、親→子 / 子→兄弟+親 への伝播。
 *
 * 単独タスクは確認 dialog なしで即変更、親 (子あり) と子 (兄弟+親あり) は
 * 影響件数を見せる確認 dialog 経由で変更する (UI は #171 で確定)。
 *
 * 不変条件:
 * - DB: 影響範囲全行の `tasks.project_id` が新値に揃う
 * - action_log: `task_project_changed` が **1 ログ** 発火し、`propagation` と
 *   `affected_task_ids` payload で「1 操作 → N 行更新」を再構成可能 (ADR-0035 / -0039)
 * - 親と子で project_id が乖離する状態は作られない (ADR-0039 不変条件)
 */

test.describe("project 編集 + 親-子-兄弟への伝播 (Issue #171 / ADR-0039)", () => {
  test("単独タスク: dialog なしで project が即更新され、propagation=single の log が残る", async ({
    signedInPageWithProject: page,
    projectName,
    testUserId: userId,
  }) => {
    const admin = createAdminClient();

    // signedInPageWithProject が UI で作った project1 を引き当て、admin で project2 を別途作る。
    const project1 = await fetchProjectId(admin, userId, projectName);
    const project2 = await seedAdminProject(admin, userId, "別 project (単独)");

    // 単独タスク (parent も子もなし) を seed。decompose_status='none' で Stack に出る。
    const seededLone = await seedTask(admin, {
      userId,
      projectId: project1,
      title: "単独タスク P",
      stackOrder: 0,
    });

    await page.reload();

    const stack = page.getByRole("list", { name: "タスクスタック" });
    const row = stack.getByRole("listitem").filter({ hasText: "単独タスク P" });
    await expect(row).toBeVisible();
    // タイトル文字を狙うと TopTaskCard onClick で詳細パネルが開く
    // (task-category-override / dependency-event spec と同じ pattern)。
    await row.getByText("単独タスク P").first().click();

    // project ボタン → select の order は project / size / category。
    // 「<project1> を変更」が出る。
    await page.getByRole("button", { name: new RegExp(`${projectName}\\s+を変更`) }).click();
    // 編集中の最初の <select> が project (依存イベントは onChangeDependency が出ないと出ない、
    // task_size / task_category はそれぞれ独立 button → select なので、編集中のものは 1 件)。
    await page.locator("select").first().selectOption({ value: project2 });

    // 単独タスクは dialog 出ずに即発火 (ADR-0039: 単独は当該行のみ変更)。
    await expect(page.getByRole("dialog", { name: "プロジェクト変更の確認" })).toHaveCount(0);

    // DB: 単独タスクの project_id が project2 になる。
    await expect
      .poll(async () => (await getTaskByTitle(admin, userId, "単独タスク P")).project_id, {
        message: "tasks.project_id should equal project2",
        timeout: 5_000,
      })
      .toBe(project2);

    // action_log: propagation=single, affected_task_ids=[target] のみ。
    const log = await waitForActionLog(
      admin,
      userId,
      (l) =>
        l.action_type === "task_project_changed" &&
        (l.metadata as { task_id?: string }).task_id === seededLone.id,
      { description: "task_project_changed (single) log" },
    );
    const meta = log.metadata as {
      from?: string | null;
      to?: string | null;
      propagation?: string;
      affected_task_ids?: string[];
    };
    expect(meta.from).toBe(project1);
    expect(meta.to).toBe(project2);
    expect(meta.propagation).toBe("single");
    expect(meta.affected_task_ids).toEqual([seededLone.id]);
  });

  test("親タスク (子あり): dialog 経由で親 + 全子の project_id が一括変更され、propagation=with_children", async ({
    signedInPageWithProject: page,
    projectName,
    testUserId: userId,
  }) => {
    const admin = createAdminClient();

    const project1 = await fetchProjectId(admin, userId, projectName);
    const project2 = await seedAdminProject(admin, userId, "別 project (親→子)");

    // 親 + 子 2 件を seed。親の decompose_status は 'none' にして Stack に出るようにする
    // (ADR-0016: leaf-parent ケース。'decomposed' だと親は Stack に出ないので詳細を Stack 経由で
    // 開けない)。「子を持つ none 親」は実運用では稀だが、ADR-0016 / -0018 の状態遷移上は
    // 矛盾しない (decompose 試行前 / 失敗 / skipped の親はそのまま Stack に出る)。
    const parent = await seedTask(admin, {
      userId,
      projectId: project1,
      title: "親 cascade テスト",
      stackOrder: 0,
      decomposeStatus: "none",
    });
    const child1 = await seedTask(admin, {
      userId,
      projectId: project1,
      title: "子 cascade テスト 1",
      stackOrder: 1,
      parentTaskId: parent.id,
    });
    const child2 = await seedTask(admin, {
      userId,
      projectId: project1,
      title: "子 cascade テスト 2",
      stackOrder: 2,
      parentTaskId: parent.id,
    });

    await page.reload();

    const stack = page.getByRole("list", { name: "タスクスタック" });
    const parentRow = stack.getByRole("listitem").filter({ hasText: "親 cascade テスト" });
    await expect(parentRow).toBeVisible();
    await parentRow.getByText("親 cascade テスト").first().click();

    await page.getByRole("button", { name: new RegExp(`${projectName}\\s+を変更`) }).click();
    await page.locator("select").first().selectOption({ value: project2 });

    // 親 (子あり) は dialog 経由。文言には子件数 (2 件) と移動先 project 名が出る (issue #171)。
    const dialog = page.getByRole("dialog", { name: "プロジェクト変更の確認" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/2 件の子タスクも.*別 project \(親→子\)/)).toBeVisible();
    await dialog.getByRole("button", { name: "変更する" }).click();
    await expect(dialog).toHaveCount(0);

    // DB: 親 + 全子の project_id が project2 に揃う (ADR-0039 不変条件: 親と子で乖離させない)。
    await expect
      .poll(
        async () => {
          const [p, c1, c2] = await Promise.all([
            getTaskByTitle(admin, userId, "親 cascade テスト"),
            getTaskByTitle(admin, userId, "子 cascade テスト 1"),
            getTaskByTitle(admin, userId, "子 cascade テスト 2"),
          ]);
          return [p.project_id, c1.project_id, c2.project_id];
        },
        { timeout: 5_000 },
      )
      .toEqual([project2, project2, project2]);

    // action_log: 1 操作 = 1 ログ + payload に伝播範囲。affected_task_ids は順序を保証しないので集合で比較。
    const log = await waitForActionLog(
      admin,
      userId,
      (l) =>
        l.action_type === "task_project_changed" &&
        (l.metadata as { task_id?: string }).task_id === parent.id,
      { description: "task_project_changed (with_children) log" },
    );
    const meta = log.metadata as {
      propagation?: string;
      affected_task_ids?: string[];
      to?: string | null;
    };
    expect(meta.propagation).toBe("with_children");
    expect(meta.to).toBe(project2);
    expect(new Set(meta.affected_task_ids)).toEqual(new Set([parent.id, child1.id, child2.id]));
  });

  test("子タスク: dialog 経由で親 + 全兄弟 + 子 の project_id が一括変更され、propagation=with_siblings_and_parent", async ({
    signedInPageWithProject: page,
    projectName,
    testUserId: userId,
  }) => {
    const admin = createAdminClient();

    const project1 = await fetchProjectId(admin, userId, projectName);
    const project2 = await seedAdminProject(admin, userId, "別 project (子→兄弟+親)");

    const parent = await seedTask(admin, {
      userId,
      projectId: project1,
      title: "親 (子経由テスト)",
      stackOrder: 0,
      decomposeStatus: "none",
    });
    const target = await seedTask(admin, {
      userId,
      projectId: project1,
      title: "子 target (子経由テスト)",
      stackOrder: 1,
      parentTaskId: parent.id,
    });
    const sibling = await seedTask(admin, {
      userId,
      projectId: project1,
      title: "兄弟 (子経由テスト)",
      stackOrder: 2,
      parentTaskId: parent.id,
    });

    await page.reload();

    const stack = page.getByRole("list", { name: "タスクスタック" });
    const targetRow = stack.getByRole("listitem").filter({ hasText: "子 target (子経由テスト)" });
    await expect(targetRow).toBeVisible();
    await targetRow.getByText("子 target (子経由テスト)").first().click();

    await page.getByRole("button", { name: new RegExp(`${projectName}\\s+を変更`) }).click();
    await page.locator("select").first().selectOption({ value: project2 });

    // 子は dialog 経由。文言は「親タスクと N 件の兄弟タスクも...」(target を除く兄弟数)。
    const dialog = page.getByRole("dialog", { name: "プロジェクト変更の確認" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(/親タスクと 1 件の兄弟タスクも.*別 project \(子→兄弟\+親\)/),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "変更する" }).click();
    await expect(dialog).toHaveCount(0);

    // DB: 親 + target 子 + 兄弟、すべての project_id が揃う。
    await expect
      .poll(
        async () => {
          const [p, t, s] = await Promise.all([
            getTaskByTitle(admin, userId, "親 (子経由テスト)"),
            getTaskByTitle(admin, userId, "子 target (子経由テスト)"),
            getTaskByTitle(admin, userId, "兄弟 (子経由テスト)"),
          ]);
          return [p.project_id, t.project_id, s.project_id];
        },
        { timeout: 5_000 },
      )
      .toEqual([project2, project2, project2]);

    // action_log: action_logs.task_id は user が直接編集した行 (= target 子)。
    const log = await waitForActionLog(
      admin,
      userId,
      (l) =>
        l.action_type === "task_project_changed" &&
        (l.metadata as { task_id?: string }).task_id === target.id,
      { description: "task_project_changed (with_siblings_and_parent) log" },
    );
    const meta = log.metadata as {
      propagation?: string;
      affected_task_ids?: string[];
      to?: string | null;
    };
    expect(meta.propagation).toBe("with_siblings_and_parent");
    expect(meta.to).toBe(project2);
    expect(new Set(meta.affected_task_ids)).toEqual(new Set([parent.id, target.id, sibling.id]));
  });

  test("確認 dialog の キャンセル: DB / action_log は変化しない", async ({
    signedInPageWithProject: page,
    projectName,
    testUserId: userId,
  }) => {
    const admin = createAdminClient();

    const project1 = await fetchProjectId(admin, userId, projectName);
    const project2 = await seedAdminProject(admin, userId, "別 project (cancel)");

    const parent = await seedTask(admin, {
      userId,
      projectId: project1,
      title: "親 (cancel)",
      stackOrder: 0,
      decomposeStatus: "none",
    });
    await seedTask(admin, {
      userId,
      projectId: project1,
      title: "子 (cancel)",
      stackOrder: 1,
      parentTaskId: parent.id,
    });

    await page.reload();

    const stack = page.getByRole("list", { name: "タスクスタック" });
    const parentRow = stack.getByRole("listitem").filter({ hasText: "親 (cancel)" });
    await parentRow.getByText("親 (cancel)").first().click();

    await page.getByRole("button", { name: new RegExp(`${projectName}\\s+を変更`) }).click();
    await page.locator("select").first().selectOption({ value: project2 });

    const dialog = page.getByRole("dialog", { name: "プロジェクト変更の確認" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "キャンセル" }).click();
    await expect(dialog).toHaveCount(0);

    // DB は project1 のまま。ログ非同期書き込みも待つために少し空ける。
    await page.waitForTimeout(500);
    const parentRow2 = await getTaskByTitle(admin, userId, "親 (cancel)");
    const childRow = await getTaskByTitle(admin, userId, "子 (cancel)");
    expect(parentRow2.project_id).toBe(project1);
    expect(childRow.project_id).toBe(project1);

    // action_log にも task_project_changed は 0 件。
    const { data: logs } = await admin
      .from("action_logs")
      .select("*")
      .eq("user_id", userId)
      .eq("action_type", "task_project_changed");
    expect(logs?.length ?? 0).toBe(0);
  });
});

// =====================================================================
// helpers (本 spec ローカル)
// =====================================================================

async function fetchProjectId(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  projectName: string,
): Promise<string> {
  const { data, error } = await admin
    .from("projects")
    .select("id")
    .eq("user_id", userId)
    .eq("name", projectName)
    .single();
  if (error || !data) {
    throw new Error(`[e2e] project '${projectName}' not found for user ${userId}`);
  }
  return (data as { id: string }).id;
}

async function seedAdminProject(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  name: string,
): Promise<string> {
  const { data, error } = await admin
    .from("projects")
    .insert({ user_id: userId, name, color: "#5B8DEF", is_primary: false })
    .select("id")
    .single();
  if (error || !data) {
    throw new Error(`[e2e] seed project '${name}' failed: ${error?.message ?? "no row"}`);
  }
  return (data as { id: string }).id;
}
