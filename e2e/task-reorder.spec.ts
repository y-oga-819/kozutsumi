import type { Page } from "@playwright/test";

import { createAdminClient, getTaskByTitle, waitForActionLog } from "./db";
import { expect, test } from "./fixtures";

/**
 * Issue #67 🟥 / 🟧 / ADR 0001:
 *   DnD 並び替えの DB 整合 (task_reordered + tasks.stack_order)。
 *
 * Phase 4 でユーザーがどのタスクを上に持ち上げて着手したか を学ぶには、
 * 並び替えの from/to_position と stack_order の両方が必要。UI 操作
 * (custom pointer events) と DB の最終状態を 1 セットで踏む。
 */
test.describe("DnD 並び替え (task_reordered + tasks.stack_order)", () => {
  test("末尾を先頭に持ち上げると stack_order が 0,1,2 で再採番され、from/to ログが残る", async ({
    signedInPageWithProject: page,
    projectName,
    testUserId: userId,
  }) => {
    const titles = ["並べ替え A", "並べ替え B", "並べ替え C"] as const;
    const admin = createAdminClient();

    for (const t of titles) {
      await createTask(page, t, projectName);
    }

    const stack = page.getByRole("list", { name: "タスクスタック" });
    for (const t of titles) {
      await expect(stack.getByRole("listitem").filter({ hasText: t })).toBeVisible();
    }

    // 末尾 (idx=2 / C) を先頭 (idx=0 / A の上) にドロップ。
    // ADR 0001: from_position / to_position が UI と一致するか踏む。
    await dragRowAboveRow(page, titles[2], titles[0]);

    // task_reordered ログが、つかんだ task の id + 該当 from/to で 1 件以上残る。
    // findDropTarget は「半分より上」で from を返す挙動なので to_position=0。
    // (task A の box top + 4 を狙うので、midpoint より上 → 0 が選ばれる)
    const movedC = await getTaskByTitle(admin, userId, titles[2]);
    const reorderLog = await waitForActionLog(
      admin,
      userId,
      (l) =>
        l.action_type === "task_reordered" &&
        (l.metadata as { task_id?: string }).task_id === movedC.id &&
        (l.metadata as { from_position?: number }).from_position === 2 &&
        (l.metadata as { to_position?: number }).to_position === 0,
      { description: "task_reordered log: 末尾→先頭" },
    );
    expect((reorderLog.metadata as { from_position?: number }).from_position).toBe(2);
    expect((reorderLog.metadata as { to_position?: number }).to_position).toBe(0);

    // tasks.stack_order: C(0) / A(1) / B(2) の順に再採番されている。
    // 楽観的更新と Promise.all 個別 update の間に DB 反映ラグがあるので poll。
    await expect
      .poll(async () => await readStackOrderByTitle(admin, userId), {
        message: "stack_order が C(0) / A(1) / B(2) になる",
        timeout: 5_000,
      })
      .toEqual([
        { title: titles[2], stack_order: 0 },
        { title: titles[0], stack_order: 1 },
        { title: titles[1], stack_order: 2 },
      ]);
  });

  test("先頭を末尾に下ろすと stack_order が更新される", async ({
    signedInPageWithProject: page,
    projectName,
    testUserId: userId,
  }) => {
    const titles = ["逆方向 X", "逆方向 Y", "逆方向 Z"] as const;
    const admin = createAdminClient();

    for (const t of titles) {
      await createTask(page, t, projectName);
    }

    const stack = page.getByRole("list", { name: "タスクスタック" });
    for (const t of titles) {
      await expect(stack.getByRole("listitem").filter({ hasText: t })).toBeVisible();
    }

    // 先頭 X を末尾 Z の下にドロップ。
    // findDropTarget は「どの行 midpoint 上にも当たらない」ケースで rects.length-1
    // (= 末尾 idx) を返す挙動なので、Z の bottom より下に落とす。
    await dragRowBelowRow(page, titles[0], titles[2]);

    const movedX = await getTaskByTitle(admin, userId, titles[0]);
    await waitForActionLog(
      admin,
      userId,
      (l) =>
        l.action_type === "task_reordered" &&
        (l.metadata as { task_id?: string }).task_id === movedX.id &&
        (l.metadata as { from_position?: number }).from_position === 0 &&
        (l.metadata as { to_position?: number }).to_position === 2,
      { description: "task_reordered log: 先頭→末尾" },
    );

    await expect
      .poll(async () => await readStackOrderByTitle(admin, userId), {
        message: "stack_order が Y(0) / Z(1) / X(2) になる",
        timeout: 5_000,
      })
      .toEqual([
        { title: titles[1], stack_order: 0 },
        { title: titles[2], stack_order: 1 },
        { title: titles[0], stack_order: 2 },
      ]);
  });
});

async function createTask(page: Page, title: string, projectName: string): Promise<void> {
  await page.getByRole("button", { name: "新規追加" }).click();
  const addDialog = page.getByRole("dialog", { name: "追加メニュー" });
  await addDialog.getByRole("tab", { name: "タスク" }).click();
  await addDialog.getByLabel("タイトル").fill(title);
  await addDialog.getByLabel("プロジェクト").selectOption({ label: projectName });
  await addDialog.getByRole("button", { name: "追加" }).click();
  await expect(addDialog).toHaveCount(0);
}

/**
 * `sourceTitle` の grip を掴んで `targetTitle` の上端より少し下にドロップする。
 * useStackDnD は HTML5 DnD ではなく custom pointer events なので mouse API で
 * pointermove を複数回 emit する必要がある (5px 以上動かさないと drag 判定が立たない)。
 */
async function dragRowAboveRow(
  page: Page,
  sourceTitle: string,
  targetTitle: string,
): Promise<void> {
  const stack = page.getByRole("list", { name: "タスクスタック" });
  const sourceRow = stack.getByRole("listitem").filter({ hasText: sourceTitle });
  const targetRow = stack.getByRole("listitem").filter({ hasText: targetTitle });

  const grip = sourceRow.locator(".cursor-grab").first();
  const gripBox = await grip.boundingBox();
  const targetBox = await targetRow.boundingBox();
  if (!gripBox || !targetBox) throw new Error("row/grip not measurable");

  const startX = gripBox.x + gripBox.width / 2;
  const startY = gripBox.y + gripBox.height / 2;
  // target の midline より上に落とす → findDropTarget が target idx を返す。
  const endX = startX;
  const endY = targetBox.y + 4;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY - 20, { steps: 5 });
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();
}

/**
 * `sourceTitle` を `targetTitle` の bottom より下にドロップする (= 末尾扱い)。
 */
async function dragRowBelowRow(
  page: Page,
  sourceTitle: string,
  targetTitle: string,
): Promise<void> {
  const stack = page.getByRole("list", { name: "タスクスタック" });
  const sourceRow = stack.getByRole("listitem").filter({ hasText: sourceTitle });
  const targetRow = stack.getByRole("listitem").filter({ hasText: targetTitle });

  const grip = sourceRow.locator(".cursor-grab").first();
  const gripBox = await grip.boundingBox();
  const targetBox = await targetRow.boundingBox();
  if (!gripBox || !targetBox) throw new Error("row/grip not measurable");

  const startX = gripBox.x + gripBox.width / 2;
  const startY = gripBox.y + gripBox.height / 2;
  const endX = startX;
  // 全行 midline より下 → findDropTarget が末尾 idx を返す。
  const endY = targetBox.y + targetBox.height + 20;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 20, { steps: 5 });
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();
}

async function readStackOrderByTitle(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
): Promise<{ title: string; stack_order: number | null }[]> {
  const { data, error } = await admin
    .from("tasks")
    .select("title, stack_order")
    .eq("user_id", userId)
    .order("stack_order", { ascending: true, nullsFirst: false });
  if (error) throw new Error(`[e2e] readStackOrder failed: ${error.message}`);
  return (data ?? []) as { title: string; stack_order: number | null }[];
}
