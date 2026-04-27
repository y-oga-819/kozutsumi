"use client";

import { VariantE } from "./VariantE";

/**
 * ADR 0016 採用案 (Variant E) のプレイグラウンド。
 *
 * 当初 A〜D の 4 案を tablist で切り替えて比較していたが、ADR 確定 (Variant E
 * 採用) に伴って A〜D は削除した。本ファイルは E のラッパーとしてだけ残し、
 * Phase 3 実装が落ち着いたら `__experiments__/` ごと削除する。
 *
 * 採用 / 不採用の経緯は `docs/adr/0016-*.md` の Alternatives considered を参照。
 */
export function Playground() {
  return (
    <div className="pb-16">
      <header className="px-5 pb-4 pt-5">
        <div className="font-jp text-[16px] font-semibold text-fg-strong">
          ADR 0016 採用案: Variant E
        </div>
        <p className="mt-1 font-jp text-[11px] leading-relaxed text-fg-muted">
          AI 分解後の Stack View レイアウト。子フラット + Top 上下 2 ゾーン + 行カード 3 行構成 +
          平行四辺形プログレス。比較経緯は ADR 0016 を参照。
        </p>
      </header>
      <VariantE />
    </div>
  );
}
