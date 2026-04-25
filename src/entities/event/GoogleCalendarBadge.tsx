/**
 * `source === 'google_calendar'` のイベントに付与する小さな由来バッジ。
 * ADR 0010: kozutsumi 側で編集できる属性が限られている (Google 側が正) ことを
 * 視覚的に区別する。
 */
type Size = "sm" | "md";

type Props = {
  size?: Size;
  className?: string;
};

export function GoogleCalendarBadge({ size = "sm", className }: Props) {
  return (
    <span
      role="img"
      aria-label="Google Calendar から同期"
      title="Google Calendar から同期"
      className={`inline-flex shrink-0 items-center justify-center rounded-[3px] border border-bg-divider bg-bg-elevated font-jp font-semibold leading-none text-fg-subtle ${
        size === "md" ? "h-[18px] w-[18px] text-[10px]" : "h-[14px] w-[14px] text-[8px]"
      } ${className ?? ""}`}
      data-testid="google-calendar-badge"
    >
      G
    </span>
  );
}
