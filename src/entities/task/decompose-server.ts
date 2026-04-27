import type { SupabaseClient } from "@supabase/supabase-js";

import { logServerSide } from "@/entities/action-log/server";
import {
  buildDecomposePrompt,
  parseDecomposeResponse,
  type DecomposeInput,
} from "@/shared/ai/prompts/decompose";
import type { Database, Tables, TablesInsert } from "@/shared/types/database";

/**
 * AI タスク分解 (P3-6) の server 側 orchestrator。
 *
 * 流れ (ADR 0017 / 0018 / 0016):
 * 1. 親タスクを userId スコープで取得 (RLS 前提だが defense in depth)。見つからなければ no-op
 * 2. race condition guard: 親が active/paused/done か、既に decomposed/skipped なら no-op
 *    (ADR 0017 Notes: 親 active 化済みは分解対象から外す。冪等性のため重複時もスキップ)
 * 3. 親の decompose_status を `decomposing` に倒す (client が optimistic に既に倒している
 *    可能性もあるが、server で再確定して fire-and-forget の重複呼びでも壊れないようにする)
 * 4. Gemini に prompt を投げて応答を取る (caller injected `generate` で境界を切る → ユニット可能)
 * 5. parser が null → `none` に戻す (失敗 = 親をそのまま残す)。空配列 → `skipped`
 * 6. children を bulk insert (parent_task_id = parent.id)。project_id / depends_on_event_id を
 *    親から継承、stack_order = parent.stack_order + i で割り当てる (P3-7 の UI が描画分岐する)
 * 7. 親を `decomposed` に倒し、`task_decomposed` action_log を書く
 *
 * 純粋ではないが、Gemini 呼び出しを props で受け取ることでユニットテスト可能にしている。
 * Supabase 周辺は薄ラッパーなのでクエリチェーンを mock することで検証する。
 */

export type DecomposeTaskOutcome =
  | { kind: "decomposed"; childIds: string[] }
  | { kind: "skipped"; reason: SkipReason }
  | { kind: "failed"; reason: FailReason };

type SkipReason =
  | "task_not_found"
  | "parent_active_or_locked" // status=active/paused/done
  | "already_resolved" // decompose_status=decomposed/skipped
  | "ai_decided_not_to_split"; // 空配列 / 1 件

type FailReason = "ai_response_unparseable" | "insert_failed";

export type GenerateFn = (prompt: string) => Promise<string>;

export type DecomposeTaskDeps = {
  supabase: SupabaseClient<Database>;
  userId: string;
  taskId: string;
  generate: GenerateFn;
};

const SKIP_STATUSES = new Set(["active", "paused", "done"]);
const ALREADY_RESOLVED = new Set(["decomposed", "skipped"]);

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

  const prompt = buildDecomposePrompt(toPromptInput(parent));
  const responseText = await generate(prompt);
  const parsed = parseDecomposeResponse(responseText);

  if (parsed === null) {
    // ADR 0013 augmentation only: AI 失敗で core を止めない。none に戻して終わり
    // (再試行は将来 issue。本実装ではユーザーが override で操作する)
    await setDecomposeStatus(supabase, parent.id, "none");
    return { kind: "failed", reason: "ai_response_unparseable" };
  }

  if (parsed.length === 0) {
    await setDecomposeStatus(supabase, parent.id, "skipped");
    return { kind: "skipped", reason: "ai_decided_not_to_split" };
  }

  const baseStackOrder = parent.stack_order ?? 0;
  const childPayloads: TablesInsert<"tasks">[] = parsed.map((child, idx) => ({
    user_id: userId,
    project_id: parent.project_id,
    title: child.title,
    body: "",
    estimated_minutes: child.estimatedMinutes,
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
    await setDecomposeStatus(supabase, parent.id, "none");
    return { kind: "failed", reason: "insert_failed" };
  }

  const childIds = insertedRows.map((r) => r.id);

  await setDecomposeStatus(supabase, parent.id, "decomposed");
  await logServerSide(supabase, userId, "task_decomposed", {
    task_id: parent.id,
    child_ids: childIds,
  });

  return { kind: "decomposed", childIds };
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
