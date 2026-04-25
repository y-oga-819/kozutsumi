# ADR 0011: e2e は本物の Supabase ローカル + password sign-in による auth バイパス

- **Status**: Accepted
- **Date**: 2026-04-25
- **Related**: Issue #46 / [ADR 0001](./0001-action-logs-from-phase1.md)

## Context

Phase 1 / Phase 2 を経て主要フロー（タスク追加 → スタック並べ替え → 開始/中断/再開/完了 → ツリー表示 → カレンダー同期）が固まった。
リグレッション検出を手動確認だけに頼っていると、Phase 3 以降で機能が増えるほど検出コストが指数的に上がる。

e2e テストを入れたいが、以下の制約がある:

1. **Supabase 固有の挙動**（RLS / migration / 将来の realtime）はインメモリ Gateway 差し替えでは踏めない。
   `docs/design/vision.md` の差別化の核は行動データ蓄積 → Supabase の挙動が崩れていれば学習基盤が壊れる。
   ここを e2e でも踏みに行きたい。
2. **Google OAuth は自動テストに向かない**。本物の Google 側にテスト用アカウントを立てる運用は脆い。
3. **CI に最小 Supabase 起動はすでに入っている**（PR #39 / `b84f033`）。
   migration 検証用 job として動いているので、e2e からも相乗りできる。

## Decision

以下の組み合わせで e2e を構築する:

1. **本物のローカル Supabase に対して回す**。インメモリ / モック Gateway 差し替えは採らない。
   migration / RLS / SQL 制約 を本番と同じ条件で踏めるようにする。
2. **auth は password sign-in で直接バイパス**する。Google OAuth フローは e2e の対象外。
   テスト用シードユーザーを `supabase.auth.admin` で作り、password で直接ログインする。
3. **ログインフォームに「テスト用 password sign-in」を E2E モード時にだけ表示する**。
   `NEXT_PUBLIC_E2E_TEST_AUTH=true` のときに限り表示するコンディショナル UI で、
   本番ビルド（env 未設定）には影響しない。これにより本番コードパス（@supabase/ssr の cookie ハンドリング）
   をそのまま通せる。

実装フレームワークとしては **Playwright** を採用する（豊富な実績 / Next.js 公式ドキュメントの導入例 / CI ランナーの整備度）。

## Consequences

### 肯定的影響

- **RLS / migration の事故が e2e で踏める**。インメモリ Gateway では取れない領域。
  Phase 3 以降で `action_logs` の積み方が変わる際にも、書き込み権限の崩れに気付ける。
- **本番コードパスを最大限通せる**。@supabase/ssr の cookie 仕組み・middleware の redirect・
  Server Component の `getUser` を全部踏む。
- **CI コストが小さい**。すでに上がっている Supabase 最小スタックに相乗りする形なので、
  追加で立ち上げるサービスはない。
- **テストユーザー作成が標準 API で完結**。`supabase.auth.admin.createUser({ email, password, email_confirm: true })`
  だけ。SQL を直接いじらないので Supabase 内部スキーマ変更にも追従しやすい。

### 否定的影響・トレードオフ

- **Google OAuth フロー自体は e2e の対象外**。OAuth コールバック（`/auth/callback`）と
  provider token refresh（ADR 0009）は e2e では踏めない。これらは別途、ユニット / 手動確認で担保する。
- **本番ビルドに「テスト用フォーム」のコードパスが残る**。env 未設定時は描画されないが、
  `NEXT_PUBLIC_*` は client bundle に入るため、env 名と意図はソースから読み取れる状態になる。
  個人ツールの段階では許容（誰かが勝手に env を立てて偽ログインしても Supabase 側で password
  チェックは効くので任意ログインにはならない）。
- **e2e 用シードデータを各テストが自前で組み立てる必要がある**。アプリの自動 seed
  (`AppShell` の seedSampleData) は localStorage `cleared` フラグで止め、テスト側で必要な
  プロジェクト / タスクを UI から作る方針。テストが冗長になりやすいが、UI 経由の
  「タスク追加」自体が golden path の一部なので相殺される。

### 将来的な制約

- **Phase 3 以降の AI 機能**（Gemini 呼び出し）は e2e から外す。LLM 応答は決定的でないため、
  e2e ではモックするか、ロジックレイヤーのユニットで担保する（別途判断）。
- **Google Calendar 同期**（ADR 0005〜0010）は本物の Google API を叩かないと意味が薄いので
  e2e の対象外。同期ボタンの UI 表示・disabled 状態くらいまでは確認可。

## Alternatives considered

- **Vitest browser mode**: Playwright と比べて Next.js / E2E でのレシピがまだ少なく、
  `webServer` の概念が薄い。将来移行する余地はあるが今は採らない。
- **インメモリ Gateway に差し替え（ADR 0001 の `LocalActionLogStorage` 路線）**:
  RLS / SQL 制約 / migration の挙動が踏めず、Phase 3 で行動データ書き込みパスが壊れたときに
  検知できない。差別化の核に直撃するので不採用。
- **Google OAuth を e2e でも通す**（playwright + Google テストアカウント）:
  Google 側のセキュリティ仕様変更で頻繁に壊れる。脆く高コスト。不採用。
- **テスト用 API endpoint (`/api/test/login`) を追加して直接 cookie をセット**:
  本番コードパス（@supabase/ssr が browser client から発行する cookie）を通らない別経路を
  作ることになり、cookie 形式が変わったときに e2e だけ壊れる。本番と同じパスを通す方が頑健。
  不採用。

## Notes

- 実装ファイル: `playwright.config.ts` / `e2e/golden-path.spec.ts` / `e2e/global-setup.ts` /
  `src/app/login/TestLoginForm.tsx`。
- env: `E2E_TEST_USER_EMAIL` / `E2E_TEST_USER_PASSWORD` / `SUPABASE_SERVICE_ROLE_KEY` /
  `NEXT_PUBLIC_E2E_TEST_AUTH`。値（パスワード等）は code の constant ではなく env で渡す。
- 見直し条件:
  - Phase 3 で AI モック設計が固まったら、e2e の AI 周りカバー方針を別 ADR にする。
  - Google OAuth フローを e2e に乗せたくなったら（プロダクト化検討時）、別 ADR で再設計。
