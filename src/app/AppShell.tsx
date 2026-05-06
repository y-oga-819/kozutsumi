"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { useAutoSeed } from "./useAutoSeed";
import {
  dashboardKeys as keys,
  invalidateDashboardData as invalidateAll,
  useDashboardQueries,
} from "./useDashboardQueries";
import { useDashboardMutations } from "./useDashboardMutations";
import { useNowClock } from "./useNowClock";
import { useTopTaskTimer } from "./useTopTaskTimer";
import type { Event } from "@/entities/event/types";
import { ProjectsProvider } from "@/entities/project/ProjectsContext";
import { CorrectionFactorsProvider } from "@/entities/task/CorrectionFactorsContext";
import type { Task } from "@/entities/task/types";
import { AddButton } from "@/features/add-forms/AddButton";
import { AddPanel } from "@/features/add-forms/AddPanel";
import { DayTimeline } from "@/features/day-timeline/DayTimeline";
import { EventDetailPanel } from "@/features/event-detail/EventDetailPanel";
import { EventManagement } from "@/features/event-management/EventManagement";
import { ProjectDetailPanel } from "@/features/project-detail/ProjectDetailPanel";
import { SettingsPanel } from "@/features/settings/SettingsPanel";
import { CalendarSyncButton } from "@/features/sync/CalendarSyncButton";
import { ReauthBanner } from "@/features/sync/ReauthBanner";
import { SyncSkippedBanner } from "@/features/sync/SyncSkippedBanner";
import { useCalendarSync } from "@/features/sync/useCalendarSync";
import { useLazyCalendarSync } from "@/features/sync/useLazyCalendarSync";
import { TaskDetailPanel } from "@/features/task-detail/TaskDetailPanel";
import { PauseReasonModal } from "@/features/task-stack/PauseReasonModal";
import { TaskStack, type TopTimerBinding } from "@/features/task-stack/TaskStack";
import { computeProjectOrderForTree, mergeTreeProjects } from "@/features/tree-view/fallback";
import { TreeView } from "@/features/tree-view/TreeView";
import { UserMenu } from "@/features/user-menu/UserMenu";
import { historyData } from "@/mocks/history";
import { clearAllUserData, seedSampleData } from "@/mocks/seed";
import {
  useActionLogGateway,
  useEventGateway,
  useProjectGateway,
  useTaskGateway,
} from "@/shared/gateway/GatewayContext";
import { writeSampleDataMode } from "@/shared/lib/sample-data";
import { todayIso } from "@/shared/lib/time";

type View = "stack" | "tree" | "events";

type AppShellProps = {
  initialView: View;
  /**
   * `AI_ENABLED` kill-switch (`isAiEnabled()` の評価結果)。`/api/ai/*` の入口で
   * 同じ値を見て early-return するため、UI 側でも一致させて再実行ボタンを
   * 無駄に enable しないようにする。Server Component 側で `process.env` を読んで渡す。
   */
  aiEnabled: boolean;
  user: {
    email: string | null;
    avatarUrl: string | null;
  };
};

export function AppShell({ initialView, aiEnabled, user }: AppShellProps) {
  const view = initialView;
  const taskGateway = useTaskGateway();
  const projectGateway = useProjectGateway();
  const eventGateway = useEventGateway();
  const actionLogGateway = useActionLogGateway();
  const queryClient = useQueryClient();
  const seedGateways = useMemo(
    () => ({ projectGateway, eventGateway, taskGateway }),
    [projectGateway, eventGateway, taskGateway],
  );

  const {
    projectsQuery,
    tasksQuery,
    eventsQuery,
    projects,
    tasks,
    events,
    correctionFactors,
    calendarSubscriptions,
    pendingTasks,
    doneTasks,
  } = useDashboardQueries();

  const [detailId, setDetailId] = useState<string | null>(null);
  const [eventDetailId, setEventDetailId] = useState<string | null>(null);
  const [projectDetailId, setProjectDetailId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // P3-15 / ADR 0021 §3: 詳細パネル open 時に当該タスクの AI 分解最新試行を 1 件だけ fetch。
  // detailId が null の間は無効化して supabase を叩かない。
  const decomposeLogQuery = useQuery({
    queryKey: detailId ? keys.decomposeLog(detailId) : ["actionLog", "decompose", "_idle"],
    queryFn: () => {
      if (!detailId) return Promise.resolve(null);
      return actionLogGateway.getLatestDecomposeForTask(detailId);
    },
    enabled: detailId !== null,
  });
  const { nowMs, nowMin } = useNowClock();
  const today = useMemo(() => todayIso(), []);

  const onSeeded = useCallback(() => invalidateAll(queryClient), [queryClient]);
  useAutoSeed({
    ready: projectsQuery.isSuccess && tasksQuery.isSuccess && eventsQuery.isSuccess,
    isEmpty: projects.length === 0 && tasks.length === 0 && events.length === 0,
    gateways: seedGateways,
    onSeeded,
  });

  const {
    toggleDone,
    updateBody,
    updateDependency,
    updateCategory,
    updateSize,
    updateTaskProject,
    reorder,
    reorderGroup,
    createTaskWithAi,
    createEvent,
    updateEventProject,
    updateEvent,
    deleteEvent,
    setEventVisibilityOverride,
    createProject,
    updateProject,
    deleteProject,
    deleteTask,
    triggerDecomposeWithOptimistic,
    triggerResplitWithOptimistic,
  } = useDashboardMutations();

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

  const detailTask = detailId ? tasks.find((t) => t.id === detailId) : null;
  const projectDetail = projectDetailId
    ? (projects.find((p) => p.id === projectDetailId) ?? null)
    : null;

  // タスクスタックのトップタスク = タイマー対象。
  // pendingTasks は stack_order 昇順なので [0] がトップ。
  const { topTimer, pauseModalOpen, setPauseModalOpen, handlePauseSelect } = useTopTaskTimer(
    pendingTasks[0] ?? null,
  );

  const calendarSync = useCalendarSync();
  useLazyCalendarSync({ triggerSync: calendarSync.triggerSync });

  // Tree View は Phase 1 PoC では現行 mock history をそのまま描画する。
  // 将来: tasks where status='done' から生成する (docs/specs/phase1.md Tree View)
  const projectOrderForTree = useMemo(
    () => computeProjectOrderForTree(projects, historyData),
    [projects],
  );
  const treeProjects = useMemo(() => mergeTreeProjects(projects, historyData), [projects]);

  // Issue #145: tree タブ (Phase 1 PoC) は dogfooding でメンテされていないため
  // 動線を「予定管理」に差し替える。/tree route 自体は残す (直接 URL では到達可能)。
  const tabs: { key: View; label: string; href: string }[] = [
    { key: "stack", label: "Stack", href: "/" },
    { key: "events", label: "予定", href: "/events" },
  ];

  return (
    <ProjectsProvider projects={treeProjects}>
      <CorrectionFactorsProvider factors={correctionFactors}>
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
              onOpenSettings={() => setSettingsOpen(true)}
            />
          </div>

          <ReauthBanner visible={calendarSync.needsReauth} onDismiss={calendarSync.dismissReauth} />
          <SyncSkippedBanner />

          {view === "stack" ? (
            <StackView
              events={events}
              calendarSubscriptions={calendarSubscriptions}
              pendingTasks={pendingTasks}
              doneTasks={doneTasks}
              topTimer={topTimer}
              toggleDone={toggleDone}
              reorder={reorder}
              reorderGroup={reorderGroup}
              nowMin={nowMin}
              now={nowMs}
              today={today}
              onOpenDetail={setDetailId}
              onOpenEvent={setEventDetailId}
            />
          ) : view === "events" ? (
            <EventManagement
              events={events}
              subscriptions={calendarSubscriptions}
              onSetVisibilityOverride={setEventVisibilityOverride}
              onOpenEvent={setEventDetailId}
            />
          ) : (
            <TreeView historyData={historyData} projectOrder={projectOrderForTree} />
          )}

          {detailTask && (
            <TaskDetailPanel
              task={detailTask}
              events={events}
              tasks={tasks}
              now={nowMs}
              onClose={() => setDetailId(null)}
              onUpdate={updateBody}
              onToggleDone={toggleDone}
              onDelete={deleteTask}
              onChangeDependency={updateDependency}
              onChangeCategory={updateCategory}
              onChangeSize={updateSize}
              onChangeProject={updateTaskProject}
              aiEnabled={aiEnabled}
              latestDecomposeLog={decomposeLogQuery.data ?? null}
              isDecomposeLogLoading={decomposeLogQuery.isPending}
              onTriggerDecompose={triggerDecomposeWithOptimistic}
              onTriggerResplit={triggerResplitWithOptimistic}
            />
          )}

          {eventDetailId &&
            (() => {
              const ev = events.find((e) => e.id === eventDetailId);
              if (!ev) return null;
              const sub = calendarSubscriptions.find(
                (s) => s.source === ev.source && s.externalCalendarId === ev.externalCalendarId,
              );
              // manual / orphan は subscription を持たないので default 表示扱い (ADR 0032)。
              const subscriptionAutoPromote = sub ? sub.autoPromoteToTimeline : true;
              return (
                <EventDetailPanel
                  event={ev}
                  onClose={() => setEventDetailId(null)}
                  onChangeProject={updateEventProject}
                  onUpdate={updateEvent}
                  onDelete={deleteEvent}
                  onSetVisibilityOverride={setEventVisibilityOverride}
                  subscriptionAutoPromote={subscriptionAutoPromote}
                />
              );
            })()}

          <AddButton onClick={() => setAddOpen(true)} />

          {addOpen ? (
            <AddPanel
              projects={projects}
              events={events}
              onClose={() => setAddOpen(false)}
              onCreateTask={(input) => createTaskWithAi(input)}
              onCreateEvent={createEvent}
              onCreateProject={createProject}
              onOpenProject={setProjectDetailId}
            />
          ) : null}

          {projectDetail && (
            <ProjectDetailPanel
              project={projectDetail}
              onClose={() => setProjectDetailId(null)}
              onUpdate={updateProject}
              onDelete={deleteProject}
            />
          )}

          {pauseModalOpen ? (
            <PauseReasonModal
              onSelect={handlePauseSelect}
              onClose={() => setPauseModalOpen(false)}
            />
          ) : null}

          <SettingsPanel
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            primaryExternalAccountId={calendarSubscriptions[0]?.externalAccountId ?? null}
            events={events}
            onSetVisibilityOverride={setEventVisibilityOverride}
          />
        </div>
      </CorrectionFactorsProvider>
    </ProjectsProvider>
  );
}

type StackViewProps = {
  events: Event[];
  calendarSubscriptions: readonly {
    source: string;
    externalCalendarId: string;
    autoPromoteToTimeline: boolean;
  }[];
  pendingTasks: Task[];
  doneTasks: Task[];
  topTimer: TopTimerBinding;
  toggleDone: (id: string) => void;
  reorder: (fromId: string, toId: string) => void;
  reorderGroup: (parentTaskId: string, toId: string) => void;
  nowMin: number;
  now: number;
  today: string;
  onOpenDetail: (id: string) => void;
  onOpenEvent: (id: string) => void;
};

function StackView({
  events,
  calendarSubscriptions,
  pendingTasks,
  doneTasks,
  topTimer,
  toggleDone,
  reorder,
  reorderGroup,
  nowMin,
  now,
  today,
  onOpenDetail,
  onOpenEvent,
}: StackViewProps) {
  return (
    <div className="pb-[100px]">
      <DayTimeline
        events={events}
        subscriptions={calendarSubscriptions}
        nowMin={nowMin}
        today={today}
        onOpenEvent={onOpenEvent}
      />
      <TaskStack
        events={events}
        pendingTasks={pendingTasks}
        doneTasks={doneTasks}
        topTimer={topTimer}
        now={now}
        onReorder={reorder}
        onReorderGroup={reorderGroup}
        onToggleDone={toggleDone}
        onOpenDetail={onOpenDetail}
      />
    </div>
  );
}
