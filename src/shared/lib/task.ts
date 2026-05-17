import type { Task } from "@/entities/task/types";

export function isDone(task: Task): boolean {
  return task.status === "done";
}

/**
 * AI 後追い完了条件補完 (#245, ADR 0064 / 0066 / 0067) を詳細画面の閲覧時に
 * fire してよいかの判定。`/api/ai/complete-criteria` を叩く前の client 側ガード
 * (server 側 `completeTaskCriteria` も同等の guard を持つ defense in depth)。
 *
 * - timer 文脈 (active / paused) と完了済み (done) は対象外 (ADR 0058: timer 中の
 *   AI 介入禁止)。
 * - 分解中 (decomposing) は ADR 0067 Decision 5 のロック対象。分解が決着すれば
 *   親 (decomposed) か leaf に確定するので、それまで補完を待つ。
 * - decomposed の親は子が完了条件を持つ (ADR 0066) ので親自身は補完しない。
 * - 3 項目すべて埋まっていれば補完不要。1 つでも未補完なら対象。
 */
export function isCompletionCriteriaEligible(task: Task): boolean {
  if (task.status !== "idle") return false;
  if (task.decomposeStatus === "decomposing" || task.decomposeStatus === "decomposed") {
    return false;
  }
  return task.deliverable === "" || task.done === "" || task.firstStep === "";
}
