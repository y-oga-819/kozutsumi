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

  test("各子タスクの body 生成指示と出力例が prompt に含まれる (#120)", () => {
    const prompt = buildDecomposePrompt({
      title: "x",
      body: "",
      estimatedMinutes: null,
    });

    // 子の body 生成方針
    expect(prompt).toContain("body は markdown");
    expect(prompt).toContain("200 文字程度");
    // 出力例に body フィールドが含まれる
    expect(prompt).toContain('"body"');
  });

  // ADR 0029 / Issue #121: 子の再分解時に兄弟 title を渡し、粒度合わせを誘導する。
  // 新規分解 (siblings 未指定 / 空) では従来通り兄弟セクションを出さないことで、
  // 既存呼び出し側に影響を与えない。
  test("siblings を渡すと「既存の兄弟タスク」セクションが prompt に現れる", () => {
    const prompt = buildDecomposePrompt({
      title: "本文を書く",
      body: "ドキュメント本文",
      estimatedMinutes: 30,
      siblings: ["導入部の構成を決める", "最終確認"],
    });

    expect(prompt).toContain("既存の兄弟タスク");
    expect(prompt).toContain("同じ粒度感");
    expect(prompt).toContain("- 導入部の構成を決める");
    expect(prompt).toContain("- 最終確認");
  });

  test("siblings を渡さなければ「既存の兄弟タスク」セクションは出ない", () => {
    const prompt = buildDecomposePrompt({
      title: "x",
      body: "",
      estimatedMinutes: null,
    });

    expect(prompt).not.toContain("既存の兄弟タスク");
  });

  test("siblings が空配列なら section を出さない (= 新規分解と同じ prompt)", () => {
    const prompt = buildDecomposePrompt({
      title: "x",
      body: "",
      estimatedMinutes: null,
      siblings: [],
    });

    expect(prompt).not.toContain("既存の兄弟タスク");
  });
});

describe("parseDecomposeResponse", () => {
  test("正常な JSON 配列をパースする (estimated_minutes / task_category とも値域内なら採用)", () => {
    const input = JSON.stringify([
      {
        title: "下準備をする",
        body: "- 必要な資料を集める\n- 環境を整える",
        estimated_minutes: 30,
        task_category: "research",
      },
      { title: "本作業を進める", body: "", estimated_minutes: null, task_category: "coding" },
      { title: "振り返り", body: "学びを箇条書き", estimated_minutes: 15, task_category: "doc" },
    ]);

    const result = parseDecomposeResponse(input);

    expect(result).toEqual([
      {
        title: "下準備をする",
        body: "- 必要な資料を集める\n- 環境を整える",
        estimatedMinutes: 30,
        taskCategory: "research",
      },
      { title: "本作業を進める", body: "", estimatedMinutes: null, taskCategory: "coding" },
      { title: "振り返り", body: "学びを箇条書き", estimatedMinutes: 15, taskCategory: "doc" },
    ]);
  });

  test("markdown fence (```json ... ```) を剥がす", () => {
    const input =
      '```json\n[{"title":"a","body":"","estimated_minutes":15,"task_category":"coding"},{"title":"b","body":"","estimated_minutes":15,"task_category":"doc"}]\n```';

    const result = parseDecomposeResponse(input);

    expect(result).toEqual([
      { title: "a", body: "", estimatedMinutes: 15, taskCategory: "coding" },
      { title: "b", body: "", estimatedMinutes: 15, taskCategory: "doc" },
    ]);
  });

  test("空配列は [] を返し (= 親を skipped に倒す入力)、null とは区別する", () => {
    const result = parseDecomposeResponse("[]");
    expect(result).toEqual([]);
  });

  test("1 件のみは「実質分解されていない」ので [] (skipped 扱い) に倒す", () => {
    const input = JSON.stringify([
      { title: "ひとつだけ", body: "", estimated_minutes: 10, task_category: "coding" },
    ]);

    const result = parseDecomposeResponse(input);

    expect(result).toEqual([]);
  });

  test("8 件以上は先頭 7 件で切る (AI 暴走時の安全弁)", () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      title: `子${i + 1}`,
      body: "",
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
      { title: "", body: "", estimated_minutes: 15, task_category: "coding" }, // 空 → 捨てる
      { title: longTitle, body: "", estimated_minutes: 15, task_category: "coding" }, // 80 文字超過 → 捨てる
      { title: "ok-1", body: "", estimated_minutes: 15, task_category: "coding" },
      { title: "ok-2", body: "", estimated_minutes: 15, task_category: "doc" },
    ];

    const result = parseDecomposeResponse(JSON.stringify(items));

    expect(result).toEqual([
      { title: "ok-1", body: "", estimatedMinutes: 15, taskCategory: "coding" },
      { title: "ok-2", body: "", estimatedMinutes: 15, taskCategory: "doc" },
    ]);
  });

  test("estimated_minutes が許容バケット外 / 文字列 / 小数 → null に倒す (entry は採用)", () => {
    const items = [
      { title: "a", body: "", estimated_minutes: 7, task_category: "coding" }, // バケット外
      { title: "b", body: "", estimated_minutes: "30", task_category: "coding" }, // 文字列
      { title: "c", body: "", estimated_minutes: 15.5, task_category: "coding" }, // 小数
      { title: "d", body: "", estimated_minutes: 30, task_category: "coding" }, // 許容
    ];

    const result = parseDecomposeResponse(JSON.stringify(items));

    expect(result).toEqual([
      { title: "a", body: "", estimatedMinutes: null, taskCategory: "coding" },
      { title: "b", body: "", estimatedMinutes: null, taskCategory: "coding" },
      { title: "c", body: "", estimatedMinutes: null, taskCategory: "coding" },
      { title: "d", body: "", estimatedMinutes: 30, taskCategory: "coding" },
    ]);
  });

  test("task_category が値域外 / 欠損 / 型違い → null に倒す (entry は採用、ADR 0022 フェイルソフト)", () => {
    const items = [
      { title: "a", body: "", estimated_minutes: 15, task_category: "general" }, // 値域外
      { title: "b", body: "", estimated_minutes: 15, task_category: "" }, // 空文字
      { title: "c", body: "", estimated_minutes: 15 }, // 欠損
      { title: "d", body: "", estimated_minutes: 15, task_category: 1 }, // 型違い (数値)
      { title: "e", body: "", estimated_minutes: 15, task_category: null }, // 明示 null
      { title: "f", body: "", estimated_minutes: 15, task_category: "doc" }, // 値域内
    ];

    const result = parseDecomposeResponse(JSON.stringify(items));

    expect(result).toEqual([
      { title: "a", body: "", estimatedMinutes: 15, taskCategory: null },
      { title: "b", body: "", estimatedMinutes: 15, taskCategory: null },
      { title: "c", body: "", estimatedMinutes: 15, taskCategory: null },
      { title: "d", body: "", estimatedMinutes: 15, taskCategory: null },
      { title: "e", body: "", estimatedMinutes: 15, taskCategory: null },
      { title: "f", body: "", estimatedMinutes: 15, taskCategory: "doc" },
    ]);
  });

  test("task_category は大文字 / 前後空白を許容して値域に合わせる (Coding → coding)", () => {
    const items = [
      { title: "a", body: "", estimated_minutes: 15, task_category: "Coding" },
      { title: "b", body: "", estimated_minutes: 15, task_category: " admin " },
    ];

    const result = parseDecomposeResponse(JSON.stringify(items));

    expect(result).toEqual([
      { title: "a", body: "", estimatedMinutes: 15, taskCategory: "coding" },
      { title: "b", body: "", estimatedMinutes: 15, taskCategory: "admin" },
    ]);
  });

  test("category 値域内すべて (coding/doc/research/admin/other) を受理する", () => {
    const items = [
      { title: "a", body: "", estimated_minutes: 15, task_category: "coding" },
      { title: "b", body: "", estimated_minutes: 15, task_category: "doc" },
      { title: "c", body: "", estimated_minutes: 15, task_category: "research" },
      { title: "d", body: "", estimated_minutes: 15, task_category: "admin" },
      { title: "e", body: "", estimated_minutes: 15, task_category: "other" },
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

  test("body が欠損 / 型違い (number / null) → 空文字に倒す (entry は採用、フェイルソフト)", () => {
    const items = [
      { title: "a", estimated_minutes: 15, task_category: "coding" }, // 欠損
      { title: "b", body: 123, estimated_minutes: 15, task_category: "coding" }, // 数値
      { title: "c", body: null, estimated_minutes: 15, task_category: "coding" }, // null
      { title: "d", body: "メモ", estimated_minutes: 15, task_category: "coding" }, // 文字列
    ];

    const result = parseDecomposeResponse(JSON.stringify(items));

    expect(result?.map((c) => c.body)).toEqual(["", "", "", "メモ"]);
  });

  test("body が 600 文字を超える → 600 文字で truncate (AI 暴走時の hard cap)", () => {
    const longBody = "あ".repeat(800);
    const items = [
      { title: "a", body: longBody, estimated_minutes: 15, task_category: "coding" },
      { title: "b", body: "短い", estimated_minutes: 15, task_category: "coding" },
    ];

    const result = parseDecomposeResponse(JSON.stringify(items));

    expect(result?.[0].body.length).toBe(600);
    expect(result?.[1].body).toBe("短い");
  });

  test("8 件以上 / title 採用後の body 採用も含めて、parser は entry を全フィールド埋めて返す", () => {
    // body 1 件目に markdown が入る現実的なケース
    const items = [
      {
        title: "API 仕様を確認する",
        body: "- README を読む\n- 認証フローを把握する\n- レート制限を確認する",
        estimated_minutes: 15,
        task_category: "research",
      },
      {
        title: "クライアント実装をする",
        body: "fetch ラッパーを作る",
        estimated_minutes: 30,
        task_category: "coding",
      },
    ];

    const result = parseDecomposeResponse(JSON.stringify(items));

    expect(result).toEqual([
      {
        title: "API 仕様を確認する",
        body: "- README を読む\n- 認証フローを把握する\n- レート制限を確認する",
        estimatedMinutes: 15,
        taskCategory: "research",
      },
      {
        title: "クライアント実装をする",
        body: "fetch ラッパーを作る",
        estimatedMinutes: 30,
        taskCategory: "coding",
      },
    ]);
  });

  test("JSON でない / 配列でない / 空文字列は null を返す (= AI 失敗扱い、none のまま残す)", () => {
    expect(parseDecomposeResponse("")).toBeNull();
    expect(parseDecomposeResponse("not json")).toBeNull();
    expect(parseDecomposeResponse('{"title":"a"}')).toBeNull();
    expect(parseDecomposeResponse("null")).toBeNull();
  });
});
