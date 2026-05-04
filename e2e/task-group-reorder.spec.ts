import type { Page } from "@playwright/test";

import { createAdminClient, getTaskByTitle, seedTask, waitForActionLog } from "./db";
import { expect, test } from "./fixtures";

/**
 * Issue #172 / ADR-0040 / ADR-0041:
 *   - 新規タスクは Top の直下 (visible 上から 2 番目) に挿入される
 *   - 親バッジ起点で同じ `parent_task_id` を持つ全行をグループとして
 *     まとめて並び替えできる (action_log: `task_reordered.group_parent_id`)
 *   - グループ内の個別行ドラッグは従来通り (Grip 起点) 動く
 */

test.describe("ADR-0040: 新規タスクは Top 直下に挿入される", () => {
  test("Top タスクは押し下げられず、新規タスクが Stack 2 番目に入る", async ({
    signedInPageWithProject: page,
    projectName,
  }) => {
    // 既存タスク 3 件を順に登録 (末尾追加挙動が default だった頃と同じ操作)。
    // ADR-0040 後は「最後に登録した N3 が Top の直下」に来るのが期待挙動。
    const titles = ["先頭A", "中B", "末C"] as const;
    for (const t of titles) {
      await createTaskViaUI(page, t, projectName);
    }

    const stack = page.getByRole("list", { name: "タスクスタック" });
    // 3 件入った時点での visible 順は登録順 (= A, B, C)。最後に登録した C が
    // Top の直下に入っているはず。
    await expectVisibleOrder(stack, ["先頭A", "末C", "中B"]);

    // 4 件目を追加。Top (A) は維持され、N が 2 番目に来る。
    await createTaskViaUI(page, "新規N", projectName);
    await expectVisibleOrder(stack, ["先頭A", "新規N", "末C", "中B"]);
  });
});

test.describe("ADR-0041: 親バッジ起点のグループ並べ替え", () => {
  test("親 P の子グループが分断中でも、親バッジドラッグでグループ単位で再収束する", async ({
    signedInPageWithProject: page,
    projectName,
    testUserId: userId,
  }) => {
    const admin = createAdminClient();
    // signedInPageWithProject が UI 経由で作った project を再利用するため、
    // service_role で project を引き当てる (e2e fixture の補助 path)。
    const { data: projRow, error: projErr } = await admin
      .from("projects")
      .select("id")
      .eq("user_id", userId)
      .eq("name", projectName)
      .single();
    if (projErr || !projRow) throw new Error("[e2e] project not found");
    const projectId = (projRow as { id: string }).id;

    // 分断状態を service_role で seed する:
    //   stack_order:  0       1     2     3     4
    //   id:           c1     N    c2    p(hidden)  s
    //   parent:        p     -     p     -     -
    // visible:        c1     N    c2     -     s
    const parent = await seedTask(admin, {
      userId,
      projectId,
      title: "親P",
      stackOrder: 3,
      decomposeStatus: "decomposed",
    });
    await seedTask(admin, {
      userId,
      projectId,
      title: "子c1",
      stackOrder: 0,
      parentTaskId: parent.id,
    });
    await seedTask(admin, {
      userId,
      projectId,
      title: "新N",
      stackOrder: 1,
    });
    await seedTask(admin, {
      userId,
      projectId,
      title: "子c2",
      stackOrder: 2,
      parentTaskId: parent.id,
    });
    await seedTask(admin, {
      userId,
      projectId,
      title: "兄弟s",
      stackOrder: 4,
    });

    await page.reload();
    const stack = page.getByRole("list", { name: "タスクスタック" });
    // 分断状態の visible 順を確認。
    await expectVisibleOrder(stack, ["子c1", "新N", "子c2", "兄弟s"]);

    // 子 c2 の親バッジを起点にグループドラッグ → 兄弟s の上に落とす。
    // 期待: グループ {c1, c2} が s の手前にまとめて移動 → visible = [新N, 子c1, 子c2, 兄弟s]。
    await dragGroupAboveRow(page, "子c2", "親P", "兄弟s");

    await pollVisibleOrder(stack, ["新N", "子c1", "子c2", "兄弟s"], "グループ移動後の visible 順");

    // action_log に group_parent_id 付きの task_reordered が、グループ要素 2 件分残る。
    const c1Row = await getTaskByTitle(admin, userId, "子c1");
    const c2Row = await getTaskByTitle(admin, userId, "子c2");
    await waitForActionLog(
      admin,
      userId,
      (l) =>
        l.action_type === "task_reordered" &&
        (l.metadata as { task_id?: string }).task_id === c1Row.id &&
        (l.metadata as { group_parent_id?: string }).group_parent_id === parent.id,
      { description: "task_reordered.group_parent_id (c1)" },
    );
    await waitForActionLog(
      admin,
      userId,
      (l) =>
        l.action_type === "task_reordered" &&
        (l.metadata as { task_id?: string }).task_id === c2Row.id &&
        (l.metadata as { group_parent_id?: string }).group_parent_id === parent.id,
      { description: "task_reordered.group_parent_id (c2)" },
    );
  });

  test("グループ内の個別行ドラッグ (Grip 起点) は従来通り 1 行だけ動く", async ({
    signedInPageWithProject: page,
    projectName,
    testUserId: userId,
  }) => {
    const admin = createAdminClient();
    const { data: projRow } = await admin
      .from("projects")
      .select("id")
      .eq("user_id", userId)
      .eq("name", projectName)
      .single();
    const projectId = (projRow as { id: string }).id;

    const parent = await seedTask(admin, {
      userId,
      projectId,
      title: "親P",
      stackOrder: 0,
      decomposeStatus: "decomposed",
    });
    await seedTask(admin, {
      userId,
      projectId,
      title: "子c1",
      stackOrder: 1,
      parentTaskId: parent.id,
    });
    await seedTask(admin, {
      userId,
      projectId,
      title: "子c2",
      stackOrder: 2,
      parentTaskId: parent.id,
    });
    await seedTask(admin, {
      userId,
      projectId,
      title: "兄弟s",
      stackOrder: 3,
    });

    await page.reload();
    const stack = page.getByRole("list", { name: "タスクスタック" });
    await expectVisibleOrder(stack, ["子c1", "子c2", "兄弟s"]);

    // c2 の Grip を掴んで s の上へ単独ドラッグ → 期待: c1, s, c2 (グループ分断)
    await dragRowAboveRowByGrip(page, "子c2", "兄弟s");

    await pollVisibleOrder(
      stack,
      ["子c1", "兄弟s", "子c2"],
      "個別行 (Grip) ドラッグは 1 行だけ動く",
    );

    // action_log: 単独ドラッグなので group_parent_id は付かない。
    const c2Row = await getTaskByTitle(admin, userId, "子c2");
    const log = await waitForActionLog(
      admin,
      userId,
      (l) =>
        l.action_type === "task_reordered" &&
        (l.metadata as { task_id?: string }).task_id === c2Row.id,
      { description: "task_reordered (c2 個別)" },
    );
    expect((log.metadata as { group_parent_id?: string }).group_parent_id).toBeUndefined();
  });
});

async function createTaskViaUI(page: Page, title: string, projectName: string): Promise<void> {
  await page.getByRole("button", { name: "新規追加" }).click();
  const addDialog = page.getByRole("dialog", { name: "追加メニュー" });
  await addDialog.getByRole("tab", { name: "タスク" }).click();
  await addDialog.getByLabel("タイトル").fill(title);
  await addDialog.getByRole("radio", { name: "30分" }).click();
  await addDialog.getByLabel("プロジェクト (任意)").selectOption({ label: projectName });
  await addDialog.getByRole("button", { name: "追加" }).click();
  await expect(addDialog).toHaveCount(0);
}

async function expectVisibleOrder(
  stack: ReturnType<Page["getByRole"]>,
  expected: string[],
): Promise<void> {
  // 各 expected タイトルが listitem の中で対応する index 位置に現れるかを踏む。
  // listitem の textContent は Top カードで「project header / 開始 ボタン /
  // 未分解 pill」等を含むため完全一致ではなく toContainText で部分一致を取る。
  for (let i = 0; i < expected.length; i++) {
    await expect(stack.getByRole("listitem").nth(i)).toContainText(expected[i]);
  }
}

/**
 * 並び替え操作後の visible 順を poll で待つ。`expectVisibleOrder` と同じ
 * セマンティクスだが、Playwright の組み込み auto-wait を超えて長めの timeout
 * を取りたいケース (DnD → optimistic update → server reorder の経路) で使う。
 */
async function pollVisibleOrder(
  stack: ReturnType<Page["getByRole"]>,
  expected: string[],
  message: string,
): Promise<void> {
  await expect
    .poll(
      async () => {
        const items = await stack.getByRole("listitem").all();
        if (items.length !== expected.length) return null;
        const matched: string[] = [];
        for (let i = 0; i < expected.length; i++) {
          const txt = (await items[i].textContent()) ?? "";
          if (!txt.includes(expected[i])) return null;
          matched.push(expected[i]);
        }
        return matched;
      },
      { message, timeout: 8_000 },
    )
    .toEqual(expected);
}

/**
 * 親バッジ (`role=button`, `aria-label="親グループ並び替え: <親名>"`) を起点にした
 * グループドラッグ。`sourceTitle` の行に乗っている親バッジを掴んで、
 * `targetTitle` の上端より少し下に落とす (= target の midline より上)。
 *
 * バッジは text-[9px] の小さな要素のため、boundingBox 取得前に visible / scroll
 * を明示的に待つ (CI 環境でレイアウト確定前に measure すると drag 不発になる)。
 */
async function dragGroupAboveRow(
  page: Page,
  sourceTitle: string,
  parentTitle: string,
  targetTitle: string,
): Promise<void> {
  const stack = page.getByRole("list", { name: "タスクスタック" });
  const sourceRow = stack.getByRole("listitem").filter({ hasText: sourceTitle });
  const targetRow = stack.getByRole("listitem").filter({ hasText: targetTitle });

  const badge = sourceRow.getByRole("button", { name: `親グループ並び替え: ${parentTitle}` });
  await badge.waitFor({ state: "visible" });
  await badge.scrollIntoViewIfNeeded();
  const badgeBox = await badge.boundingBox();
  const targetBox = await targetRow.boundingBox();
  if (!badgeBox || !targetBox) throw new Error("badge/row not measurable");

  const startX = badgeBox.x + badgeBox.width / 2;
  const startY = badgeBox.y + badgeBox.height / 2;
  const endX = startX;
  const endY = targetBox.y + 4;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY - 20, { steps: 5 });
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();
}

async function dragRowAboveRowByGrip(
  page: Page,
  sourceTitle: string,
  targetTitle: string,
): Promise<void> {
  const stack = page.getByRole("list", { name: "タスクスタック" });
  const sourceRow = stack.getByRole("listitem").filter({ hasText: sourceTitle });
  const targetRow = stack.getByRole("listitem").filter({ hasText: targetTitle });

  // Row 1 の Grip (`aria-label="並び替えハンドル"`) を狙う。Row 3 の親バッジも
  // `.cursor-grab` を持つので `locator(".cursor-grab")` だと曖昧になるため
  // aria-label で明示的に指す。
  const grip = sourceRow.getByLabel("並び替えハンドル");
  await grip.waitFor({ state: "visible" });
  await grip.scrollIntoViewIfNeeded();
  const gripBox = await grip.boundingBox();
  const targetBox = await targetRow.boundingBox();
  if (!gripBox || !targetBox) throw new Error("row/grip not measurable");

  const startX = gripBox.x + gripBox.width / 2;
  const startY = gripBox.y + gripBox.height / 2;
  const endX = startX;
  const endY = targetBox.y + 4;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 5, { steps: 5 });
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();
}
