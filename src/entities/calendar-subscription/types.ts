import type { EventSource } from "@/entities/event/types";

/**
 * 1 calendar の subscription (ADR 0031 Layer 1 + Layer 2)。
 *
 * - Layer 1 (取り込み): kozutsumi が events テーブルに行を入れる対象 calendar の whitelist。
 * - Layer 2 (予定化 default): `autoPromoteToTimeline` が true なら新 event は default で
 *   DayTimeline に表示される。false なら default 非表示 (個別 override は #145 / Layer 3)。
 *
 * `externalAccountId` (uuid) は `external_accounts.id` への FK。
 * `externalAccountIdentifier` (text) は source 内識別子 (email 等)。subscription 単体での
 * 表示・action_log の triple metadata はこの text 側を使う (ADR 0033)。
 */
export type CalendarSubscription = {
  id: string;
  externalAccountId: string;
  externalAccountIdentifier: string;
  source: EventSource;
  externalCalendarId: string;
  autoPromoteToTimeline: boolean;
  displayName: string | null;
  color: string | null;
  subscribedAt: string;
};

/**
 * 新規 subscription の入力。external_account_id (uuid) は事前に解決済みで渡す。
 */
export type CreateSubscriptionInput = {
  externalAccountId: string;
  source: EventSource;
  externalCalendarId: string;
  autoPromoteToTimeline?: boolean;
  displayName?: string | null;
  color?: string | null;
};

/**
 * `fn_set_subscription_auto_promote` の戻り値 (ADR 0034 L6/L7)。
 * 切替が atomic に走り、過去 event を旧 default で固定した結果を返す。
 */
export type SetAutoPromoteResult = {
  changed: boolean;
  from: boolean;
  to: boolean;
  source: EventSource;
  externalAccountIdentifier: string;
  externalCalendarId: string;
  /** changed=false のときは null。changed=true のときは旧 default ('shown'/'hidden')。 */
  frozenTo: "shown" | "hidden" | null;
  frozenEvents: Array<{
    externalId: string;
    title: string;
    startTime: string;
    endTime: string;
  }>;
};
