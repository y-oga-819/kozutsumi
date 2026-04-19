"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ACTION_TYPES, log } from "@/entities/action-log/logger";
import { updateTask as apiUpdateTask } from "@/entities/task/api";
import {
  closeTimeEntry,
  getOpenTimeEntry,
  listTimeEntries,
  type PauseReason,
  startTimeEntry,
  sumDurationSeconds,
  type TimeEntry,
} from "@/entities/task/time-entries";
import type { Task } from "@/entities/task/types";
import { createClient } from "@/shared/supabase/client";

export const TASKS_QUERY_KEY = ["tasks"] as const;

export function timeEntriesKey(taskId: string) {
  return ["time-entries", taskId] as const;
}

type TaskTimerApi = {
  isActive: boolean;
  isPaused: boolean;
  isRunning: boolean;
  elapsedSeconds: number;
  pauseReason: PauseReason | null;
  entries: readonly TimeEntry[];
  start: () => Promise<void>;
  pause: (reason: PauseReason) => Promise<void>;
  resume: () => Promise<void>;
  complete: () => Promise<void>;
};

/**
 * タスクのタイマー状態を管理する hook。
 *
 * 状態は DB (tasks.status / task_time_entries) が正とし、
 * - リロード時: task.status と open entry の有無から復元
 * - 複数タブで同時に start された場合: 後勝ち (既存 open entry を voluntary で閉じる)
 *   — ADR 0004 を参照
 *
 * タイマーは 1 秒ごとに tick し、open entry の経過秒数と閉じた entry の
 * duration_seconds の合計を elapsedSeconds として返す。
 */
export function useTaskTimer(task: Task | null): TaskTimerApi {
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const taskId = task?.id ?? null;

  const entriesQuery = useQuery({
    queryKey: taskId ? timeEntriesKey(taskId) : ["time-entries", "none"],
    queryFn: () =>
      taskId ? listTimeEntries(supabase, taskId) : Promise.resolve([]),
    enabled: taskId !== null,
  });

  const entries = useMemo(() => entriesQuery.data ?? [], [entriesQuery.data]);
  const openEntry = useMemo(
    () => entries.find((e) => e.pausedAt === null) ?? null,
    [entries],
  );

  const isActive = task?.status === "active";
  const isPaused = task?.status === "paused";
  const isRunning = isActive && openEntry !== null;

  // アクティブな間は 1 秒間隔で再描画する。停止中は interval を張らない。
  const [tickMs, setTickMs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!isRunning) return;
    const id = window.setInterval(() => setTickMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [isRunning]);

  const elapsedSeconds = useMemo(
    () => sumDurationSeconds(entries, tickMs),
    [entries, tickMs],
  );

  const pauseReason = useMemo<PauseReason | null>(() => {
    if (!isPaused) return null;
    for (let i = entries.length - 1; i >= 0; i--) {
      const r = entries[i].pauseReason;
      if (r) return r;
    }
    return null;
  }, [entries, isPaused]);

  const invalidate = useCallback(async () => {
    if (!taskId) return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: TASKS_QUERY_KEY }),
      queryClient.invalidateQueries({ queryKey: timeEntriesKey(taskId) }),
    ]);
  }, [queryClient, taskId]);

  const start = useCallback(async () => {
    if (!task) return;
    // 別タブなどで残存している open entry を voluntary で閉じる (後勝ち)
    const existingOpen = await getOpenTimeEntry(supabase, task.id);
    if (existingOpen) {
      await closeTimeEntry(supabase, existingOpen, "voluntary");
    }
    await startTimeEntry(supabase, task.id);
    await apiUpdateTask(supabase, task.id, { status: "active" });
    log(ACTION_TYPES.TASK_STARTED, { task_id: task.id });
    await invalidate();
  }, [supabase, task, invalidate]);

  const pause = useCallback(
    async (reason: PauseReason) => {
      if (!task) return;
      const open = openEntry ?? (await getOpenTimeEntry(supabase, task.id));
      if (open) {
        await closeTimeEntry(supabase, open, reason);
      }
      await apiUpdateTask(supabase, task.id, { status: "paused" });
      log(ACTION_TYPES.TASK_PAUSED, {
        task_id: task.id,
        pause_reason: reason,
      });
      await invalidate();
    },
    [supabase, task, openEntry, invalidate],
  );

  const resume = useCallback(async () => {
    if (!task) return;
    await startTimeEntry(supabase, task.id);
    await apiUpdateTask(supabase, task.id, { status: "active" });
    log(ACTION_TYPES.TASK_RESUMED, { task_id: task.id });
    await invalidate();
  }, [supabase, task, invalidate]);

  const complete = useCallback(async () => {
    if (!task) return;
    const open = openEntry ?? (await getOpenTimeEntry(supabase, task.id));
    if (open) {
      // 完了時の close は pause ではないので pause_reason = null
      await closeTimeEntry(supabase, open, null);
    }
    // 合計実績を最新 entries から計算する (複数 entry の合計)
    const finalEntries = await listTimeEntries(supabase, task.id);
    const totalSeconds = sumDurationSeconds(finalEntries);
    const actualMinutes = Math.round(totalSeconds / 60);
    await apiUpdateTask(supabase, task.id, {
      status: "done",
      completedAt: new Date().toISOString(),
    });
    log(ACTION_TYPES.TASK_COMPLETED, {
      task_id: task.id,
      estimated_minutes: task.estimatedMinutes ?? undefined,
      actual_minutes: actualMinutes,
    });
    await invalidate();
  }, [supabase, task, openEntry, invalidate]);

  return {
    isActive,
    isPaused,
    isRunning,
    elapsedSeconds,
    pauseReason,
    entries,
    start,
    pause,
    resume,
    complete,
  };
}

/** "HH:MM:SS" または "MM:SS" に整形する。 */
export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  if (h > 0) return `${h}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}
