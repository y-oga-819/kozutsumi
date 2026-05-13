import type { PointerEvent as ReactPointerEvent } from "react";

import type { InterruptSource } from "@/entities/action-log/types";
import type { Event } from "@/entities/event/types";
import { getProject } from "@/entities/project/projects";
import { useProjects } from "@/entities/project/ProjectsContext";
import { useCorrectionFactors } from "@/entities/task/CorrectionFactorsContext";
import { correctEstimate } from "@/entities/task/correction";
import type { PauseReason } from "@/entities/task/time-entries";
import type { Task } from "@/entities/task/types";
import { bodyPreview } from "@/shared/lib/body-preview";
import { IMMINENT_THRESHOLD_MS, fmtDuration, formatRelativeTime } from "@/shared/lib/time";
import { ParallelogramProgress } from "@/shared/ui/ParallelogramProgress";

import { CorrectedEstimate } from "./CorrectedEstimate";
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
 * - 下ゾーン (行カードと共通参照): dep / ⤷ 親 / 合計 + progress | status pill
 *
 * 下ゾーンは「dep / 親グループ進捗 / 分解状態 pill」の少なくとも 1 つがあるときだけ
 * 描画する。leaf-parent + dep 無しのときは下ゾーン自体を出さない (issue #109)。
 *
 * leaf-child では親名が長くて truncate されるのを避けるため、⤷ 親 を独立行に
 * 切り出し (wrap 可)、合計 + progress は別行に右詰で出す (issue #109)。
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
  /**
   * ADR-0065: active 中にだけ表示する source 別 1-tap 割り込みボタンの押下
   * callback。Slack / Notion / PR Review の 3 ボタンが共通で本 callback を
   * 呼び、引数 source で区別する。
   */
  onInterrupt: (source: InterruptSource) => void;
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
  onInterrupt,
}: TopTaskCardProps) {
  const { projectsById } = useProjects();
  const proj = getProject(projectsById, task.projectId);
  const factors = useCorrectionFactors();
  // P3-9 / #93、ADR 0024 / 0026: 補正後 + 元値の組。category null / サンプル不足は元値のみ。
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

  const preview = bodyPreview(task.body);
  const isActive = task.status === "active";
  const isPaused = task.status === "paused";

  // leaf-parent (子無し親) は status pill を下ゾーン右詰に出す (TaskRow と位置揃え)。
  // leaf-child (parent あり) では進捗バーが代わりに出るので status pill は出さない。
  const showLeafParentStatusPill = parent === undefined && task.decomposeStatus !== "decomposed";
  const showProgress = parent !== undefined && progress !== undefined;
  // 下ゾーン全体の描画条件: dep / 親グループ進捗 / 分解状態 pill のいずれかがある。
  // leaf-parent + dep 無しのときは描画しない (issue #109)。
  const showLowerZone = !!dep || showProgress || showLeafParentStatusPill;

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
            {(estimate || task.taskSize) && (
              <span className="ml-auto">
                <CorrectedEstimate estimate={estimate} taskSize={task.taskSize} variant="top" />
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
              onInterrupt={onInterrupt}
            />
          </div>
          {preview && (
            <div className="mt-1 truncate font-jp text-[10px] text-fg-weak">{preview}</div>
          )}

          {/* ----------- 下ゾーン: dep / ⤷ 親 / 合計 + progress | status pill -----------
              leaf-parent + dep 無しのケースでは下ゾーン自体を描画しない (issue #109)。 */}
          {showLowerZone && (
            <LowerZone
              dep={dep}
              depImminent={depImminent}
              now={now}
              parent={parent}
              progress={progress}
              decomposeStatus={task.decomposeStatus}
              showProgress={showProgress}
              showLeafParentStatusPill={showLeafParentStatusPill}
            />
          )}
        </div>
      </div>
    </div>
  );
}

type LowerZoneProps = {
  dep: Event | null | undefined;
  depImminent: boolean;
  now: number;
  parent: Task | undefined;
  progress: Progress | undefined;
  decomposeStatus: Task["decomposeStatus"];
  showProgress: boolean;
  showLeafParentStatusPill: boolean;
};

/**
 * Top カード下ゾーン。dep (右詰) → ⤷ 親 (wrap 可) → (合計 + progress | status pill) (右詰)
 * を縦に並べる。各行は中身が無ければ描画しないので、leaf-parent + dep 無しのケース等で
 * 空白が出ないようにする (issue #109)。
 */
function LowerZone({
  dep,
  depImminent,
  now,
  parent,
  progress,
  decomposeStatus,
  showProgress,
  showLeafParentStatusPill,
}: LowerZoneProps) {
  const { projectsById } = useProjects();
  const parentColor = parent ? getProject(projectsById, parent.projectId).color : null;
  const showParentName = parent !== undefined && progress !== undefined && parentColor !== null;
  const showMetaRow = showProgress || showLeafParentStatusPill;

  return (
    <div className="mt-3 space-y-1 border-t border-bg-border/60 pt-2">
      {dep && (
        <div className="flex items-center justify-end">
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
      {showParentName && parent && parentColor && (
        <div
          className="font-jp text-[10px] leading-[1.4]"
          style={{ color: `${parentColor}cc` }}
          title={`親: ${parent.title}`}
        >
          ⤷ {parent.title}
        </div>
      )}
      {showMetaRow && (
        <div className="flex items-center justify-end gap-2">
          {showProgress && progress && parentColor ? (
            <>
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
            </>
          ) : showLeafParentStatusPill ? (
            <StatusPill status={decomposeStatus} />
          ) : null}
        </div>
      )}
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
  onInterrupt: (source: InterruptSource) => void;
};

// ADR-0065: 3 ボタンは hardcoded。設定経由の add/remove は未実装。
// `ariaLabel` は aria-label / title 共通 (e2e は role=button name=ariaLabel で取れる)。
// `text` はボタン内に表示する短いラベル — アイコンより視認性 / 押し間違い低減を優先。
const INTERRUPT_SOURCES: readonly {
  source: InterruptSource;
  ariaLabel: string;
  text: string;
}[] = [
  { source: "slack", ariaLabel: "Slack 割り込み", text: "Slack" },
  { source: "notion", ariaLabel: "Notion 割り込み", text: "Notion" },
  { source: "pr_review", ariaLabel: "レビュー 割り込み", text: "レビュー" },
] as const;

function TimerControls({
  status,
  color,
  onStart,
  onPauseRequest,
  onResume,
  onComplete,
  onInterrupt,
}: TimerControlsProps) {
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  // Top-only complete (ADR 0016 §7): どの状態でも Complete を併置する。
  // ADR-0065: source 別の割り込みボタン群は active 中だけ表示する。
  //
  // NOTE: 現在の Top カードは「停止 + 完了 + source 別割り込み × 3」で active 時に
  // 5 ボタンが並ぶ。導線の正しさを優先して詰め込む暫定 UI。専有面積を含む
  // タイマー UI 全体の再設計は別 issue で扱う (pomodoro 系 timer × task card の
  // 融合、別 view の検討)。
  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
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
        <>
          {INTERRUPT_SOURCES.map((s) => (
            <button
              key={s.source}
              type="button"
              onClick={stop(() => onInterrupt(s.source))}
              aria-label={s.ariaLabel}
              title={s.ariaLabel}
              className="flex h-9 cursor-pointer items-center rounded-lg bg-transparent px-2 font-jp text-[10px] font-semibold"
              style={{ border: `1.5px solid ${color}40`, color: "currentColor" }}
            >
              {s.text}
            </button>
          ))}
          <button
            type="button"
            onClick={stop(onPauseRequest)}
            aria-label="中断"
            className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg bg-transparent"
            style={{ border: `1.5px solid ${color}40`, color: "currentColor" }}
          >
            <PauseIcon />
          </button>
        </>
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
