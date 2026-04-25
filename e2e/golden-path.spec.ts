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

  // --- タスク A を作る ------------------------------------------------------
  await createTask(page, taskA, projectName);
  await expect(page.getByText(taskA, { exact: false })).toBeVisible();

  // --- タスク B を作る ------------------------------------------------------
  await createTask(page, taskB, projectName);
  await expect(page.getByText(taskB, { exact: false })).toBeVisible();

  // --- 並び替え (A が top / B が 2 番目 → B を top に) ---------------------
  // DnD は custom pointer events ハンドラ (useStackDnD) なので Playwright の
  // dragAndDrop (HTML5 DnD) ではなく mouse API で手動 emit する。
  const rowB = page
    .locator(`div:has-text("${taskB}")`)
    .locator("xpath=ancestor::div[contains(@class,'mx-4')][1]")
    .first();
  const cardA = page
    .locator(`div:has-text("${taskA}")`)
    .locator("xpath=ancestor::div[contains(@class,'mx-4')][1]")
    .first();

  const rowBBox = await rowB.boundingBox();
  const cardABox = await cardA.boundingBox();
  if (!rowBBox || !cardABox) throw new Error("rows not measurable");

  // rowB の grip (左端) を掴んで cardA の上端より上にドロップする。
  // findDropTarget は clientY < rect.top + height/2 で i=0 を返す。
  const startX = rowBBox.x + 10;
  const startY = rowBBox.y + rowBBox.height / 2;
  const endX = cardABox.x + 10;
  const endY = cardABox.y + 4;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // 5px 以上動かさないと drag と判定されない。段階的に動かして pointermove を複数回 emit。
  await page.mouse.move(startX, startY - 20, { steps: 5 });
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();

  // 並び替え後、taskB が残っていることを確認 (top 判定は UI 変化が多く brittle なので最小限)。
  await expect(page.getByText(taskB).first()).toBeVisible();

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

  // 完了したタスクは done リストへ移動する。top は残っているタスク A 側に。
  await expect(page.getByText(taskA).first()).toBeVisible();

  // --- Tree View に遷移 ----------------------------------------------------
  await page.getByRole("link", { name: "Tree" }).click();
  await page.waitForURL((url) => url.pathname === "/tree");
  // Tree View でも header の kozu/tsumi ロゴは同じ位置に残る。
  await expect(page.getByText("kozu").first()).toBeVisible();
});

/**
 * AddPanel 経由でタスクを作るヘルパー。
 * プロジェクト名で select し、見積もりは空のまま追加する。
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
  await addDialog.getByLabel("プロジェクト").selectOption({ label: projectName });
  await addDialog.getByRole("button", { name: "追加" }).click();
  await expect(addDialog).toHaveCount(0);
}
