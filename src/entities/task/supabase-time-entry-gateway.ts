import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Tables, TablesInsert, TablesUpdate } from "@/shared/types/database";

import type { PauseReason, TimeEntry } from "./time-entries";
import type { TaskTimeEntryGateway } from "./time-entry-gateway";

type Sb = SupabaseClient<Database>;

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

function computeDurationSeconds(startedAt: string, pausedAt: string): number {
  const delta = Math.floor((new Date(pausedAt).getTime() - new Date(startedAt).getTime()) / 1000);
  return delta < 0 ? 0 : delta;
}

export class SupabaseTaskTimeEntryGateway implements TaskTimeEntryGateway {
  constructor(private readonly supabase: Sb) {}

  async list(taskId: string): Promise<TimeEntry[]> {
    const { data, error } = await this.supabase
      .from("task_time_entries")
      .select("*")
      .eq("task_id", taskId)
      .order("started_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(fromRow);
  }

  async getOpen(taskId: string): Promise<TimeEntry | null> {
    const { data, error } = await this.supabase
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

  async start(taskId: string, startedAt: string = new Date().toISOString()): Promise<TimeEntry> {
    const payload: TablesInsert<"task_time_entries"> = {
      task_id: taskId,
      started_at: startedAt,
    };
    const { data, error } = await this.supabase
      .from("task_time_entries")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw error;
    return fromRow(data);
  }

  async close(
    entry: TimeEntry,
    pauseReason: PauseReason | null,
    pausedAt: string = new Date().toISOString(),
  ): Promise<TimeEntry> {
    // 既に閉じられている entry は no-op (二重 close 防止)
    if (entry.pausedAt) return entry;
    const durationSeconds = computeDurationSeconds(entry.startedAt, pausedAt);
    const patch: TablesUpdate<"task_time_entries"> = {
      paused_at: pausedAt,
      pause_reason: pauseReason,
      duration_seconds: durationSeconds,
    };
    const { data, error } = await this.supabase
      .from("task_time_entries")
      .update(patch)
      .eq("id", entry.id)
      .select("*")
      .single();
    if (error) throw error;
    return fromRow(data);
  }
}
