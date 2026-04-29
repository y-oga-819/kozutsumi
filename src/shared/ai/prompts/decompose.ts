/**
 * AI タスク分解 (P3-6, ADR 0017 / 0018 / 0022) の prompt 構築 + 応答パース。
 *
 * Gemini 呼び出し境界の外側に純粋関数として置くことで、prompt 文字列の組み立てと
 * 応答 JSON の解釈をユニットテストで踏める形にしている (`/api/ai/decompose` 本体は
 * これをデータパイプとしてつなぐだけ)。
 *
 * 出力契約 (ADR 0016 §1, 0017 Decision 3-5, 0018 Decision, 0022 Decision 2):
 * - 「これ以上分解する必要なし」と判定された場合は空配列 → 親は `decompose_status='skipped'` に倒す
 * - 子タイトルは親文脈なしで意味が読める独立した文言 (ADR 0016 Notes 「子タイトルの自立性」)
 * - 子の estimated_minutes は AI が自信を持てない場合 null。親見積もりの機械的等分はしない
 *   (補正後見積もりの責務は P3-9 / architecture.md §1.5)
 * - 子の task_category も同じ AI 呼び出しで推論する (ADR 0022)。値域外・欠損は null に倒し、
 *   `other` で握り潰さない (ADR 0013 augmentation only)。category だけの parse 失敗で
 *   子の生成自体は止めない (title / estimated_minutes が取れていれば子を作る)。
 */

import { TASK_CATEGORY_VALUES, type TaskCategoryValue } from "@/shared/types/database";

export type DecomposeInput = {
  title: string;
  body: string;
  estimatedMinutes: number | null;
};

export type DecomposedChild = {
  title: string;
  estimatedMinutes: number | null;
  taskCategory: TaskCategoryValue | null;
};

const MIN_CHILDREN = 2;
const MAX_CHILDREN = 7;
const MAX_TITLE_LEN = 80;

const ALLOWED_ESTIMATE_BUCKETS = [5, 10, 15, 20, 30, 45, 60, 90, 120] as const;

/**
 * Gemini に渡す prompt 文字列を構築する。
 *
 * - 出力数の上下限 (2〜7) を明示する。1 件しか出ないなら「分解不要」として空配列を返させる
 *   (parser 側で 1 件は `skipped` 扱いに倒すフェイルセーフもあるが、prompt でも縛る)
 * - 子タイトルは親文脈なしで読めること、本文に親タスク情報を埋め込んで誘導する
 * - 出力は JSON 配列のみ。markdown fence や説明文が混じっても parser 側で剥がす前提
 */
export function buildDecomposePrompt(parent: DecomposeInput): string {
  const bodyText = parent.body.trim().length > 0 ? parent.body.trim() : "(本文なし)";
  const estimateText = parent.estimatedMinutes !== null ? `${parent.estimatedMinutes}分` : "未設定";

  return [
    "あなたは個人特化のタスク管理アシスタント。次の親タスクを、実行可能な粒度の子タスクに分解する。",
    "",
    "# 分解の方針",
    `- 子タスクは ${MIN_CHILDREN}〜${MAX_CHILDREN} 件。`,
    "- 親タスクが既に十分小さく分解の必要がないと判断したら、空配列 [] を返す。",
    "- 各子タスクの title は、親タスクの文脈なしで読んで意味が取れる短い独立した文言にする。",
    "  例 (悪): 「志望動機を書く」 / 例 (良): 「Dirbato 最終面接 志望動機 (パターン A) を書く」",
    `- title は ${MAX_TITLE_LEN} 文字以内。装飾的なプレフィックス (Step 1: 等) は付けない。`,
    `- estimated_minutes は ${ALLOWED_ESTIMATE_BUCKETS.join("/")} のいずれかの整数か、自信が無ければ null。`,
    "",
    "# task_category の値域 (各子タスクの作業種類)",
    "- coding   : 実装 / バグ修正 / リファクタ / レビュー / セットアップなどコードを書く作業",
    "- doc      : ドキュメント / 議事録 / 設計メモ / レポート / メール / 連絡文を書く作業",
    "- research : 調査 / 比較検討 / 学習 / インタビュー / 仕様読解など情報収集の作業",
    "- admin    : 事務手続き / 経費精算 / 予約 / スケジューリング / 雑務",
    "- other    : 上記いずれにも当てはまらない作業",
    "判断に確信が持てない場合は other を返す。",
    "",
    "# 親タスク",
    `title: ${parent.title}`,
    `body: ${bodyText}`,
    `estimated_minutes: ${estimateText}`,
    "",
    "# 出力形式",
    "JSON 配列のみを返す。前後に説明文や markdown fence を付けない。",
    "各要素は title / estimated_minutes / task_category の 3 フィールドを持つ。",
    '例: [{"title":"...","estimated_minutes":30,"task_category":"coding"},{"title":"...","estimated_minutes":null,"task_category":"research"}]',
  ].join("\n");
}

/**
 * Gemini 応答テキストを `DecomposedChild[]` に解釈する。
 *
 * - markdown fence (```json ... ```) を剥がす
 * - JSON 配列以外 / 解釈不能 → `null` (呼び出し側で「失敗」として親を `none` のまま残す)
 * - 空配列 → `[]` (呼び出し側で「分解不要」として親を `skipped` に倒す)
 * - 1 件のみ → `[]` 扱い (実質的な分解になっていないため)
 * - 件数オーバー (>7) → 先頭 7 件で切る (AI が暴走した時の安全弁)
 * - title が空 / 80 文字超過 → entry を捨てる (それ以外を採用)
 * - estimated_minutes が許容バケット外 → null に倒す (整数 / null 以外も null)
 *
 * 戻り値:
 *   `null`            : パース不能 (= AI 失敗扱い、`none` のまま残す)
 *   `[]`              : 分解不要 (= `skipped`)
 *   `DecomposedChild[]` (1+ 件): 採用する子配列
 */
export function parseDecomposeResponse(text: string): DecomposedChild[] | null {
  const stripped = stripMarkdownFence(text).trim();
  if (stripped.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;

  const children: DecomposedChild[] = [];
  for (const entry of parsed) {
    const child = normalizeChild(entry);
    if (child) children.push(child);
    if (children.length >= MAX_CHILDREN) break;
  }

  // 1 件しか取れなかった = 実質「分解されていない」ので skipped 扱いに倒す。
  // ADR 0017 Decision 4 / vision「気づいたら細かくなってる」と整合させる
  // (1 → 1 の置き換えはユーザーから見て分解が起きたように見えない)。
  if (children.length < MIN_CHILDREN) return [];

  return children;
}

function stripMarkdownFence(text: string): string {
  const fenceRe = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i;
  const match = text.trim().match(fenceRe);
  return match ? match[1] : text;
}

function normalizeChild(raw: unknown): DecomposedChild | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  const title = typeof obj.title === "string" ? obj.title.trim() : "";
  if (title.length === 0 || title.length > MAX_TITLE_LEN) return null;

  const estimate = normalizeEstimate(obj.estimated_minutes);
  // task_category だけの parse 失敗 (値域外 / 型違い / 欠損) では子の生成自体を止めない。
  // null で埋めて子は作る (ADR 0022 §否定的影響: フェイルソフト)。
  const taskCategory = normalizeCategory(obj.task_category);
  return { title, estimatedMinutes: estimate, taskCategory };
}

function normalizeEstimate(raw: unknown): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  if (!Number.isInteger(raw)) return null;
  if (!ALLOWED_ESTIMATE_BUCKETS.includes(raw as (typeof ALLOWED_ESTIMATE_BUCKETS)[number])) {
    return null;
  }
  return raw;
}

/**
 * task_category の値域 ガード。
 *
 * - 値域内 (`coding` / `doc` / `research` / `admin` / `other`) → そのまま採用
 * - 値域外 / 型違い / 欠損 → null (`other` で握り潰さない: AI が判定不能だったケースと
 *   AI が `other` と判定したケースを区別するため。ADR 0015 Notes / ADR 0022 §動機)
 */
function normalizeCategory(raw: unknown): TaskCategoryValue | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().toLowerCase();
  const found = TASK_CATEGORY_VALUES.find((v) => v === cleaned);
  return found ?? null;
}
