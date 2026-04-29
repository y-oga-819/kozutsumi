import type { SupabaseClient } from "@supabase/supabase-js";

import { logServerSide } from "@/entities/action-log/server";
import type { DecomposeFailReason } from "@/entities/action-log/types";
import {
  buildDecomposePrompt,
  parseDecomposeResponse,
  type DecomposeInput,
} from "@/shared/ai/prompts/decompose";
import type { Database, Tables, TablesInsert } from "@/shared/types/database";

/**
 * AI タスク分解 (P3-6 / ADR 0017 / 0018 / 0016 / 0021) の server 側 orchestrator。
 *
 * 流れ:
 * 1. 親タスクを userId スコープで取得 (RLS 前提だが defense in depth)。見つからなければ no-op
 * 2. race condition guard: 親が active/paused/done か、既に decomposed/skipped/failed なら no-op
 *    (ADR 0017 Notes: 親 active 化済みは分解対象から外す。冪等性のため重複時もスキップ)
 * 3. 親の decompose_status を `decomposing` に倒す
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
// `failed` も「終端」なので二重分解させない。再実行は詳細パネルから明示的に none → decomposing で行う (ADR 0021)。
const ALREADY_RESOLVED = new Set(["decomposed", "skipped", "failed"]);

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

  // 重複 fire-and-forget や client 側 optimistic ズレに耐えるよう、ここで decomposing に確定させる。
  await setDecomposeStatus(supabase, parent.id, "decomposing");

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
  const childPayloads: TablesInsert<"tasks">[] = parsed.map((child, idx) => ({
    user_id: userId,
    project_id: parent.project_id,
    title: child.title,
    body: child.body,
    estimated_minutes: child.estimatedMinutes,
    task_category: child.taskCategory,
    parent_task_id: parent.id,
    depends_on_event_id: parent.depends_on_event_id,
    stack_order: baseStackOrder + idx,
    decompose_status: "none",
  }));

  const { data: insertedRows, error: insertErr } = await supabase
    .from("tasks")
    .insert(childPayloads)
    .select("id");

  if (insertErr || !insertedRows) {
    console.error("[ai/decompose] child insert failed", insertErr);
    await setDecomposeStatus(supabase, parent.id, "failed");
    await logServerSide(supabase, userId, "task_decompose_failed", {
      task_id: parent.id,
      reason: "insert_failed",
      raw_response: responseText,
      error_message: insertErr?.message,
    });
    return { kind: "failed", reason: "insert_failed" };
  }

  const childIds = insertedRows.map((r) => r.id);

  await setDecomposeStatus(supabase, parent.id, "decomposed");
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
      "id, status, decompose_status, title, body, estimated_minutes, project_id, depends_on_event_id, stack_order",
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

async function setDecomposeStatus(
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
  };
}
