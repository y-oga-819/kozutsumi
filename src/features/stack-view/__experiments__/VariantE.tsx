"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { useStackDnD } from "../../task-stack/useStackDnD";
import {
  fmtMinutes,
  SAMPLE_INITIAL_DONE,
  SAMPLE_PARENTS,
  SAMPLE_PROJECTS,
} from "./sampleData";
import type { SampleChild, SampleParent } from "./sampleData";
import {
  bodyPreview,
  CompleteButton,
  DepBadge,
  EstimateBadge,
  formatElapsedSeconds,
  Grip,
  ParallelogramProgress,
  ProjectDot,
  ProjectName,
  StackHeader,
  StatusPill,
  VariantNote,
} from "./shared";

/**
 * Variant E (hybrid): 子フラット + DnD + Top-only complete + Done list
 * + Top カード上下 2 ゾーン構造 + 行カード 3 行構成 + mock タイマー。
 *
 * レイアウト方針 (User feedback round 4):
 * - 行カードは 3 行: (1) Grip + ProjectDot + title (左) + estimate (右),
 *   (2) dep (右詰), (3) ⤷ 親 (左) + progress | status pill (右詰)
 * - Top カードは上下 2 ゾーン:
 *   - 上ゾーン (Top 専用 / 着手集中): project header + state badge / title + Timer
 *     Controls / body preview / 自タスク見積もり
 *   - 下ゾーン (行カードと共通参照): dep (右詰) / ⤷ 親 + 合計 + progress (右詰)
 * - 進捗バーと status pill は同じ「分解状態スロット」(Row 3 右詰) に配置。
 *   decomposed → progress / 未分解 / 分解中 / 分解不要 → status pill
 *
 * mock タイマー:
 * - 上部の状態セレクタ (idle / active / paused) で Top カードの timer 状態を切替
 * - active のとき elapsed が 1 秒ごとに増える
 * - paused のとき pause reason ("休憩") が表示される
 * - 完了は CompleteButton (上から消化の原則)、または active の TimerControls 内
 */

type Item =
  | { kind: "leaf-child"; parent: SampleParent; child: SampleChild }
  | { kind: "leaf-parent"; parent: SampleParent };

type TimerStatus = "idle" | "active" | "paused";

function buildItemMap(parents: readonly SampleParent[]): Map<string, Item> {
  const m = new Map<string, Item>();
  for (const parent of parents) {
    if (parent.decomposeStatus === "decomposed" && parent.children.length > 0) {
      for (const child of parent.children) {
        m.set(child.id, { kind: "leaf-child", parent, child });
      }
    } else {
      m.set(parent.id, { kind: "leaf-parent", parent });
    }
  }
  return m;
}

function buildAllIds(parents: readonly SampleParent[]): string[] {
  const ids: string[] = [];
  for (const parent of parents) {
    if (parent.decomposeStatus === "decomposed" && parent.children.length > 0) {
      for (const child of parent.children) ids.push(child.id);
    } else {
      ids.push(parent.id);
    }
  }
  return ids;
}

function totalMinutes(parent: SampleParent): number {
  if (parent.children.length === 0) return parent.estimatedMinutes;
  return parent.children.reduce((a, c) => a + c.estimatedMinutes, 0);
}

function useMockTimer(): {
  status: TimerStatus;
  elapsed: number;
  setStatus: (s: TimerStatus) => void;
} {
  const [status, setStatusInternal] = useState<TimerStatus>("idle");
  const [elapsed, setElapsed] = useState(0);
  // active のときだけ 1 秒ごとに tick。idle / paused は止める。
  useEffect(() => {
    if (status !== "active") return;
    const id = window.setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(id);
  }, [status]);
  const setStatus = (next: TimerStatus) => {
    setStatusInternal(next);
    if (next === "idle") setElapsed(0);
  };
  return { status, elapsed, setStatus };
}

export function VariantE() {
  const itemById = useMemo(() => buildItemMap(SAMPLE_PARENTS), []);
  const allIds = useMemo(() => buildAllIds(SAMPLE_PARENTS), []);

  const [pendingIds, setPendingIds] = useState<string[]>(() =>
    allIds.filter((id) => !SAMPLE_INITIAL_DONE.includes(id)),
  );
  const [doneIds, setDoneIds] = useState<string[]>(() => [...SAMPLE_INITIAL_DONE]);
  const doneSet = useMemo(() => new Set(doneIds), [doneIds]);
  const timer = useMockTimer();

  const handleReorder = (from: number, to: number) => {
    setPendingIds((prev) => {
      if (from < 0 || from >= prev.length || to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  const handleComplete = (id: string) => {
    setPendingIds((prev) => prev.filter((x) => x !== id));
    setDoneIds((prev) => [id, ...prev]);
    timer.setStatus("idle");
  };

  const handleUndoDone = (id: string) => {
    setDoneIds((prev) => prev.filter((x) => x !== id));
    setPendingIds((prev) => [...prev, id]);
  };

  const { dragIdx, overIdx, rowRefs, handlePointerDown } = useStackDnD(handleReorder);

  const pendingItems = pendingIds
    .map((id) => ({ id, item: itemById.get(id) }))
    .filter((x): x is { id: string; item: Item } => x.item !== undefined);
  const doneItems = doneIds
    .map((id) => ({ id, item: itemById.get(id) }))
    .filter((x): x is { id: string; item: Item } => x.item !== undefined);

  return (
    <section aria-labelledby="variant-e-heading">
      <h2 id="variant-e-heading" className="sr-only">
        Variant E: ハイブリッド (上下 2 ゾーン Top + 3 行 Row + mock timer)
      </h2>
      <VariantNote
        philosophy="Top カードは上下 2 ゾーン (上=着手集中 / 下=共通参照)。下ゾーンは行カードの dep / 親 / progress と同じ位置に揃え、認知負荷を下げる。上ゾーンに着手 UI (タイマー / コントロール / preview) を集約。進捗バーと AI 分解状態 pill は同じ「分解状態スロット」(右詰) で切替。"
        tradeoffs={[
          "下ゾーン (dep + 親+progress) は行カードと位置を完全一致 → 視線遷移コストを最小化",
          "上ゾーンは Top 専用 (project header + title + body preview + timer + controls) で特別性を担保",
          "AI 分解状態 (未分解 / 分解中 / 分解不要) は進捗バーと同じスロットに表示 → 同じ意味軸で迷わない",
          "状態セレクタ (idle / active / paused) で Top の挙動を切替できる (mock)",
        ]}
      />
      <TimerStatusSwitcher status={timer.status} setStatus={timer.setStatus} />
      <StackHeader count={pendingItems.length} />
      <ul role="list" aria-label="タスクスタック (variant E)" className="m-0 list-none p-0">
        {pendingItems.map(({ id, item }, idx) => {
          const isFirst = idx === 0;
          const isBeingDragged = dragIdx === idx;
          const isDropTarget = overIdx === idx && dragIdx !== null && dragIdx !== idx;
          return (
            <li
              key={id}
              ref={(el: HTMLLIElement | null) => {
                rowRefs.current[idx] = el;
              }}
            >
              {isDropTarget && (
                <div aria-hidden="true" className="mx-4 h-0.5 rounded-[1px] bg-accent-blue" />
              )}
              <PendingRow
                item={item}
                isFirst={isFirst}
                isBeingDragged={isBeingDragged}
                pendingItems={pendingItems}
                doneSet={doneSet}
                timer={timer}
                onPointerDown={(e) => handlePointerDown(idx, e)}
                onComplete={() => handleComplete(id)}
              />
            </li>
          );
        })}
      </ul>
      <DoneSection doneItems={doneItems} doneSet={doneSet} onUndo={handleUndoDone} />
    </section>
  );
}

/* ----------------------------- 状態セレクタ ----------------------------- */

function TimerStatusSwitcher({
  status,
  setStatus,
}: {
  status: TimerStatus;
  setStatus: (s: TimerStatus) => void;
}) {
  const options: { key: TimerStatus; label: string }[] = [
    { key: "idle", label: "idle" },
    { key: "active", label: "active" },
    { key: "paused", label: "paused" },
  ];
  return (
    <div className="mx-4 mb-2 flex items-center gap-2 rounded-[6px] border border-bg-border bg-bg-surface px-2 py-1.5">
      <span className="font-jp text-[9px] uppercase tracking-[0.08em] text-fg-subtle">
        Top timer (mock)
      </span>
      <div role="radiogroup" aria-label="Top タイマー状態" className="flex gap-1">
        {options.map((opt) => {
          const active = status === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setStatus(opt.key)}
              className={`rounded-[3px] px-2 py-0.5 font-jp text-[10px] ${
                active ? "bg-bg-divider text-fg-emphasized" : "bg-transparent text-fg-weak"
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------- Pending row 振り分け ----------------------------- */

type TimerApi = {
  status: TimerStatus;
  elapsed: number;
  setStatus: (s: TimerStatus) => void;
};

function PendingRow({
  item,
  isFirst,
  isBeingDragged,
  pendingItems,
  doneSet,
  timer,
  onPointerDown,
  onComplete,
}: {
  item: Item;
  isFirst: boolean;
  isBeingDragged: boolean;
  pendingItems: { id: string; item: Item }[];
  doneSet: ReadonlySet<string>;
  timer: TimerApi;
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onComplete: () => void;
}) {
  if (item.kind === "leaf-child") {
    const progress = computeChildProgress(item.child, item.parent, pendingItems, doneSet);
    if (isFirst) {
      return (
        <ChildTopCard
          parent={item.parent}
          child={item.child}
          progress={progress}
          isBeingDragged={isBeingDragged}
          timer={timer}
          onPointerDown={onPointerDown}
          onComplete={onComplete}
        />
      );
    }
    return (
      <ChildRow
        parent={item.parent}
        child={item.child}
        progress={progress}
        isBeingDragged={isBeingDragged}
        onPointerDown={onPointerDown}
      />
    );
  }
  if (isFirst) {
    return (
      <ParentTopCard
        parent={item.parent}
        isBeingDragged={isBeingDragged}
        timer={timer}
        onPointerDown={onPointerDown}
        onComplete={onComplete}
      />
    );
  }
  return (
    <ParentRow
      parent={item.parent}
      isBeingDragged={isBeingDragged}
      onPointerDown={onPointerDown}
    />
  );
}

type Progress = { total: number; doneCount: number; currentIndex: number };

function computeChildProgress(
  child: SampleChild,
  parent: SampleParent,
  pendingItems: { id: string; item: Item }[],
  doneSet: ReadonlySet<string>,
): Progress {
  const total = parent.children.length;
  const doneCount = parent.children.filter((c) => doneSet.has(c.id)).length;
  let position = 0;
  for (const { item } of pendingItems) {
    if (item.kind === "leaf-child" && item.parent.id === parent.id) {
      position++;
      if (item.child.id === child.id) {
        return { total, doneCount, currentIndex: doneCount + position };
      }
    }
  }
  return { total, doneCount, currentIndex: 0 };
}

/* ------------------------------- Top cards ------------------------------- */

/** Top カードの上ゾーン: project header + title + body preview + Timer Controls */
function TopUpperZone({
  projectId,
  title,
  body,
  selfMinutes,
  timer,
  onComplete,
  completeLabel,
}: {
  projectId: string;
  title: string;
  body?: string;
  selfMinutes: number;
  timer: TimerApi;
  onComplete: () => void;
  completeLabel: string;
}) {
  const preview = bodyPreview(body);
  const projColor = SAMPLE_PROJECTS[projectId]?.color ?? "#52525b";
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <ProjectDot projectId={projectId} />
        <ProjectName projectId={projectId} />
        {timer.status === "active" && (
          <span
            aria-label="経過時間"
            className="inline-flex items-center gap-1 rounded-[3px] bg-accent-blue/15 px-1.5 py-px font-jp text-[9px] font-semibold tabular-nums text-accent-blue"
          >
            <span
              aria-hidden="true"
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-blue"
            />
            {formatElapsedSeconds(timer.elapsed)}
          </span>
        )}
        {timer.status === "paused" && (
          <span className="rounded-[3px] bg-fg-weak/15 px-1.5 py-px font-jp text-[9px] text-fg-weak">
            中断: 休憩
          </span>
        )}
        <span className="ml-auto text-[10px] tabular-nums text-fg-faint">
          {fmtMinutes(selfMinutes)}
        </span>
      </div>
      <div className="mt-1 flex items-start gap-2">
        <div className="flex-1 font-jp text-[15px] font-semibold leading-[1.4] text-fg-strong">
          {title}
        </div>
        <TimerControlsCluster
          timer={timer}
          onComplete={onComplete}
          completeLabel={completeLabel}
          color={projColor}
        />
      </div>
      {preview && (
        <div className="mt-1 truncate font-jp text-[10px] text-fg-weak">{preview}</div>
      )}
    </>
  );
}

function TimerControlsCluster({
  timer,
  onComplete,
  completeLabel,
  color,
}: {
  timer: TimerApi;
  onComplete: () => void;
  completeLabel: string;
  color: string;
}) {
  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation();
    fn();
  };
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {timer.status === "idle" && (
        <button
          type="button"
          aria-label="開始"
          onClick={stop(() => timer.setStatus("active"))}
          className="flex h-9 cursor-pointer items-center gap-1 rounded-lg bg-transparent px-2.5 font-jp text-[11px] font-semibold"
          style={{ border: `1.5px solid ${color}60`, color }}
        >
          <PlayIcon /> 開始
        </button>
      )}
      {timer.status === "active" && (
        <button
          type="button"
          aria-label="中断"
          onClick={stop(() => timer.setStatus("paused"))}
          className="flex h-9 w-9 cursor-pointer items-center justify-center rounded-lg bg-transparent"
          style={{ border: `1.5px solid ${color}40`, color: "currentColor" }}
        >
          <PauseIcon />
        </button>
      )}
      {timer.status === "paused" && (
        <button
          type="button"
          aria-label="再開"
          onClick={stop(() => timer.setStatus("active"))}
          className="flex h-9 cursor-pointer items-center gap-1 rounded-lg bg-transparent px-2.5 font-jp text-[11px] font-semibold"
          style={{ border: `1.5px solid ${color}60`, color }}
        >
          <PlayIcon /> 再開
        </button>
      )}
      <CompleteButton done={false} onToggle={onComplete} label={completeLabel} />
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

/** Top カードの下ゾーン (共通参照): dep (Row 2) + 親 / 合計 / progress | status pill (Row 3) */
function TopLowerZone({
  parent,
  progress,
  showTotal,
}: {
  parent: SampleParent;
  /** 子のいる decomposed 親なら progress、未分解 / 分解中 / 分解不要なら null */
  progress: Progress | null;
  showTotal: boolean;
}) {
  const proj = SAMPLE_PROJECTS[parent.projectId];
  const total = totalMinutes(parent);
  return (
    <div className="mt-3 border-t border-bg-border/60 pt-2">
      {/* Row 2: dep (右詰) */}
      <div className="flex min-h-[16px] items-center justify-end">
        {parent.depEvent && <DepBadge dep={parent.depEvent} />}
      </div>
      {/* Row 3: 親 (左) + 合計 (中, Top のみ) + progress | status pill (右) */}
      <div className="mt-1 flex items-center gap-2">
        <span
          className="min-w-0 flex-1 truncate font-jp text-[10px]"
          style={{ color: `${proj?.color ?? "#52525b"}cc` }}
          title={`親: ${parent.title}`}
        >
          ⤷ {parent.title}
        </span>
        {showTotal && progress && (
          <span className="font-jp text-[10px] tabular-nums text-fg-muted">
            合計 {fmtMinutes(total)}
          </span>
        )}
        {progress ? (
          <ParallelogramProgress
            total={progress.total}
            doneCount={progress.doneCount}
            currentIndex={progress.currentIndex}
            color={proj?.color ?? "#52525b"}
            size="md"
          />
        ) : (
          <StatusPill status={parent.decomposeStatus} />
        )}
      </div>
    </div>
  );
}

function ChildTopCard({
  parent,
  child,
  progress,
  isBeingDragged,
  timer,
  onPointerDown,
  onComplete,
}: {
  parent: SampleParent;
  child: SampleChild;
  progress: Progress;
  isBeingDragged: boolean;
  timer: TimerApi;
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onComplete: () => void;
}) {
  const proj = SAMPLE_PROJECTS[parent.projectId];
  return (
    <div
      className={`relative mx-4 mb-1 overflow-hidden rounded-[10px] bg-bg-elevated py-3.5 pl-[14px] pr-3.5 transition-opacity duration-150 ${
        isBeingDragged ? "opacity-40" : "opacity-100"
      }`}
      style={{ border: `1px solid ${proj?.color}40` }}
    >
      <div
        aria-hidden="true"
        className="absolute bottom-0 left-0 top-0 w-[3px]"
        style={{ background: proj?.color }}
      />
      <div className="flex items-start gap-2">
        <DragHandle onPointerDown={onPointerDown} />
        <div className="min-w-0 flex-1">
          <TopUpperZone
            projectId={parent.projectId}
            title={child.title}
            body={child.body}
            selfMinutes={child.estimatedMinutes}
            timer={timer}
            onComplete={onComplete}
            completeLabel={child.title}
          />
          <TopLowerZone parent={parent} progress={progress} showTotal />
        </div>
      </div>
    </div>
  );
}

function ParentTopCard({
  parent,
  isBeingDragged,
  timer,
  onPointerDown,
  onComplete,
}: {
  parent: SampleParent;
  isBeingDragged: boolean;
  timer: TimerApi;
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onComplete: () => void;
}) {
  const proj = SAMPLE_PROJECTS[parent.projectId];
  return (
    <div
      className={`relative mx-4 mb-1 overflow-hidden rounded-[10px] bg-bg-elevated py-3.5 pl-[14px] pr-3.5 transition-opacity duration-150 ${
        isBeingDragged ? "opacity-40" : "opacity-100"
      }`}
      style={{ border: `1px solid ${proj?.color}40` }}
    >
      <div
        aria-hidden="true"
        className="absolute bottom-0 left-0 top-0 w-[3px]"
        style={{ background: proj?.color }}
      />
      <div className="flex items-start gap-2">
        <DragHandle onPointerDown={onPointerDown} />
        <div className="min-w-0 flex-1">
          <TopUpperZone
            projectId={parent.projectId}
            title={parent.title}
            body={parent.body}
            selfMinutes={parent.estimatedMinutes}
            timer={timer}
            onComplete={onComplete}
            completeLabel={parent.title}
          />
          {/* 親 (decomposing/skipped/none) は子が無いので「親自身」が Stack 行になる。
             下ゾーンの「⤷ 親」は要らないので、dep + status pill だけ表示する簡易下ゾーン。 */}
          <ParentSelfLowerZone parent={parent} />
        </div>
      </div>
    </div>
  );
}

/** decomposing / skipped / none の親が Top に来た時の下ゾーン。
 *  「⤷ 親」は冗長 (上ゾーン title が親自身) なので出さない。
 *  Row 2 = dep, Row 3 右 = status pill。 */
function ParentSelfLowerZone({ parent }: { parent: SampleParent }) {
  return (
    <div className="mt-3 border-t border-bg-border/60 pt-2">
      <div className="flex min-h-[16px] items-center justify-end">
        {parent.depEvent && <DepBadge dep={parent.depEvent} />}
      </div>
      <div className="mt-1 flex items-center justify-end">
        <StatusPill status={parent.decomposeStatus} />
      </div>
    </div>
  );
}

/* ------------------------------- Row cards (3 行) ------------------------------- */

function ChildRow({
  parent,
  child,
  progress,
  isBeingDragged,
  onPointerDown,
}: {
  parent: SampleParent;
  child: SampleChild;
  progress: Progress;
  isBeingDragged: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
}) {
  const proj = SAMPLE_PROJECTS[parent.projectId];
  return (
    <div
      className={`mx-4 border-b border-bg-elevated px-2.5 py-2 transition-opacity duration-150 ${
        isBeingDragged ? "opacity-30" : "opacity-100"
      }`}
    >
      {/* Row 1: Grip + ProjectDot + title (左) + estimate (右) */}
      <div className="flex items-center gap-2">
        <DragHandle onPointerDown={onPointerDown} />
        <ProjectDot projectId={parent.projectId} size={6} />
        <span className="flex-1 truncate font-jp text-[12px] text-fg-default">{child.title}</span>
        <EstimateBadge minutes={child.estimatedMinutes} />
      </div>
      {/* Row 2: dep (右詰) */}
      {parent.depEvent && (
        <div className="ml-[26px] mt-1 flex items-center justify-end">
          <DepBadge dep={parent.depEvent} />
        </div>
      )}
      {/* Row 3: ⤷ 親 (左) + progress (右詰) */}
      <div className="ml-[26px] mt-1 flex items-center gap-2">
        <span
          className="min-w-0 flex-1 truncate font-jp text-[9px]"
          style={{ color: `${proj?.color ?? "#52525b"}cc` }}
          title={`親: ${parent.title}`}
        >
          ⤷ {parent.title}
        </span>
        <ParallelogramProgress
          total={progress.total}
          doneCount={progress.doneCount}
          currentIndex={progress.currentIndex}
          color={proj?.color ?? "#52525b"}
          size="sm"
        />
      </div>
    </div>
  );
}

function ParentRow({
  parent,
  isBeingDragged,
  onPointerDown,
}: {
  parent: SampleParent;
  isBeingDragged: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
}) {
  return (
    <div
      className={`mx-4 border-b border-bg-elevated px-2.5 py-2 transition-opacity duration-150 ${
        isBeingDragged ? "opacity-30" : "opacity-100"
      }`}
    >
      {/* Row 1 */}
      <div className="flex items-center gap-2">
        <DragHandle onPointerDown={onPointerDown} />
        <ProjectDot projectId={parent.projectId} size={6} />
        <span className="flex-1 truncate font-jp text-[12px] text-fg-default">{parent.title}</span>
        <EstimateBadge minutes={parent.estimatedMinutes} />
      </div>
      {/* Row 2 */}
      {parent.depEvent && (
        <div className="ml-[26px] mt-1 flex items-center justify-end">
          <DepBadge dep={parent.depEvent} />
        </div>
      )}
      {/* Row 3: status pill (右詰) — 親自身が Stack 行なので「⤷ 親」は出さない */}
      <div className="ml-[26px] mt-1 flex items-center justify-end">
        <StatusPill status={parent.decomposeStatus} />
      </div>
    </div>
  );
}

/* ------------------------------- Done section ------------------------------ */

function DoneSection({
  doneItems,
  doneSet,
  onUndo,
}: {
  doneItems: { id: string; item: Item }[];
  doneSet: ReadonlySet<string>;
  onUndo: (id: string) => void;
}) {
  if (doneItems.length === 0) return null;
  return (
    <>
      <div className="flex items-center gap-2 px-5 pb-2 pt-5">
        <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-fg-faint">
          done
        </span>
        <div className="h-px flex-1 bg-bg-border" />
        <span className="text-[9px] text-fg-faint">{doneItems.length}</span>
      </div>
      <ul role="list" aria-label="完了済み (variant E)" className="m-0 list-none p-0 opacity-50">
        {doneItems.map(({ id, item }) => (
          <li key={id}>
            {item.kind === "leaf-child" ? (
              <DoneChildRow
                parent={item.parent}
                child={item.child}
                progress={computeDoneProgress(item.parent, doneSet)}
                onUndo={() => onUndo(id)}
              />
            ) : (
              <DoneParentRow parent={item.parent} onUndo={() => onUndo(id)} />
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

function computeDoneProgress(parent: SampleParent, doneSet: ReadonlySet<string>): Progress {
  const total = parent.children.length;
  const doneCount = parent.children.filter((c) => doneSet.has(c.id)).length;
  return { total, doneCount, currentIndex: 0 };
}

function DoneChildRow({
  parent,
  child,
  progress,
  onUndo,
}: {
  parent: SampleParent;
  child: SampleChild;
  progress: Progress;
  onUndo: () => void;
}) {
  const proj = SAMPLE_PROJECTS[parent.projectId];
  return (
    <div className="mx-4 border-b border-bg-elevated px-2.5 py-2">
      <div className="flex items-center gap-2">
        <ProjectDot projectId={parent.projectId} size={6} />
        <span className="flex-1 truncate font-jp text-[12px] text-fg-weak line-through">
          {child.title}
        </span>
        <EstimateBadge minutes={child.estimatedMinutes} />
        <UndoButton label={child.title} onClick={onUndo} />
      </div>
      <div className="ml-[14px] mt-1 flex items-center gap-2">
        <span
          className="min-w-0 flex-1 truncate font-jp text-[9px]"
          style={{ color: `${proj?.color ?? "#52525b"}99` }}
          title={`親: ${parent.title}`}
        >
          ⤷ {parent.title}
        </span>
        <ParallelogramProgress
          total={progress.total}
          doneCount={progress.doneCount}
          currentIndex={progress.currentIndex}
          color={proj?.color ?? "#52525b"}
          size="sm"
        />
      </div>
    </div>
  );
}

function DoneParentRow({ parent, onUndo }: { parent: SampleParent; onUndo: () => void }) {
  return (
    <div className="mx-4 border-b border-bg-elevated px-2.5 py-2">
      <div className="flex items-center gap-2">
        <ProjectDot projectId={parent.projectId} size={6} />
        <span className="flex-1 truncate font-jp text-[12px] text-fg-weak line-through">
          {parent.title}
        </span>
        <EstimateBadge minutes={parent.estimatedMinutes} />
        <UndoButton label={parent.title} onClick={onUndo} />
      </div>
    </div>
  );
}

function UndoButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={`${label} を未完了に戻す`}
      className="cursor-pointer rounded-[3px] border border-bg-divider bg-transparent px-1.5 py-0.5 font-jp text-[9px] text-fg-faint"
    >
      戻す
    </button>
  );
}

/* ------------------------------- Drag handle ------------------------------- */

function DragHandle({
  onPointerDown,
}: {
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  return (
    <div
      ref={ref}
      onPointerDown={(e) => {
        e.stopPropagation();
        onPointerDown(e);
      }}
      aria-label="並び替えハンドル"
      role="button"
      tabIndex={-1}
      className="shrink-0 cursor-grab touch-none px-0.5 py-1"
    >
      <Grip />
    </div>
  );
}
