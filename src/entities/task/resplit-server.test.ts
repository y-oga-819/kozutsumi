import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Database, Tables } from "@/shared/types/database";

import { resplitChildTask, type ResplitChildTaskDeps } from "./resplit-server";
import type { GenerateFn } from "./decompose-server";

type Plan = {
  fetchTarget: { data: Partial<Tables<"tasks">> | null; error: { message: string } | null };
  fetchSiblings: { data: { title: string }[] | null; error: { message: string } | null };
  update: { error: { message: string } | null };
  rpc: { data: string[] | null; error: { message: string } | null };
  insertActionLogs: { error: { message: string } | null };
  rpcThrow?: unknown; // rpc が throw する想定 (last-resort safety net テスト用)
  /**
   * Issue #121 race ケース: tryClaimDecomposing で「既に decomposing」を疑似する。
   * true のとき maybeSingle が { data: null } を返し、orchestrator は skipped/already_decomposing
   * に倒す (race window が閉じていることのテスト)。
   */
  claimReturnsExisting?: boolean;
};

function makeSupabase(plan: Plan): {
  client: SupabaseClient<Database>;
  calls: {
    statusUpdates: Array<{ id: unknown; decompose_status: unknown }>;
    rpcCalls: Array<{ name: string; params: Record<string, unknown> }>;
    actionLogs: unknown[];
    siblingsQueries: Array<{ parentId: unknown; excludeId: unknown }>;
  };
} {
  const calls = {
    statusUpdates: [] as Array<{ id: unknown; decompose_status: unknown }>,
    rpcCalls: [] as Array<{ name: string; params: Record<string, unknown> }>,
    actionLogs: [] as unknown[],
    siblingsQueries: [] as Array<{ parentId: unknown; excludeId: unknown }>,
  };

  const from = vi.fn((table: string) => {
    if (table === "action_logs") {
      return {
        insert: (payload: unknown) => {
          calls.actionLogs.push(payload);
          return Promise.resolve({ error: plan.insertActionLogs.error });
        },
      };
    }

    // table === "tasks"
    // 2 つの select パスがある:
    //   1. fetchTarget: select(...).eq(id).eq(user_id).maybeSingle()
    //   2. fetchSiblings: select("title").eq(user_id).eq(parent_task_id).neq(id).order(...)
    let mode: "target" | "siblings" | "unknown" = "unknown";
    let parentForSiblings: unknown = null;
    let excludeForSiblings: unknown = null;
    let firstEqCol: string | null = null;
    let firstEqVal: unknown = null;

    return {
      select: vi.fn((cols: string) => {
        // siblings は "title" のみ select、target は長い列リスト
        mode = cols === "title" ? "siblings" : "target";
        return {
          eq: vi.fn((col: string, val: unknown) => {
            if (mode === "target") {
              return {
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(() =>
                    Promise.resolve({
                      data: plan.fetchTarget.data ?? null,
                      error: plan.fetchTarget.error,
                    }),
                  ),
                })),
              };
            }
            // siblings: select("title").eq(user_id, _).eq(parent_task_id, _).neq(id, _).order(...)
            firstEqCol = col;
            firstEqVal = val;
            return {
              eq: vi.fn((col2: string, val2: unknown) => {
                if (col2 === "parent_task_id") parentForSiblings = val2;
                return {
                  neq: vi.fn((col3: string, val3: unknown) => {
                    if (col3 === "id") excludeForSiblings = val3;
                    return {
                      order: vi.fn(() => {
                        calls.siblingsQueries.push({
                          parentId: parentForSiblings,
                          excludeId: excludeForSiblings,
                        });
                        // firstEqCol/firstEqVal を使わない場合は ESLint warning だけど
                        // 実装側で user_id eq があることを覚えておくため変数として残す
                        void firstEqCol;
                        void firstEqVal;
                        return Promise.resolve({
                          data: plan.fetchSiblings.data,
                          error: plan.fetchSiblings.error,
                        });
                      }),
                    };
                  }),
                };
              }),
            };
          }),
        };
      }),
      update: (patch: { decompose_status?: unknown }) => ({
        eq: (_col: string, val: unknown) => {
          calls.statusUpdates.push({ id: val, decompose_status: patch.decompose_status });
          // 2 系統の chain を同じ shape で返す:
          //   (a) `.eq()` を await: setDecomposeStatus (failed / skipped) 用、{ error } を解決
          //   (b) `.eq().neq().select().maybeSingle()`: tryClaimDecomposing 用、
          //       race 主張に成功すれば { data: { id }, error: null }、
          //       既に decomposing なら mock 側で plan.claimReturnsExisting = true を立てて { data: null }
          const promise = Promise.resolve({ error: plan.update.error });
          return Object.assign(promise, {
            neq: () => ({
              select: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data:
                      plan.claimReturnsExisting === true
                        ? null
                        : plan.update.error
                          ? null
                          : { id: val },
                    error: plan.update.error,
                  }),
              }),
            }),
          });
        },
      }),
    };
  });

  const rpc = vi.fn((name: string, params: Record<string, unknown>) => {
    calls.rpcCalls.push({ name, params });
    if (plan.rpcThrow !== undefined) {
      throw plan.rpcThrow;
    }
    return Promise.resolve({ data: plan.rpc.data, error: plan.rpc.error });
  });

  const client = {
    from,
    rpc,
  } as unknown as SupabaseClient<Database>;

  return { client, calls };
}

function makeTargetRow(overrides: Partial<Tables<"tasks">> = {}): Partial<Tables<"tasks">> {
  return {
    id: "child-B",
    status: "idle",
    decompose_status: "none",
    title: "本文を書く",
    body: "ドキュメント本文を執筆",
    estimated_minutes: 30,
    task_category: "doc",
    parent_task_id: "parent-1",
    stack_order: 1,
    created_at: "2026-04-30T09:00:00.000Z",
    ...overrides,
  };
}

function defaultPlan(target: Partial<Tables<"tasks">> | null): Plan {
  return {
    fetchTarget: { data: target, error: null },
    fetchSiblings: {
      data: [{ title: "導入部の構成を決める" }, { title: "最終確認" }],
      error: null,
    },
    update: { error: null },
    rpc: { data: ["new-1", "new-2", "new-3"], error: null },
    insertActionLogs: { error: null },
  };
}

function makeDeps(opts: {
  client: SupabaseClient<Database>;
  generate: GenerateFn;
  taskId?: string;
  userId?: string;
}): ResplitChildTaskDeps {
  return {
    supabase: opts.client,
    userId: opts.userId ?? "user-1",
    taskId: opts.taskId ?? "child-B",
    generate: opts.generate,
  };
}

const VALID_RAW = JSON.stringify([
  { title: "導入部の構成を決める", body: "", estimated_minutes: 10, task_category: "doc" },
  { title: "本文を書く", body: "", estimated_minutes: 15, task_category: "doc" },
  { title: "最終確認", body: "", estimated_minutes: 5, task_category: "doc" },
]);

describe("resplitChildTask", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  test("happy path: AI が 3 件返す → rpc で flatten + action_log に snapshot + 新 task_id 配列", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeTargetRow()));
    const generate = vi.fn(async () => VALID_RAW);

    const result = await resplitChildTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "resplit_succeeded", newChildIds: ["new-1", "new-2", "new-3"] });

    // rpc が想定通りの params で呼ばれている (ADR 0028)
    expect(calls.rpcCalls).toHaveLength(1);
    expect(calls.rpcCalls[0].name).toBe("fn_resplit_child_task");
    expect(calls.rpcCalls[0].params).toMatchObject({
      p_target_id: "child-B",
      p_parent_id: "parent-1",
      p_base_stack_order: 1, // = target.stack_order
      p_shift_amount: 2, // = parsed.length(3) - 1
    });
    // p_new_children は parsed の写像
    const newChildren = calls.rpcCalls[0].params.p_new_children as Array<Record<string, unknown>>;
    expect(newChildren).toHaveLength(3);
    expect(newChildren[0]).toMatchObject({ title: "導入部の構成を決める", task_category: "doc" });

    // status: decomposing に倒すのみ (success path では rpc が target を delete するので追加 update は無い)
    expect(calls.statusUpdates).toEqual([{ id: "child-B", decompose_status: "decomposing" }]);

    // action_log: task_child_resplit (ADR 0030)。column.task_id は新規子の先頭
    expect(calls.actionLogs).toHaveLength(1);
    expect(calls.actionLogs[0]).toMatchObject({
      user_id: "user-1",
      action_type: "task_child_resplit",
      task_id: "new-1",
      metadata: {
        task_id: "new-1",
        parent_id: "parent-1",
        new_child_ids: ["new-1", "new-2", "new-3"],
        raw_response: VALID_RAW,
        resplit_target_snapshot: {
          id: "child-B",
          title: "本文を書く",
          body: "ドキュメント本文を執筆",
          estimated_minutes: 30,
          task_category: "doc",
          created_at: "2026-04-30T09:00:00.000Z",
        },
      },
    });
  });

  test("siblings を prompt に渡す (ADR 0029)", async () => {
    const { client } = makeSupabase(defaultPlan(makeTargetRow()));
    const generate = vi.fn(async () => VALID_RAW);

    await resplitChildTask(makeDeps({ client, generate }));

    expect(generate).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledWith(expect.stringContaining("既存の兄弟タスク"));
    expect(generate).toHaveBeenCalledWith(expect.stringContaining("- 導入部の構成を決める"));
    expect(generate).toHaveBeenCalledWith(expect.stringContaining("- 最終確認"));
    // target 自身は siblings に含まれない (fetchSiblings の neq("id", target.id) で除外)
    // → mock 側で除外済みデータを返している前提
  });

  test("siblings 取得が失敗 → 空配列で続行 (フェイルソフト、ADR 0029)", async () => {
    const plan = defaultPlan(makeTargetRow());
    plan.fetchSiblings = { data: null, error: { message: "siblings fetch error" } };
    const { client } = makeSupabase(plan);
    const generate = vi.fn(async () => VALID_RAW);

    const result = await resplitChildTask(makeDeps({ client, generate }));

    expect(result.kind).toBe("resplit_succeeded");
    // prompt には siblings section が出ない (siblings=[] のため)
    expect(generate).not.toHaveBeenCalledWith(expect.stringContaining("既存の兄弟タスク"));
  });

  test("target が見つからない → skipped (task_not_found)", async () => {
    const { client, calls } = makeSupabase(defaultPlan(null));
    const generate = vi.fn();

    const result = await resplitChildTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "skipped", reason: "task_not_found" });
    expect(generate).not.toHaveBeenCalled();
    expect(calls.rpcCalls).toHaveLength(0);
    expect(calls.statusUpdates).toHaveLength(0);
  });

  test("parent_task_id が null (= 親自身) → skipped (no_parent)", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeTargetRow({ parent_task_id: null })));
    const generate = vi.fn();

    const result = await resplitChildTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "skipped", reason: "no_parent" });
    expect(generate).not.toHaveBeenCalled();
    expect(calls.rpcCalls).toHaveLength(0);
  });

  test("status=active → skipped (child_active_or_locked)", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeTargetRow({ status: "active" })));
    const generate = vi.fn();

    const result = await resplitChildTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "skipped", reason: "child_active_or_locked" });
    expect(generate).not.toHaveBeenCalled();
    expect(calls.statusUpdates).toHaveLength(0);
  });

  test("status=paused / done でも skipped", async () => {
    for (const status of ["paused", "done"] as const) {
      const { client } = makeSupabase(defaultPlan(makeTargetRow({ status })));
      const generate = vi.fn();
      const result = await resplitChildTask(makeDeps({ client, generate }));
      expect(result).toEqual({ kind: "skipped", reason: "child_active_or_locked" });
    }
  });

  test("decompose_status=decomposing → skipped (already_decomposing)", async () => {
    const { client, calls } = makeSupabase(
      defaultPlan(makeTargetRow({ decompose_status: "decomposing" })),
    );
    const generate = vi.fn();

    const result = await resplitChildTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "skipped", reason: "already_decomposing" });
    expect(generate).not.toHaveBeenCalled();
    expect(calls.statusUpdates).toHaveLength(0); // 既に decomposing なので追加更新しない
  });

  // Issue #121 (review iteration 2): fetchTarget→setDecomposeStatus の race window を
  // 条件付き update で閉じた。並行 click や fire-and-forget の重複起動でも、後勝ちの 1 本だけが
  // 進み、もう 1 本は skipped/already_decomposing で潰れることをテストする。
  test("並行起動: claim が「既に decomposing」を返したら skipped/already_decomposing", async () => {
    const plan = defaultPlan(makeTargetRow());
    plan.claimReturnsExisting = true;
    const { client, calls } = makeSupabase(plan);
    const generate = vi.fn();

    const result = await resplitChildTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "skipped", reason: "already_decomposing" });
    expect(generate).not.toHaveBeenCalled();
    expect(calls.rpcCalls).toHaveLength(0);
    expect(calls.actionLogs).toHaveLength(0);
  });

  test("decompose_status=failed (リトライ) は許可される", async () => {
    const { client, calls } = makeSupabase(
      defaultPlan(makeTargetRow({ decompose_status: "failed" })),
    );
    const generate = vi.fn(async () => VALID_RAW);

    const result = await resplitChildTask(makeDeps({ client, generate }));

    expect(result.kind).toBe("resplit_succeeded");
    expect(calls.rpcCalls).toHaveLength(1);
  });

  test("AI parse 失敗 → failed/ai_response_unparseable + task_decompose_failed log (HC-5)", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeTargetRow()));
    const raw = "I cannot resplit this";
    const generate = vi.fn(async () => raw);

    const result = await resplitChildTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "failed", reason: "ai_response_unparseable" });
    expect(calls.rpcCalls).toHaveLength(0);
    // status: decomposing → failed
    expect(calls.statusUpdates).toEqual([
      { id: "child-B", decompose_status: "decomposing" },
      { id: "child-B", decompose_status: "failed" },
    ]);
    // action_log: task_decompose_failed (ADR 0021 を再利用)
    expect(calls.actionLogs).toHaveLength(1);
    expect(calls.actionLogs[0]).toMatchObject({
      action_type: "task_decompose_failed",
      task_id: "child-B",
      metadata: {
        task_id: "child-B",
        reason: "ai_response_unparseable",
        raw_response: raw,
      },
    });
  });

  test("AI が空配列 → skipped/ai_decided_not_to_split + task_decompose_skipped log", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeTargetRow()));
    const generate = vi.fn(async () => "[]");

    const result = await resplitChildTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "skipped", reason: "ai_decided_not_to_split" });
    expect(calls.rpcCalls).toHaveLength(0);
    expect(calls.statusUpdates).toEqual([
      { id: "child-B", decompose_status: "decomposing" },
      { id: "child-B", decompose_status: "skipped" },
    ]);
    expect(calls.actionLogs).toHaveLength(1);
    expect(calls.actionLogs[0]).toMatchObject({
      action_type: "task_decompose_skipped",
      task_id: "child-B",
      metadata: { task_id: "child-B", raw_response: "[]" },
    });
  });

  test("AI が 1 件のみ (parser 仕様で skipped 扱い) → skipped", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeTargetRow()));
    const generate = vi.fn(async () =>
      JSON.stringify([{ title: "ひとつだけ", estimated_minutes: 10 }]),
    );

    const result = await resplitChildTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "skipped", reason: "ai_decided_not_to_split" });
    expect(calls.rpcCalls).toHaveLength(0);
    expect(calls.actionLogs[0]).toMatchObject({ action_type: "task_decompose_skipped" });
  });

  test("rpc が error を返す → failed/insert_failed + task_decompose_failed log", async () => {
    const plan = defaultPlan(makeTargetRow());
    plan.rpc = { data: null, error: { message: "FK violation" } };
    const { client, calls } = makeSupabase(plan);
    const generate = vi.fn(async () => VALID_RAW);

    const result = await resplitChildTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "failed", reason: "insert_failed" });
    expect(calls.rpcCalls).toHaveLength(1);
    expect(calls.statusUpdates).toEqual([
      { id: "child-B", decompose_status: "decomposing" },
      { id: "child-B", decompose_status: "failed" },
    ]);
    expect(calls.actionLogs[0]).toMatchObject({
      action_type: "task_decompose_failed",
      metadata: {
        reason: "insert_failed",
        raw_response: VALID_RAW,
        error_message: "FK violation",
      },
    });
  });

  test("Gemini 429 → failed/quota_exhausted (ADR 0021 と同じ分類器を共有)", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeTargetRow()));
    const generate = vi.fn(async () => {
      throw Object.assign(new Error("Quota exceeded"), { status: 429 });
    });

    const result = await resplitChildTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "failed", reason: "quota_exhausted" });
    expect(calls.rpcCalls).toHaveLength(0);
    expect(calls.statusUpdates).toEqual([
      { id: "child-B", decompose_status: "decomposing" },
      { id: "child-B", decompose_status: "failed" },
    ]);
    expect(calls.actionLogs[0]).toMatchObject({
      action_type: "task_decompose_failed",
      metadata: { reason: "quota_exhausted", error_message: "Quota exceeded" },
    });
  });

  test("Gemini 503 → failed/upstream_unavailable", async () => {
    const { client } = makeSupabase(defaultPlan(makeTargetRow()));
    const generate = vi.fn(async () => {
      throw Object.assign(new Error("service unavailable"), { status: 503 });
    });

    const result = await resplitChildTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "failed", reason: "upstream_unavailable" });
  });

  test("network 系 (fetch failed) → failed/upstream_unavailable", async () => {
    const { client } = makeSupabase(defaultPlan(makeTargetRow()));
    const generate = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    const result = await resplitChildTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "failed", reason: "upstream_unavailable" });
  });

  test("status 無し throw → failed/internal_error", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeTargetRow()));
    const generate = vi.fn(async () => {
      throw new Error("oops");
    });

    const result = await resplitChildTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "failed", reason: "internal_error" });
    expect(calls.actionLogs[0]).toMatchObject({
      metadata: { reason: "internal_error", error_message: "oops" },
    });
  });

  test("rpc が想定外 throw (last-resort safety net) → failed/internal_error", async () => {
    const plan = defaultPlan(makeTargetRow());
    plan.rpcThrow = new Error("boom in rpc layer");
    const { client, calls } = makeSupabase(plan);
    const generate = vi.fn(async () => VALID_RAW);

    const result = await resplitChildTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "failed", reason: "internal_error" });
    // 最後に setDecomposeStatus(failed) が呼ばれている (decomposing → failed)
    expect(calls.statusUpdates.some((u) => u.decompose_status === "failed")).toBe(true);
    expect(calls.actionLogs[0]).toMatchObject({
      action_type: "task_decompose_failed",
      metadata: { reason: "internal_error", error_message: "boom in rpc layer" },
    });
  });

  test("target.stack_order が null → 0 を base にする", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeTargetRow({ stack_order: null })));
    const generate = vi.fn(async () => VALID_RAW);

    await resplitChildTask(makeDeps({ client, generate }));

    expect(calls.rpcCalls[0].params.p_base_stack_order).toBe(0);
  });

  test("siblings の取得は target を除外し parent_task_id でフィルタする", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeTargetRow()));
    const generate = vi.fn(async () => VALID_RAW);

    await resplitChildTask(makeDeps({ client, generate }));

    expect(calls.siblingsQueries).toHaveLength(1);
    expect(calls.siblingsQueries[0]).toMatchObject({
      parentId: "parent-1",
      excludeId: "child-B",
    });
  });
});
