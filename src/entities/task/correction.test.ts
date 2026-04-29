import { describe, expect, test } from "vitest";

import {
  CORRECTION_CONSTANTS,
  computeCorrectionFactor,
  correctEstimate,
  indexFactorsByCategory,
  isWithinOutlierRange,
  median,
  type CorrectionFactor,
} from "./correction";

describe("median", () => {
  test("奇数件は中央値そのもの", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  test("偶数件は中央 2 件の平均 (Supabase percentile_cont(0.5) と一致)", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  test("空配列は NaN", () => {
    expect(Number.isNaN(median([]))).toBe(true);
  });

  test("元配列を変更しない (不変性)", () => {
    const xs = [3, 1, 2];
    const original = [...xs];
    median(xs);
    expect(xs).toEqual(original);
  });
});

describe("isWithinOutlierRange", () => {
  test("[0.1, 10] の範囲内は true (境界 inclusive)", () => {
    expect(isWithinOutlierRange(0.1)).toBe(true);
    expect(isWithinOutlierRange(1)).toBe(true);
    expect(isWithinOutlierRange(10)).toBe(true);
  });

  test("範囲外は false", () => {
    expect(isWithinOutlierRange(0.05)).toBe(false);
    expect(isWithinOutlierRange(11)).toBe(false);
  });

  test("NaN / Infinity は false", () => {
    expect(isWithinOutlierRange(Number.NaN)).toBe(false);
    expect(isWithinOutlierRange(Number.POSITIVE_INFINITY)).toBe(false);
  });
});

describe("computeCorrectionFactor", () => {
  test("中央値 + サンプル数を返す", () => {
    const samples = [
      { estimatedMinutes: 30, actualMinutes: 30 }, // 1.0
      { estimatedMinutes: 30, actualMinutes: 45 }, // 1.5
      { estimatedMinutes: 30, actualMinutes: 60 }, // 2.0
    ];
    expect(computeCorrectionFactor(samples)).toEqual({ factor: 1.5, sampleCount: 3 });
  });

  test("estimated <= 0 / actual <= 0 のサンプルは除外", () => {
    const samples = [
      { estimatedMinutes: 30, actualMinutes: 45 }, // 1.5
      { estimatedMinutes: 0, actualMinutes: 30 }, // 除算不能
      { estimatedMinutes: 30, actualMinutes: 0 }, // 未消化
    ];
    expect(computeCorrectionFactor(samples)).toEqual({ factor: 1.5, sampleCount: 1 });
  });

  test("外れ値クリップ ([0.1, 10] 範囲外) のサンプルは除外", () => {
    const samples = [
      { estimatedMinutes: 30, actualMinutes: 45 }, // 1.5 OK
      { estimatedMinutes: 1, actualMinutes: 100 }, // 100x → 除外
      { estimatedMinutes: 100, actualMinutes: 1 }, // 0.01x → 除外
    ];
    expect(computeCorrectionFactor(samples)).toEqual({ factor: 1.5, sampleCount: 1 });
  });

  test("全サンプル除外なら null", () => {
    const samples = [
      { estimatedMinutes: 0, actualMinutes: 30 },
      { estimatedMinutes: 1, actualMinutes: 100 },
    ];
    expect(computeCorrectionFactor(samples)).toBeNull();
  });

  test("空配列なら null", () => {
    expect(computeCorrectionFactor([])).toBeNull();
  });

  test("偶数件の中央値は中央 2 件の平均", () => {
    const samples = [
      { estimatedMinutes: 10, actualMinutes: 8 }, // 0.8
      { estimatedMinutes: 10, actualMinutes: 12 }, // 1.2
      { estimatedMinutes: 10, actualMinutes: 14 }, // 1.4
      { estimatedMinutes: 10, actualMinutes: 16 }, // 1.6
    ];
    const result = computeCorrectionFactor(samples);
    expect(result?.factor).toBeCloseTo(1.3, 5);
    expect(result?.sampleCount).toBe(4);
  });
});

describe("indexFactorsByCategory", () => {
  test("category キーで引けるマップに整形する", () => {
    const factors: CorrectionFactor[] = [
      { taskCategory: "coding", factor: 0.8, sampleCount: 10 },
      { taskCategory: "doc", factor: 2.2, sampleCount: 7 },
    ];
    const map = indexFactorsByCategory(factors);
    expect(map.coding).toEqual({ taskCategory: "coding", factor: 0.8, sampleCount: 10 });
    expect(map.doc).toEqual({ taskCategory: "doc", factor: 2.2, sampleCount: 7 });
    expect(map.research).toBeUndefined();
  });

  test("空配列なら空マップ", () => {
    expect(indexFactorsByCategory([])).toEqual({});
  });
});

describe("correctEstimate", () => {
  const factors = indexFactorsByCategory([
    { taskCategory: "coding", factor: 0.8, sampleCount: 10 },
    { taskCategory: "doc", factor: 2.2, sampleCount: 7 },
    { taskCategory: "research", factor: 1.5, sampleCount: 2 }, // 閾値未満 (5)
  ]);

  test("補正適用: 倍率 × 元値を四捨五入で返す", () => {
    expect(correctEstimate({ estimatedMinutes: 30, taskCategory: "doc", factors })).toEqual({
      rawMinutes: 30,
      correctedMinutes: 66, // 30 * 2.2
      factor: 2.2,
      sampleCount: 7,
    });
  });

  test("倍率 < 1 (コーディング系) でも補正適用される (短く確保)", () => {
    expect(correctEstimate({ estimatedMinutes: 30, taskCategory: "coding", factors })).toEqual({
      rawMinutes: 30,
      correctedMinutes: 24, // 30 * 0.8
      factor: 0.8,
      sampleCount: 10,
    });
  });

  test("最小サンプル数閾値未満は補正なし (元値のみ)", () => {
    expect(correctEstimate({ estimatedMinutes: 30, taskCategory: "research", factors })).toEqual({
      rawMinutes: 30,
      correctedMinutes: null,
      factor: null,
      sampleCount: null,
    });
  });

  test("category にデータが無い場合は補正なし", () => {
    expect(correctEstimate({ estimatedMinutes: 30, taskCategory: "admin", factors })).toEqual({
      rawMinutes: 30,
      correctedMinutes: null,
      factor: null,
      sampleCount: null,
    });
  });

  test("task_category=null は補正対象外 (ADR 0015)", () => {
    expect(correctEstimate({ estimatedMinutes: 30, taskCategory: null, factors })).toEqual({
      rawMinutes: 30,
      correctedMinutes: null,
      factor: null,
      sampleCount: null,
    });
  });

  test("estimatedMinutes が null なら null (UI に出さない)", () => {
    expect(correctEstimate({ estimatedMinutes: null, taskCategory: "doc", factors })).toBeNull();
  });

  test("estimatedMinutes が 0 以下なら null", () => {
    expect(correctEstimate({ estimatedMinutes: 0, taskCategory: "doc", factors })).toBeNull();
    expect(correctEstimate({ estimatedMinutes: -5, taskCategory: "doc", factors })).toBeNull();
  });

  test("補正後が 1 分未満になる場合は 1 分に底上げ (0min 表示を避ける)", () => {
    const tinyFactors = indexFactorsByCategory([
      { taskCategory: "coding", factor: 0.01, sampleCount: 10 },
    ]);
    const result = correctEstimate({
      estimatedMinutes: 5,
      taskCategory: "coding",
      factors: tinyFactors,
    });
    expect(result?.correctedMinutes).toBe(1);
  });

  test("minSampleCount オプションで閾値を変えられる", () => {
    const result = correctEstimate({
      estimatedMinutes: 30,
      taskCategory: "research",
      factors,
      minSampleCount: 1,
    });
    expect(result?.correctedMinutes).toBe(45); // 30 * 1.5
  });
});

describe("CORRECTION_CONSTANTS", () => {
  test("Supabase view の境界値と一致する (contract)", () => {
    // ADR 0024 / supabase/migrations/..._p3_9_estimation_correction_views.sql
    expect(CORRECTION_CONSTANTS.OUTLIER_LOW).toBe(0.1);
    expect(CORRECTION_CONSTANTS.OUTLIER_HIGH).toBe(10);
    expect(CORRECTION_CONSTANTS.MIN_SAMPLE_COUNT).toBe(5);
  });
});
