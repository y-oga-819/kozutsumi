import type { SupabaseClient } from "@supabase/supabase-js";

import { buildCategorizePrompt, parseCategorizeResponse } from "@/shared/ai/prompts/categorize";
import type { Database, Tables } from "@/shared/types/database";

/**
 * AI タスク分類 (P3-4 / ADR 0015 / 0013) の server 側 orchestrator。
 *
 * 流れ:
 * 1. 対象タスクを userId スコープで取得 (RLS 前提だが defense in depth)
 * 2. race condition guard:
 *    - 既に `task_category` が埋まっている → AI が後追いで上書きしない
 *      (人間 override / 別経路 backfill が先に書いた可能性)
 *    - parent_task_id が null でなく title が AI 分解で生成された子タスク
 *      の場合も同経路で分類して構わないのでスキップしない
 * 3. prompt 組み立て → generate (AI 呼び出し) → parse
 * 4. 解釈成功 (`coding` / `doc` / ...) → `tasks.task_category` に UPDATE
 *    解釈失敗 (null) → 何も書かない (null のまま残す。ADR 0013 augmentation only)
 *
 * action_log 記録は **しない**。`task_category_changed` は人間 override 専用
 * (ADR 0015 Decision 4 / action-log/types.ts の metadata 注釈)。
 * AI の初期ラベリングは「気づいたら埋まっている」体験で、行動データではない。
 *
 * 失敗 / quota / 解釈不能 / 解釈成功後の DB エラー、いずれも throw せず outcome として返す。
 * Route Handler 側は outcome を握り潰す前提 (fire-and-forget client への 200 応答)。
 */

export type CategorizeTaskOutcome =
  | { kind: "categorized"; category: TaskCategory }
  | { kind: "skipped"; reason: SkipReason }
  | { kind: "failed"; reason: FailReason };

type TaskCategory = NonNullable<Tables<"tasks">["task_category"]>;

type SkipReason = "task_not_found" | "already_categorized"; // 既に値が入っている (人間 override 等)

type FailReason = "ai_response_unparseable" | "update_failed" | "generate_failed"; // AI 呼び出し自体が throw

export type GenerateFn = (prompt: string) => Promise<string>;

export type CategorizeTaskDeps = {
  supabase: SupabaseClient<Database>;
  userId: string;
  taskId: string;
  generate: GenerateFn;
};

export async function categorizeTask(deps: CategorizeTaskDeps): Promise<CategorizeTaskOutcome> {
  const { supabase, userId, taskId, generate } = deps;

  const target = await fetchTask(supabase, userId, taskId);
  if (!target) {
    return { kind: "skipped", reason: "task_not_found" };
  }

  if (target.task_category !== null) {
    return { kind: "skipped", reason: "already_categorized" };
  }

  let responseText: string;
  try {
    const prompt = buildCategorizePrompt({ title: target.title, body: target.body });
    responseText = await generate(prompt);
  } catch (error) {
    console.error("[ai/categorize] generate failed", error);
    return { kind: "failed", reason: "generate_failed" };
  }

  const parsed = parseCategorizeResponse(responseText);
  if (parsed === null) {
    return { kind: "failed", reason: "ai_response_unparseable" };
  }

  // race condition: AI が応答を返している間に人間 override が走った可能性を最終チェック。
  // `task_category IS NULL` でガードした条件付き UPDATE を投げ、上書きしない。
  const { data: updated, error } = await supabase
    .from("tasks")
    .update({ task_category: parsed })
    .eq("id", taskId)
    .eq("user_id", userId)
    .is("task_category", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[ai/categorize] update failed", error);
    return { kind: "failed", reason: "update_failed" };
  }

  // フィルタにマッチせず 0 行更新 (= 直前に人間 override が確定) も skipped 扱い。
  if (!updated) {
    return { kind: "skipped", reason: "already_categorized" };
  }

  return { kind: "categorized", category: parsed };
}

type TaskRow = Pick<Tables<"tasks">, "id" | "title" | "body" | "task_category">;

async function fetchTask(
  supabase: SupabaseClient<Database>,
  userId: string,
  taskId: string,
): Promise<TaskRow | null> {
  const { data, error } = await supabase
    .from("tasks")
    .select("id, title, body, task_category")
    .eq("id", taskId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[ai/categorize] task fetch failed", error);
    return null;
  }
  return (data as TaskRow | null) ?? null;
}
