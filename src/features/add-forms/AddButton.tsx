"use client";

type AddButtonProps = {
  onClick: () => void;
};

/**
 * 画面右下の + ボタン。タップで AddPanel を開く。
 * max-width 480px のレイアウトに収まるよう fixed + safe-area を考慮。
 */
export function AddButton({ onClick }: AddButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="新規追加"
      className="fixed bottom-5 right-5 z-[100] flex h-12 w-12 items-center justify-center rounded-full bg-accent-blue text-fg-invert shadow-lg transition-transform active:scale-95"
      style={{
        // max-w-480 の本体にアンカーする: 実質右下で OK (body が中央配置のため)
        right: "max(1.25rem, calc((100vw - 480px) / 2 + 1.25rem))",
      }}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
        <path d="M12 5V19M5 12H19" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
      </svg>
    </button>
  );
}
