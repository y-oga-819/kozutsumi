import type { CorrectedEstimate as CorrectedEstimateValue } from "@/entities/task/correction";
import { TASK_SIZE_LABELS } from "@/entities/task/task-size";
import type { TaskSize } from "@/entities/task/types";
import { fmtDuration } from "@/shared/lib/time";

/**
 * 見積もり (補正後 + 元値) の併記表示 (P3-9 / #93、ADR 0026)。
 *
 * - 補正後を主表示 / 元値を muted で副表示。ラベル・取消線・矢印は使わない (ADR 0026)。
 * - 補正なし (`correctedMinutes === null`) は元値だけを既存と同じ trim で出す。
 * - `estimate === null` でも `taskSize` があれば、ADR 0045 の方針で主観サイズラベル
 *   (`TASK_SIZE_LABELS[taskSize]`) を fg-faint で添える。分換算 (`TASK_SIZE_TO_MINUTES`)
 *   は使わず、文字種 (`30分` / `半日` / `1日超`) で主観値であることを潜在的に区別させる。
 * - `estimate === null` かつ `taskSize` も無いときは何も描画しない。
 *
 * 区切り記号は ADR 0026 の方針に従い middle dot `·` を採用。
 *
 * variant:
 * - `top`   : Top カード上ゾーン (`text-[10px]`)。補正後を主色、元値を muted で sm。
 * - `row`   : 行カード Row 1 / 詳細パネル ヘッダ (`text-[9px]`)。同じ階層をひと回り小さく。
 */
type Props = {
  estimate: CorrectedEstimateValue | null;
  /**
   * estimated_minutes 不在時の主観サイズ fallback (ADR 0045)。
   * `estimate === null` のときだけ参照され、non-null なら主観ラベルを fg-faint で出す。
   */
  taskSize?: TaskSize | null;
  variant: "top" | "row";
};

export function CorrectedEstimate({ estimate, taskSize, variant }: Props) {
  const mainSizeClass = variant === "top" ? "text-[10px]" : "text-[9px]";
  // 元値は併記時に一段小さく出して階層を作る (ADR 0026: 大小コントラスト)。
  const rawSizeClass = variant === "top" ? "text-[9px]" : "text-[8px]";

  if (estimate === null) {
    // ADR 0045: estimated_minutes 不在 + task_size あり → 主観ラベルを fg-faint で添える。
    if (taskSize) {
      return (
        <span aria-label="サイズ" className={`${mainSizeClass} text-fg-faint`}>
          {TASK_SIZE_LABELS[taskSize]}
        </span>
      );
    }
    return null;
  }

  if (estimate.correctedMinutes === null) {
    // 補正なし: 元値だけ、従来通り faint で表示する (UI 後退無し)。
    return (
      <span aria-label="見積もり" className={`${mainSizeClass} tabular-nums text-fg-faint`}>
        {fmtDuration(estimate.rawMinutes)}
      </span>
    );
  }

  const correctedLabel = `${fmtDuration(estimate.correctedMinutes)} を確保`;
  const rawLabel = `あなたの見積もり ${fmtDuration(estimate.rawMinutes)}`;
  return (
    <span aria-label="見積もり" className="inline-flex items-baseline gap-1">
      <span aria-label={correctedLabel} className={`${mainSizeClass} tabular-nums text-fg-muted`}>
        {fmtDuration(estimate.correctedMinutes)}
      </span>
      <span aria-hidden="true" className={`${rawSizeClass} text-fg-faint`}>
        ·
      </span>
      <span aria-label={rawLabel} className={`${rawSizeClass} tabular-nums text-fg-faint`}>
        {fmtDuration(estimate.rawMinutes)}
      </span>
    </span>
  );
}
