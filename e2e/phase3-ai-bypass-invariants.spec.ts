import { createAdminClient, getTasksForUser, seedProject, seedTask } from "./db";
import { expect, test } from "./fixtures";

/**
 * Issue #96 (P3-11) / ADR 0013 / 0014 / 0016:
 *
 * `AI_ENABLED=false` (e2e のデフォルト、playwright.config.ts) で
 * Phase 3 の core path が AI 抜きで成立する不変条件を semantic locator で踏む。
 *
 * AI 失敗時の縮退コードパスは e2e と同じ (`/api/ai/*` が `withAiRoute` で
 * 200 skipped を返す) なので、ここでの不変条件が augmentation only
 * (ADR 0013) の自動安全網になる。
 *
 * AI 経路 (Route Handler 内ロジック) のカバレッジは src/shared/ai/route.test.ts /
 * src/app/api/ai/{ping,decompose,categorize}/route.test.ts のユニットに任せる
 * (ADR 0014: e2e でモックを抱えない)。
 */

test.describe("AI 経路バイパス (ADR 0014)", () => {
  test("/api/ai/ping は AI_ENABLED=false で 200 { skipped: true, reason: 'ai_disabled' } を返す", async ({
    signedInPage: page,
  }) => {
    // signedInPage 経由なら request は session cookie を引き継ぐ。
    const res = await page.request.post("/api/ai/ping");
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { skipped?: boolean; reason?: string };
    // この shape が壊れたら withAiRoute の kill-switch が外れている (ADR 0013/0014)。
    expect(body).toEqual({ skipped: true, reason: "ai_disabled" });
  });

  test("AddPanel からタスク追加 → 親 1 件だけ Stack に並び、DB に子レコードは作られない", async ({
    signedInPageWithProject: page,
    projectName,
    testUserId: userId,
  }) => {
    const taskTitle = "AI バイパス: 親のみ残置";

    await page.getByRole("button", { name: "新規追加" }).click();
    const addDialog = page.getByRole("dialog", { name: "追加メニュー" });
    await addDialog.getByRole("tab", { name: "タスク" }).click();
    await addDialog.getByLabel("タイトル").fill(taskTitle);
    await addDialog.getByLabel("プロジェクト").selectOption({ label: projectName });
    await addDialog.getByRole("button", { name: "追加" }).click();
    await expect(addDialog).toHaveCount(0);

    const stack = page.getByRole("list", { name: "タスクスタック" });
    await expect(stack.getByRole("listitem")).toHaveCount(1);
    await expect(stack.getByRole("listitem").filter({ hasText: taskTitle })).toBeVisible();

    // DB: 親 1 件だけ。AI が動いていれば triggerDecompose 経由で子が insert される
    // が、`AI_ENABLED=false` なら withAiRoute が 200 skipped で返し DB は変わらない
    // (decompose-server には到達しない)。
    const admin = createAdminClient();
    const tasks = await getTasksForUser(admin, userId);
    expect(tasks).toHaveLength(1);
    const parent = tasks[0];
    expect(parent.title).toBe(taskTitle);
    expect(parent.parent_task_id).toBeNull();
    // server は AI 経路を踏まないので decompose_status の DB 値は default 'none' のまま。
    // (client は optimistic に 'decomposing' をキャッシュに書くが永続化はされない)。
    expect(parent.decompose_status).toBe("none");
    // AI categorize も同様に走らないので task_category は null のまま (ADR 0013 augmentation only)。
    expect(parent.task_category).toBeNull();
  });
});

test.describe("Variant E core path 不変条件 (ADR 0016)", () => {
  test("decompose_status='none' の親は『未分解』pill を出し、補正なしの見積もりも raw 値で表示する", async ({
    signedInPage: page,
    testUserId: userId,
  }) => {
    const admin = createAdminClient();
    const project = await seedProject(admin, {
      userId,
      name: "未分解 pill 検証",
      color: "#5B8DEF",
    });
    const task = await seedTask(admin, {
      userId,
      projectId: project.id,
      title: "未分解の単独タスク",
      stackOrder: 0,
      decomposeStatus: "none",
      // task_category=null + correction factors 無し → CorrectedEstimate は raw のみ表示。
      estimatedMinutes: 25,
    });

    // 直接 seed したので reload して fetch を回す。
    await page.reload();

    const stack = page.getByRole("list", { name: "タスクスタック" });
    const top = stack.getByRole("listitem").filter({ hasText: task.title });
    await expect(top).toBeVisible();

    // 「未分解」pill (StatusPill, status='none')。Top カード下ゾーン Row 3 右詰スロット。
    await expect(top.getByText("未分解")).toBeVisible();

    // 補正後見積もり無しの fallback: aria-label="見積もり" の単独 span (CorrectedEstimate `correctedMinutes === null`)。
    // raw は fmtDuration(25) → "25分"。これが表示されればタイマー / 状態遷移以前に
    // 描画段階でも raw 値で fallback できている (ADR 0013 縮退の UI 確認)。
    await expect(top.getByLabel("見積もり")).toHaveText("25分");

    // 表示されているのは leaf-parent 1 件だけ (decomposed 親の子フラット化が起きない)。
    await expect(stack.getByRole("listitem")).toHaveCount(1);
  });

  test("decomposed 親 + 子 3 件: 親は Stack から消え、Top に role=progressbar が出る", async ({
    signedInPage: page,
    testUserId: userId,
  }) => {
    const admin = createAdminClient();
    const project = await seedProject(admin, {
      userId,
      name: "progressbar 検証",
      color: "#E85D04",
    });

    // 親: stack_order=null (Stack には出ない)。decomposed なので buildStackItems で除外される。
    const parent = await seedTask(admin, {
      userId,
      projectId: project.id,
      title: "面接対策をまとめる",
      stackOrder: 0,
      decomposeStatus: "decomposed",
    });
    const childTitles = ["志望動機を整理", "想定質問を 5 つ書く", "逆質問を準備"];
    for (let i = 0; i < childTitles.length; i++) {
      await seedTask(admin, {
        userId,
        projectId: project.id,
        title: childTitles[i],
        stackOrder: 1 + i,
        parentTaskId: parent.id,
        decomposeStatus: "none",
      });
    }

    await page.reload();

    const stack = page.getByRole("list", { name: "タスクスタック" });

    // 親 (decomposed) は Stack から消え、子 3 件だけがフラットに並ぶ (ADR 0016 §1)。
    await expect(stack.getByRole("listitem")).toHaveCount(3);
    for (const t of childTitles) {
      await expect(stack.getByRole("listitem").filter({ hasText: t })).toBeVisible();
    }
    await expect(stack.getByRole("listitem").filter({ hasText: parent.title })).toHaveCount(0);

    // Top カードの平行四辺形プログレス (ADR 0016 §5)。
    // doneCount=0、currentIndex = 0 + (1 番目) = 1、total = 3。
    const topItem = stack.getByRole("listitem").first();
    const progress = topItem.getByRole("progressbar");
    await expect(progress).toBeVisible();
    await expect(progress).toHaveAttribute("aria-valuenow", "0");
    await expect(progress).toHaveAttribute("aria-valuemin", "0");
    await expect(progress).toHaveAttribute("aria-valuemax", "3");
    await expect(progress).toHaveAttribute("aria-label", "進捗 0/3、現在 1/3");

    // ⤷ 親タスク名が下ゾーンに継承される (ADR 0016 §6 の親 dep 継承と並ぶ表示原則)。
    await expect(topItem.getByText(`⤷ ${parent.title}`)).toBeVisible();
  });

  test("Top-only complete: 行カードに『完了』ボタンが無い / Top で完了すると Done リストに移る", async ({
    signedInPage: page,
    testUserId: userId,
  }) => {
    const admin = createAdminClient();
    const project = await seedProject(admin, {
      userId,
      name: "Top-only complete 検証",
      color: "#5B8DEF",
    });
    const topTitle = "Top で完了するタスク";
    const rowTitle = "2 番目のタスク";
    await seedTask(admin, {
      userId,
      projectId: project.id,
      title: topTitle,
      stackOrder: 0,
      decomposeStatus: "none",
    });
    await seedTask(admin, {
      userId,
      projectId: project.id,
      title: rowTitle,
      stackOrder: 1,
      decomposeStatus: "none",
    });

    await page.reload();

    const stack = page.getByRole("list", { name: "タスクスタック" });
    await expect(stack.getByRole("listitem")).toHaveCount(2);

    const topItem = stack.getByRole("listitem").nth(0);
    const rowItem = stack.getByRole("listitem").nth(1);

    // Top カードには「完了」ボタンが常時 (idle/active/paused 全状態で) 出る (ADR 0016 §7)。
    await expect(topItem.getByRole("button", { name: "完了" })).toBeVisible();
    // 行カードには完了ボタンを置かない (ADR 0016 §7)。
    await expect(rowItem.getByRole("button", { name: "完了" })).toHaveCount(0);
    // 開始 / 中断 / 再開 等の Timer Controls も Top のみ。
    await expect(rowItem.getByRole("button", { name: "開始" })).toHaveCount(0);

    // Top で完了 → Stack から消えて Done リストに移る (ADR 0016 §8)。
    await topItem.getByRole("button", { name: "完了" }).click();

    await expect(stack.getByRole("listitem")).toHaveCount(1);
    await expect(stack.getByRole("listitem").filter({ hasText: topTitle })).toHaveCount(0);

    const doneList = page.getByRole("list", { name: "完了済みタスク" });
    await expect(doneList.getByRole("listitem").filter({ hasText: topTitle })).toBeVisible();
    // Done セクションには「戻す」ボタンが付く (aria-label にタイトル + 接尾辞)。
    await expect(
      doneList.getByRole("button", { name: `${topTitle} を未完了に戻す` }),
    ).toBeVisible();
  });
});
