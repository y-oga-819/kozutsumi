/**
 * AI 分解後の親の進捗を平行四辺形 (skewX) セグメントで可視化する。
 * ADR 0016 §5: 数字併記の重複を避け、子の完了境界と「Stack 上の自分の番」を
 * ひとつのバーで読み取れるようにする。
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

function segmentSize(total: number, size: Size): { w: number; h: number } {
  // 子数によって 3 段階で縮小 (~5 / ~9 / 10+)。10 子で 480px 幅に収まる目安。
  if (size === "md") {
    if (total <= 5) return { w: 16, h: 9 };
    if (total <= 9) return { w: 12, h: 8 };
    return { w: 9, h: 7 };
  }
  if (total <= 5) return { w: 10, h: 6 };
  if (total <= 9) return { w: 8, h: 5 };
  return { w: 6, h: 4 };
}

export function ParallelogramProgress({
  total,
  doneCount,
  currentIndex,
  color,
  size = "md",
}: ParallelogramProgressProps) {
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
