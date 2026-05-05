# ADR 0043: preview DB への migration は PR push 起点の GitHub Actions で自動適用する（共有 1 project / 後勝ち）

- **Status**: Superseded by [ADR-0048](./0048-preview-db-migration-manual-dispatch.md)
- **Date**: 2026-05-04
- **Related**: [ADR-0019](./0019-db-migration-via-manual-github-actions.md) / [ADR-0020](./0020-db-migration-credential-as-db-connection-string.md) / [ADR-0023](./0023-pr-migration-diff-auto-comment.md) / [ADR-0042](./0042-preview-env-uses-separate-supabase-project.md)

## Context

ADR-0042 で preview env は本番と別の Supabase project を見ると決めた。preview project に
**PR HEAD の migration が当たった schema** を反映する仕組みが必要になる。

選択肢としては (a) PR ごとに DB を分離する / (b) 全 PR で 1 個の preview DB を共有する
の 2 軸があり、それぞれ migration 適用方法が変わる。

(a) は理想的だが、Supabase free tier の 2 active project 上限と PR 数の動的性から実現困難
（ADR-0042 で却下済み）。残るは (b) で、共有 DB に「どう migration を当てるか」「衝突をどう
扱うか」を決める必要がある。

kozutsumi の運用前提:

- 個人開発で **同時に open している PR は 1〜2 本** が普通。並行 migration の頻度は低い
- preview DB は永続価値なし（ADR-0042 / 使い捨て前提）
- 本番 DB の migration 適用フロー（ADR-0019 の手動 + approval）は維持する必要がある
- ADR-0023 の PR migration diff コメントワークフローは ephemeral local Supabase で完結しており、
  preview project には触っていない

## Decision

preview Supabase project への migration 適用は、**PR の `synchronize` / `opened` / `reopened`
イベントで起動する GitHub Actions ワークフロー**で `supabase db push` を行う。共有 1 project に
**後勝ち**で適用する。

- Trigger: `pull_request` の `opened` / `synchronize` / `reopened`、`paths: supabase/migrations/**`
  でフィルタ
- 認証: `SUPABASE_PREVIEW_DB_URL` を GitHub Secrets に置き、step env で渡す（ADR-0020 と同じ
  hardening 方針）
- 適用コマンド: `supabase db push --db-url "$SUPABASE_PREVIEW_DB_URL"`
- **本番 DB には一切触らない**。secret も別物（`SUPABASE_DB_URL` は本番、`SUPABASE_PREVIEW_DB_URL`
  は preview）
- PR がマージ / クローズされたとき、または定期 cron で **preview DB を main 状態にリセット**
  するワークフローを別途持つ（後勝ち汚染の累積を防ぐ）
- ADR-0019 の本番 migration workflow は変えない（手動 + approval を維持）
- ADR-0023 の PR migration diff コメントワークフローも変えない（preview への apply とは別レイヤー）

## Consequences

### 肯定的影響

- **migration 入り PR を 1 PR で動作確認できる**。ADR-0042 の主目的が達成される
- **本番 DB は一切触らない**ので、preview の自動化が production の安全装置（ADR-0019 の approval）
  を侵食しない
- **secret が物理的に分かれる**。preview DB credential が漏れても本番 DB は守られる
- **既存の本番 migration workflow との責務分離が明確**。ファイルとしても別 workflow になり、
  どちらを触っているか一目で分かる
- **個人開発の運用コストに合う**。並行 PR が少ないので「後勝ち + 定期リセット」で実用上回る

### 否定的影響・トレードオフ

- **共有 1 project なので並行 PR 間で schema が衝突する**。複数 PR が同時に異なる migration を
  push すると最後に push した PR の schema が乗り、他 PR の preview は壊れた状態を見る
- **後勝ち汚染が累積する**。merge されずに close された PR の migration が DB に残り続ける。
  定期リセット（または PR close hook）で main 状態に戻さないと preview DB が乱雑になる
- **migration 適用が失敗した PR は preview DB を pending 状態で残す**。CI 上は workflow fail で
  検知できるが、次の PR push が失敗修正を含む migration なら救えるが、無関係な PR の push なら
  preview DB の pending 状態が長引く
- **Vercel の preview build と migration 適用の順序保証がない**。Vercel は push を受けて build を
  始め、GitHub Actions は並行で migration を流す。先に build が終わって preview に到達した瞬間は
  「コードは新 schema 期待・DB は旧 schema」の窓ができる。実用上は数十秒の窓なので、PR レビューで
  見るときには解消している前提で許容する
- **PR 作者が migration apply の status を意識する必要がある**。Actions の job が green になって
  から preview を確認する運用になる
- **preview DB の reset 運用を別途設計・実装する必要がある**。本 ADR では「リセット workflow が
  必要」とだけ決めて、具体実装（PR close hook or 週次 cron or 両方）は実装 issue で詰める

### 何をしないか（境界）

- **PR ごとの ephemeral DB / schema 分離はしない**。ADR-0042 の制約（free tier 2 project 上限）
  と複雑度から非現実的
- **migration を down / rollback する仕組みは持たない**。preview DB は使い捨て前提なので、
  「壊れたら main 状態に reset」で対応する
- **Vercel deploy hook と GitHub Actions を同期させない**。順序保証は諦め、数十秒の窓を許容する
- **本番 migration workflow（ADR-0019）の trigger を変えない**。本 ADR は preview 経路を
  追加するだけで、production は手動 `workflow_dispatch` + approval のまま

### 「後勝ち」を許容する根拠

並行 PR が少ない（実測 1〜2 本同時 open）個人開発で、**「最後に push した PR の schema が他 PR の
preview を一時的に壊す」確率は低く、壊れても再 push で復旧できる**。完璧な隔離（ADR-0042
Alternatives で却下した PR ごと ephemeral project）に必要なコストは、現状の PR 頻度に対して
過剰。並行 PR が常時 3 本以上になったら本 ADR を見直す。

## Alternatives considered

- **PR ごとに schema を分けて 1 project 内で隔離する** (`preview_pr_<n>` schema):
  app 側で schema prefix を環境変数で切り替える実装が必要。Supabase の auth schema との
  境界も難しい。複雑度に対する benefit が薄い。不採用

- **Vercel deploy hook で preview build 内から `supabase db push` を実行する**:
  build environment に DB credential を置く必要があり、Vercel の secret 管理経路が増える。
  build と migration が同じ workflow になり、片方の失敗が build 全体を失敗させる結合度の高さも
  問題。GitHub Actions に分離する方が責務が綺麗。不採用

- **`workflow_dispatch` で手動 trigger する**（本番と同じ運用）:
  本番と同じ慎重さは不要（preview DB は使い捨て）。手動 trigger を毎 PR 強制すると ADR-0042 の
  「1 PR で完結する」目的が達成できない（push のたびに workflow を回す手間が出る）。不採用

- **PR merge 時に main の migration を preview に当てる**:
  merge 時しか preview DB が更新されない。PR レビュー時点で migration が反映されていないので
  ADR-0042 の目的を満たさない。不採用

- **後勝ちではなく「先勝ち」（最初に push した PR の schema を保持）**:
  実装が複雑（schema_migrations の状態を見て判定する必要があり、PR ごとの優先度判断も要る）。
  個人開発のシンプルさを失う。不採用

- **Supabase CLI の `db diff` で生成 SQL を preview に当てる**:
  ADR-0023 が既に migration files の整合性を検証しているので二重。本 ADR は **本物の
  migration files を本物の DB に当てる**ことが目的（preview 環境を本番と同じ deploy 経路で
  再現する）ので、`db diff` 経由ではなく `db push` を使う

## Notes

- 実装単位（GitHub Actions workflow ファイル / Vercel env 設定 / preview project の auth 設定 /
  reset workflow）は別 issue で起票する
- 本 ADR は **preview 自動化** が目的。本番への適用は ADR-0019 の手動 workflow に従う
- preview DB の reset 戦略（PR close hook / 週次 cron / 両方）は実装時に詰める。本 ADR では
  「リセット手段が必要」とだけ決める
- 漏洩時の対応は ADR-0020 の枠組みを `SUPABASE_PREVIEW_DB_URL` にも適用する（dashboard で
  password を reset → GitHub Secrets を更新）
- 将来 supersede される条件:
  - Supabase Pro plan に移行して Branching が使える状態になった場合（ADR-0042 と同時に
    supersede される）
  - 並行 open PR が常時 3 本以上になり、共有 1 project の衝突が運用負荷として顕在化した場合
  - preview build と migration 適用の順序保証が必要になった場合（feature flag 連動など）
