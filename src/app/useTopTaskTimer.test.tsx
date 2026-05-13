import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// logger は useTaskTimer.test.tsx と同じ作法で差し替える。
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
    TASK_INTERRUPTED: "task_interrupted",
    STACK_PROPOSED: "stack_proposed",
    STACK_PROPOSAL_ACCEPTED: "stack_proposal_accepted",
  }),
  log: mocks.log,
}));

const { log: logMock } = mocks;

import { act, renderHook } from "@testing-library/react";

import type { TaskGateway } from "@/entities/task/gateway";
import type { TaskTimeEntryGateway } from "@/entities/task/time-entry-gateway";
import type { Task } from "@/entities/task/types";
import { withGateways } from "@/shared/gateway/test-helpers";

import { useTopTaskTimer } from "./useTopTaskTimer";

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

/**
 * ADR-0058 Decision 2「stack top が timer の current task として自動 bind される」
 * の不変条件を hook 境界で守る。AppShell.tsx は `useTopTaskTimer(pendingTasks[0] ?? null)`
 * の形で常に stack top を渡す前提。
 */
describe("useTopTaskTimer (stack top auto-bind / ADR-0058 Decision 2)", () => {
  let m: TimerMocks;
  beforeEach(() => {
    logMock.mockReset();
    m = makeTimerMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("topTask=null では動詞は no-op (gateway が呼ばれない)", async () => {
    const { Wrapper } = wrapTimer(m);
    const { result } = renderHook(() => useTopTaskTimer(null), { wrapper: Wrapper });
    await act(async () => {
      result.current.topTimer.onStart();
      result.current.topTimer.onResume();
      result.current.topTimer.onComplete();
    });
    expect(m.start).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
    expect(logMock).not.toHaveBeenCalled();
  });

  test("topTask が swap されると新 task id に対して start が発火する (auto-bind 追従)", async () => {
    const topA: Task = { ...baseTask, id: "t-A", title: "A" };
    const topB: Task = { ...baseTask, id: "t-B", title: "B" };
    const { Wrapper } = wrapTimer(m);
    const { result, rerender } = renderHook(
      ({ top }: { top: Task | null }) => useTopTaskTimer(top),
      {
        wrapper: Wrapper,
        initialProps: { top: topA as Task | null },
      },
    );

    await act(async () => {
      result.current.topTimer.onStart();
    });
    expect(m.start).toHaveBeenLastCalledWith("t-A");

    // stack 並び替えで top が変わったケースを模擬する: AppShell は pendingTasks[0]
    // の差し替えで topTask 引数を更新するだけ。timer subject はそれに従う。
    rerender({ top: topB });
    await act(async () => {
      result.current.topTimer.onStart();
    });
    expect(m.start).toHaveBeenLastCalledWith("t-B");
    expect(m.update).toHaveBeenLastCalledWith("t-B", { status: "active" });
  });

  test("topTask が null に戻ると以後の動詞は no-op (stack が空のケース)", async () => {
    const top: Task = { ...baseTask, id: "t-A" };
    const { Wrapper } = wrapTimer(m);
    const { result, rerender } = renderHook(
      ({ top }: { top: Task | null }) => useTopTaskTimer(top),
      {
        wrapper: Wrapper,
        initialProps: { top: top as Task | null },
      },
    );

    await act(async () => {
      result.current.topTimer.onStart();
    });
    expect(m.start).toHaveBeenCalledTimes(1);

    rerender({ top: null });
    await act(async () => {
      result.current.topTimer.onStart();
      result.current.topTimer.onResume();
      result.current.topTimer.onComplete();
    });
    // null 後に動詞を叩いても新たな gateway 呼び出しは増えない。
    expect(m.start).toHaveBeenCalledTimes(1);
  });

  test("onPauseRequest は modal を開くだけで pause gateway を呼ばない (3 動詞 + reason capture; ADR-0058 Decision 1)", () => {
    const { Wrapper } = wrapTimer(m);
    const { result } = renderHook(() => useTopTaskTimer({ ...baseTask, status: "active" }), {
      wrapper: Wrapper,
    });
    act(() => {
      result.current.topTimer.onPauseRequest();
    });
    expect(result.current.pauseModalOpen).toBe(true);
    expect(m.close).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });

  // ADR-0065: source 別 1-tap 割り込みは PauseReasonModal を一切経由しない。
  // timer.interrupt(source) が直接走り、open entry を "interruption" で close、
  // action_log は task_interrupted + metadata.source を残す。
  test("onInterrupt(source) は modal を開かず、interruption で entry を close + task_interrupted を log する", async () => {
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
    const { Wrapper } = wrapTimer(m);
    const { result } = renderHook(() => useTopTaskTimer({ ...baseTask, status: "active" }), {
      wrapper: Wrapper,
    });
    await act(async () => {
      result.current.topTimer.onInterrupt("slack");
    });
    expect(result.current.pauseModalOpen).toBe(false);
    expect(m.close).toHaveBeenCalledWith(open, "interruption");
    expect(m.update).toHaveBeenCalledWith("t1", { status: "paused" });
    expect(logMock).toHaveBeenCalledWith("task_interrupted", {
      task_id: "t1",
      source: "slack",
    });
  });

  test("handlePauseSelect で modal を閉じ、選んだ reason で pause を発火する", async () => {
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
    const { Wrapper } = wrapTimer(m);
    const { result } = renderHook(() => useTopTaskTimer({ ...baseTask, status: "active" }), {
      wrapper: Wrapper,
    });
    act(() => {
      result.current.topTimer.onPauseRequest();
    });
    expect(result.current.pauseModalOpen).toBe(true);
    await act(async () => {
      result.current.handlePauseSelect("meeting");
    });
    expect(result.current.pauseModalOpen).toBe(false);
    expect(m.close).toHaveBeenCalledWith(open, "meeting");
    expect(m.update).toHaveBeenCalledWith("t1", { status: "paused" });
  });
});
