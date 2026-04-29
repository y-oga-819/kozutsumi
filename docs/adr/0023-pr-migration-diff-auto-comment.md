# ADR 0023: PR ごとに DB migration の schema diff を自動コメントする

- **Status**: Accepted
- **Date**: 2026-04-29
- **Related**: [ADR-0019](./0019-db-migration-via-manual-github-actions.md) / [ADR-0020](./0020-db-migration-credential-as-db-connection-string.md)

## Context

ADR-0019 で本番 migration は `workflow_dispatch` の手動 trigger + approval で適用すると決めた。
approval gate の目的は **「破壊的 migration の事故防止」** であり、approve するためには
**migration を読んで安全か判断できる** 必要がある。

しかし `supabase/migrations/*.sql` を読むだけでは以下が見えにくい:

- 既存行への影響（NOT NULL カラムを default なしで追加していないか / enum 値削除がないか）
- RLS 規約（`public` の新テーブルに RLS が有効化されているか / owner-only ポリシー 4 種が揃っているか）
- 外部キーの ON DELETE policy（`CASCADE` / `SET NULL` / `RESTRICT` / 未指定）
- 「migration を全部当てた後の最終的なスキーマ」と main のスキーマの差分

スマホで approve する運用（ADR-0019）では、SQL ファイルを開いて読むコストがさらに高い。
PR の段階で **最終スキーマの差分とプロジェクト規約違反の自動検査** をコメントとして出せば、
approve 判断が「コメントを読む」だけで完結する。

## Decision

`supabase/migrations/**` を変更する PR に対し、**既存 `.github/workflows/ci.yml` の
`supabase` job を拡張**して、main / PR それぞれに migration を適用したスキーマの
スナップショットを取り、構造化された差分とプロジェクト規約違反のチェック結果を
sticky コメントとして PR に投稿する。

- 別 workflow に切り出さない。既存 `supabase` job が既に `supabase start` +
  `supabase db reset --no-seed` でフル migration 適用状態を作っているため、
  その状態を再利用すれば追加コストは **`db reset` 1 回 + snapshot + 投稿で +20 秒程度**
  で済む。別 workflow にすると `supabase start` (2 分強) を二重に払うことになる
- Trigger: 既存 `supabase` job と同じ (`pull_request` で `supabase/**` が変更された時)
- 差分の出し方: `pg_dump --schema-only` の生 diff + `information_schema` / `pg_catalog` から
  取った構造化スナップショットの diff の両方を出す
- 構造化スナップショットの対象: tables (relkind in `r`/`v`/`m` を `kind` で識別) /
  columns / constraints / foreign_keys / indexes / policies / enums / views
  (definition + `security_invoker` / `security_barrier` reloptions)
- 規約チェック (`❌` / `⚠️` / `✅`):
  - `❌` `public` の新テーブルに RLS が有効化されていない
  - `❌` カラム追加で NOT NULL かつ default なし（既存行で fail）
  - `❌` enum 値の削除（互換性破壊）
  - `❌` 新規 view / matview に `security_invoker = true` が指定されていない（postgres の view は
    未指定だと **definer 権限で評価され RLS をバイパス**するため、kozutsumi では原則必須）
  - `❌` 既存 view の `security_invoker` が `true → false` に変更された（RLS 迂回経路ができる）
  - `⚠️` `public` の新テーブルで owner-only ポリシー 4 種（select / insert / update / delete）が揃っていない
  - `⚠️` 外部キーの ON DELETE policy が未指定（`NO ACTION` のまま）
- `❌` が一つでもあれば workflow は fail（job exit code 非ゼロ）。`⚠️` は警告のみ
- 比較は **PR の HEAD vs main の現 HEAD (`github.event.pull_request.base.sha`)** で行う。
  fork point ではなく現 HEAD と比較するのは **「今この PR を merge した時の最終スキーマ」を
  示すため**。副次効果として、main にあって HEAD に無い migration があれば
  「rebase が必要」シグナルとしてコメント冒頭に warning を出す（PR ブランチが古いことを検知できる）
- main 状態への巻き戻しは `git restore --source="$BASE_SHA" --worktree --staged --
  supabase/migrations/` で行う（`git checkout <ref> --` は overlay モードで PR が追加した
  新規ファイルを消せないため、base 状態が再現できない）
- 生 diff 比較前に pg_dump 17 が出力する `\restrict` / `\unrestrict` のランダムトークン行を
  両 dump から削除する（毎 dump で値が変わるため、実差分なしでも 2 行偽の diff が出るのを防ぐ）
- コメントは [marocchino/sticky-pull-request-comment](https://github.com/marocchino/sticky-pull-request-comment) で
  push のたびに同じコメントを上書き更新する
- workflow から本番 DB へは一切接続しない。ephemeral Supabase local stack のみ使う

## Consequences

### 肯定的影響

- **ADR-0019 の approval gate が実効的になる**。スマホで approve する時に「この PR を当てると
  既存行が NULL violation で落ちる」「RLS が外れている」が一目で分かる
- **kozutsumi 規約の自動検査ができる**。RLS / owner-only policy の付け忘れ、ON DELETE の指定漏れを
  人間レビュー前に弾ける
- **生 diff も併載する**ので、構造化サマリで取りこぼしたケース（COMMENT 追加・関数追加 etc）も
  reviewer が拾える
- **本番 DB に触らない**。ADR-0020 の DB credential を使わない（fork PR 等の経路でも安全）

### 否定的影響・トレードオフ

- **CI 時間が +2〜3 分**。`supabase start` が支配的（2 分強）。`supabase/migrations/**` を
  変更する PR でしか走らないので、頻度は低い
- **構造化スナップショットのカバレッジは限定的**。本 ADR では columns / tables / constraints /
  foreign_keys / indexes / policies / enums / views(definition + reloptions) のみ対象。
  functions / triggers / sequences は生 diff のみ（必要になったら別 ADR で拡張）
- **規約チェックは false positive を起こしうる**。例外的に RLS を意図的に外したい場合の
  override 機構は持たない（必要になったら別 ADR で扱う）
- **fork PR からの実行**は制限される。`pull_request` トリガーで `pull-requests: write` 権限を
  与えるため、`pull_request` イベントの fork PR では権限が read に降格する。kozutsumi は
  個人開発で fork PR の想定はないので許容

### 規約チェックの失敗を fail にする線引き

`❌` (fail) と `⚠️` (warn) の線引きは **「migration を main に merge した時点で本番に
既知の問題が混入するか」** で判定する:

- `❌`: merge → workflow 手動 trigger で本番に流すと **必ず壊れる / セキュリティ違反になる**
  （NOT NULL violation / RLS なし / enum 値削除）
- `⚠️`: 規約上望ましくないが、merge しても直ちに壊れない（owner policy 不足は他のクライアントが
  ないため即時の漏洩にはならない / ON DELETE 未指定は意図的なケースもありうる）

`⚠️` を fail に格上げするかどうかは運用しながら判断する（本 ADR では含めない）。

## Alternatives considered

- **生 `pg_dump` diff のみコメント**: 実装は簡単だが、レビュアーが diff を読んで規約違反を
  目視で拾う必要がある。スマホでの approve コストが下がらないため不採用
- **専用 workflow ファイルとして新規作成**: 責務が明確になるが、`supabase start` を二重に
  払う (CI 時間 +2 分強)。既存 `supabase` job も migration 適用がメインの仕事なので、
  「migration を当ててみる + 差分を出す」を 1 job に集約する方が責務として綺麗
- **`supabase db diff` ベース**: Supabase CLI 提供の diff 機能。生成 SQL の質は
  pg_dump diff より読みやすいが、構造化サマリ（カラム単位の Nullable / Default や RLS 検査）には
  使えない。生 diff としては選択肢になりうるが、本 ADR では `pg_dump --schema-only` の diff に
  揃える（migration workflow 側の `pg_dump` (ADR-0020) と道具を統一する）
- **PR ブランチへの自動コミット (生成スキーマを `supabase/schema.sql` として commit)**:
  push 権限の管理（PAT / GitHub App）と fork PR の扱いが複雑になる。人間がレビューするのは
  「結果がどう変わるか」であり、ファイルとして commit する必要はない。コメントで足りる
- **規約違反は警告のみで fail させない**: 規約違反が混入した PR が approve されると
  本番に流れる。approval gate は規約違反まで弾く設計ではない（破壊的変更の事故防止が主目的）ため、
  ここは CI 側で fail させる方が役割分担として明確

## Notes

- 構造化スナップショットの収集対象は `public` schema のみ。`auth` / `storage` 等の
  Supabase 管理スキーマは触らない
- 本 ADR は **migration の可視化と自動レビュー** が目的。本番への適用フローは ADR-0019 の
  手動 workflow に従う（自動適用に寄せる ADR ではない）
- 将来見直す条件:
  - 構造化スナップショットの対象を functions / triggers に広げたくなった
  - `⚠️` レベルの違反も fail にしたくなった（例: RLS policy 不足を厳格化）
  - Supabase CLI の `db diff` が pg_dump diff を超える品質になった
- 改訂履歴:
  - 2026-04-29: 初版（PR #136）
  - **2026-04-29 改訂**:
    - **base 状態巻き戻しの不具合修正**: 旧実装は `git checkout <BASE_SHA> --
      supabase/migrations/` で base に戻していたが、これは overlay モードのため PR が
      新規追加した migration ファイルを working tree から消せず、`supabase db reset`
      で **PR の migration が base 側にも適用される** バグがあった。結果、構造化サマリ /
      生 diff いずれも「変更なし」になり、新規 migration が事実上スキップされていた
      （PR #135 のコメントが該当例）。`git restore --no-overlay` 相当に置換して修正
    - 構造化スナップショットに **view / matview** を追加。columns 側にも `kind` を付け、
      view 由来の列が「既存テーブルへのカラム追加」として誤検出されないようにした
    - **`security_invoker = true`** を新規 view の必須要件として追加（未指定 view は
      definer 権限で評価され RLS を迂回するため）。既存 view からの `security_invoker`
      除去も `❌` 扱い
    - main 現 HEAD 比較の副次効果として **rebase 必要シグナル** をコメント冒頭に表示
      （main にあって HEAD に無い migration を検出してリスト表示）
    - 生 diff 比較前に pg_dump 17 の `\restrict` / `\unrestrict` ランダムトークンを除去
      （差分ゼロでも 2 行ノイズが出る問題の解消）
