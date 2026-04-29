import { describe, expect, test } from "vitest";

import { buildDecomposePrompt, parseDecomposeResponse } from "./decompose";

describe("buildDecomposePrompt", () => {
  test("親タスクの title / body / estimated_minutes を埋め込む", () => {
    const prompt = buildDecomposePrompt({
      title: "Dirbato 最終面接対策",
      body: "志望動機 / 逆質問 / 自己 PR を準備する",
      estimatedMinutes: 90,
    });

    expect(prompt).toContain("Dirbato 最終面接対策");
    expect(prompt).toContain("志望動機 / 逆質問 / 自己 PR を準備する");
    expect(prompt).toContain("90分");
  });

  test("body が空のときも壊れず (本文なし) として扱う", () => {
    const prompt = buildDecomposePrompt({
      title: "x",
      body: "",
      estimatedMinutes: null,
    });

    expect(prompt).toContain("(本文なし)");
    expect(prompt).toContain("未設定");
  });

  test("出力形式の制約 (件数 / 自立タイトル / JSON のみ) が prompt に含まれる", () => {
    const prompt = buildDecomposePrompt({
      title: "x",
      body: "",
      estimatedMinutes: null,
    });

    expect(prompt).toContain("2〜7 件");
    expect(prompt).toContain("空配列");
    expect(prompt).toContain("JSON 配列のみ");
    // ADR 0016 Notes「子タイトルの自立性」を担保する具体例
    expect(prompt).toContain("親タスクの文脈なしで");
  });

  test("task_category の値域と各項目の定義が prompt に含まれる (ADR 0022)", () => {
    const prompt = buildDecomposePrompt({
      title: "x",
      body: "",
      estimatedMinutes: null,
    });

    // 値域 (categorize.ts と同じ集合)
    expect(prompt).toContain("coding");
    expect(prompt).toContain("doc");
    expect(prompt).toContain("research");
    expect(prompt).toContain("admin");
    expect(prompt).toContain("other");
    // 出力例に task_category フィールドが含まれる
    expect(prompt).toContain('"task_category"');
  });
});

describe("parseDecomposeResponse", () => {
  test("正常な JSON 配列をパースする (estimated_minutes / task_category とも値域内なら採用)", () => {
    const input = JSON.stringify([
      { title: "下準備をする", estimated_minutes: 30, task_category: "research" },
      { title: "本作業を進める", estimated_minutes: null, task_category: "coding" },
      { title: "振り返り", estimated_minutes: 15, task_category: "doc" },
    ]);

    const result = parseDecomposeResponse(input);

    expect(result).toEqual([
      { title: "下準備をする", estimatedMinutes: 30, taskCategory: "research" },
      { title: "本作業を進める", estimatedMinutes: null, taskCategory: "coding" },
      { title: "振り返り", estimatedMinutes: 15, taskCategory: "doc" },
    ]);
  });

  test("markdown fence (```json ... ```) を剥がす", () => {
    const input =
      '```json\n[{"title":"a","estimated_minutes":15,"task_category":"coding"},{"title":"b","estimated_minutes":15,"task_category":"doc"}]\n```';

    const result = parseDecomposeResponse(input);

    expect(result).toEqual([
      { title: "a", estimatedMinutes: 15, taskCategory: "coding" },
      { title: "b", estimatedMinutes: 15, taskCategory: "doc" },
    ]);
  });

  test("空配列は [] を返し (= 親を skipped に倒す入力)、null とは区別する", () => {
    const result = parseDecomposeResponse("[]");
    expect(result).toEqual([]);
  });

  test("1 件のみは「実質分解されていない」ので [] (skipped 扱い) に倒す", () => {
    const input = JSON.stringify([
      { title: "ひとつだけ", estimated_minutes: 10, task_category: "coding" },
    ]);

    const result = parseDecomposeResponse(input);

    expect(result).toEqual([]);
  });

  test("8 件以上は先頭 7 件で切る (AI 暴走時の安全弁)", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      title: `子${i + 1}`,
      estimated_minutes: 15,
      task_category: "coding",
    }));

    const result = parseDecomposeResponse(JSON.stringify(items));

    expect(result).toHaveLength(7);
    expect(result?.[0].title).toBe("子1");
    expect(result?.[6].title).toBe("子7");
  });

  test("title が空 / 80 文字超過のエントリは捨て、残りを採用する", () => {
    const longTitle = "あ".repeat(81);
    const items = [
      { title: "", estimated_minutes: 15, task_category: "coding" }, // 空 → 捨てる
      { title: longTitle, estimated_minutes: 15, task_category: "coding" }, // 80 文字超過 → 捨てる
      { title: "ok-1", estimated_minutes: 15, task_category: "coding" },
      { title: "ok-2", estimated_minutes: 15, task_category: "doc" },
    ];

    const result = parseDecomposeResponse(JSON.stringify(items));

    expect(result).toEqual([
      { title: "ok-1", estimatedMinutes: 15, taskCategory: "coding" },
      { title: "ok-2", estimatedMinutes: 15, taskCategory: "doc" },
    ]);
  });

  test("estimated_minutes が許容バケット外 / 文字列 / 小数 → null に倒す (entry は採用)", () => {
    const items = [
      { title: "a", estimated_minutes: 7, task_category: "coding" }, // バケット外
      { title: "b", estimated_minutes: "30", task_category: "coding" }, // 文字列
      { title: "c", estimated_minutes: 15.5, task_category: "coding" }, // 小数
      { title: "d", estimated_minutes: 30, task_category: "coding" }, // 許容
    ];

    const result = parseDecomposeResponse(JSON.stringify(items));

    expect(result).toEqual([
      { title: "a", estimatedMinutes: null, taskCategory: "coding" },
      { title: "b", estimatedMinutes: null, taskCategory: "coding" },
      { title: "c", estimatedMinutes: null, taskCategory: "coding" },
      { title: "d", estimatedMinutes: 30, taskCategory: "coding" },
    ]);
  });

  test("task_category が値域外 / 欠損 / 型違い → null に倒す (entry は採用、ADR 0022 フェイルソフト)", () => {
    const items = [
      { title: "a", estimated_minutes: 15, task_category: "general" }, // 値域外
      { title: "b", estimated_minutes: 15, task_category: "" }, // 空文字
      { title: "c", estimated_minutes: 15 }, // 欠損
      { title: "d", estimated_minutes: 15, task_category: 1 }, // 型違い (数値)
      { title: "e", estimated_minutes: 15, task_category: null }, // 明示 null
      { title: "f", estimated_minutes: 15, task_category: "doc" }, // 値域内
    ];

    const result = parseDecomposeResponse(JSON.stringify(items));

    expect(result).toEqual([
      { title: "a", estimatedMinutes: 15, taskCategory: null },
      { title: "b", estimatedMinutes: 15, taskCategory: null },
      { title: "c", estimatedMinutes: 15, taskCategory: null },
      { title: "d", estimatedMinutes: 15, taskCategory: null },
      { title: "e", estimatedMinutes: 15, taskCategory: null },
      { title: "f", estimatedMinutes: 15, taskCategory: "doc" },
    ]);
  });

  test("task_category は大文字 / 前後空白を許容して値域に合わせる (Coding → coding)", () => {
    const items = [
      { title: "a", estimated_minutes: 15, task_category: "Coding" },
      { title: "b", estimated_minutes: 15, task_category: " admin " },
    ];

    const result = parseDecomposeResponse(JSON.stringify(items));

    expect(result).toEqual([
      { title: "a", estimatedMinutes: 15, taskCategory: "coding" },
      { title: "b", estimatedMinutes: 15, taskCategory: "admin" },
    ]);
  });

  test("category 値域内すべて (coding/doc/research/admin/other) を受理する", () => {
    const items = [
      { title: "a", estimated_minutes: 15, task_category: "coding" },
      { title: "b", estimated_minutes: 15, task_category: "doc" },
      { title: "c", estimated_minutes: 15, task_category: "research" },
      { title: "d", estimated_minutes: 15, task_category: "admin" },
      { title: "e", estimated_minutes: 15, task_category: "other" },
    ];

    const result = parseDecomposeResponse(JSON.stringify(items));

    expect(result?.map((c) => c.taskCategory)).toEqual([
      "coding",
      "doc",
      "research",
      "admin",
      "other",
    ]);
  });

  test("JSON でない / 配列でない / 空文字列は null を返す (= AI 失敗扱い、none のまま残す)", () => {
    expect(parseDecomposeResponse("")).toBeNull();
    expect(parseDecomposeResponse("not json")).toBeNull();
    expect(parseDecomposeResponse('{"title":"a"}')).toBeNull();
    expect(parseDecomposeResponse("null")).toBeNull();
  });
});
