"use client";

import { SAMPLE_PARENTS, SAMPLE_PROJECTS } from "./sampleData";
import type { SampleChild, SampleParent } from "./sampleData";
import {
  CompleteButton,
  DepBadge,
  EstimateBadge,
  ProjectDot,
  StackHeader,
  StatusPill,
  VariantNote,
  useDoneSet,
} from "./shared";

/**
 * Variant D: breadcrumb 表示。
 *
 * - 子はフラットに並ぶ。各行のタイトル上に「project / 親」のパス表示。
 * - linearity を保ちつつコンテキストを残す試み。
 * - 多階層 (project → epic → story → task) になるとパスが長くなる課題を観察する。
 */

type Row =
  | { kind: "leaf-child"; parent: SampleParent; child: SampleChild }
  | { kind: "leaf-parent"; parent: SampleParent };

function flatten(parents: readonly SampleParent[]): Row[] {
  const rows: Row[] = [];
  for (const parent of parents) {
    if (parent.decomposeStatus === "decomposed" && parent.children.length > 0) {
      for (const child of parent.children) {
        rows.push({ kind: "leaf-child", parent, child });
      }
    } else {
      rows.push({ kind: "leaf-parent", parent });
    }
  }
  return rows;
}

export function VariantD() {
  const done = useDoneSet();
  const rows = flatten(SAMPLE_PARENTS);

  return (
    <section aria-labelledby="variant-d-heading">
      <h2 id="variant-d-heading" className="sr-only">
        Variant D: breadcrumb
      </h2>
      <VariantNote
        philosophy="子はフラットに並ぶ。タイトル上に project / 親 のパスを breadcrumb で出してコンテキストを残す。"
        tradeoffs={[
          "linearity + コンテキストを両立",
          "breadcrumb 行が増えると縦に伸びる (情報密度の負担)",
          "多階層 (project → epic → story → task) で長くなりやすい",
          "B のバッジ案より「経路」感が強く、抽象度の違うコンテキストが見える",
        ]}
      />
      <StackHeader count={rows.length} />
      <ul role="list" aria-label="タスクスタック (variant D)" className="m-0 list-none p-0">
        {rows.map((row, idx) => {
          const isFirst = idx === 0;
          if (row.kind === "leaf-child") {
            const id = row.child.id;
            return (
              <li key={id}>
                <ChildRow
                  isFirst={isFirst}
                  parent={row.parent}
                  child={row.child}
                  done={done.isDone(id)}
                  onToggle={() => done.toggle(id)}
                />
              </li>
            );
          }
          return (
            <li key={row.parent.id}>
              <ParentRow
                isFirst={isFirst}
                parent={row.parent}
                done={done.isDone(row.parent.id)}
                onToggle={() => done.toggle(row.parent.id)}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Breadcrumb({ parent, includeParent }: { parent: SampleParent; includeParent: boolean }) {
  const proj = SAMPLE_PROJECTS[parent.projectId];
  return (
    <nav
      aria-label="所属パス"
      className="flex min-w-0 items-center gap-1 font-jp text-[9px] text-fg-subtle"
    >
      <span style={{ color: proj?.color }}>{proj?.name ?? "—"}</span>
      {includeParent && (
        <>
          <span aria-hidden="true" className="text-fg-faint">
            /
          </span>
          <span className="truncate">{parent.title}</span>
        </>
      )}
    </nav>
  );
}

function ChildRow({
  isFirst,
  parent,
  child,
  done,
  onToggle,
}: {
  isFirst: boolean;
  parent: SampleParent;
  child: SampleChild;
  done: boolean;
  onToggle: () => void;
}) {
  const proj = SAMPLE_PROJECTS[parent.projectId];
  if (isFirst) {
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
            <Breadcrumb parent={parent} includeParent={true} />
            {parent.depEvent && (
              <div className="mt-1">
                <DepBadge dep={parent.depEvent} />
              </div>
            )}
            <div className="mt-1 font-jp text-[15px] font-semibold leading-[1.4] text-fg-strong">
              {child.title}
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

  return (
    <div className="mx-4 border-b border-bg-elevated px-2.5 py-2">
      <div className="flex items-center gap-2">
        <ProjectDot projectId={parent.projectId} size={6} />
        <Breadcrumb parent={parent} includeParent={true} />
      </div>
      <div className="mt-0.5 flex items-center gap-2">
        <span className="ml-[14px] flex-1 truncate font-jp text-[12px] text-fg-muted">
          {child.title}
        </span>
        <EstimateBadge minutes={child.estimatedMinutes} />
        <CompleteButton done={done} onToggle={onToggle} label={child.title} />
      </div>
    </div>
  );
}

function ParentRow({
  isFirst,
  parent,
  done,
  onToggle,
}: {
  isFirst: boolean;
  parent: SampleParent;
  done: boolean;
  onToggle: () => void;
}) {
  const proj = SAMPLE_PROJECTS[parent.projectId];
  if (isFirst) {
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
            <Breadcrumb parent={parent} includeParent={false} />
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              {parent.depEvent && <DepBadge dep={parent.depEvent} />}
              <StatusPill status={parent.decomposeStatus} />
            </div>
            <div className="mt-1 font-jp text-[15px] font-semibold leading-[1.4] text-fg-strong">
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

  return (
    <div className="mx-4 border-b border-bg-elevated px-2.5 py-2">
      <div className="flex items-center gap-2">
        <ProjectDot projectId={parent.projectId} size={6} />
        <Breadcrumb parent={parent} includeParent={false} />
        <StatusPill status={parent.decomposeStatus} />
      </div>
      <div className="mt-0.5 flex items-center gap-2">
        <span className="ml-[14px] flex-1 truncate font-jp text-[12px] text-fg-muted">
          {parent.title}
        </span>
        {parent.depEvent && <DepBadge dep={parent.depEvent} />}
        <EstimateBadge minutes={parent.estimatedMinutes} />
        <CompleteButton done={done} onToggle={onToggle} label={parent.title} />
      </div>
    </div>
  );
}
