import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

// supabase / api / logger を hook より前にモックする。
// vi.mock は hoist されるので、module-scope の const は vi.hoisted で用意する。
const mocks = vi.hoisted(() => ({
  startTimeEntry: vi.fn(),
  closeTimeEntry: vi.fn(),
  getOpenTimeEntry: vi.fn(),
  listTimeEntries: vi.fn(),
  updateTask: vi.fn(),
  log: vi.fn(),
}));

vi.mock("@/entities/task/time-entries", async () => {
  const actual = await vi.importActual<
    typeof import("@/entities/task/time-entries")
  >("@/entities/task/time-entries");
  return {
    ...actual,
    startTimeEntry: mocks.startTimeEntry,
    closeTimeEntry: mocks.closeTimeEntry,
    getOpenTimeEntry: mocks.getOpenTimeEntry,
    listTimeEntries: mocks.listTimeEntries,
  };
});

vi.mock("@/entities/task/api", () => ({
  updateTask: mocks.updateTask,
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

vi.mock("@/shared/supabase/client", () => ({
  createClient: () => ({}),
}));

const {
  startTimeEntry: startTimeEntryMock,
  closeTimeEntry: closeTimeEntryMock,
  getOpenTimeEntry: getOpenTimeEntryMock,
  listTimeEntries: listTimeEntriesMock,
  updateTask: updateTaskMock,
  log: logMock,
} = mocks;

// hook を import (上記モックが効いた後で読み込む)
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";

import type { Task } from "@/entities/task/types";

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
  createdAt: "2026-04-19T09:00:00.000Z",
  completedAt: null,
};

function wrap() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, Wrapper };
}

describe("useTaskTimer", () => {
  beforeEach(() => {
    startTimeEntryMock.mockReset();
    closeTimeEntryMock.mockReset();
    getOpenTimeEntryMock.mockReset();
    listTimeEntriesMock.mockReset();
    updateTaskMock.mockReset();
    logMock.mockReset();
    // デフォルトは何もない状態
    startTimeEntryMock.mockResolvedValue({
      id: "te-new",
      taskId: "t1",
      startedAt: "2026-04-19T10:00:00.000Z",
      pausedAt: null,
      pauseReason: null,
      durationSeconds: null,
    });
    closeTimeEntryMock.mockImplementation(async (_sb, entry, reason) => ({
      ...(entry as Record<string, unknown>),
      pausedAt: "2026-04-19T10:01:00.000Z",
      pauseReason: reason ?? null,
      durationSeconds: 60,
    }));
    getOpenTimeEntryMock.mockResolvedValue(null);
    listTimeEntriesMock.mockResolvedValue([]);
    updateTaskMock.mockResolvedValue({});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("task=null のとき start/pause/resume/complete は no-op", async () => {
    const { Wrapper } = wrap();
    const { result } = renderHook(() => useTaskTimer(null), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.start();
      await result.current.pause("voluntary");
      await result.current.resume();
      await result.current.complete();
    });
    expect(startTimeEntryMock).not.toHaveBeenCalled();
    expect(updateTaskMock).not.toHaveBeenCalled();
    expect(logMock).not.toHaveBeenCalled();
  });

  test("start: open entry なし → 新規 entry 作成 + status=active + TASK_STARTED ログ", async () => {
    getOpenTimeEntryMock.mockResolvedValueOnce(null);
    const { Wrapper } = wrap();
    const { result } = renderHook(() => useTaskTimer(baseTask), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.start();
    });
    expect(getOpenTimeEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      "t1",
    );
    expect(closeTimeEntryMock).not.toHaveBeenCalled();
    expect(startTimeEntryMock).toHaveBeenCalledWith(expect.anything(), "t1");
    expect(updateTaskMock).toHaveBeenCalledWith(expect.anything(), "t1", {
      status: "active",
    });
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
    getOpenTimeEntryMock.mockResolvedValueOnce(existing);
    const { Wrapper } = wrap();
    const { result } = renderHook(() => useTaskTimer(baseTask), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.start();
    });
    expect(closeTimeEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      existing,
      "voluntary",
    );
    expect(startTimeEntryMock).toHaveBeenCalled();
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
    listTimeEntriesMock.mockResolvedValue([open]);
    // entriesQuery が未解決でも pause 内部の fallback (getOpenTimeEntry) で拾える
    getOpenTimeEntryMock.mockResolvedValue(open);
    const activeTask: Task = { ...baseTask, status: "active" };
    const { Wrapper } = wrap();
    const { result } = renderHook(() => useTaskTimer(activeTask), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.pause("meeting");
    });
    expect(closeTimeEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      open,
      "meeting",
    );
    expect(updateTaskMock).toHaveBeenCalledWith(expect.anything(), "t1", {
      status: "paused",
    });
    expect(logMock).toHaveBeenCalledWith("task_paused", {
      task_id: "t1",
      pause_reason: "meeting",
    });
  });

  test("resume: 新規 entry 作成 + status=active + TASK_RESUMED ログ", async () => {
    const pausedTask: Task = { ...baseTask, status: "paused" };
    const { Wrapper } = wrap();
    const { result } = renderHook(() => useTaskTimer(pausedTask), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.resume();
    });
    expect(startTimeEntryMock).toHaveBeenCalledWith(expect.anything(), "t1");
    expect(updateTaskMock).toHaveBeenCalledWith(expect.anything(), "t1", {
      status: "active",
    });
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
    // 合計 3 分 (180 秒) の履歴を返す (最終 actual_minutes = 3)
    listTimeEntriesMock.mockResolvedValue([
      { ...open, pausedAt: "x", durationSeconds: 180 },
    ]);
    getOpenTimeEntryMock.mockResolvedValue(open);
    const activeTask: Task = { ...baseTask, status: "active" };
    const { Wrapper } = wrap();
    const { result } = renderHook(() => useTaskTimer(activeTask), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.complete();
    });
    expect(closeTimeEntryMock).toHaveBeenCalledWith(
      expect.anything(),
      open,
      null,
    );
    expect(updateTaskMock).toHaveBeenCalledWith(
      expect.anything(),
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
    listTimeEntriesMock.mockResolvedValue([
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
    const { Wrapper } = wrap();
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
