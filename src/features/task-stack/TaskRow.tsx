import type { PointerEvent as ReactPointerEvent } from "react";

import { getProject } from "@/entities/project/projects";
import { useProjects } from "@/entities/project/ProjectsContext";
import type { Event } from "@/entities/event/types";
import { useCorrectionFactors } from "@/entities/task/CorrectionFactorsContext";
import { correctEstimate } from "@/entities/task/correction";
import type { Task } from "@/entities/task/types";
import { ParallelogramProgress } from "@/shared/ui/ParallelogramProgress";
import { IMMINENT_THRESHOLD_MS, formatRelativeTime } from "@/shared/lib/time";

import { CorrectedEstimate } from "./CorrectedEstimate";
import { Grip } from "./Grip";
import type { Progress } from "./stackItems";
import { StatusPill } from "./StatusPill";

/**
 * Stack View の行カード (Top 以外) (ADR 0016 §3)。
 *
 * 3 行構成:
 * - Row 1: Grip + ProjectDot + title (左) + estimate (右)
 * - Row 2: dep event (右詰) ※子は親の dep に fallback (§6)
 * - Row 3: ⤷ 親タスク名 (左) + 進捗バー | 分解状態 pill (右)
 *
 * 完了 checkbox は出さない (Top-only complete; ADR 0016 §7)。
 * leaf-parent (親自身が Stack 行) は「⤷ 親」を出さず、status pill のみ。
 *
 * ADR-0041: 親バッジ (`⤷ 親名`) は同じ `parent_task_id` を持つ全行をグループとして
 * まとめて動かすドラッグ起点になる。Grip 起点 (single drag) と並立する。
 */
type TaskRowProps = {
  task: Task;
  events: readonly Event[];
  /** 現在時刻 (ms)。依存イベントの相対時刻 / 直近判定で使う。0 は SSR placeholder。 */
  now: number;
  isBeingDragged: boolean;
  /** 子タスクなら親 Task。leaf-parent では undefined。 */
  parent?: Task;
  /** 子タスクなら親に紐付く進捗。leaf-parent では undefined。 */
  progress?: Progress;
  /** Grip ハンドル起点の単独ドラッグ pointerDown ハンドラ。 */
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  /**
   * 親バッジ起点のグループドラッグ pointerDown ハンドラ (ADR-0041)。
   * 子タスク (`parent !== undefined`) のときだけ親バッジに乗せる。
   */
  onGroupPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
  onClick: () => void;
};

export function TaskRow({
  task,
  events,
  now,
  isBeingDragged,
  parent,
  progress,
  onPointerDown,
  onGroupPointerDown,
  onClick,
}: TaskRowProps) {
  const { projectsById } = useProjects();
  const proj = getProject(projectsById, task.projectId);
  const factors = useCorrectionFactors();
  const estimate = correctEstimate({
    estimatedMinutes: task.estimatedMinutes,
    taskCategory: task.taskCategory,
    factors,
  });

  // ADR 0016 §6: 子は親の dependsOnEventId を継承 (子自身の値がなければ親に fallback)。
  const effectiveDepId = task.dependsOnEventId ?? parent?.dependsOnEventId ?? null;
  const dep = effectiveDepId ? events.find((e) => e.id === effectiveDepId) : null;
  const depImminent =
    dep !== null &&
    dep !== undefined &&
    now > 0 &&
    new Date(dep.startTime).getTime() - now <= IMMINENT_THRESHOLD_MS;

  const showProgress = parent !== undefined && progress !== undefined;
  // leaf-parent (= 親自身が Stack 行) のときは status pill。decomposing/skipped/none を表示。
  const showStatusPill = parent === undefined && task.decomposeStatus !== "decomposed";

  return (
    <div
      onClick={onClick}
      className={`mx-4 cursor-pointer border-b border-bg-elevated px-2.5 py-2 transition-opacity duration-150 ${
        isBeingDragged ? "opacity-30" : "opacity-100"
      }`}
    >
      {/* Row 1: Grip + ProjectDot + title + estimate */}
      <div className="flex items-center gap-2">
        <div
          onPointerDown={(e) => {
            e.stopPropagation();
            onPointerDown(e);
          }}
          aria-label="並び替えハンドル"
          className="shrink-0 cursor-grab touch-none p-0.5"
        >
          <Grip />
        </div>
        <div
          className="h-1.5 w-1.5 shrink-0 rounded-full opacity-70"
          style={{ background: proj.color }}
        />
        <span className="flex-1 truncate font-jp text-[12px] text-fg-muted">{task.title}</span>
        {estimate && <CorrectedEstimate estimate={estimate} variant="row" />}
      </div>
      {/* Row 2: dep event (右詰) */}
      {dep && (
        <div className="ml-[26px] mt-1 flex items-center justify-end">
          <span
            className={`max-w-[180px] truncate rounded-[3px] px-1.5 py-px font-jp text-[8px] text-accent-amber ${
              depImminent ? "bg-[#E85D0440] font-semibold" : "bg-[#E85D0415]"
            }`}
            title={`${dep.title} (${formatRelativeTime(dep.startTime, new Date(now))})`}
          >
            ← {formatRelativeTime(dep.startTime, new Date(now))} {dep.title}
          </span>
        </div>
      )}
      {/* Row 3: ⤷ 親 (左) + progress | status pill (右) */}
      {(showProgress || showStatusPill) && (
        <div className="ml-[26px] mt-1 flex items-center gap-2">
          {showProgress && parent ? (
            <span
              role="button"
              tabIndex={0}
              aria-label={`親グループ並び替え: ${parent.title}`}
              onPointerDown={
                onGroupPointerDown
                  ? (e) => {
                      e.stopPropagation();
                      onGroupPointerDown(e);
                    }
                  : undefined
              }
              onClick={(e) => e.stopPropagation()}
              className={`min-w-0 flex-1 truncate font-jp text-[9px] ${
                onGroupPointerDown ? "cursor-grab touch-none" : ""
              }`}
              style={{ color: `${getProject(projectsById, parent.projectId).color}cc` }}
              title={`親: ${parent.title}`}
            >
              ⤷ {parent.title}
            </span>
          ) : (
            <span className="min-w-0 flex-1" />
          )}
          {showProgress && progress && parent ? (
            <ParallelogramProgress
              total={progress.total}
              doneCount={progress.doneCount}
              currentIndex={progress.currentIndex}
              color={getProject(projectsById, parent.projectId).color}
              size="sm"
            />
          ) : showStatusPill ? (
            <StatusPill status={task.decomposeStatus} />
          ) : null}
        </div>
      )}
    </div>
  );
}
