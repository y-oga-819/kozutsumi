"use client";

import { useEffect } from "react";

import type { EventVisibilityOverrideScope } from "./types";

/**
 * Issue #229 / ADR 0056 §6: recurring event の予定化 / 解除を選んだ時に出す 3 択 modal。
 *
 * - default は `single` (ADR 0056 §6)。系列影響は明示選択でしか発生させない。
 * - `role="dialog"` + `aria-modal` + `aria-labelledby` で a11y 構造を立てる
 *   (kozutsumi-frontend-a11y skill 2.1)。
 * - 操作中 (pending) は全ボタンを disabled にして連打を防ぐ。
 * - ESC / オーバーレイクリックで閉じる (キャンセル相当)。
 *
 * 呼び出し元 (EventDetailPanel / EventManagement) が `targetValue` (= 倒したい方向) を
 * 決めて modal を開く。modal 自体は「どの scope に適用するか」だけを担当する。
 */
export function RecurringScopeModal({
  targetValue,
  pending,
  onSelect,
  onClose,
}: {
  targetValue: "shown" | "hidden";
  pending: boolean;
  onSelect: (scope: EventVisibilityOverrideScope) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  const titleId = "event-recurring-scope-title";
  const verb = targetValue === "shown" ? "予定化" : "予定化解除";
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      className="fixed inset-0 z-[210] flex items-center justify-center"
    >
      <div
        onClick={pending ? undefined : onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[4px]"
      />
      <div className="relative w-[min(420px,calc(100vw-32px))] rounded-lg border border-bg-divider bg-bg-elevated p-5 shadow-xl">
        <h3 id={titleId} className="m-0 font-jp text-[13px] font-semibold text-fg-strong">
          繰り返し予定の{verb}
        </h3>
        <p className="mt-2 text-[11px] leading-relaxed text-fg-muted">
          この予定は繰り返しの一部です。どの範囲に{verb}を適用しますか?
        </p>
        <div className="mt-4 flex flex-col gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => onSelect("single")}
            className="rounded-md border border-accent-blue/60 bg-accent-blue/10 px-3 py-2 text-left font-jp text-[12px] text-fg-emphasized disabled:opacity-60"
          >
            <span className="block font-semibold">この予定だけ</span>
            <span className="mt-0.5 block text-[10px] text-fg-muted">
              選択した回のみに{verb}を適用します。
            </span>
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onSelect("this_and_following")}
            className="rounded-md border border-bg-divider bg-bg-primary px-3 py-2 text-left font-jp text-[12px] text-fg-emphasized disabled:opacity-60"
          >
            <span className="block font-semibold">これ以降の予定もまとめて</span>
            <span className="mt-0.5 block text-[10px] text-fg-muted">
              この回以降の繰り返しすべてに{verb}を適用します。
            </span>
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onSelect("all")}
            className="rounded-md border border-bg-divider bg-bg-primary px-3 py-2 text-left font-jp text-[12px] text-fg-emphasized disabled:opacity-60"
          >
            <span className="block font-semibold">すべての繰り返し</span>
            <span className="mt-0.5 block text-[10px] text-fg-muted">
              過去・未来を含む全ての回に{verb}を適用します。
            </span>
          </button>
        </div>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            className="rounded border border-bg-divider bg-transparent px-3 py-1.5 font-jp text-[11px] text-fg-subtle disabled:opacity-60"
          >
            キャンセル
          </button>
        </div>
      </div>
    </div>
  );
}
