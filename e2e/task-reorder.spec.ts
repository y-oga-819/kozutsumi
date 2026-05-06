import type { Locator, Page } from "@playwright/test";

import { createAdminClient, getTaskByTitle, seedTask, waitForActionLog } from "./db";
import { expect, test } from "./fixtures";

/**
 * Issue #67 🟥 / 🟧 / ADR 0001:
 *   DnD 並び替えの DB 整合 (task_reordered + tasks.stack_order)。
 *
 * Phase 4 でユーザーがどのタスクを上に持ち上げて着手したか を学ぶには、
 * 並び替えの from/to_position と stack_order の両方が必要。UI 操作
 * (custom pointer events) と DB の最終状態を 1 セットで踏む。
 *
 * 起点データは `seedTask` で線形 (stack_order=0,1,2) に置く。UI 経由の
 * createTaskWithAi は ADR-0040 で「Top 直下挿入」に変わっており、連続
 * 登録すると visible 順がアルファベット順にならないため、並び替え検証と
 * 切り離す目的で seed 経路を選ぶ。
 */
test.describe("DnD 並び替え (task_reordered + tasks.stack_order)", () => {
  test("末尾を先頭に持ち上げると stack_order が 0,1,2 で再採番され、from/to ログが残る", async ({
    signedInPageWithProject: page,
    projectName,
    testUserId: userId,
  }) => {
    const titles = ["並べ替え A", "並べ替え B", "並べ替え C"] as const;
    const admin = createAdminClient();
    const projectId = await getProjectId(admin, userId, projectName);

    for (let i = 0; i < titles.length; i++) {
      await seedTask(admin, { userId, projectId, title: titles[i], stackOrder: i });
    }
    await page.reload();

    const stack = page.getByRole("list", { name: "タスクスタック" });
    for (const t of titles) {
      await expect(stack.getByRole("listitem").filter({ hasText: t })).toBeVisible();
    }

    // 末尾 (idx=2 / C) を先頭 (idx=0 / A の上) にドロップ。
    // ADR 0001: from_position / to_position が UI と一致するか踏む。
    await dragRowAboveRow(page, titles[2], titles[0]);

    // task_reordered ログが、つかんだ task の id + 該当 from/to で 1 件以上残る。
    // findDropTarget は「半分より上」で idx を返す挙動なので to_position=0。
    // (dragRowAboveRow は target の top + 数 px 固定 offset を狙うので必ず upper half)
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
    const projectId = await getProjectId(admin, userId, projectName);

    for (let i = 0; i < titles.length; i++) {
      await seedTask(admin, { userId, projectId, title: titles[i], stackOrder: i });
    }
    await page.reload();

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

async function getProjectId(
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
  if (error || !data) throw new Error(`[e2e] project not found: ${projectName}`);
  return (data as { id: string }).id;
}

/**
 * `sourceTitle` の grip を掴んで `targetTitle` の上端より少し下にドロップする。
 * useStackDnD は HTML5 DnD ではなく custom pointer events なので mouse API で
 * pointermove を複数回 emit する必要がある (5px 以上動かさないと drag 判定が立たない)。
 *
 * #224: TopTaskCard の async load (projects / correction factors) や
 * DropIndicator (h-0.5) 挿入で計測 → mouse.down() の間に row が動くと、
 * (a) grip 要素を踏み外して onPointerDown が発火しない / (b) target の Y が
 * ずれて隣 idx に落ちる、の 2 通りの flake を生む。stableBoundingBox で
 * layout が止まってから計測し、drag 開始後 (DropIndicator 挿入後) に target を
 * 再計測することで両方を抑える。
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

  const gripBox = await stableBoundingBox(grip);
  const startX = gripBox.x + gripBox.width / 2;
  const startY = gripBox.y + gripBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // 1 move で >5px 移動して isDragging を確実に起動させる
  // (steps を細かく刻むと最初の数 step が threshold 未満になり、CI 負荷下で
  // pointermove が間引かれると drag が起動しないことがある)。
  await page.mouse.move(startX, startY - 10, { steps: 3 });

  // drag 開始後 (DropIndicator 挿入で target 行が 2px 下に押される) に再計測する。
  const targetBox = await stableBoundingBox(targetRow);
  // upper-quarter ではなく min(8, h/4) の固定 px を使う:
  // 行高が H 以下に縮んでも常に top+8px 以下に落ち、H が 16px 以上あれば
  // midline (H/2) を下回るので findDropTarget が target idx を返す。
  const offset = Math.max(4, Math.min(8, Math.floor(targetBox.height / 4)));
  const endY = targetBox.y + offset;

  await page.mouse.move(startX, endY, { steps: 10 });
  await page.mouse.up();
}

/**
 * `sourceTitle` を `targetTitle` の bottom より下にドロップする (= 末尾扱い)。
 * #224: 計測タイミング flake は dragRowAboveRow と同じ対応 (stableBoundingBox)。
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

  const gripBox = await stableBoundingBox(grip);
  const startX = gripBox.x + gripBox.width / 2;
  const startY = gripBox.y + gripBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // 1 move で >5px 移動して isDragging を確実に起動させる。
  await page.mouse.move(startX, startY + 10, { steps: 3 });

  const targetBox = await stableBoundingBox(targetRow);
  // 全行 midline より下 → findDropTarget が末尾 idx を返す。
  const endY = targetBox.y + targetBox.height + 20;

  await page.mouse.move(startX, endY, { steps: 10 });
  await page.mouse.up();
}

/**
 * #224: `Locator.boundingBox()` を連続 2 回読んで layout が止まるまで poll する。
 *
 * TopTaskCard が `useProjects` / `useCorrectionFactors` を読みに行くため、
 * `await page.reload()` 直後 + listitem visible 待ち合わせ後でも、行高さや
 * 相対位置が数 ms〜数百 ms の間に微変動する。`boundingBox()` の単発計測値は
 * その変動の任意の瞬間を切り取るので、計測 → mouse.down() の間に layout が
 * 動くと grip 要素が clientX/Y からずれ、pointerdown が空振りする (= test 2
 * 「action_log が出ない」flake) / 隣 row に落ちる (= test 1 「from/to が
 * 違う」flake) を生む。
 */
async function stableBoundingBox(
  locator: Locator,
  opts: { tolerancePx?: number; maxIterations?: number; intervalMs?: number } = {},
): Promise<{ x: number; y: number; width: number; height: number }> {
  const tolerance = opts.tolerancePx ?? 1;
  const maxIterations = opts.maxIterations ?? 30;
  const intervalMs = opts.intervalMs ?? 50;
  let prev = await locator.boundingBox();
  if (!prev) throw new Error("[e2e] stableBoundingBox: locator not measurable");
  for (let i = 0; i < maxIterations; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const next = await locator.boundingBox();
    if (!next) throw new Error("[e2e] stableBoundingBox: locator not measurable");
    if (
      Math.abs(prev.x - next.x) <= tolerance &&
      Math.abs(prev.y - next.y) <= tolerance &&
      Math.abs(prev.width - next.width) <= tolerance &&
      Math.abs(prev.height - next.height) <= tolerance
    ) {
      return next;
    }
    prev = next;
  }
  // best-effort で最後の計測値を返す。安定しなくても test を進めて、
  // 落ちたら別の根本原因として表面化させる方が flake を masking しない。
  return prev;
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
