"use client";

import { useCallback, useMemo, useState } from "react";

import type { PauseReason } from "@/entities/task/time-entries";
import type { Task } from "@/entities/task/types";
import type { TopTimerBinding } from "@/features/task-stack/TaskStack";
import { useTaskTimer } from "@/features/task-stack/useTaskTimer";

export type UseTopTaskTimerResult = {
  /** TaskStack の TopTaskCard に渡すタイマー結線 props bundle。 */
  topTimer: TopTimerBinding;
  /** PauseReasonModal の表示状態。 */
  pauseModalOpen: boolean;
  setPauseModalOpen: (open: boolean) => void;
  /** PauseReasonModal の選択 callback。modal を閉じて pause を開始する。 */
  handlePauseSelect: (reason: PauseReason) => void;
};

/**
 * スタックのトップタスクをタイマー対象としたタイマー hook。
 *
 * - `useTaskTimer` の上に被せて TopTimerBinding に整形する
 * - pause 操作は modal で reason を取るため、bridge state (`pauseModalOpen`) を内包する
 *
 * `useTaskTimer` の戻り値が安定 (#151 で useMemo 化済み) なので、`topTimer` の
 * useMemo 依存配列は `[timer]` でも spurious re-create は起きない。
 */
export function useTopTaskTimer(topTask: Task | null): UseTopTaskTimerResult {
  const timer = useTaskTimer(topTask);
  const [pauseModalOpen, setPauseModalOpen] = useState(false);

  const topTimer = useMemo<TopTimerBinding>(
    () => ({
      elapsedSeconds: timer.elapsedSeconds,
      pauseReason: timer.pauseReason,
      onStart: () => {
        void timer.start();
      },
      onPauseRequest: () => setPauseModalOpen(true),
      onResume: () => {
        void timer.resume();
      },
      onComplete: () => {
        void timer.complete();
      },
    }),
    [timer],
  );

  const handlePauseSelect = useCallback(
    (reason: PauseReason) => {
      setPauseModalOpen(false);
      void timer.pause(reason);
    },
    [timer],
  );

  return { topTimer, pauseModalOpen, setPauseModalOpen, handlePauseSelect };
}
