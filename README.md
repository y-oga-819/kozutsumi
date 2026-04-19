# kozutsumi 📦

A personal AI secretary that grows smarter with you. kozutsumi breaks big tasks into small packages, stacks them by priority, and fits them into your calendar's free slots. It learns from your behavior — what you avoid, where you underestimate, when you focus best — to deliver increasingly accurate daily plans.

プロダクトのビジョン・設計・ロードマップは [docs/](./docs/) を参照。新しい会話を始めるときは [docs/design/vision.md](./docs/design/vision.md) を最初に読むこと。

## 開発セットアップ

### 前提

- Node.js 20+
- [Supabase CLI](https://supabase.com/docs/guides/cli) (`brew install supabase/tap/supabase` など)
- Docker (Supabase CLI がローカル Postgres を立てるのに使う)

### 初回セットアップ

```sh
# 1. 依存をインストール
npm install

# 2. 環境変数ファイルをコピーして埋める
cp .env.local.example .env.local

# 3. ローカル Supabase を起動 (Postgres + Studio + Auth)
supabase start

# 4. マイグレーションを適用
supabase db reset
```

`supabase start` 後に表示される `API URL` と `anon key` を `.env.local` の `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` に貼る。

### Google OAuth (Phase 1 / P1-2 以降)

Phase 2 の Google Calendar 連携で OAuth トークンを再利用するため、`calendar.readonly` scope を先行付与する。Google Cloud Console で OAuth 2.0 Client を作り、Client ID / Secret を `.env.local` の `SUPABASE_AUTH_GOOGLE_CLIENT_ID` / `SUPABASE_AUTH_GOOGLE_SECRET` に設定する。

### よく使うコマンド

```sh
npm run dev        # Next.js dev server
npm run typecheck  # TypeScript 型チェック
npm run test       # Vitest 一括実行
npm run lint       # ESLint
```

### Supabase スキーマの変更

マイグレーションは `supabase/migrations/` に SQL を追加していく。

```sh
# 新規マイグレーション作成
supabase migration new <name>

# ローカル DB をリセットして全マイグレーション適用
supabase db reset

# 型再生成 (src/shared/types/database.ts を上書き)
supabase gen types typescript --local > src/shared/types/database.ts
```

リモートにプッシュするときは `supabase db push`。

## ドキュメント

[docs/](./docs/) にビジョン / アーキテクチャ / Phase 別仕様をまとめている。[CLAUDE.md](./CLAUDE.md) の表が入り口。
