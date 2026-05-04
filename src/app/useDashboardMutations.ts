"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { dashboardKeys } from "./useDashboardQueries";
import { ACTION_TYPES, log } from "@/entities/action-log/logger";
import type { CreateEventInput, UpdateEventInput } from "@/entities/event/gateway";
import type { Event, EventVisibilityOverride } from "@/entities/event/types";
import type { CreateProjectInput, UpdateProjectInput } from "@/entities/project/gateway";
import type { Project } from "@/entities/project/types";
import type { CreateTaskInput, ProjectCascadeMode } from "@/entities/task/gateway";
import type { Task, TaskCategory, TaskSize } from "@/entities/task/types";
import {
  insertAtTopPlusOne,
  reorderGroupById,
  reorderTasksById,
} from "@/features/task-stack/reorderTasks";
import { triggerCategorize } from "@/features/task-stack/triggerCategorize";
import { triggerDecompose } from "@/features/task-stack/triggerDecompose";
import { triggerResplit } from "@/features/task-stack/triggerResplit";
import {
  useEventGateway,
  useProjectGateway,
  useTaskGateway,
} from "@/shared/gateway/GatewayContext";
import { isDone } from "@/shared/lib/task";

export type DashboardMutations = {
  /** スタックトップでもどこからでも、タスクの完了 / 未完了をトグル。action_log: TASK_COMPLETED。 */
  toggleDone: (id: string) => void;
  /** タスク本文の編集 (詳細パネル markdown editor)。 */
  updateBody: (id: string, body: string) => void;
  /** P2-5 (#53): タスクの依存イベント設定。action_log: TASK_DEPENDENCY_SET / _CLEARED。 */
  updateDependency: (id: string, dependsOnEventId: string | null) => void;
  /** P3-5 (#90) / ADR 0015: 詳細パネルからの task_category override。action_log: TASK_CATEGORY_CHANGED。 */
  updateCategory: (id: string, taskCategory: TaskCategory | null) => void;
  /**
   * #170 / ADR 0038: 詳細パネルからの task_size 編集。AI 推定の estimated_minutes
   * とは独立した主観サイズ軸を上書きする。logging は今は持たない (action_log の
   * payload schema を別 issue で確定する必要があるため)。
   */
  updateSize: (id: string, taskSize: TaskSize | null) => void;
  /**
   * Issue #171 / ADR 0039: タスクの project_id 編集と親→子 / 子→兄弟+親 への伝播。
   * cache から target の親子関係を判定して mode を決め、対応する RPC (atomic) または
   * 単独 update を呼ぶ。1 操作 = 1 ログ (`task_project_changed`) + payload に伝播範囲。
   * - 同値選択は no-op (mutation 自体を呼ばない)。
   */
  updateTaskProject: (id: string, projectId: string | null) => void;
  /** DnD でのタスク並び替え。action_log: TASK_REORDERED。 */
  reorder: (fromId: string, toId: string) => void;
  /**
   * ADR-0041: 親バッジ起点のグループ並び替え。`parentTaskId` を共有する全行を
   * グループとしてまとめて `toId` の位置に移す。action_log: TASK_REORDERED を
   * グループ要素ごとに 1 件発火し、metadata に `group_parent_id` を含める。
   */
  reorderGroup: (parentTaskId: string, toId: string) => void;
  /**
   * AddPanel からのタスク作成。タスク insert 後に AI 分解 + AI category 推論を
   * fire-and-forget で投げる (P3-4 / P3-6, ADR 0015 / 0017)。
   *
   * ADR-0040: 新規タスクは現在の Top タスクの直下 (visible 上から 2 番目) に挿入する。
   * 呼び出し元は stackOrder を渡さない (内部で cache から Top+1 を算出する)。
   */
  createTaskWithAi: (input: CreateTaskInput) => Promise<void>;
  createEvent: (input: CreateEventInput) => Promise<void>;
  /** ADR 0010: google_calendar event の project_id だけ kozutsumi 側で編集可。 */
  updateEventProject: (id: string, projectId: string | null) => void;
  /** ADR 0010: manual event の全フィールド編集。 */
  updateEvent: (id: string, patch: UpdateEventInput) => Promise<void>;
  /** ADR 0010: manual event の削除。google_calendar は gateway 側で弾く。 */
  deleteEvent: (id: string) => Promise<void>;
  /**
   * Issue #145 / ADR 0032 Layer 3: event の visibility_override を更新。
   * 'shown' / 'hidden' は EventDetailPanel と予定管理ページから、'none' は SettingsPanel
   * の override 一覧 reset 専用導線から呼ぶ (ADR 0032: 日常 UI から none へは戻せない)。
   */
  setEventVisibilityOverride: (id: string, value: EventVisibilityOverride) => Promise<void>;
  createProject: (input: CreateProjectInput) => Promise<void>;
  updateProject: (id: string, patch: UpdateProjectInput) => Promise<void>;
  /** schema 上 ON DELETE SET NULL なので tasks/events も invalidate する。 */
  deleteProject: (id: string) => Promise<void>;
  /** タスク削除。SupabaseTaskGateway 側で TASK_DELETED action_log を記録する。 */
  deleteTask: (id: string) => void;
  /**
   * 詳細パネルの「再分解」ボタン。optimistic に decomposing pill を出して
   * `/api/ai/decompose` を fire-and-forget で叩く (P3-15 / ADR 0021 §4)。
   */
  triggerDecomposeWithOptimistic: (id: string) => void;
  /**
   * 子タスクの再分解 (issue #121 / ADR 0027)。optimistic に decomposing pill を
   * 出し、完了後 (成功 / 失敗 / skipped 問わず) tasks を invalidate する。
   */
  triggerResplitWithOptimistic: (id: string) => void;
};

/**
 * AppShell の主データ書き込み (12 mutation + AI trigger 派生 callback) を集約した hook。
 *
 * 各 mutation は optimistic update + onError でロールバック + onSettled で
 * invalidate する基本パターン (`dashboardKeys.*` を共有)。
 */
export function useDashboardMutations(): DashboardMutations {
  const taskGateway = useTaskGateway();
  const projectGateway = useProjectGateway();
  const eventGateway = useEventGateway();
  const queryClient = useQueryClient();

  const toggleDoneMutation = useMutation({
    mutationFn: (id: string) => {
      const target = queryClient
        .getQueryData<Task[]>(dashboardKeys.tasks)
        ?.find((t) => t.id === id);
      if (!target) throw new Error("task not found");
      const nextDone = !isDone(target);
      return taskGateway.update(id, {
        status: nextDone ? "done" : "idle",
        completedAt: nextDone ? new Date().toISOString() : null,
      });
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: dashboardKeys.tasks });
      const previous = queryClient.getQueryData<Task[]>(dashboardKeys.tasks);
      const target = previous?.find((t) => t.id === id);
      if (target && !isDone(target)) {
        log(ACTION_TYPES.TASK_COMPLETED, { task_id: id });
      }
      queryClient.setQueryData<Task[]>(dashboardKeys.tasks, (prev) =>
        (prev ?? []).map((t) =>
          t.id === id
            ? {
                ...t,
                status: isDone(t) ? "idle" : "done",
                completedAt: isDone(t) ? null : new Date().toISOString(),
              }
            : t,
        ),
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(dashboardKeys.tasks, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: dashboardKeys.tasks });
    },
  });

  const updateBodyMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => taskGateway.update(id, { body }),
    onMutate: async ({ id, body }) => {
      await queryClient.cancelQueries({ queryKey: dashboardKeys.tasks });
      const previous = queryClient.getQueryData<Task[]>(dashboardKeys.tasks);
      queryClient.setQueryData<Task[]>(dashboardKeys.tasks, (prev) =>
        (prev ?? []).map((t) => (t.id === id ? { ...t, body } : t)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(dashboardKeys.tasks, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: dashboardKeys.tasks });
    },
  });

  // P2-5 (#53): タスクの依存イベント設定。set / cleared を action_log に残し、
  // Phase 4 で「依存設定が着手順に効いたか」の分析データに使う。
  const updateDependencyMutation = useMutation({
    mutationFn: ({ id, dependsOnEventId }: { id: string; dependsOnEventId: string | null }) =>
      taskGateway.update(id, { dependsOnEventId }),
    onMutate: async ({ id, dependsOnEventId }) => {
      await queryClient.cancelQueries({ queryKey: dashboardKeys.tasks });
      const previous = queryClient.getQueryData<Task[]>(dashboardKeys.tasks);
      const target = previous?.find((t) => t.id === id);
      const was = target?.dependsOnEventId ?? null;
      if (was !== dependsOnEventId) {
        if (dependsOnEventId) {
          log(ACTION_TYPES.TASK_DEPENDENCY_SET, {
            task_id: id,
            event_id: dependsOnEventId,
            was,
          });
        } else if (was) {
          log(ACTION_TYPES.TASK_DEPENDENCY_CLEARED, { task_id: id, was });
        }
      }
      queryClient.setQueryData<Task[]>(dashboardKeys.tasks, (prev) =>
        (prev ?? []).map((t) => (t.id === id ? { ...t, dependsOnEventId } : t)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(dashboardKeys.tasks, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: dashboardKeys.tasks });
    },
  });

  // P3-5 (#90) / ADR 0015: 詳細パネルからの task_category override。
  // AddPanel には出さず、AI 初期ラベル → 人間 override のフローで暗黙的フィードバック
  // (task_category_changed) を残す。Phase 4 のラベリング精度改善ループの入力源。
  const updateCategoryMutation = useMutation({
    mutationFn: ({ id, taskCategory }: { id: string; taskCategory: TaskCategory | null }) =>
      taskGateway.update(id, { taskCategory }),
    onMutate: async ({ id, taskCategory }) => {
      await queryClient.cancelQueries({ queryKey: dashboardKeys.tasks });
      const previous = queryClient.getQueryData<Task[]>(dashboardKeys.tasks);
      const target = previous?.find((t) => t.id === id);
      const from = target?.taskCategory ?? null;
      // override 時のみ log。next === null (= 「未分類」へ戻す) は ADR 0015 の
      // metadata.to: string と矛盾するので log を抑制する (DB は更新する)。
      // Phase 4 のラベリング精度分析は「人間が AI ラベルを別の値で上書きした」事象を
      // 拾えれば十分なので、null に戻す操作の追跡は今は持たない。
      if (from !== taskCategory && taskCategory !== null) {
        log(ACTION_TYPES.TASK_CATEGORY_CHANGED, {
          task_id: id,
          from,
          to: taskCategory,
        });
      }
      queryClient.setQueryData<Task[]>(dashboardKeys.tasks, (prev) =>
        (prev ?? []).map((t) => (t.id === id ? { ...t, taskCategory } : t)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(dashboardKeys.tasks, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: dashboardKeys.tasks });
    },
  });

  // #170 / ADR 0038: 主観サイズ (task_size) の上書き。AI が初期値を入れるルートと、
  // ユーザーが詳細パネルで上書きするルートが両方あり、どちらも `tasks.task_size` 同列に
  // 落ちる。category と異なり action_log は今は持たない (Phase 4 で必要になったら追加)。
  const updateSizeMutation = useMutation({
    mutationFn: ({ id, taskSize }: { id: string; taskSize: TaskSize | null }) =>
      taskGateway.update(id, { taskSize }),
    onMutate: async ({ id, taskSize }) => {
      await queryClient.cancelQueries({ queryKey: dashboardKeys.tasks });
      const previous = queryClient.getQueryData<Task[]>(dashboardKeys.tasks);
      queryClient.setQueryData<Task[]>(dashboardKeys.tasks, (prev) =>
        (prev ?? []).map((t) => (t.id === id ? { ...t, taskSize } : t)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(dashboardKeys.tasks, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: dashboardKeys.tasks });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (entries: { id: string; stackOrder: number | null }[]) =>
      taskGateway.reorder(entries),
    // DnD は optimistic で UI 側は onMutate で即反映、サーバー同期は背面で進める。
  });

  // Issue #171 / ADR 0039: 詳細パネルからの project 編集 + 親→子 / 子→兄弟+親 伝播。
  // mutation 引数:
  //   id            : ユーザーが直接編集した task id (action_logs.task_id 列に入る)
  //   projectId     : 新しい project_id (null で「未指定」)
  //   mode          : "single" | "with_children" | "with_siblings_and_parent"
  //   affectedIds   : 影響を受ける全 task id (target を含む) — onMutate / log で使う
  //   from          : 旧 project_id (action_log の payload `from` 用)
  //
  // mode 判定と affected_ids の算出は wrapper (updateTaskProject) 側で cache を読んで行う。
  // ここでは「先に確定した範囲を atomic に変える」ことだけに集中する。
  const updateTaskProjectMutation = useMutation({
    mutationFn: ({
      id,
      projectId,
      mode,
    }: {
      id: string;
      projectId: string | null;
      mode: ProjectCascadeMode;
      affectedIds: string[];
      from: string | null;
    }) => taskGateway.updateTaskProjectCascade(id, projectId, mode),
    onMutate: async ({ id, projectId, mode, affectedIds, from }) => {
      await queryClient.cancelQueries({ queryKey: dashboardKeys.tasks });
      const previous = queryClient.getQueryData<Task[]>(dashboardKeys.tasks);
      // 楽観: 影響範囲全 task の projectId を一括書き換え。Task.projectId は
      // 空文字を「未指定」として保持する慣習 (fromRow で `row.project_id ?? ""`) なので、
      // null は "" に揃える。
      const next = projectId ?? "";
      const affectedSet = new Set(affectedIds);
      queryClient.setQueryData<Task[]>(dashboardKeys.tasks, (prev) =>
        (prev ?? []).map((t) => (affectedSet.has(t.id) ? { ...t, projectId: next } : t)),
      );
      // 1 操作 = 1 ログ。propagation と affected_task_ids で N 行更新を再構成可能にする (ADR 0039)。
      log(ACTION_TYPES.TASK_PROJECT_CHANGED, {
        task_id: id,
        from,
        to: projectId,
        propagation: mode,
        affected_task_ids: affectedIds,
      });
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(dashboardKeys.tasks, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: dashboardKeys.tasks });
    },
  });

  const updateTaskProject = useCallback(
    (id: string, projectId: string | null) => {
      const cached = queryClient.getQueryData<Task[]>(dashboardKeys.tasks) ?? [];
      const target = cached.find((t) => t.id === id);
      if (!target) return;
      // Task.projectId は "" を「未指定」として保持しているので、null と "" を同一視する。
      const from = target.projectId === "" ? null : target.projectId;
      const to = projectId === "" ? null : projectId;
      if (from === to) return; // 同値選択は no-op

      // mode 判定:
      //   - target が子 (parentTaskId not null) → 親 + 全兄弟に伝播
      //   - target が親 (parentTaskId is null) かつ子が居る → 全子に伝播
      //   - それ以外 (単独タスク) → 当該行のみ
      let mode: ProjectCascadeMode;
      let affectedIds: string[];
      if (target.parentTaskId !== null) {
        mode = "with_siblings_and_parent";
        const parentId = target.parentTaskId;
        affectedIds = [
          parentId,
          ...cached.filter((t) => t.parentTaskId === parentId).map((t) => t.id),
        ];
      } else {
        const childIds = cached.filter((t) => t.parentTaskId === id).map((t) => t.id);
        if (childIds.length > 0) {
          mode = "with_children";
          affectedIds = [id, ...childIds];
        } else {
          mode = "single";
          affectedIds = [id];
        }
      }

      updateTaskProjectMutation.mutate({ id, projectId: to, mode, affectedIds, from });
    },
    [queryClient, updateTaskProjectMutation],
  );

  // createTaskWithAi が cache を append + AI trigger 完了後に .finally invalidate
  // するので、ここでは onSuccess invalidate を持たない (issue #167)。旧実装では
  // onSuccess の invalidate がトリガする in-flight refetch と直後の
  // setQueryData('decomposing') が競合し、refetch レスポンス (status='none')
  // で楽観 pill が即座に上書きされていた。
  const createTaskMutation = useMutation({
    mutationFn: (input: CreateTaskInput) => taskGateway.create(input),
  });

  const createEventMutation = useMutation({
    mutationFn: (input: CreateEventInput) => eventGateway.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dashboardKeys.events });
    },
  });

  // ADR 0010 / P2-4: google_calendar イベントは project_id だけ kozutsumi 側で
  // 編集可。optimistic に反映し、失敗したら roll back する。
  const updateEventProjectMutation = useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string | null }) =>
      eventGateway.update(id, { projectId }),
    onMutate: async ({ id, projectId }) => {
      await queryClient.cancelQueries({ queryKey: dashboardKeys.events });
      const previous = queryClient.getQueryData<Event[]>(dashboardKeys.events);
      queryClient.setQueryData<Event[]>(dashboardKeys.events, (prev) =>
        (prev ?? []).map((e) => (e.id === id ? { ...e, projectId } : e)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(dashboardKeys.events, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: dashboardKeys.events });
    },
  });

  // ADR 0010: manual イベントの全フィールド編集 (title / start_time / end_time /
  // meet_url / project_id / description)。optimistic に反映し、失敗したら roll
  // back する。SupabaseEventGateway.update 側で source='google_calendar' の行は
  // Google 側属性を弾くので、UI が誤ってここに google_calendar を流しても DB
  // 書き込みは守られる (ADR 0010 の defense in depth)。
  const updateEventMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateEventInput }) =>
      eventGateway.update(id, patch),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: dashboardKeys.events });
      const previous = queryClient.getQueryData<Event[]>(dashboardKeys.events);
      queryClient.setQueryData<Event[]>(dashboardKeys.events, (prev) =>
        (prev ?? []).map((e) =>
          e.id === id
            ? {
                ...e,
                ...(patch.title !== undefined ? { title: patch.title } : {}),
                ...(patch.startTime !== undefined ? { startTime: patch.startTime } : {}),
                ...(patch.endTime !== undefined ? { endTime: patch.endTime } : {}),
                ...(patch.projectId !== undefined ? { projectId: patch.projectId } : {}),
                ...(patch.meetUrl !== undefined ? { meetUrl: patch.meetUrl } : {}),
                ...(patch.hasAttachments !== undefined
                  ? { hasAttachments: patch.hasAttachments }
                  : {}),
                ...(patch.description !== undefined ? { description: patch.description } : {}),
              }
            : e,
        ),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(dashboardKeys.events, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: dashboardKeys.events });
    },
  });

  // Issue #145 / ADR 0031 Layer 3 / ADR 0032: event の visibility_override を更新する。
  // server 側 (PATCH /api/events/[id]/visibility-override) で action_log
  // (event_promoted / event_demoted / event_override_cleared) を発火し、
  // is_override_of_default は subscription.auto_promote と to の関係から計算する。
  // optimistic に events cache を書き換え、失敗したら rollback する。
  const setEventVisibilityOverrideMutation = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: EventVisibilityOverride }) => {
      const res = await fetch(`/api/events/${id}/visibility-override`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `visibility_override_failed: ${res.status}`);
      }
      return (await res.json()) as {
        from: EventVisibilityOverride;
        to: EventVisibilityOverride;
        changed: boolean;
      };
    },
    onMutate: async ({ id, value }) => {
      await queryClient.cancelQueries({ queryKey: dashboardKeys.events });
      const previous = queryClient.getQueryData<Event[]>(dashboardKeys.events);
      queryClient.setQueryData<Event[]>(dashboardKeys.events, (prev) =>
        (prev ?? []).map((e) => (e.id === id ? { ...e, visibilityOverride: value } : e)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(dashboardKeys.events, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: dashboardKeys.events });
    },
  });

  // ADR 0010: manual イベントだけが UI から削除可能。google_calendar は
  // SupabaseEventGateway.delete が source を見て弾く。
  const deleteEventMutation = useMutation({
    mutationFn: (id: string) => eventGateway.delete(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: dashboardKeys.events });
      const previous = queryClient.getQueryData<Event[]>(dashboardKeys.events);
      queryClient.setQueryData<Event[]>(dashboardKeys.events, (prev) =>
        (prev ?? []).filter((e) => e.id !== id),
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(dashboardKeys.events, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: dashboardKeys.events });
    },
  });

  const createProjectMutation = useMutation({
    mutationFn: (input: CreateProjectInput) => projectGateway.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: dashboardKeys.projects });
    },
  });

  const updateProjectMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateProjectInput }) =>
      projectGateway.update(id, patch),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: dashboardKeys.projects });
      const previous = queryClient.getQueryData<Project[]>(dashboardKeys.projects);
      queryClient.setQueryData<Project[]>(dashboardKeys.projects, (prev) =>
        (prev ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(dashboardKeys.projects, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: dashboardKeys.projects });
    },
  });

  // schema 上 `ON DELETE SET NULL` で tasks.project_id / events.project_id が
  // null 化される。UI 側はそれを反映するため tasks / events も invalidate する。
  const deleteProjectMutation = useMutation({
    mutationFn: (id: string) => projectGateway.delete(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: dashboardKeys.projects });
      const previous = queryClient.getQueryData<Project[]>(dashboardKeys.projects);
      queryClient.setQueryData<Project[]>(dashboardKeys.projects, (prev) =>
        (prev ?? []).filter((p) => p.id !== id),
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(dashboardKeys.projects, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: dashboardKeys.projects });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.tasks });
      queryClient.invalidateQueries({ queryKey: dashboardKeys.events });
    },
  });

  // タスク削除は TASK_DELETED action_log も記録する (SupabaseTaskGateway.delete 内)。
  const deleteTaskMutation = useMutation({
    mutationFn: (id: string) => taskGateway.delete(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: dashboardKeys.tasks });
      const previous = queryClient.getQueryData<Task[]>(dashboardKeys.tasks);
      queryClient.setQueryData<Task[]>(dashboardKeys.tasks, (prev) =>
        (prev ?? []).filter((t) => t.id !== id),
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(dashboardKeys.tasks, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: dashboardKeys.tasks });
    },
  });

  const reorder = useCallback(
    (fromId: string, toId: string) => {
      if (fromId === toId) return;
      const cached = queryClient.getQueryData<Task[]>(dashboardKeys.tasks) ?? [];
      const pending = cached.filter((t) => !isDone(t));
      const done = cached.filter((t) => isDone(t));
      const fromIdx = pending.findIndex((t) => t.id === fromId);
      const toIdx = pending.findIndex((t) => t.id === toId);
      if (fromIdx < 0 || toIdx < 0) return;
      const reordered = reorderTasksById(pending, fromId, toId);
      queryClient.setQueryData<Task[]>(dashboardKeys.tasks, [...reordered, ...done]);
      log(ACTION_TYPES.TASK_REORDERED, {
        task_id: fromId,
        from_position: fromIdx,
        to_position: toIdx,
      });
      reorderMutation.mutate(
        reordered.map((t) => ({ id: t.id, stackOrder: t.stackOrder })),
        {
          onError: () => {
            // 失敗したら再取得して辻褄を合わせる (UI は一瞬戻るが DB 正とする)
            queryClient.invalidateQueries({ queryKey: dashboardKeys.tasks });
          },
        },
      );
    },
    [queryClient, reorderMutation],
  );

  // ADR-0041: 親バッジ起点のグループ並べ替え。`parentTaskId` を共有する全 pending を
  // グループとしてまとめて `toId` の位置に移す。
  // action_log: グループ要素ごとに 1 件 `task_reordered` を発火し、metadata に
  // `group_parent_id` を含める (ADR-0001 の「個別 type の payload 揺らぎは JSONB
  // で吸収」原則の範囲内。新 type は起こさない)。Phase 4 ではこの flag で
  // 「ユーザーがグループ単位で動かした」事象を 1 操作として再構成可能。
  const reorderGroup = useCallback(
    (parentTaskId: string, toId: string) => {
      const cached = queryClient.getQueryData<Task[]>(dashboardKeys.tasks) ?? [];
      const pending = cached.filter((t) => !isDone(t));
      const done = cached.filter((t) => isDone(t));
      const groupIds = new Set(
        pending.filter((t) => t.parentTaskId === parentTaskId).map((t) => t.id),
      );
      if (groupIds.size === 0) return;
      // グループ内 row へドロップは no-op (自分のグループに自分を落とさない)
      if (groupIds.has(toId)) return;
      if (pending.findIndex((t) => t.id === toId) < 0) return;

      const reordered = reorderGroupById(pending, parentTaskId, toId);
      queryClient.setQueryData<Task[]>(dashboardKeys.tasks, [...reordered, ...done]);

      // グループ要素ごとに log: 起点行が分散している場合でも `group_parent_id` で
      // 同じグループ移動だと再構成できる。to_position はグループ移動後の位置。
      const toPositionByOldIdx = new Map<string, number>();
      reordered.forEach((t, newIdx) => {
        if (groupIds.has(t.id)) toPositionByOldIdx.set(t.id, newIdx);
      });
      pending.forEach((t, oldIdx) => {
        if (!groupIds.has(t.id)) return;
        log(ACTION_TYPES.TASK_REORDERED, {
          task_id: t.id,
          from_position: oldIdx,
          to_position: toPositionByOldIdx.get(t.id) ?? oldIdx,
          group_parent_id: parentTaskId,
        });
      });

      reorderMutation.mutate(
        reordered.map((t) => ({ id: t.id, stackOrder: t.stackOrder })),
        {
          onError: () => {
            queryClient.invalidateQueries({ queryKey: dashboardKeys.tasks });
          },
        },
      );
    },
    [queryClient, reorderMutation],
  );

  const createTaskWithAi = useCallback(
    async (input: CreateTaskInput) => {
      // ADR-0040: 新規タスクは server 側でいったん末尾相当で create し、
      // 直後に Top+1 へ renumber する 2 段階で実装する。
      // 仮値は cache から算出する pending 件数 (= 末尾相当 stack_order)。
      const initialCached = queryClient.getQueryData<Task[]>(dashboardKeys.tasks) ?? [];
      const initialPendingCount = initialCached.filter((t) => !isDone(t)).length;
      const created = await createTaskMutation.mutateAsync({
        ...input,
        stackOrder: initialPendingCount,
      });

      // issue #167: cancelQueries を挟むことで「他経路で in-flight な tasks refetch
      // (例: focus 戻り後の自動 refetch / 並走するイベント refetch) が
      // setQueryData('decomposing') を上書きする」競合を防ぐ。
      await queryClient.cancelQueries({ queryKey: dashboardKeys.tasks });

      // 楽観 cache: created を Top の直下 (visible 上から 2 番目) に挿入し、
      // pending を 0..n で振り直す (ADR-0040)。decomposing pill も同時に立てる。
      const current = queryClient.getQueryData<Task[]>(dashboardKeys.tasks) ?? [];
      // mutateAsync 後の再 fetch で created がすでに cache に居る可能性があるので除外する。
      const currentPendingExcl = current.filter((t) => !isDone(t) && t.id !== created.id);
      const currentDone = current.filter((t) => isDone(t));
      const createdWithPill: Task = { ...created, decomposeStatus: "decomposing" };
      const renumbered = insertAtTopPlusOne(currentPendingExcl, current, createdWithPill);
      queryClient.setQueryData<Task[]>(dashboardKeys.tasks, [...renumbered, ...currentDone]);

      // server 側も同じ並びに揃える (背面で進める)。失敗時は invalidate して DB 正に倒す。
      reorderMutation.mutate(
        renumbered.map((t) => ({ id: t.id, stackOrder: t.stackOrder })),
        {
          onError: () => {
            queryClient.invalidateQueries({ queryKey: dashboardKeys.tasks });
          },
        },
      );

      // P3-6 / ADR 0017: タスク作成成功後に AI 分解を fire-and-forget で投げる。
      // server 側でも `decompose_status='decomposing'` に倒すが、UI に分解中 pill を
      // 即時出すため optimistic に cache を書き換える。AI_ENABLED=false / 失敗時は
      // server が `none` に戻す (decompose-server の guard 経路)。
      //
      // issue #167: server 側 decompose 完了後 (成功 / 失敗 / skipped 問わず) に
      // tasks を invalidate して refetch する。これがないと cache が `decomposing`
      // で固まり、親 `decomposed` への遷移と子フラット化が手動リロードまで反映されない。
      // `triggerResplitWithOptimistic` と同じパターン (ADR 0027)。
      void triggerDecompose(created.id).finally(() => {
        queryClient.invalidateQueries({ queryKey: dashboardKeys.tasks });
      });
      // P3-4 / ADR 0015: AI 初期ラベリングも同経路で fire-and-forget。
      // 失敗 / AI_ENABLED=false は server が `task_category=null` のまま残す
      // (ADR 0013 augmentation only)。client 側の optimistic 反映はしないが、
      // 完了後に invalidate して AI ラベルを refetch で反映する (issue #167)。
      void triggerCategorize(created.id).finally(() => {
        queryClient.invalidateQueries({ queryKey: dashboardKeys.tasks });
      });
    },
    [createTaskMutation, queryClient, reorderMutation],
  );

  const triggerDecomposeWithOptimistic = useCallback(
    (id: string) => {
      // P3-15 / ADR 0021 §4: optimistic に decomposing pill を出しつつ fire-and-forget。
      // server 側でも `decompose_status='decomposing'` に倒す (重複設定は無害)。
      queryClient.setQueryData<Task[]>(dashboardKeys.tasks, (prev) =>
        (prev ?? []).map((t) => (t.id === id ? { ...t, decomposeStatus: "decomposing" } : t)),
      );
      // 既存 log は陳腐化するので invalidate (新たな試行が完了したら再 fetch される)
      queryClient.invalidateQueries({ queryKey: dashboardKeys.decomposeLog(id) });
      // issue #167: server 側完了後 (成功 / 失敗 / skipped) に tasks / decomposeLog を
      // invalidate して refetch する。これがないと「再分解」を押した後 UI が
      // `decomposing` で固まり、親 `decomposed` 遷移と子フラット化、最新試行ログが
      // 手動リロードまで反映されない (`createTaskWithAi` と同じ pattern)。
      void triggerDecompose(id).finally(() => {
        queryClient.invalidateQueries({ queryKey: dashboardKeys.tasks });
        queryClient.invalidateQueries({ queryKey: dashboardKeys.decomposeLog(id) });
      });
    },
    [queryClient],
  );

  const triggerResplitWithOptimistic = useCallback(
    (id: string) => {
      // Issue #121 / ADR 0027: 子の再分解。optimistic に decomposing pill を出す。
      queryClient.setQueryData<Task[]>(dashboardKeys.tasks, (prev) =>
        (prev ?? []).map((t) => (t.id === id ? { ...t, decomposeStatus: "decomposing" } : t)),
      );
      queryClient.invalidateQueries({ queryKey: dashboardKeys.decomposeLog(id) });
      // server 側で target が delete される + 新規子が insert されるので、
      // 完了後 (成功 / 失敗 / skipped 問わず) に tasks を invalidate して refetch する。
      // .finally は fire-and-forget の void 返却と互換 (例外は triggerResplit 内で潰している)。
      void triggerResplit(id).finally(() => {
        queryClient.invalidateQueries({ queryKey: dashboardKeys.tasks });
      });
    },
    [queryClient],
  );

  return {
    toggleDone: (id) => toggleDoneMutation.mutate(id),
    updateBody: (id, body) => updateBodyMutation.mutate({ id, body }),
    updateDependency: (id, dependsOnEventId) =>
      updateDependencyMutation.mutate({ id, dependsOnEventId }),
    updateCategory: (id, taskCategory) => updateCategoryMutation.mutate({ id, taskCategory }),
    updateSize: (id, taskSize) => updateSizeMutation.mutate({ id, taskSize }),
    updateTaskProject,
    reorder,
    reorderGroup,
    createTaskWithAi,
    createEvent: (input) => createEventMutation.mutateAsync(input).then(() => undefined),
    updateEventProject: (id, projectId) => updateEventProjectMutation.mutate({ id, projectId }),
    updateEvent: (id, patch) =>
      updateEventMutation.mutateAsync({ id, patch }).then(() => undefined),
    deleteEvent: (id) => deleteEventMutation.mutateAsync(id).then(() => undefined),
    setEventVisibilityOverride: (id, value) =>
      setEventVisibilityOverrideMutation.mutateAsync({ id, value }).then(() => undefined),
    createProject: (input) => createProjectMutation.mutateAsync(input).then(() => undefined),
    updateProject: (id, patch) =>
      updateProjectMutation.mutateAsync({ id, patch }).then(() => undefined),
    deleteProject: (id) => deleteProjectMutation.mutateAsync(id).then(() => undefined),
    deleteTask: (id) => deleteTaskMutation.mutate(id),
    triggerDecomposeWithOptimistic,
    triggerResplitWithOptimistic,
  };
}
