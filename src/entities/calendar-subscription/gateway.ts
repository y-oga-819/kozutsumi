import type { CalendarSubscription, CreateSubscriptionInput, SetAutoPromoteResult } from "./types";

/**
 * Calendar subscription Gateway (ADR 0031 Layer 1/2)。
 *
 * - subscription = 取り込み対象 calendar の whitelist (Layer 1) + 予定化 default (Layer 2)。
 * - 認証済 user の subscription を CRUD する。
 * - auto_promote の切替は atomic な RPC 経由 (ADR 0034 L6/L7)。
 * - subscribe / unsubscribe の events 連動 (過去 N 日取り込み / 物理削除 + snapshot) は
 *   呼び出し側 (route handler / server) のオーケストレーションで行う。本 gateway は
 *   subscription 行 1 つに対する操作と、`fn_set_subscription_auto_promote` の thin wrapper のみ提供する。
 */
export interface CalendarSubscriptionGateway {
  /** 認証済 user の全 subscription (FK 経由で external_accounts.external_account_id を含める)。 */
  list(): Promise<CalendarSubscription[]>;

  /**
   * 新規 subscription を 1 行追加する。
   * 既に同じ (user, account, calendar) が存在すれば UNIQUE 制約違反で throw。
   */
  create(input: CreateSubscriptionInput): Promise<CalendarSubscription>;

  /**
   * subscription 行を 1 件削除する。事前の events 物理削除 / action_log 記録は呼び出し側で行う。
   */
  delete(subscriptionId: string): Promise<void>;

  /**
   * `fn_set_subscription_auto_promote` を呼び、subscription の auto_promote_to_timeline を
   * atomic に切り替える (ADR 0034 L6/L7)。
   * 過去 event のうち visibility_override='none' のものは旧 default で固定される。
   */
  setAutoPromote(subscriptionId: string, value: boolean): Promise<SetAutoPromoteResult>;
}
