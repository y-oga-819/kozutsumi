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
});

describe("parseDecomposeResponse", () => {
  test("正常な JSON 配列をパースする (estimated_minutes は数値 / null どちらも許容)", () => {
    const input = JSON.stringify([
      { title: "下準備をする", estimated_minutes: 30 },
      { title: "本作業を進める", estimated_minutes: null },
      { title: "振り返り", estimated_minutes: 15 },
    ]);

    const result = parseDecomposeResponse(input);

    expect(result).toEqual([
      { title: "下準備をする", estimatedMinutes: 30 },
      { title: "本作業を進める", estimatedMinutes: null },
      { title: "振り返り", estimatedMinutes: 15 },
    ]);
  });

  test("markdown fence (```json ... ```) を剥がす", () => {
    const input =
      '```json\n[{"title":"a","estimated_minutes":15},{"title":"b","estimated_minutes":15}]\n```';

    const result = parseDecomposeResponse(input);

    expect(result).toEqual([
      { title: "a", estimatedMinutes: 15 },
      { title: "b", estimatedMinutes: 15 },
    ]);
  });

  test("空配列は [] を返し (= 親を skipped に倒す入力)、null とは区別する", () => {
    const result = parseDecomposeResponse("[]");
    expect(result).toEqual([]);
  });

  test("1 件のみは「実質分解されていない」ので [] (skipped 扱い) に倒す", () => {
    const input = JSON.stringify([{ title: "ひとつだけ", estimated_minutes: 10 }]);

    const result = parseDecomposeResponse(input);

    expect(result).toEqual([]);
  });

  test("8 件以上は先頭 7 件で切る (AI 暴走時の安全弁)", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      title: `子${i + 1}`,
      estimated_minutes: 15,
    }));

    const result = parseDecomposeResponse(JSON.stringify(items));

    expect(result).toHaveLength(7);
    expect(result?.[0].title).toBe("子1");
    expect(result?.[6].title).toBe("子7");
  });

  test("title が空 / 80 文字超過のエントリは捨て、残りを採用する", () => {
    const longTitle = "あ".repeat(81);
    const items = [
      { title: "", estimated_minutes: 15 }, // 空 → 捨てる
      { title: longTitle, estimated_minutes: 15 }, // 80 文字超過 → 捨てる
      { title: "ok-1", estimated_minutes: 15 },
      { title: "ok-2", estimated_minutes: 15 },
    ];

    const result = parseDecomposeResponse(JSON.stringify(items));

    expect(result).toEqual([
      { title: "ok-1", estimatedMinutes: 15 },
      { title: "ok-2", estimatedMinutes: 15 },
    ]);
  });

  test("estimated_minutes が許容バケット外 / 文字列 / 小数 → null に倒す (entry は採用)", () => {
    const items = [
      { title: "a", estimated_minutes: 7 }, // バケット外
      { title: "b", estimated_minutes: "30" }, // 文字列
      { title: "c", estimated_minutes: 15.5 }, // 小数
      { title: "d", estimated_minutes: 30 }, // 許容
    ];

    const result = parseDecomposeResponse(JSON.stringify(items));

    expect(result).toEqual([
      { title: "a", estimatedMinutes: null },
      { title: "b", estimatedMinutes: null },
      { title: "c", estimatedMinutes: null },
      { title: "d", estimatedMinutes: 30 },
    ]);
  });

  test("JSON でない / 配列でない / 空文字列は null を返す (= AI 失敗扱い、none のまま残す)", () => {
    expect(parseDecomposeResponse("")).toBeNull();
    expect(parseDecomposeResponse("not json")).toBeNull();
    expect(parseDecomposeResponse('{"title":"a"}')).toBeNull();
    expect(parseDecomposeResponse("null")).toBeNull();
  });
});
