import type { SupabaseClient } from "@supabase/supabase-js";

import { logServerSide } from "@/entities/action-log/server";
import type { DecomposeFailReason } from "@/entities/action-log/types";
import {
  buildDecomposePrompt,
  parseDecomposeResponse,
  type DecomposeInput,
} from "@/shared/ai/prompts/decompose";
import type { Database, Json, Tables } from "@/shared/types/database";

/**
 * AI タスク分解 (P3-6 / ADR 0017 / 0018 / 0016 / 0021 / 0044) の server 側 orchestrator。
 *
 * 流れ:
 * 1. 親タスクを userId スコープで取得 (RLS 前提だが defense in depth)。見つからなければ no-op
 * 2. read 時 fast-exit: 親が active/paused/done か、既に decomposed/skipped なら no-op
 *    (ADR 0017 Notes: 親 active 化済みは分解対象から外す。冪等性のため重複時もスキップ)
 * 3. ADR 0044 の race guard: `tryClaimDecomposing` の条件付き UPDATE で `decompose_status`
 *    を `none|failed → decomposing` に atomic 遷移。0 行更新なら他 fire に負けた / 直前に
 *    decomposed/skipped に確定したケースなので `already_resolved` で skipped に倒す。
 * 4. ここから先は ADR 0021 の不変条件: 「`decomposing` で固まらない」。
 *    すべての失敗経路で parent を必ず終端 status (`failed` / `skipped` / `decomposed`) に倒し、
 *    試行結果を `action_logs` に記録する。
 *
 * 失敗種別の reason は `DecomposeFailReason` (action-log/types) に定義。
 * 例外発生時は `classifyGenerateError` で `error.status` / SDK error 型から分類する。
 */

export type DecomposeTaskOutcome =
  | { kind: "decomposed"; childIds: string[] }
  | { kind: "skipped"; reason: SkipReason }
  | { kind: "failed"; reason: DecomposeFailReason };

type SkipReason =
  | "task_not_found"
  | "parent_active_or_locked" // status=active/paused/done
  | "already_resolved" // decompose_status=decomposed/skipped/failed
  | "ai_decided_not_to_split"; // 空配列 / 1 件

export type GenerateFn = (prompt: string) => Promise<string>;

export type DecomposeTaskDeps = {
  supabase: SupabaseClient<Database>;
  userId: string;
  taskId: string;
  generate: GenerateFn;
};

const SKIP_STATUSES = new Set(["active", "paused", "done"]);
// 終端のうち「再分解しない」ものだけ。`failed` は ADR 0021 §1 で `failed → decomposing` を
// 明示的に許容しているので含めない（詳細パネルの「再実行」ボタンが直接ここを通る）。
const ALREADY_RESOLVED = new Set(["decomposed", "skipped"]);
// claim の allowlist: ここに含まれる pre-state からのみ `decomposing` への遷移を許容する。
// `decomposed` / `skipped` は冪等のため再分解しない。`decomposing` は他 fire の進行中。
const CLAIMABLE_PRE_STATES = ["none", "failed"] as const;

export async function decomposeTask(deps: DecomposeTaskDeps): Promise<DecomposeTaskOutcome> {
  const { supabase, userId, taskId, generate } = deps;

  const parent = await fetchParent(supabase, userId, taskId);
  if (!parent) {
    return { kind: "skipped", reason: "task_not_found" };
  }

  if (SKIP_STATUSES.has(parent.status)) {
    return { kind: "skipped", reason: "parent_active_or_locked" };
  }
  if (ALREADY_RESOLVED.has(parent.decompose_status)) {
    return { kind: "skipped", reason: "already_resolved" };
  }

  // ADR 0044: 条件付き UPDATE で `decomposing` を atomic に claim する。fetchParent との間に
  // concurrent fire が `decomposing` に倒したり decomposed/skipped で確定した場合、claim は
  // 0 行更新で失敗 → skipped/already_resolved に倒し、AI 呼び出しを起こさない。これにより
  // ADR 0021 §1 の不変条件 (decomposing で固まらない) を DB レベルで保証する。
  const claimed = await tryClaimDecomposing(supabase, parent.id);
  if (!claimed) {
    return { kind: "skipped", reason: "already_resolved" };
  }

  try {
    return await runDecompose(supabase, userId, parent, generate);
  } catch (error) {
    // Last-resort safety net (ADR 0021): runDecompose が想定外に throw しても
    // parent を `decomposing` で固まらせない。internal_error として終端に倒す。
    console.error("[ai/decompose] unexpected error", error);
    await setDecomposeStatus(supabase, parent.id, "failed");
    await logServerSide(supabase, userId, "task_decompose_failed", {
      task_id: parent.id,
      reason: "internal_error",
      error_message: error instanceof Error ? error.message : String(error),
    });
    return { kind: "failed", reason: "internal_error" };
  }
}

async function runDecompose(
  supabase: SupabaseClient<Database>,
  userId: string,
  parent: ParentRow,
  generate: GenerateFn,
): Promise<DecomposeTaskOutcome> {
  let responseText: string;
  try {
    const prompt = buildDecomposePrompt(toPromptInput(parent));
    responseText = await generate(prompt);
  } catch (error) {
    const reason = classifyGenerateError(error);
    console.error("[ai/decompose] generate failed", { reason, error });
    await setDecomposeStatus(supabase, parent.id, "failed");
    await logServerSide(supabase, userId, "task_decompose_failed", {
      task_id: parent.id,
      reason,
      error_message: error instanceof Error ? error.message : String(error),
    });
    return { kind: "failed", reason };
  }

  const parsed = parseDecomposeResponse(responseText);

  if (parsed === null) {
    await setDecomposeStatus(supabase, parent.id, "failed");
    await logServerSide(supabase, userId, "task_decompose_failed", {
      task_id: parent.id,
      reason: "ai_response_unparseable",
      raw_response: responseText,
    });
    return { kind: "failed", reason: "ai_response_unparseable" };
  }

  if (parsed.length === 0) {
    await setDecomposeStatus(supabase, parent.id, "skipped");
    await logServerSide(supabase, userId, "task_decompose_skipped", {
      task_id: parent.id,
      raw_response: responseText,
    });
    return { kind: "skipped", reason: "ai_decided_not_to_split" };
  }

  const baseStackOrder = parent.stack_order ?? 0;
  // 子の task_category は decompose プロンプトが同時推論する (ADR 0022 Decision 2)。
  // categorize の fan-out を避けることで 1 親あたりの Gemini 呼び出しを最大 2 回に固定する。
  const newChildren: Json = parsed.map((child) => ({
    title: child.title,
    body: child.body,
    estimated_minutes: child.estimatedMinutes,
    task_category: child.taskCategory,
    // ADR 0038 / Issue #169: AI が推定した主観サイズ。fn_decompose_parent_task が
    // tasks.task_size 列に保存する (値域外 / null は parser 側で null に倒している)。
    task_size: child.taskSize,
  }));

  // ADR 0021 / Issue #150: 子 insert + 親 decompose_status 更新を 1 トランザクションで行う。
  // 旧実装は 2 クエリに分かれており、子 insert 成功後の status 更新失敗 (接続断 / タイムアウト)
  // で親が `decomposing` で固まる経路があった。RPC 化することで中間 failure を構造的に消す。
  // RPC が error を返す / throw した場合は orchestrator 側 (catch / 後段) で `failed` に倒す。
  const { data: childIds, error: rpcError } = await supabase.rpc("fn_decompose_parent_task", {
    p_parent_id: parent.id,
    p_base_stack_order: baseStackOrder,
    p_new_children: newChildren,
  });

  if (rpcError || !childIds || childIds.length === 0) {
    console.error("[ai/decompose] rpc failed", rpcError);
    await setDecomposeStatus(supabase, parent.id, "failed");
    await logServerSide(supabase, userId, "task_decompose_failed", {
      task_id: parent.id,
      reason: "insert_failed",
      raw_response: responseText,
      error_message: rpcError?.message,
    });
    return { kind: "failed", reason: "insert_failed" };
  }

  await logServerSide(supabase, userId, "task_decomposed", {
    task_id: parent.id,
    child_ids: childIds,
    raw_response: responseText,
  });

  return { kind: "decomposed", childIds };
}

/**
 * Gemini 呼び出しの throw を ADR 0021 の reason 値域に分類する。
 *
 * - 429 (RESOURCE_EXHAUSTED) → quota_exhausted
 * - 5xx / network / timeout → upstream_unavailable
 * - それ以外 → internal_error
 *
 * `@google/generative-ai` SDK の `GoogleGenerativeAIFetchError` は `status` プロパティに
 * HTTP status を持つので、まずそれで判定する。fetch failed / AbortError 等は Error の
 * name / message から拾う。ここでは特定 SDK に強く依存しないよう duck-typing する。
 */
export function classifyGenerateError(error: unknown): DecomposeFailReason {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") {
      if (status === 429) return "quota_exhausted";
      if (status >= 500 && status < 600) return "upstream_unavailable";
    }
  }
  if (error instanceof Error) {
    if (error.name === "AbortError" || error.name === "TimeoutError") {
      return "upstream_unavailable";
    }
    if (/fetch failed|network|timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND/i.test(error.message)) {
      return "upstream_unavailable";
    }
  }
  return "internal_error";
}

type ParentRow = Pick<
  Tables<"tasks">,
  | "id"
  | "status"
  | "decompose_status"
  | "title"
  | "body"
  | "estimated_minutes"
  | "task_size"
  | "project_id"
  | "depends_on_event_id"
  | "stack_order"
>;

async function fetchParent(
  supabase: SupabaseClient<Database>,
  userId: string,
  taskId: string,
): Promise<ParentRow | null> {
  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, status, decompose_status, title, body, estimated_minutes, task_size, project_id, depends_on_event_id, stack_order",
    )
    .eq("id", taskId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[ai/decompose] parent fetch failed", error);
    return null;
  }
  return (data as ParentRow | null) ?? null;
}

/**
 * ADR 0044: `decompose_status` を `none|failed → decomposing` に atomic 遷移させる。
 *
 * `.in("decompose_status", CLAIMABLE_PRE_STATES)` で pre-state を allowlist 制約することで:
 * - 並行 fire との TOCTOU race window を閉じる (後勝ち 1 本だけが claim 成功)
 * - fetchParent 後に decomposed/skipped に確定したケースも 0 行更新で吸収
 *
 * 0 行更新 (data === null) → claim 失敗 → orchestrator は skipped/already_resolved に倒す。
 * supabase error は safe-side に倒して `false` を返す (ADR 0013 augmentation only)。
 *
 * resplit-server.ts の `tryClaimDecomposing` (ADR 0027) と同じ pattern を共有するが、
 * 当該 server は `.neq("decomposing")` で「進行中以外なら claim」を許す (resplit はユーザー
 * 明示クリック起動なので decomposed/skipped/failed → 再分解を許容)。decompose は auto 起動
 * のため `none|failed` だけに絞る点が異なる (ADR 0044: guard 述語は機能ごとに別)。
 */
async function tryClaimDecomposing(
  supabase: SupabaseClient<Database>,
  taskId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("tasks")
    .update({ decompose_status: "decomposing" })
    .eq("id", taskId)
    .in("decompose_status", [...CLAIMABLE_PRE_STATES])
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[ai/decompose] claim decomposing failed", error);
    return false;
  }
  return data !== null;
}

/**
 * `tasks.decompose_status` を更新する低レベル helper。
 *
 * resplit-server.ts (子の再分解、ADR 0027) でも同じ書き込みパスを共有するために export する。
 * 失敗時は console.error に留め、呼び出し元のロジックは止めない (ADR 0021 の不変条件:
 * 親 / 子は終端 status に必ず倒すが、その「倒す」操作自体が失敗しても last-resort safety
 * net で internal_error 経路に流す前提)。
 */
export async function setDecomposeStatus(
  supabase: SupabaseClient<Database>,
  taskId: string,
  status: Tables<"tasks">["decompose_status"],
): Promise<void> {
  const { error } = await supabase
    .from("tasks")
    .update({ decompose_status: status })
    .eq("id", taskId);
  if (error) {
    console.error("[ai/decompose] decompose_status update failed", error);
  }
}

function toPromptInput(row: ParentRow): DecomposeInput {
  return {
    title: row.title,
    body: row.body,
    estimatedMinutes: row.estimated_minutes,
    taskSize: row.task_size,
  };
}
