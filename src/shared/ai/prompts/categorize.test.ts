import { describe, expect, test } from "vitest";

import { buildCategorizePrompt, parseCategorizeResponse } from "./categorize";

describe("buildCategorizePrompt", () => {
  test("title / body を埋め込み、本文ありの分類を促す", () => {
    const prompt = buildCategorizePrompt({
      title: "RLS ポリシーの実装",
      body: "tasks テーブルの user_id 制約を追加する",
    });

    expect(prompt).toContain("RLS ポリシーの実装");
    expect(prompt).toContain("tasks テーブルの user_id 制約を追加する");
  });

  test("body が空のときも壊れず (本文なし) として扱う", () => {
    const prompt = buildCategorizePrompt({ title: "x", body: "" });

    expect(prompt).toContain("(本文なし)");
  });

  test("値域 (coding/doc/research/admin/other) と 1 語のみ返す制約が含まれる", () => {
    const prompt = buildCategorizePrompt({ title: "x", body: "y" });

    expect(prompt).toContain("coding");
    expect(prompt).toContain("doc");
    expect(prompt).toContain("research");
    expect(prompt).toContain("admin");
    expect(prompt).toContain("other");
    expect(prompt).toContain("1 語のみ");
  });
});

describe("parseCategorizeResponse", () => {
  test.each([["coding"], ["doc"], ["research"], ["admin"], ["other"]])(
    "値域そのままの応答 %s を採用する",
    (raw) => {
      expect(parseCategorizeResponse(raw)).toBe(raw);
    },
  );

  test("前後の空白 / 改行を削る", () => {
    expect(parseCategorizeResponse("  coding\n")).toBe("coding");
  });

  test("末尾の句読点 (。 . ) や引用符を削る", () => {
    expect(parseCategorizeResponse("coding.")).toBe("coding");
    expect(parseCategorizeResponse("coding。")).toBe("coding");
    expect(parseCategorizeResponse('"doc"')).toBe("doc");
    expect(parseCategorizeResponse("`research`")).toBe("research");
  });

  test("大小文字差を吸収する (LLM が `Coding` / `CODING` を返しても拾う)", () => {
    expect(parseCategorizeResponse("Coding")).toBe("coding");
    expect(parseCategorizeResponse("DOC")).toBe("doc");
  });

  test("markdown fence (```...```) を剥がす", () => {
    expect(parseCategorizeResponse("```\ncoding\n```")).toBe("coding");
    expect(parseCategorizeResponse("```text\nadmin\n```")).toBe("admin");
  });

  test("値域外の単語は null (= AI 失敗扱い、`task_category` は null のまま残す)", () => {
    expect(parseCategorizeResponse("meeting")).toBeNull();
    expect(parseCategorizeResponse("learning")).toBeNull();
    expect(parseCategorizeResponse("作業")).toBeNull();
  });

  test("空文字 / 空白だけ → null", () => {
    expect(parseCategorizeResponse("")).toBeNull();
    expect(parseCategorizeResponse("   \n  ")).toBeNull();
  });

  test("文章で説明されると null (1 語制約を破った応答は採用しない)", () => {
    // ADR 0015 Notes: ラベリング失敗は null で残し、Phase 4 のラベリング精度
    // 改善ループで「AI が分類できなかった事象」として観測可能にする。
    expect(parseCategorizeResponse("これは coding に分類できます")).toBeNull();
  });
});
