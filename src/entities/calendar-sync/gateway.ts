/**
 * Google Calendar 同期状態 (最終同期時刻・syncToken 予約) の永続化 Gateway。
 *
 * ADR 0007 の「起動時 15 分閾値で遅延同期するか」を判定するために `lastSyncedAt` を使う。
 * `syncToken` は ADR 0006 の P2-6 差分同期で使う予約枠で、P2-3 時点では読み書きしない。
 */
export type CalendarSyncState = {
  lastSyncedAt: string;
  syncToken: string | null;
};

export interface CalendarSyncStateGateway {
  /** 現在ユーザーの同期状態を取得。未同期なら null。 */
  get(): Promise<CalendarSyncState | null>;
  /** 同期成功時に最終同期時刻を upsert する (`sync_token` は触らない)。 */
  upsertLastSyncedAt(lastSyncedAt: string): Promise<void>;
}
