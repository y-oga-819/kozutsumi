# ADR 0048: preview DB への migration は手動 `workflow_dispatch` のみで起動する

- **Status**: Accepted
- **Date**: 2026-05-05
- **Related**: Supersedes [ADR-0043](./0043-preview-db-migration-auto-apply-on-pr-push.md) / [ADR-0042](./0042-preview-env-uses-separate-supabase-project.md) / [ADR-0019](./0019-db-migration-via-manual-github-actions.md) / [ADR-0023](./0023-pr-migration-diff-auto-comment.md) / Issue #203

## Context

ADR-0043 で「PR push 起点の自動 apply / 共有 1 project / 後勝ち」を選び、`db-migrate-preview.yml`
が `pull_request` の `opened` / `synchronize` / `reopened` で `supabase db push` を流す運用にしてきた。

実運用してみて、共有 preview DB × 自動 apply の構造から **複数の papercut** が累積した（Issue #203 で
5 症状を整理）:

1. silent skip — 別 PR が先に同 timestamp を push 済だと、自 PR の `db push` は exit 0 だが SQL が
   実行されない（`Remote database is up to date.`）。CI green、preview は壊れたまま
2. open PR 横断の timestamp / ADR 番号衝突を検知できない（compare.mjs は HEAD vs main しか見ない）
3. migration revise 時に preview が stale のまま（schema_migrations に同 version が残るため再適用されない）
4. 別 PR が `schema_migrations` を占拠した後にこちらが rebase / rename すると `Remote migration versions
   not found` で hard fail
5. pooler URL（`:6543`）を踏むと `lrupsc` 系 error で intermittent fail（既に対応済）

これらは個別パッチ（issue #203 案 A〜E）で 1 つずつ潰せるが、**共有 DB に複数 PR が並行 apply する**
構造そのものから派生しているので、対処療法を続ける限り別の症状が生え続ける。

根本対処の選択肢を比較した:

- α: 手動 `workflow_dispatch` のみ（自動を捨てる）
- β: GitHub Environment の approval gate（自動 trigger + 承認待ち）
- γ: Supabase Branching（per-PR ephemeral DB）

前提条件の確認:

- preview DB の **唯一の用途は Vercel Preview Deployment の手動ブラウザ確認**。e2e は local supabase
  stack で完結している（`ci.yml` の e2e job）、migration 検証も ephemeral local Supabase で完結している
  （ADR-0023 の `compare.mjs` 経路）。preview DB に migration を当てる目的は **PR レビュー時に Vercel
  preview を開いて触る** ためだけ
- kozutsumi の運用前提（ADR-0042 / 0043 から継承）: 個人開発、並行 open PR は 1〜2 本、無料運用、
  preview DB は使い捨て、本番 DB の手動 + approval（ADR-0019）は維持

## Decision

`db-migrate-preview.yml` の起動 trigger を **`workflow_dispatch` のみ**に変更する（`pull_request`
trigger を削除）。operator が Vercel preview を確認したい瞬間に明示的に打つ運用にする。

- 共有 1 project / 後勝ち / `supabase db push` の本体は ADR-0042 のまま継続
- 既存の `concurrency: preview-db` group / `db-reset-preview.yml` / ADR-0023 の PR diff comment /
  ADR-0019 の本番経路は変更しない
- 「打ち忘れ」失敗モードは許容する（Vercel preview を実際に開いた瞬間に気付けるため）

## Consequences

### 肯定的影響

- **症状 1 / 3 / 4 が構造的に消える**。operator が打った瞬間にしか共有 DB が変化しないので、複数 PR が
  並行 apply して状態を取り合う事象そのものが起きえない
- **preview DB の状態を常に operator が認知できる**。「今この preview に何の migration が当たっているか」が
  自分が打った操作と直結する
- **触らない PR は preview DB に副作用を出さない**。merge せず close した PR の migration が DB に残る
  累積汚染が発生しにくい（reset workflow の役目が小さくなる）
- **実装が極小**。`db-migrate-preview.yml` の `on:` から `pull_request:` を削るだけ
- **issue #203 案 A〜E のパッチ実装が不要になる**。対処療法を積まずに済む

### 否定的影響・トレードオフ

- **PR push → 即 Vercel preview を見る flow が一手間増える**。push → 自分で `db-migrate-preview` を
  `workflow_dispatch` で起動 → preview を開く、の順
- **打ち忘れ失敗モード**: migration を含む PR で apply せずに preview を開くと旧 schema のまま UI が
  壊れる。実用上は preview を開いた瞬間に気付けるので致命にはならないが、認知負荷は増える
- **将来並行 PR が増えた時の自動化価値を失う**。個人開発スケール（1〜2 並行）では問題ないが、
  チーム化や PR 頻度が上がった時に手動コストが顕在化する
- **issue #203 の症状 2（open PR 横断の timestamp / ADR 番号衝突検知）は本 ADR では消えない**。
  これは「事前に他 PR の migration ファイル名 / ADR 番号を見る」検知レイヤの話で、preview への
  apply 経路とは独立。必要なら別経路（post-merge 検知 / `kozutsumi-adr` skill 内 grep 等）で扱う

### 何をしないか（境界）

- **`pull_request` trigger を残しつつ Environment approval gate を足す（β 案）はしない**。既に
  `concurrency: preview-db` で apply / reset は serialize されており、approval gate を足しても
  「直列化」の追加価値はない。むしろ PR push のたびに pending が積み上がり UI ノイズが増える
- **per-PR ephemeral DB（γ 案 / Supabase Branching）はしない**。本 ADR の射程外（ADR-0042 の
  supersede 候補として将来再評価）
- **本番経路（ADR-0019）の trigger は変えない**。本 ADR は preview 経路のみを変更する

### 「自動を捨てる」根拠

preview DB の唯一の用途が Vercel preview の手動確認であり、自動 apply の価値は「PR push 直後に
preview URL を開いた瞬間、新 schema が当たっている」ことに尽きる。個人開発で Vercel preview を
**毎 PR push のたびに即開くわけではない**（むしろ週単位の dogfooding や PR まとめ確認が中心）ので、
「見たい瞬間に打つ」手動 trigger で実用上回る。一方で自動 apply が引き起こす 5 症状は、頻度こそ
低いが 1 度踏むと debug が長く preview を信用できない期間が発生する。費用対効果として手動に倒す
方が筋が良い。

## Alternatives considered

- **β: GitHub Environment の approval gate（自動 trigger + 承認待ち）**:
  - 既に `concurrency: preview-db` で apply / reset は serialize 済み。approval を足しても直列化
    のメリットは重複
  - PR push のたび pending が生成され、見るつもりがない PR でも UI ノイズが発生する
  - 「approve click 1 回」と「手動 trigger 1 回」のコストはほぼ同じ。pending 管理コストが上乗せ
    される分、α より重い
  - 不採用

- **γ: Supabase Branching（per-PR ephemeral DB）**:
  - 構造的には 5 症状の 1 / 3 / 4 を最も綺麗に解消する
  - usage-based 課金（$0.01344/h、Spend Cap 対象外）が発生し、kozutsumi の「個人開発・無料運用」
    制約に合わない
  - 5 分 idle で auto-pause → cold start、auth admin API の privilege 抜け等、新規制約が複数
  - ADR-0042 の supersede 条件（Pro 化 / チーム化）と同時に再評価する候補。本 ADR の射程外
  - 不採用（将来候補として残す）

- **Issue #203 案 A〜E のパッチ継続**:
  - 5 症状のうち 1 個ずつ対処療法を積む。共有 + 自動 apply の構造は残るので、別の症状が生え続ける
    リスク
  - 案 A（silent skip 検知）だけでも価値はあるが、stale / 占拠 / 衝突等の運用負荷は手動 reset
    操作で吸収する必要があり、結局「半手動」になる。最初から手動に倒した方が実装コストが小さい
  - 不採用

- **PR merge 時に main の migration を preview に当てる**:
  - merge 時しか反映されない → PR レビュー時点で migration が反映されず ADR-0042 の preview の
    目的を満たさない
  - 不採用

## Notes

- 実装単位: `db-migrate-preview.yml` の `on:` から `pull_request:` セクションを削除し、
  `workflow_dispatch:` のみ残す。それ以外の step / secret / concurrency は変更不要。実装は別 PR
  で扱う
- 本 ADR は preview への apply 経路のみを変更する。ADR-0023 の PR diff comment（local Supabase で
  完結）/ ADR-0019 の本番経路 / ADR-0042 の preview project 分離はそのまま
- Issue #203 のうち本 ADR で**解消するもの**: 症状 1 / 3 / 4
- Issue #203 のうち本 ADR で**解消しないもの**: 症状 2（open PR 横断の timestamp / ADR 番号衝突
  検知）。これは別経路で扱う判断を別途行う
- 症状 5（pooler URL ガード）は既に対応済み（本 ADR とは独立）
- 将来 supersede される条件:
  - Supabase Branching を採用する判断（ADR-0042 と同時に supersede される可能性が高い）
  - 個人開発 → チーム化して並行 PR が常時多くなり、自動化の価値が手動コストを上回るタイミング
  - 「打ち忘れ」の頻度が無視できないレベルになった場合（β に倒す再評価）
