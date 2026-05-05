# ADR 0042: Vercel preview deployment は本番と別の Supabase project を見る

- **Status**: Accepted
- **Date**: 2026-05-04
- **Related**: [ADR-0019](./0019-db-migration-via-manual-github-actions.md) / [ADR-0020](./0020-db-migration-credential-as-db-connection-string.md) / [ADR-0023](./0023-pr-migration-diff-auto-comment.md) / [ADR-0048](./0048-preview-db-migration-manual-dispatch.md)

## Context

kozutsumi は Vercel に deploy しており、PR を出すと自動で preview deployment が立つ。
現状この preview env は **本番 Supabase project の URL / anon key** を見ている。これが 2 つの問題を生む。

1. **migration 入りの PR を preview で動作確認できない**
   PR に `supabase/migrations/*.sql` が含まれていても、本番 DB にはまだ適用されていない。
   feature の動作確認には schema が前提になっているので、現状は **migration だけ別 PR にして
   先にマージ → 手動 workflow (ADR-0019) で本番に適用 → 本体 feature の PR を preview で確認**
   という 2 段階フローを取らざるを得ない。1 つの仕様変更を 2 PR に分割する手間と、
   migration 単独 merge の時点で main の schema が「コードの期待」と一時的にズレる窓ができる。

2. **preview から本番データに書き込める**
   preview の anon key が本番と同じため、preview 上で操作したテストデータが本番 DB に混入する。
   個人開発で `auth.uid()` ベースの RLS なので他人には漏れないが、自分の本番データが
   「PR で実験した中途半端な状態」で汚れる。dogfooding データ（Phase 4 で使う行動ログ）の
   品質が下がる。

「migration 適用は本番に対しては手動 + approval」(ADR-0019) という慎重さは保ったまま、
preview env だけは「PR の HEAD にある migration が当たった schema」を見せたい。

## Decision

Vercel **Preview** environment は本番 Supabase project ではなく、**preview 専用の Supabase
project** を見る。Production environment は引き続き本番 project を見る。

- preview 専用 project は Supabase free tier で 1 つ追加する（org あたり 2 active project まで無料）
- Vercel の Environment Variables を **Preview / Production で別値**に設定し、
  `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` を Preview だけ preview project
  のものに差し替える
- preview project の DB は **使い捨て前提**。永続価値のあるデータは置かない（テスト seed のみ）
- preview project への migration 適用方法は ADR-0048 で別途決める（当初 ADR-0043 で自動 apply としていたが、共有 DB の運用問題が累積し ADR-0048 で手動 trigger に supersede）

## Consequences

### 肯定的影響

- **migration 入り feature を 1 PR で完結できる**。preview で migration を含む schema 状態を
  動作確認できるので、「migration 先出し PR + feature PR」の 2 段階運用が消える
- **本番データが preview から汚染されない**。preview 上のテスト操作が本番 RLS を超えて漏れる
  経路が物理的に消える（DB 自体が別）
- **dogfooding データの質が保たれる**。Phase 4 学習素材としての行動ログに「PR 検証時の
  ノイズ操作」が混ざらなくなる
- **本番 DB への migration 適用は ADR-0019 の手動 + approval を維持できる**。preview と production
  で適用経路が分かれるので、preview の自動化が production の慎重さを侵食しない
- **preview の OAuth callback / リダイレクト URL を本番から分離できる**。Google OAuth client の
  許可 URI に preview ドメインを追加する設定変更が必要だが、これは preview project 側の auth
  設定として閉じる

### 否定的影響・トレードオフ

- **Supabase free tier の 2 active project 枠を 1 つ消費する**。今後 staging / 別アプリで
  もう 1 project 欲しくなったら有料化が必要
- **secret / 環境変数の管理対象が増える**。preview project 用の URL / anon key / service role key
  / DB connection string を Vercel と GitHub Secrets の両方に設定する必要がある
- **preview project の auth 設定（Google OAuth client / redirect URL）を別途構成する必要がある**。
  Google Cloud Console 側で preview project の callback URL を許可 URI に追加する手間が出る
- **preview project の seed をどう用意するか**は別問題として残る（本番データはコピーしない方針なので、
  最低限のテストユーザー / project / task を seed する仕組みが要る）
- **本番 anon key が preview に漏れていないことを確認する初期コスト**。既存 Vercel env の Production
  と Preview を明確に分ける作業が必要

### 何をしないか（境界）

- **本番 DB への migration 適用フローは変えない**。ADR-0019 の手動 `workflow_dispatch` + approval
  を維持する。preview の自動化は production の安全装置を緩める方向には使わない
- **本番データを preview にコピーしない**。本番のユーザーデータ（自分の生活ログ）を CI / CD 経路で
  別 project に流すと漏洩経路が増える。preview seed は最小限のダミーデータで作る
- **preview project に PII / 本番 secret を置かない**。Google OAuth は preview 用 client を分けるか、
  本番 client の許可 URI を広げて使い回すかは別判断（実装時に詰める）

## Alternatives considered

- **現状維持（preview が本番 DB を見る）**:
  migration 2 段階運用と本番データ汚染が常時のコストとして残る。kozutsumi は個人開発で PR が
  そこまで多くないので「我慢できなくはない」が、Phase 3 以降 migration 頻度が上がっており
  ボトルネック化している。不採用

- **Supabase Branching を使う**:
  Supabase 公式の preview 機能で、PR ごとに ephemeral DB branch を切ってくれる。理想的だが
  **Pro plan ($25/月) 前提** で、kozutsumi の「個人開発・無料運用」制約に合わない。不採用。
  将来 Pro 化したタイミングで本 ADR を supersede する候補

- **PR ごとに ephemeral Supabase project を作る**:
  Supabase free tier は org あたり 2 active project 制限なので、PR ごとに増やせない。
  Supabase API で project を programmatic に作成・削除する経路もあるが、free tier の制限と
  課金リスクの両方が立ちはだかる。不採用

- **Neon 等の Postgres preview branching サービスに DB を乗り換える**:
  Neon は free tier で branching が使える。技術的には preview 問題を最も綺麗に解ける。
  ただし Supabase の Auth / Storage / Realtime / Edge Functions と一体運用してきた前提を
  全部捨てることになり、移行コストが本問題の解決規模を大きく超える。本 ADR の射程外。
  Phase 4 以降に「Supabase 全体の制約が支配的になった」段階で別 ADR で再検討

- **preview env も同じ本番 DB を見るが、preview 用の schema (`preview_*`) に migration を当てる**:
  schema 単位で隔離する案。Supabase の auth schema や RLS との相性が悪く、
  app コード側でも schema prefix を環境ごとに切り替える実装が要る。複雑度に対するメリットが薄い。
  不採用

## Notes

- 環境変数の設定方法・preview DB への migration 適用フロー・preview DB の reset / seed 運用は
  ADR-0048 で扱う（本 ADR は「分離するか否か」だけの判断）
- 漏洩時の対応・credential 管理方針は ADR-0020 の枠組みを preview project 側にも適用する
  （preview 用 `SUPABASE_DB_URL` を GitHub Secrets に置き、step env で渡す）
- 将来 supersede される条件:
  - Supabase Pro plan に移行して Branching が使える状態になった場合
  - Supabase free tier の project 上限が変わって PR ごとの ephemeral project が現実的になった場合
  - DB 自体を別サービス（Neon 等）に乗り換える場合
  - kozutsumi がアルファを抜けて他人のデータを預かるフェーズに入り、preview 環境の隔離要件が
    変わる場合
