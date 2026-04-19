"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ACTION_TYPES, log } from "@/entities/action-log/logger";
import {
  createEvent as apiCreateEvent,
  listEvents,
  type CreateEventInput,
} from "@/entities/event/api";
import type { Event } from "@/entities/event/types";
import {
  createProject as apiCreateProject,
  listProjects,
  type CreateProjectInput,
} from "@/entities/project/api";
import { ProjectsProvider } from "@/entities/project/ProjectsContext";
import type { Project } from "@/entities/project/types";
import {
  createTask as apiCreateTask,
  deleteTask as apiDeleteTask,
  listTasks,
  reorderTasks as apiReorderTasks,
  updateTask as apiUpdateTask,
  type CreateTaskInput,
} from "@/entities/task/api";
import type { Task } from "@/entities/task/types";
import { AddButton } from "@/features/add-forms/AddButton";
import { AddPanel } from "@/features/add-forms/AddPanel";
import { DayTimeline } from "@/features/day-timeline/DayTimeline";
import { EventDetailPanel } from "@/features/event-detail/EventDetailPanel";
import { TaskDetailPanel } from "@/features/task-detail/TaskDetailPanel";
import { TaskStack } from "@/features/task-stack/TaskStack";
import { TreeView } from "@/features/tree-view/TreeView";
import { UserMenu } from "@/features/user-menu/UserMenu";
import { historyData } from "@/mocks/history";
import { clearAllUserData, seedSampleDataToSupabase } from "@/mocks/seed";
import {
  readSampleDataMode,
  writeSampleDataMode,
} from "@/shared/lib/sample-data";
import { isDone } from "@/shared/lib/task";
import { nowMinutesOfDay, todayIso } from "@/shared/lib/time";
import { createClient } from "@/shared/supabase/client";

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
  const supabase = useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  const projectsQuery = useQuery({
    queryKey: keys.projects,
    queryFn: () => listProjects(supabase),
  });
  const tasksQuery = useQuery({
    queryKey: keys.tasks,
    queryFn: () => listTasks(supabase),
  });
  const eventsQuery = useQuery({
    queryKey: keys.events,
    queryFn: () => listEvents(supabase),
  });

  const projects = useMemo(
    () => projectsQuery.data ?? [],
    [projectsQuery.data],
  );
  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const events = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data]);

  const [detailId, setDetailId] = useState<string | null>(null);
  const [eventDetailId, setEventDetailId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [nowMin, setNowMin] = useState<number>(9 * 60);
  const today = useMemo(() => todayIso(), []);

  useEffect(() => {
    // マウント後にローカル時刻と同期する。SSR 時 nowMinutesOfDay() はブラウザ API 依存のため不可。
    /* eslint-disable react-hooks/set-state-in-effect */
    setNowMin(nowMinutesOfDay());
    /* eslint-enable react-hooks/set-state-in-effect */
    const id = window.setInterval(() => setNowMin(nowMinutesOfDay()), 60_000);
    return () => window.clearInterval(id);
  }, []);

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
    seedSampleDataToSupabase(supabase)
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
    supabase,
    queryClient,
  ]);

  // ---- Mutations (optimistic) ---------------------------------------------

  const toggleDoneMutation = useMutation({
    mutationFn: (id: string) => {
      const target = tasks.find((t) => t.id === id);
      if (!target) throw new Error("task not found");
      const nextDone = !isDone(target);
      return apiUpdateTask(supabase, id, {
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
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      apiUpdateTask(supabase, id, { body }),
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

  const reorderMutation = useMutation({
    mutationFn: (entries: { id: string; stackOrder: number | null }[]) =>
      apiReorderTasks(supabase, entries),
    // DnD は optimistic で UI 側は onMutate で即反映、サーバー同期は背面で進める。
  });

  const createTaskMutation = useMutation({
    mutationFn: (input: CreateTaskInput) => apiCreateTask(supabase, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.tasks });
    },
  });

  const createEventMutation = useMutation({
    mutationFn: (input: CreateEventInput) => apiCreateEvent(supabase, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.events });
    },
  });

  const createProjectMutation = useMutation({
    mutationFn: (input: CreateProjectInput) => apiCreateProject(supabase, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.projects });
    },
  });

  // タスク削除は TASK_DELETED action_log も記録する (api.ts の deleteTask 内)。
  const deleteTaskMutation = useMutation({
    mutationFn: (id: string) => apiDeleteTask(supabase, id),
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
      await clearAllUserData(supabase);
      await seedSampleDataToSupabase(supabase);
      writeSampleDataMode("default");
      await invalidateAll(queryClient);
    } catch (err) {
      console.error("[reset-sample] failed", err);
    }
  }, [supabase, queryClient]);

  const clearAll = useCallback(async () => {
    try {
      await clearAllUserData(supabase);
      writeSampleDataMode("cleared");
      setDetailId(null);
      setEventDetailId(null);
      await invalidateAll(queryClient);
    } catch (err) {
      console.error("[clear-all] failed", err);
    }
  }, [supabase, queryClient]);

  const pendingTasks = useMemo(
    () => tasks.filter((t) => !isDone(t)),
    [tasks],
  );
  const doneTasks = useMemo(() => tasks.filter((t) => isDone(t)), [tasks]);
  const detailTask = detailId ? tasks.find((t) => t.id === detailId) : null;

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
                    active
                      ? "bg-bg-divider text-fg-emphasized"
                      : "bg-transparent text-fg-weak"
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>
          <UserMenu
            email={user.email}
            avatarUrl={user.avatarUrl}
            onResetSample={resetSample}
            onClearAll={clearAll}
          />
        </div>

        {view === "stack" ? (
          <StackView
            events={events}
            pendingTasks={pendingTasks}
            doneTasks={doneTasks}
            toggleDone={toggleDone}
            reorder={reorder}
            nowMin={nowMin}
            today={today}
            onOpenDetail={setDetailId}
            onOpenEvent={setEventDetailId}
          />
        ) : (
          <TreeView
            historyData={historyData}
            projectOrder={projectOrderForTree}
          />
        )}

        {detailTask && (
          <TaskDetailPanel
            task={detailTask}
            events={events}
            onClose={() => setDetailId(null)}
            onUpdate={updateBody}
            onToggleDone={toggleDone}
            onDelete={(id) => deleteTaskMutation.mutate(id)}
          />
        )}

        {eventDetailId &&
          (() => {
            const ev = events.find((e) => e.id === eventDetailId);
            return ev ? (
              <EventDetailPanel
                event={ev}
                onClose={() => setEventDetailId(null)}
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
          />
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
  ["loadtest", { id: "loadtest", name: "負荷試験", color: "#0096C7", isPrimary: false, createdAt: "" }],
  ["slo", { id: "slo", name: "SLO推進", color: "#2D9F45", isPrimary: true, createdAt: "" }],
  ["tasuki", { id: "tasuki", name: "Tasuki", color: "#9B5DE5", isPrimary: false, createdAt: "" }],
]);

type StackViewProps = {
  events: Event[];
  pendingTasks: Task[];
  doneTasks: Task[];
  toggleDone: (id: string) => void;
  reorder: (from: number, to: number) => void;
  nowMin: number;
  today: string;
  onOpenDetail: (id: string) => void;
  onOpenEvent: (id: string) => void;
};

function StackView({
  events,
  pendingTasks,
  doneTasks,
  toggleDone,
  reorder,
  nowMin,
  today,
  onOpenDetail,
  onOpenEvent,
}: StackViewProps) {
  return (
    <div className="pb-[100px]">
      <DayTimeline
        events={events}
        nowMin={nowMin}
        today={today}
        onOpenEvent={onOpenEvent}
      />
      <TaskStack
        events={events}
        pendingTasks={pendingTasks}
        doneTasks={doneTasks}
        onReorder={reorder}
        onToggleDone={toggleDone}
        onOpenDetail={onOpenDetail}
      />
    </div>
  );
}
