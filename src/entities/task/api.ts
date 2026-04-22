import type { SupabaseClient } from "@supabase/supabase-js";

import { ACTION_TYPES, log } from "@/entities/action-log/logger";
import type {
  Database,
  Tables,
  TablesInsert,
  TablesUpdate,
} from "@/shared/types/database";

import type { CreateTaskInput, UpdateTaskInput } from "./gateway";
import type { Task } from "./types";

export type { CreateTaskInput, UpdateTaskInput } from "./gateway";

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

/**
 * ユーザーの全タスクを並び順で取得する。
 * - stack_order が NULL (= idle 以外 or 並び順未指定) は末尾に並べる
 * - done は created_at 昇順で stack_order null 扱い
 */
export async function listTasks(supabase: Sb): Promise<Task[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .order("stack_order", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map(fromRow);
}

export async function createTask(
  supabase: Sb,
  input: CreateTaskInput,
): Promise<Task> {
  const user_id = await getUserId(supabase);
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
  const { data, error } = await supabase
    .from("tasks")
    .insert(payload)
    .select("*")
    .single();
  if (error) throw error;
  return fromRow(data);
}

export async function updateTask(
  supabase: Sb,
  id: string,
  patch: UpdateTaskInput,
): Promise<Task> {
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
  const { data, error } = await supabase
    .from("tasks")
    .update(update)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return fromRow(data);
}

/**
 * スタック並べ替え: (id, stack_order) のペアをまとめて適用する。
 *
 * Supabase の .update() は WHERE 単位なので、複数行の個別値を 1 call で書くには
 * upsert + on_conflict を使う。全カラムを送るので、呼び出し元は最新タスク全体を渡す。
 */
export async function reorderTasks(
  supabase: Sb,
  entries: readonly { id: string; stackOrder: number | null }[],
): Promise<void> {
  if (entries.length === 0) return;
  // 並列 update: 個別 patch を Promise.all で流す。件数は高々 20〜30 件想定。
  await Promise.all(
    entries.map(({ id, stackOrder }) =>
      supabase
        .from("tasks")
        .update({ stack_order: stackOrder } satisfies TablesUpdate<"tasks">)
        .eq("id", id),
    ),
  );
}

/**
 * task_deleted action_log 呼び出しを削除操作にバインドする。
 * (Phase 1 仕様 Step 4 / vision.md: 行動ログ欠損を防ぐ)
 */
export async function deleteTask(supabase: Sb, id: string): Promise<void> {
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw error;
  log(ACTION_TYPES.TASK_DELETED, { task_id: id });
}
