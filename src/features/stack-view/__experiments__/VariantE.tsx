"use client";

import { useMemo, useRef, useState } from "react";

import { useStackDnD } from "../../task-stack/useStackDnD";
import {
  fmtMinutes,
  SAMPLE_INITIAL_DONE,
  SAMPLE_PARENTS,
  SAMPLE_PROJECTS,
} from "./sampleData";
import type { SampleChild, SampleParent } from "./sampleData";
import {
  CompleteButton,
  DepBadge,
  EstimateBadge,
  Grip,
  ParallelogramProgress,
  ProjectDot,
  ProjectName,
  StackHeader,
  StatusPill,
  VariantNote,
} from "./shared";

/**
 * Variant E: ハイブリッド (子フラット + Top に Goal box + 子へ親 dep 継承
 * + 平行四辺形プログレス + DnD + Top-only complete + Done list)。
 *
 * 採用理由は `docs/open-questions.md`「Stack View カードの情報設計」表に対応。
 *
 * 実機要件 (User feedback round 3):
 * - DnD で並び替え可能。並び替えると progress bar の current 位置が動的に変わる
 * - 完了は Top カードからのみ (上から消化の原則)
 * - 完了タスクは Done リストに落ちる。表示は Stack カードと同じレイアウト
 *
 * Progress 計算: `currentIndex = doneCount + (Stack 残中の同親子の中での自分の位置)`。
 * - 子に固有順序は無いので、固定 indexInParent ではなく Stack 出現順で current が決まる
 * - done が進むと「自分のセグメント」が右へオフセット → 進捗バーの意味として自然
 */

type Item =
  | { kind: "leaf-child"; parent: SampleParent; child: SampleChild }
  | { kind: "leaf-parent"; parent: SampleParent };

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

export function VariantE() {
  const itemById = useMemo(() => buildItemMap(SAMPLE_PARENTS), []);
  const allIds = useMemo(() => buildAllIds(SAMPLE_PARENTS), []);

  const [pendingIds, setPendingIds] = useState<string[]>(() =>
    allIds.filter((id) => !SAMPLE_INITIAL_DONE.includes(id)),
  );
  const [doneIds, setDoneIds] = useState<string[]>(() => [...SAMPLE_INITIAL_DONE]);
  const doneSet = useMemo(() => new Set(doneIds), [doneIds]);

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
    // 新着 done を先頭にしておくと、完了したものから順に上へ並ぶ。
    setDoneIds((prev) => [id, ...prev]);
  };

  const handleUndoDone = (id: string) => {
    setDoneIds((prev) => prev.filter((x) => x !== id));
    // 戻すと Stack の末尾に置く (上から消化の原則を崩さない)。
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
        Variant E: ハイブリッド (DnD + Top-only complete + Done list)
      </h2>
      <VariantNote
        philosophy="Stack 行 = 子のまま。Top カードに Goal box を集約。子は親 dep を継承。行カードは 3 行構成 (タイトル + 見積 / dep / 親 + ステータス) でタイトル省略を防ぐ。完了は Top のみ (上から消化の原則)、完了タスクは Done リストへ。並び替えは DnD で。"
        tradeoffs={[
          "行カード右下のスロットは「親の AI 分解状態」を表現: 未分解 / 分解中 / 分解不要 / 分解済み (= 進捗バー) の状態遷移として統一",
          "DnD で Stack 順を変えると、進捗バーの current 位置も動的に変わる",
          "currentIndex = doneCount + (Stack 残中の同親子における自分の位置) → 自分のセグメントは done 群の直後にずれていく",
          "完了は Top カードのみ (行カードから check を外し Grip に置換)",
          "完了タスクは Done リストへ移動。Done 内では「戻す」で復元 (Stack 末尾)",
          "セグメント幅は子数に応じて 3 段階 (~5 / ~9 / 10+) で自動縮小",
          "デモシナリオ: p1 (3 子, A→逆質問→B) / p8 (4 子, 3 完了) / p7 (10 子, 4 完了)",
        ]}
      />
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

/* ----------------------------- Pending row 振り分け ----------------------------- */

function PendingRow({
  item,
  isFirst,
  isBeingDragged,
  pendingItems,
  doneSet,
  onPointerDown,
  onComplete,
}: {
  item: Item;
  isFirst: boolean;
  isBeingDragged: boolean;
  pendingItems: { id: string; item: Item }[];
  doneSet: ReadonlySet<string>;
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

/* ------------------------------- Child rows ------------------------------- */

function ChildTopCard({
  parent,
  child,
  progress,
  isBeingDragged,
  onPointerDown,
  onComplete,
}: {
  parent: SampleParent;
  child: SampleChild;
  progress: Progress;
  isBeingDragged: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
  onComplete: () => void;
}) {
  const proj = SAMPLE_PROJECTS[parent.projectId];
  const total = totalMinutes(parent);
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
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <ProjectDot projectId={parent.projectId} />
            <ProjectName projectId={parent.projectId} />
            {parent.depEvent && <DepBadge dep={parent.depEvent} />}
          </div>
          <div className="font-jp text-[15px] font-semibold leading-[1.4] text-fg-strong">
            {child.title}
          </div>
          <div
            aria-label="ゴール情報"
            className="mt-2 rounded-[6px] border border-bg-border/70 px-2 py-1.5"
          >
            <div className="flex items-center gap-1 font-jp text-[9px] text-fg-subtle">
              <span className="font-semibold uppercase tracking-[0.06em]">Goal</span>
              <span aria-hidden="true">·</span>
              <span className="truncate" style={{ color: proj?.color }}>
                {parent.title}
              </span>
            </div>
            <div className="mt-1.5 flex items-center gap-2">
              <ParallelogramProgress
                total={progress.total}
                doneCount={progress.doneCount}
                currentIndex={progress.currentIndex}
                color={proj?.color ?? "#52525b"}
                size="md"
              />
              <span className="font-jp text-[10px] tabular-nums text-fg-muted">
                合計 {fmtMinutes(total)}
              </span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <EstimateBadge minutes={child.estimatedMinutes} />
          <CompleteButton done={false} onToggle={onComplete} label={child.title} />
        </div>
      </div>
    </div>
  );
}

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
      {/* 1 行目: タイトル (左詰め) + 見積もり (右詰め) */}
      <div className="flex items-center gap-2">
        <DragHandle onPointerDown={onPointerDown} />
        <ProjectDot projectId={parent.projectId} size={6} />
        <span className="flex-1 truncate font-jp text-[12px] text-fg-default">{child.title}</span>
        <EstimateBadge minutes={child.estimatedMinutes} />
      </div>
      {/* 2 行目: 親由来の dep event (右詰め)。imminent は DepBadge 側で濃色に差分表示 */}
      {parent.depEvent && (
        <div className="ml-[26px] mt-1 flex items-center justify-end gap-2">
          <DepBadge dep={parent.depEvent} />
        </div>
      )}
      {/* 3 行目: 親タスク名 (左詰め) + ステータスバー (= 親の AI 分解状態スロット, 右詰め) */}
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

/* ------------------------------- Parent rows ------------------------------ */

function ParentTopCard({
  parent,
  isBeingDragged,
  onPointerDown,
  onComplete,
}: {
  parent: SampleParent;
  isBeingDragged: boolean;
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
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <ProjectDot projectId={parent.projectId} />
            <ProjectName projectId={parent.projectId} />
            {parent.depEvent && <DepBadge dep={parent.depEvent} />}
            <StatusPill status={parent.decomposeStatus} />
          </div>
          <div className="font-jp text-[15px] font-semibold leading-[1.4] text-fg-strong">
            {parent.title}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <EstimateBadge minutes={parent.estimatedMinutes} />
          <CompleteButton done={false} onToggle={onComplete} label={parent.title} />
        </div>
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
      {/* 1 行目: タイトル (左詰め) + 見積もり (右詰め) */}
      <div className="flex items-center gap-2">
        <DragHandle onPointerDown={onPointerDown} />
        <ProjectDot projectId={parent.projectId} size={6} />
        <span className="flex-1 truncate font-jp text-[12px] text-fg-default">{parent.title}</span>
        <EstimateBadge minutes={parent.estimatedMinutes} />
      </div>
      {/* 2 行目: dep event (右詰め)。imminent は DepBadge 側で濃色に差分表示 */}
      {parent.depEvent && (
        <div className="ml-[26px] mt-1 flex items-center justify-end gap-2">
          <DepBadge dep={parent.depEvent} />
        </div>
      )}
      {/* 3 行目: AI 分解状態 (右詰め)。子の進捗バーと同じスロットに置いて、
                 「未分解 / 分解中 / 分解不要 / 分解済み (= progress bar)」の状態遷移を統一表現 */}
      <div className="ml-[26px] mt-1 flex items-center justify-end gap-2">
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

/**
 * Done された子の progress 表示。done セグメント群の数を見せるだけで、
 * 「自分のセグメント」を強調しない (currentIndex=0 = 強調なし)。
 */
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
  // pointerdown を card 全体の click と分離するため stopPropagation。
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
