/**
 * AI 分解後の親の進捗を平行四辺形 (skewX) セグメントで可視化する。
 * ADR 0016 §5: 数字併記の重複を避け、子の完了境界と「Stack 上の自分の番」を
 * ひとつのバーで読み取れるようにする。
 * ADR 0055: 大量分解 (N>10) でも segment 幅は固定し、container 超過時は wrap で次行へ。
 *
 * - 完了: 親色で塗り
 * - 現在 (= 自分の番、未完了): 親色の枠強調 + 中抜き
 * - 未完了: 薄い親色の枠 + 中抜き
 *
 * a11y: `role="progressbar"` + `aria-valuenow/min/max` + `aria-label`。
 *       セグメント自体は装飾なので `aria-hidden`。
 */
type Size = "md" | "sm";

type ParallelogramProgressProps = {
  total: number;
  doneCount: number;
  /**
   * 1-based。0 を渡すと「現在なし」(全行カード未着手 / Done セクション内 等)。
   * `currentIndex = doneCount + (Stack 残中の自分の位置)` を呼び出し側で算出する。
   */
  currentIndex: number;
  color: string;
  size?: Size;
};

const GAP_PX = 3;

/**
 * size ごとに segment の幅・高さ・「1 行に並べる最大件数」を持つ。
 * maxPerRow を超えると `flex-wrap` で次の行へ折り返す (ADR 0055)。
 */
const SEGMENT: Record<Size, { w: number; h: number; maxPerRow: number }> = {
  md: { w: 12, h: 8, maxPerRow: 15 },
  sm: { w: 8, h: 5, maxPerRow: 10 },
};

export function ParallelogramProgress({
  total,
  doneCount,
  currentIndex,
  color,
  size = "md",
}: ParallelogramProgressProps) {
  const { w: segWidth, h: segHeight, maxPerRow } = SEGMENT[size];
  const maxWidth = maxPerRow * segWidth + (maxPerRow - 1) * GAP_PX;
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
      className="flex min-w-0 flex-wrap items-center gap-[3px]"
      style={{ maxWidth }}
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
              flexShrink: 0,
            }}
          />
        );
      })}
    </div>
  );
}
