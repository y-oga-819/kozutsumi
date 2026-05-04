"use client";

import { type QueryClient, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { Event } from "@/entities/event/types";
import type { Project } from "@/entities/project/types";
import type { CorrectionFactor } from "@/entities/task/correction";
import type { Task } from "@/entities/task/types";
import {
  useEventGateway,
  useProjectGateway,
  useTaskGateway,
} from "@/shared/gateway/GatewayContext";
import { isDone } from "@/shared/lib/task";

/**
 * Query key と「どの queryClient から書き換えるか」をここに集約する。
 * 各ミューテーションは optimistic update を同じキーに対して適用する。
 */
export const dashboardKeys = {
  projects: ["projects"] as const,
  tasks: ["tasks"] as const,
  events: ["events"] as const,
  /** 詳細パネル (P3-15) で fetch する AI 分解の最新試行ログ。タスク id 単位で分離する。 */
  decomposeLog: (taskId: string) => ["actionLog", "decompose", taskId] as const,
  /** 見積もり補正倍率 (P3-9 / #93、ADR 0025): user-scoped、view 経由で取る。 */
  correctionFactors: ["correctionFactors"] as const,
};

export type DashboardQueries = {
  projectsQuery: ReturnType<typeof useQuery<Project[]>>;
  tasksQuery: ReturnType<typeof useQuery<Task[]>>;
  eventsQuery: ReturnType<typeof useQuery<Event[]>>;
  correctionFactorsQuery: ReturnType<typeof useQuery<readonly CorrectionFactor[]>>;
  /** projectsQuery.data ?? [] (参照安定) */
  projects: Project[];
  /** tasksQuery.data ?? [] (参照安定) */
  tasks: Task[];
  /** eventsQuery.data ?? [] (参照安定) */
  events: Event[];
  /** correctionFactorsQuery.data ?? [] (参照安定、未取得・失敗時は空配列 = 全タスク補正なし) */
  correctionFactors: readonly CorrectionFactor[];
  pendingTasks: Task[];
  doneTasks: Task[];
};

/**
 * AppShell の主データ fetch を集約した hook。
 *
 * - projects / tasks / events: 主要 3 リソース。各 mutation の optimistic update 先。
 * - correctionFactors: 見積もり補正倍率 (ADR 0024 / 0025)。augmentation なので空 = 補正なし。
 * - pendingTasks / doneTasks: tasks の派生。
 *
 * decomposeLogQuery は詳細パネル open 時のみ fetch する性質 (detailId 依存) のため
 * AppShell 側に残し、ここでは key だけ提供する (`dashboardKeys.decomposeLog(id)`)。
 */
export function useDashboardQueries(): DashboardQueries {
  const taskGateway = useTaskGateway();
  const projectGateway = useProjectGateway();
  const eventGateway = useEventGateway();

  const projectsQuery = useQuery({
    queryKey: dashboardKeys.projects,
    queryFn: () => projectGateway.list(),
  });
  const tasksQuery = useQuery({
    queryKey: dashboardKeys.tasks,
    queryFn: () => taskGateway.list(),
  });
  const eventsQuery = useQuery({
    queryKey: dashboardKeys.events,
    queryFn: () => eventGateway.list(),
  });

  // P3-9 / #93: 見積もり補正倍率 (ADR 0024 / 0025)。
  // 補正は augmentation (ADR 0013) なので未取得 / fetch 失敗は空配列扱い (= 全タスク補正なし)。
  // staleTime を長めにして、タスク完了のたびに再取得しない (補正値の鋭敏な更新は不要)。
  const correctionFactorsQuery = useQuery({
    queryKey: dashboardKeys.correctionFactors,
    queryFn: () => taskGateway.listCorrectionFactors(),
    staleTime: 5 * 60_000,
  });

  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const tasks = useMemo(() => tasksQuery.data ?? [], [tasksQuery.data]);
  const events = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data]);
  const correctionFactors = useMemo<readonly CorrectionFactor[]>(
    () => correctionFactorsQuery.data ?? [],
    [correctionFactorsQuery.data],
  );

  const pendingTasks = useMemo(() => tasks.filter((t) => !isDone(t)), [tasks]);
  const doneTasks = useMemo(() => tasks.filter((t) => isDone(t)), [tasks]);

  return {
    projectsQuery,
    tasksQuery,
    eventsQuery,
    correctionFactorsQuery,
    projects,
    tasks,
    events,
    correctionFactors,
    pendingTasks,
    doneTasks,
  };
}

/**
 * projects / tasks / events を一括で invalidate する。
 * 自動 seed 完了後 / sample data の reset / clearAll 後に呼ぶ。
 */
export async function invalidateDashboardData(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: dashboardKeys.projects }),
    queryClient.invalidateQueries({ queryKey: dashboardKeys.tasks }),
    queryClient.invalidateQueries({ queryKey: dashboardKeys.events }),
  ]);
}
