"use client";

import { SAMPLE_PARENTS, SAMPLE_PROJECTS } from "./sampleData";
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
 * Variant B: 子フラット + 親バッジ / グループ化。
 *
 * - 分解済み (decomposed) の親は子に展開され、各子に親名バッジが付く。
 * - 連続する同親の子は左側に「親色のサブ縦線」を表示してグルーピング。
 * - 未分解 / 分解中 / 分解不要の親は親のまま並ぶ。
 *
 * 狙いは A の linearity と C のコンテキスト保持の両立。
 */

type Row =
  | {
      kind: "leaf-child";
      parent: SampleParent;
      child: SampleChild;
      groupStart: boolean;
      groupEnd: boolean;
    }
  | { kind: "leaf-parent"; parent: SampleParent };

function flatten(parents: readonly SampleParent[]): Row[] {
  const rows: Row[] = [];
  for (const parent of parents) {
    if (parent.decomposeStatus === "decomposed" && parent.children.length > 0) {
      parent.children.forEach((child, i) => {
        rows.push({
          kind: "leaf-child",
          parent,
          child,
          groupStart: i === 0,
          groupEnd: i === parent.children.length - 1,
        });
      });
    } else {
      rows.push({ kind: "leaf-parent", parent });
    }
  }
  return rows;
}

export function VariantB() {
  const done = useDoneSet();
  const rows = flatten(SAMPLE_PARENTS);

  return (
    <section aria-labelledby="variant-b-heading">
      <h2 id="variant-b-heading" className="sr-only">
        Variant B: フラット + 親バッジ
      </h2>
      <VariantNote
        philosophy="子はフラットに並ぶ (linearity を維持) が、各子に親名バッジ + 連続グループの縦線でコンテキストを残す。"
        tradeoffs={[
          "linearity と親コンテキストの両立を狙う",
          "情報量が増えやすい (バッジ + dep + 見積もり + ステータス)",
          "並び替えで親グループが分断されたとき、縦線がブツ切りになる",
          "AI 分解の動作が「親バッジが増える」ことで間接的に見える",
        ]}
      />
      <StackHeader count={rows.length} />
      <ul role="list" aria-label="タスクスタック (variant B)" className="m-0 list-none p-0">
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
                  groupStart={row.groupStart}
                  groupEnd={row.groupEnd}
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

function GroupLine({ color, top, bottom }: { color: string; top: boolean; bottom: boolean }) {
  // top=false なら上端から、bottom=false なら下端まで線を伸ばす。グループ内連結用。
  return (
    <div
      aria-hidden="true"
      className="absolute left-0 w-[2px]"
      style={{
        background: color,
        top: top ? "8px" : "0",
        bottom: bottom ? "8px" : "0",
        opacity: 0.55,
      }}
    />
  );
}

function ChildRow({
  isFirst,
  parent,
  child,
  groupStart,
  groupEnd,
  done,
  onToggle,
}: {
  isFirst: boolean;
  parent: SampleParent;
  child: SampleChild;
  groupStart: boolean;
  groupEnd: boolean;
  done: boolean;
  onToggle: () => void;
}) {
  const proj = SAMPLE_PROJECTS[parent.projectId];
  const ParentBadge = (
    <span
      className="max-w-[140px] truncate rounded-[3px] px-1.5 py-px font-jp text-[8px]"
      style={{ background: `${proj?.color}20`, color: proj?.color }}
      title={`親: ${parent.title}`}
    >
      ⤷ {parent.title}
    </span>
  );

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
          <div className="flex-1">
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <ProjectDot projectId={parent.projectId} />
              <ProjectName projectId={parent.projectId} />
              {parent.depEvent && <DepBadge dep={parent.depEvent} />}
              {ParentBadge}
            </div>
            <div className="font-jp text-[15px] font-semibold leading-[1.4] text-fg-strong">
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
    <div className="relative mx-4 flex items-center gap-2 border-b border-bg-elevated py-2 pl-3 pr-2.5">
      <GroupLine color={proj?.color ?? "#52525b"} top={groupStart} bottom={groupEnd} />
      <ProjectDot projectId={parent.projectId} size={6} />
      <span className="flex-1 truncate font-jp text-[12px] text-fg-muted">{child.title}</span>
      {ParentBadge}
      <EstimateBadge minutes={child.estimatedMinutes} />
      <CompleteButton done={done} onToggle={onToggle} label={child.title} />
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
          <div className="flex-1">
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
