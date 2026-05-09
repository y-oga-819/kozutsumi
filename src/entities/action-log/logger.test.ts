import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// logger が createClient を import する前にモックしておく
const insertMock = vi.fn(async () => ({ error: null }));
const fromMock = vi.fn(() => ({ insert: insertMock }));
type FakeUserResult = {
  data: { user: { id: string } | null };
  error: null;
};
const getUserMock = vi.fn<() => Promise<FakeUserResult>>(async () => ({
  data: { user: { id: "user-1" } },
  error: null,
}));

vi.mock("@/shared/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: getUserMock },
    from: fromMock,
  }),
}));

import { ACTION_TYPES, __resetLoggerClientForTest, clearLog, getLog, log } from "./logger";

function flushMicrotasks() {
  // persist() は fire-and-forget で複数段の await を含むため、
  // マクロタスク境界まで待って完了を保証する。
  return new Promise((r) => setTimeout(r, 0));
}

describe("log()", () => {
  beforeEach(() => {
    clearLog();
    __resetLoggerClientForTest();
    insertMock.mockClear();
    fromMock.mockClear();
    getUserMock.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("エントリを作成し action_type, metadata, created_at を持つ", () => {
    const entry = log(ACTION_TYPES.TASK_COMPLETED, { task_id: "t1" });
    expect(entry.action_type).toBe("task_completed");
    expect(entry.metadata).toEqual({ task_id: "t1" });
    expect(entry.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("呼ぶたびに log に蓄積される", () => {
    log(ACTION_TYPES.TASK_STARTED, { task_id: "t1" });
    log(ACTION_TYPES.TASK_COMPLETED, { task_id: "t1" });
    expect(getLog()).toHaveLength(2);
  });

  test("metadata 省略時は空オブジェクト", () => {
    const entry = log(ACTION_TYPES.TASK_DELETED);
    expect(entry.metadata).toEqual({});
  });

  test("未知の action_type はエラーを投げる", () => {
    expect(() =>
      // @ts-expect-error ランタイムバリデーションをテストする
      log("unknown_type", {}),
    ).toThrow(/unknown action_type/i);
  });

  test("Supabase action_logs に user_id / action_type / metadata / actor_type を insert する", async () => {
    log(ACTION_TYPES.TASK_REORDERED, {
      task_id: "t1",
      from_position: 0,
      to_position: 2,
    });
    await flushMicrotasks();
    expect(fromMock).toHaveBeenCalledWith("action_logs");
    expect(insertMock).toHaveBeenCalledWith({
      user_id: "user-1",
      action_type: "task_reordered",
      task_id: "t1",
      metadata: { task_id: "t1", from_position: 0, to_position: 2 },
      actor_type: "user",
    });
  });

  // action_logs.task_id → tasks.id の FK は ON DELETE SET NULL なので、
  // 削除済み task を column 値に書こうとすると INSERT 自体が落ちる
  // (logger は fire-and-forget なので「ログ欠損」として黙って消える)。
  // task_deleted は metadata.task_id を一次の真実として残しつつ column は
  // null で書く。
  test("task_deleted は column.task_id を null にして insert する (FK 違反回避)", async () => {
    log(ACTION_TYPES.TASK_DELETED, {
      task_id: "deleted-task",
      snapshot: {
        title: "old title",
        estimated_minutes: 30,
        task_category: "coding",
        status: "idle",
        parent_task_id: null,
        was_decomposition_child: false,
      },
    });
    await flushMicrotasks();
    expect(insertMock).toHaveBeenCalledWith({
      user_id: "user-1",
      action_type: "task_deleted",
      task_id: null,
      metadata: {
        task_id: "deleted-task",
        snapshot: {
          title: "old title",
          estimated_minutes: 30,
          task_category: "coding",
          status: "idle",
          parent_task_id: null,
          was_decomposition_child: false,
        },
      },
      actor_type: "user",
    });
  });

  test("未ログイン時は insert をスキップする", async () => {
    getUserMock.mockResolvedValueOnce({ data: { user: null }, error: null });
    log(ACTION_TYPES.TASK_COMPLETED, { task_id: "t1" });
    await flushMicrotasks();
    expect(insertMock).not.toHaveBeenCalled();
  });

  test("fire-and-forget: log() 自体は同期的に返る", () => {
    // insert を pending のままにしても log() は即座に返る
    insertMock.mockImplementationOnce(() => new Promise(() => {}));
    const before = Date.now();
    log(ACTION_TYPES.TASK_COMPLETED, { task_id: "t1" });
    expect(Date.now() - before).toBeLessThan(50);
  });
});

describe("getLog()", () => {
  beforeEach(() => {
    clearLog();
    __resetLoggerClientForTest();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("内部配列の防御的コピーを返す（外部変更が影響しない）", () => {
    log(ACTION_TYPES.TASK_COMPLETED, { task_id: "t1" });
    const snapshot = getLog();
    snapshot.push({
      action_type: "task_deleted",
      metadata: {
        task_id: "fake",
        snapshot: {
          title: "fake",
          estimated_minutes: null,
          task_category: null,
          status: "idle",
          parent_task_id: null,
        },
      },
      created_at: "fake",
    });
    expect(getLog()).toHaveLength(1);
  });
});

describe("clearLog()", () => {
  beforeEach(() => {
    __resetLoggerClientForTest();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("ログをすべて消去する", () => {
    log(ACTION_TYPES.TASK_COMPLETED, { task_id: "t1" });
    log(ACTION_TYPES.TASK_STARTED, { task_id: "t2" });
    clearLog();
    expect(getLog()).toHaveLength(0);
  });
});

describe("ACTION_TYPES", () => {
  test("Phase 1 / Phase 2 / Phase 3 / calendar 拡張の action_type をすべて含む", () => {
    expect(ACTION_TYPES).toEqual({
      TASK_STARTED: "task_started",
      TASK_PAUSED: "task_paused",
      TASK_RESUMED: "task_resumed",
      TASK_COMPLETED: "task_completed",
      TASK_REORDERED: "task_reordered",
      TASK_DELETED: "task_deleted",
      TASK_TITLE_CHANGED: "task_title_changed",
      TASK_CATEGORY_CHANGED: "task_category_changed",
      TASK_PROJECT_CHANGED: "task_project_changed",
      TASK_DEPENDENCY_SET: "task_dependency_set",
      TASK_DEPENDENCY_CLEARED: "task_dependency_cleared",
      INTERRUPTION_PUSHED: "interruption_pushed",
      INTERRUPTION_COMPLETED: "interruption_completed",
      STACK_PROPOSED: "stack_proposed",
      STACK_PROPOSAL_ACCEPTED: "stack_proposal_accepted",
      CALENDAR_SYNCED: "calendar_synced",
      TASK_DECOMPOSED: "task_decomposed",
      TASK_DECOMPOSE_FAILED: "task_decompose_failed",
      TASK_DECOMPOSE_SKIPPED: "task_decompose_skipped",
      TASK_CHILD_RESPLIT: "task_child_resplit",
      DECOMPOSITION_MODIFIED: "decomposition_modified",
      CALENDAR_SUBSCRIBED: "calendar_subscribed",
      CALENDAR_UNSUBSCRIBED: "calendar_unsubscribed",
      CALENDAR_AUTO_PROMOTE_CHANGED: "calendar_auto_promote_changed",
      EVENT_PROMOTED: "event_promoted",
      EVENT_DEMOTED: "event_demoted",
      EVENT_OVERRIDE_CLEARED: "event_override_cleared",
      EVENT_VISIBILITY_RULE_ADDED: "event_visibility_rule_added",
      EVENT_VISIBILITY_RULE_REMOVED: "event_visibility_rule_removed",
      EXTERNAL_ACCOUNT_ADDED: "external_account_added",
      EXTERNAL_ACCOUNT_REMOVED: "external_account_removed",
      EVENT_VISIBILITY_FROZEN_BY_SUBSCRIPTION_TOGGLE:
        "event_visibility_frozen_by_subscription_toggle",
      EVENT_DELETED_BY_SOURCE: "event_deleted_by_source",
      TASK_EVENT_DEPENDENCY_LOST: "task_event_dependency_lost",
      EXTERNAL_ACCOUNT_REAUTH_REQUIRED: "external_account_reauth_required",
    });
  });
});

describe("log(task_decomposed)", () => {
  beforeEach(() => {
    clearLog();
    __resetLoggerClientForTest();
    insertMock.mockClear();
    fromMock.mockClear();
    getUserMock.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("親の task_id を column に書き、metadata に child_ids と raw_response を含める (ADR 0021)", async () => {
    log(ACTION_TYPES.TASK_DECOMPOSED, {
      task_id: "parent-1",
      child_ids: ["child-a", "child-b"],
      raw_response: '[{"title":"a"},{"title":"b"}]',
    });
    await flushMicrotasks();
    expect(insertMock).toHaveBeenCalledWith({
      user_id: "user-1",
      action_type: "task_decomposed",
      task_id: "parent-1",
      metadata: {
        task_id: "parent-1",
        child_ids: ["child-a", "child-b"],
        raw_response: '[{"title":"a"},{"title":"b"}]',
      },
      actor_type: "user",
    });
  });
});

describe("log(task_decompose_failed)", () => {
  beforeEach(() => {
    clearLog();
    __resetLoggerClientForTest();
    insertMock.mockClear();
    fromMock.mockClear();
    getUserMock.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ADR 0021: AI 分解の失敗種別ごとに reason を機械可読タグで残し、詳細パネル (P3-15) で
  // recovery 文言を出すための一次データ。raw_response は generate が応答を返した後に
  // 失敗した場合のみ存在する (quota / network 等で generate 自体が throw した場合は無し)。
  test("metadata に reason / raw_response / error_message を含めて insert する", async () => {
    log(ACTION_TYPES.TASK_DECOMPOSE_FAILED, {
      task_id: "parent-1",
      reason: "ai_response_unparseable",
      raw_response: "I cannot decompose this",
    });
    await flushMicrotasks();
    expect(insertMock).toHaveBeenCalledWith({
      user_id: "user-1",
      action_type: "task_decompose_failed",
      task_id: "parent-1",
      metadata: {
        task_id: "parent-1",
        reason: "ai_response_unparseable",
        raw_response: "I cannot decompose this",
      },
      actor_type: "user",
    });
  });

  test("quota_exhausted: raw_response 無し、error_message 有りで insert する", async () => {
    log(ACTION_TYPES.TASK_DECOMPOSE_FAILED, {
      task_id: "parent-1",
      reason: "quota_exhausted",
      error_message: "RESOURCE_EXHAUSTED",
    });
    await flushMicrotasks();
    expect(insertMock).toHaveBeenCalledWith({
      user_id: "user-1",
      action_type: "task_decompose_failed",
      task_id: "parent-1",
      metadata: {
        task_id: "parent-1",
        reason: "quota_exhausted",
        error_message: "RESOURCE_EXHAUSTED",
      },
      actor_type: "user",
    });
  });
});

describe("log(task_decompose_skipped)", () => {
  beforeEach(() => {
    clearLog();
    __resetLoggerClientForTest();
    insertMock.mockClear();
    fromMock.mockClear();
    getUserMock.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("metadata に raw_response を含めて insert する (= AI が分解不要と判断した根拠)", async () => {
    log(ACTION_TYPES.TASK_DECOMPOSE_SKIPPED, {
      task_id: "parent-1",
      raw_response: "[]",
    });
    await flushMicrotasks();
    expect(insertMock).toHaveBeenCalledWith({
      user_id: "user-1",
      action_type: "task_decompose_skipped",
      task_id: "parent-1",
      metadata: { task_id: "parent-1", raw_response: "[]" },
      actor_type: "user",
    });
  });
});

describe("log(task_child_resplit)", () => {
  beforeEach(() => {
    clearLog();
    __resetLoggerClientForTest();
    insertMock.mockClear();
    fromMock.mockClear();
    getUserMock.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ADR 0030: 子の再分解時、column.task_id は新規子のうち先頭 (= 主体行)。
  // 削除された子の属性は metadata.resplit_target_snapshot に inline で保存し、
  // Phase 4 の暗黙フィードバック分析で「ユーザーが粒度を変えた」シグナルとして使う。
  test("metadata に parent_id / resplit_target_snapshot / new_child_ids / raw_response を含めて insert する", async () => {
    log(ACTION_TYPES.TASK_CHILD_RESPLIT, {
      task_id: "new-child-1",
      parent_id: "parent-1",
      resplit_target_snapshot: {
        id: "deleted-child",
        title: "本文を書く",
        body: "",
        estimated_minutes: 30,
        task_category: "doc",
        task_size: "30m",
        created_at: "2026-04-30T10:00:00.000Z",
        source_decomposition_log_id: "decompose-log-1",
      },
      new_child_ids: ["new-child-1", "new-child-2", "new-child-3"],
      raw_response: '[{"title":"導入部の構成"},{"title":"本文を書く"},{"title":"最終確認"}]',
    });
    await flushMicrotasks();
    expect(insertMock).toHaveBeenCalledWith({
      user_id: "user-1",
      action_type: "task_child_resplit",
      task_id: "new-child-1",
      metadata: {
        task_id: "new-child-1",
        parent_id: "parent-1",
        resplit_target_snapshot: {
          id: "deleted-child",
          title: "本文を書く",
          body: "",
          estimated_minutes: 30,
          task_category: "doc",
          task_size: "30m",
          created_at: "2026-04-30T10:00:00.000Z",
          source_decomposition_log_id: "decompose-log-1",
        },
        new_child_ids: ["new-child-1", "new-child-2", "new-child-3"],
        raw_response: '[{"title":"導入部の構成"},{"title":"本文を書く"},{"title":"最終確認"}]',
      },
      actor_type: "user",
    });
  });
});

describe("log(decomposition_modified)", () => {
  beforeEach(() => {
    clearLog();
    __resetLoggerClientForTest();
    insertMock.mockClear();
    fromMock.mockClear();
    getUserMock.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 対象 task は削除済みのケース (child_deleted / parent_merged) があるので
  // FK 違反を避けて column.task_id は null にする。metadata 側に親子両方を残す。
  test("column.task_id は null、metadata に task_id / parent_id / kind を含める", async () => {
    log(ACTION_TYPES.DECOMPOSITION_MODIFIED, {
      task_id: "child-a",
      parent_id: "parent-1",
      kind: "child_deleted",
    });
    await flushMicrotasks();
    expect(insertMock).toHaveBeenCalledWith({
      user_id: "user-1",
      action_type: "decomposition_modified",
      task_id: null,
      metadata: { task_id: "child-a", parent_id: "parent-1", kind: "child_deleted" },
      actor_type: "user",
    });
  });
});

describe("log(task_category_changed)", () => {
  beforeEach(() => {
    clearLog();
    __resetLoggerClientForTest();
    insertMock.mockClear();
    fromMock.mockClear();
    getUserMock.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("AI 初期ラベル無し (from=null) → user 選択 (to) を insert する", async () => {
    log(ACTION_TYPES.TASK_CATEGORY_CHANGED, {
      task_id: "t1",
      from: null,
      to: "coding",
    });
    await flushMicrotasks();
    expect(insertMock).toHaveBeenCalledWith({
      user_id: "user-1",
      action_type: "task_category_changed",
      task_id: "t1",
      metadata: { task_id: "t1", from: null, to: "coding" },
      actor_type: "user",
    });
  });

  test("AI ラベル → user override (from / to あり) を insert する", async () => {
    log(ACTION_TYPES.TASK_CATEGORY_CHANGED, {
      task_id: "t1",
      from: "doc",
      to: "research",
    });
    await flushMicrotasks();
    expect(insertMock).toHaveBeenCalledWith({
      user_id: "user-1",
      action_type: "task_category_changed",
      task_id: "t1",
      metadata: { task_id: "t1", from: "doc", to: "research" },
      actor_type: "user",
    });
  });
});

describe("log(calendar_synced)", () => {
  beforeEach(() => {
    clearLog();
    __resetLoggerClientForTest();
    insertMock.mockClear();
    fromMock.mockClear();
    getUserMock.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("metadata に synced / deleted / trigger を含めて insert する (task_id は null)", async () => {
    log(ACTION_TYPES.CALENDAR_SYNCED, {
      synced: 5,
      deleted: 1,
      trigger: "manual",
    });
    await flushMicrotasks();
    expect(insertMock).toHaveBeenCalledWith({
      user_id: "user-1",
      action_type: "calendar_synced",
      task_id: null,
      metadata: { synced: 5, deleted: 1, trigger: "manual" },
      actor_type: "user",
    });
  });
});
