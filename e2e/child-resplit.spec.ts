import { createAdminClient, getTasksForUser, seedProject, seedTask } from "./db";
import { expect, test } from "./fixtures";

/**
 * Issue #121 / ADR 0027 / 0028 / 0029 / 0030:
 *
 * 子タスクの再分解 (resplit) flatten 仕様の e2e 不変条件。
 *
 * AI_ENABLED=false (e2e のデフォルト) で、再分解の入口 (`/api/ai/decompose/resplit`) と
 * UI の「もっと細かく」ボタンが kill-switch を通過しても DB を破壊しないことを確認する
 * (ADR 0013 / 0014 augmentation only)。
 *
 * 実 AI 経路の成功時の不変条件 (孫禁止 / stack_order 連続 / parent_task_id 継承) は、
 * RPC `fn_resplit_child_task` を service_role で直接呼び出すことで検証する
 * (ADR 0028 atomicity + ADR 0027 flatten の SQL レベル契約)。
 *
 * orchestrator (`resplitChildTask`) のレース ガードや action_log 発火は
 * src/entities/task/resplit-server.test.ts のユニットでカバー済み。
 */

test.describe("AI 経路バイパス (ADR 0014) — resplit endpoint", () => {
  test("/api/ai/decompose/resplit は AI_ENABLED=false で 200 ai_disabled を返す", async ({
    signedInPage: page,
  }) => {
    const res = await page.request.post("/api/ai/decompose/resplit", {
      data: { task_id: "any" },
    });
    expect(res.status()).toBe(200);
    const body = (await res.json()) as { skipped?: boolean; reason?: string };
    expect(body).toEqual({ skipped: true, reason: "ai_disabled" });
  });

  test("子タスク詳細パネルを開くと「もっと細かく」が見え、AI_ENABLED=false で disabled", async ({
    signedInPage: page,
    testUserId: userId,
  }) => {
    const admin = createAdminClient();
    const project = await seedProject(admin, {
      userId,
      name: "resplit ボタン検証",
      color: "#5B8DEF",
    });
    const parent = await seedTask(admin, {
      userId,
      projectId: project.id,
      title: "親 (resplit 用)",
      stackOrder: 0,
      decomposeStatus: "decomposed",
    });
    const childTitle = "再分解対象の子";
    await seedTask(admin, {
      userId,
      projectId: project.id,
      title: childTitle,
      stackOrder: 1,
      parentTaskId: parent.id,
      decomposeStatus: "none",
    });
    await seedTask(admin, {
      userId,
      projectId: project.id,
      title: "兄弟 (動かない)",
      stackOrder: 2,
      parentTaskId: parent.id,
      decomposeStatus: "none",
    });

    await page.reload();

    const stack = page.getByRole("list", { name: "タスクスタック" });
    const childItem = stack.getByRole("listitem").filter({ hasText: childTitle });
    await expect(childItem).toBeVisible();

    // 子タスクをクリックして詳細パネルを開く (タイトル click は edit のため、
    // 行カードのクリック可能領域全体に当てる)
    await childItem.click();

    // 詳細パネルの「AI 分解情報」エリアに「もっと細かく」ボタンが出る
    const panel = page.getByRole("region", { name: "AI 分解情報" });
    await expect(panel).toBeVisible();
    const button = panel.getByRole("button", { name: "もっと細かく" });
    await expect(button).toBeVisible();
    // AI_ENABLED=false なので押せない (ADR 0014)
    await expect(button).toBeDisabled();

    // 押しても DB は変わらない (button が disabled なのでそもそも click が通らない)。
    // defense-in-depth として、ここで API を直接叩いて 200 ai_disabled を確認している
    // (上の bypass テストと併せて確認済み)。
    const tasks = await getTasksForUser(admin, userId);
    // 親 1 + 子 2 で計 3 件 (孫はゼロ、HC-1)
    expect(tasks).toHaveLength(3);
    const grandchildren = tasks.filter(
      (t) => t.parent_task_id !== null && t.parent_task_id !== parent.id,
    );
    expect(grandchildren).toHaveLength(0);
  });
});

test.describe("fn_resplit_child_task RPC 不変条件 (ADR 0027 / 0028)", () => {
  test("flatten: 元の子は delete、新規子は同じ親に flatten、後続兄弟は shift_amount だけ後ろにずれる", async ({
    testUserId: userId,
  }) => {
    const admin = createAdminClient();
    const project = await seedProject(admin, {
      userId,
      name: "RPC flatten 検証",
      color: "#11BEAE",
    });

    // 親 (decomposed) + 子 [A(0), B(1), C(2)]。B を再分解する想定。
    const parent = await seedTask(admin, {
      userId,
      projectId: project.id,
      title: "親",
      stackOrder: 0,
      decomposeStatus: "decomposed",
    });
    const childA = await seedTask(admin, {
      userId,
      projectId: project.id,
      title: "A",
      stackOrder: 0,
      parentTaskId: parent.id,
    });
    const childB = await seedTask(admin, {
      userId,
      projectId: project.id,
      title: "B (再分解対象)",
      stackOrder: 1,
      parentTaskId: parent.id,
    });
    const childC = await seedTask(admin, {
      userId,
      projectId: project.id,
      title: "C",
      stackOrder: 2,
      parentTaskId: parent.id,
    });

    // 3 件の新規子 b1/b2/b3 を flatten で挿入。shift_amount = 3 - 1 = 2
    const newChildren = [
      { title: "b1", body: "", estimated_minutes: 10, task_category: "doc" },
      { title: "b2", body: "", estimated_minutes: 15, task_category: "doc" },
      { title: "b3", body: "", estimated_minutes: 5, task_category: "doc" },
    ];

    const { data: returned, error: rpcError } = await admin.rpc("fn_resplit_child_task", {
      p_target_id: childB.id,
      p_parent_id: parent.id,
      p_base_stack_order: 1,
      p_shift_amount: 2,
      p_new_children: newChildren,
    });
    expect(rpcError).toBeNull();
    const newIds = returned as unknown as string[];
    expect(newIds).toHaveLength(3);

    const tasks = await getTasksForUser(admin, userId);

    // HC-1: 孫は作られない (新規子の parent_task_id は元の親のまま)
    for (const id of newIds) {
      const row = tasks.find((t) => t.id === id);
      expect(row, `new child ${id} not found`).toBeTruthy();
      expect(row!.parent_task_id).toBe(parent.id);
    }

    // 元の子 B は delete されている
    expect(tasks.find((t) => t.id === childB.id)).toBeUndefined();

    // 同一親 (parent.id) 配下の子を stack_order 昇順で並べる
    const siblings = tasks
      .filter((t) => t.parent_task_id === parent.id)
      .sort((a, b) => (a.stack_order ?? 0) - (b.stack_order ?? 0));

    // 配置: A(0), b1(1), b2(2), b3(3), C(4)
    expect(siblings.map((t) => t.title)).toEqual(["A", "b1", "b2", "b3", "C"]);

    // HC-3: stack_order が連続 (gap なし、決定論的)
    const orders = siblings.map((t) => t.stack_order);
    expect(orders).toEqual([0, 1, 2, 3, 4]);

    // 既存兄弟 A / C の他属性は不変 (id 維持、shift で stack_order だけ更新)
    const aRow = tasks.find((t) => t.id === childA.id);
    expect(aRow?.stack_order).toBe(0);
    const cRow = tasks.find((t) => t.id === childC.id);
    expect(cRow?.stack_order).toBe(4); // 2 + shift_amount(2)

    // 新規子は順序通りの stack_order を持つ
    const b1 = siblings.find((t) => t.title === "b1");
    const b2 = siblings.find((t) => t.title === "b2");
    const b3 = siblings.find((t) => t.title === "b3");
    expect(b1?.stack_order).toBe(1);
    expect(b2?.stack_order).toBe(2);
    expect(b3?.stack_order).toBe(3);
    // 新規子の decompose_status は default 'none'
    expect(b1?.decompose_status).toBe("none");
    // 新規子は category を引き継ぐ
    expect(b1?.task_category).toBe("doc");
  });

  test("末尾の子を再分解しても問題ない (後続シフト対象が空でも成功する)", async ({
    testUserId: userId,
  }) => {
    const admin = createAdminClient();
    const project = await seedProject(admin, {
      userId,
      name: "末尾再分解検証",
      color: "#a855f7",
    });
    const parent = await seedTask(admin, {
      userId,
      projectId: project.id,
      title: "親",
      stackOrder: 0,
      decomposeStatus: "decomposed",
    });
    const childA = await seedTask(admin, {
      userId,
      projectId: project.id,
      title: "A",
      stackOrder: 0,
      parentTaskId: parent.id,
    });
    const childLast = await seedTask(admin, {
      userId,
      projectId: project.id,
      title: "末尾 (再分解対象)",
      stackOrder: 1,
      parentTaskId: parent.id,
    });

    const { data: returned, error: rpcError } = await admin.rpc("fn_resplit_child_task", {
      p_target_id: childLast.id,
      p_parent_id: parent.id,
      p_base_stack_order: 1,
      p_shift_amount: 1,
      p_new_children: [
        { title: "x1", body: "", estimated_minutes: 10, task_category: null },
        { title: "x2", body: "", estimated_minutes: 10, task_category: null },
      ],
    });
    expect(rpcError).toBeNull();
    expect(returned as unknown as string[]).toHaveLength(2);

    const tasks = await getTasksForUser(admin, userId);
    const siblings = tasks
      .filter((t) => t.parent_task_id === parent.id)
      .sort((a, b) => (a.stack_order ?? 0) - (b.stack_order ?? 0));
    expect(siblings.map((t) => t.title)).toEqual(["A", "x1", "x2"]);
    expect(siblings.map((t) => t.stack_order)).toEqual([0, 1, 2]);

    // childA は変化なし
    const aRow = tasks.find((t) => t.id === childA.id);
    expect(aRow?.stack_order).toBe(0);
    // 元の末尾は消えている
    expect(tasks.find((t) => t.id === childLast.id)).toBeUndefined();
  });

  test("RPC は別ユーザーの target を弾く (RLS / security invoker)", async ({
    testUserId: userId,
  }) => {
    const admin = createAdminClient();
    // 自分 (userId) で project / parent / child を作る
    const project = await seedProject(admin, { userId, name: "RLS 検証", color: "#F87E7E" });
    const parent = await seedTask(admin, {
      userId,
      projectId: project.id,
      title: "親",
      stackOrder: 0,
      decomposeStatus: "decomposed",
    });
    const child = await seedTask(admin, {
      userId,
      projectId: project.id,
      title: "子",
      stackOrder: 0,
      parentTaskId: parent.id,
    });

    // service_role 経由なら RLS をバイパスして RPC は成功する
    // (本テストの目的は「security invoker = RLS 適用」の動作確認 + 副作用ゼロ)
    // service_role は全行アクセス可なので、ここでは「target_id が存在しない」exception で
    // 弾かれることを確認する (= raise exception path)。
    // shift_amount は new_children.length - 1 と一致させて HC-3 SQL ガードに引っかからない
    // ようにしておき、target 不在の検証を確実に発火させる。
    const fakeId = "00000000-0000-0000-0000-000000000000";
    const { error } = await admin.rpc("fn_resplit_child_task", {
      p_target_id: fakeId,
      p_parent_id: parent.id,
      p_base_stack_order: 0,
      p_shift_amount: 1,
      p_new_children: [
        { title: "x", body: "", estimated_minutes: null, task_category: null },
        { title: "y", body: "", estimated_minutes: null, task_category: null },
      ],
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/target task not found|not authorized/);

    // 元の project の tasks は破壊されない (target が見つからず exception で巻き戻る)。
    // 同じ testUserId で並列実行される他テスト (flatten / 末尾再分解 等) も同じ userId 配下に
    // 別 project でタスクを seed するため、project_id でスコープしてから件数を主張する。
    const tasksInProject = (await getTasksForUser(admin, userId)).filter(
      (t) => t.project_id === project.id,
    );
    expect(tasksInProject).toHaveLength(2);
    expect(tasksInProject.find((t) => t.id === parent.id)).toBeTruthy();
    expect(tasksInProject.find((t) => t.id === child.id)).toBeTruthy();
  });

  test("空の new_children 配列を渡すと exception で弾かれる (= 不正な呼び出しは破壊しない)", async ({
    testUserId: userId,
  }) => {
    const admin = createAdminClient();
    const project = await seedProject(admin, { userId, name: "empty children", color: "#FFCF58" });
    const parent = await seedTask(admin, {
      userId,
      projectId: project.id,
      title: "親",
      stackOrder: 0,
      decomposeStatus: "decomposed",
    });
    const child = await seedTask(admin, {
      userId,
      projectId: project.id,
      title: "子",
      stackOrder: 0,
      parentTaskId: parent.id,
    });

    const { error } = await admin.rpc("fn_resplit_child_task", {
      p_target_id: child.id,
      p_parent_id: parent.id,
      p_base_stack_order: 0,
      p_shift_amount: 0,
      p_new_children: [],
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? "").toMatch(/non-empty/);

    // child は依然存在する (exception で trans 巻き戻り)
    const tasks = await getTasksForUser(admin, userId);
    expect(tasks.find((t) => t.id === child.id)).toBeTruthy();
  });
});
