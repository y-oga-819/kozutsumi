import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Database, Tables } from "@/shared/types/database";

import {
  classifyGenerateError,
  decomposeTask,
  type DecomposeTaskDeps,
  type GenerateFn,
} from "./decompose-server";

type Plan = {
  fetch: { data: Partial<Tables<"tasks">> | null; error: { message: string } | null };
  update: { error: { message: string } | null };
  // ADR 0021 / Issue #150: 子 insert + 親 decompose_status 更新は fn_decompose_parent_task RPC で
  // 1 トランザクション化されたので、mock も rpc レイヤで応答を返す。
  rpc: { data: string[] | null; error: { message: string } | null };
  insertActionLogs: { error: { message: string } | null };
  rpcThrow?: unknown; // rpc が throw する想定 (last-resort safety net テスト用)
  /**
   * ADR 0044 / Issue #157: tryClaimDecomposing で「既に decomposing / decomposed / skipped に
   * 確定済」を疑似する。true のとき claim 経路の maybeSingle が { data: null } を返し、
   * orchestrator は skipped/already_resolved に倒す (race window が閉じていることのテスト)。
   */
  claimReturnsExisting?: boolean;
};

function makeSupabase(plan: Plan): {
  client: SupabaseClient<Database>;
  calls: {
    rpcCalls: Array<{ name: string; params: Record<string, unknown> }>;
    statusUpdates: Array<{ id: unknown; decompose_status: unknown }>;
    actionLogs: unknown[];
  };
} {
  const calls = {
    rpcCalls: [] as Array<{ name: string; params: Record<string, unknown> }>,
    statusUpdates: [] as Array<{ id: unknown; decompose_status: unknown }>,
    actionLogs: [] as unknown[],
  };

  const from = vi.fn((table: string) => {
    if (table === "action_logs") {
      return {
        // ADR 0051 D3: logServerSide が `.insert(...).select("id").single()` を呼ぶように
        // なったので mock chain にもそれを反映する。戻り値の id は test 側で使わないので
        // 固定値で十分。
        insert: (payload: unknown) => {
          calls.actionLogs.push(payload);
          return {
            select: () => ({
              single: () =>
                Promise.resolve({
                  data: plan.insertActionLogs.error ? null : { id: "log-id-mock" },
                  error: plan.insertActionLogs.error,
                }),
            }),
          };
        },
      };
    }

    // table === "tasks"
    return {
      // fetchParent: select(...).eq(...).eq(...).maybeSingle()
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() =>
              Promise.resolve({
                data: plan.fetch.data ?? null,
                error: plan.fetch.error,
              }),
            ),
          })),
        })),
      })),
      // 2 系統の chain を同じ shape で返す (resplit-server.test.ts と同形):
      //   (a) `.update().eq()` を await: setDecomposeStatus (failed / skipped) 用、{ error } を解決
      //   (b) `.update().eq().in().select().maybeSingle()`: tryClaimDecomposing (ADR 0044) 用、
      //       claim 成功で { data: { id }, error: null }、race 敗北で plan.claimReturnsExisting = true
      //       のとき { data: null }
      update: (patch: { decompose_status?: unknown }) => ({
        eq: (_col: string, val: unknown) => {
          calls.statusUpdates.push({ id: val, decompose_status: patch.decompose_status });
          const promise = Promise.resolve({ error: plan.update.error });
          return Object.assign(promise, {
            in: () => ({
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

function makeParentRow(overrides: Partial<Tables<"tasks">> = {}): Partial<Tables<"tasks">> {
  return {
    id: "parent-1",
    status: "idle",
    decompose_status: "none",
    title: "親タスク",
    body: "本文",
    estimated_minutes: 60,
    task_size: null,
    project_id: "proj-1",
    depends_on_event_id: "evt-1",
    stack_order: 5,
    ...overrides,
  };
}

function defaultPlan(parent: Partial<Tables<"tasks">> | null): Plan {
  return {
    fetch: { data: parent, error: null },
    update: { error: null },
    rpc: { data: ["child-1", "child-2"], error: null },
    insertActionLogs: { error: null },
  };
}

function makeDeps(opts: {
  client: SupabaseClient<Database>;
  generate: GenerateFn;
  taskId?: string;
  userId?: string;
}): DecomposeTaskDeps {
  return {
    supabase: opts.client,
    userId: opts.userId ?? "user-1",
    taskId: opts.taskId ?? "parent-1",
    generate: opts.generate,
  };
}

describe("decomposeTask", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  test("happy path: AI が 2 件返す → rpc で 子 insert + 親 decomposed を atomic 実行 + action_log (raw_response 含む)", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeParentRow()));
    const rawResponse = JSON.stringify([
      {
        title: "子A",
        body: "- 手順を書く\n- 注意点を確認",
        estimated_minutes: 30,
        task_category: "research",
        task_size: "30m",
      },
      {
        title: "子B",
        body: "",
        estimated_minutes: 15,
        task_category: "doc",
        task_size: "15m",
      },
    ]);
    const generate = vi.fn(async () => rawResponse);

    const result = await decomposeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "decomposed", childIds: ["child-1", "child-2"] });

    // ADR 0021 / Issue #150: rpc が想定通りの params で呼ばれている
    expect(calls.rpcCalls).toHaveLength(1);
    expect(calls.rpcCalls[0].name).toBe("fn_decompose_parent_task");
    expect(calls.rpcCalls[0].params).toMatchObject({
      p_parent_id: "parent-1",
      p_base_stack_order: 5, // = parent.stack_order
    });
    const newChildren = calls.rpcCalls[0].params.p_new_children as Array<Record<string, unknown>>;
    expect(newChildren).toHaveLength(2);
    expect(newChildren[0]).toMatchObject({
      title: "子A",
      body: "- 手順を書く\n- 注意点を確認", // #120: AI 生成 body を子 insert に渡す
      estimated_minutes: 30,
      task_category: "research", // ADR 0022: decompose プロンプトが同時推論
      task_size: "30m", // ADR 0038 / #169: 同 prompt が task_size も推論
    });
    expect(newChildren[1]).toMatchObject({
      title: "子B",
      body: "", // body が無い子は空文字で insert される
      estimated_minutes: 15,
      task_category: "doc",
      task_size: "15m",
    });

    // 状態遷移: decomposing に倒すのみ (success path では rpc が親 status='decomposed' まで実行する)
    expect(calls.statusUpdates).toEqual([{ id: "parent-1", decompose_status: "decomposing" }]);

    // action_log: task_decomposed (ADR 0021 で raw_response を必須化)
    expect(calls.actionLogs).toHaveLength(1);
    expect(calls.actionLogs[0]).toMatchObject({
      user_id: "user-1",
      action_type: "task_decomposed",
      task_id: "parent-1",
      metadata: {
        task_id: "parent-1",
        child_ids: ["child-1", "child-2"],
        raw_response: rawResponse,
      },
    });

    // prompt が組まれている
    expect(generate).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledWith(expect.stringContaining("親タスク"));
  });

  test("親が存在しない (RLS or 既に削除) → no-op で skipped", async () => {
    const { client, calls } = makeSupabase(defaultPlan(null));
    const generate = vi.fn();

    const result = await decomposeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "skipped", reason: "task_not_found" });
    expect(generate).not.toHaveBeenCalled();
    expect(calls.rpcCalls).toHaveLength(0);
    expect(calls.statusUpdates).toHaveLength(0);
    expect(calls.actionLogs).toHaveLength(0);
  });

  test("race condition: 親が active 化 → 分解せず skipped (ADR 0017 Notes)", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeParentRow({ status: "active" })));
    const generate = vi.fn();

    const result = await decomposeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "skipped", reason: "parent_active_or_locked" });
    expect(generate).not.toHaveBeenCalled();
    expect(calls.rpcCalls).toHaveLength(0);
    expect(calls.statusUpdates).toHaveLength(0); // decomposing にすら倒さない
  });

  test("paused / done でも同じく skipped", async () => {
    for (const status of ["paused", "done"] as const) {
      const { client } = makeSupabase(defaultPlan(makeParentRow({ status })));
      const generate = vi.fn();

      const result = await decomposeTask(makeDeps({ client, generate }));

      expect(result).toEqual({ kind: "skipped", reason: "parent_active_or_locked" });
      expect(generate).not.toHaveBeenCalled();
    }
  });

  test("既に decomposed → 二重分解しない (重複 fire-and-forget 耐性)", async () => {
    const { client, calls } = makeSupabase(
      defaultPlan(makeParentRow({ decompose_status: "decomposed" })),
    );
    const generate = vi.fn();

    const result = await decomposeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "skipped", reason: "already_resolved" });
    expect(generate).not.toHaveBeenCalled();
    expect(calls.rpcCalls).toHaveLength(0);
  });

  test("既に skipped → 再分解しない", async () => {
    const { client } = makeSupabase(defaultPlan(makeParentRow({ decompose_status: "skipped" })));
    const generate = vi.fn();

    const result = await decomposeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "skipped", reason: "already_resolved" });
    expect(generate).not.toHaveBeenCalled();
  });

  // ADR 0044 / Issue #157: fetchParent → setDecomposeStatus(decomposing) の旧 2 step に
  // あった TOCTOU race window を、tryClaimDecomposing の条件付き UPDATE で閉じた。
  // 並行 click や fire-and-forget の重複起動でも、後勝ちの 1 本だけが進み、もう 1 本は
  // skipped/already_resolved で潰れることをテストする。
  test("並行起動: claim が race で負けたら skipped/already_resolved (ADR 0044)", async () => {
    const plan = defaultPlan(makeParentRow());
    plan.claimReturnsExisting = true;
    const { client, calls } = makeSupabase(plan);
    const generate = vi.fn();

    const result = await decomposeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "skipped", reason: "already_resolved" });
    expect(generate).not.toHaveBeenCalled();
    expect(calls.rpcCalls).toHaveLength(0);
    expect(calls.actionLogs).toHaveLength(0);
    // claim attempt 自体は statusUpdates に記録されるが (mock 構造上)、それ以降の追加 update は無い
    expect(calls.statusUpdates).toEqual([{ id: "parent-1", decompose_status: "decomposing" }]);
  });

  test("既に failed → 詳細パネル「再実行」で再分解できる (ADR 0021 §1: failed → decomposing を許容)", async () => {
    const { client, calls } = makeSupabase(
      defaultPlan(makeParentRow({ decompose_status: "failed" })),
    );
    const rawResponse = JSON.stringify([
      { title: "子A", estimated_minutes: 30 },
      { title: "子B", estimated_minutes: 15 },
    ]);
    const generate = vi.fn(async () => rawResponse);

    const result = await decomposeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "decomposed", childIds: ["child-1", "child-2"] });
    expect(generate).toHaveBeenCalledOnce();
    // success path では rpc が親 status まで `decomposed` に倒すので、orchestrator の
    // 追加 status update は decomposing 1 回のみ (Issue #150 / ADR 0021)
    expect(calls.statusUpdates).toEqual([{ id: "parent-1", decompose_status: "decomposing" }]);
    expect(calls.rpcCalls).toHaveLength(1);
    // 再実行の試行履歴が action_logs に残る (#133 / ADR 0021)
    expect(calls.actionLogs).toHaveLength(1);
    expect(calls.actionLogs[0]).toMatchObject({
      action_type: "task_decomposed",
      task_id: "parent-1",
    });
  });

  test("AI が parse 不能なテキストを返す → failed に倒し task_decompose_failed を記録 (ADR 0021)", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeParentRow()));
    const raw = "I can't help you decompose this";
    const generate = vi.fn(async () => raw);

    const result = await decomposeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "failed", reason: "ai_response_unparseable" });
    expect(calls.rpcCalls).toHaveLength(0);
    // 状態: decomposing → failed (旧: none に戻していたのを ADR 0021 で変更)
    expect(calls.statusUpdates).toEqual([
      { id: "parent-1", decompose_status: "decomposing" },
      { id: "parent-1", decompose_status: "failed" },
    ]);
    // action_log: 失敗 reason と raw_response を記録
    expect(calls.actionLogs).toHaveLength(1);
    expect(calls.actionLogs[0]).toMatchObject({
      user_id: "user-1",
      action_type: "task_decompose_failed",
      task_id: "parent-1",
      metadata: {
        task_id: "parent-1",
        reason: "ai_response_unparseable",
        raw_response: raw,
      },
    });
  });

  test("AI が空配列 → 親を skipped に倒し task_decompose_skipped を記録 (ADR 0021)", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeParentRow()));
    const generate = vi.fn(async () => "[]");

    const result = await decomposeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "skipped", reason: "ai_decided_not_to_split" });
    expect(calls.rpcCalls).toHaveLength(0);
    expect(calls.statusUpdates).toEqual([
      { id: "parent-1", decompose_status: "decomposing" },
      { id: "parent-1", decompose_status: "skipped" },
    ]);
    expect(calls.actionLogs).toHaveLength(1);
    expect(calls.actionLogs[0]).toMatchObject({
      user_id: "user-1",
      action_type: "task_decompose_skipped",
      task_id: "parent-1",
      metadata: { task_id: "parent-1", raw_response: "[]" },
    });
  });

  test("AI が 1 件しか返さない (実質分解されてない) → skipped に倒す (parser 仕様)", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeParentRow()));
    const generate = vi.fn(async () =>
      JSON.stringify([{ title: "ひとつだけ", estimated_minutes: 10 }]),
    );

    const result = await decomposeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "skipped", reason: "ai_decided_not_to_split" });
    expect(calls.rpcCalls).toHaveLength(0);
    // 1 件 → parser が空配列扱いにするので task_decompose_skipped 記録
    expect(calls.actionLogs).toHaveLength(1);
    expect(calls.actionLogs[0]).toMatchObject({
      action_type: "task_decompose_skipped",
    });
  });

  test("rpc が error を返す (子 insert / 親 status update が atomic に失敗) → failed/insert_failed (Issue #150)", async () => {
    const plan = defaultPlan(makeParentRow());
    plan.rpc = { data: null, error: { message: "FK violation" } };
    const { client, calls } = makeSupabase(plan);
    const raw = JSON.stringify([
      { title: "a", estimated_minutes: 15 },
      { title: "b", estimated_minutes: 15 },
    ]);
    const generate = vi.fn(async () => raw);

    const result = await decomposeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "failed", reason: "insert_failed" });
    expect(calls.rpcCalls).toHaveLength(1);
    // ADR 0021: rpc 失敗で transaction 全体が rollback され、orchestrator が failed に倒す
    expect(calls.statusUpdates).toEqual([
      { id: "parent-1", decompose_status: "decomposing" },
      { id: "parent-1", decompose_status: "failed" },
    ]);
    expect(calls.actionLogs).toHaveLength(1);
    expect(calls.actionLogs[0]).toMatchObject({
      action_type: "task_decompose_failed",
      task_id: "parent-1",
      metadata: {
        task_id: "parent-1",
        reason: "insert_failed",
        raw_response: raw,
        error_message: "FK violation",
      },
    });
  });

  test("rpc が想定外 throw (last-resort safety net) → failed/internal_error (Issue #150)", async () => {
    const plan = defaultPlan(makeParentRow());
    plan.rpcThrow = new Error("boom in rpc layer");
    const { client, calls } = makeSupabase(plan);
    const raw = JSON.stringify([
      { title: "a", estimated_minutes: 15 },
      { title: "b", estimated_minutes: 15 },
    ]);
    const generate = vi.fn(async () => raw);

    const result = await decomposeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "failed", reason: "internal_error" });
    // 旧実装の「子 insert 成功 + 親 status 更新失敗 → decomposing で固まる」経路は
    // RPC 化により構造的に消えた。throw でも parent は failed で終端する。
    expect(calls.statusUpdates.some((u) => u.decompose_status === "failed")).toBe(true);
    expect(calls.actionLogs[0]).toMatchObject({
      action_type: "task_decompose_failed",
      metadata: { reason: "internal_error", error_message: "boom in rpc layer" },
    });
  });

  test("Gemini が 429 で throw → failed/quota_exhausted (ADR 0021、#107 の bug 修正)", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeParentRow()));
    const error = Object.assign(new Error("Quota exceeded"), { status: 429 });
    const generate = vi.fn(async () => {
      throw error;
    });

    const result = await decomposeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "failed", reason: "quota_exhausted" });
    // generate throw でも parent は decomposing で固まらず failed に倒れる
    expect(calls.statusUpdates).toEqual([
      { id: "parent-1", decompose_status: "decomposing" },
      { id: "parent-1", decompose_status: "failed" },
    ]);
    expect(calls.rpcCalls).toHaveLength(0);
    expect(calls.actionLogs).toHaveLength(1);
    expect(calls.actionLogs[0]).toMatchObject({
      action_type: "task_decompose_failed",
      task_id: "parent-1",
      metadata: {
        task_id: "parent-1",
        reason: "quota_exhausted",
        error_message: "Quota exceeded",
      },
    });
  });

  test("Gemini が 503 で throw → failed/upstream_unavailable", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeParentRow()));
    const error = Object.assign(new Error("service unavailable"), { status: 503 });
    const generate = vi.fn(async () => {
      throw error;
    });

    const result = await decomposeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "failed", reason: "upstream_unavailable" });
    expect(calls.statusUpdates).toEqual([
      { id: "parent-1", decompose_status: "decomposing" },
      { id: "parent-1", decompose_status: "failed" },
    ]);
    expect(calls.actionLogs[0]).toMatchObject({
      action_type: "task_decompose_failed",
      metadata: { reason: "upstream_unavailable" },
    });
  });

  test("Gemini が status 無しで throw → failed/internal_error (last-resort safety net)", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeParentRow()));
    const generate = vi.fn(async () => {
      throw new Error("oops something weird");
    });

    const result = await decomposeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "failed", reason: "internal_error" });
    expect(calls.statusUpdates).toEqual([
      { id: "parent-1", decompose_status: "decomposing" },
      { id: "parent-1", decompose_status: "failed" },
    ]);
    expect(calls.actionLogs[0]).toMatchObject({
      action_type: "task_decompose_failed",
      metadata: {
        reason: "internal_error",
        error_message: "oops something weird",
      },
    });
  });

  test("network error (fetch failed) → failed/upstream_unavailable", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeParentRow()));
    const generate = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    const result = await decomposeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "failed", reason: "upstream_unavailable" });
    expect(calls.actionLogs[0]).toMatchObject({
      metadata: { reason: "upstream_unavailable" },
    });
  });

  test("親の stack_order が null でも rpc には base=0 が渡る (子は 0 始まりで割り当てられる)", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeParentRow({ stack_order: null })));
    const generate = vi.fn(async () =>
      JSON.stringify([
        { title: "a", estimated_minutes: 15 },
        { title: "b", estimated_minutes: 15 },
      ]),
    );

    await decomposeTask(makeDeps({ client, generate }));

    expect(calls.rpcCalls[0].params.p_base_stack_order).toBe(0);
  });

  // depends_on_event_id の継承は SQL (fn_decompose_parent_task) が担うので、TypeScript レイヤでの
  // テストは行わない。RPC params には parent_task_id 由来の値は含まれず、SQL 側で parent から
  // select user_id / project_id / depends_on_event_id して継承する設計。

  test("task_category が混在 (値域内 / 値域外 / 欠損) → 値域内は採用 / それ以外は null で子は作られる (ADR 0022)", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeParentRow()));
    const generate = vi.fn(async () =>
      JSON.stringify([
        { title: "a", estimated_minutes: 15, task_category: "coding" },
        { title: "b", estimated_minutes: 15, task_category: "general" }, // 値域外
        { title: "c", estimated_minutes: 15 }, // 欠損
      ]),
    );

    const result = await decomposeTask(makeDeps({ client, generate }));

    // category の部分失敗で子の生成自体は止めない (フェイルソフト)
    expect(result.kind).toBe("decomposed");
    const newChildren = calls.rpcCalls[0].params.p_new_children as Array<Record<string, unknown>>;
    expect(newChildren).toHaveLength(3);
    expect(newChildren[0]).toMatchObject({ title: "a", task_category: "coding" });
    expect(newChildren[1]).toMatchObject({ title: "b", task_category: null });
    expect(newChildren[2]).toMatchObject({ title: "c", task_category: null });
  });

  test("task_size: 値域内は rpc params に含まれる / 欠損・値域外は null になる (ADR 0038 / #169)", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeParentRow()));
    const generate = vi.fn(async () =>
      JSON.stringify([
        { title: "a", estimated_minutes: 30, task_category: "coding", task_size: "30m" },
        { title: "b", estimated_minutes: 60, task_category: "coding", task_size: "huge" }, // 値域外
        { title: "c", estimated_minutes: 15, task_category: "coding" }, // 欠損
      ]),
    );

    const result = await decomposeTask(makeDeps({ client, generate }));

    expect(result.kind).toBe("decomposed");
    const newChildren = calls.rpcCalls[0].params.p_new_children as Array<Record<string, unknown>>;
    expect(newChildren).toHaveLength(3);
    expect(newChildren[0]).toMatchObject({ title: "a", task_size: "30m" });
    expect(newChildren[1]).toMatchObject({ title: "b", task_size: null });
    expect(newChildren[2]).toMatchObject({ title: "c", task_size: null });
  });

  test("親 task_size が prompt に渡る (#169)", async () => {
    const { client } = makeSupabase(defaultPlan(makeParentRow({ task_size: "1d" })));
    const generate = vi.fn(async () =>
      JSON.stringify([
        { title: "a", estimated_minutes: 60, task_category: "coding", task_size: "1h" },
        { title: "b", estimated_minutes: 60, task_category: "coding", task_size: "1h" },
      ]),
    );

    await decomposeTask(makeDeps({ client, generate }));

    expect(generate).toHaveBeenCalledWith(expect.stringContaining("task_size: 1d"));
  });

  test("親 task_size が null なら prompt は「未設定」と出す (後方互換)", async () => {
    const { client } = makeSupabase(defaultPlan(makeParentRow({ task_size: null })));
    const generate = vi.fn(async () =>
      JSON.stringify([
        { title: "a", estimated_minutes: 15, task_category: "coding", task_size: "15m" },
        { title: "b", estimated_minutes: 15, task_category: "coding", task_size: "15m" },
      ]),
    );

    await decomposeTask(makeDeps({ client, generate }));

    expect(generate).toHaveBeenCalledWith(expect.stringContaining("task_size: 未設定"));
  });

  test("完了条件 3 項目が rpc params に含まれる / 欠損は空文字に倒れる (ADR 0061 / 0066 / #246)", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeParentRow()));
    const generate = vi.fn(async () =>
      JSON.stringify([
        {
          title: "a",
          estimated_minutes: 30,
          task_category: "coding",
          deliverable: "API クライアント",
          done: "ユニットテストが緑",
          first_step: "型定義ファイルを作る",
        },
        // 完了条件が欠損 → parser が空文字に倒す (フェイルソフト)
        { title: "b", estimated_minutes: 15, task_category: "doc" },
      ]),
    );

    const result = await decomposeTask(makeDeps({ client, generate }));

    expect(result.kind).toBe("decomposed");
    const newChildren = calls.rpcCalls[0].params.p_new_children as Array<Record<string, unknown>>;
    expect(newChildren).toHaveLength(2);
    expect(newChildren[0]).toMatchObject({
      title: "a",
      deliverable: "API クライアント",
      done: "ユニットテストが緑",
      first_step: "型定義ファイルを作る",
    });
    expect(newChildren[1]).toMatchObject({
      title: "b",
      deliverable: "",
      done: "",
      first_step: "",
    });
  });
});

describe("classifyGenerateError", () => {
  test("status: 429 → quota_exhausted", () => {
    expect(classifyGenerateError(Object.assign(new Error("quota"), { status: 429 }))).toBe(
      "quota_exhausted",
    );
  });

  test("status: 500/502/503/504 → upstream_unavailable", () => {
    for (const status of [500, 502, 503, 504]) {
      expect(classifyGenerateError(Object.assign(new Error("x"), { status }))).toBe(
        "upstream_unavailable",
      );
    }
  });

  test("AbortError / TimeoutError → upstream_unavailable", () => {
    const abort = Object.assign(new Error("aborted"), { name: "AbortError" });
    expect(classifyGenerateError(abort)).toBe("upstream_unavailable");
    const timeout = Object.assign(new Error("timeout"), { name: "TimeoutError" });
    expect(classifyGenerateError(timeout)).toBe("upstream_unavailable");
  });

  test("network 系メッセージ (fetch failed / ECONNRESET / ETIMEDOUT / ENOTFOUND) → upstream_unavailable", () => {
    expect(classifyGenerateError(new TypeError("fetch failed"))).toBe("upstream_unavailable");
    expect(classifyGenerateError(new Error("ECONNRESET on socket"))).toBe("upstream_unavailable");
    expect(classifyGenerateError(new Error("connect ETIMEDOUT 1.2.3.4:443"))).toBe(
      "upstream_unavailable",
    );
    expect(classifyGenerateError(new Error("getaddrinfo ENOTFOUND host"))).toBe(
      "upstream_unavailable",
    );
  });

  test("status 4xx (429 以外) → internal_error (auth / quota 以外の client error)", () => {
    expect(classifyGenerateError(Object.assign(new Error("bad"), { status: 400 }))).toBe(
      "internal_error",
    );
    expect(classifyGenerateError(Object.assign(new Error("forbidden"), { status: 403 }))).toBe(
      "internal_error",
    );
  });

  test("素の Error / 文字列 / null → internal_error", () => {
    expect(classifyGenerateError(new Error("oops"))).toBe("internal_error");
    expect(classifyGenerateError("oops")).toBe("internal_error");
    expect(classifyGenerateError(null)).toBe("internal_error");
    expect(classifyGenerateError(undefined)).toBe("internal_error");
  });
});
