/**
 * AI タスク分解 (P3-6, ADR 0017 / 0018 / 0022) の prompt 構築 + 応答パース。
 *
 * Gemini 呼び出し境界の外側に純粋関数として置くことで、prompt 文字列の組み立てと
 * 応答 JSON の解釈をユニットテストで踏める形にしている (`/api/ai/decompose` 本体は
 * これをデータパイプとしてつなぐだけ)。
 *
 * 出力契約 (ADR 0016 §1, 0017 Decision 3-5, 0018 Decision, 0022 Decision 2, 0052):
 * - 「これ以上分解する必要なし」と判定された場合は空配列 → 親は `decompose_status='skipped'` に倒す
 * - 子タイトルは親文脈なしで意味が読める独立した文言 (ADR 0016 Notes 「子タイトルの自立性」)
 * - 子の estimated_minutes は ≤ 2h タスク専用 (ADR 0053)。task_size が 4h/1d/large
 *   になる子では null を返す (最大バケット 120 にクリップしない)。確信度ゲートとしても null。
 *   親見積もりの機械的等分はしない (補正後見積もりの責務は P3-9 / architecture.md §1.5)
 * - 子の task_size は親より大きい値も許容する (ADR 0053)。親見積もりが楽観的だった
 *   シグナル / 親自身を再分解する余地のシグナルとして扱う。
 * - 子の task_category も同じ AI 呼び出しで推論する (ADR 0022)。値域外・欠損は null に倒し、
 *   `other` で握り潰さない (ADR 0013 augmentation only)。category だけの parse 失敗で
 *   子の生成自体は止めない (title / estimated_minutes が取れていれば子を作る)。
 */

import {
  TASK_CATEGORY_VALUES,
  TASK_SIZE_VALUES,
  type TaskCategoryValue,
  type TaskSizeValue,
} from "@/shared/types/database";

export type DecomposeInput = {
  title: string;
  body: string;
  estimatedMinutes: number | null;
  /**
   * ADR 0038 / Issue #169 / ADR 0053: 親タスクの主観サイズ (ユーザーが感じた粗い粒度感)。
   * AI 分解時に親の粒度感を伝える文脈情報。子の task_size はこの値で cap しない
   * (ADR 0053: 子が親より大きいケースは「親見積もりが楽観だった」シグナルとして許容する)。
   * 親が未設定 (既存タスク・後方互換経路) なら null / undefined。
   */
  taskSize?: TaskSizeValue | null;
  /**
   * ADR 0029 / Issue #121: 子の再分解時のみ、再分解対象の子の兄弟 title を渡す。
   * AI に「同じ粒度感で分解する」よう誘導するための文脈情報。
   * 新規分解 (親 1 回目) では undefined / 空配列 → 従来 prompt と同一。
   * 順序は stack_order 昇順 (= Stack View 表示順) を想定。再分解対象自身は含まない。
   */
  siblings?: string[];
};

export type DecomposedChild = {
  title: string;
  body: string;
  estimatedMinutes: number | null;
  taskCategory: TaskCategoryValue | null;
  /**
   * ADR 0038 / Issue #169: 子の主観サイズ。AI が推定し、ユーザーの主観入力と
   * 同じ列 (tasks.task_size) に保存する。値域外・欠損は null に倒す
   * (フェイルソフト: task_size の parse 失敗で子の生成自体は止めない)。
   */
  taskSize: TaskSizeValue | null;
};

const MAX_TITLE_LEN = 80;
// 子 body は markdown で 200 文字程度を目標に prompt で誘導する。AI が暴走しても
// task body 全体が肥大化しないよう 600 文字で hard cap する (truncate)。
const TARGET_BODY_LEN = 200;
const MAX_BODY_LEN = 600;

const ALLOWED_ESTIMATE_BUCKETS = [5, 10, 15, 20, 30, 45, 60, 90, 120] as const;

/**
 * Gemini に渡す prompt 文字列を構築する。
 *
 * - 件数は AI の判断に委ねる (ADR 0049: 静的な上下限は持たない)。
 *   章立て / 手順タスク / 旅程など自然な粒度が数十件規模になるケースを許容する。
 *   1 件しか出ないなら「分解不要」として空配列を返させる
 *   (parser 側で 1 件は `skipped` 扱いに倒すフェイルセーフもあるが、prompt でも縛る)
 * - 子タイトルは親文脈なしで読めること、本文に親タスク情報を埋め込んで誘導する
 * - 出力は JSON 配列のみ。markdown fence や説明文が混じっても parser 側で剥がす前提
 */
export function buildDecomposePrompt(parent: DecomposeInput): string {
  const bodyText = parent.body.trim().length > 0 ? parent.body.trim() : "(本文なし)";
  const estimateText = parent.estimatedMinutes !== null ? `${parent.estimatedMinutes}分` : "未設定";
  // ADR 0038 / Issue #169: 親 task_size を prompt に渡し、親の粒度感を AI に伝える。
  // ADR 0053: 子は親より大きい値を付けてよい (cap しない)。
  // 既存タスク・新規分解で親が未設定なら "未設定" として従来 prompt と同等の挙動に倒す。
  const taskSizeText = parent.taskSize ?? "未設定";

  // ADR 0029: siblings が渡されたら「兄弟タスクと同じ粒度感」で分解する誘導文を挿入する。
  // undefined / 空配列なら従来 prompt と同一になる (新規分解への影響をゼロに保つ)。
  const siblingsSection: string[] =
    parent.siblings && parent.siblings.length > 0
      ? [
          "",
          "# 既存の兄弟タスク (これらと同じ粒度感で分解する)",
          ...parent.siblings.map((title) => `- ${title}`),
        ]
      : [];

  return [
    "あなたは個人特化のタスク管理アシスタント。次の親タスクを、実行可能な粒度の子タスクに分解する。",
    "",
    "# 分解の方針",
    "- 子タスクは「自然な単位」で分解する。件数の上限は無く、内容に応じて自分で判断する (章立てがある本なら章単位、複数手順タスクなら手順単位など)。",
    "- 親タスクが既に十分小さく分解の必要がないと判断したら、空配列 [] を返す。",
    "- 各子タスクの title は、親タスクの文脈なしで読んで意味が取れる短い独立した文言にする。",
    "  例 (悪): 「志望動機を書く」 / 例 (良): 「Dirbato 最終面接 志望動機 (パターン A) を書く」",
    `- title は ${MAX_TITLE_LEN} 文字以内。装飾的なプレフィックス (Step 1: 等) は付けない。`,
    `- estimated_minutes は 2 時間以下に収まるタスクの分単位見積もり専用 (ADR 0053)。`,
    `  値は ${ALLOWED_ESTIMATE_BUCKETS.join("/")} のいずれかの整数。`,
    `  task_size が 4h / 1d / large になるタスク (= 2 時間で終わらない) では必ず null を返す。`,
    `  最大バケット 120 にクリップせず、task_size 側で大きさを表現する。`,
    `  ≤ 2h のタスクでも判断に確信が持てない場合は null を返す。`,
    `- body は markdown で ${TARGET_BODY_LEN} 文字程度の実行メモ。実行手順 / 注意点 / 参照リンクなど、`,
    "  着手時に「何を / どうやって」を思い出さなくて済むようにする。",
    "  親 body の内容をそのまま貼らず、その子タスク固有の文脈に絞る。",
    '  特に書くことが無い (title だけで十分) 場合は空文字 "" を返す。',
    "",
    "# task_category の値域 (各子タスクの作業種類)",
    "- coding   : 実装 / バグ修正 / リファクタ / レビュー / セットアップなどコードを書く作業",
    "- doc      : ドキュメント / 議事録 / 設計メモ / レポート / メール / 連絡文を書く作業",
    "- research : 調査 / 比較検討 / 学習 / インタビュー / 仕様読解など情報収集の作業",
    "- admin    : 事務手続き / 経費精算 / 予約 / スケジューリング / 雑務",
    "- other    : 上記いずれにも当てはまらない作業",
    "判断に確信が持てない場合は other を返す。",
    "",
    "# task_size の値域 (各子タスクの粗いサイズ感)",
    "- 15m   : 15 分以内で終わる短作業",
    "- 30m   : 30 分前後の小作業",
    "- 1h    : 1 時間程度のまとまった作業",
    "- 2h    : 2 時間程度の集中作業",
    "- 4h    : 半日 (4 時間) 規模の作業",
    "- 1d    : 1 日 (8 時間) 規模の作業",
    "- large : 1 日では収まらない / さらに分解したほうがよい大物",
    "task_size は分解後の実態に素直に付ける。親より大きい値も付けてよい (ADR 0053)。",
    "(= 親の見積もりが楽観的だったシグナル / 親自身を再分解する余地のシグナル)",
    "判断に確信が持てない場合は null を返す。",
    "estimated_minutes (≤ 2h 専用) と task_size (全 size 帯) は別軸。",
    "task_size は必ず埋める。estimated_minutes が null でも task_size は埋める。",
    "",
    "# 親タスク",
    `title: ${parent.title}`,
    `body: ${bodyText}`,
    `estimated_minutes: ${estimateText}`,
    `task_size: ${taskSizeText}`,
    ...siblingsSection,
    "",
    "# 出力形式",
    "JSON 配列のみを返す。前後に説明文や markdown fence を付けない。",
    "各要素は title / body / estimated_minutes / task_category / task_size の 5 フィールドを持つ。",
    '例: [{"title":"...","body":"- 手順1\\n- 手順2","estimated_minutes":30,"task_category":"coding","task_size":"30m"},{"title":"...","body":"","estimated_minutes":null,"task_category":"research","task_size":null}]',
  ].join("\n");
}

/**
 * Gemini 応答テキストを `DecomposedChild[]` に解釈する。
 *
 * - markdown fence (```json ... ```) を剥がす
 * - JSON 配列以外 / 解釈不能 → `null` (呼び出し側で「失敗」として親を `none` のまま残す)
 * - 空配列 → `[]` (呼び出し側で「分解不要」として親を `skipped` に倒す)
 * - 1 件のみ → `[]` 扱い (実質的な分解になっていないため。ADR 0049 で件数上限は撤廃したが、
 *   この「1 件 → skipped」品質ガードは件数 cap ではないので残す)
 * - title が空 / 80 文字超過 → entry を捨てる (それ以外を採用)
 * - estimated_minutes が許容バケット外 → null に倒す (整数 / null 以外も null)
 *
 * 戻り値:
 *   `null`            : パース不能 (= AI 失敗扱い、`none` のまま残す)
 *   `[]`              : 分解不要 (= `skipped`)
 *   `DecomposedChild[]` (2+ 件): 採用する子配列
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
  }

  // 1 件しか取れなかった = 実質「分解されていない」ので skipped 扱いに倒す。
  // ADR 0017 Decision 4 / vision「気づいたら細かくなってる」と整合させる
  // (1 → 1 の置き換えはユーザーから見て分解が起きたように見えない)。
  // ADR 0049 で「件数の上限」は撤廃したが、この「1 件 → []」は件数 cap ではなく
  // 「実質分解されたか」の品質ガードなので残す。
  if (children.length < 2) return [];

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
  // task_size も同じくフェイルソフト (ADR 0038 §否定的影響)。値域外・欠損は null。
  const taskSize = normalizeSize(obj.task_size);
  // body は欠損 / 型違い → 空文字。長すぎ → 末尾 truncate。空文字を許容する
  // (title だけで十分な子の場合に AI が "" を返す)。
  const body = normalizeBody(obj.body);
  return { title, body, estimatedMinutes: estimate, taskCategory, taskSize };
}

function normalizeBody(raw: unknown): string {
  if (typeof raw !== "string") return "";
  if (raw.length <= MAX_BODY_LEN) return raw;
  return raw.slice(0, MAX_BODY_LEN);
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

/**
 * task_size の値域ガード (ADR 0038 / Issue #169)。
 *
 * - 値域内 (`15m` / `30m` / `1h` / `2h` / `4h` / `1d` / `large`) → そのまま採用
 * - 値域外 / 型違い / 欠損 → null (`other` 相当の握り潰しはしない: ユーザーの主観
 *   シグナルなので「AI が判定不能」と「AI が large と判定」は区別する)
 *
 * 大文字小文字 / 前後空白は許容する (taskCategory と同じ運用)。
 */
function normalizeSize(raw: unknown): TaskSizeValue | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().toLowerCase();
  const found = TASK_SIZE_VALUES.find((v) => v === cleaned);
  return found ?? null;
}
