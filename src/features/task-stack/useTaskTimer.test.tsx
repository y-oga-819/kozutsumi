import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// logger はモジュールレベル singleton で Gateway 経由で差し替えできないため、
// 従来どおり vi.mock で差し替える（本スコープ外、#47 デモモード着手時に再評価）。
const mocks = vi.hoisted(() => ({
  log: vi.fn(),
}));

vi.mock("@/entities/action-log/logger", () => ({
  ACTION_TYPES: Object.freeze({
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
  }),
  log: mocks.log,
}));

const { log: logMock } = mocks;

import { act, renderHook, waitFor } from "@testing-library/react";

import type { TaskGateway } from "@/entities/task/gateway";
import type { TaskTimeEntryGateway } from "@/entities/task/time-entry-gateway";
import type { Task } from "@/entities/task/types";
import { withGateways } from "@/shared/gateway/test-helpers";

import { formatElapsed, useTaskTimer } from "./useTaskTimer";

const baseTask: Task = {
  id: "t1",
  projectId: "p1",
  title: "タスクA",
  body: "",
  estimatedMinutes: 30,
  status: "idle",
  stackOrder: 0,
  dependsOnEventId: null,
  isInterruption: false,
  parentTaskId: null,
  decomposeStatus: "none",
  taskCategory: null,
  taskSize: null,
  createdAt: "2026-04-19T09:00:00.000Z",
  completedAt: null,
};

type TimerMocks = {
  update: ReturnType<typeof vi.fn>;
  list: ReturnType<typeof vi.fn>;
  getOpen: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
};

function makeTimerMocks(): TimerMocks {
  return {
    update: vi.fn().mockResolvedValue({}),
    list: vi.fn().mockResolvedValue([]),
    getOpen: vi.fn().mockResolvedValue(null),
    start: vi.fn().mockResolvedValue({
      id: "te-new",
      taskId: "t1",
      startedAt: "2026-04-19T10:00:00.000Z",
      pausedAt: null,
      pauseReason: null,
      durationSeconds: null,
    }),
    close: vi.fn().mockImplementation(async (entry, reason) => ({
      ...(entry as Record<string, unknown>),
      pausedAt: "2026-04-19T10:01:00.000Z",
      pauseReason: reason ?? null,
      durationSeconds: 60,
    })),
  };
}

function wrapTimer(m: TimerMocks) {
  const taskGateway: Partial<TaskGateway> = {
    update: m.update as unknown as TaskGateway["update"],
  };
  const taskTimeEntryGateway: Partial<TaskTimeEntryGateway> = {
    list: m.list as unknown as TaskTimeEntryGateway["list"],
    getOpen: m.getOpen as unknown as TaskTimeEntryGateway["getOpen"],
    start: m.start as unknown as TaskTimeEntryGateway["start"],
    close: m.close as unknown as TaskTimeEntryGateway["close"],
  };
  return withGateways({ taskGateway, taskTimeEntryGateway });
}

describe("useTaskTimer", () => {
  let m: TimerMocks;
  beforeEach(() => {
    logMock.mockReset();
    m = makeTimerMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("task=null のとき start/pause/resume/complete は no-op", async () => {
    const { Wrapper } = wrapTimer(m);
    const { result } = renderHook(() => useTaskTimer(null), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.start();
      await result.current.pause("voluntary");
      await result.current.resume();
      await result.current.complete();
    });
    expect(m.start).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
    expect(logMock).not.toHaveBeenCalled();
  });

  test("start: open entry なし → 新規 entry 作成 + status=active + TASK_STARTED ログ", async () => {
    m.getOpen.mockResolvedValueOnce(null);
    const { Wrapper } = wrapTimer(m);
    const { result } = renderHook(() => useTaskTimer(baseTask), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.start();
    });
    expect(m.getOpen).toHaveBeenCalledWith("t1");
    expect(m.close).not.toHaveBeenCalled();
    expect(m.start).toHaveBeenCalledWith("t1");
    expect(m.update).toHaveBeenCalledWith("t1", { status: "active" });
    expect(logMock).toHaveBeenCalledWith("task_started", { task_id: "t1" });
  });

  test("start: 既存 open entry を voluntary で閉じてから start (後勝ち)", async () => {
    const existing = {
      id: "te-old",
      taskId: "t1",
      startedAt: "2026-04-19T09:00:00.000Z",
      pausedAt: null,
      pauseReason: null,
      durationSeconds: null,
    };
    m.getOpen.mockResolvedValueOnce(existing);
    const { Wrapper } = wrapTimer(m);
    const { result } = renderHook(() => useTaskTimer(baseTask), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.start();
    });
    expect(m.close).toHaveBeenCalledWith(existing, "voluntary");
    expect(m.start).toHaveBeenCalled();
  });

  test("pause: open entry を reason 付きで閉じ、status=paused、TASK_PAUSED ログ", async () => {
    const open = {
      id: "te-open",
      taskId: "t1",
      startedAt: "2026-04-19T10:00:00.000Z",
      pausedAt: null,
      pauseReason: null,
      durationSeconds: null,
    };
    m.list.mockResolvedValue([open]);
    m.getOpen.mockResolvedValue(open);
    const activeTask: Task = { ...baseTask, status: "active" };
    const { Wrapper } = wrapTimer(m);
    const { result } = renderHook(() => useTaskTimer(activeTask), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.pause("meeting");
    });
    expect(m.close).toHaveBeenCalledWith(open, "meeting");
    expect(m.update).toHaveBeenCalledWith("t1", { status: "paused" });
    expect(logMock).toHaveBeenCalledWith("task_paused", {
      task_id: "t1",
      pause_reason: "meeting",
    });
  });

  test("resume: 新規 entry 作成 + status=active + TASK_RESUMED ログ", async () => {
    const pausedTask: Task = { ...baseTask, status: "paused" };
    const { Wrapper } = wrapTimer(m);
    const { result } = renderHook(() => useTaskTimer(pausedTask), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.resume();
    });
    expect(m.start).toHaveBeenCalledWith("t1");
    expect(m.update).toHaveBeenCalledWith("t1", { status: "active" });
    expect(logMock).toHaveBeenCalledWith("task_resumed", { task_id: "t1" });
  });

  test("complete: open entry を閉じ、actual_minutes を含む TASK_COMPLETED を記録", async () => {
    const open = {
      id: "te-open",
      taskId: "t1",
      startedAt: "2026-04-19T10:00:00.000Z",
      pausedAt: null,
      pauseReason: null,
      durationSeconds: null,
    };
    m.list.mockResolvedValue([{ ...open, pausedAt: "x", durationSeconds: 180 }]);
    m.getOpen.mockResolvedValue(open);
    const activeTask: Task = { ...baseTask, status: "active" };
    const { Wrapper } = wrapTimer(m);
    const { result } = renderHook(() => useTaskTimer(activeTask), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.complete();
    });
    expect(m.close).toHaveBeenCalledWith(open, null);
    expect(m.update).toHaveBeenCalledWith(
      "t1",
      expect.objectContaining({
        status: "done",
        completedAt: expect.any(String),
      }),
    );
    expect(logMock).toHaveBeenCalledWith("task_completed", {
      task_id: "t1",
      estimated_minutes: 30,
      actual_minutes: 3,
    });
  });

  test("リロード復元: paused タスクの最終 pause_reason を pauseReason で返す", async () => {
    m.list.mockResolvedValue([
      {
        id: "1",
        taskId: "t1",
        startedAt: "2026-04-19T10:00:00.000Z",
        pausedAt: "2026-04-19T10:01:00.000Z",
        pauseReason: "interruption",
        durationSeconds: 60,
      },
    ]);
    const pausedTask: Task = { ...baseTask, status: "paused" };
    const { Wrapper } = wrapTimer(m);
    const { result } = renderHook(() => useTaskTimer(pausedTask), {
      wrapper: Wrapper,
    });
    await waitFor(() => {
      expect(result.current.pauseReason).toBe("interruption");
    });
    expect(result.current.isPaused).toBe(true);
    expect(result.current.isActive).toBe(false);
    expect(result.current.elapsedSeconds).toBe(60);
  });
});

describe("formatElapsed", () => {
  test("60秒未満は MM:SS", () => {
    expect(formatElapsed(45)).toBe("00:45");
  });
  test("60秒以上 1時間未満も MM:SS", () => {
    expect(formatElapsed(125)).toBe("02:05");
  });
  test("1時間以上は H:MM:SS", () => {
    expect(formatElapsed(3661)).toBe("1:01:01");
  });
  test("負数は 00:00 にクランプ", () => {
    expect(formatElapsed(-5)).toBe("00:00");
  });
});
