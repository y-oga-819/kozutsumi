"use client";

import { useEffect, useState } from "react";

import type { SkippedEvent } from "@/entities/event/sync";

import { useDismissSkippedEvents, useSkippedEvents } from "./skippedEventsCache";

const REASON_LABEL: Record<SkippedEvent["reason"], string> = {
  invalid_time_range: "終了時刻が開始時刻と同じか前になっています",
  missing_time: "開始 / 終了時刻が設定されていません",
};

/**
 * 直近の sync で取り込みをスキップした予定があることを伝える永続バナー (Issue #219 続き)。
 *
 * - 同セッション中はキャッシュに skipped > 0 が残るので、ページ遷移しても表示が消えない
 * - リロード後は cache が空に戻るが、次の sync (lazy / 手動) で再投入される (β 案: in-session 永続)
 * - 「詳細」で dialog を開き、ユーザーが Google Calendar 側を直すための手がかりを提示する
 */
export function SyncSkippedBanner() {
  const skipped = useSkippedEvents();
  const dismiss = useDismissSkippedEvents();
  const [open, setOpen] = useState(false);

  if (skipped.length === 0) return null;

  return (
    <>
      <div
        role="alert"
        className="flex items-center gap-3 border-b border-accent-amber/40 bg-accent-amber/10 px-4 py-2 text-[12px] text-fg-emphasized"
      >
        <span className="flex-1">
          {skipped.length} 件の予定を取り込めませんでした (時刻情報が不正)
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded bg-accent-amber px-3 py-1 text-[11px] font-medium text-fg-invert transition-colors hover:opacity-90"
        >
          詳細
        </button>
        <button
          type="button"
          onClick={dismiss}
          aria-label="バナーを閉じる"
          className="text-fg-muted transition-colors hover:text-fg-emphasized"
        >
          ×
        </button>
      </div>
      <SyncSkippedDialog open={open} skipped={skipped} onClose={() => setOpen(false)} />
    </>
  );
}

type SyncSkippedDialogProps = {
  open: boolean;
  skipped: SkippedEvent[];
  onClose: () => void;
};

function SyncSkippedDialog({ open, skipped, onClose }: SyncSkippedDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="取り込めなかった予定"
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-4 pt-[6vh]"
      onClick={onClose}
    >
      <div
        className="relative max-h-[80vh] w-full max-w-[560px] overflow-y-auto rounded-lg border border-bg-divider bg-bg-elevated p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-baseline justify-between gap-2">
          <h2 className="font-jp text-[14px] font-semibold text-fg-emphasized">
            取り込めなかった予定 ({skipped.length} 件)
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="text-[12px] text-fg-muted hover:text-fg-emphasized"
          >
            閉じる
          </button>
        </div>

        <p className="mb-4 text-[11px] leading-relaxed text-fg-muted">
          以下の予定は時刻情報が不正なため取り込めませんでした。Google
          カレンダー側で時刻を直してから再同期すると取り込まれます。
        </p>

        <ul className="flex flex-col gap-2">
          {skipped.map((s) => (
            <li
              key={`${s.externalCalendarId}:${s.externalId}`}
              className="rounded-md border border-bg-divider bg-bg-surface p-3 text-[12px]"
            >
              <div className="font-jp text-[13px] font-medium text-fg-emphasized">
                {s.title ?? "(タイトルなし)"}
              </div>
              <div className="mt-1 text-[11px] text-fg-muted">{REASON_LABEL[s.reason]}</div>
              <div className="mt-1 truncate text-[10px] text-fg-muted">
                カレンダー: {s.externalCalendarId}
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-5 flex justify-end">
          <a
            href="https://calendar.google.com/"
            target="_blank"
            rel="noreferrer noopener"
            className="rounded bg-bg-divider px-3 py-1.5 text-[11px] font-medium text-fg-emphasized transition-colors hover:bg-bg-divider/70"
          >
            Google カレンダーを開く
          </a>
        </div>
      </div>
    </div>
  );
}
