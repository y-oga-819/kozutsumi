/**
 * AI タスク分類 (P3-4, ADR 0015 / 0013) の prompt 構築 + 応答パース。
 *
 * Gemini 呼び出し境界の外側に純粋関数として置くことで、prompt 文字列の組み立てと
 * 応答テキストの解釈をユニットテストで踏める形にしている (`/api/ai/categorize`
 * 本体はこれをデータパイプとしてつなぐだけ)。
 *
 * 出力契約:
 * - AI 失敗 / 解釈不能 / 想定外の値 → `null` (`task_category` は null のまま残す)
 * - 解釈成功 → `TaskCategoryValue` のいずれか
 *
 * 値域は `tasks.task_category` の CHECK と一致させる必要があり、
 * `TaskCategoryValue` (database.ts) を single source of truth として再利用する。
 */

import { TASK_CATEGORY_VALUES, type TaskCategoryValue } from "@/shared/types/database";

export type CategorizeInput = {
  title: string;
  body: string;
};

const ALLOWED = TASK_CATEGORY_VALUES;

/**
 * Gemini に渡す prompt 文字列を構築する。
 *
 * - 値域 (coding / doc / research / admin / other) を明示し、それ以外を返さないよう縛る
 * - 出力は値そのもの 1 トークン (例: `coding`)。json/markdown を強要しない方が
 *   小モデルでの応答揺れに耐性が高い
 * - 各カテゴリの定義を簡潔に書くことで、判定基準を user 個別の感覚に寄せ過ぎない
 */
export function buildCategorizePrompt(task: CategorizeInput): string {
  const bodyText = task.body.trim().length > 0 ? task.body.trim() : "(本文なし)";

  return [
    "あなたは個人特化のタスク管理アシスタント。次のタスクを 1 つのカテゴリに分類する。",
    "",
    "# カテゴリ定義",
    "- coding   : 実装 / バグ修正 / リファクタ / レビュー / セットアップなどコードを書く作業",
    "- doc      : ドキュメント / 議事録 / 設計メモ / レポート / メール / 連絡文を書く作業",
    "- research : 調査 / 比較検討 / 学習 / インタビュー / 仕様読解など情報収集の作業",
    "- admin    : 事務手続き / 経費精算 / 予約 / スケジューリング / 雑務",
    "- other    : 上記いずれにも当てはまらない作業",
    "",
    "# タスク",
    `title: ${task.title}`,
    `body: ${bodyText}`,
    "",
    "# 出力形式",
    `${ALLOWED.join(" / ")} のいずれか 1 語のみを返す。説明文・記号・改行・前後の空白を付けない。`,
    "判断に確信が持てない場合は other を返す。",
  ].join("\n");
}

/**
 * Gemini 応答テキストを `TaskCategoryValue` に解釈する。
 *
 * - markdown fence (```...```) を剥がす
 * - 前後の空白 / 末尾句読点を削る
 * - lowercase で値域と完全一致した場合のみ採用
 * - それ以外は `null` (= AI 失敗扱い、`task_category` は null のまま)
 *
 * `other` を fallback で返さない: 値域外を `other` に倒すと「AI が分類した」と
 * 「AI が判定不能だった」が区別できなくなり、Phase 4 のラベリング精度分析の
 * 入力が劣化する (ADR 0015 Notes / 暗黙フィードバック設計)。
 */
export function parseCategorizeResponse(text: string): TaskCategoryValue | null {
  const cleaned = stripMarkdownFence(text)
    .trim()
    .replace(/^["'`\s]+|["'`\s。.]+$/gu, "")
    .toLowerCase();
  if (cleaned.length === 0) return null;

  const found = ALLOWED.find((v) => v === cleaned);
  return found ?? null;
}

function stripMarkdownFence(text: string): string {
  const fenceRe = /^```(?:[a-z]+)?\s*\n?([\s\S]*?)\n?```$/i;
  const match = text.trim().match(fenceRe);
  return match ? match[1] : text;
}
