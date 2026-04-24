/**
 * 起動時遅延同期 (ADR 0007) の閾値。
 * 前回同期から `SYNC_STALE_THRESHOLD_MINUTES` 分以上経過していたら
 * アプリ起動時にバックグラウンドで `/api/calendar/sync` を叩く。
 */
export const SYNC_STALE_THRESHOLD_MINUTES = 15;
