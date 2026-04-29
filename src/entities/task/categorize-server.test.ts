import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Database, Tables } from "@/shared/types/database";

import { categorizeTask, type CategorizeTaskDeps, type GenerateFn } from "./categorize-server";

type Plan = {
  fetch: { data: Partial<Tables<"tasks">> | null; error: { message: string } | null };
  update: {
    data: { id: string } | null;
    error: { message: string } | null;
  };
};

/**
 * categorize-server が叩く Supabase の chain を最小モック化する。
 *
 * - fetch: `from('tasks').select(...).eq('id').eq('user_id').maybeSingle()`
 * - update: `from('tasks').update({task_category}).eq('id').eq('user_id').is('task_category', null).select('id').maybeSingle()`
 */
function makeSupabase(plan: Plan): {
  client: SupabaseClient<Database>;
  calls: {
    updates: Array<{
      patch: Record<string, unknown>;
      filters: Array<[string, unknown] | { kind: "is"; col: string; val: unknown }>;
    }>;
  };
} {
  const calls = {
    updates: [] as Array<{
      patch: Record<string, unknown>;
      filters: Array<[string, unknown] | { kind: "is"; col: string; val: unknown }>;
    }>,
  };

  const from = vi.fn((table: string) => {
    if (table !== "tasks") {
      throw new Error(`unexpected table: ${table}`);
    }
    return {
      // fetchTask: select(...).eq("id").eq("user_id").maybeSingle()
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
      // update({...}).eq("id").eq("user_id").is("task_category", null).select("id").maybeSingle()
      update: (patch: Record<string, unknown>) => {
        const record: (typeof calls.updates)[number] = { patch, filters: [] };
        calls.updates.push(record);
        const chain = {
          eq: (col: string, val: unknown) => {
            record.filters.push([col, val]);
            return chain;
          },
          is: (col: string, val: unknown) => {
            record.filters.push({ kind: "is", col, val });
            return chain;
          },
          select: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: plan.update.data,
                error: plan.update.error,
              }),
          }),
        };
        return chain;
      },
    };
  });

  const client = { from } as unknown as SupabaseClient<Database>;
  return { client, calls };
}

function makeTaskRow(overrides: Partial<Tables<"tasks">> = {}): Partial<Tables<"tasks">> {
  return {
    id: "task-1",
    title: "RLS ポリシーの追加",
    body: "tasks に user_id スコープを敷く",
    task_category: null,
    ...overrides,
  };
}

function defaultPlan(task: Partial<Tables<"tasks">> | null): Plan {
  return {
    fetch: { data: task, error: null },
    update: { data: { id: "task-1" }, error: null },
  };
}

function makeDeps(opts: {
  client: SupabaseClient<Database>;
  generate: GenerateFn;
  taskId?: string;
  userId?: string;
}): CategorizeTaskDeps {
  return {
    supabase: opts.client,
    userId: opts.userId ?? "user-1",
    taskId: opts.taskId ?? "task-1",
    generate: opts.generate,
  };
}

describe("categorizeTask", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  test("happy path: AI が `coding` を返す → tasks.task_category を coding に UPDATE", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeTaskRow()));
    const generate = vi.fn(async () => "coding");

    const result = await categorizeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "categorized", category: "coding" });
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].patch).toEqual({ task_category: "coding" });
    // race guard: id / user_id / task_category IS NULL の 3 条件で UPDATE
    expect(calls.updates[0].filters).toEqual([
      ["id", "task-1"],
      ["user_id", "user-1"],
      { kind: "is", col: "task_category", val: null },
    ]);
    // prompt が title / body 入りで組まれている
    expect(generate).toHaveBeenCalledOnce();
    expect(generate).toHaveBeenCalledWith(expect.stringContaining("RLS ポリシーの追加"));
  });

  test("対象タスクが存在しない (RLS or 既に削除) → no-op で task_not_found", async () => {
    const { client, calls } = makeSupabase(defaultPlan(null));
    const generate = vi.fn();

    const result = await categorizeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "skipped", reason: "task_not_found" });
    expect(generate).not.toHaveBeenCalled();
    expect(calls.updates).toHaveLength(0);
  });

  test("既に task_category が埋まっている (人間 override 等) → AI で上書きしない", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeTaskRow({ task_category: "doc" })));
    const generate = vi.fn();

    const result = await categorizeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "skipped", reason: "already_categorized" });
    // AI 呼び出しもスキップ (quota / latency 節約)
    expect(generate).not.toHaveBeenCalled();
    expect(calls.updates).toHaveLength(0);
  });

  test("AI が値域外を返す (例: meeting) → 何も書かず failed/ai_response_unparseable", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeTaskRow()));
    const generate = vi.fn(async () => "meeting");

    const result = await categorizeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "failed", reason: "ai_response_unparseable" });
    expect(calls.updates).toHaveLength(0); // null のまま残す (ADR 0013)
  });

  test("AI が空文字を返す → failed/ai_response_unparseable で null のまま残る", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeTaskRow()));
    const generate = vi.fn(async () => "");

    const result = await categorizeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "failed", reason: "ai_response_unparseable" });
    expect(calls.updates).toHaveLength(0);
  });

  test("Gemini が throw (429 quota / 503 / network 等) → failed/generate_failed", async () => {
    const { client, calls } = makeSupabase(defaultPlan(makeTaskRow()));
    const generate = vi.fn(async () => {
      throw Object.assign(new Error("quota exceeded"), { status: 429 });
    });

    const result = await categorizeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "failed", reason: "generate_failed" });
    expect(calls.updates).toHaveLength(0); // null のまま (ADR 0013)
  });

  test("UPDATE が DB エラー → failed/update_failed", async () => {
    const plan = defaultPlan(makeTaskRow());
    plan.update = { data: null, error: { message: "rls violation" } };
    const { client, calls } = makeSupabase(plan);
    const generate = vi.fn(async () => "research");

    const result = await categorizeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "failed", reason: "update_failed" });
    expect(calls.updates).toHaveLength(1);
  });

  test("AI 応答中に人間 override が走った (UPDATE が 0 行) → already_categorized", async () => {
    // AI 呼び出し後の race: `task_category IS NULL` ガードに弾かれて 0 行更新になる。
    const plan = defaultPlan(makeTaskRow());
    plan.update = { data: null, error: null };
    const { client, calls } = makeSupabase(plan);
    const generate = vi.fn(async () => "admin");

    const result = await categorizeTask(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "skipped", reason: "already_categorized" });
    expect(calls.updates).toHaveLength(1);
  });

  test("値域それぞれ (coding/doc/research/admin/other) を AI 応答として受理する", async () => {
    for (const category of ["coding", "doc", "research", "admin", "other"] as const) {
      const { client, calls } = makeSupabase(defaultPlan(makeTaskRow()));
      const generate = vi.fn(async () => category);

      const result = await categorizeTask(makeDeps({ client, generate }));

      expect(result).toEqual({ kind: "categorized", category });
      expect(calls.updates[0].patch).toEqual({ task_category: category });
    }
  });
});
