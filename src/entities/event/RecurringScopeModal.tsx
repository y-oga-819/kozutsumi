"use client";

import { useEffect, useState } from "react";

import type { EventVisibilityOverrideScope } from "./types";

/**
 * Issue #229 / ADR 0056 §6: recurring event の予定化 / 解除を選んだ時に出す 3 択 modal。
 *
 * - default は `single` (ADR 0056 §6)。系列影響は明示選択でしか発生させない。
 * - `role="dialog"` + `aria-modal` + `aria-labelledby` で a11y 構造を立てる
 *   (kozutsumi-frontend-a11y skill 2.1)。
 * - 操作中 (pending) は全ボタンを disabled にして連打を防ぐ。
 * - **クリックしたボタンだけ「処理中…」表示にする** ことで、bulk apply に時間がかかっても
 *   「効いていない / 固まった」に見えないようにする。他のボタンは強めに fade して連打を防ぐ
 *   (一律に opacity-60 だとどれを押したか視覚的に分からないバグっぽさが出る)。
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
  // クリックされた scope を保持して「処理中」表示に使う。pending=false の間は描画側で
  // ガードするので state は stale で構わない (次のクリックで上書き)。useEffect で cleanup
  // すると set-state-in-effect になるので、derivation 側で `pending && ...` を見る。
  const [clickedScope, setClickedScope] = useState<EventVisibilityOverrideScope | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !pending) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  const handleClick = (scope: EventVisibilityOverrideScope) => {
    if (pending) return;
    setClickedScope(scope);
    onSelect(scope);
  };

  const titleId = "event-recurring-scope-title";
  const verb = targetValue === "shown" ? "予定化" : "予定化解除";

  const choices: Array<{
    scope: EventVisibilityOverrideScope;
    title: string;
    description: string;
    /** default scope (`single`) は強調枠 (ADR 0056 §6)。それ以外は通常枠。 */
    emphasis: boolean;
  }> = [
    {
      scope: "single",
      title: "この予定だけ",
      description: `選択した回のみに${verb}を適用します。`,
      emphasis: true,
    },
    {
      scope: "this_and_following",
      title: "これ以降の予定もまとめて",
      description: `この回以降の繰り返しすべてに${verb}を適用します。`,
      emphasis: false,
    },
    {
      scope: "all",
      title: "すべての繰り返し",
      description: `過去・未来を含む全ての回に${verb}を適用します。`,
      emphasis: false,
    },
  ];

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
          {choices.map((c) => {
            // pending 中だけ「クリック済」として描画する (pending=false 時は state が stale でも無視)。
            const isClicked = pending && clickedScope === c.scope;
            const isOtherClicked = pending && clickedScope !== null && clickedScope !== c.scope;
            // 「クリックされた行」: 強い枠 + 処理中ラベル。
            // 「クリックされてない行 (pending 中)」: 強めに fade してアクション不能に。
            // 「pending じゃない」: 通常表示。emphasis あれば accent 枠で default を示唆。
            const baseClass =
              "rounded-md px-3 py-2 text-left font-jp text-[12px] text-fg-emphasized transition";
            const stateClass = isClicked
              ? "border-2 border-accent-blue bg-accent-blue/20 ring-2 ring-accent-blue/40"
              : isOtherClicked
                ? "border border-bg-divider bg-bg-primary opacity-30"
                : c.emphasis
                  ? "border border-accent-blue/60 bg-accent-blue/10"
                  : "border border-bg-divider bg-bg-primary";
            return (
              <button
                key={c.scope}
                type="button"
                disabled={pending}
                aria-busy={isClicked}
                onClick={() => handleClick(c.scope)}
                className={`${baseClass} ${stateClass}`}
              >
                <span className="block font-semibold">
                  {c.title}
                  {isClicked ? (
                    <span className="ml-2 font-jp text-[10px] font-normal text-accent-blue">
                      処理中…
                    </span>
                  ) : null}
                </span>
                <span className="mt-0.5 block text-[10px] text-fg-muted">{c.description}</span>
              </button>
            );
          })}
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
