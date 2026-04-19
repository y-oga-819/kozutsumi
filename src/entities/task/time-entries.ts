import type { SupabaseClient } from "@supabase/supabase-js";

import type {
  Database,
  Enums,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "@/shared/types/database";

type Sb = SupabaseClient<Database>;

export type PauseReason = Enums<"pause_reason">;

export type TimeEntry = {
  id: string;
  taskId: string;
  startedAt: string;
  pausedAt: string | null;
  pauseReason: PauseReason | null;
  durationSeconds: number | null;
};

function fromRow(row: Tables<"task_time_entries">): TimeEntry {
  return {
    id: row.id,
    taskId: row.task_id,
    startedAt: row.started_at,
    pausedAt: row.paused_at,
    pauseReason: row.pause_reason,
    durationSeconds: row.duration_seconds,
  };
}

/**
 * 指定タスクの全 entry を started_at 昇順で返す。
 * 実績時間の合計は closed entry (duration_seconds != null) と
 * open entry (paused_at = null) の経過秒数を足して求める。
 */
export async function listTimeEntries(
  supabase: Sb,
  taskId: string,
): Promise<TimeEntry[]> {
  const { data, error } = await supabase
    .from("task_time_entries")
    .select("*")
    .eq("task_id", taskId)
    .order("started_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(fromRow);
}

/** 現在 open な (paused_at が null の) entry を 1 件返す。無ければ null。 */
export async function getOpenTimeEntry(
  supabase: Sb,
  taskId: string,
): Promise<TimeEntry | null> {
  const { data, error } = await supabase
    .from("task_time_entries")
    .select("*")
    .eq("task_id", taskId)
    .is("paused_at", null)
    .order("started_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const row = data?.[0];
  return row ? fromRow(row) : null;
}

/** 新規 entry を started_at = now で挿入する。 */
export async function startTimeEntry(
  supabase: Sb,
  taskId: string,
  startedAt: string = new Date().toISOString(),
): Promise<TimeEntry> {
  const payload: TablesInsert<"task_time_entries"> = {
    task_id: taskId,
    started_at: startedAt,
  };
  const { data, error } = await supabase
    .from("task_time_entries")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw error;
  return fromRow(data);
}

function computeDurationSeconds(startedAt: string, pausedAt: string): number {
  const delta = Math.floor(
    (new Date(pausedAt).getTime() - new Date(startedAt).getTime()) / 1000,
  );
  return delta < 0 ? 0 : delta;
}

/**
 * open entry を閉じる: paused_at を打刻し duration_seconds を計算する。
 * pauseReason を与えると pause_reason も保存する。
 * 既に閉じられている entry (paused_at != null) は no-op として扱う。
 */
export async function closeTimeEntry(
  supabase: Sb,
  entry: TimeEntry,
  pauseReason: PauseReason | null,
  pausedAt: string = new Date().toISOString(),
): Promise<TimeEntry> {
  if (entry.pausedAt) return entry;
  const durationSeconds = computeDurationSeconds(entry.startedAt, pausedAt);
  const patch: TablesUpdate<"task_time_entries"> = {
    paused_at: pausedAt,
    pause_reason: pauseReason,
    duration_seconds: durationSeconds,
  };
  const { data, error } = await supabase
    .from("task_time_entries")
    .update(patch)
    .eq("id", entry.id)
    .select("*")
    .single();
  if (error) throw error;
  return fromRow(data);
}

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
