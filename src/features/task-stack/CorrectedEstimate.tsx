import type { CorrectedEstimate as CorrectedEstimateValue } from "@/entities/task/correction";
import { fmtDuration } from "@/shared/lib/time";

/**
 * 見積もり (補正後 + 元値) の併記表示 (P3-9 / #93、ADR 0026)。
 *
 * - 補正後を主表示 / 元値を muted で副表示。ラベル・取消線・矢印は使わない (ADR 0026)。
 * - 補正なし (`correctedMinutes === null`) は元値だけを既存と同じ trim で出す。
 * - `estimate === null` (元値も無い) は何も描画しない (caller は条件分岐不要)。
 *
 * 区切り記号は ADR 0026 の方針に従い middle dot `·` を採用。
 *
 * variant:
 * - `top`   : Top カード上ゾーン (`text-[10px]`)。補正後を主色、元値を muted で sm。
 * - `row`   : 行カード Row 1 / 詳細パネル ヘッダ (`text-[9px]`)。同じ階層をひと回り小さく。
 */
type Props = {
  estimate: CorrectedEstimateValue | null;
  variant: "top" | "row";
};

export function CorrectedEstimate({ estimate, variant }: Props) {
  if (estimate === null) return null;

  const mainSizeClass = variant === "top" ? "text-[10px]" : "text-[9px]";
  // 元値は併記時に一段小さく出して階層を作る (ADR 0026: 大小コントラスト)。
  const rawSizeClass = variant === "top" ? "text-[9px]" : "text-[8px]";

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
