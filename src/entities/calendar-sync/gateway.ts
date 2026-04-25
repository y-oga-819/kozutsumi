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

export interface CalendarSyncStateGateway {
  /** 現在ユーザーの同期状態を取得。未同期なら null。 */
  get(): Promise<CalendarSyncState | null>;
  /**
   * 同期成功時に最終同期時刻と syncToken を atomic に upsert する。
   * `syncToken: null` を渡すと DB の `sync_token` も `null` に上書きされ、次回は full sync になる
   * (410 Gone fallback で nextSyncToken が得られなかったケース等)。
   */
  saveSyncState(input: {
    lastSyncedAt: string;
    syncToken: string | null;
  }): Promise<void>;
}
