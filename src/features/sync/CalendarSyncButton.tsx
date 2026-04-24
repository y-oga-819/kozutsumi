"use client";

type CalendarSyncButtonProps = {
  isPending: boolean;
  lastSyncedAt: string | null;
  onClick: () => void;
};

/**
 * ヘッダーに置くカレンダー同期ボタン。押下で `useCalendarSync.triggerSync('manual')` を呼ぶ前提。
 * 実行中はスピナー + disabled、成功時は最終同期時刻を tooltip として表示する。
 */
export function CalendarSyncButton({
  isPending,
  lastSyncedAt,
  onClick,
}: CalendarSyncButtonProps) {
  const tooltip = lastSyncedAt
    ? `最終同期: ${formatRelative(lastSyncedAt)}`
    : "カレンダーを同期";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isPending}
      aria-label="カレンダーを同期"
      title={tooltip}
      className="flex h-7 items-center gap-1.5 rounded-md border border-bg-divider bg-bg-elevated px-2.5 text-[11px] font-medium text-fg-muted transition-colors hover:text-fg-emphasized disabled:opacity-60"
    >
      <SyncIcon spinning={isPending} />
      <span>{isPending ? "同期中..." : "同期"}</span>
    </button>
  );
}

function SyncIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width="12"
      height="12"
      aria-hidden="true"
      className={spinning ? "animate-spin" : undefined}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 7a6 6 0 0 1 10.24-4.24" />
      <path d="M14 2v4h-4" />
      <path d="M14 9a6 6 0 0 1-10.24 4.24" />
      <path d="M2 14v-4h4" />
    </svg>
  );
}

function formatRelative(iso: string): string {
  const now = Date.now();
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSec = Math.max(0, Math.round((now - then) / 1000));
  if (diffSec < 60) return "たった今";
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}分前`;
  const diffHour = Math.round(diffMin / 60);
  if (diffHour < 24) return `${diffHour}時間前`;
  const diffDay = Math.round(diffHour / 24);
  return `${diffDay}日前`;
}
