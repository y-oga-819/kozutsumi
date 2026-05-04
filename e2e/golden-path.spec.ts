import { expect, test } from "./fixtures";

/**
 * Phase 1 の golden path (ADR 0011 / Issue #46):
 *   プロジェクト作成 → タスク 2 件追加 → 並び替え
 *     → 開始 → 中断 (reason 選択) → 再開 → 完了
 *     → Tree View 遷移
 *
 * ここが壊れていると「毎日使う」体験が成立しない。最小カバーに絞る。
 */
test("Phase 1 golden path", async ({ signedInPage: page }) => {
  const projectName = "E2E テストプロジェクト";
  const taskA = "E2E タスク A";
  const taskB = "E2E タスク B";

  // 初期状態: データなし (global-setup で purge + localStorage cleared フラグ)
  await expect(page.getByText("task stack")).toBeVisible();

  // --- プロジェクトを作る ---------------------------------------------------
  // AddPanel は role=dialog、タブ群は role=tab、submit は dialog scope 内の
  // role=button { name: "追加" } で取れる (AddButton "新規追加" は dialog 外なので衝突しない)。
  await page.getByRole("button", { name: "新規追加" }).click();
  const addDialog = page.getByRole("dialog", { name: "追加メニュー" });
  await addDialog.getByRole("tab", { name: "プロジェクト" }).click();
  await addDialog.getByLabel("名前").fill(projectName);
  await addDialog.getByRole("button", { name: "追加" }).click();
  // 追加後は AddPanel が閉じる
  await expect(addDialog).toHaveCount(0);

  // タスクスタックは role=list / listitem なので semantic に取れる。
  const stack = page.getByRole("list", { name: "タスクスタック" });

  // --- タスク A を作る ------------------------------------------------------
  await createTask(page, taskA, projectName);
  await expect(stack.getByRole("listitem").filter({ hasText: taskA })).toBeVisible();

  // --- タスク B を作る ------------------------------------------------------
  await createTask(page, taskB, projectName);
  await expect(stack.getByRole("listitem").filter({ hasText: taskB })).toBeVisible();

  // --- 並び替え (A が top / B が 2 番目 → B を top に) ---------------------
  // DnD は custom pointer events ハンドラ (useStackDnD) なので Playwright の
  // dragAndDrop (HTML5 DnD) ではなく mouse API で手動 emit する。
  const rowA = stack.getByRole("listitem").filter({ hasText: taskA });
  const rowB = stack.getByRole("listitem").filter({ hasText: taskB });

  // grip (cursor-grab クラスを持つ wrapper) を掴む必要がある。
  // 行外をクリックすると onClick (詳細を開く) が走ってしまうため。
  const gripB = rowB.locator(".cursor-grab").first();
  const gripBBox = await gripB.boundingBox();
  const rowABox = await rowA.boundingBox();
  if (!gripBBox || !rowABox) throw new Error("row/grip not measurable");

  const startX = gripBBox.x + gripBBox.width / 2;
  const startY = gripBBox.y + gripBBox.height / 2;
  // rowA の upper-quarter にドロップ → findDropTarget が i=0 を返し B が top に挿入される。
  // 上端固定 offset (+4 等) は row 高さの微変動で upper half を踏み外す flake の元
  // (#191 を参照)。height に比例した余裕を取る。
  const endX = startX;
  const endY = rowABox.y + Math.floor(rowABox.height / 4);

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // 5px 以上動かさないと drag と判定されない。段階的に動かして pointermove を複数回 emit。
  await page.mouse.move(startX, startY - 20, { steps: 5 });
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();

  // 並び替え後、taskB が残っていることを確認 (top 判定は UI 変化が多く brittle なので最小限)。
  await expect(stack.getByRole("listitem").filter({ hasText: taskB })).toBeVisible();

  // --- 開始 / 中断 / 再開 / 完了 -------------------------------------------
  await page.getByRole("button", { name: "開始" }).click();
  await expect(page.getByRole("button", { name: "中断" })).toBeVisible();

  await page.getByRole("button", { name: "中断" }).click();
  // PauseReasonModal も role=dialog / aria-labelledby="中断の理由"
  const pauseDialog = page.getByRole("dialog", { name: "中断の理由" });
  await pauseDialog.getByRole("button", { name: /自発的に中断/ }).click();

  await expect(page.getByRole("button", { name: "再開" })).toBeVisible();
  await page.getByRole("button", { name: "再開" }).click();

  await expect(page.getByRole("button", { name: "完了" })).toBeVisible();
  await page.getByRole("button", { name: "完了" }).click();

  // 完了したタスクは done リストへ移動する。pending stack に taskA だけ残っているはず。
  await expect(stack.getByRole("listitem").filter({ hasText: taskA })).toBeVisible();
  await expect(stack.getByRole("listitem").filter({ hasText: taskB })).toHaveCount(0);

  // --- 予定管理ページに遷移 (Issue #145: tree 動線 → events 動線) -----------
  await page.getByRole("link", { name: "予定" }).click();
  await page.waitForURL((url) => url.pathname === "/events");
  // 予定管理ページでも header の kozu/tsumi ロゴは同じ位置に残る。
  await expect(page.getByText("kozu").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "予定管理" })).toBeVisible();
});

/**
 * AddPanel 経由でタスクを作るヘルパー。
 * #170 / ADR 0038: task_size 必須。テスト範囲外なので 30分 を選ぶ。
 */
async function createTask(
  page: import("@playwright/test").Page,
  title: string,
  projectName: string,
): Promise<void> {
  await page.getByRole("button", { name: "新規追加" }).click();
  const addDialog = page.getByRole("dialog", { name: "追加メニュー" });
  await addDialog.getByRole("tab", { name: "タスク" }).click();
  await addDialog.getByLabel("タイトル").fill(title);
  await addDialog.getByRole("radio", { name: "30分" }).click();
  await addDialog.getByLabel("プロジェクト (任意)").selectOption({ label: projectName });
  await addDialog.getByRole("button", { name: "追加" }).click();
  await expect(addDialog).toHaveCount(0);
}
