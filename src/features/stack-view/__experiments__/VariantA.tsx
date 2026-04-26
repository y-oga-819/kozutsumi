"use client";

import { SAMPLE_PARENTS, SAMPLE_PROJECTS } from "./sampleData";
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
 * Variant A: 子のみ Stack / 親は Tree View だけ。
 *
 * - 分解済み (decomposed) の親は Stack に出さない。子だけがフラットに並ぶ。
 * - 分解中 / 未分解 / 分解不要 (decomposing / none / skipped) の親はそのまま並ぶ
 *   (まだ「分解された結果の子」が存在しないので)。
 * - 分解結果が後から到着すると、親が消えて子に置き換わる。「気づいたら細かく
 *   なってる」体験を最大化する形。
 */

type Row =
  | { kind: "leaf-child"; parent: SampleParent; child: SampleParent["children"][number] }
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

export function VariantA() {
  const done = useDoneSet();
  const rows = flatten(SAMPLE_PARENTS);

  return (
    <section aria-labelledby="variant-a-heading">
      <h2 id="variant-a-heading" className="sr-only">
        Variant A: 子のみスタック
      </h2>
      <VariantNote
        philosophy="分解済みの子だけがフラットに並ぶ。親はデータ上残るが Stack View には出ない。"
        tradeoffs={[
          "linearity が最も素直。「次の 1 つ」が常に最小単位",
          "親のコンテキスト (何のための一連か) が Stack 上で消える",
          "分解前 → 分解後で視覚的に親が消えるので、AI の動作が察知されやすい",
          "未分解の親 (decomposing / none) は親のまま並ぶ → 同じ Stack 内に粒度が混在",
        ]}
      />
      <StackHeader count={rows.length} />
      <ul role="list" aria-label="タスクスタック (variant A)" className="m-0 list-none p-0">
        {rows.map((row, idx) => {
          const isFirst = idx === 0;
          if (row.kind === "leaf-child") {
            const id = row.child.id;
            return (
              <li key={id}>
                <Row
                  isFirst={isFirst}
                  projectId={row.parent.projectId}
                  title={row.child.title}
                  estimatedMinutes={row.child.estimatedMinutes}
                  done={done.isDone(id)}
                  onToggle={() => done.toggle(id)}
                />
              </li>
            );
          }
          return (
            <li key={row.parent.id}>
              <Row
                isFirst={isFirst}
                projectId={row.parent.projectId}
                title={row.parent.title}
                estimatedMinutes={row.parent.estimatedMinutes}
                dep={row.parent.depEvent}
                statusPill={<StatusPill status={row.parent.decomposeStatus} />}
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

function Row({
  isFirst,
  projectId,
  title,
  estimatedMinutes,
  dep,
  statusPill,
  done,
  onToggle,
}: {
  isFirst: boolean;
  projectId: string;
  title: string;
  estimatedMinutes: number;
  dep?: SampleParent["depEvent"];
  statusPill?: React.ReactNode;
  done: boolean;
  onToggle: () => void;
}) {
  const proj = SAMPLE_PROJECTS[projectId];
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
              <ProjectDot projectId={projectId} />
              <ProjectName projectId={projectId} />
              {dep && <DepBadge dep={dep} />}
              {statusPill}
            </div>
            <div className="font-jp text-[15px] font-semibold leading-[1.4] text-fg-strong">
              {title}
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2">
            <EstimateBadge minutes={estimatedMinutes} />
            <CompleteButton done={done} onToggle={onToggle} label={title} />
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="mx-4 flex items-center gap-2 border-b border-bg-elevated px-2.5 py-2">
      <ProjectDot projectId={projectId} size={6} />
      <span className="flex-1 truncate font-jp text-[12px] text-fg-muted">{title}</span>
      {dep && <DepBadge dep={dep} />}
      {statusPill}
      <EstimateBadge minutes={estimatedMinutes} />
      <CompleteButton done={done} onToggle={onToggle} label={title} />
    </div>
  );
}
