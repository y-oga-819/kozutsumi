# ADR 0012: Phase 3 以降の AI (Gemini) 呼び出しは Next.js Route Handler で行う

- **Status**: Accepted
- **Date**: 2026-04-26
- **Related**: `docs/design/architecture.md` §3 / [ADR 0005](./0005-google-calendar-sync-via-route-handler.md)

## Context

Phase 3 で Gemini 2.5 Flash を使った AI 機能（タスク自動分解 / 依存関係推論 / 見積もり補正 / `task_category` ラベリング）を入れる。実行場所として以下が候補:

1. **Next.js Route Handler**: 既存の Vercel デプロイに乗る。Calendar 同期 (ADR 0005) と同じ構造。
2. **Next.js Server Action**: client component から直接呼べる。Route Handler より薄い。
3. **Vercel Edge Function**: streaming に強い。低レイテンシ。
4. **Supabase Edge Function**: Supabase 側のコンピュート。
5. **クライアント直叩き**: ブラウザから Gemini API を直接呼ぶ。

Phase 3 の AI 呼び出しは「タスク追加時の自動分解」「Stack 提案」「補正計算」が中心。streaming は当面不要、リクエストは短命、API key を server に閉じ込めたい。

ADR 0005 で同じ判断を Calendar 同期向けに行っており、運用ノウハウ（auth helper / error 経路 / Vercel 関数実行時間制限）が既に揃っている。

## Decision

AI 呼び出しは **Next.js Route Handler** (`/api/ai/*`) で行う。Gemini SDK (`@google/generative-ai` 等) を server 側で初期化し、API key は `GEMINI_API_KEY` (server-only env、`NEXT_PUBLIC_` prefix を付けない) で渡す。

呼び出し責務は Route Handler 内に閉じる。client 側は HTTP で結果だけ受け取る。

## Consequences

### 肯定的影響

- **追加インフラがゼロ**。既存 Vercel デプロイに乗る。
- **API key が client bundle に出ない**。`GEMINI_API_KEY` は server-only env で完結。
- ADR 0005 と同じ構造なので、auth helper (`src/shared/supabase/server.ts`) / エラーレスポンス形式 / Route Handler テスト方針が再利用できる。
- フォールバック設計 (ADR 0013 で別途) や e2e バイパス (ADR 0014 で別途) を「Route Handler のレスポンスをどう扱うか」という単一の境界で考えられる。

### 否定的影響・トレードオフ

- **Vercel の関数実行時間制限**（Hobby plan: 10s）に引っかかるリスク。Gemini 2.5 Flash は短い prompt なら 1〜3s で返るが、タスク分解で長い context を渡すと 10s を超える可能性がある。プロンプト設計と max_tokens で抑える運用にする。
- **streaming レスポンスを使う場合は Route Handler の `ReadableStream` を組む必要がある**。現状の Phase 3 スコープでは不要だが、UX 上必要になったら Route Handler のまま `Response` ボディを stream に切り替える。

## Alternatives considered

- **Server Action**: client から直接呼べる薄さは魅力だが、現状 client 側 gateway はすべて Supabase 経由 (`src/entities/*/supabase-gateway.ts`) で HTTP の出口は Route Handler に統一されている。Server Action を入れると out-of-band な経路が増えてテスト戦略 (ADR 0014) も二重化する。Phase 3 のスコープでは利点が薄い。不採用。
- **Vercel Edge Function**: streaming 用途で輝くが、Phase 3 のユースケースでは通常 Route Handler で足りる。Edge ランタイムは Node API の制限もあり、Supabase server client との互換性検証コストが上回る。不採用。
- **Supabase Edge Function**: Calendar 同期で同じ理由 (ADR 0005) で外している。AI でも同じ判断。新環境セットアップコストが Phase 3 のスコープに見合わない。不採用。
- **クライアント直叩き**: API key を client に渡すか、user 側の Google アカウントの Gemini quota を消費させる構造になる。前者はセキュリティ的に不可、後者は kozutsumi の差別化（行動データ蓄積側で AI を回す）と噛み合わない。不採用。

## Notes

- Gemini SDK の選定（`@google/generative-ai` を使うか fetch 直接か）はパラメータ寄りなので本 ADR の対象外。実装 issue で確定する。
- Vercel の Hobby plan 上限を超える長時間呼び出しが必要になったら、対象を分割する / バックグラウンドジョブ化する / Pro plan に上げる、を別 ADR で再評価する。
- ストリーミング UI が必要になったら、Route Handler 内で `Response` を `ReadableStream` に切り替える小改修で対応可。実行場所自体の判断は維持する。
