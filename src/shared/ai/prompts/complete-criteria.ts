/**
 * AI タスク完了条件補完 (#245, ADR 0064 / 0066 / 0067) の prompt 構築 + 応答パース。
 *
 * title 必須のみで投入されたタスク (ADR 0064) に対し、AI が後追いで完了条件
 * (deliverable / done / first_step, ADR 0066) を言語化する。AI 分解 (decompose.ts) は
 * 親タスクを複数の子に割るが、本モジュールは「1 タスクの完了条件 3 項目を埋める」だけを
 * 担う。Gemini 呼び出し境界の外側に純粋関数として置き、prompt 生成と parse を
 * ユニットテストで踏める形にする (`/api/ai/complete-criteria` 本体はこれをつなぐだけ)。
 *
 * 出力契約 (ADR 0066 §Decision / ADR 0064 §Decision 4):
 * - 完了条件 3 項目は decompose.ts の子タスク出力 schema (deliverable / done /
 *   first_step) と一致させる (ADR 0066: 補完 schema = AI 分解 schema)。
 * - フェイルソフト: 欠損・型違いは空文字に倒す。AI が言語化できない項目は空文字を許容する。
 * - parse 不能 (JSON でない / オブジェクトでない) → null。呼び出し側は補完せずに残す。
 * - 補完値の DB 反映 (未補完フィールドのみ書く競合解決, ADR 0067 Decision 5) は
 *   complete-criteria-server が担う。本モジュールは prompt 生成と parse までを担う。
 */

import type { TaskSizeValue } from "@/shared/types/database";

export type CompleteCriteriaInput = {
  title: string;
  body: string;
  estimatedMinutes: number | null;
  /** 主観サイズ (ADR 0038)。AI に粒度感を伝える文脈情報。未設定なら null。 */
  taskSize?: TaskSizeValue | null;
};

/**
 * 完了条件 3 項目 (ADR 0061 / 0066)。decompose.ts の `DecomposedChild` の
 * deliverable / done / firstStep と同じ意味軸を持つ。
 */
export type CompletionCriteria = {
  deliverable: string;
  done: string;
  firstStep: string;
};

// 完了条件 (deliverable / done / first_step, ADR 0066) は一文程度の短い文言を想定する。
// AI が暴走しても 1 項目 200 文字で hard cap する (decompose.ts の MAX_CRITERION_LEN と
// 同値。両モジュールとも ADR 0066 の schema 契約を独立に守る)。
const MAX_CRITERION_LEN = 200;

/**
 * Gemini に渡す prompt 文字列を構築する。
 *
 * - 完了条件 3 項目の定義は decompose.ts と揃える (ADR 0066: schema 一致)。
 * - 出力は JSON オブジェクト 1 個のみ。markdown fence や説明文が混じっても parser 側で剥がす。
 */
export function buildCompleteCriteriaPrompt(task: CompleteCriteriaInput): string {
  const bodyText = task.body.trim().length > 0 ? task.body.trim() : "(本文なし)";
  const estimateText = task.estimatedMinutes !== null ? `${task.estimatedMinutes}分` : "未設定";
  const sizeText = task.taskSize ?? "未設定";

  return [
    "あなたは個人特化のタスク管理アシスタント。次のタスクに着手しやすくするため、完了条件を 3 項目言語化する。",
    "",
    "# 完了条件 (deliverable / done / first_step)",
    "3 項目は別軸 (何を生むか / いつ完了か / どう始めるか)。着手のハードルを下げるのが狙い。",
    "- deliverable : そのタスクが生む成果物を名詞で書く。「時間を使った」ではなく「何が出来上がったか」。状態変化タスクなら「〜された状態」。",
    "- done        : deliverable が完成したと言える観測可能な条件。曖昧な状態 (「だいたい出来た」) ではなく、満たしたか判定できる条件にする。",
    "- first_step  : 着手してまず手を動かす最初の一手。ここが大きいと着手できないので、すぐ始められる小ささにする。",
    "3 項目とも埋める。タスクが単純で書くことが薄くても、最低限の一文を埋める。",
    'どうしても言語化できない項目だけ空文字 "" を返してよい。',
    "",
    "# タスク",
    `title: ${task.title}`,
    `body: ${bodyText}`,
    `estimated_minutes: ${estimateText}`,
    `task_size: ${sizeText}`,
    "",
    "# 出力形式",
    "JSON オブジェクトのみを返す。前後に説明文や markdown fence を付けない。",
    "deliverable / done / first_step の 3 フィールドを持つ。",
    '例: {"deliverable":"...","done":"...","first_step":"..."}',
  ].join("\n");
}

/**
 * Gemini 応答テキストを `CompletionCriteria` に解釈する。
 *
 * - markdown fence (```json ... ```) を剥がす
 * - JSON オブジェクト以外 (配列 / プリミティブ / 解釈不能) → `null`
 *   (呼び出し側で「補完なし」として完了条件を空のまま残す)
 * - deliverable / done / first_step は欠損・型違いを空文字に倒す (body と同じ
 *   フェイルソフト。長すぎは truncate)
 *
 * 戻り値:
 *   `null`              : パース不能 (= AI 失敗扱い)
 *   `CompletionCriteria`: 3 項目 (空文字を含みうる)
 */
export function parseCompleteCriteriaResponse(text: string): CompletionCriteria | null {
  const stripped = stripMarkdownFence(text).trim();
  if (stripped.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return null;
  }

  const obj = parsed as Record<string, unknown>;
  return {
    deliverable: normalizeCriterion(obj.deliverable),
    done: normalizeCriterion(obj.done),
    firstStep: normalizeCriterion(obj.first_step),
  };
}

/**
 * 完了条件 (deliverable / done / first_step, ADR 0066) の値ガード。
 *
 * - 文字列以外 / 欠損 → 空文字 (フェイルソフト)
 * - MAX_CRITERION_LEN 超過 → 末尾 truncate (AI 暴走時の hard cap)
 */
function normalizeCriterion(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (trimmed.length <= MAX_CRITERION_LEN) return trimmed;
  return trimmed.slice(0, MAX_CRITERION_LEN);
}

function stripMarkdownFence(text: string): string {
  const fenceRe = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i;
  const match = text.trim().match(fenceRe);
  return match ? match[1] : text;
}
