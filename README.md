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

### AI (Gemini) — Phase 3 / P3-1 以降

`/api/ai/*` は ADR 0012 / 0013 / 0014 に基づく kill-switch 付きで動く。

- `AI_ENABLED`: `"true"` のときだけ AI 経路を通す。未設定 / その他は off。
- `GEMINI_API_KEY`: server-only。`NEXT_PUBLIC_` prefix を付けない。

各環境のデフォルト:

| 環境 | `AI_ENABLED` | `GEMINI_API_KEY` |
|---|---|---|
| dev (普段) | `false` | 空でよい |
| dev (AI 動作確認時) | `true` に手動切り替え | https://aistudio.google.com/apikey から取得して設定 |
| e2e (`npm run test:e2e`) | `false` を `playwright.config.ts` が強制 (ADR 0014) | 不要 |
| Vercel preview | `false` (既定) | 不要 |
| Vercel production | `true` を明示的に設定 | 設定 |

`AI_ENABLED=true` でも `GEMINI_API_KEY` が無ければ AI 経路は止まる (fail-soft、ADR 0013)。設定漏れでユーザー操作が止まることはない。

dev で疎通確認したい場合:

```sh
# `.env.local` で AI_ENABLED=true / GEMINI_API_KEY=... を設定したあと
npm run dev
# ログイン後、別ターミナルから
curl -X POST http://localhost:3000/api/ai/ping --cookie "<auth cookie>"
# → { "ok": true, "text": "pong" } 形式が返れば疎通 OK
# AI_ENABLED=false なら → { "skipped": true, "reason": "ai_disabled" }
```

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

#### 本番 Supabase への適用

本番への migration 適用は **GitHub Actions の手動 trigger workflow** で行う（ADR-0019 / ADR-0020）。
PC からの `supabase db push` 直接実行はしない。

1. 該当の migration を含む PR を main に merge する
2. GitHub の `Actions` タブ →「DB migrate (production)」→「Run workflow」
3. `production` Environment の approval を承認する（reviewer = repo owner）
4. workflow が走り、適用前 backup → migration 適用 → 結果確認の順に実行される
5. backup は artifact として 14 日保持される（事故時のロールバック用）

スマホからは GitHub アプリで上記 2〜3 を 2 タップで完結できる。

**事前設定（一度だけ）:**

- GitHub Repository → Settings → Environments で `production` Environment を作成
  - `Required reviewers` に repo owner を追加（approval gate）
- 同 Environment の Secrets に `SUPABASE_DB_URL` を登録
  - 形式: `postgresql://postgres.<PROJECT_REF>:<DB_PASSWORD>@<host>:5432/postgres`
  - **必ず Session pooler (port 5432)** を使う。Transaction pooler (6543) では `pg_dump` が動かない
  - 値は Supabase Dashboard → Project Settings → Database → Connection string から取得

**dry run:**

「Run workflow」起動時に `dry_run` を ON にすると、backup と pending migration の表示までで止まる（適用しない）。本番に流す前の事前確認用。

**漏洩時 / 定期 rotate:**

Supabase Dashboard → Database → Reset database password で再生成 → GitHub Environment Secret の `SUPABASE_DB_URL` を上書き。半年〜1 年に 1 回が目安。

## ドキュメント

[docs/](./docs/) にビジョン / アーキテクチャ / Phase 別仕様をまとめている。[CLAUDE.md](./CLAUDE.md) の表が入り口。
