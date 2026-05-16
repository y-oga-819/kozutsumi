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

  test("出力形式の制約 (自然な単位 / 自立タイトル / JSON のみ) が prompt に含まれる (ADR 0049: 件数上限は持たない)", () => {
    const prompt = buildDecomposePrompt({
      title: "x",
      body: "",
      estimatedMinutes: null,
    });

    // ADR 0049: 静的な件数上限を持たず、AI に「自然な単位」で判断させる
    expect(prompt).toContain("自然な単位");
    expect(prompt).toContain("件数の上限は無く");
    // 件数指示の旧文言 (X〜Y 件) が消えていることを明示
    expect(prompt).not.toMatch(/\d+〜\d+ 件/);
    expect(prompt).toContain("空配列");
    expect(prompt).toContain("JSON 配列のみ");
    // ADR 0016 Notes「子タイトルの自立性」を担保する具体例
    expect(prompt).toContain("親タスクの文脈なしで");
  });

  // ADR 0061 / Issue #243: 1 時間粒度を「推奨目安」として prompt に明示する。
  // 強制ではない (5 分や 2〜3 時間も許容) ことも併記する。
  test("ADR 0061: 30〜90 分 (1h 中心) の粒度目安が推奨として prompt に含まれる", () => {
    const prompt = buildDecomposePrompt({
      title: "x",
      body: "",
      estimatedMinutes: null,
    });

    expect(prompt).toContain("30〜90 分");
    expect(prompt).toContain("1 時間");
    // 強制ではないことが明示されている (推奨目安)
    expect(prompt).toContain("強制ではない");
  });

  // ADR 0061 / Issue #243: 各子に完了条件 (goal / done / first_step) を生成させる。
  test("ADR 0061: 完了条件 (goal / done / first_step) の生成指示が prompt に含まれる", () => {
    const prompt = buildDecomposePrompt({
      title: "x",
      body: "",
      estimatedMinutes: null,
    });

    expect(prompt).toContain("完了条件");
    expect(prompt).toContain("goal");
    expect(prompt).toContain("done");
    expect(prompt).toContain("first_step");
    // 出力例に 3 項目が含まれる
    expect(prompt).toContain('"goal"');
    expect(prompt).toContain('"done"');
    expect(prompt).toContain('"first_step"');
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

  test("task_size の値域と各項目の定義が prompt に含まれる (ADR 0038 / #169)", () => {
    const prompt = buildDecomposePrompt({
      title: "x",
      body: "",
      estimatedMinutes: null,
    });

    // 7 段階の値域すべてが prompt に含まれる
    expect(prompt).toContain("15m");
    expect(prompt).toContain("30m");
    expect(prompt).toContain("1h");
    expect(prompt).toContain("2h");
    expect(prompt).toContain("4h");
    expect(prompt).toContain("1d");
    expect(prompt).toContain("large");
    // 出力例に task_size フィールドが含まれる
    expect(prompt).toContain('"task_size"');
    // estimated_minutes と task_size は別軸であることが prompt に明示されている (ADR 0053)
    expect(prompt).toContain("別軸");
  });

  test("ADR 0053: 親 task_size より大きい子 size を許容する文言が prompt に含まれる", () => {
    const prompt = buildDecomposePrompt({
      title: "x",
      body: "",
      estimatedMinutes: null,
      taskSize: "large",
    });

    // 「親より大きい値も付けてよい」を明示している
    expect(prompt).toContain("親より大きい値も付けてよい");
    // 旧 cap 文言が消えている
    expect(prompt).not.toContain("親の task_size より大きい値を子に付けない");
    // task_size は必ず埋めるが estimated_minutes は ≤2h 専用、の非対称が示されている
    expect(prompt).toContain("task_size は必ず埋める");
  });

  test("ADR 0053: estimated_minutes は ≤ 2h 専用で、>2h は null を返すよう prompt が指示する", () => {
    const prompt = buildDecomposePrompt({
      title: "x",
      body: "",
      estimatedMinutes: null,
      taskSize: "large",
    });

    // size gate の核心: 2h を超えるタスクでは null を返す
    expect(prompt).toContain("2 時間以下に収まるタスクの分単位見積もり専用");
    expect(prompt).toContain("4h / 1d / large");
    expect(prompt).toContain("必ず null");
    // 最大バケットへのクリップを明示的に禁止する
    expect(prompt).toContain("最大バケット 120 にクリップせず");
    // 旧文言「自信が無ければ null」だけ (確信度ゲート単独) は使っていない
    // size gate と確信度ゲートの両方を併記しているはず
    expect(prompt).toContain("確信が持てない場合は null");
  });

  test("親 task_size を渡すと「親タスク」セクションに反映される (ADR 0038 / #169)", () => {
    const prompt = buildDecomposePrompt({
      title: "x",
      body: "",
      estimatedMinutes: null,
      taskSize: "1h",
    });

    expect(prompt).toContain("task_size: 1h");
  });

  test("親 task_size 未指定なら「未設定」として出る (後方互換)", () => {
    const prompt = buildDecomposePrompt({
      title: "x",
      body: "",
      estimatedMinutes: null,
    });

    expect(prompt).toContain("task_size: 未設定");
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
  test("正常な JSON 配列をパースする (8 フィールドとも値域内なら採用、ADR 0061)", () => {
    const input = JSON.stringify([
      {
        title: "下準備をする",
        body: "- 必要な資料を集める\n- 環境を整える",
        estimated_minutes: 30,
        task_category: "research",
        task_size: "30m",
        goal: "本作業に必要な前提を揃える",
        done: "資料と環境がすべて手元にある",
        first_step: "資料リストを書き出す",
      },
      {
        title: "本作業を進める",
        body: "",
        estimated_minutes: null,
        task_category: "coding",
        task_size: "1h",
        goal: "機能を一通り動く状態にする",
        done: "ローカルで動作確認できる",
        first_step: "エントリポイントの関数を作る",
      },
      {
        title: "振り返り",
        body: "学びを箇条書き",
        estimated_minutes: 15,
        task_category: "doc",
        task_size: "15m",
        goal: "次に活かせる学びを残す",
        done: "メモが 3 行以上書けている",
        first_step: "今日詰まった点を 1 つ書く",
      },
    ]);

    const result = parseDecomposeResponse(input);

    expect(result).toEqual([
      {
        title: "下準備をする",
        body: "- 必要な資料を集める\n- 環境を整える",
        estimatedMinutes: 30,
        taskCategory: "research",
        taskSize: "30m",
        goal: "本作業に必要な前提を揃える",
        done: "資料と環境がすべて手元にある",
        firstStep: "資料リストを書き出す",
      },
      {
        title: "本作業を進める",
        body: "",
        estimatedMinutes: null,
        taskCategory: "coding",
        taskSize: "1h",
        goal: "機能を一通り動く状態にする",
        done: "ローカルで動作確認できる",
        firstStep: "エントリポイントの関数を作る",
      },
      {
        title: "振り返り",
        body: "学びを箇条書き",
        estimatedMinutes: 15,
        taskCategory: "doc",
        taskSize: "15m",
        goal: "次に活かせる学びを残す",
        done: "メモが 3 行以上書けている",
        firstStep: "今日詰まった点を 1 つ書く",
      },
    ]);
  });

  test("markdown fence (```json ... ```) を剥がす", () => {
    const input =
      '```json\n[{"title":"a","body":"","estimated_minutes":15,"task_category":"coding","task_size":"15m"},{"title":"b","body":"","estimated_minutes":15,"task_category":"doc","task_size":"30m"}]\n```';

    const result = parseDecomposeResponse(input);

    expect(result).toEqual([
      {
        title: "a",
        body: "",
        estimatedMinutes: 15,
        taskCategory: "coding",
        taskSize: "15m",
        goal: "",
        done: "",
        firstStep: "",
      },
      {
        title: "b",
        body: "",
        estimatedMinutes: 15,
        taskCategory: "doc",
        taskSize: "30m",
        goal: "",
        done: "",
        firstStep: "",
      },
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

  test("ADR 0049: 件数の上限を持たず、30 件以上の分解もそのまま採用する", () => {
    const items = Array.from({ length: 35 }, (_, i) => ({
      title: `子${i + 1}`,
      body: "",
      estimated_minutes: 15,
      task_category: "coding",
    }));

    const result = parseDecomposeResponse(JSON.stringify(items));

    expect(result).toHaveLength(35);
    expect(result?.[0].title).toBe("子1");
    expect(result?.[34].title).toBe("子35");
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
      {
        title: "ok-1",
        body: "",
        estimatedMinutes: 15,
        taskCategory: "coding",
        taskSize: null,
        goal: "",
        done: "",
        firstStep: "",
      },
      {
        title: "ok-2",
        body: "",
        estimatedMinutes: 15,
        taskCategory: "doc",
        taskSize: null,
        goal: "",
        done: "",
        firstStep: "",
      },
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

    expect(result?.map((c) => c.estimatedMinutes)).toEqual([null, null, null, 30]);
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

    expect(result?.map((c) => c.taskCategory)).toEqual([null, null, null, null, null, "doc"]);
  });

  test("task_category は大文字 / 前後空白を許容して値域に合わせる (Coding → coding)", () => {
    const items = [
      { title: "a", body: "", estimated_minutes: 15, task_category: "Coding" },
      { title: "b", body: "", estimated_minutes: 15, task_category: " admin " },
    ];

    const result = parseDecomposeResponse(JSON.stringify(items));

    expect(result?.map((c) => c.taskCategory)).toEqual(["coding", "admin"]);
  });

  test("task_size が値域外 / 欠損 / 型違い → null に倒す (entry は採用、ADR 0038 フェイルソフト)", () => {
    const items = [
      { title: "a", body: "", estimated_minutes: 15, task_category: "coding", task_size: "huge" }, // 値域外
      { title: "b", body: "", estimated_minutes: 15, task_category: "coding", task_size: "" }, // 空文字
      { title: "c", body: "", estimated_minutes: 15, task_category: "coding" }, // 欠損
      { title: "d", body: "", estimated_minutes: 15, task_category: "coding", task_size: 60 }, // 型違い
      { title: "e", body: "", estimated_minutes: 15, task_category: "coding", task_size: null }, // 明示 null
      { title: "f", body: "", estimated_minutes: 15, task_category: "coding", task_size: "1h" }, // 値域内
    ];

    const result = parseDecomposeResponse(JSON.stringify(items));

    expect(result?.map((c) => c.taskSize)).toEqual([null, null, null, null, null, "1h"]);
  });

  test("task_size 値域内すべて (15m/30m/1h/2h/4h/1d/large) を受理する (#169)", () => {
    const items = [
      { title: "a", body: "", estimated_minutes: 15, task_category: "coding", task_size: "15m" },
      { title: "b", body: "", estimated_minutes: 30, task_category: "coding", task_size: "30m" },
      { title: "c", body: "", estimated_minutes: 60, task_category: "coding", task_size: "1h" },
      { title: "d", body: "", estimated_minutes: 120, task_category: "coding", task_size: "2h" },
      { title: "e", body: "", estimated_minutes: null, task_category: "coding", task_size: "4h" },
      { title: "f", body: "", estimated_minutes: null, task_category: "coding", task_size: "1d" },
      {
        title: "g",
        body: "",
        estimated_minutes: null,
        task_category: "coding",
        task_size: "large",
      },
    ];

    const result = parseDecomposeResponse(JSON.stringify(items));

    expect(result?.map((c) => c.taskSize)).toEqual(["15m", "30m", "1h", "2h", "4h", "1d", "large"]);
  });

  test("task_size は大文字 / 前後空白を許容する (1H → 1h, ' Large ' → large)", () => {
    const items = [
      { title: "a", body: "", estimated_minutes: 15, task_category: "coding", task_size: "1H" },
      {
        title: "b",
        body: "",
        estimated_minutes: 15,
        task_category: "coding",
        task_size: " Large ",
      },
    ];

    const result = parseDecomposeResponse(JSON.stringify(items));

    expect(result?.map((c) => c.taskSize)).toEqual(["1h", "large"]);
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

  // ADR 0061 / Issue #243: 完了条件 3 項目の抽出。
  test("ADR 0061: goal / done / first_step が値域内なら抽出する", () => {
    const items = [
      {
        title: "a",
        body: "",
        estimated_minutes: 15,
        task_category: "coding",
        goal: "API を叩けるようにする",
        done: "200 が返ってくる",
        first_step: "エンドポイント URL を控える",
      },
      {
        title: "b",
        body: "",
        estimated_minutes: 15,
        task_category: "coding",
        goal: "テストを通す",
        done: "全 case green",
        first_step: "失敗ログを読む",
      },
    ];

    const result = parseDecomposeResponse(JSON.stringify(items));

    expect(result?.map((c) => ({ goal: c.goal, done: c.done, firstStep: c.firstStep }))).toEqual([
      {
        goal: "API を叩けるようにする",
        done: "200 が返ってくる",
        firstStep: "エンドポイント URL を控える",
      },
      { goal: "テストを通す", done: "全 case green", firstStep: "失敗ログを読む" },
    ]);
  });

  test("ADR 0061: goal / done / first_step が欠損 / 型違い → 空文字に倒す (entry は採用、フェイルソフト)", () => {
    const items = [
      { title: "a", body: "", estimated_minutes: 15, task_category: "coding" }, // 全欠損
      { title: "b", body: "", estimated_minutes: 15, task_category: "coding", goal: 123 }, // 型違い (number)
      { title: "c", body: "", estimated_minutes: 15, task_category: "coding", done: null }, // 明示 null
      {
        title: "d",
        body: "",
        estimated_minutes: 15,
        task_category: "coding",
        goal: "G のみ",
      }, // goal だけ
    ];

    const result = parseDecomposeResponse(JSON.stringify(items));

    expect(result?.map((c) => ({ goal: c.goal, done: c.done, firstStep: c.firstStep }))).toEqual([
      { goal: "", done: "", firstStep: "" },
      { goal: "", done: "", firstStep: "" },
      { goal: "", done: "", firstStep: "" },
      { goal: "G のみ", done: "", firstStep: "" },
    ]);
  });

  test("ADR 0061: 完了条件は前後空白を trim し、200 文字超過は truncate する", () => {
    const longGoal = "あ".repeat(250);
    const items = [
      {
        title: "a",
        body: "",
        estimated_minutes: 15,
        task_category: "coding",
        goal: "  前後に空白  ",
        done: longGoal,
        first_step: "短い",
      },
      { title: "b", body: "", estimated_minutes: 15, task_category: "coding" },
    ];

    const result = parseDecomposeResponse(JSON.stringify(items));

    expect(result?.[0].goal).toBe("前後に空白");
    expect(result?.[0].done.length).toBe(200);
    expect(result?.[0].firstStep).toBe("短い");
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
        task_size: "15m",
      },
      {
        title: "クライアント実装をする",
        body: "fetch ラッパーを作る",
        estimated_minutes: 30,
        task_category: "coding",
        task_size: "30m",
      },
    ];

    const result = parseDecomposeResponse(JSON.stringify(items));

    expect(result).toEqual([
      {
        title: "API 仕様を確認する",
        body: "- README を読む\n- 認証フローを把握する\n- レート制限を確認する",
        estimatedMinutes: 15,
        taskCategory: "research",
        taskSize: "15m",
        goal: "",
        done: "",
        firstStep: "",
      },
      {
        title: "クライアント実装をする",
        body: "fetch ラッパーを作る",
        estimatedMinutes: 30,
        taskCategory: "coding",
        taskSize: "30m",
        goal: "",
        done: "",
        firstStep: "",
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
