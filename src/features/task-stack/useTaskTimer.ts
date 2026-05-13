"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";

import { ACTION_TYPES, log } from "@/entities/action-log/logger";
import { type PauseReason, sumDurationSeconds, type TimeEntry } from "@/entities/task/time-entries";
import type { Task } from "@/entities/task/types";
import { useTaskGateway, useTaskTimeEntryGateway } from "@/shared/gateway/GatewayContext";

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
  /**
   * ADR-0059: 1-tap 割り込み。pause と同じ状態遷移 (active → paused) を踏むが、
   * reason 選択モーダルを挟まず、time_entries は `pause_reason="interruption"`
   * で閉じる。action_log は `task_paused` ではなく `task_interrupted` を 1 件
   * だけ落とし、1 タップ操作だったことを後段の朝の棚卸し / 行動分析が識別できる
   * ようにする (= 同じ pause_reason="interruption" でも、モーダル経由の中断と
   * 1-tap 割り込みは action_log 上で区別される)。
   */
  interrupt: () => Promise<void>;
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
  const taskGateway = useTaskGateway();
  const taskTimeEntryGateway = useTaskTimeEntryGateway();
  const queryClient = useQueryClient();
  const taskId = task?.id ?? null;

  const entriesQuery = useQuery({
    queryKey: taskId ? timeEntriesKey(taskId) : ["time-entries", "none"],
    queryFn: () => (taskId ? taskTimeEntryGateway.list(taskId) : Promise.resolve([])),
    enabled: taskId !== null,
  });

  const entries = useMemo(() => entriesQuery.data ?? [], [entriesQuery.data]);
  const openEntry = useMemo(() => entries.find((e) => e.pausedAt === null) ?? null, [entries]);

  const isActive = task?.status === "active";
  const isPaused = task?.status === "paused";
  const isRunning = isActive && openEntry !== null;

  // アクティブな間は 1 秒間隔で再描画する。停止中は interval を張らない。
  // タブが background で setInterval が throttle された場合、foreground 復帰時に
  // visibilitychange で即時 tick して表示を最新に追従させる (#153)。
  const [tickMs, setTickMs] = useState<number>(() => Date.now());
  useEffect(() => {
    if (!isRunning) return;
    const tick = () => setTickMs(Date.now());
    const id = window.setInterval(tick, 1000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isRunning]);

  const elapsedSeconds = useMemo(() => sumDurationSeconds(entries, tickMs), [entries, tickMs]);

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
    const existingOpen = await taskTimeEntryGateway.getOpen(task.id);
    if (existingOpen) {
      await taskTimeEntryGateway.close(existingOpen, "voluntary");
    }
    await taskTimeEntryGateway.start(task.id);
    await taskGateway.update(task.id, { status: "active" });
    log(ACTION_TYPES.TASK_STARTED, { task_id: task.id });
    await invalidate();
  }, [task, taskGateway, taskTimeEntryGateway, invalidate]);

  const pause = useCallback(
    async (reason: PauseReason) => {
      if (!task) return;
      const open = openEntry ?? (await taskTimeEntryGateway.getOpen(task.id));
      if (open) {
        await taskTimeEntryGateway.close(open, reason);
      }
      await taskGateway.update(task.id, { status: "paused" });
      log(ACTION_TYPES.TASK_PAUSED, {
        task_id: task.id,
        pause_reason: reason,
      });
      await invalidate();
    },
    [task, openEntry, taskGateway, taskTimeEntryGateway, invalidate],
  );

  const interrupt = useCallback(async () => {
    if (!task) return;
    const open = openEntry ?? (await taskTimeEntryGateway.getOpen(task.id));
    if (open) {
      await taskTimeEntryGateway.close(open, "interruption");
    }
    await taskGateway.update(task.id, { status: "paused" });
    // ADR-0059: 1-tap 割り込みは task_paused を打たず task_interrupted のみ。
    // state 遷移 (active → paused) は task_time_entries.paused_at と
    // tasks.status で再構成可能なので、action_log では「1-tap だった」事実だけを残す。
    log(ACTION_TYPES.TASK_INTERRUPTED, { task_id: task.id });
    await invalidate();
  }, [task, openEntry, taskGateway, taskTimeEntryGateway, invalidate]);

  const resume = useCallback(async () => {
    if (!task) return;
    await taskTimeEntryGateway.start(task.id);
    await taskGateway.update(task.id, { status: "active" });
    log(ACTION_TYPES.TASK_RESUMED, { task_id: task.id });
    await invalidate();
  }, [task, taskGateway, taskTimeEntryGateway, invalidate]);

  const complete = useCallback(async () => {
    if (!task) return;
    const open = openEntry ?? (await taskTimeEntryGateway.getOpen(task.id));
    if (open) {
      // 完了時の close は pause ではないので pause_reason = null
      await taskTimeEntryGateway.close(open, null);
    }
    // 合計実績を最新 entries から計算する (複数 entry の合計)
    const finalEntries = await taskTimeEntryGateway.list(task.id);
    const totalSeconds = sumDurationSeconds(finalEntries);
    const actualMinutes = Math.round(totalSeconds / 60);
    await taskGateway.update(task.id, {
      status: "done",
      completedAt: new Date().toISOString(),
    });
    log(ACTION_TYPES.TASK_COMPLETED, {
      task_id: task.id,
      estimated_minutes: task.estimatedMinutes ?? undefined,
      actual_minutes: actualMinutes,
    });
    await invalidate();
  }, [task, openEntry, taskGateway, taskTimeEntryGateway, invalidate]);

  // 戻り値の参照を安定化させ、呼び出し側で [timer] を依存にした useMemo / useCallback が
  // 機能するようにする。これがないと毎レンダーで新オブジェクトになり memo が効かない。
  return useMemo(
    () => ({
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
      interrupt,
    }),
    [
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
      interrupt,
    ],
  );
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
