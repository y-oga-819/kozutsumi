import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Database, Tables } from "@/shared/types/database";

import {
  completeTaskCriteria,
  type CompleteCriteriaDeps,
  type GenerateFn,
} from "./complete-criteria-server";

type UpdateResult = { data: { id: string } | null; error: { message: string } | null };

type Plan = {
  fetch: { data: Partial<Tables<"tasks">> | null; error: { message: string } | null };
  /** 条件付き UPDATE の結果。列ごとに返り値を変える (race / error テスト用)。 */
  update?: (column: string) => UpdateResult;
};

type UpdateCall = {
  patch: Record<string, unknown>;
  filters: Array<[string, unknown]>;
};

/**
 * complete-criteria-server が叩く Supabase chain を最小モック化する。
 *
 * - fetch : `from('tasks').select(...).eq('id').eq('user_id').maybeSingle()`
 * - update: `from('tasks').update({col}).eq('id').eq('user_id').eq(col, '').select('id').maybeSingle()`
 */
function makeSupabase(plan: Plan): {
  client: SupabaseClient<Database>;
  calls: { updates: UpdateCall[] };
} {
  const calls = { updates: [] as UpdateCall[] };
  const update = plan.update ?? (() => ({ data: { id: "task-1" }, error: null }));

  const from = vi.fn((table: string) => {
    if (table !== "tasks") throw new Error(`unexpected table: ${table}`);
    return {
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() =>
              Promise.resolve({ data: plan.fetch.data ?? null, error: plan.fetch.error }),
            ),
          })),
        })),
      })),
      update: (patch: Record<string, unknown>) => {
        const record: UpdateCall = { patch, filters: [] };
        calls.updates.push(record);
        const column = Object.keys(patch)[0];
        const chain = {
          eq: (col: string, val: unknown) => {
            record.filters.push([col, val]);
            return chain;
          },
          select: () => ({
            maybeSingle: () => Promise.resolve(update(column)),
          }),
        };
        return chain;
      },
    };
  });

  return { client: { from } as unknown as SupabaseClient<Database>, calls };
}

function makeTaskRow(overrides: Partial<Tables<"tasks">> = {}): Partial<Tables<"tasks">> {
  return {
    id: "task-1",
    status: "idle",
    decompose_status: "none",
    title: "面接準備をする",
    body: "Dirbato 最終面接",
    estimated_minutes: 60,
    task_size: "1h",
    deliverable: "",
    done: "",
    first_step: "",
    ...overrides,
  };
}

function makeDeps(opts: {
  client: SupabaseClient<Database>;
  generate: GenerateFn;
}): CompleteCriteriaDeps {
  return {
    supabase: opts.client,
    userId: "user-1",
    taskId: "task-1",
    generate: opts.generate,
  };
}

const AI_RESPONSE =
  '{"deliverable":"下書き","done":"3 パターン書いた状態","first_step":"経験を 1 つ書く"}';

describe("completeTaskCriteria", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  test("happy path: 3 項目とも空 → AI 応答で 3 列を条件付き UPDATE する", async () => {
    const { client, calls } = makeSupabase({ fetch: { data: makeTaskRow(), error: null } });
    const generate = vi.fn(async () => AI_RESPONSE);

    const result = await completeTaskCriteria(makeDeps({ client, generate }));

    expect(result).toEqual({
      kind: "completed",
      filled: ["deliverable", "done", "first_step"],
    });
    expect(calls.updates).toHaveLength(3);
    // 各 UPDATE は id / user_id / <column>='' の 3 条件 (未補完フィールドのみ書く)
    expect(calls.updates[0].patch).toEqual({ deliverable: "下書き" });
    expect(calls.updates[0].filters).toEqual([
      ["id", "task-1"],
      ["user_id", "user-1"],
      ["deliverable", ""],
    ]);
    expect(calls.updates[2].patch).toEqual({ first_step: "経験を 1 つ書く" });
    expect(calls.updates[2].filters).toEqual([
      ["id", "task-1"],
      ["user_id", "user-1"],
      ["first_step", ""],
    ]);
    // prompt が title 入りで組まれている
    expect(generate).toHaveBeenCalledWith(expect.stringContaining("面接準備をする"));
  });

  test("一部だけ未補完 → 空の列だけ UPDATE する (埋まっている列は触らない)", async () => {
    const { client, calls } = makeSupabase({
      fetch: {
        data: makeTaskRow({ deliverable: "既存の成果物", first_step: "既存の一歩" }),
        error: null,
      },
    });
    const generate = vi.fn(async () => AI_RESPONSE);

    const result = await completeTaskCriteria(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "completed", filled: ["done"] });
    expect(calls.updates).toHaveLength(1);
    expect(calls.updates[0].patch).toEqual({ done: "3 パターン書いた状態" });
  });

  test("3 項目すべて埋まっている → AI を呼ばず already_complete", async () => {
    const { client, calls } = makeSupabase({
      fetch: {
        data: makeTaskRow({ deliverable: "a", done: "b", first_step: "c" }),
        error: null,
      },
    });
    const generate = vi.fn();

    const result = await completeTaskCriteria(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "skipped", reason: "already_complete" });
    expect(generate).not.toHaveBeenCalled();
    expect(calls.updates).toHaveLength(0);
  });

  test.each(["active", "paused", "done"] as const)(
    "status=%s → timer 文脈 / 完了済みなので not_eligible",
    async (status) => {
      const { client, calls } = makeSupabase({
        fetch: { data: makeTaskRow({ status }), error: null },
      });
      const generate = vi.fn();

      const result = await completeTaskCriteria(makeDeps({ client, generate }));

      expect(result).toEqual({ kind: "skipped", reason: "not_eligible" });
      expect(generate).not.toHaveBeenCalled();
      expect(calls.updates).toHaveLength(0);
    },
  );

  test.each(["decomposing", "decomposed"] as const)(
    "decompose_status=%s → not_eligible (分解中ロック / 親は補完しない)",
    async (decomposeStatus) => {
      const { client } = makeSupabase({
        fetch: { data: makeTaskRow({ decompose_status: decomposeStatus }), error: null },
      });
      const generate = vi.fn();

      const result = await completeTaskCriteria(makeDeps({ client, generate }));

      expect(result).toEqual({ kind: "skipped", reason: "not_eligible" });
      expect(generate).not.toHaveBeenCalled();
    },
  );

  test("対象タスクが存在しない (RLS / 削除済み) → task_not_found", async () => {
    const { client } = makeSupabase({ fetch: { data: null, error: null } });
    const generate = vi.fn();

    const result = await completeTaskCriteria(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "skipped", reason: "task_not_found" });
    expect(generate).not.toHaveBeenCalled();
  });

  test("Gemini が throw → failed/generate_failed (完了条件は空のまま)", async () => {
    const { client, calls } = makeSupabase({ fetch: { data: makeTaskRow(), error: null } });
    const generate = vi.fn(async () => {
      throw Object.assign(new Error("quota"), { status: 429 });
    });

    const result = await completeTaskCriteria(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "failed", reason: "generate_failed" });
    expect(calls.updates).toHaveLength(0);
  });

  test("AI 応答が JSON でない → failed/ai_response_unparseable", async () => {
    const { client, calls } = makeSupabase({ fetch: { data: makeTaskRow(), error: null } });
    const generate = vi.fn(async () => "完了条件はこちらです");

    const result = await completeTaskCriteria(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "failed", reason: "ai_response_unparseable" });
    expect(calls.updates).toHaveLength(0);
  });

  test("AI が未補完項目をどれも言語化できなかった (全項目空) → ai_returned_empty", async () => {
    const { client, calls } = makeSupabase({ fetch: { data: makeTaskRow(), error: null } });
    const generate = vi.fn(async () => '{"deliverable":"","done":"","first_step":""}');

    const result = await completeTaskCriteria(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "skipped", reason: "ai_returned_empty" });
    expect(calls.updates).toHaveLength(0);
  });

  test("UPDATE が DB エラー → failed/update_failed", async () => {
    const { client } = makeSupabase({
      fetch: { data: makeTaskRow(), error: null },
      update: () => ({ data: null, error: { message: "rls violation" } }),
    });
    const generate = vi.fn(async () => AI_RESPONSE);

    const result = await completeTaskCriteria(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "failed", reason: "update_failed" });
  });

  test("AI 応答中にユーザーが全項目を手動入力した (全 UPDATE が 0 行) → already_complete", async () => {
    // 条件付き UPDATE の `<column>=''` ガードに弾かれ、ユーザー入力値が保護される。
    const { client, calls } = makeSupabase({
      fetch: { data: makeTaskRow(), error: null },
      update: () => ({ data: null, error: null }),
    });
    const generate = vi.fn(async () => AI_RESPONSE);

    const result = await completeTaskCriteria(makeDeps({ client, generate }));

    expect(result).toEqual({ kind: "skipped", reason: "already_complete" });
    expect(calls.updates).toHaveLength(3);
  });
});
