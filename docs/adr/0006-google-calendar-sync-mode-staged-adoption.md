# ADR 0006: 同期方式は full sync から始め、syncToken 差分同期に段階採用する。webhook は不採用

- **Status**: Accepted
- **Date**: 2026-04-22
- **Related**: [ADR 0005](./0005-google-calendar-sync-via-route-handler.md)

## Context

Google Calendar API の同期方式は大きく 3 つ:

1. **Full sync**: 毎回 `events.list` で対象期間を全部取って upsert。
2. **Incremental sync (`syncToken`)**: 初回 full、以降は前回返却された `syncToken` で
   差分のみ取得。Google 推奨。
3. **Push notification (webhook)**: Google 側からの POST で更新通知を受ける。
   公開 URL + channel 管理が必要。

Phase 2 のゴールは「カレンダー連携で体験が改善するか」の仮説検証。リアルタイム性は
個人ツールとして不要。実装の単純さと idempotency を優先したい。

`(source, external_id)` unique 制約（`supabase/migrations/20260419000000_initial_schema.sql`）
により、どの同期方式でも upsert は idempotent。

## Decision

以下の段階で採用する:

1. **Phase 2 初期**: full sync のみ（毎回対象期間を全取得して upsert）
2. **Phase 2 後期**: `syncToken` 差分同期に移行（初回 full → 以降は差分）
3. **将来も不採用**: webhook (push notification)

`status: 'cancelled'` の行は local から delete する。

## Consequences

### 肯定的影響

- **初期実装が最も素直**。Phase 2 の仮説検証に必要な最小構成。
- **idempotent**。`(source, external_id)` unique で upsert が衝突しない。
  retry / 重複実行が安全。
- `syncToken` 移行時もアーキ変更不要（同じ Route Handler 内に層を増やすだけ）。
- webhook を切ったことで、公開 URL / channel renewal / signature 検証等の
  運用負担を Phase 2 範囲外にできる。

### 否定的影響・トレードオフ

- **API quota の消費が大きい**（差分が無くても毎回全件取得）。Google Calendar API
  の無料枠（1,000,000 req/day）には個人利用で余裕があるが、対象期間（ADR 0008）
  を広げる時は再評価。
- **リアルタイム性ゼロ**。Google 側で追加・変更しても同期実行まで反映されない。
  個人ツールでは許容範囲。

## Alternatives considered

- **最初から syncToken 差分同期**: 実装工数増（初回 full → 差分 → invalidation 処理）。
  Phase 2 の仮説検証に不要な最適化。後続で追加する前提で不採用。
- **最初から webhook**: 公開 URL + channel 管理 + 通知後の pull が必要。個人ツールの
  リアルタイム性要件はゼロ。永久に不採用。

## Notes

- `syncToken` の永続化場所は実装 issue で決定（ユーザー単位の小さな state テーブルか、
  既存テーブルへの column 追加か）。
- `status: 'cancelled'` の扱いは upsert と同じ Route Handler 内で処理。
