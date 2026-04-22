# ADR 0005: Google Calendar 同期は Next.js Route Handler で実行する

- **Status**: Accepted
- **Date**: 2026-04-22
- **Related**: `docs/design/architecture.md` §3 / [ADR 0002](./0002-oauth-calendar-scope-preauth.md)

## Context

Phase 2 で Google Calendar からイベントを取得する。実行場所として以下が候補:

1. **Next.js Route Handler**: 既存の Vercel デプロイ上で動く。Supabase server client
   経由で `session.provider_token` を取得できる。
2. **Supabase Edge Function**: Supabase 側のコンピュート。スケジュール実行と相性が良い。
3. **クライアント直叩き**: ブラウザから Google API を直接呼ぶ。

`provider_token` は Supabase Auth の session に格納されており、サーバー側で
取り出すのが自然。Phase 2 の段階では追加インフラを増やさず最短経路で動かしたい。

## Decision

同期実行を **Next.js Route Handler** (`/api/calendar/sync`) で行う。
Supabase の server client (`createClient()` from `src/shared/supabase/server.ts`)
経由で session を取得し、`session.provider_token` を使って Google Calendar API v3 を呼ぶ。

## Consequences

### 肯定的影響

- **追加インフラがゼロ**。既存の Vercel デプロイに乗る。
- `provider_token` をサーバー側で完結して扱える。クライアントに露出させない。
- 401 検知時の token refresh も同じ Route Handler 内で処理できる（ADR 0009 と整合）。
- ロジックが TypeScript の既存コードベースに統一される（Edge Function は Deno）。

### 否定的影響・トレードオフ

- Vercel の関数実行時間制限（Hobby plan: 10s）に引っかかるリスク。Phase 2 の
  対象期間（37 日分）と primary カレンダーのみ（ADR 0008）であれば問題にならない見込みだが、
  範囲を広げる時に再評価が必要。
- 定期実行（cron 等）を追加する時は別仕組みが必要（Vercel Cron / 別サービス）。

## Alternatives considered

- **Supabase Edge Function**: 定期実行と同居できるが、Phase 2 では定期実行自体を
  見送る（ADR 0007）ため利点が薄い。新環境のセットアップコストが上回る。不採用。
- **クライアント直叩き**: `provider_token` をブラウザに渡す経路が増え、refresh の
  扱いも複雑化。サーバー側に寄せる方が安全。不採用。

## Notes

- Route Handler は `app/api/calendar/sync/route.ts` あたりを想定（実装 issue で確定）。
- 関数実行時間が問題になったら、対象期間を分割して逐次呼ぶ / バックグラウンドジョブ化等を検討。
