import type { Enums } from "@/shared/types/database";

export type PauseReason = Enums<"pause_reason">;

export type TimeEntry = {
  id: string;
  taskId: string;
  startedAt: string;
  pausedAt: string | null;
  pauseReason: PauseReason | null;
  durationSeconds: number | null;
};

/**
 * タスクの実績秒数合計。
 * - 閉じた entry は duration_seconds をそのまま足す
 * - open entry (= 現在アクティブ) は referenceTime との差分で補う
 */
export function sumDurationSeconds(
  entries: readonly TimeEntry[],
  referenceTime: number = Date.now(),
): number {
  let total = 0;
  for (const e of entries) {
    if (e.durationSeconds != null) {
      total += e.durationSeconds;
      continue;
    }
    if (e.pausedAt == null) {
      const delta = Math.floor(
        (referenceTime - new Date(e.startedAt).getTime()) / 1000,
      );
      total += delta < 0 ? 0 : delta;
    }
  }
  return total;
}
