import type { Event } from "@/entities/event/types";
import type { SubscriptionVisibility } from "@/features/day-timeline/visibility";

/**
 * 1 event の effective visibility 状態 (Issue #145 / ADR 0031 Layer 2 + Layer 3)。
 *
 * 予定管理ページ / SettingsPanel override 一覧 / EventDetailPanel が共通で参照する
 * 計算層。purely functional に保ち、`SubscriptionVisibility[]` のみ依存させる。
 */
export type EventVisibilityState = {
  /** 現状の `visibility_override` 値 (DB の生値)。 */
  override: Event["visibilityOverride"];
  /** subscription を引いて、override が 'none' の場合に default で表示されるかを示す。 */
  subscriptionAutoPromote: boolean;
  /** 最終的に DayTimeline / TimelineBar に出るか (override + auto_promote 合成結果)。 */
  effectiveShown: boolean;
  /**
   * ユーザーが default に逆らって override しているか (`is_override_of_default`)。
   * Phase 4 学習素材として action_log 側でも記録する核シグナル (ADR 0035)。
   */
  isOverrideOfDefault: boolean;
};

export function computeEventVisibilityState(
  event: Pick<Event, "source" | "externalCalendarId" | "visibilityOverride">,
  subscriptions: readonly SubscriptionVisibility[],
): EventVisibilityState {
  // manual event は subscription を持たないが、ADR 0032 で visibility_override は持つ。
  // default は表示なので auto_promote=true 相当として扱う。
  let subscriptionAutoPromote = true;
  if (event.source !== "manual") {
    const sub = subscriptions.find(
      (s) => s.source === event.source && s.externalCalendarId === event.externalCalendarId,
    );
    // subscription が見つからない (orphan) のは異常系。visibility.ts と同じく events 行を尊重して
    // 表示扱いにする (auto_promote=true 相当)。
    subscriptionAutoPromote = sub ? sub.autoPromoteToTimeline : true;
  }

  const effectiveShown =
    event.visibilityOverride === "shown"
      ? true
      : event.visibilityOverride === "hidden"
        ? false
        : subscriptionAutoPromote;

  // ユーザーが default を変えた状態かどうか:
  //   - 'shown' override かつ default が hidden (auto_promote=false) → 逸脱
  //   - 'hidden' override かつ default が shown (auto_promote=true) → 逸脱
  //   - 'none' のときは default のままなので逸脱ではない
  const isOverrideOfDefault =
    (event.visibilityOverride === "shown" && !subscriptionAutoPromote) ||
    (event.visibilityOverride === "hidden" && subscriptionAutoPromote);

  return {
    override: event.visibilityOverride,
    subscriptionAutoPromote,
    effectiveShown,
    isOverrideOfDefault,
  };
}
