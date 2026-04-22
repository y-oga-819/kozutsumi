import type { PauseReason, TimeEntry } from "./time-entries";

/**
 * TaskTimeEntry の永続化境界。
 *
 * 判断 4 に従い TaskGateway とは独立。
 * 判断 5 (auth 隠蔽) に従い user_id は interface に現れない。
 * task_time_entries の `deleteAllForCurrentUser` は DB 側の
 * `tasks(id) ON DELETE CASCADE` に任せるため interface に置かない。
 */
export interface TaskTimeEntryGateway {
  list(taskId: string): Promise<TimeEntry[]>;
  getOpen(taskId: string): Promise<TimeEntry | null>;
  start(taskId: string, startedAt?: string): Promise<TimeEntry>;
  close(
    entry: TimeEntry,
    pauseReason: PauseReason | null,
    pausedAt?: string,
  ): Promise<TimeEntry>;
}
