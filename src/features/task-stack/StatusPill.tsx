import type { DecomposeStatus } from "@/entities/task/types";

/**
 * 親の AI 分解状態を示す pill (ADR 0016 §4 / ADR 0021 §3)。
 * Stack 行 / Top カード下ゾーン Row 3 右詰の「分解状態スロット」で
 * `ParallelogramProgress` と同じ位置に配置される。
 *
 * - `decomposing`: AI 分解中。`role=status` + `aria-live=polite` で読み上げる。
 * - `skipped`: AI が分解不要と判断。
 * - `failed`: AI 分解失敗。reason は詳細パネルに譲る (ADR 0021 §3)。
 * - `none`: 分解未試行 (`AI_ENABLED=false` 等)。
 * - `decomposed`: pill は出さない (進捗バーが代わりに出る)。
 */
type StatusPillProps = {
  status: DecomposeStatus;
};

export function StatusPill({ status }: StatusPillProps) {
  if (status === "decomposing") {
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
  if (status === "skipped") {
    return (
      <span className="rounded-[3px] bg-fg-weak/15 px-1.5 py-px font-jp text-[8px] text-fg-weak">
        分解不要
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="rounded-[3px] bg-accent-red/15 px-1.5 py-px font-jp text-[8px] text-accent-red">
        分解失敗
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
