"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ACTION_TYPES, log } from "@/entities/action-log/logger";
import type { CreateEventInput, UpdateEventInput } from "@/entities/event/gateway";
import type { Event } from "@/entities/event/types";
import type { CreateProjectInput, UpdateProjectInput } from "@/entities/project/gateway";
import { ProjectsProvider } from "@/entities/project/ProjectsContext";
import type { Project } from "@/entities/project/types";
import type { CreateTaskInput } from "@/entities/task/gateway";
import type { Task } from "@/entities/task/types";
import { AddButton } from "@/features/add-forms/AddButton";
import { AddPanel } from "@/features/add-forms/AddPanel";
import { DayTimeline } from "@/features/day-timeline/DayTimeline";
import { EventDetailPanel } from "@/features/event-detail/EventDetailPanel";
import { ProjectDetailPanel } from "@/features/project-detail/ProjectDetailPanel";
import { CalendarSyncButton } from "@/features/sync/CalendarSyncButton";
import { ReauthBanner } from "@/features/sync/ReauthBanner";
import { useCalendarSync } from "@/features/sync/useCalendarSync";
import { useLazyCalendarSync } from "@/features/sync/useLazyCalendarSync";
import { TaskDetailPanel } from "@/features/task-detail/TaskDetailPanel";
import { PauseReasonModal } from "@/features/task-stack/PauseReasonModal";
import { TaskStack, type TopTimerBinding } from "@/features/task-stack/TaskStack";
import { useTaskTimer } from "@/features/task-stack/useTaskTimer";
import { TreeView } from "@/features/tree-view/TreeView";
import { UserMenu } from "@/features/user-menu/UserMenu";
import type { PauseReason } from "@/entities/task/time-entries";
import { historyData } from "@/mocks/history";
import { clearAllUserData, seedSampleData } from "@/mocks/seed";
import {
  useEventGateway,
  useProjectGateway,
  useTaskGateway,
} from "@/shared/gateway/GatewayContext";
import { readSampleDataMode, writeSampleDataMode } from "@/shared/lib/sample-data";
import { isDone } from "@/shared/lib/task";
import { todayIso } from "@/shared/lib/time";

type View = "stack" | "tree";

type AppShellProps = {
  initialView: View;
  user: {
    email: string | null;
    avatarUrl: string | null;
  };
};

/**
 * Query key と「どの queryClient から書き換えるか」をここに集約する。
 * 各ミューテーションは optimistic update を同じキーに対して適用する。
 */
const keys = {
  projects: ["projects"] as const,
  tasks: ["tasks"] as const,
  events: ["events"] as const,
};

export function AppShell({ initialView, user }: AppShellProps) {
  const view = initialView;
  const taskGateway = useTaskGateway();
  const projectGateway = useProjectGateway();
  const eventGateway = useEventGateway();
  const queryClient = useQueryClient();
  const seedGateways = useMemo(
    () => ({ projectGateway, eventGateway, taskGateway }),
    [projectGateway, eventGateway, taskGateway],
  );

  const projectsQuery = useQuery({
    queryKey: keys.projects,
    queryFn: () => projectGateway.list(),
  });
  const tasksQuery = useQuery({
    queryKey: keys.tasks,
    queryFn: () => taskGateway.list(),
  });
  const eventsQuery = useQuery({
    queryKey: keys.events,
    queryFn: () => eventGateway.list(),
  });

  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const events = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data]);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [eventDetailId, setEventDetailId] = useState<string | null>(null);
  const [projectDetailId, setProjectDetailId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // ms 表現の「今」。SSR は 0 placeholder で hydration mismatch を回避し、
  // mount 後に実時刻へ差し替える。nowMin (タイムライン用) と依存イベント比較用に共用する。
  const [nowMs, setNowMs] = useState<number>(0);
  const today = useMemo(() => todayIso(), []);

  useEffect(() => {
    // マウント後にローカル時刻と同期する。SSR 時 nowMinutesOfDay() はブラウザ API 依存のため不可。
    /* eslint-disable react-hooks/set-state-in-effect */
    setNowMs(Date.now());
    /* eslint-enable react-hooks/set-state-in-effect */
    const id = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const nowMin = useMemo(() => {
    if (nowMs === 0) return 9 * 60;
    const d = new Date(nowMs);
    return d.getHours() * 60 + d.getMinutes();
  }, [nowMs]);

  // 初回ログイン時に自動 seed: 全テーブル空かつ「cleared」フラグ無しなら投入する。
  // ref ガードでストリクトモードでの 2 重 fire を防ぎつつ、ローディング完了後 1 回だけ実行。
  const seedingRef = useRef(false);
  useEffect(() => {
    if (seedingRef.current) return;
    if (!projectsQuery.isSuccess || !tasksQuery.isSuccess || !eventsQuery.isSuccess) {
      return;
    }
    if (readSampleDataMode() === "cleared") return;
    if (projects.length > 0 || tasks.length > 0 || events.length > 0) return;
    seedingRef.current = true;
    seedSampleData(seedGateways)
      .then(() => {
        writeSampleDataMode("default");
        return invalidateAll(queryClient);
      })
      .catch((err) => {
        // 失敗時に再試行ループへ入らないよう seedingRef は立てたまま。
        // ユーザー明示操作「サンプル再投入」で再試行できる。
        console.error("[seed] failed", err);
      });
  }, [
    projectsQuery.isSuccess,
    tasksQuery.isSuccess,
    eventsQuery.isSuccess,
    projects.length,
    tasks.length,
    events.length,
    seedGateways,
    queryClient,
  ]);

  // ---- Mutations (optimistic) ---------------------------------------------

  const toggleDoneMutation = useMutation({
    mutationFn: (id: string) => {
      const target = tasks.find((t) => t.id === id);
      if (!target) throw new Error("task not found");
      const nextDone = !isDone(target);
      return taskGateway.update(id, {
        status: nextDone ? "done" : "idle",
        completedAt: nextDone ? new Date().toISOString() : null,
      });
    },
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: keys.tasks });
      const previous = queryClient.getQueryData<Task[]>(keys.tasks);
      const target = previous?.find((t) => t.id === id);
      if (target && !isDone(target)) {
        log(ACTION_TYPES.TASK_COMPLETED, { task_id: id });
      }
      queryClient.setQueryData<Task[]>(keys.tasks, (prev) =>
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
      if (ctx?.previous) queryClient.setQueryData(keys.tasks, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: keys.tasks });
    },
  });

  const updateBodyMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) => taskGateway.update(id, { body }),
    onMutate: async ({ id, body }) => {
      await queryClient.cancelQueries({ queryKey: keys.tasks });
      const previous = queryClient.getQueryData<Task[]>(keys.tasks);
      queryClient.setQueryData<Task[]>(keys.tasks, (prev) =>
        (prev ?? []).map((t) => (t.id === id ? { ...t, body } : t)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(keys.tasks, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: keys.tasks });
    },
  });

  // P2-5 (#53): タスクの依存イベント設定。set / cleared を action_log に残し、
  // Phase 4 で「依存設定が着手順に効いたか」の分析データに使う。
  const updateDependencyMutation = useMutation({
    mutationFn: ({ id, dependsOnEventId }: { id: string; dependsOnEventId: string | null }) =>
      taskGateway.update(id, { dependsOnEventId }),
    onMutate: async ({ id, dependsOnEventId }) => {
      await queryClient.cancelQueries({ queryKey: keys.tasks });
      const previous = queryClient.getQueryData<Task[]>(keys.tasks);
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
      queryClient.setQueryData<Task[]>(keys.tasks, (prev) =>
        (prev ?? []).map((t) => (t.id === id ? { ...t, dependsOnEventId } : t)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(keys.tasks, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: keys.tasks });
    },
  });

  const reorderMutation = useMutation({
    mutationFn: (entries: { id: string; stackOrder: number | null }[]) =>
      taskGateway.reorder(entries),
    // DnD は optimistic で UI 側は onMutate で即反映、サーバー同期は背面で進める。
  });

  const createTaskMutation = useMutation({
    mutationFn: (input: CreateTaskInput) => taskGateway.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.tasks });
    },
  });

  const createEventMutation = useMutation({
    mutationFn: (input: CreateEventInput) => eventGateway.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.events });
    },
  });

  // ADR 0010 / P2-4: google_calendar イベントは project_id だけ kozutsumi 側で
  // 編集可。optimistic に反映し、失敗したら roll back する。
  const updateEventProjectMutation = useMutation({
    mutationFn: ({ id, projectId }: { id: string; projectId: string | null }) =>
      eventGateway.update(id, { projectId }),
    onMutate: async ({ id, projectId }) => {
      await queryClient.cancelQueries({ queryKey: keys.events });
      const previous = queryClient.getQueryData<Event[]>(keys.events);
      queryClient.setQueryData<Event[]>(keys.events, (prev) =>
        (prev ?? []).map((e) => (e.id === id ? { ...e, projectId } : e)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(keys.events, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: keys.events });
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
      await queryClient.cancelQueries({ queryKey: keys.events });
      const previous = queryClient.getQueryData<Event[]>(keys.events);
      queryClient.setQueryData<Event[]>(keys.events, (prev) =>
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
      if (ctx?.previous) queryClient.setQueryData(keys.events, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: keys.events });
    },
  });

  // ADR 0010: manual イベントだけが UI から削除可能。google_calendar は
  // SupabaseEventGateway.delete が source を見て弾く。
  const deleteEventMutation = useMutation({
    mutationFn: (id: string) => eventGateway.delete(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: keys.events });
      const previous = queryClient.getQueryData<Event[]>(keys.events);
      queryClient.setQueryData<Event[]>(keys.events, (prev) =>
        (prev ?? []).filter((e) => e.id !== id),
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(keys.events, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: keys.events });
    },
  });

  const createProjectMutation = useMutation({
    mutationFn: (input: CreateProjectInput) => projectGateway.create(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.projects });
    },
  });

  const updateProjectMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateProjectInput }) =>
      projectGateway.update(id, patch),
    onMutate: async ({ id, patch }) => {
      await queryClient.cancelQueries({ queryKey: keys.projects });
      const previous = queryClient.getQueryData<Project[]>(keys.projects);
      queryClient.setQueryData<Project[]>(keys.projects, (prev) =>
        (prev ?? []).map((p) => (p.id === id ? { ...p, ...patch } : p)),
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(keys.projects, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: keys.projects });
    },
  });

  // schema 上 `ON DELETE SET NULL` で tasks.project_id / events.project_id が
  // null 化される。UI 側はそれを反映するため tasks / events も invalidate する。
  const deleteProjectMutation = useMutation({
    mutationFn: (id: string) => projectGateway.delete(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: keys.projects });
      const previous = queryClient.getQueryData<Project[]>(keys.projects);
      queryClient.setQueryData<Project[]>(keys.projects, (prev) =>
        (prev ?? []).filter((p) => p.id !== id),
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(keys.projects, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: keys.projects });
      queryClient.invalidateQueries({ queryKey: keys.tasks });
      queryClient.invalidateQueries({ queryKey: keys.events });
    },
  });

  // タスク削除は TASK_DELETED action_log も記録する (SupabaseTaskGateway.delete 内)。
  const deleteTaskMutation = useMutation({
    mutationFn: (id: string) => taskGateway.delete(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: keys.tasks });
      const previous = queryClient.getQueryData<Task[]>(keys.tasks);
      queryClient.setQueryData<Task[]>(keys.tasks, (prev) =>
        (prev ?? []).filter((t) => t.id !== id),
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(keys.tasks, ctx.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: keys.tasks });
    },
  });

  const toggleDone = useCallback(
    (id: string) => toggleDoneMutation.mutate(id),
    [toggleDoneMutation],
  );

  const updateBody = useCallback(
    (id: string, body: string) => updateBodyMutation.mutate({ id, body }),
    [updateBodyMutation],
  );

  const reorder = useCallback(
    (fromIdx: number, toIdx: number) => {
      const cached = queryClient.getQueryData<Task[]>(keys.tasks) ?? [];
      const pending = cached.filter((t) => !isDone(t));
      const done = cached.filter((t) => isDone(t));
      if (fromIdx < 0 || fromIdx >= pending.length) return;
      if (toIdx < 0 || toIdx >= pending.length) return;
      const next = [...pending];
      const [item] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, item);
      const reordered = next.map((t, i) => ({ ...t, stackOrder: i }));
      queryClient.setQueryData<Task[]>(keys.tasks, [...reordered, ...done]);
      log(ACTION_TYPES.TASK_REORDERED, {
        task_id: item.id,
        from_position: fromIdx,
        to_position: toIdx,
      });
      reorderMutation.mutate(
        reordered.map((t) => ({ id: t.id, stackOrder: t.stackOrder })),
        {
          onError: () => {
            // 失敗したら再取得して辻褄を合わせる (UI は一瞬戻るが DB 正とする)
            queryClient.invalidateQueries({ queryKey: keys.tasks });
          },
        },
      );
    },
    [queryClient, reorderMutation],
  );

  const resetSample = useCallback(async () => {
    try {
      await clearAllUserData(seedGateways);
      await seedSampleData(seedGateways);
      writeSampleDataMode("default");
      await invalidateAll(queryClient);
    } catch (err) {
      console.error("[reset-sample] failed", err);
    }
  }, [seedGateways, queryClient]);

  const clearAll = useCallback(async () => {
    try {
      await clearAllUserData(seedGateways);
      writeSampleDataMode("cleared");
      setDetailId(null);
      setEventDetailId(null);
      await invalidateAll(queryClient);
    } catch (err) {
      console.error("[clear-all] failed", err);
    }
  }, [seedGateways, queryClient]);

  const pendingTasks = useMemo(() => tasks.filter((t) => !isDone(t)), [tasks]);
  const doneTasks = useMemo(() => tasks.filter((t) => isDone(t)), [tasks]);
  const detailTask = detailId ? tasks.find((t) => t.id === detailId) : null;
  const projectDetail = projectDetailId
    ? (projects.find((p) => p.id === projectDetailId) ?? null)
    : null;

  // タスクスタックのトップタスク = タイマー対象。
  // pendingTasks は stack_order 昇順なので [0] がトップ。
  const topTask = pendingTasks[0] ?? null;
  const timer = useTaskTimer(topTask);
  const [pauseModalOpen, setPauseModalOpen] = useState(false);

  const calendarSync = useCalendarSync();
  useLazyCalendarSync({ triggerSync: calendarSync.triggerSync });

  const topTimer = useMemo<TopTimerBinding>(
    () => ({
      elapsedSeconds: timer.elapsedSeconds,
      pauseReason: timer.pauseReason,
      onStart: () => {
        void timer.start();
      },
      onPauseRequest: () => setPauseModalOpen(true),
      onResume: () => {
        void timer.resume();
      },
      onComplete: () => {
        void timer.complete();
      },
    }),
    [timer],
  );

  const handlePauseSelect = useCallback(
    (reason: PauseReason) => {
      setPauseModalOpen(false);
      void timer.pause(reason);
    },
    [timer],
  );

  // Tree View は Phase 1 PoC では現行 mock history をそのまま描画する。
  // 将来: tasks where status='done' から生成する (docs/specs/phase1.md Tree View)
  const projectOrderForTree = useMemo(() => {
    if (projects.length === 0) {
      // history mock の projectId (slug) を fallback として並べる
      return Array.from(new Set(historyData.map((h) => h.projectId)));
    }
    return projects.map((p) => p.id);
  }, [projects]);

  const tabs: { key: View; label: string; href: string }[] = [
    { key: "stack", label: "Stack", href: "/" },
    { key: "tree", label: "Tree", href: "/tree" },
  ];

  return (
    <ProjectsProvider projects={mergeTreeProjects(projects, historyData)}>
      <div className="relative select-none">
        {/* Header */}
        <div className="sticky top-0 z-50 flex items-center gap-3 border-b border-bg-elevated bg-bg-primary px-5 pb-3 pt-4">
          <div className="font-jp text-[16px] font-bold -tracking-[0.02em]">
            <span className="text-accent-blue">kozu</span>
            <span className="text-fg-faint">tsumi</span>
          </div>
          <div className="flex-1" />
          <div className="flex rounded-md bg-bg-elevated p-0.5">
            {tabs.map((tab) => {
              const active = view === tab.key;
              return (
                <Link
                  key={tab.key}
                  href={tab.href}
                  className={`cursor-pointer rounded-[4px] px-3.5 py-1 text-[11px] font-medium no-underline ${
                    active ? "bg-bg-divider text-fg-emphasized" : "bg-transparent text-fg-weak"
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>
          <CalendarSyncButton
            isPending={calendarSync.isPending}
            lastSyncedAt={calendarSync.lastSyncedAt}
            onClick={() => calendarSync.triggerSync("manual")}
          />
          <UserMenu
            email={user.email}
            avatarUrl={user.avatarUrl}
            onResetSample={resetSample}
            onClearAll={clearAll}
          />
        </div>

        <ReauthBanner visible={calendarSync.needsReauth} onDismiss={calendarSync.dismissReauth} />

        {view === "stack" ? (
          <StackView
            events={events}
            pendingTasks={pendingTasks}
            doneTasks={doneTasks}
            topTimer={topTimer}
            toggleDone={toggleDone}
            reorder={reorder}
            nowMin={nowMin}
            now={nowMs}
            today={today}
            onOpenDetail={setDetailId}
            onOpenEvent={setEventDetailId}
          />
        ) : (
          <TreeView historyData={historyData} projectOrder={projectOrderForTree} />
        )}

        {detailTask && (
          <TaskDetailPanel
            task={detailTask}
            events={events}
            now={nowMs}
            onClose={() => setDetailId(null)}
            onUpdate={updateBody}
            onToggleDone={toggleDone}
            onDelete={(id) => deleteTaskMutation.mutate(id)}
            onChangeDependency={(id, dependsOnEventId) =>
              updateDependencyMutation.mutate({ id, dependsOnEventId })
            }
          />
        )}

        {eventDetailId &&
          (() => {
            const ev = events.find((e) => e.id === eventDetailId);
            return ev ? (
              <EventDetailPanel
                event={ev}
                onClose={() => setEventDetailId(null)}
                onChangeProject={(id, projectId) =>
                  updateEventProjectMutation.mutate({ id, projectId })
                }
                onUpdate={async (id, patch) => {
                  await updateEventMutation.mutateAsync({ id, patch });
                }}
                onDelete={async (id) => {
                  await deleteEventMutation.mutateAsync(id);
                }}
              />
            ) : null;
          })()}

        <AddButton onClick={() => setAddOpen(true)} />

        {addOpen ? (
          <AddPanel
            projects={projects}
            events={events}
            onClose={() => setAddOpen(false)}
            onCreateTask={async (input) => {
              // stackOrder は末尾に割り当て (pending 件数)
              const stackOrder = pendingTasks.length;
              await createTaskMutation.mutateAsync({ ...input, stackOrder });
            }}
            onCreateEvent={async (input) => {
              await createEventMutation.mutateAsync(input);
            }}
            onCreateProject={async (input) => {
              await createProjectMutation.mutateAsync(input);
            }}
            onOpenProject={setProjectDetailId}
          />
        ) : null}

        {projectDetail && (
          <ProjectDetailPanel
            project={projectDetail}
            onClose={() => setProjectDetailId(null)}
            onUpdate={async (id, patch) => {
              await updateProjectMutation.mutateAsync({ id, patch });
            }}
            onDelete={async (id) => {
              await deleteProjectMutation.mutateAsync(id);
            }}
          />
        )}

        {pauseModalOpen ? (
          <PauseReasonModal onSelect={handlePauseSelect} onClose={() => setPauseModalOpen(false)} />
        ) : null}
      </div>
    </ProjectsProvider>
  );
}

async function invalidateAll(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: keys.projects }),
    queryClient.invalidateQueries({ queryKey: keys.tasks }),
    queryClient.invalidateQueries({ queryKey: keys.events }),
  ]);
}

/**
 * Tree View の mock history が参照する旧 slug (`career` 等) を、
 * 同名シードが DB にある場合はその Project として、
 * 無い場合は PROJECT_SEEDS 由来の fallback Project として補完する。
 */
function mergeTreeProjects(
  projects: readonly Project[],
  history: readonly { projectId: string }[],
): Project[] {
  const known = new Set(projects.map((p) => p.id));
  const missing = Array.from(
    new Set(history.map((h) => h.projectId).filter((id) => !known.has(id))),
  );
  const result = [...projects];
  for (const slug of missing) {
    const seed = TREE_FALLBACK_BY_SLUG.get(slug);
    result.push(
      seed ?? {
        id: slug,
        name: slug,
        color: "#52525b",
        isPrimary: false,
        createdAt: "",
      },
    );
  }
  return result;
}

// PROJECT_SEEDS を import すると循環が見えにくくなるので、slug→Project をここで簡易定義。
// history (mock) に現れる slug 群だけ埋めれば十分。
const TREE_FALLBACK_BY_SLUG: ReadonlyMap<string, Project> = new Map([
  ["career", { id: "career", name: "転職活動", color: "#E85D04", isPrimary: false, createdAt: "" }],
  [
    "loadtest",
    { id: "loadtest", name: "負荷試験", color: "#0096C7", isPrimary: false, createdAt: "" },
  ],
  ["slo", { id: "slo", name: "SLO推進", color: "#2D9F45", isPrimary: true, createdAt: "" }],
  ["tasuki", { id: "tasuki", name: "Tasuki", color: "#9B5DE5", isPrimary: false, createdAt: "" }],
]);

type StackViewProps = {
  events: Event[];
  pendingTasks: Task[];
  doneTasks: Task[];
  topTimer: TopTimerBinding;
  toggleDone: (id: string) => void;
  reorder: (from: number, to: number) => void;
  nowMin: number;
  now: number;
  today: string;
  onOpenDetail: (id: string) => void;
  onOpenEvent: (id: string) => void;
};

function StackView({
  events,
  pendingTasks,
  doneTasks,
  topTimer,
  toggleDone,
  reorder,
  nowMin,
  now,
  today,
  onOpenDetail,
  onOpenEvent,
}: StackViewProps) {
  return (
    <div className="pb-[100px]">
      <DayTimeline events={events} nowMin={nowMin} today={today} onOpenEvent={onOpenEvent} />
      <TaskStack
        events={events}
        pendingTasks={pendingTasks}
        doneTasks={doneTasks}
        topTimer={topTimer}
        now={now}
        onReorder={reorder}
        onToggleDone={toggleDone}
        onOpenDetail={onOpenDetail}
      />
    </div>
  );
}
