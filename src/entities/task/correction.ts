import type { TaskCategory } from "./types";

/**
 * 見積もり補正エンジン (Phase 3, P3-9 / #93) の純粋関数。
 *
 * - ADR 0024: task_category 別の中央値 + 外れ値クリップ + 最小サンプル数閾値
 * - ADR 0025: Supabase view と同じロジックを TS でも持ち、両者を contract test で一致させる
 *
 * 値域 (外れ値の境界 / 最小サンプル数閾値) は code 側の constant で管理する。
 * 実運用で「補正が暴れる」「効きが弱すぎる」が観測されたら issue で議論し、
 * 本ファイルの constant を更新する (ADR 0024 の supersede ではない)。
 */

const OUTLIER_LOW = 0.1;
const OUTLIER_HIGH = 10;
const MIN_SAMPLE_COUNT = 5;

export const CORRECTION_CONSTANTS = {
  OUTLIER_LOW,
  OUTLIER_HIGH,
  MIN_SAMPLE_COUNT,
} as const;

/** 補正倍率の集計用サンプル (完了済みタスクの推定 / 実績ペア)。 */
export type CorrectionSample = {
  estimatedMinutes: number;
  actualMinutes: number;
};

/** 補正倍率 1 件 (Supabase view `task_category_correction_factors` 1 行に対応)。 */
export type CorrectionFactor = {
  taskCategory: TaskCategory;
  /** 中央値で算出された倍率 (`actual / estimated`)。 */
  factor: number;
  /** 外れ値クリップ後のサンプル数。閾値未満は補正適用しない。 */
  sampleCount: number;
};

/** 補正倍率を category キーで引けるマップ (category 数は高々 5 件)。 */
export type CorrectionFactorMap = Partial<Record<TaskCategory, CorrectionFactor>>;

/** UI に渡す「補正後 + 元値」の組。 */
export type CorrectedEstimate = {
  /** 元の生 estimated_minutes (UI で副表示する元値)。 */
  rawMinutes: number;
  /** 補正後の分数。`task_category=null` / 閾値未満 / category にデータが無い時は null。 */
  correctedMinutes: number | null;
  /** 補正に使った倍率。補正適用時のみ。 */
  factor: number | null;
  /** 補正に使ったサンプル数。補正適用時のみ。 */
  sampleCount: number | null;
};

/**
 * 数値配列の中央値。空配列は NaN を返す (呼び出し側で件数チェック前提)。
 *
 * Supabase の `percentile_cont(0.5) WITHIN GROUP (ORDER BY ...)` は偶数件で
 * 「中央 2 件の線形補間」を返す。本実装も同じ挙動 (平均) で揃える。
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * `actual / estimated` が外れ値クリップ範囲内かどうか。
 * NaN / Infinity は false。境界値 (`0.1` / `10`) は inclusive (Supabase view の `between` と一致)。
 */
export function isWithinOutlierRange(ratio: number): boolean {
  return Number.isFinite(ratio) && ratio >= OUTLIER_LOW && ratio <= OUTLIER_HIGH;
}

/**
 * サンプル列から補正倍率と件数を算出する。Supabase view と同じ集計。
 *
 * - `estimated <= 0` / `actual <= 0` のサンプルは除外 (除算不能 / 未消化)
 * - `actual / estimated` が `[0.1, 10]` 範囲外のサンプルは除外 (外れ値)
 * - 残ったサンプルの ratio の中央値を返す
 *
 * 全サンプルが除外された場合は null。
 */
export function computeCorrectionFactor(
  samples: readonly CorrectionSample[],
): { factor: number; sampleCount: number } | null {
  const ratios: number[] = [];
  for (const s of samples) {
    if (s.estimatedMinutes <= 0) continue;
    if (s.actualMinutes <= 0) continue;
    const ratio = s.actualMinutes / s.estimatedMinutes;
    if (!isWithinOutlierRange(ratio)) continue;
    ratios.push(ratio);
  }
  if (ratios.length === 0) return null;
  return { factor: median(ratios), sampleCount: ratios.length };
}

/**
 * Supabase view の出力 (`task_category_correction_factors`) を category キーマップに整形する。
 * 同じ category が重複していたら **後勝ち** (view 側で UNIQUE が保証されているので通常は起きない)。
 */
export function indexFactorsByCategory(factors: readonly CorrectionFactor[]): CorrectionFactorMap {
  const out: CorrectionFactorMap = {};
  for (const f of factors) {
    out[f.taskCategory] = f;
  }
  return out;
}

/**
 * 1 タスクの見積もりに補正を適用する。
 *
 * 補正適用条件:
 * - `estimatedMinutes` が正の数
 * - `taskCategory` が non-null
 * - factors に当該 category のエントリがある
 * - そのエントリの `sampleCount >= minSampleCount`
 *
 * いずれか満たさない場合は `correctedMinutes = null` のまま元値だけ返す。
 * `estimatedMinutes` が null / 0 以下なら `null` を返す (UI で出さない)。
 */
export function correctEstimate(args: {
  estimatedMinutes: number | null;
  taskCategory: TaskCategory | null;
  factors: CorrectionFactorMap;
  /** デフォルト 5 (CORRECTION_CONSTANTS.MIN_SAMPLE_COUNT)。 */
  minSampleCount?: number;
}): CorrectedEstimate | null {
  const { estimatedMinutes, taskCategory, factors, minSampleCount = MIN_SAMPLE_COUNT } = args;
  if (estimatedMinutes === null || estimatedMinutes <= 0) return null;

  const base: CorrectedEstimate = {
    rawMinutes: estimatedMinutes,
    correctedMinutes: null,
    factor: null,
    sampleCount: null,
  };
  if (taskCategory === null) return base;

  const f = factors[taskCategory];
  if (!f || f.sampleCount < minSampleCount) return base;

  // 表示単位は分。少数を切り上げ / 切り捨てではなく四捨五入で揃える
  // (1.5x で 30 → 45 のような分かりやすい値が出やすいため)。
  const rounded = Math.round(estimatedMinutes * f.factor);
  // 倍率が極小で 0 分に丸まった場合は 1 分に底上げする (0 分表示は意味がない)。
  const correctedMinutes = rounded < 1 ? 1 : rounded;
  return {
    rawMinutes: estimatedMinutes,
    correctedMinutes,
    factor: f.factor,
    sampleCount: f.sampleCount,
  };
}
