"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { dashboardKeys } from "./useDashboardQueries";
import { ACTION_TYPES, log } from "@/entities/action-log/logger";
import type { CreateEventInput, UpdateEventInput } from "@/entities/event/gateway";
import type { Event } from "@/entities/event/types";
import type { CreateProjectInput, UpdateProjectInput } from "@/entities/project/gateway";
import type { Project } from "@/entities/project/types";
import type { CreateTaskInput } from "@/entities/task/gateway";
import type { Task, TaskCategory, TaskSize } from "@/entities/task/types";
import { reorderTasksById } from "@/features/task-stack/reorderTasks";
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
  /** DnD でのタスク並び替え。action_log: TASK_REORDERED。 */
  reorder: (fromId: string, toId: string) => void;
  /**
   * AddPanel からのタスク作成。タスク insert 後に AI 分解 + AI category 推論を
   * fire-and-forget で投げる (P3-4 / P3-6, ADR 0015 / 0017)。
   */
  createTaskWithAi: (input: CreateTaskInput, stackOrder: number) => Promise<void>;
  createEvent: (input: CreateEventInput) => Promise<void>;
  /** ADR 0010: google_calendar event の project_id だけ kozutsumi 側で編集可。 */
  updateEventProject: (id: string, projectId: string | null) => void;
  /** ADR 0010: manual event の全フィールド編集。 */
  updateEvent: (id: string, patch: UpdateEventInput) => Promise<void>;
  /** ADR 0010: manual event の削除。google_calendar は gateway 側で弾く。 */
  deleteEvent: (id: string) => Promise<void>;
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

  const createTaskWithAi = useCallback(
    async (input: CreateTaskInput, stackOrder: number) => {
      const created = await createTaskMutation.mutateAsync({ ...input, stackOrder });
      // P3-6 / ADR 0017: タスク作成成功後に AI 分解を fire-and-forget で投げる。
      // server 側でも `decompose_status='decomposing'` に倒すが、UI に分解中 pill を
      // 即時出すため optimistic に cache を書き換える。AI_ENABLED=false / 失敗時は
      // server が `none` に戻す (decompose-server の guard 経路)。
      //
      // issue #167: cancelQueries を挟むことで「他経路で in-flight な tasks refetch
      // (例: focus 戻り後の自動 refetch / 並走するイベント refetch) が
      // setQueryData('decomposing') を上書きする」競合を防ぐ。
      await queryClient.cancelQueries({ queryKey: dashboardKeys.tasks });
      queryClient.setQueryData<Task[]>(dashboardKeys.tasks, (prev) => {
        const list = prev ?? [];
        const found = list.some((t) => t.id === created.id);
        const updated = { ...created, decomposeStatus: "decomposing" as const };
        return found
          ? list.map((t) => (t.id === created.id ? { ...t, decomposeStatus: "decomposing" } : t))
          : [...list, updated];
      });
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
    [createTaskMutation, queryClient],
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
    reorder,
    createTaskWithAi,
    createEvent: (input) => createEventMutation.mutateAsync(input).then(() => undefined),
    updateEventProject: (id, projectId) => updateEventProjectMutation.mutate({ id, projectId }),
    updateEvent: (id, patch) =>
      updateEventMutation.mutateAsync({ id, patch }).then(() => undefined),
    deleteEvent: (id) => deleteEventMutation.mutateAsync(id).then(() => undefined),
    createProject: (input) => createProjectMutation.mutateAsync(input).then(() => undefined),
    updateProject: (id, patch) =>
      updateProjectMutation.mutateAsync({ id, patch }).then(() => undefined),
    deleteProject: (id) => deleteProjectMutation.mutateAsync(id).then(() => undefined),
    deleteTask: (id) => deleteTaskMutation.mutate(id),
    triggerDecomposeWithOptimistic,
    triggerResplitWithOptimistic,
  };
}
