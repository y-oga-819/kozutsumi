"use client";

import { fmtMinutes, SAMPLE_PARENTS, SAMPLE_PROJECTS } from "./sampleData";
import type { SampleChild, SampleParent } from "./sampleData";
import {
  CompleteButton,
  DepBadge,
  EstimateBadge,
  ProjectDot,
  ProjectName,
  StackHeader,
  StatusPill,
  VariantNote,
  useDoneSet,
} from "./shared";

/**
 * Variant E: ハイブリッド (子フラット + Top に Goal 行 + 子へ親 dep 継承)。
 *
 * 採用理由は `docs/open-questions.md`「Stack View カードの情報設計」表に対応:
 * 1. 親 (=ゴール) を Top の Goal 行で見せる
 * 2. 完了境界 (M/N) を Top と各行に出す
 * 3. 親 dep event を子へ継承して amber pill で表示 (D の弱点解消)
 * 4. 親グループの合計時間を Top に出す
 * 5. Top カードを視覚的に強く (情報量 + 高さ + 枠)
 * 6. 行カードは情報絞り込み (project dot + title + 親短縮 + dep + estimate + check)
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
      doneInParent: number; // 親グループ内の done 数 (動的に計算)
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
        philosophy="Stack 行 = 子のまま (linearity 維持)。Top カードに「Goal 行 (親 · M/N · 合計)」を集約。子は親 dep event を継承してデッドラインが消えない。行カードは情報を絞る。"
        tradeoffs={[
          "Top カードと行カードで情報量を意図的に変える (Top 重視)",
          "親グループの縦線は無し → DnD 並び替えで分断されても破綻しない",
          "親由来 dep event を子に継承するので「いつまでに何個全部やる?」が分かる",
          "Top カードが他より高くなる ぶん、スクロール 1 視野の情報量がやや減る",
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
  const remaining = siblingTotal - doneInParent;
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
            <span className="rounded-[3px] bg-fg-weak/15 px-1.5 py-px font-jp text-[8px] tabular-nums text-fg-muted">
              {indexInParent}/{siblingTotal}
            </span>
          </div>
          <div className="font-jp text-[15px] font-semibold leading-[1.4] text-fg-strong">
            {child.title}
          </div>
          <div
            aria-label="ゴール情報"
            className="mt-1.5 rounded-[6px] border border-bg-border/70 px-2 py-1.5"
          >
            <div className="flex items-center gap-1 font-jp text-[9px] text-fg-subtle">
              <span className="font-semibold uppercase tracking-[0.06em]">Goal</span>
              <span aria-hidden="true">·</span>
              <span className="truncate" style={{ color: proj?.color }}>
                {parent.title}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-2 font-jp text-[10px] text-fg-muted">
              <span className="tabular-nums">
                残り {remaining}/{siblingTotal}
              </span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">合計 {fmtMinutes(total)}</span>
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
  done,
  onToggle,
}: {
  parent: SampleParent;
  child: SampleChild;
  indexInParent: number;
  siblingTotal: number;
  done: boolean;
  onToggle: () => void;
}) {
  const proj = SAMPLE_PROJECTS[parent.projectId];
  const ParentBadge = (
    <span
      className="max-w-[120px] truncate rounded-[3px] px-1.5 py-px font-jp text-[8px] tabular-nums"
      style={{ background: `${proj?.color}20`, color: proj?.color }}
      title={`親: ${parent.title}`}
    >
      ⤷ {parent.title} ({indexInParent}/{siblingTotal})
    </span>
  );
  return (
    <div className="mx-4 flex items-center gap-2 border-b border-bg-elevated px-2.5 py-2">
      <ProjectDot projectId={parent.projectId} size={6} />
      <span
        className={`flex-1 truncate font-jp text-[12px] ${
          done ? "text-fg-faint line-through" : "text-fg-muted"
        }`}
      >
        {child.title}
      </span>
      {ParentBadge}
      {parent.depEvent?.imminent && <DepBadge dep={parent.depEvent} />}
      <EstimateBadge minutes={child.estimatedMinutes} />
      <CompleteButton done={done} onToggle={onToggle} label={child.title} />
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
    <div className="mx-4 flex items-center gap-2 border-b border-bg-elevated px-2.5 py-2">
      <ProjectDot projectId={parent.projectId} size={6} />
      <span className="flex-1 truncate font-jp text-[12px] text-fg-muted">{parent.title}</span>
      {parent.depEvent && <DepBadge dep={parent.depEvent} />}
      <StatusPill status={parent.decomposeStatus} />
      <EstimateBadge minutes={parent.estimatedMinutes} />
      <CompleteButton done={done} onToggle={onToggle} label={parent.title} />
    </div>
  );
}
