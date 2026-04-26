"use client";

import { useState } from "react";

import { VARIANTS, type VariantKey } from "./keys";
import { VariantA } from "./VariantA";
import { VariantB } from "./VariantB";
import { VariantC } from "./VariantC";
import { VariantD } from "./VariantD";

/**
 * ADR 0016 用の体験比較プレイグラウンド。
 *
 * 同じ sample data を A〜D の 4 案で描画し、role=tablist で切り替える。
 * `?variant=A|B|C|D` で初期表示を選べるので ADR レビューで deep-link できる
 * (server で受け取り initialKey として渡すことで SSR でも反映される)。
 * 本番コードからは import されないので __experiments__ 配下に置いている。
 */
export function Playground({ initialKey = "A" }: { initialKey?: VariantKey }) {
  const [active, setActive] = useState<VariantKey>(initialKey);

  const switchTo = (key: VariantKey) => {
    setActive(key);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("variant", key);
      window.history.replaceState(null, "", url);
    }
  };

  return (
    <div className="pb-16">
      <header className="px-5 pb-4 pt-5">
        <div className="font-jp text-[16px] font-semibold text-fg-strong">
          ADR 0016 prototype
        </div>
        <p className="mt-1 font-jp text-[11px] leading-relaxed text-fg-muted">
          AI が親タスクを分解した結果を Stack View にどう表現するか、4 案を体験比較する。
          上のタブで切り替え。チェックは variant ごとに独立。
        </p>
      </header>
      <div
        role="tablist"
        aria-label="プロトタイプ切替"
        className="mx-4 flex gap-1 overflow-x-auto rounded-md bg-bg-elevated p-1"
      >
        {VARIANTS.map((v) => {
          const isActive = active === v.key;
          return (
            <button
              key={v.key}
              type="button"
              role="tab"
              id={`variant-tab-${v.key}`}
              aria-selected={isActive}
              aria-controls={`variant-panel-${v.key}`}
              onClick={() => switchTo(v.key)}
              className={`whitespace-nowrap rounded-[4px] px-3 py-1.5 font-jp text-[11px] ${
                isActive ? "bg-bg-divider text-fg-emphasized" : "bg-transparent text-fg-weak"
              }`}
            >
              {v.label}
            </button>
          );
        })}
      </div>
      <div
        role="tabpanel"
        id={`variant-panel-${active}`}
        aria-labelledby={`variant-tab-${active}`}
        className="mt-4"
      >
        {active === "A" && <VariantA />}
        {active === "B" && <VariantB />}
        {active === "C" && <VariantC />}
        {active === "D" && <VariantD />}
      </div>
    </div>
  );
}
