import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildCompleteCriteriaPrompt,
  parseCompleteCriteriaResponse,
} from "@/shared/ai/prompts/complete-criteria";
import type { Database, Tables } from "@/shared/types/database";

/**
 * AI 後追い完了条件補完 (#245 / ADR 0064 / 0066 / 0067) の server 側 orchestrator。
 *
 * title 必須のみで投入されたタスク (ADR 0064) の完了条件 (deliverable / done /
 * first_step) を、AI が後追いで埋める。発火は timer 文脈外 (タスク詳細画面の閲覧時 /
 * 朝の棚卸し, ADR 0064 Decision 3)。本関数は 1 タスク単位で動くので、朝の棚卸しの
 * バッチ補完は呼び出し側が task ごとに繰り返す形で再利用できる。
 *
 * 流れ (categorize-server.ts と同じ「AI 初期値の後追い埋め」pattern):
 * 1. 対象タスクを userId スコープで取得 (RLS 前提だが defense in depth)
 * 2. eligibility guard:
 *    - status が active / paused → timer 文脈なので補完しない (ADR 0058)
 *    - status が done → 完了済みタスクに補完する価値がない
 *    - decompose_status が decomposing → ADR 0067 Decision 5 のロック対象。分解が
 *      決着すれば親 (decomposed) か leaf に確定するので、それまで待つ
 *    - decompose_status が decomposed → 親。子が完了条件を持つ (ADR 0066) ので
 *      親自身は補完しない
 * 3. 3 項目すべて埋まっていれば skipped (補完不要 + AI 呼び出しを節約)
 * 4. prompt 組み立て → generate (AI 呼び出し) → parse
 * 5. 競合解決 (ADR 0067 Decision 5): **未補完フィールドのみ書く**。fetch 時点で
 *    空文字だった列に対し `<column> = ''` ガード付きの条件付き UPDATE を投げる。
 *    ユーザーが手動入力した値 (AI 応答中の race 含む) は 0 行更新で保護される。
 *
 * action_log は記録しない。`task_category` の AI 初期ラベリング (categorize-server)
 * と同じく「気づいたら埋まっている」体験であり、行動データではない。完了条件の
 * 行動シグナルはユーザー編集 (TASK 詳細パネル経由) 側で別途扱う。
 *
 * 失敗 / quota / 解釈不能 / DB エラー、いずれも throw せず outcome として返す
 * (Route Handler 側は fire-and-forget client への 200 応答で outcome を握り潰す)。
 */

/** ADR 0066 の完了条件 3 列。fetch / 条件付き UPDATE で使う tasks の列名。 */
type CriterionColumn = "deliverable" | "done" | "first_step";

const CRITERION_COLUMNS: readonly CriterionColumn[] = ["deliverable", "done", "first_step"];

export type CompleteCriteriaOutcome =
  | { kind: "completed"; filled: CriterionColumn[] }
  | { kind: "skipped"; reason: SkipReason }
  | { kind: "failed"; reason: FailReason };

type SkipReason =
  | "task_not_found"
  | "not_eligible" // status=active/paused/done または decompose_status=decomposing/decomposed
  | "already_complete" // 3 項目すべて埋まっている (race で他経路に埋められたケース含む)
  | "ai_returned_empty"; // AI が未補完項目をどれも言語化できなかった

type FailReason = "ai_response_unparseable" | "generate_failed" | "update_failed";

export type GenerateFn = (prompt: string) => Promise<string>;

export type CompleteCriteriaDeps = {
  supabase: SupabaseClient<Database>;
  userId: string;
  taskId: string;
  generate: GenerateFn;
};

const NOT_ELIGIBLE_STATUSES = new Set(["active", "paused", "done"]);
const NOT_ELIGIBLE_DECOMPOSE_STATUSES = new Set(["decomposing", "decomposed"]);

export async function completeTaskCriteria(
  deps: CompleteCriteriaDeps,
): Promise<CompleteCriteriaOutcome> {
  const { supabase, userId, taskId, generate } = deps;

  const target = await fetchTask(supabase, userId, taskId);
  if (!target) {
    return { kind: "skipped", reason: "task_not_found" };
  }

  if (
    NOT_ELIGIBLE_STATUSES.has(target.status) ||
    NOT_ELIGIBLE_DECOMPOSE_STATUSES.has(target.decompose_status)
  ) {
    return { kind: "skipped", reason: "not_eligible" };
  }

  if (CRITERION_COLUMNS.every((col) => target[col] !== "")) {
    // 3 項目すべて埋まっている → AI を呼ばずに終わる (quota / latency 節約)。
    return { kind: "skipped", reason: "already_complete" };
  }

  let responseText: string;
  try {
    const prompt = buildCompleteCriteriaPrompt({
      title: target.title,
      body: target.body,
      estimatedMinutes: target.estimated_minutes,
      taskSize: target.task_size,
    });
    responseText = await generate(prompt);
  } catch (error) {
    console.error("[ai/complete-criteria] generate failed", error);
    return { kind: "failed", reason: "generate_failed" };
  }

  const parsed = parseCompleteCriteriaResponse(responseText);
  if (parsed === null) {
    return { kind: "failed", reason: "ai_response_unparseable" };
  }

  const aiByColumn: Record<CriterionColumn, string> = {
    deliverable: parsed.deliverable,
    done: parsed.done,
    first_step: parsed.firstStep,
  };
  // fetch 時点で空 かつ AI が非空を返した列だけ補完対象にする (未補完フィールドのみ書く)。
  const toFill = CRITERION_COLUMNS.filter((col) => target[col] === "" && aiByColumn[col] !== "");
  if (toFill.length === 0) {
    return { kind: "skipped", reason: "ai_returned_empty" };
  }

  const filled: CriterionColumn[] = [];
  for (const col of toFill) {
    const result = await fillCriterion(supabase, userId, taskId, col, aiByColumn[col]);
    if (result === "error") {
      return { kind: "failed", reason: "update_failed" };
    }
    if (result === "filled") {
      filled.push(col);
    }
  }

  // 全列が 0 行更新 = AI 応答中にユーザーが全項目を手動入力した (race)。already_complete 扱い。
  if (filled.length === 0) {
    return { kind: "skipped", reason: "already_complete" };
  }

  return { kind: "completed", filled };
}

/**
 * 完了条件 1 列を `<column> = ''` ガード付きで条件付き UPDATE する (ADR 0067 Decision 5)。
 *
 * 0 行更新 (data === null) は「AI 応答中にユーザーが当該列を手動入力した」race。
 * ユーザーの値を保護して上書きしない (`"noop"` を返す)。
 */
async function fillCriterion(
  supabase: SupabaseClient<Database>,
  userId: string,
  taskId: string,
  column: CriterionColumn,
  value: string,
): Promise<"filled" | "noop" | "error"> {
  const patch = { [column]: value } as Database["public"]["Tables"]["tasks"]["Update"];
  const { data, error } = await supabase
    .from("tasks")
    .update(patch)
    .eq("id", taskId)
    .eq("user_id", userId)
    .eq(column, "")
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[ai/complete-criteria] update failed", { column, error });
    return "error";
  }
  return data !== null ? "filled" : "noop";
}

type TaskRow = Pick<
  Tables<"tasks">,
  | "id"
  | "status"
  | "decompose_status"
  | "title"
  | "body"
  | "estimated_minutes"
  | "task_size"
  | "deliverable"
  | "done"
  | "first_step"
>;

async function fetchTask(
  supabase: SupabaseClient<Database>,
  userId: string,
  taskId: string,
): Promise<TaskRow | null> {
  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, status, decompose_status, title, body, estimated_minutes, task_size, deliverable, done, first_step",
    )
    .eq("id", taskId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[ai/complete-criteria] task fetch failed", error);
    return null;
  }
  return (data as TaskRow | null) ?? null;
}
