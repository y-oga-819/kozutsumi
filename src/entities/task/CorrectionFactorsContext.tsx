"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";

import {
  type CorrectionFactor,
  type CorrectionFactorMap,
  indexFactorsByCategory,
} from "./correction";

/**
 * 見積もり補正倍率 (P3-9 / #93、ADR 0024 / 0025) を tree 全体で共有するための context。
 *
 * AppShell で view (`task_category_correction_factors`) を fetch してマップに整形し、
 * 子の Stack View / 詳細パネルから `useCorrectionFactors()` で参照する。
 * 値が未取得 / fetch 失敗時は空マップ (= 全タスク補正なし扱い) を返す。
 *
 * 補正は augmentation (ADR 0013) なので、view が読めなくても core path は成立する。
 * Provider が tree に無い場合も throw せず空マップを返す方針 (テストで都度 wrap する
 * 手間を増やさないため)。
 */
const CorrectionFactorsContext = createContext<CorrectionFactorMap>({});

export function CorrectionFactorsProvider({
  factors,
  children,
}: {
  factors: readonly CorrectionFactor[];
  children: ReactNode;
}) {
  const map = useMemo(() => indexFactorsByCategory(factors), [factors]);
  return (
    <CorrectionFactorsContext.Provider value={map}>{children}</CorrectionFactorsContext.Provider>
  );
}

export function useCorrectionFactors(): CorrectionFactorMap {
  return useContext(CorrectionFactorsContext);
}
