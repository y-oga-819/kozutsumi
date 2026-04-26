"use client";

import { useState } from "react";

import { fmtMinutes, SAMPLE_PROJECTS } from "./sampleData";
import type { DecomposeStatus, SampleParent } from "./sampleData";

/** 各 variant が独立に done を持つ。比較中に「他 variant の操作が混じる」誤読を防ぐ。 */
export function useDoneSet(initial?: Iterable<string>): {
  isDone: (id: string) => boolean;
  toggle: (id: string) => void;
} {
  const [done, setDone] = useState<ReadonlySet<string>>(() => new Set(initial ?? []));
  return {
    isDone: (id) => done.has(id),
    toggle: (id) => {
      setDone((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
  };
}

export function ProjectDot({ projectId, size = 8 }: { projectId: string; size?: number }) {
  const proj = SAMPLE_PROJECTS[projectId];
  return (
    <span
      aria-hidden="true"
      className="shrink-0 rounded-full"
      style={{ width: size, height: size, background: proj?.color ?? "#52525b" }}
    />
  );
}

export function ProjectName({ projectId }: { projectId: string }) {
  const proj = SAMPLE_PROJECTS[projectId];
  return <span className="font-jp text-[9px] text-fg-subtle">{proj?.name ?? "—"}</span>;
}

export function DepBadge({
  dep,
}: {
  dep: NonNullable<SampleParent["depEvent"]>;
}) {
  return (
    <span
      className={`max-w-[180px] truncate rounded-[3px] px-1.5 py-px font-jp text-[8px] text-accent-amber ${
        dep.imminent ? "bg-[#E85D0440] font-semibold" : "bg-[#E85D0415]"
      }`}
    >
      ← {dep.relative} {dep.title}
    </span>
  );
}

export function EstimateBadge({ minutes }: { minutes: number }) {
  return (
    <span className="text-[9px] tabular-nums text-fg-faint">{fmtMinutes(minutes)}</span>
  );
}

/** AI 分解の進行中を示す pill。aria-live で読み上げ。 */
export function DecomposingPill() {
  return (
    <span
      role="status"
      aria-live="polite"
      className="inline-flex items-center gap-1 rounded-[3px] bg-accent-blue/15 px-1.5 py-px font-jp text-[8px] text-accent-blue"
    >
      <span className="h-1 w-1 animate-pulse rounded-full bg-accent-blue" aria-hidden="true" />
      AI 分解中
    </span>
  );
}

/** 分解未着手 / 分解不要を示す pill (informational, role なし)。 */
export function StatusPill({ status }: { status: DecomposeStatus }) {
  if (status === "decomposing") return <DecomposingPill />;
  if (status === "skipped") {
    return (
      <span className="rounded-[3px] bg-fg-weak/15 px-1.5 py-px font-jp text-[8px] text-fg-weak">
        分解不要
      </span>
    );
  }
  if (status === "none") {
    return (
      <span className="rounded-[3px] bg-fg-weak/10 px-1.5 py-px font-jp text-[8px] text-fg-faint">
        未分解
      </span>
    );
  }
  return null;
}

/** Stack 行の右端にある 22px チェック。a11y のために aria-label。 */
export function CompleteButton({
  done,
  onToggle,
  label,
}: {
  done: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      aria-label={done ? `${label} を未完了に戻す` : `${label} を完了`}
      aria-pressed={done}
      className={`flex h-[22px] w-[22px] shrink-0 cursor-pointer items-center justify-center rounded-[5px] border bg-transparent ${
        done ? "border-accent-green text-accent-green" : "border-bg-divider text-fg-weak"
      }`}
    >
      <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
        <polyline
          points="3,8 7,12 13,4"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

/** Stack の見出し行 (本物の TaskStack と揃える)。 */
export function StackHeader({ count, label = "task stack" }: { count: number; label?: string }) {
  return (
    <div className="flex items-center gap-2 px-5 pb-2 pt-1">
      <span className="text-[9px] font-semibold uppercase tracking-[0.1em] text-fg-weak">
        {label}
      </span>
      <div className="h-px flex-1 bg-bg-border" />
      <span className="text-[9px] text-fg-faint">{count}</span>
    </div>
  );
}

/** 各 variant の頭に置く哲学 / トレードオフ説明カード。 */
export function VariantNote({
  philosophy,
  tradeoffs,
}: {
  philosophy: string;
  tradeoffs: readonly string[];
}) {
  return (
    <div className="mx-4 mb-3 rounded-[8px] border border-bg-border bg-bg-surface p-3">
      <div className="mb-1 font-jp text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">
        philosophy
      </div>
      <p className="font-jp text-[11px] leading-relaxed text-fg-default">{philosophy}</p>
      <div className="mt-2 mb-1 font-jp text-[10px] font-semibold uppercase tracking-[0.08em] text-fg-subtle">
        観察ポイント
      </div>
      <ul className="m-0 list-none space-y-0.5 p-0 font-jp text-[10px] leading-relaxed text-fg-muted">
        {tradeoffs.map((t) => (
          <li key={t}>・{t}</li>
        ))}
      </ul>
    </div>
  );
}

function segmentSize(total: number, size: "md" | "sm"): { w: number; h: number } {
  // 子数によって段階的に縮小する。3 段階で十分 (5 まで / 9 まで / 10+)
  if (size === "md") {
    if (total <= 5) return { w: 16, h: 9 };
    if (total <= 9) return { w: 12, h: 8 };
    return { w: 9, h: 7 };
  }
  if (total <= 5) return { w: 10, h: 6 };
  if (total <= 9) return { w: 8, h: 5 };
  return { w: 6, h: 4 };
}

/**
 * 平行四辺形セグメント (skewX) で進捗を可視化する。
 * - 完了: 親色で塗り
 * - 現在 (= 自分の番): 親色の枠強調 + 中抜き
 * - 未完了: 薄い親色の枠 + 中抜き
 *
 * a11y: role="progressbar" + aria-valuenow/min/max + aria-label。
 *       セグメント自体は装飾なので aria-hidden。
 */
export function ParallelogramProgress({
  total,
  doneCount,
  currentIndex,
  color,
  size = "md",
}: {
  total: number;
  doneCount: number;
  /** 1-based。0 を渡すと「現在なし」(全行カード未着手等) */
  currentIndex: number;
  color: string;
  size?: "md" | "sm";
}) {
  // total に応じてセグメント寸法を縮小する。10+ 子でも 480px 幅に収まるように。
  // 子に固有順序は無いので「current=自分の Stack 上の出現順」のハイライトだけが意味を持つ。
  const { w: segWidth, h: segHeight } = segmentSize(total, size);
  return (
    <div
      role="progressbar"
      aria-valuenow={doneCount}
      aria-valuemin={0}
      aria-valuemax={total}
      aria-label={
        currentIndex > 0
          ? `進捗 ${doneCount}/${total}、現在 ${currentIndex}/${total}`
          : `進捗 ${doneCount}/${total}`
      }
      className="flex shrink-0 items-center gap-[3px]"
    >
      {Array.from({ length: total }).map((_, i) => {
        const idx = i + 1;
        const isDone = idx <= doneCount;
        const isCurrent = idx === currentIndex && !isDone;
        const borderColor = isCurrent ? color : `${color}55`;
        const borderWidth = isCurrent ? 1.5 : 1;
        return (
          <span
            key={i}
            aria-hidden="true"
            style={{
              width: segWidth,
              height: segHeight,
              transform: "skewX(-20deg)",
              background: isDone ? color : "transparent",
              border: `${borderWidth}px solid ${borderColor}`,
              borderRadius: 1,
            }}
          />
        );
      })}
    </div>
  );
}
