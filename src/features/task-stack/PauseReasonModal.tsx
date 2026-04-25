"use client";

import type { PauseReason } from "@/entities/task/time-entries";

type PauseReasonModalProps = {
  onSelect: (reason: PauseReason) => void;
  onClose: () => void;
};

const OPTIONS: { value: PauseReason; label: string; hint: string }[] = [
  { value: "meeting", label: "MTG / 会議", hint: "会議やハドル" },
  { value: "interruption", label: "割り込み", hint: "急な依頼・質問" },
  { value: "voluntary", label: "自発的に中断", hint: "休憩・切り替え" },
];

/**
 * タスク中断時に pause_reason を選択させるモーダル。
 * 3択固定 (phase1.md Step 3.3 / types.ts の PauseReason) で、
 * 将来 meeting 開始時の自動 paused (Phase 2+) でも meeting が既定になるよう
 * ここで共有する UI パターン。
 */
export function PauseReasonModal({ onSelect, onClose }: PauseReasonModalProps) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="pause-reason-title"
      className="fixed inset-0 z-[220] flex flex-col"
    >
      <div onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-[4px]" />
      <div className="relative mt-auto flex animate-panel-slide-up flex-col rounded-t-2xl bg-bg-surface">
        <div className="flex justify-center pb-1 pt-2.5">
          <div className="h-[3px] w-8 rounded-[2px] bg-bg-divider" />
        </div>
        <div className="px-5 pb-5 pt-2">
          <div
            id="pause-reason-title"
            className="pb-3 font-jp text-[13px] font-semibold text-fg-emphasized"
          >
            中断の理由
          </div>
          <div className="flex flex-col gap-2">
            {OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => onSelect(opt.value)}
                className="flex items-center justify-between rounded-lg bg-bg-elevated px-4 py-3 text-left"
              >
                <span className="font-jp text-[13px] text-fg-strong">{opt.label}</span>
                <span className="font-jp text-[10px] text-fg-weak">{opt.hint}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function pauseReasonLabel(reason: PauseReason): string {
  switch (reason) {
    case "meeting":
      return "MTG";
    case "interruption":
      return "割り込み";
    case "voluntary":
      return "休憩";
  }
}
