import type { SupabaseClient } from "@supabase/supabase-js";

import { logServerSide } from "@/entities/action-log/server";
import type { DecomposeFailReason } from "@/entities/action-log/types";
import {
  buildDecomposePrompt,
  parseDecomposeResponse,
  type DecomposeInput,
} from "@/shared/ai/prompts/decompose";
import type { Database, Json, Tables } from "@/shared/types/database";

import { classifyGenerateError, setDecomposeStatus, type GenerateFn } from "./decompose-server";

/**
 * AI タスク再分解 (子の resplit, ADR 0027 / 0028 / 0029 / 0030 / Issue #121) の
 * server 側 orchestrator。
 *
 * 流れ:
 * 1. 対象の子タスクを userId スコープで取得
 * 2. race condition guard:
 *    - parent_task_id が null (= 親自身、子ではない) → skipped
 *    - status が active/paused/done → 着手済みのため再分解しない
 *    - decompose_status が decomposing → 既に進行中。レース回避
 *    (none / failed で許可。decomposed / skipped は子としては想定外だが防御的に許可)
 * 3. 兄弟 title を取得 (target 自身は除外、ADR 0029 のフェイルソフト)
 * 4. target.decompose_status を decomposing に倒す (ADR 0021 の不変条件踏襲)
 * 5. prompt 組み立て (siblings を渡す、ADR 0029) → generate → parse
 * 6. parse 不能 → failed、AI が空配列 / 1 件 → skipped
 * 7. fn_resplit_child_task RPC で delete + insert + reorder を atomic 実行 (ADR 0028)
 * 8. action_log に task_child_resplit を記録 (ADR 0030)。
 *    column.task_id は新規子のうち先頭、metadata.resplit_target_snapshot は削除直前の target
 *
 * 失敗時のハンドリングは ADR 0021 を踏襲する (HC-5):
 *   parse 失敗 / quota / network / rpc 失敗 → target を failed に倒し
 *   `task_decompose_failed` を action_log に記録 (新 action_type は作らない)。
 *   想定外 throw → last-resort safety net で internal_error 経路に流す。
 */

export type ResplitChildTaskOutcome =
  | { kind: "resplit_succeeded"; newChildIds: string[] }
  | { kind: "skipped"; reason: ResplitSkipReason }
  | { kind: "failed"; reason: DecomposeFailReason };

type ResplitSkipReason =
  | "task_not_found"
  | "no_parent"
  | "child_active_or_locked"
  | "already_decomposing"
  | "ai_decided_not_to_split";

export type ResplitChildTaskDeps = {
  supabase: SupabaseClient<Database>;
  userId: string;
  taskId: string;
  generate: GenerateFn;
};

const SKIP_STATUSES = new Set(["active", "paused", "done"]);

export async function resplitChildTask(
  deps: ResplitChildTaskDeps,
): Promise<ResplitChildTaskOutcome> {
  const { supabase, userId, taskId, generate } = deps;

  const target = await fetchTarget(supabase, userId, taskId);
  if (!target) {
    return { kind: "skipped", reason: "task_not_found" };
  }
  if (target.parent_task_id === null) {
    return { kind: "skipped", reason: "no_parent" };
  }
  if (SKIP_STATUSES.has(target.status)) {
    return { kind: "skipped", reason: "child_active_or_locked" };
  }
  if (target.decompose_status === "decomposing") {
    return { kind: "skipped", reason: "already_decomposing" };
  }

  // 兄弟 title 取得 (ADR 0029)。partial failure でも空配列で続行
  const siblings = await fetchSiblings(supabase, userId, target.parent_task_id, target.id);

  // 条件付き update で「decomposing への遷移を排他的に主張」する (race window 対策)。
  // fetchTarget → setDecomposeStatus の TOCTOU 間に同じ taskId への 2 重 click が来ても、
  // 後勝ちの 1 本だけが先に進み、もう 1 本は already_decomposing で skipped に倒す。
  // これにより 1 本目成功後の 2 本目が target_not_found 経由の spurious failed log を
  // action_logs に残すノイズ (HC-4 学習素材の品質劣化) を防ぐ。
  const claimed = await tryClaimDecomposing(supabase, target.id);
  if (!claimed) {
    return { kind: "skipped", reason: "already_decomposing" };
  }

  try {
    return await runResplit(supabase, userId, target, siblings, generate);
  } catch (error) {
    // Last-resort safety net (ADR 0021): runResplit が想定外に throw しても target を
    // `decomposing` で固まらせない。rpc が delete 後に throw すると target row 自体が
    // 既に存在しないため update は no-op になるが、それでも明示的に発火する。
    console.error("[ai/resplit] unexpected error", error);
    await setDecomposeStatus(supabase, target.id, "failed");
    await logServerSide(supabase, userId, "task_decompose_failed", {
      task_id: target.id,
      reason: "internal_error",
      error_message: error instanceof Error ? error.message : String(error),
    });
    return { kind: "failed", reason: "internal_error" };
  }
}

type TargetRow = Pick<
  Tables<"tasks">,
  | "id"
  | "status"
  | "decompose_status"
  | "title"
  | "body"
  | "estimated_minutes"
  | "task_category"
  | "parent_task_id"
  | "stack_order"
  | "created_at"
>;

async function runResplit(
  supabase: SupabaseClient<Database>,
  userId: string,
  target: TargetRow,
  siblings: string[],
  generate: GenerateFn,
): Promise<ResplitChildTaskOutcome> {
  let responseText: string;
  try {
    const prompt = buildDecomposePrompt(toPromptInput(target, siblings));
    responseText = await generate(prompt);
  } catch (error) {
    const reason = classifyGenerateError(error);
    console.error("[ai/resplit] generate failed", { reason, error });
    await setDecomposeStatus(supabase, target.id, "failed");
    await logServerSide(supabase, userId, "task_decompose_failed", {
      task_id: target.id,
      reason,
      error_message: error instanceof Error ? error.message : String(error),
    });
    return { kind: "failed", reason };
  }

  const parsed = parseDecomposeResponse(responseText);

  if (parsed === null) {
    await setDecomposeStatus(supabase, target.id, "failed");
    await logServerSide(supabase, userId, "task_decompose_failed", {
      task_id: target.id,
      reason: "ai_response_unparseable",
      raw_response: responseText,
    });
    return { kind: "failed", reason: "ai_response_unparseable" };
  }

  if (parsed.length === 0) {
    // ADR 0030: AI が「再分解の必要なし」と判断したケース。target は元のまま残し
    // decompose_status を skipped に倒す (parser 仕様で 1 件返答も [] 扱い)。
    await setDecomposeStatus(supabase, target.id, "skipped");
    await logServerSide(supabase, userId, "task_decompose_skipped", {
      task_id: target.id,
      raw_response: responseText,
    });
    return { kind: "skipped", reason: "ai_decided_not_to_split" };
  }

  const baseStackOrder = target.stack_order ?? 0;
  const shiftAmount = parsed.length - 1;

  const newChildren: Json = parsed.map((c) => ({
    title: c.title,
    body: c.body,
    estimated_minutes: c.estimatedMinutes,
    task_category: c.taskCategory,
  }));

  // ADR 0028 / 0030: rpc で delete + insert + reorder を atomic 実行する。
  // target.parent_task_id は guard 通過時点で non-null だが、TypeScript には narrow されないため
  // ! で明示する (実行時には必ず string)。
  const { data: newChildIds, error: rpcError } = await supabase.rpc("fn_resplit_child_task", {
    p_target_id: target.id,
    p_parent_id: target.parent_task_id as string,
    p_base_stack_order: baseStackOrder,
    p_shift_amount: shiftAmount,
    p_new_children: newChildren,
  });

  if (rpcError || !newChildIds || newChildIds.length === 0) {
    console.error("[ai/resplit] rpc failed", rpcError);
    await setDecomposeStatus(supabase, target.id, "failed");
    await logServerSide(supabase, userId, "task_decompose_failed", {
      task_id: target.id,
      reason: "insert_failed",
      raw_response: responseText,
      error_message: rpcError?.message,
    });
    return { kind: "failed", reason: "insert_failed" };
  }

  // ADR 0030: column.task_id は新規子のうち先頭 (= 主体行)。
  // metadata.resplit_target_snapshot は削除直前の target。Phase 4 の暗黙フィードバック
  // 分析で「ユーザーが粒度を変えた」シグナル + dangling task_id 解決のために inline 保存する。
  await logServerSide(supabase, userId, "task_child_resplit", {
    task_id: newChildIds[0],
    parent_id: target.parent_task_id as string,
    resplit_target_snapshot: {
      id: target.id,
      title: target.title,
      body: target.body,
      estimated_minutes: target.estimated_minutes,
      task_category: target.task_category,
      created_at: target.created_at,
    },
    new_child_ids: newChildIds,
    raw_response: responseText,
  });

  return { kind: "resplit_succeeded", newChildIds };
}

/**
 * `decompose_status='decomposing'` への条件付き遷移を試みる (Issue #121 race 対策)。
 *
 * 既に `decomposing` の row には update が一致しないので 0 行更新になり、`null` を返す。
 * これにより 2 重 click や fire-and-forget 経路の重複起動でも、orchestrator は 1 本だけ
 * 実 AI 経路に進める。setDecomposeStatus と違って「無条件に上書き」ではなく「レース時の
 * 排他主張」を担う。
 *
 * 失敗 (例外 / supabase error) は `false` で握って safe-side に倒す。orchestrator は skipped
 * を返し core 操作には影響を与えない (ADR 0013 augmentation only)。
 */
async function tryClaimDecomposing(
  supabase: SupabaseClient<Database>,
  taskId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("tasks")
    .update({ decompose_status: "decomposing" })
    .eq("id", taskId)
    .neq("decompose_status", "decomposing")
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[ai/resplit] claim decomposing failed", error);
    return false;
  }
  return data !== null;
}

async function fetchTarget(
  supabase: SupabaseClient<Database>,
  userId: string,
  taskId: string,
): Promise<TargetRow | null> {
  const { data, error } = await supabase
    .from("tasks")
    .select(
      "id, status, decompose_status, title, body, estimated_minutes, task_category, parent_task_id, stack_order, created_at",
    )
    .eq("id", taskId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[ai/resplit] target fetch failed", error);
    return null;
  }
  return (data as TargetRow | null) ?? null;
}

/**
 * 同一親内の兄弟 title を取得する (target 自身は除外、stack_order 昇順)。
 * 失敗時は空配列を返す (ADR 0029: フェイルソフトで AI 呼び出しを止めない)。
 */
async function fetchSiblings(
  supabase: SupabaseClient<Database>,
  userId: string,
  parentId: string,
  excludeId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("tasks")
    .select("title")
    .eq("user_id", userId)
    .eq("parent_task_id", parentId)
    .neq("id", excludeId)
    .order("stack_order", { ascending: true, nullsFirst: false });

  if (error || !data) {
    console.error("[ai/resplit] siblings fetch failed (continuing without siblings)", error);
    return [];
  }
  return data.map((r) => r.title);
}

function toPromptInput(target: TargetRow, siblings: string[]): DecomposeInput {
  return {
    title: target.title,
    body: target.body,
    estimatedMinutes: target.estimated_minutes,
    siblings: siblings.length > 0 ? siblings : undefined,
  };
}
