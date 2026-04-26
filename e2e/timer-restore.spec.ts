import { createAdminClient, expectTaskStatus, getTaskByTitle, waitForTimeEntries } from "./db";
import { expect, test } from "./fixtures";

/**
 * Issue #67 🟨 8 (タイマー累積 + リロード復元) / ADR 0004:
 *   active 中のタイマーがブラウザリロード後も DB 由来 (tasks.status +
 *   task_time_entries.open) で復元されるかを踏む。
 *
 * useTaskTimer (`src/features/task-stack/useTaskTimer.ts`) は
 *   - localStorage に依存しない (entries / task は React Query から fetch)
 *   - tickMs を 1秒ごと進めて open entry の経過を再計算する
 * という構造なので、リロード後もタイマーが「DB の真実」から再生される。
 *
 * `signedInPage` fixture は localStorage を `kozutsumi.sample-data.v1=cleared`
 * に固定するので、復元の出所が DB であることはここで担保される。
 */
test.describe("タイマーのリロード復元 (DB 由来 / tick 継続)", () => {
  test("active 状態でリロードしても 中断 ボタン + 経過秒数が復元され、tick が増分する", async ({
    signedInPageWithProject: page,
    projectName,
    testUserId: userId,
  }) => {
    const taskTitle = "タイマー復元タスク";
    const admin = createAdminClient();

    // --- タスク作成 + 開始 ---------------------------------------------------
    await page.getByRole("button", { name: "新規追加" }).click();
    const addDialog = page.getByRole("dialog", { name: "追加メニュー" });
    await addDialog.getByRole("tab", { name: "タスク" }).click();
    await addDialog.getByLabel("タイトル").fill(taskTitle);
    await addDialog.getByLabel("プロジェクト").selectOption({ label: projectName });
    await addDialog.getByRole("button", { name: "追加" }).click();
    await expect(addDialog).toHaveCount(0);

    const stack = page.getByRole("list", { name: "タスクスタック" });
    await expect(stack.getByRole("listitem").filter({ hasText: taskTitle })).toBeVisible();

    await page.getByRole("button", { name: "開始" }).click();
    await expect(page.getByRole("button", { name: "中断" })).toBeVisible();

    const task = await getTaskByTitle(admin, userId, taskTitle);
    await expectTaskStatus(admin, task.id, "active");
    // open entry が DB に書かれてからリロードしないと、リロード後に entry が無くて
    // useTaskTimer が isRunning=false に倒れてしまう。
    await waitForTimeEntries(admin, task.id, (es) => es.length === 1 && es[0].paused_at === null, {
      description: "1 open entry before reload",
    });

    // --- 経過秒数が表示されていることを確認 ------------------------------------
    // TopTaskCard.tsx L97-104: <span aria-label="経過時間">● MM:SS</span>
    const elapsed = page.getByLabel("経過時間");
    await expect(elapsed).toBeVisible();

    // 表示が tick で進む (= setInterval が動いている) ことを最低 1 秒待って確認。
    // 直後だと 00:00 → 00:01 になる手前で取りこぼすことがあるので 1.5 秒待つ。
    await page.waitForTimeout(1500);
    const beforeReloadText = (await elapsed.textContent())?.trim() ?? "";
    const beforeReloadSeconds = parseElapsed(beforeReloadText);
    expect(beforeReloadSeconds).toBeGreaterThanOrEqual(1);

    // --- リロード ------------------------------------------------------------
    await page.reload();

    // 復元の証跡: 「中断」ボタン (= active 状態) と aria-label="経過時間" が再描画される。
    // signedInPage は localStorage に `cleared` を入れるので、DB が唯一の真実。
    await expect(page.getByRole("button", { name: "中断" })).toBeVisible({ timeout: 15_000 });
    await expect(elapsed).toBeVisible();

    // --- リロード後に tick が継続して増分する -------------------------------
    // open entry の started_at は変わらないので、経過秒数 ≧ before の秒数 になる。
    const afterReloadInitialText = (await elapsed.textContent())?.trim() ?? "";
    const afterReloadInitialSeconds = parseElapsed(afterReloadInitialText);
    expect(afterReloadInitialSeconds).toBeGreaterThanOrEqual(beforeReloadSeconds);

    // 数秒待って増分を確認。setInterval(1000) なので 3 秒で +2〜+3 入るはず。
    await page.waitForTimeout(3000);
    const afterReloadLaterText = (await elapsed.textContent())?.trim() ?? "";
    const afterReloadLaterSeconds = parseElapsed(afterReloadLaterText);
    expect(afterReloadLaterSeconds).toBeGreaterThanOrEqual(afterReloadInitialSeconds + 2);
  });
});

/**
 * `aria-label="経過時間"` の textContent をパースして総秒数を返す。
 * formatElapsed (useTaskTimer.ts L162-172) の format は:
 *   - h > 0 → "H:MM:SS"
 *   - else  → "MM:SS"
 * 表示の prefix "● " が付くのでそれも剥がす。
 */
function parseElapsed(text: string): number {
  const stripped = text.replace(/^●\s*/, "").trim();
  const parts = stripped.split(":").map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n))) {
    throw new Error(`[e2e] cannot parse elapsed: ${text}`);
  }
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    return m * 60 + s;
  }
  throw new Error(`[e2e] unexpected elapsed format: ${text}`);
}
