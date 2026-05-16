import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { ACTION_TYPES, log } from "@/entities/action-log/logger";
import type { Database, Tables } from "@/shared/types/database";

import { SupabaseTaskGateway } from "./supabase-gateway";

// ADR 0051 の発火検証 用に logger をモジュール mock。
// 既存テストは log() の呼び出しを検証しないので、`log` の戻り値が型に合うようにだけ手当する。
vi.mock("@/entities/action-log/logger", async () => {
  const actual = await vi.importActual<typeof import("@/entities/action-log/logger")>(
    "@/entities/action-log/logger",
  );
  return {
    ...actual,
    log: vi.fn((actionType: string, metadata?: unknown) => ({
      action_type: actionType,
      metadata: metadata ?? {},
      created_at: new Date().toISOString(),
    })),
  };
});

const logMock = log as unknown as ReturnType<typeof vi.fn>;

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
    deliverable: "",
    done: "",
    first_step: "",
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
  maybeSingle: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
};

function makeSupabase(returnedRow: Tables<"tasks">): {
  client: SupabaseClient<Database>;
  chain: MockChain;
} {
  // ADR 0051 D1/D2/D4 で update / delete / create に pre-fetch (`select(...).eq(...).maybeSingle()`)
  // が増えた。同じ chain で `update(...).eq(...).select("*").single()` (本処理) と
  // `select(...).eq(...).maybeSingle()` (pre-fetch) の両方を解決できる構成にする。
  // delete() は `await delete().eq()` も `await select("id").eq()` (children 列挙) も
  // 同じ eq() chain で解決できるように、eq() を thenable にする。
  const single = vi.fn(async () => ({ data: returnedRow, error: null }));
  const maybeSingle = vi.fn(async () => ({ data: returnedRow, error: null }));
  const eq = vi.fn(() => {
    // 直接 await された場合は { data: [], error: null } (children 列挙の空ヒット相当 / delete 成功)
    const promise = Promise.resolve({ data: [], error: null });
    return Object.assign(promise, { select, single, maybeSingle, eq });
  });
  const select = vi.fn(() => ({ single, maybeSingle, eq }));
  const insert = vi.fn(() => ({ select }));
  const update = vi.fn(() => ({ eq }));
  const del = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ insert, update, select, delete: del }));
  const chain: MockChain = { insert, update, select, eq, single, maybeSingle, delete: del, from };

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

/**
 * 完了条件 mapping (#246 / ADR 0061 / 0066)。
 * deliverable / done / first_step は task_category / task_size と同じ薄ラッパー責務。
 * CHECK 制約 / NOT NULL DEFAULT '' の検証は migration 側 (raw SQL) の責務。
 */
describe("SupabaseTaskGateway: completion criteria mapping (#246)", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  test("update: 完了条件 3 項目が update.deliverable / done / first_step に乗る", async () => {
    const { client, chain } = makeSupabase(
      makeRow({ deliverable: "成果物 X", done: "条件 Y", first_step: "一手 Z" }),
    );
    const gateway = new SupabaseTaskGateway(client);

    const task = await gateway.update("t1", {
      deliverable: "成果物 X",
      done: "条件 Y",
      firstStep: "一手 Z",
    });

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({
        deliverable: "成果物 X",
        done: "条件 Y",
        first_step: "一手 Z",
      }),
    );
    expect(task.deliverable).toBe("成果物 X");
    expect(task.done).toBe("条件 Y");
    expect(task.firstStep).toBe("一手 Z");
  });

  test("update: 空文字も明示的に書ける (フェイルソフトで完了条件をクリアする)", async () => {
    const { client, chain } = makeSupabase(makeRow());
    const gateway = new SupabaseTaskGateway(client);

    await gateway.update("t1", { deliverable: "", done: "", firstStep: "" });

    expect(chain.update).toHaveBeenCalledWith(
      expect.objectContaining({ deliverable: "", done: "", first_step: "" }),
    );
  });

  test("update: 完了条件を patch に含めなければ update に乗らない", async () => {
    const { client, chain } = makeSupabase(makeRow());
    const gateway = new SupabaseTaskGateway(client);

    await gateway.update("t1", { title: "y" });

    const call = chain.update.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call).not.toHaveProperty("deliverable");
    expect(call).not.toHaveProperty("done");
    expect(call).not.toHaveProperty("first_step");
  });

  test("list: row.deliverable / done / first_step が Task の同名フィールドに写る", async () => {
    const { client } = makeSupabase(makeRow());
    const row = makeRow({ deliverable: "d", done: "x", first_step: "f" });
    const orderInner = vi.fn(async () => ({ data: [row], error: null }));
    const orderOuter = vi.fn(() => ({ order: orderInner }));
    const select = vi.fn(() => ({ order: orderOuter }));
    (client.from as ReturnType<typeof vi.fn>).mockReturnValueOnce({ select });

    const gateway = new SupabaseTaskGateway(client);
    const tasks = await gateway.list();

    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.deliverable).toBe("d");
    expect(tasks[0]!.done).toBe("x");
    expect(tasks[0]!.firstStep).toBe("f");
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

/**
 * ADR 0051: AI 分解への user editorial signal の捕捉。
 *
 * - D1: `task_title_changed` / `decomposition_modified.{child_deleted,child_edited,parent_merged}` の発火
 * - D2: `decomposition_modified.kind=child_added` の発火 (decomposed 親のみ)
 * - D4: `task_deleted.snapshot.was_decomposition_child` の埋め込み
 *
 * 親の `decompose_status` 判定は gateway が pre-fetch で取得する。fail-soft (取得失敗で
 * 発火しない) は `fetchParentDecomposeStatus` の責務。ここでは「親 = decomposed のとき
 * 発火する」「親 = none のとき発火しない」の両方向を担保する。
 */
describe("SupabaseTaskGateway: ADR 0051 editorial signal capture", () => {
  beforeEach(() => {
    logMock.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  describe("create: child_added (D2)", () => {
    test("親 decompose_status=decomposed なら child_added が発火する", async () => {
      const { client } = makeSupabase(
        makeRow({ id: "child-new", parent_task_id: "parent-1", decompose_status: "decomposed" }),
      );
      const gateway = new SupabaseTaskGateway(client);

      await gateway.create({ projectId: "p1", title: "x", parentTaskId: "parent-1" });

      const calls = logMock.mock.calls.filter((c) => c[0] === ACTION_TYPES.DECOMPOSITION_MODIFIED);
      expect(calls).toHaveLength(1);
      expect(calls[0]![1]).toEqual({
        task_id: "child-new",
        parent_id: "parent-1",
        kind: "child_added",
      });
    });

    test("親 decompose_status=none なら child_added は発火しない (純粋手動階層は対象外)", async () => {
      const { client } = makeSupabase(
        makeRow({ id: "child-new", parent_task_id: "parent-1", decompose_status: "none" }),
      );
      const gateway = new SupabaseTaskGateway(client);

      await gateway.create({ projectId: "p1", title: "x", parentTaskId: "parent-1" });

      const calls = logMock.mock.calls.filter((c) => c[0] === ACTION_TYPES.DECOMPOSITION_MODIFIED);
      expect(calls).toHaveLength(0);
    });

    test("parentTaskId 未指定なら child_added は発火しない", async () => {
      const { client } = makeSupabase(makeRow({ id: "root-task", decompose_status: "decomposed" }));
      const gateway = new SupabaseTaskGateway(client);

      await gateway.create({ projectId: "p1", title: "x" });

      const calls = logMock.mock.calls.filter((c) => c[0] === ACTION_TYPES.DECOMPOSITION_MODIFIED);
      expect(calls).toHaveLength(0);
    });
  });

  describe("update: title 編集 (D1)", () => {
    test("title が変わったら task_title_changed が発火する", async () => {
      // 親なし root task を編集 → child_edited は発火しない、title_changed のみ
      const { client } = makeSupabase(
        makeRow({ id: "t1", title: "old", parent_task_id: null, decompose_status: "none" }),
      );
      const gateway = new SupabaseTaskGateway(client);

      await gateway.update("t1", { title: "new" });

      const titleCalls = logMock.mock.calls.filter((c) => c[0] === ACTION_TYPES.TASK_TITLE_CHANGED);
      expect(titleCalls).toHaveLength(1);
      expect(titleCalls[0]![1]).toEqual({
        task_id: "t1",
        old_title: "old",
        new_title: "new",
      });
      const modCalls = logMock.mock.calls.filter(
        (c) => c[0] === ACTION_TYPES.DECOMPOSITION_MODIFIED,
      );
      expect(modCalls).toHaveLength(0);
    });

    test("親 decomposed の子の title 編集なら title_changed と child_edited が併発する", async () => {
      const { client } = makeSupabase(
        // pre-fetch / parent fetch / post-update がすべて同 row を返す mock 設計のため、
        // returnedRow が両方の役割を兼ねる: self は parent_task_id="parent-1" を持つ子、
        // parent fetch の戻りも同 row だが gateway は decompose_status 列だけ読むので
        // 同 row が "decomposed" 親として振る舞う。
        makeRow({
          id: "child-1",
          title: "old",
          parent_task_id: "parent-1",
          decompose_status: "decomposed",
        }),
      );
      const gateway = new SupabaseTaskGateway(client);

      await gateway.update("child-1", { title: "new" });

      expect(
        logMock.mock.calls.filter((c) => c[0] === ACTION_TYPES.TASK_TITLE_CHANGED),
      ).toHaveLength(1);
      const modCalls = logMock.mock.calls.filter(
        (c) => c[0] === ACTION_TYPES.DECOMPOSITION_MODIFIED,
      );
      expect(modCalls).toHaveLength(1);
      expect(modCalls[0]![1]).toEqual({
        task_id: "child-1",
        parent_id: "parent-1",
        kind: "child_edited",
      });
    });

    test("title が変わらなければ task_title_changed は発火しない", async () => {
      const { client } = makeSupabase(makeRow({ id: "t1", title: "same" }));
      const gateway = new SupabaseTaskGateway(client);

      await gateway.update("t1", { title: "same" });

      expect(
        logMock.mock.calls.filter((c) => c[0] === ACTION_TYPES.TASK_TITLE_CHANGED),
      ).toHaveLength(0);
    });

    test("editorial 系を含まない patch (status だけ等) では pre-fetch しない / log もしない", async () => {
      const { client, chain } = makeSupabase(makeRow({ id: "t1" }));
      const gateway = new SupabaseTaskGateway(client);

      await gateway.update("t1", { status: "active" });

      // pre-fetch (`select(...).maybeSingle()`) が走らないこと
      expect(chain.maybeSingle).not.toHaveBeenCalled();
      expect(
        logMock.mock.calls.filter((c) => c[0] === ACTION_TYPES.TASK_TITLE_CHANGED),
      ).toHaveLength(0);
      expect(
        logMock.mock.calls.filter((c) => c[0] === ACTION_TYPES.DECOMPOSITION_MODIFIED),
      ).toHaveLength(0);
    });
  });

  describe("delete: was_decomposition_child / child_deleted (D1, D4)", () => {
    test("親 decomposed の子削除 → snapshot.was_decomposition_child=true + child_deleted 発火", async () => {
      const { client } = makeSupabase(
        // 同様に同 row が「self (削除対象の子)」「parent fetch (decomposed 親)」両方の役を兼ねる
        makeRow({
          id: "child-1",
          parent_task_id: "parent-1",
          decompose_status: "decomposed",
        }),
      );
      const gateway = new SupabaseTaskGateway(client);

      await gateway.delete("child-1");

      const deleteCall = logMock.mock.calls.find((c) => c[0] === ACTION_TYPES.TASK_DELETED);
      expect(deleteCall).toBeDefined();
      const meta = deleteCall![1] as {
        task_id: string;
        snapshot: { was_decomposition_child: boolean; parent_task_id: string | null };
      };
      expect(meta.snapshot.was_decomposition_child).toBe(true);
      expect(meta.snapshot.parent_task_id).toBe("parent-1");
    });

    test("親なし root 削除 → snapshot.was_decomposition_child=false + child_deleted は発火しない", async () => {
      const { client } = makeSupabase(
        makeRow({ id: "root-1", parent_task_id: null, decompose_status: "none" }),
      );
      const gateway = new SupabaseTaskGateway(client);

      await gateway.delete("root-1");

      const deleteCall = logMock.mock.calls.find((c) => c[0] === ACTION_TYPES.TASK_DELETED);
      const meta = deleteCall![1] as { snapshot: { was_decomposition_child: boolean } };
      expect(meta.snapshot.was_decomposition_child).toBe(false);

      const modCalls = logMock.mock.calls.filter(
        (c) =>
          c[0] === ACTION_TYPES.DECOMPOSITION_MODIFIED &&
          (c[1] as { kind: string }).kind === "child_deleted",
      );
      expect(modCalls).toHaveLength(0);
    });
  });
});
