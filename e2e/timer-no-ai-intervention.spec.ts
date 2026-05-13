import { createAdminClient, seedProject, seedTask } from "./db";
import { expect, test } from "./fixtures";

/**
 * ADR-0058 (timer 3 動詞 + active 中の AI 能動介入禁止) /
 * ADR-0017 (AI 分解非同期 + status pill の静的表示は許容) の **回帰防止 guard rail**
 * (Issue #241)。
 *
 * #237 audit で「現実装は ADR-0058 / ADR-0017 に完全準拠 (削除/移動候補ゼロ)」
 * と確認済み。本 spec はその不変条件を CI で踏み続けることで、将来 #243 / #245 /
 * #251 等で AI 介入経路を増やす際に **timer 文脈に AI が漏れた瞬間に CI を落とす**。
 *
 * AI 経路の中身 (Gemini 呼び出し / parser) のカバーは src/shared/ai/route.test.ts /
 * src/entities/task/decompose-server.test.ts のユニットに任せる (ADR-0014: e2e は
 * AI モックを抱えない)。本 spec は `AI_ENABLED=false` の default 環境で動かす。
 */
test.describe("ADR-0058: timer active 中の AI 能動介入は禁止", () => {
  test("Network: start 〜 complete の間に /api/ai/** が 1 件も叩かれない", async ({
    signedInPage: page,
    testUserId: userId,
  }) => {
    // AddPanel 経由でタスクを作ると `triggerCategorize` / `triggerDecompose` が
    // 走り、active 区間の前段で AI fetch が記録されてしまう。これは ADR-0017 で
    // 許容された "作成直後の非同期 AI" であって本 spec の対象外なので、DB 直 seed
    // で AppShell 起動時に AI が呼ばれない出発点を作る。
    const admin = createAdminClient();
    const project = await seedProject(admin, {
      userId,
      name: "timer guard rail",
      color: "#5B8DEF",
    });
    await seedTask(admin, {
      userId,
      projectId: project.id,
      title: "timer 中 AI 不介入 (network)",
      stackOrder: 0,
      decomposeStatus: "none",
      estimatedMinutes: 25,
    });

    // /api/ai/** への request を全てカウントする。`AI_ENABLED=false` でも server route は
    // 200 skipped を返すが、本 ADR で問題なのは「client が叩いたかどうか」なので
    // route handler ではなく `page.route` で client 側の発火を観測する。
    let aiCallCount = 0;
    const aiCallUrls: string[] = [];
    await page.route("**/api/ai/**", async (route) => {
      aiCallCount += 1;
      aiCallUrls.push(route.request().url());
      await route.continue();
    });

    await page.reload();

    const stack = page.getByRole("list", { name: "タスクスタック" });
    const top = stack.getByRole("listitem").first();
    await expect(top).toBeVisible();

    // baseline: reload 後に既存タスクの categorize / decompose が走っていない
    // (DB 直 seed なので)。ここで非ゼロなら以降の active 区間 assert の前提が崩れる。
    expect(aiCallCount, `pre-start AI calls: ${aiCallUrls.join(", ")}`).toBe(0);

    // --- start ----
    await top.getByRole("button", { name: "開始" }).click();
    await expect(top.getByRole("button", { name: "中断" })).toBeVisible();

    // ADR-0058 Alternatives で却下した post-start warmup / dwell シグナルが万一
    // 仕込まれていれば踏める下限の長さ。Pomodoro 系 setTimeout も同程度の遅延を
    // 持つので 1.5s で十分。
    await page.waitForTimeout(1_500);
    expect(aiCallCount, `post-start AI calls: ${aiCallUrls.join(", ")}`).toBe(0);

    // --- pause (user-driven, allowed) ----
    await top.getByRole("button", { name: "中断" }).click();
    const pauseDialog = page.getByRole("dialog", { name: "中断の理由" });
    await pauseDialog.getByRole("button", { name: /自発的に中断/ }).click();
    await expect(top.getByRole("button", { name: "再開" })).toBeVisible();

    // paused 中も AI を起こさない。
    await page.waitForTimeout(500);
    expect(aiCallCount, `paused AI calls: ${aiCallUrls.join(", ")}`).toBe(0);

    // --- resume ----
    await top.getByRole("button", { name: "再開" }).click();
    await expect(top.getByRole("button", { name: "中断" })).toBeVisible();
    await page.waitForTimeout(500);
    expect(aiCallCount, `post-resume AI calls: ${aiCallUrls.join(", ")}`).toBe(0);

    // --- complete ----
    await top.getByRole("button", { name: "完了" }).click();
    await page.waitForTimeout(500);

    // 全期間 (start 〜 complete) を通して AI への能動 call が一度も発生しなかった。
    expect(aiCallCount, `total AI calls during active span: ${aiCallUrls.join(", ")}`).toBe(0);
  });

  test("UI: active 中に warmup / 提案 modal / 能動介入ボタンが現れない", async ({
    signedInPage: page,
    testUserId: userId,
  }) => {
    const admin = createAdminClient();
    const project = await seedProject(admin, {
      userId,
      name: "timer ui guard",
      color: "#E85D04",
    });
    await seedTask(admin, {
      userId,
      projectId: project.id,
      title: "timer 中 AI UI 不介入",
      stackOrder: 0,
      decomposeStatus: "none",
    });
    await page.reload();

    const stack = page.getByRole("list", { name: "タスクスタック" });
    const top = stack.getByRole("listitem").first();
    await expect(top).toBeVisible();

    // start 前: AddPanel を開いていなければ dialog は 0。
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await top.getByRole("button", { name: "開始" }).click();
    await expect(top.getByRole("button", { name: "中断" })).toBeVisible();

    // ADR-0058 Alternatives で却下した能動介入 (post-start warmup / 「続ける /
    // 分解 / push back」3 択ダイアログ / dwell シグナル) が万一仕込まれていれば
    // 踏める下限の長さ。
    await page.waitForTimeout(1_500);

    // 1) active 中に新規 dialog が open しない。
    //    PauseReasonModal は 中断 押下時のユーザー駆動なのでこの時点では 0 のはず。
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // 2) Top カード内に能動 AI 介入 affordance が無い。
    //    `getByRole("button", { name })` は substring match なので "分解" は
    //    "再分解" 等も拾う。TaskDetailPanel の「再分解」ボタンは詳細画面 = timer
    //    文脈外で、スタック内には現れない。
    const forbiddenButtonNames = ["分解", "後でやる", "push back", "やめる", "AI に相談", "提案"];
    for (const name of forbiddenButtonNames) {
      await expect(
        top.getByRole("button", { name }),
        `forbidden active-context AI button: "${name}"`,
      ).toHaveCount(0);
    }

    // 3) ADR-0058 Decision 1: 触れる動詞は start / stop / complete のみ。
    //    active 状態では 開始 / 再開 は描画されず、中断 / 完了 のみが見える。
    await expect(top.getByRole("button", { name: "開始" })).toHaveCount(0);
    await expect(top.getByRole("button", { name: "再開" })).toHaveCount(0);
    await expect(top.getByRole("button", { name: "中断" })).toBeVisible();
    await expect(top.getByRole("button", { name: "完了" })).toBeVisible();

    // 後始末: complete して clean に終わる (テスト間で active task が残らないように)。
    await top.getByRole("button", { name: "完了" }).click();
  });

  test("ADR-0017 carve-out: 'AI 分解中' status pill は active 中も表示され続ける", async ({
    signedInPage: page,
    testUserId: userId,
  }) => {
    // ADR-0058 で禁じたのは "能動介入" のみ。ADR-0017 で許容された静的 status pill
    // (`role=status` + `aria-live=polite`) は active 中も表示され続ける必要がある。
    // ここを止めると "guard rail を厳しくし過ぎて ADR-0017 を踏み抜く" 過剰防衛に
    // なるので、carve-out を別 test で明示的に踏む。
    const admin = createAdminClient();
    const project = await seedProject(admin, {
      userId,
      name: "ADR-0017 carve-out",
      color: "#5B8DEF",
    });
    await seedTask(admin, {
      userId,
      projectId: project.id,
      title: "decomposing 中の active",
      stackOrder: 0,
      decomposeStatus: "decomposing",
    });
    await page.reload();

    const stack = page.getByRole("list", { name: "タスクスタック" });
    const top = stack.getByRole("listitem").first();
    await expect(top).toBeVisible();

    // start 前: pill は表示されている。
    await expect(top.getByRole("status").filter({ hasText: "AI 分解中" })).toBeVisible();

    await top.getByRole("button", { name: "開始" }).click();
    await expect(top.getByRole("button", { name: "中断" })).toBeVisible();

    // active 中も pill は維持される (ADR-0017 / ADR-0058 Notes)。
    await expect(top.getByRole("status").filter({ hasText: "AI 分解中" })).toBeVisible();

    // 後始末。
    await top.getByRole("button", { name: "完了" }).click();
  });
});
