import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Database, Tables } from "@/shared/types/database";

import { decomposeTask, type DecomposeTaskDeps, type GenerateFn } from "./decompose-server";

type Plan = {
  fetch: { data: Partial<Tables<"tasks">> | null; error: { message: string } | null };
  update: { error: { message: string } | null };
  // bulk insert tasks → returns id rows
  insertTasks: { data: { id: string }[] | null; error: { message: string } | null };
  insertActionLogs: { error: { message: string } | null };
};

function makeSupabase(plan: Plan): {
  client: SupabaseClient<Database>;
  calls: {
    insertedTasks: unknown[];
    statusUpdates: Array<{ id: unknown; decompose_status: unknown }>;
    actionLogs: unknown[];
  };
} {
  const calls = {
    insertedTasks: [] as unknown[],
    statusUpdates: [] as Array<{ id: unknown; decompose_status: unknown }>,
    actionLogs: [] as unknown[],
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
      // setDecomposeStatus: update({...}).eq("id", taskId) — eq is awaited (PostgrestFilterBuilder is thenable)
      // bulk insert: insert(payloads).select("id") — chain returns data/error
      update: (patch: { decompose_status?: unknown }) => ({
        eq: (_col: string, val: unknown) => {
          calls.statusUpdates.push({ id: val, decompose_status: patch.decompose_status });
          return Promise.resolve({ error: plan.update.error });
        },
      }),
      insert: (payloads: unknown) => {
        // bulk insert tasks: chain ends with .select("id")
        calls.insertedTasks.push(payloads);
        return {
          select: vi.fn(() =>
            Promise.resolve({
              data: plan.insertTasks.data,
              error: plan.insertTasks.error,
            }),
          ),
        };
      },
    };
  });

  const client = {
    from,
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
    insertTasks: { data: [{ id: "child-1" }, { id: "child-2" }], error: null },
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

  test("happy path: AI が 2 件返す → 子 insert + 親 decomposed + action_log 記録", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeParentRow()));
    const generate = vi.fn(async () =>
      JSON.stringify([
        { title: "子A", estimated_minutes: 30 },
        { title: "子B", estimated_minutes: 15 },
      ]),
    );

    const result = await decomposeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "decomposed", childIds: ["child-1", "child-2"] });

    // bulk insert payload を検証
    expect(calls.insertedTasks).toHaveLength(1);
    const inserted = calls.insertedTasks[0] as Array<Record<string, unknown>>;
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toMatchObject({
      user_id: "user-1",
      project_id: "proj-1", // 親から継承
      depends_on_event_id: "evt-1", // 親から継承
      parent_task_id: "parent-1",
      title: "子A",
      estimated_minutes: 30,
      stack_order: 5, // baseStackOrder = parent.stack_order
      decompose_status: "none",
    });
    expect(inserted[1]).toMatchObject({
      title: "子B",
      stack_order: 6, // baseStackOrder + 1
    });

    // 状態遷移: decomposing → decomposed
    expect(calls.statusUpdates).toEqual([
      { id: "parent-1", decompose_status: "decomposing" },
      { id: "parent-1", decompose_status: "decomposed" },
    ]);

    // action_log: task_decomposed
    expect(calls.actionLogs).toHaveLength(1);
    expect(calls.actionLogs[0]).toMatchObject({
      user_id: "user-1",
      action_type: "task_decomposed",
      task_id: "parent-1",
      metadata: { task_id: "parent-1", child_ids: ["child-1", "child-2"] },
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
    expect(calls.insertedTasks).toHaveLength(0);
    expect(calls.statusUpdates).toHaveLength(0);
    expect(calls.actionLogs).toHaveLength(0);
  });

  test("race condition: 親が active 化 → 分解せず skipped (ADR 0017 Notes)", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeParentRow({ status: "active" })));
    const generate = vi.fn();

    const result = await decomposeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "skipped", reason: "parent_active_or_locked" });
    expect(generate).not.toHaveBeenCalled();
    expect(calls.insertedTasks).toHaveLength(0);
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
    expect(calls.insertedTasks).toHaveLength(0);
  });

  test("既に skipped → 再分解しない", async () => {
    const { client } = makeSupabase(defaultPlan(makeParentRow({ decompose_status: "skipped" })));
    const generate = vi.fn();

    const result = await decomposeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "skipped", reason: "already_resolved" });
    expect(generate).not.toHaveBeenCalled();
  });

  test("AI が parse 不能なテキストを返す → none に戻して failed (core を止めない)", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeParentRow()));
    const generate = vi.fn(async () => "I can't help you decompose this");

    const result = await decomposeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "failed", reason: "ai_response_unparseable" });
    expect(calls.insertedTasks).toHaveLength(0);
    // 状態: decomposing → none (戻す)
    expect(calls.statusUpdates).toEqual([
      { id: "parent-1", decompose_status: "decomposing" },
      { id: "parent-1", decompose_status: "none" },
    ]);
    expect(calls.actionLogs).toHaveLength(0);
  });

  test("AI が空配列 → 親を skipped に倒す (= 分解不要と判断)", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeParentRow()));
    const generate = vi.fn(async () => "[]");

    const result = await decomposeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "skipped", reason: "ai_decided_not_to_split" });
    expect(calls.insertedTasks).toHaveLength(0);
    expect(calls.statusUpdates).toEqual([
      { id: "parent-1", decompose_status: "decomposing" },
      { id: "parent-1", decompose_status: "skipped" },
    ]);
    expect(calls.actionLogs).toHaveLength(0);
  });

  test("AI が 1 件しか返さない (実質分解されてない) → skipped に倒す (parser 仕様)", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeParentRow()));
    const generate = vi.fn(async () =>
      JSON.stringify([{ title: "ひとつだけ", estimated_minutes: 10 }]),
    );

    const result = await decomposeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "skipped", reason: "ai_decided_not_to_split" });
    expect(calls.insertedTasks).toHaveLength(0);
  });

  test("子 insert が DB 失敗 → none に戻して failed", async () => {
    const plan = defaultPlan(makeParentRow());
    plan.insertTasks = { data: null, error: { message: "FK violation" } };
    const { client, calls } = makeSupabase(plan);
    const generate = vi.fn(async () =>
      JSON.stringify([
        { title: "a", estimated_minutes: 15 },
        { title: "b", estimated_minutes: 15 },
      ]),
    );

    const result = await decomposeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "failed", reason: "insert_failed" });
    expect(calls.statusUpdates).toEqual([
      { id: "parent-1", decompose_status: "decomposing" },
      { id: "parent-1", decompose_status: "none" },
    ]);
    expect(calls.actionLogs).toHaveLength(0);
  });

  test("親の stack_order が null でも子は 0 始まりで割り当てられる", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeParentRow({ stack_order: null })));
    const generate = vi.fn(async () =>
      JSON.stringify([
        { title: "a", estimated_minutes: 15 },
        { title: "b", estimated_minutes: 15 },
      ]),
    );

    await decomposeTask(makeDeps({ client, generate }));

    const inserted = calls.insertedTasks[0] as Array<Record<string, unknown>>;
    expect(inserted[0]).toMatchObject({ stack_order: 0 });
    expect(inserted[1]).toMatchObject({ stack_order: 1 });
  });

  test("親の depends_on_event_id が null なら子も null", async () => {
    const { client, calls } = makeSupabase(
      defaultPlan(makeParentRow({ depends_on_event_id: null })),
    );
    const generate = vi.fn(async () =>
      JSON.stringify([
        { title: "a", estimated_minutes: 15 },
        { title: "b", estimated_minutes: 15 },
      ]),
    );

    await decomposeTask(makeDeps({ client, generate }));

    const inserted = calls.insertedTasks[0] as Array<Record<string, unknown>>;
    expect(inserted[0].depends_on_event_id).toBeNull();
    expect(inserted[1].depends_on_event_id).toBeNull();
  });
});
