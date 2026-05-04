import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Database, Tables } from "@/shared/types/database";

import { SupabaseTaskGateway } from "./supabase-gateway";

/**
 * Gateway 経由で task_category が読み書きできることを保証する (#87 完了条件)。
 *
 * SupabaseTaskGateway はクエリビルダ薄ラッパーなので、
 * - fromRow が `task_category` を Task.taskCategory に写す
 * - create が `task_category` を payload に乗せる
 * - update が patch.taskCategory を `task_category` に乗せる
 * の 3 点だけを mock で踏んで担保する。
 *
 * RLS / CHECK 制約の検証は migration 側 (raw SQL) の責務。ここでは型 / mapping のみ。
 */

function makeRow(overrides: Partial<Tables<"tasks">> = {}): Tables<"tasks"> {
  return {
    id: "t1",
    user_id: "u1",
    project_id: "p1",
    title: "x",
    body: "",
    estimated_minutes: null,
    status: "idle",
    stack_order: null,
    depends_on_event_id: null,
    is_interruption: false,
    parent_task_id: null,
    decompose_status: "none",
    task_category: null,
    task_size: null,
    created_at: "2026-04-27T00:00:00.000Z",
    completed_at: null,
    ...overrides,
  };
}

type MockChain = {
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  select: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
};

function makeSupabase(returnedRow: Tables<"tasks">): {
  client: SupabaseClient<Database>;
  chain: MockChain;
} {
  const single = vi.fn(async () => ({ data: returnedRow, error: null }));
  const eq = vi.fn(() => ({ select, single }));
  const select = vi.fn(() => ({ single, eq }));
  const insert = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ insert, update, select }));
  const chain: MockChain = { insert, update, select, eq, single, from };

  const client = {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "u1" } },
        error: null,
      })),
    },
    from,
  } as unknown as SupabaseClient<Database>;

  return { client, chain };
}

describe("SupabaseTaskGateway: task_category mapping", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  test("create: taskCategory 指定値が payload.task_category に乗る", async () => {
    const { client, chain } = makeSupabase(makeRow({ task_category: "coding" }));
    const gateway = new SupabaseTaskGateway(client);

    const task = await gateway.create({
      projectId: "p1",
      title: "x",
      taskCategory: "coding",
    });

    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ task_category: "coding" }));
    expect(task.taskCategory).toBe("coding");
  });

  test("create: taskCategory 未指定なら null で insert される (AI ラベリング失敗を許容、ADR 0015)", async () => {
    const { client, chain } = makeSupabase(makeRow({ task_category: null }));
    const gateway = new SupabaseTaskGateway(client);

    const task = await gateway.create({ projectId: "p1", title: "x" });

    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ task_category: null }));
    expect(task.taskCategory).toBeNull();
  });

  test("update: taskCategory 明示なら update.task_category に乗る (override)", async () => {
    const { client, chain } = makeSupabase(makeRow({ task_category: "research" }));
    const gateway = new SupabaseTaskGateway(client);

    const task = await gateway.update("t1", { taskCategory: "research" });

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ task_category: "research" }),
    );
    expect(task.taskCategory).toBe("research");
  });

  test("update: taskCategory=null も明示的に書ける (override で外す)", async () => {
    const { client, chain } = makeSupabase(makeRow({ task_category: null }));
    const gateway = new SupabaseTaskGateway(client);

    await gateway.update("t1", { taskCategory: null });

    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ task_category: null }));
  });

  test("update: taskCategory を patch に含めなければ update に乗らない", async () => {
    const { client, chain } = makeSupabase(makeRow({ task_category: "doc" }));
    const gateway = new SupabaseTaskGateway(client);

    await gateway.update("t1", { title: "y" });

    const call = chain.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).not.toHaveProperty("task_category");
    expect(call).toHaveProperty("title", "y");
  });

  test("list: row.task_category が Task.taskCategory に写る", async () => {
    const { client } = makeSupabase(makeRow({ task_category: "admin" }));
    // list は order chain を使うので個別に組む
    const orderInner = vi.fn(async () => ({
      data: [makeRow({ task_category: "admin" })],
      error: null,
    }));
    const orderOuter = vi.fn(() => ({ order: orderInner }));
    const select = vi.fn(() => ({ order: orderOuter }));
    (client.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({ select });

    const gateway = new SupabaseTaskGateway(client);
    const tasks = await gateway.list();

    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.taskCategory).toBe("admin");
  });
});

/**
 * task_size mapping (#169 / ADR 0036 / 0038)。
 * task_category と同じ薄ラッパー責務。CHECK 制約の検証は migration 側。
 */
describe("SupabaseTaskGateway: task_size mapping (#169)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  test("create: taskSize 指定値が payload.task_size に乗る", async () => {
    const { client, chain } = makeSupabase(makeRow({ task_size: "1h" }));
    const gateway = new SupabaseTaskGateway(client);

    const task = await gateway.create({ projectId: "p1", title: "x", taskSize: "1h" });

    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ task_size: "1h" }));
    expect(task.taskSize).toBe("1h");
  });

  test("create: taskSize 未指定なら null で insert される (後方互換: 未設定 = NULL)", async () => {
    const { client, chain } = makeSupabase(makeRow({ task_size: null }));
    const gateway = new SupabaseTaskGateway(client);

    const task = await gateway.create({ projectId: "p1", title: "x" });

    expect(chain.insert).toHaveBeenCalledWith(expect.objectContaining({ task_size: null }));
    expect(task.taskSize).toBeNull();
  });

  test("update: taskSize 明示なら update.task_size に乗る (override)", async () => {
    const { client, chain } = makeSupabase(makeRow({ task_size: "2h" }));
    const gateway = new SupabaseTaskGateway(client);

    const task = await gateway.update("t1", { taskSize: "2h" });

    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ task_size: "2h" }));
    expect(task.taskSize).toBe("2h");
  });

  test("update: taskSize=null も明示的に書ける (override で外す)", async () => {
    const { client, chain } = makeSupabase(makeRow({ task_size: null }));
    const gateway = new SupabaseTaskGateway(client);

    await gateway.update("t1", { taskSize: null });

    expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ task_size: null }));
  });

  test("update: taskSize を patch に含めなければ update に乗らない (後方互換)", async () => {
    const { client, chain } = makeSupabase(makeRow({ task_size: "30m" }));
    const gateway = new SupabaseTaskGateway(client);

    await gateway.update("t1", { title: "y" });

    const call = chain.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).not.toHaveProperty("task_size");
    expect(call).toHaveProperty("title", "y");
  });

  test("list: row.task_size が Task.taskSize に写る", async () => {
    const { client } = makeSupabase(makeRow({ task_size: "1d" }));
    const orderInner = vi.fn(async () => ({
      data: [makeRow({ task_size: "1d" })],
      error: null,
    }));
    const orderOuter = vi.fn(() => ({ order: orderInner }));
    const select = vi.fn(() => ({ order: orderOuter }));
    (client.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({ select });

    const gateway = new SupabaseTaskGateway(client);
    const tasks = await gateway.list();

    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.taskSize).toBe("1d");
  });
});

describe("SupabaseTaskGateway: listCorrectionFactors (P3-9 / #93)", () => {
  function makeViewClient(
    rows: { task_category: string; sample_count: number; factor: unknown }[],
  ) {
    const select = vi.fn(async () => ({ data: rows, error: null }));
    const from = vi.fn(() => ({ select }));
    const client = { from } as unknown as SupabaseClient<Database>;
    return { client, from, select };
  }

  test("view 行を CorrectionFactor[] に写し、factor は Number で正規化する", async () => {
    // PostgREST 経由だと numeric が string で来る場合がある (ADR 0024 / 0025)。
    const { client, from } = makeViewClient([
      { task_category: "coding", sample_count: 10, factor: "0.8" },
      { task_category: "doc", sample_count: 7, factor: 2.2 },
    ]);

    const gateway = new SupabaseTaskGateway(client);
    const factors = await gateway.listCorrectionFactors();

    expect(from).toHaveBeenCalledWith("task_category_correction_factors");
    expect(factors).toEqual([
      { taskCategory: "coding", factor: 0.8, sampleCount: 10 },
      { taskCategory: "doc", factor: 2.2, sampleCount: 7 },
    ]);
  });

  test("view 行が無ければ空配列 (補正対象タスクが無い / 全 category が外れ値除外)", async () => {
    const { client } = makeViewClient([]);
    const gateway = new SupabaseTaskGateway(client);

    expect(await gateway.listCorrectionFactors()).toEqual([]);
  });

  test("RLS は view 側 (security_invoker=true) なので user_id 絞り込みは書かない", async () => {
    const { client, from, select } = makeViewClient([]);
    const gateway = new SupabaseTaskGateway(client);

    await gateway.listCorrectionFactors();
    // from + select だけで eq() / filter() は呼ばれない
    expect(from).toHaveBeenCalledTimes(1);
    expect(select).toHaveBeenCalledTimes(1);
  });
});
