import { describe, expect, test } from "vitest";

import { buildCompleteCriteriaPrompt, parseCompleteCriteriaResponse } from "./complete-criteria";

describe("buildCompleteCriteriaPrompt", () => {
  test("title / body / estimate / size を prompt に埋め込む", () => {
    const prompt = buildCompleteCriteriaPrompt({
      title: "面接準備をする",
      body: "Dirbato 最終面接",
      estimatedMinutes: 60,
      taskSize: "1h",
    });

    expect(prompt).toContain("面接準備をする");
    expect(prompt).toContain("Dirbato 最終面接");
    expect(prompt).toContain("estimated_minutes: 60分");
    expect(prompt).toContain("task_size: 1h");
    // 完了条件 3 項目の定義が含まれる (ADR 0066 schema 一致)
    expect(prompt).toContain("deliverable");
    expect(prompt).toContain("done");
    expect(prompt).toContain("first_step");
  });

  test("body 空 / estimate null / size 未指定 はプレースホルダ表記になる", () => {
    const prompt = buildCompleteCriteriaPrompt({
      title: "メモを整理",
      body: "   ",
      estimatedMinutes: null,
    });

    expect(prompt).toContain("body: (本文なし)");
    expect(prompt).toContain("estimated_minutes: 未設定");
    expect(prompt).toContain("task_size: 未設定");
  });
});

describe("parseCompleteCriteriaResponse", () => {
  test("happy path: JSON オブジェクトを 3 項目に解釈する", () => {
    const result = parseCompleteCriteriaResponse(
      '{"deliverable":"志望動機の下書き","done":"3 パターン書き出した状態","first_step":"過去の経験を 1 つ書き出す"}',
    );

    expect(result).toEqual({
      deliverable: "志望動機の下書き",
      done: "3 パターン書き出した状態",
      firstStep: "過去の経験を 1 つ書き出す",
    });
  });

  test("markdown fence (```json) を剥がして解釈する", () => {
    const result = parseCompleteCriteriaResponse(
      '```json\n{"deliverable":"d","done":"x","first_step":"f"}\n```',
    );

    expect(result).toEqual({ deliverable: "d", done: "x", firstStep: "f" });
  });

  test("JSON でない → null", () => {
    expect(parseCompleteCriteriaResponse("これは完了条件です")).toBeNull();
  });

  test("空文字 → null", () => {
    expect(parseCompleteCriteriaResponse("")).toBeNull();
    expect(parseCompleteCriteriaResponse("   ")).toBeNull();
  });

  test("配列 / プリミティブ → null (オブジェクトでない)", () => {
    expect(parseCompleteCriteriaResponse('[{"deliverable":"d"}]')).toBeNull();
    expect(parseCompleteCriteriaResponse('"just a string"')).toBeNull();
    expect(parseCompleteCriteriaResponse("42")).toBeNull();
    expect(parseCompleteCriteriaResponse("null")).toBeNull();
  });

  test("項目欠損 / 型違いは空文字に倒す (フェイルソフト)", () => {
    const result = parseCompleteCriteriaResponse('{"deliverable":"d","done":123}');

    expect(result).toEqual({ deliverable: "d", done: "", firstStep: "" });
  });

  test("前後の空白は trim する", () => {
    const result = parseCompleteCriteriaResponse(
      '{"deliverable":"  d  ","done":"x","first_step":"f"}',
    );

    expect(result?.deliverable).toBe("d");
  });

  test("200 文字を超える項目は truncate する (AI 暴走時の hard cap)", () => {
    const long = "あ".repeat(300);
    const result = parseCompleteCriteriaResponse(
      `{"deliverable":"${long}","done":"x","first_step":"f"}`,
    );

    expect(result?.deliverable).toHaveLength(200);
  });
});
