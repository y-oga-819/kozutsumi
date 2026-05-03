import type { EventSource } from "@/entities/event/types";

/**
 * Google Calendar 同期状態 (最終同期時刻 + syncToken) の永続化 Gateway。
 *
 * - `lastSyncedAt`: ADR 0007 の起動時 15 分閾値判定に使う。
 * - `syncToken`: ADR 0006 の syncToken 差分同期。`null` は「次回 full sync」を意味する
 *   (初回 / 410 Gone 直後)。
 */
export type CalendarSyncState = {
  lastSyncedAt: string;
  syncToken: string | null;
};

/**
 * 複合キー (ADR 0031/0033)。calendar 単位で sync_token / lastSyncedAt を独立に管理する。
 * Phase 2 までは primary 固定で動いていたため事実上 (google_calendar, primary, 'primary') のみだが、
 * Issue #144 / #146 で複数 calendar / 複数 account に拡張される。
 */
export type CalendarSyncStateKey = {
  source: EventSource;
  externalAccountId: string;
  externalCalendarId: string;
};

export interface CalendarSyncStateGateway {
  /** 指定された (source, externalAccountId, externalCalendarId) の同期状態。未同期なら null。 */
  get(key: CalendarSyncStateKey): Promise<CalendarSyncState | null>;
  /**
   * 同期成功時に最終同期時刻と syncToken を atomic に upsert する。
   * `syncToken: null` を渡すと DB の `sync_token` も `null` に上書きされ、次回は full sync になる
   * (410 Gone fallback で nextSyncToken が得られなかったケース等)。
   */
  saveSyncState(
    key: CalendarSyncStateKey,
    input: { lastSyncedAt: string; syncToken: string | null },
  ): Promise<void>;
}
