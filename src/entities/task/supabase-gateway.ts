import type { SupabaseClient } from "@supabase/supabase-js";

import { ACTION_TYPES, log } from "@/entities/action-log/logger";
import type {
  Database,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "@/shared/types/database";

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
    };
    const { data, error } = await this.supabase
      .from("tasks")
      .insert(payload)
      .select("*")
      .single();
    if (error) throw error;
    return fromRow(data);
  }

  async update(id: string, patch: UpdateTaskInput): Promise<Task> {
    const update: TablesUpdate<"tasks"> = {};
    if (patch.projectId !== undefined) update.project_id = patch.projectId;
    if (patch.title !== undefined) update.title = patch.title;
    if (patch.body !== undefined) update.body = patch.body;
    if (patch.estimatedMinutes !== undefined)
      update.estimated_minutes = patch.estimatedMinutes;
    if (patch.status !== undefined) update.status = patch.status;
    if (patch.stackOrder !== undefined) update.stack_order = patch.stackOrder;
    if (patch.dependsOnEventId !== undefined)
      update.depends_on_event_id = patch.dependsOnEventId;
    if (patch.isInterruption !== undefined)
      update.is_interruption = patch.isInterruption;
    if (patch.completedAt !== undefined)
      update.completed_at = patch.completedAt;
    const { data, error } = await this.supabase
      .from("tasks")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return fromRow(data);
  }

  async reorder(
    entries: readonly { id: string; stackOrder: number | null }[],
  ): Promise<void> {
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
    const { error } = await this.supabase.from("tasks").delete().eq("id", id);
    if (error) throw error;
    // 行動ログ欠損を防ぐため delete 成功後に TASK_DELETED を記録する (vision.md / ADR-0001)
    log(ACTION_TYPES.TASK_DELETED, { task_id: id });
  }

  async deleteAllForCurrentUser(): Promise<void> {
    const uid = await getUserId(this.supabase);
    const { error } = await this.supabase
      .from("tasks")
      .delete()
      .eq("user_id", uid);
    if (error) throw error;
  }
}
