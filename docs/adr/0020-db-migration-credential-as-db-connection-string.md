# ADR 0020: DB migration の認証情報は project-scoped な DB connection string を使う

- **Status**: Accepted
- **Date**: 2026-04-28
- **Related**: [ADR 0019](./0019-db-migration-via-manual-github-actions.md)

## Context

ADR-0019 で migration 適用を GitHub Actions に持たせたため、CI 側に Supabase へアクセスするための
認証情報を置く必要がある。Supabase が提供する認証情報は scope が異なる:

| 認証情報 | スコープ | DB に対してできること |
|---|---|---|
| Personal Access Token (PAT) | アカウント全体 | 全 project の管理、billing、project 作成・削除、DB アクセスも可能 |
| DB password (connection string に含まれる) | 1 DB | その project の Postgres に full アクセス（DDL/DML） |
| Service role key | 1 project の API 経由 | RLS bypass で全 row に DML。SQL 直接の DDL には不向き |
| Anon key | 1 project の RLS 越し | RLS 通過範囲のみ |

漏洩時の blast radius を最小化したい。Supabase は **「migration だけ実行できる」scoped token は提供していない**
（2026-04 時点）。

## Decision

CI に置く認証情報は **`SUPABASE_DB_URL`（DB connection string）1 本のみ**とする。

- `postgresql://postgres.<PROJECT_REF>:<DB_PASSWORD>@<host>:6543/postgres` 形式
- workflow 内では `supabase db push --db-url "$SUPABASE_DB_URL"` または `psql` で直接実行する
- PAT は使わず、`supabase link` のような project 紐付けも行わない

## Consequences

### 肯定的影響

- **scope が 1 DB に閉じる**。漏洩しても他 project / billing / アカウント設定は守られる
- **PAT より blast radius が狭い**。直感とは逆だが、PAT はアカウント全体スコープなので DB password より広い
- **workflow がシンプルになる**。`supabase login` / `supabase link` 等の前段が不要で、
  接続文字列を渡すだけで完結する
- **secret が 1 本に集約される**。複数の認証情報を CI に置く必要がない

### 否定的影響・トレードオフ

- **接続文字列に DB password が埋まっている**。漏洩した場合、その DB に対してフルアクセスを許す。
  ただしこの blast radius は PAT より狭く、`auth.users` テーブルや user データへの直接アクセスは可能
- **kozutsumi は無料 Supabase で運用しているため point-in-time recovery がない**。
  漏洩時の最悪ケースでは手動バックアップに依存する → migration workflow 内で適用前に
  `pg_dump` を取って artifact 化する補強で対応する（実装側の話）

### 漏洩時の対応

1. Supabase Project Settings → Database → **Reset database password** で再生成
2. 新しい connection string をコピーして GitHub Repository Secrets の `SUPABASE_DB_URL` を上書き
3. 必要に応じて DB の audit log を確認（Supabase Dashboard）

定期 rotate は半年〜1年程度を目安にする。

## Alternatives considered

- **PAT (`SUPABASE_ACCESS_TOKEN`) + `supabase link`**:
  account 全体スコープになり blast radius が大きい。複数 project や billing まで巻き込まれる。不採用
- **Custom Postgres role (`migrator` 等) で grant を絞る**:
  `migrator` role を作って public schema の DDL/DML だけ許可する案。scope はさらに絞れるが、
  - `auth` schema を触る migration（trigger 追加など）が出ると詰む
  - extension を追加する migration では superuser が必要
  - role 自体の管理（password rotate / grant 追加）が手作業で発生
  - Supabase の DB リセット時に role が消える可能性
  
  運用コストが見合わないため不採用。将来 migration 量が増えて benefit が cost を上回るタイミングで再検討
- **Service role key**:
  PostgREST 経由のアクセスで、SQL 直接実行による migration には向いていない。不採用
- **migration 専用の Supabase アカウントを別途作る**:
  Supabase の利用規約上「machine user / 別アカウント」が許容されるか不明。
  かつ PAT を CI に置くこと自体が DB password より広い scope なので、得られる benefit が薄い。不採用

## Notes

- 接続文字列は GitHub Repository Secrets に置き、workflow では **step env** で渡す
  （job env / workflow env には置かない。compromised action からの secret 抽出を step 単位に閉じる）
- 漏洩リスクの最終判断は ADR-0019 の脅威モデル（個人プロダクト・アルファ期・自分のデータが主）と
  セットで成立している
- 将来 supersede される条件:
  - Supabase が migration-only な scoped token を提供した場合
  - migration の量・複雑度が増えて custom Postgres role の運用コストが見合うようになった場合
  - kozutsumi がアルファを抜けて他人のデータを預かるフェーズに入った場合（脅威モデルが変わるので再評価）
