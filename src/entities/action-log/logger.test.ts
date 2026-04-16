import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ACTION_TYPES, clearLog, getLog, log } from "./logger";

describe("log()", () => {
  beforeEach(() => {
    clearLog();
    vi.spyOn(console, "log").mockImplementation(() => {});
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
});

describe("getLog()", () => {
  beforeEach(() => {
    clearLog();
    vi.spyOn(console, "log").mockImplementation(() => {});
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
    vi.spyOn(console, "log").mockImplementation(() => {});
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
