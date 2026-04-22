# ADR 0005: Google Calendar 同期は Next.js Route Handler で pull 型から始める

- **Status**: Accepted
- **Date**: 2026-04-22
- **Related**: `docs/design/architecture.md` §1.2 / `docs/roadmap.md` Phase 2 / [ADR 0002](./0002-oauth-calendar-scope-preauth.md)

## Context

Phase 2 のゴールは「カレンダーからイベントを自動取得する」こと
（[roadmap.md](../roadmap.md) Phase 2）。Phase 1 で以下は仕込み済み:

- OAuth scope `calendar.readonly` 先行付与（ADR 0002）。再認証なしで API が叩ける
- `events` テーブルに `source: 'manual' | 'google_calendar'` と `external_id`、
  `(source, external_id)` unique 制約（`supabase/migrations/20260419000000_initial_schema.sql`）

残る判断は「どう取りに行くか」であり、大きく以下を決める必要がある。

1. **実行場所**: Next.js Route Handler / Supabase Edge Function / クライアント直叩き
2. **同期方式**: 毎回 full fetch / 差分同期 (`syncToken`) / webhook (push notification)
3. **実行トリガー**: 手動ボタン / ページロード時 / 定期実行
4. **取得範囲**: primary のみ / 全カレンダー、何日前〜何日後
5. **トークン運用**: Supabase Auth の `provider_token` と `provider_refresh_token`
   の期限切れハンドリング

Phase 2 は「連携の仮説を最小コストで検証する」フェーズ。
個人ツールなので、リアルタイム性よりも**確実に動くこと**と**実装工数の低さ**が優先。

## Decision

以下のアーキテクチャで Phase 2 を開始する。

### 1. 実行場所: Next.js Route Handler (`/api/calendar/sync`)

サーバー側で Supabase の server client 経由でセッションを取得し、
`session.provider_token` を使って Google Calendar API v3 を呼び出す。

### 2. 同期方式: full sync から開始、`syncToken` 差分同期は後続 issue で追加

最初は毎回 `events.list` を full fetch（対象期間内を全部取る）して upsert。
Google 側 `status: 'cancelled'` の行は local から delete。
`(source, external_id)` unique で idempotent。

差分同期 (`syncToken` / `nextSyncToken`) は Phase 2 の次フェーズの issue で追加する。
webhook (push notification) は **Phase 2 の範囲外**とする。

### 3. 実行トリガー: 手動ボタン + アプリ起動時の遅延実行

- UI から明示的に「同期」ボタンで走らせる
- アプリ起動時、最終同期から一定時間（初期値: 15 分）経っていれば自動で走らせる（non-blocking）
- 定期実行（Vercel Cron / Supabase scheduled functions）は Phase 2 の範囲外

### 4. 取得範囲: primary カレンダー、過去 7 日〜未来 30 日

- `calendarId = 'primary'` のみ
- 時間窓は `timeMin = now - 7d` / `timeMax = now + 30d`
- 複数カレンダー（会社と個人を分ける等）の対応は将来拡張

### 5. トークン運用: 期限切れは自前で refresh、失敗時は再ログイン誘導

- `provider_token` の期限切れ（401）を検出したら、`provider_refresh_token` を
  使って Google OAuth token endpoint (`https://oauth2.googleapis.com/token`)
  を直接叩き、新しい access_token を取得する（Supabase Auth は provider token
  の自動 refresh をしない）
- refresh 自体が失敗した場合は「再ログインしてください」のバナーを出し、
  `signInWithOAuth` に誘導

## Consequences

### 肯定的影響

- **追加インフラがゼロ**。Next.js の Route Handler は既存の Vercel デプロイに乗る。
  Supabase Edge Function も cron も Phase 2 では立ち上げない。
- **pull + 手動トリガー**は実装が最も素直で、kozutsumi の仮説検証
  （「Google Calendar のイベントが自動で流れてきたら体験が改善するか」）に必要な最小限。
- **`(source, external_id)` unique による upsert で idempotent**。
  同期が何度走っても DB は壊れない。途中失敗の retry も安全。
- `syncToken` / webhook を将来追加する時、アーキテクチャを大きく変えずに
  同一 Route Handler に層を増やせる（full sync は `syncToken` 取得の初回フローとしても機能する）。

### 否定的影響・トレードオフ

- **リアルタイム性は無い**。カレンダーにイベントが追加されても、ユーザーが同期
  ボタンを押すかアプリを開き直すまで反映されない。個人ツールとしては許容範囲。
- **毎回 full fetch は API quota に優しくない**。Google Calendar API の無料枠
  （1,000,000 requests/day、個人利用では余裕）には余裕があるが、同期対象期間を
  広げる時に改めて評価が必要。
- **provider token の refresh を自前実装する**。Supabase Auth に閉じた扱いに
  したかったが、現時点では Google provider token の自動 refresh をサポート
  していないため、OAuth token endpoint を直接叩く小さなコードが必要。

## Alternatives considered

### 実行場所

- **Supabase Edge Function で走らせる**: 定期実行と同期ロジックを同じ場所に置ける
  が、Phase 2 では定期実行自体を見送るため利点が薄い。Edge Function の開発・
  デプロイ環境を Phase 2 で立ち上げるのはオーバーエンジニアリング。不採用。
- **クライアントから Google API を直叩き**: `provider_token` はサーバー側
  （Supabase Auth session）にあり、ブラウザから安全に引き出すのが筋が悪い。
  refresh の扱いもサーバー側に寄せた方が安全。不採用。

### 同期方式

- **最初から `syncToken` 差分同期**: 実装工数が増える（初回は full、以降は
  `syncToken`、invalidation の処理も必要）。Phase 2 の仮説検証には不要な最適化。
  後続 issue で追加する前提で不採用。
- **最初から webhook (push notification)**: 公開 URL + channel 管理 + 更新
  通知に応答する pull が別途必要。個人ツールでリアルタイム性は要らない。不採用。

### 実行トリガー

- **ページロード時に毎回同期**: 起動体感が悪化する（ブロッキングなら遅延、
  non-blocking でも API を毎回叩くのは無駄）。閾値付き遅延実行のほうが良い。不採用。
- **cron / scheduled trigger**: Phase 2 では追加インフラになるため見送り。
  手動 + 遅延実行が実用上十分であれば恒久的に不要の可能性もある。

### 取得範囲

- **全カレンダー**: 会社アカウントの Workspace カレンダー等を含めると
  即座に便利だが、複数カレンダー選択 UI の設計が必要になり Phase 2 の範囲を
  広げる。primary 固定で始めて、必要なら将来 ADR で拡張する。

## Notes

- `provider_token` は Supabase Auth session 内にあり、server client の
  `supabase.auth.getSession()` → `session.provider_token` で取得できる。
- `provider_refresh_token` は同じ session オブジェクト。Supabase 側が
  自動 refresh しないため、401 を掴んだら自前で refresh する小さな util
  を `src/shared/google/` あたりに置く想定（実装詳細は issue で決定）。
- Google Calendar API v3: `events.list` (primary, singleEvents=true,
  orderBy=startTime, timeMin/timeMax)。
- 最終同期時刻の永続化は `user_id` 単位で小さなテーブル（`calendar_sync_state`
  のような）を掘るか、既存テーブルに column を増やすかは issue で決定。
