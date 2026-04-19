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

import {
  ACTION_TYPES,
  __resetLoggerClientForTest,
  clearLog,
  getLog,
  log,
} from "./logger";

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

  test("Supabase action_logs に user_id / action_type / metadata を insert する", async () => {
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
      metadata: { task_id: "fake" },
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
  test("phase1.md に記載の action_type をすべて含む", () => {
    expect(ACTION_TYPES).toEqual({
      TASK_STARTED: "task_started",
      TASK_PAUSED: "task_paused",
      TASK_RESUMED: "task_resumed",
      TASK_COMPLETED: "task_completed",
      TASK_REORDERED: "task_reordered",
      TASK_DELETED: "task_deleted",
      TASK_TITLE_CHANGED: "task_title_changed",
      INTERRUPTION_PUSHED: "interruption_pushed",
      INTERRUPTION_COMPLETED: "interruption_completed",
      STACK_PROPOSED: "stack_proposed",
      STACK_PROPOSAL_ACCEPTED: "stack_proposal_accepted",
    });
  });
});
