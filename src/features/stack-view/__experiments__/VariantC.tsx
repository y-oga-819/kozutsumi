"use client";

import { useState } from "react";

import { fmtMinutes, SAMPLE_PARENTS, SAMPLE_PROJECTS } from "./sampleData";
import type { SampleParent } from "./sampleData";
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
 * Variant C: 親をスタックに残し、展開で子を表示 (折りたたみ式)。
 *
 * - Stack 上は常に親 1 行 = 1 アイテム。子は親行の下に展開して表示される。
 * - 進捗 (例: 1/3) を親行に出す。
 * - 「次にやるのは親 or 展開した子の先頭か」が曖昧化しやすいトレードオフを観察する。
 */

export function VariantC() {
  const done = useDoneSet();
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(SAMPLE_PARENTS.filter((p) => p.children.length > 0).map((p) => p.id)),
  );
  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <section aria-labelledby="variant-c-heading">
      <h2 id="variant-c-heading" className="sr-only">
        Variant C: 折りたたみ
      </h2>
      <VariantNote
        philosophy="Stack の 1 行 = 1 親。展開で子と進捗が見える。親子関係を UI で常に明示する。"
        tradeoffs={[
          "親子関係が UI で最も明示的",
          "「次にやるのは親 or 子か」の意味が曖昧化しやすい",
          "展開 / 折りたたみの操作分の認知負荷",
          "linearity が崩れる (折りたたみ状態によって見え方が変わる)",
        ]}
      />
      <StackHeader count={SAMPLE_PARENTS.length} />
      <ul role="list" aria-label="タスクスタック (variant C)" className="m-0 list-none p-0">
        {SAMPLE_PARENTS.map((parent, idx) => {
          const isFirst = idx === 0;
          const hasChildren = parent.children.length > 0;
          const open = hasChildren && expanded.has(parent.id);
          const completed = parent.children.filter((c) => done.isDone(c.id)).length;
          return (
            <li key={parent.id}>
              <ParentCard
                isFirst={isFirst}
                parent={parent}
                expanded={open}
                hasChildren={hasChildren}
                completed={completed}
                onToggleExpand={() => hasChildren && toggleExpand(parent.id)}
                done={done.isDone(parent.id)}
                onToggleDone={() => done.toggle(parent.id)}
              />
              {open && (
                <ul
                  id={`variant-c-children-${parent.id}`}
                  role="list"
                  aria-label={`${parent.title} の子タスク`}
                  className="m-0 list-none p-0"
                >
                  {parent.children.map((child) => {
                    const childDone = done.isDone(child.id);
                    const proj = SAMPLE_PROJECTS[parent.projectId];
                    return (
                      <li key={child.id}>
                        <div className="relative mx-4 flex items-center gap-2 pl-7 pr-2.5 py-1.5">
                          <div
                            aria-hidden="true"
                            className="absolute bottom-2 left-3 top-0 w-[2px]"
                            style={{ background: `${proj?.color}40` }}
                          />
                          <div
                            aria-hidden="true"
                            className="absolute left-3 top-1/2 h-[2px] w-3"
                            style={{ background: `${proj?.color}40` }}
                          />
                          <span
                            className={`flex-1 truncate font-jp text-[11px] ${
                              childDone ? "text-fg-faint line-through" : "text-fg-muted"
                            }`}
                          >
                            {child.title}
                          </span>
                          <EstimateBadge minutes={child.estimatedMinutes} />
                          <CompleteButton
                            done={childDone}
                            onToggle={() => done.toggle(child.id)}
                            label={child.title}
                          />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ParentCard({
  isFirst,
  parent,
  expanded,
  hasChildren,
  completed,
  onToggleExpand,
  done,
  onToggleDone,
}: {
  isFirst: boolean;
  parent: SampleParent;
  expanded: boolean;
  hasChildren: boolean;
  completed: number;
  onToggleExpand: () => void;
  done: boolean;
  onToggleDone: () => void;
}) {
  const proj = SAMPLE_PROJECTS[parent.projectId];
  const total = parent.children.length;
  const progress = hasChildren ? `${completed}/${total}` : null;
  const expandLabel = expanded ? "子タスクを折りたたむ" : "子タスクを展開";
  const ExpandToggle = hasChildren ? (
    <button
      type="button"
      aria-label={`${parent.title} の${expandLabel}`}
      aria-expanded={expanded}
      aria-controls={`variant-c-children-${parent.id}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggleExpand();
      }}
      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-fg-muted"
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        style={{ transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.15s" }}
      >
        <polyline
          points="3,2 7,5 3,8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  ) : (
    <span aria-hidden="true" className="h-5 w-5 shrink-0" />
  );

  if (isFirst) {
    return (
      <div
        className="relative mx-4 mb-1 overflow-hidden rounded-[10px] bg-bg-elevated py-3.5 pl-[12px] pr-3.5"
        style={{ border: `1px solid ${proj?.color}40` }}
      >
        <div
          aria-hidden="true"
          className="absolute bottom-0 left-0 top-0 w-[3px]"
          style={{ background: proj?.color }}
        />
        <div className="flex items-start gap-2">
          {ExpandToggle}
          <div className="flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <ProjectDot projectId={parent.projectId} />
              <ProjectName projectId={parent.projectId} />
              {parent.depEvent && <DepBadge dep={parent.depEvent} />}
              <StatusPill status={parent.decomposeStatus} />
              {progress && (
                <span className="rounded-[3px] bg-fg-weak/15 px-1.5 py-px font-jp text-[8px] tabular-nums text-fg-muted">
                  {progress}
                </span>
              )}
            </div>
            <div className="font-jp text-[15px] font-semibold leading-[1.4] text-fg-strong">
              {parent.title}
            </div>
            {hasChildren && (
              <div className="mt-1 font-jp text-[10px] text-fg-faint">
                合計 {fmtMinutes(parent.children.reduce((a, c) => a + c.estimatedMinutes, 0))}
              </div>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <EstimateBadge minutes={parent.estimatedMinutes} />
            <CompleteButton done={done} onToggle={onToggleDone} label={parent.title} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-4 flex items-center gap-2 border-b border-bg-elevated px-1 py-2">
      {ExpandToggle}
      <ProjectDot projectId={parent.projectId} size={6} />
      <span className="flex-1 truncate font-jp text-[12px] text-fg-muted">{parent.title}</span>
      {parent.depEvent && <DepBadge dep={parent.depEvent} />}
      <StatusPill status={parent.decomposeStatus} />
      {progress && (
        <span className="rounded-[3px] bg-fg-weak/15 px-1.5 py-px font-jp text-[8px] tabular-nums text-fg-muted">
          {progress}
        </span>
      )}
      <EstimateBadge minutes={parent.estimatedMinutes} />
      <CompleteButton done={done} onToggle={onToggleDone} label={parent.title} />
    </div>
  );
}
