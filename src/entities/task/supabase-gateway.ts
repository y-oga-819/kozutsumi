import type { SupabaseClient } from "@supabase/supabase-js";

import { ACTION_TYPES, log } from "@/entities/action-log/logger";
import type { Database, Tables, TablesInsert, TablesUpdate } from "@/shared/types/database";

import type { CorrectionFactor } from "./correction";
import type { CreateTaskInput, ProjectCascadeMode, TaskGateway, UpdateTaskInput } from "./gateway";
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
    deliverable: row.deliverable,
    done: row.done,
    firstStep: row.first_step,
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

  /**
   * ADR 0051 D1/D2/D4: 親 task の `decompose_status` を引く軽量 helper。
   * `decomposition_modified` (child_added / child_edited / child_deleted) と
   * `task_deleted.snapshot.was_decomposition_child` の発火条件判定に共通利用する。
   *
   * 失敗時 (取得 error / 親不存在) は null を返す。fail-soft: 学習信号を取りこぼしても
   * core 操作 (create/update/delete) は止めない (ADR 0013, ADR 0035 §6 の「完全性は保証
   * しない」原則と整合)。
   */
  private async fetchParentDecomposeStatus(
    parentTaskId: string | null | undefined,
  ): Promise<string | null> {
    if (!parentTaskId) return null;
    const { data, error } = await this.supabase
      .from("tasks")
      .select("decompose_status")
      .eq("id", parentTaskId)
      .maybeSingle();
    if (error || !data) return null;
    return data.decompose_status;
  }

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

    // ADR 0051 D2: `decompose_status='decomposed'` の親に user が手動で子を追加した場合、
    // `decomposition_modified.kind=child_added` を発火する (Phase 4 教師信号)。
    // 純粋な手動階層 (親が `decomposed` 以外) は対象外 = `decompose_status` 列で
    // schema レベルで自然に区別される。fail-soft: 親取得失敗時は発火しない (学習信号の
    // 劣化を許容、core 操作止めない、ADR 0013)。
    const parentDecomposeStatus = await this.fetchParentDecomposeStatus(input.parentTaskId);

    const payload: TablesInsert<"tasks"> = {
      user_id,
      // #170 / ADR 0039: project は任意化された。null / 空文字 / undefined は
      // 「未指定 (Inbox 的)」として project_id=NULL で insert する。
      project_id: input.projectId ? input.projectId : null,
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

    if (parentDecomposeStatus === "decomposed" && input.parentTaskId) {
      log(ACTION_TYPES.DECOMPOSITION_MODIFIED, {
        task_id: data.id,
        parent_id: input.parentTaskId,
        kind: "child_added",
      });
    }

    return fromRow(data);
  }

  async update(id: string, patch: UpdateTaskInput): Promise<Task> {
    // ADR 0051 D1: title / estimated_minutes 変更を `task_title_changed` /
    // `decomposition_modified.kind=child_edited` で捕捉する。pre-fetch は editorial 系
    // patch (title / estimatedMinutes) を含む時のみ走らせる。status update 等の hot path
    // には追加クエリを乗せない。fail-soft: 取得失敗時は発火しない (ADR 0013)。
    const needsEditorialSnapshot =
      patch.title !== undefined || patch.estimatedMinutes !== undefined;
    let oldRow: {
      title: string;
      estimated_minutes: number | null;
      parent_task_id: string | null;
    } | null = null;
    let parentDecomposeStatus: string | null = null;
    if (needsEditorialSnapshot) {
      const { data: pre } = await this.supabase
        .from("tasks")
        .select("title, estimated_minutes, parent_task_id")
        .eq("id", id)
        .maybeSingle();
      oldRow = pre ?? null;
      if (oldRow?.parent_task_id) {
        parentDecomposeStatus = await this.fetchParentDecomposeStatus(oldRow.parent_task_id);
      }
    }

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
    if (patch.deliverable !== undefined) update.deliverable = patch.deliverable;
    if (patch.done !== undefined) update.done = patch.done;
    if (patch.firstStep !== undefined) update.first_step = patch.firstStep;
    if (patch.completedAt !== undefined) update.completed_at = patch.completedAt;
    const { data, error } = await this.supabase
      .from("tasks")
      .update(update)
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;

    // ADR 0051 D1: editorial signal 発火。`task_title_changed` は全 task 共通で発火する
    // 汎用 signal (root / 分解子の区別なし)。`decomposition_modified.child_edited` は
    // 親が `decomposed` の子を編集した時だけ追加で発火する (併発、別意味)。
    if (oldRow) {
      const titleChanged = patch.title !== undefined && oldRow.title !== patch.title;
      const estimatedChanged =
        patch.estimatedMinutes !== undefined && oldRow.estimated_minutes !== patch.estimatedMinutes;

      if (titleChanged && patch.title !== undefined) {
        log(ACTION_TYPES.TASK_TITLE_CHANGED, {
          task_id: id,
          old_title: oldRow.title,
          new_title: patch.title,
        });
      }

      if (
        parentDecomposeStatus === "decomposed" &&
        oldRow.parent_task_id &&
        (titleChanged || estimatedChanged)
      ) {
        log(ACTION_TYPES.DECOMPOSITION_MODIFIED, {
          task_id: id,
          parent_id: oldRow.parent_task_id,
          kind: "child_edited",
        });
      }
    }

    return fromRow(data);
  }

  async updateTaskProjectCascade(
    taskId: string,
    newProjectId: string | null,
    mode: ProjectCascadeMode,
  ): Promise<{ affectedTaskIds: string[] }> {
    if (mode === "single") {
      // 単独タスクは既存の update 経路で十分 (RPC の atomic 担保が要らない)。
      // returning なし update + id を 1 件返す。
      const { error } = await this.supabase
        .from("tasks")
        .update({ project_id: newProjectId } satisfies TablesUpdate<"tasks">)
        .eq("id", taskId);
      if (error) throw error;
      return { affectedTaskIds: [taskId] };
    }

    // with_children / with_siblings_and_parent は RPC 経由で 1 トランザクション化 (ADR 0039)。
    // 戻り値は影響を受けた task id 配列 (target を含む)。
    const fnName =
      mode === "with_children"
        ? "fn_update_task_project_with_children"
        : "fn_update_task_project_with_siblings_and_parent";
    const { data, error } = await this.supabase.rpc(fnName, {
      p_task_id: taskId,
      p_new_project_id: newProjectId,
    });
    if (error) throw error;
    return { affectedTaskIds: data ?? [] };
  }

  async reorder(entries: readonly { id: string; stackOrder: number | null }[]): Promise<void> {
    if (entries.length === 0) return;
    // issue #184 / #185: 1 transaction で一括 update する RPC 経由に揃える。
    // 個別 reorder / グループ reorder (ADR-0041) どちらも同じ入口。
    const payload = entries.map((e) => ({ id: e.id, stack_order: e.stackOrder }));
    const { error } = await this.supabase.rpc("reorder_tasks_atomic", { entries: payload });
    if (error) throw error;
  }

  async delete(id: string): Promise<void> {
    // ADR 0035 §5: task_deleted は snapshot 必須化された (Phase 4 回避パターン分析の素材)。
    // 物理削除前に主要属性を読んでおき、削除後に snapshot 込みで log する。
    // select は必要列のみで軽い (RLS 経由で 1 行)。失敗しても delete は強行する。
    //
    // ADR 0051 D1/D4: pre-fetch を拡張し editorial signal を導出する。
    // - self.decompose_status: parent_merged 判定 (削除対象が分解親なら子を孤児化)
    // - parent.decompose_status: child_deleted / was_decomposition_child 判定
    // - children list: parent_merged の発火対象列挙
    const { data: snapshotRow } = await this.supabase
      .from("tasks")
      .select("title, estimated_minutes, task_category, status, parent_task_id, decompose_status")
      .eq("id", id)
      .maybeSingle();

    const parentDecomposeStatus = await this.fetchParentDecomposeStatus(
      snapshotRow?.parent_task_id ?? null,
    );
    const wasDecompositionChild = parentDecomposeStatus === "decomposed";

    // 削除対象自身が `decomposed` 親なら子を取得 (parent_merged 発火対象)。
    let orphanedChildIds: string[] = [];
    if (snapshotRow?.decompose_status === "decomposed") {
      const { data: children } = await this.supabase
        .from("tasks")
        .select("id")
        .eq("parent_task_id", id);
      orphanedChildIds = (children ?? []).map((c) => c.id);
    }

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
        was_decomposition_child: wasDecompositionChild,
      },
    });

    // ADR 0051 D1: 親が `decomposed` の子を削除した時、`decomposition_modified.child_deleted`
    // を併発で発火する (task_deleted は汎用、こちらは「分解構成が縮んだ」signal)。
    if (wasDecompositionChild && snapshotRow?.parent_task_id) {
      log(ACTION_TYPES.DECOMPOSITION_MODIFIED, {
        task_id: id,
        parent_id: snapshotRow.parent_task_id,
        kind: "child_deleted",
      });
    }

    // ADR 0051 D1 / ADR 0018: 分解親が削除されると子が孤児化する。各孤児に対して
    // `decomposition_modified.parent_merged` を発火する (Phase 4 で「親統合」を再構成可能に)。
    for (const childId of orphanedChildIds) {
      log(ACTION_TYPES.DECOMPOSITION_MODIFIED, {
        task_id: childId,
        parent_id: id,
        kind: "parent_merged",
      });
    }
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

  async findTasksDependingOnEvents(
    eventIds: string[],
  ): Promise<Array<{ taskId: string; eventId: string }>> {
    if (eventIds.length === 0) return [];
    const uid = await getUserId(this.supabase);
    const { data, error } = await this.supabase
      .from("tasks")
      .select("id, depends_on_event_id")
      .eq("user_id", uid)
      .in("depends_on_event_id", eventIds);
    if (error) throw error;
    return (data ?? [])
      .filter((row): row is { id: string; depends_on_event_id: string } =>
        Boolean(row.depends_on_event_id),
      )
      .map((row) => ({ taskId: row.id, eventId: row.depends_on_event_id }));
  }
}
