import type { Event } from "@/entities/event/types";

/**
 * Layer 2 (subscription auto_promote) + Layer 3 (event visibility_override) の合成 (ADR 0031 / 0032)。
 *
 * - manual event: visibility_override !== 'hidden' なら表示 (subscription 概念なし)。
 * - google event:
 *   - visibility_override='shown'  → 強制表示
 *   - visibility_override='hidden' → 強制非表示
 *   - visibility_override='none'   → subscription.auto_promote_to_timeline に従う
 *     subscription が見つからない場合は表示する。理由: ADR 0034 の unsubscribe フローは
 *     「events 物理削除 → subscription 削除」の順なので、events 行が残っていて subscription が
 *     無い状態は通常起こらない。発生する経路は test fixture / migration 等の外側からの
 *     直接挿入で、その場合は events 行が DB に存在する事実を尊重して表示する方が予測しやすい。
 */
export type SubscriptionVisibility = {
  source: string;
  externalCalendarId: string;
  autoPromoteToTimeline: boolean;
};

export function isEventVisibleInTimeline(
  event: Event,
  subscriptions: SubscriptionVisibility[],
): boolean {
  if (event.visibilityOverride === "hidden") return false;
  if (event.visibilityOverride === "shown") return true;

  if (event.source === "manual") return true;

  const sub = subscriptions.find(
    (s) => s.source === event.source && s.externalCalendarId === event.externalCalendarId,
  );
  // subscription 不在は normal flow では起こらないため、events 行が DB にある事実を尊重して表示する。
  if (!sub) return true;
  return sub.autoPromoteToTimeline;
}

export function filterEventsForTimeline(
  events: readonly Event[],
  subscriptions: SubscriptionVisibility[],
): Event[] {
  return events.filter((e) => isEventVisibleInTimeline(e, subscriptions));
}
