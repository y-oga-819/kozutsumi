"use client";

import { fmtMinutes, SAMPLE_PARENTS, SAMPLE_PROJECTS } from "./sampleData";
import type { SampleChild, SampleParent } from "./sampleData";
import {
  CompleteButton,
  DepBadge,
  EstimateBadge,
  ParallelogramProgress,
  ProjectDot,
  ProjectName,
  StackHeader,
  StatusPill,
  VariantNote,
  useDoneSet,
} from "./shared";

/**
 * Variant E: ハイブリッド (子フラット + Top に Goal box + 子へ親 dep 継承
 * + 平行四辺形プログレス)。
 *
 * 採用理由は `docs/open-questions.md`「Stack View カードの情報設計」表に対応:
 * 1. 親 (=ゴール) を Top の Goal 行で見せる
 * 2. 完了境界 (M/N) は数字併記をやめ、平行四辺形プログレスで集約表現
 * 3. 親 dep event を子へ継承 (imminent のみ amber pill で強調)
 * 4. 親グループの合計時間を Top に出す
 * 5. Top カードを視覚的に強く (情報量 + 高さ + 枠)
 * 6. 行カードは 2 行構成にしてタイトルに広い領域を確保 (省略を防ぐ)
 * 7. 同親グループの縦線は出さない (DnD 分断対策)
 *
 * Stack 行は子のまま (linearity 維持)。
 */

type Row =
  | {
      kind: "leaf-child";
      parent: SampleParent;
      child: SampleChild;
      indexInParent: number; // 1-based
      siblingTotal: number;
      doneInParent: number;
    }
  | { kind: "leaf-parent"; parent: SampleParent };

function flatten(parents: readonly SampleParent[], isDone: (id: string) => boolean): Row[] {
  const rows: Row[] = [];
  for (const parent of parents) {
    if (parent.decomposeStatus === "decomposed" && parent.children.length > 0) {
      const doneInParent = parent.children.filter((c) => isDone(c.id)).length;
      parent.children.forEach((child, i) => {
        rows.push({
          kind: "leaf-child",
          parent,
          child,
          indexInParent: i + 1,
          siblingTotal: parent.children.length,
          doneInParent,
        });
      });
    } else {
      rows.push({ kind: "leaf-parent", parent });
    }
  }
  return rows;
}

function totalMinutes(parent: SampleParent): number {
  if (parent.children.length === 0) return parent.estimatedMinutes;
  return parent.children.reduce((a, c) => a + c.estimatedMinutes, 0);
}

export function VariantE() {
  const done = useDoneSet();
  const rows = flatten(SAMPLE_PARENTS, done.isDone);

  return (
    <section aria-labelledby="variant-e-heading">
      <h2 id="variant-e-heading" className="sr-only">
        Variant E: ハイブリッド
      </h2>
      <VariantNote
        philosophy="Stack 行 = 子のまま。Top カードは「Goal box (親 + 進捗バー + 合計)」を集約。子は親 dep を継承。行カードは 2 行構成でタイトル単独行を確保し、メタ (親 / dep / 進捗) は薄い 2 行目に置く。"
        tradeoffs={[
          "進捗を数字 (M/N + 残り N/N) ではなく平行四辺形プログレスで集約 → 数字の重複を解消",
          "行カードが 2 行になるぶん縦に伸びる → スクロール 1 視野の件数は減る",
          "親由来 dep event は imminent のみ pill 表示 (常時表示は情報過多)",
          "親グループの縦線は出さない → DnD 並び替えで破綻しない",
        ]}
      />
      <StackHeader count={rows.length} />
      <ul role="list" aria-label="タスクスタック (variant E)" className="m-0 list-none p-0">
        {rows.map((row, idx) => {
          const isFirst = idx === 0;
          if (row.kind === "leaf-child") {
            const id = row.child.id;
            const isDone = done.isDone(id);
            return (
              <li key={id}>
                {isFirst ? (
                  <ChildTopCard
                    parent={row.parent}
                    child={row.child}
                    indexInParent={row.indexInParent}
                    siblingTotal={row.siblingTotal}
                    doneInParent={row.doneInParent}
                    done={isDone}
                    onToggle={() => done.toggle(id)}
                  />
                ) : (
                  <ChildRow
                    parent={row.parent}
                    child={row.child}
                    indexInParent={row.indexInParent}
                    siblingTotal={row.siblingTotal}
                    doneInParent={row.doneInParent}
                    done={isDone}
                    onToggle={() => done.toggle(id)}
                  />
                )}
              </li>
            );
          }
          return (
            <li key={row.parent.id}>
              {isFirst ? (
                <ParentTopCard
                  parent={row.parent}
                  done={done.isDone(row.parent.id)}
                  onToggle={() => done.toggle(row.parent.id)}
                />
              ) : (
                <ParentRow
                  parent={row.parent}
                  done={done.isDone(row.parent.id)}
                  onToggle={() => done.toggle(row.parent.id)}
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ------------------------------- Child rows ------------------------------- */

function ChildTopCard({
  parent,
  child,
  indexInParent,
  siblingTotal,
  doneInParent,
  done,
  onToggle,
}: {
  parent: SampleParent;
  child: SampleChild;
  indexInParent: number;
  siblingTotal: number;
  doneInParent: number;
  done: boolean;
  onToggle: () => void;
}) {
  const proj = SAMPLE_PROJECTS[parent.projectId];
  const total = totalMinutes(parent);
  return (
    <div
      className="relative mx-4 mb-1 overflow-hidden rounded-[10px] bg-bg-elevated py-3.5 pl-[18px] pr-3.5"
      style={{ border: `1px solid ${proj?.color}40` }}
    >
      <div
        aria-hidden="true"
        className="absolute bottom-0 left-0 top-0 w-[3px]"
        style={{ background: proj?.color }}
      />
      <div className="flex items-start gap-2.5">
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
                total={siblingTotal}
                doneCount={doneInParent}
                currentIndex={indexInParent}
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
          <CompleteButton done={done} onToggle={onToggle} label={child.title} />
        </div>
      </div>
    </div>
  );
}

function ChildRow({
  parent,
  child,
  indexInParent,
  siblingTotal,
  doneInParent,
  done,
  onToggle,
}: {
  parent: SampleParent;
  child: SampleChild;
  indexInParent: number;
  siblingTotal: number;
  doneInParent: number;
  done: boolean;
  onToggle: () => void;
}) {
  const proj = SAMPLE_PROJECTS[parent.projectId];
  return (
    <div className="mx-4 border-b border-bg-elevated px-2.5 py-2">
      {/* 1 行目: タイトルが主役。親メタは下に押し出してタイトル省略を防ぐ */}
      <div className="flex items-center gap-2">
        <ProjectDot projectId={parent.projectId} size={6} />
        <span
          className={`flex-1 truncate font-jp text-[12px] ${
            done ? "text-fg-faint line-through" : "text-fg-default"
          }`}
        >
          {child.title}
        </span>
        <EstimateBadge minutes={child.estimatedMinutes} />
        <CompleteButton done={done} onToggle={onToggle} label={child.title} />
      </div>
      {/* 2 行目: 親 + (imminent dep) + 平行四辺形プログレス */}
      <div className="ml-[14px] mt-1 flex items-center gap-2">
        <span
          className="min-w-0 flex-1 truncate font-jp text-[9px]"
          style={{ color: `${proj?.color ?? "#52525b"}cc` }}
          title={`親: ${parent.title}`}
        >
          ⤷ {parent.title}
        </span>
        {parent.depEvent?.imminent && <DepBadge dep={parent.depEvent} />}
        <ParallelogramProgress
          total={siblingTotal}
          doneCount={doneInParent}
          currentIndex={indexInParent}
          color={proj?.color ?? "#52525b"}
          size="sm"
        />
      </div>
    </div>
  );
}

/* ------------------------------- Parent rows ------------------------------ */
// 未分解 (decomposing / skipped / none) の親はそのまま並ぶ。

function ParentTopCard({
  parent,
  done,
  onToggle,
}: {
  parent: SampleParent;
  done: boolean;
  onToggle: () => void;
}) {
  const proj = SAMPLE_PROJECTS[parent.projectId];
  return (
    <div
      className="relative mx-4 mb-1 overflow-hidden rounded-[10px] bg-bg-elevated py-3.5 pl-[18px] pr-3.5"
      style={{ border: `1px solid ${proj?.color}40` }}
    >
      <div
        aria-hidden="true"
        className="absolute bottom-0 left-0 top-0 w-[3px]"
        style={{ background: proj?.color }}
      />
      <div className="flex items-start gap-2.5">
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
          <CompleteButton done={done} onToggle={onToggle} label={parent.title} />
        </div>
      </div>
    </div>
  );
}

function ParentRow({
  parent,
  done,
  onToggle,
}: {
  parent: SampleParent;
  done: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="mx-4 border-b border-bg-elevated px-2.5 py-2">
      <div className="flex items-center gap-2">
        <ProjectDot projectId={parent.projectId} size={6} />
        <span
          className={`flex-1 truncate font-jp text-[12px] ${
            done ? "text-fg-faint line-through" : "text-fg-default"
          }`}
        >
          {parent.title}
        </span>
        <EstimateBadge minutes={parent.estimatedMinutes} />
        <CompleteButton done={done} onToggle={onToggle} label={parent.title} />
      </div>
      <div className="ml-[14px] mt-1 flex items-center gap-2">
        {parent.depEvent && <DepBadge dep={parent.depEvent} />}
        <StatusPill status={parent.decomposeStatus} />
      </div>
    </div>
  );
}
