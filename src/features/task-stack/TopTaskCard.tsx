import type { PointerEvent as ReactPointerEvent } from "react";

import type { Event } from "@/entities/event/types";
import { getProject } from "@/entities/project/projects";
import { useProjects } from "@/entities/project/ProjectsContext";
import type { PauseReason } from "@/entities/task/time-entries";
import type { Task } from "@/entities/task/types";
import { bodyPreview } from "@/shared/lib/body-preview";
import { IMMINENT_THRESHOLD_MS, fmtDuration, formatRelativeTime } from "@/shared/lib/time";
import { ParallelogramProgress } from "@/shared/ui/ParallelogramProgress";

import { Grip } from "./Grip";
import { pauseReasonLabel } from "./PauseReasonModal";
import type { Progress } from "./stackItems";
import { StatusPill } from "./StatusPill";
import { formatElapsed } from "./useTaskTimer";

/**
 * Stack View の Top カード (ADR 0016 §2)。
 *
 * 上下 2 ゾーン構造:
 * - 上ゾーン (Top 専用 / 着手集中): project header + 状態 badge + 大タイトル
 *   + Timer Controls + body preview + 自タスク見積もり
 * - 下ゾーン (行カードと共通参照): dep (右詰) → ⤷ 親 + 合計 + progress
 *
 * leaf-parent (親自身が Top) は下ゾーンに出すべき情報 (⤷ 親 / 進捗) が無いので、
 * 分解状態 pill は上ゾーンの project header 行に集約する。下ゾーン全体は
 * 「dep がある」または「leaf-child で進捗がある」ときだけ描画する (issue #109)。
 *
 * 完了は idle / active / paused いずれの状態でも常時表示 (Top-only complete; §7)。
 */
type TopTaskCardProps = {
  task: Task;
  events: readonly Event[];
  /** 現在時刻 (ms)。依存イベントの相対時刻 / 直近判定で使う。0 は SSR placeholder。 */
  now: number;
  isBeingDragged: boolean;
  elapsedSeconds: number;
  pauseReason: PauseReason | null;
  /** 子タスクなら親 Task。leaf-parent では undefined。 */
  parent?: Task;
  /** 子タスクなら親に紐付く進捗。leaf-parent では undefined。 */
  progress?: Progress;
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onClick: () => void;
  onStart: () => void;
  onPauseRequest: () => void;
  onResume: () => void;
  onComplete: () => void;
};

export function TopTaskCard({
  task,
  events,
  now,
  isBeingDragged,
  elapsedSeconds,
  pauseReason,
  parent,
  progress,
  onPointerDown,
  onClick,
  onStart,
  onPauseRequest,
  onResume,
  onComplete,
}: TopTaskCardProps) {
  const { projectsById } = useProjects();
  const proj = getProject(projectsById, task.projectId);

  // ADR 0016 §6: 子は親の dependsOnEventId を継承 (子自身の値がなければ親に fallback)。
  const effectiveDepId = task.dependsOnEventId ?? parent?.dependsOnEventId ?? null;
  const dep = effectiveDepId ? events.find((e) => e.id === effectiveDepId) : null;
  const depImminent =
    dep !== null &&
    dep !== undefined &&
    now > 0 &&
    new Date(dep.startTime).getTime() - now <= IMMINENT_THRESHOLD_MS;

  const preview = bodyPreview(task.body);
  const isActive = task.status === "active";
  const isPaused = task.status === "paused";

  // leaf-parent (子無し親) の分解状態 pill は上ゾーンに出す (issue #109)。
  // leaf-child (parent あり) では進捗バーが下ゾーンに出るので、上ゾーンには出さない。
  const showLeafParentStatusPill =
    parent === undefined && task.decomposeStatus !== "decomposed";
  const showLowerZone = !!dep || (parent !== undefined && progress !== undefined);

  return (
    <div
      onClick={onClick}
      className={`relative mx-4 mb-1 cursor-pointer overflow-hidden rounded-[10px] bg-bg-elevated py-3.5 pl-[14px] pr-3.5 transition-opacity duration-150 ${
        isBeingDragged ? "opacity-40" : "opacity-100"
      }`}
      style={{ border: `1px solid ${proj.color}40` }}
    >
      <div
        aria-hidden="true"
        className="absolute bottom-0 left-0 top-0 w-[3px]"
        style={{ background: proj.color }}
      />
      <div className="flex items-start gap-2">
        <div
          onPointerDown={(e) => {
            e.stopPropagation();
            onPointerDown(e);
          }}
          aria-label="並び替えハンドル"
          className="mt-1.5 shrink-0 cursor-grab touch-none px-0.5 py-1"
        >
          <Grip />
        </div>
        <div className="min-w-0 flex-1">
          {/* ----------- 上ゾーン: project + state badge + title + Timer + preview ----------- */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="h-2 w-2 rounded-full" style={{ background: proj.color }} />
            <span className="font-jp text-[9px] text-fg-subtle">{proj.name}</span>
            {isActive && (
              <span
                aria-label="経過時間"
                className="rounded-[3px] bg-accent-blue/15 px-1.5 py-px font-jp text-[9px] font-semibold tabular-nums text-accent-blue"
              >
                ● {formatElapsed(elapsedSeconds)}
              </span>
            )}
            {isPaused && pauseReason && (
              <span className="rounded-[3px] bg-fg-weak/15 px-1.5 py-px font-jp text-[8px] text-fg-weak">
                中断: {pauseReasonLabel(pauseReason)}
              </span>
            )}
            {showLeafParentStatusPill && <StatusPill status={task.decomposeStatus} />}
            {task.estimatedMinutes !== null && (
              <span className="ml-auto text-[10px] tabular-nums text-fg-faint">
                {fmtDuration(task.estimatedMinutes)}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-start gap-2">
            <div className="flex-1 font-jp text-[15px] font-semibold leading-[1.4] text-fg-strong">
              {task.title}
            </div>
            <TimerControls
              status={task.status}
              color={proj.color}
              onStart={onStart}
              onPauseRequest={onPauseRequest}
              onResume={onResume}
              onComplete={onComplete}
            />
          </div>
          {preview && (
            <div className="mt-1 truncate font-jp text-[10px] text-fg-weak">{preview}</div>
          )}

          {/* ----------- 下ゾーン: dep / ⤷ 親 + 合計 + progress -----------
              leaf-parent + dep 無しのケースでは中身が空になるので、
              下ゾーン自体を描画しない (issue #109)。 */}
          {showLowerZone && (
            <div className="mt-3 border-t border-bg-border/60 pt-2">
              {/* Row 2: dep (右詰)。leaf-child で dep が無い場合も Row 3 との
                  位置揃えのため slot を確保する (ADR 0016 §6)。 */}
              <div className="flex min-h-[16px] items-center justify-end">
                {dep && (
                  <span
                    className={`max-w-[180px] truncate rounded-[3px] px-1.5 py-px font-jp text-[8px] text-accent-amber ${
                      depImminent ? "bg-[#E85D0440] font-semibold" : "bg-[#E85D0415]"
                    }`}
                    title={`${dep.title} (${formatRelativeTime(dep.startTime, new Date(now))})`}
                  >
                    ← {formatRelativeTime(dep.startTime, new Date(now))} {dep.title}
                  </span>
                )}
              </div>
              {/* Row 3: leaf-child のみ ⤷ 親 + 合計 + progress を出す。 */}
              {parent && progress && <BottomRow parent={parent} progress={progress} />}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * leaf-child Top の下ゾーン Row 3: ⤷ 親 + 合計 + 進捗バー。
 * leaf-parent Top では呼ばれない (上ゾーンに status pill を集約しているため)。
 */
function BottomRow({ parent, progress }: { parent: Task; progress: Progress }) {
  const { projectsById } = useProjects();
  const parentColor = getProject(projectsById, parent.projectId).color;
  return (
    <div className="mt-1 flex items-center gap-2">
      <span
        className="min-w-0 flex-1 truncate font-jp text-[10px]"
        style={{ color: `${parentColor}cc` }}
        title={`親: ${parent.title}`}
      >
        ⤷ {parent.title}
      </span>
      {progress.totalMinutes !== null && (
        <span className="font-jp text-[10px] tabular-nums text-fg-muted">
          合計 {fmtDuration(progress.totalMinutes)}
        </span>
      )}
      <ParallelogramProgress
        total={progress.total}
        doneCount={progress.doneCount}
        currentIndex={progress.currentIndex}
        color={parentColor}
        size="md"
      />
    </div>
  );
}

type TimerControlsProps = {
  status: Task["status"];
  color: string;
  onStart: () => void;
  onPauseRequest: () => void;
  onResume: () => void;
  onComplete: () => void;
};

function TimerControls({
  status,
  color,
  onStart,
  onPauseRequest,
  onResume,
  onComplete,
}: TimerControlsProps) {
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  // Top-only complete (ADR 0016 §7): どの状態でも Complete を併置する。
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {status === "idle" && (
        <button
          type="button"
          onClick={stop(onStart)}
          aria-label="開始"
          className="flex h-9 cursor-pointer items-center gap-1 rounded-lg bg-transparent px-2.5 font-jp text-[11px] font-semibold"
          style={{ border: `1.5px solid ${color}60`, color }}
        >
          <PlayIcon /> 開始
        </button>
      )}
      {status === "active" && (
        <button
          type="button"
          onClick={stop(onPauseRequest)}
          aria-label="中断"
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg bg-transparent"
          style={{ border: `1.5px solid ${color}40`, color: "currentColor" }}
        >
          <PauseIcon />
        </button>
      )}
      {status === "paused" && (
        <button
          type="button"
          onClick={stop(onResume)}
          aria-label="再開"
          className="flex h-9 cursor-pointer items-center gap-1 rounded-lg bg-transparent px-2.5 font-jp text-[11px] font-semibold"
          style={{ border: `1.5px solid ${color}60`, color }}
        >
          <PlayIcon /> 再開
        </button>
      )}
      <button
        type="button"
        onClick={stop(onComplete)}
        aria-label="完了"
        className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg bg-transparent"
        style={{ border: `1.5px solid ${color}60`, color }}
      >
        <CheckIcon />
      </button>
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor" aria-hidden="true">
      <polygon points="1,1 9,6 1,11" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <rect x="2" y="2" width="3" height="8" rx="1" />
      <rect x="7" y="2" width="3" height="8" rx="1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <polyline
        points="3,8 7,12 13,4"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
