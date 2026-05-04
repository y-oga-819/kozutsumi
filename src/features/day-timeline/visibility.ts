import type { Event } from "@/entities/event/types";

/**
 * Layer 2 (subscription auto_promote) + Layer 3 (event visibility_override) の合成 (ADR 0031 / 0032)。
 *
 * - manual event: visibility_override !== 'hidden' なら表示 (subscription 概念なし)。
 * - google event:
 *   - visibility_override='shown'  → 強制表示
 *   - visibility_override='hidden' → 強制非表示
 *   - visibility_override='none'   → subscription.auto_promote_to_timeline に従う
 *     subscription が見つからない場合は安全側 (hidden) に倒す。unsubscribe 直後の
 *     一瞬の race / orphan event を timeline に乗せないため。
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
  if (!sub) return false;
  return sub.autoPromoteToTimeline;
}

export function filterEventsForTimeline(
  events: readonly Event[],
  subscriptions: SubscriptionVisibility[],
): Event[] {
  return events.filter((e) => isEventVisibleInTimeline(e, subscriptions));
}
