import type { SupabaseClient } from "@supabase/supabase-js";

import { ACTION_TYPES, log } from "@/entities/action-log/logger";
import type { Database, Tables, TablesInsert, TablesUpdate } from "@/shared/types/database";

import type { CorrectionFactor } from "./correction";
import type { CreateTaskInput, TaskGateway, UpdateTaskInput } from "./gateway";
import type { Task } from "./types";

type Sb = SupabaseClient<Database>;

function fromRow(row: Tables<"tasks">): Task {
  return {
    id: row.id,
    projectId: row.project_id ?? "",
    title: row.title,
    body: row.body,
    estimatedMinutes: row.estimated_minutes,
    status: row.status,
    stackOrder: row.stack_order,
    dependsOnEventId: row.depends_on_event_id,
    isInterruption: row.is_interruption,
    parentTaskId: row.parent_task_id,
    decomposeStatus: row.decompose_status,
    taskCategory: row.task_category,
    taskSize: row.task_size,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

async function getUserId(supabase: Sb): Promise<string> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("not authenticated");
  return user.id;
}

export class SupabaseTaskGateway implements TaskGateway {
  constructor(private readonly supabase: Sb) {}

  async list(): Promise<Task[]> {
    const { data, error } = await this.supabase
      .from("tasks")
      .select("*")
      .order("stack_order", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return (data ?? []).map(fromRow);
  }

  async create(input: CreateTaskInput): Promise<Task> {
    const user_id = await getUserId(this.supabase);
    const payload: TablesInsert<"tasks"> = {
      user_id,
      project_id: input.projectId,
      title: input.title,
      body: input.body ?? "",
      estimated_minutes: input.estimatedMinutes ?? null,
      stack_order: input.stackOrder ?? null,
      depends_on_event_id: input.dependsOnEventId ?? null,
      is_interruption: input.isInterruption ?? false,
      parent_task_id: input.parentTaskId ?? null,
      task_category: input.taskCategory ?? null,
      task_size: input.taskSize ?? null,
      ...(input.decomposeStatus !== undefined ? { decompose_status: input.decomposeStatus } : {}),
    };
    const { data, error } = await this.supabase.from("tasks").insert(payload).select("*").single();
    if (error) throw error;
    return fromRow(data);
  }

  async update(id: string, patch: UpdateTaskInput): Promise<Task> {
    const update: TablesUpdate<"tasks"> = {};
    if (patch.projectId !== undefined) update.project_id = patch.projectId;
    if (patch.title !== undefined) update.title = patch.title;
    if (patch.body !== undefined) update.body = patch.body;
    if (patch.estimatedMinutes !== undefined) update.estimated_minutes = patch.estimatedMinutes;
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.stackOrder !== undefined) update.stack_order = patch.stackOrder;
    if (patch.dependsOnEventId !== undefined) update.depends_on_event_id = patch.dependsOnEventId;
    if (patch.isInterruption !== undefined) update.is_interruption = patch.isInterruption;
    if (patch.decomposeStatus !== undefined) update.decompose_status = patch.decomposeStatus;
    if (patch.taskCategory !== undefined) update.task_category = patch.taskCategory;
    if (patch.taskSize !== undefined) update.task_size = patch.taskSize;
    if (patch.completedAt !== undefined) update.completed_at = patch.completedAt;
    const { data, error } = await this.supabase
      .from("tasks")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return fromRow(data);
  }

  async reorder(entries: readonly { id: string; stackOrder: number | null }[]): Promise<void> {
    if (entries.length === 0) return;
    // 並列 update: 個別 patch を Promise.all で流す。件数は高々 20〜30 件想定。
    // 1 call で済ませるには upsert + on_conflict だが、全カラムを送る必要が出るので採用しない。
    await Promise.all(
      entries.map(({ id, stackOrder }) =>
        this.supabase
          .from("tasks")
          .update({ stack_order: stackOrder } satisfies TablesUpdate<"tasks">)
          .eq("id", id),
      ),
    );
  }

  async delete(id: string): Promise<void> {
    // ADR 0035 §5: task_deleted は snapshot 必須化された (Phase 4 回避パターン分析の素材)。
    // 物理削除前に主要属性を読んでおき、削除後に snapshot 込みで log する。
    // select は必要列のみで軽い (RLS 経由で 1 行)。失敗しても delete は強行する。
    const { data: snapshotRow } = await this.supabase
      .from("tasks")
      .select("title, estimated_minutes, task_category, status, parent_task_id")
      .eq("id", id)
      .maybeSingle();
    const { error } = await this.supabase.from("tasks").delete().eq("id", id);
    if (error) throw error;
    log(ACTION_TYPES.TASK_DELETED, {
      task_id: id,
      snapshot: {
        title: snapshotRow?.title ?? "",
        estimated_minutes: snapshotRow?.estimated_minutes ?? null,
        task_category: snapshotRow?.task_category ?? null,
        status: snapshotRow?.status ?? "idle",
        parent_task_id: snapshotRow?.parent_task_id ?? null,
      },
    });
  }

  async deleteAllForCurrentUser(): Promise<void> {
    const uid = await getUserId(this.supabase);
    const { error } = await this.supabase.from("tasks").delete().eq("user_id", uid);
    if (error) throw error;
  }

  async listCorrectionFactors(): Promise<CorrectionFactor[]> {
    // RLS は view 側 (security_invoker=true) で auth.uid() ベースに効くので、
    // user_id の絞り込みは明示的に書かない。
    const { data, error } = await this.supabase
      .from("task_category_correction_factors")
      .select("task_category, sample_count, factor");
    if (error) throw error;
    return (data ?? []).map((row) => ({
      taskCategory: row.task_category,
      // PostgreSQL の `numeric` は PostgREST 経由で string に乗ることがあるので
      // Number に揃えてから返す (Supabase JS の型は number だが防御的に統一)。
      factor: Number(row.factor),
      sampleCount: row.sample_count,
    }));
  }
}
