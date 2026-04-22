# ADR 0009: Google provider token の refresh は自前実装する

- **Status**: Accepted
- **Date**: 2026-04-22
- **Related**: [ADR 0005](./0005-google-calendar-sync-via-route-handler.md) / [ADR 0002](./0002-oauth-calendar-scope-preauth.md)

## Context

Supabase Auth の session に格納される Google OAuth の `provider_token` には
有効期限がある（access_token、通常 1 時間）。期限切れ時は `provider_refresh_token`
を使って refresh する必要がある。

現時点（2026-04 時点）の Supabase Auth は **OAuth provider token を自動 refresh しない**。
Supabase 自体のセッション (`access_token` / `refresh_token`) は自動 refresh するが、
Google を含む provider 側のトークンは別管理。

期限切れ時の選択肢:

1. **自前で Google OAuth token endpoint を叩いて refresh**
2. **ユーザーに再ログインを促す**
3. **Supabase が自動 refresh 対応するのを待つ**

頻繁な再ログインは個人ツールでも UX が悪い。Supabase の対応待ちは時期不明。

## Decision

Google の `provider_token` で 401 を受けたら、`provider_refresh_token` を使って
**Google OAuth token endpoint** (`https://oauth2.googleapis.com/token`) を直接叩いて
新しい access_token を取得する。

refresh 自体が失敗した場合（refresh_token も expired / revoked）は、
ユーザーに再ログインを促す（バナー表示 + `signInWithOAuth` 誘導）。

## Consequences

### 肯定的影響

- **再ログイン頻度を最小化**。`provider_refresh_token` が生きている限り
  ユーザー操作なしで token を更新できる。
- **Supabase の対応に依存しない**。kozutsumi 側で完結する。
- 401 ハンドリングが明示的になる（Supabase の暗黙挙動に依存しない）。

### 否定的影響・トレードオフ

- **小さな自前実装が増える**。Google OAuth token endpoint への POST と、
  新トークンを Supabase session に書き戻す（または in-memory cache に保持して
  次回同期で使う）小さな util が必要。
- **トークン保管の責務が分散する**。Supabase Auth の session と、自前 refresh の
  結果がどちらかに同期されない可能性がある。実装で揃える。

## Alternatives considered

- **再ログインのみ（自前 refresh しない）**: 1 時間ごとに再ログイン UX が出る。
  個人ツールでも煩わしい。不採用。
- **Supabase の対応を待つ**: 時期不明、Phase 2 の仮説検証が止まる。不採用。
- **Supabase Edge Function で token を一元管理**: ADR 0005 で実行場所を Route Handler
  に決めた前提と矛盾する。同じ Route Handler に閉じ込める方が単純。

## Notes

- 実装場所は `src/shared/google/token.ts` 等を想定（実装 issue で確定）。
- Google OAuth refresh の仕様: `grant_type=refresh_token` で POST。
  `client_id` / `client_secret` が必要。これらは環境変数に置く。
- Supabase が将来 provider token の自動 refresh に対応したら、本 ADR を Superseded にする。
