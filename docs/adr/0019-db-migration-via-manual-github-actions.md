# ADR 0019: DB migration は手動 trigger の GitHub Actions で適用する

- **Status**: Accepted
- **Date**: 2026-04-28
- **Related**: -

## Context

kozutsumi は個人開発で、開発の主戦場が**スマホ**である。
このため、本番 Supabase への migration 適用 (`supabase db push`) を PC からの手動コマンド実行に依存させると、
スキーマ変更を出すたびに PC を開かないと進められず、開発フロー全体のボトルネックになる。

一方、main merge をトリガーにした完全自動 CD は、破壊的 migration（DROP TABLE / NOT NULL 追加 / 型変更など）が
即本番に流れる。kozutsumi は無料 Supabase で運用していて point-in-time recovery が効かないため、
事故の recovery が高コストになる。

「PC 手動」と「完全自動」の中間で、スマホからでも実行できて、かつ破壊的変更を一段止められる仕組みが必要。

## Decision

DB migration の本番適用は、**手動 trigger 専用の GitHub Actions workflow** で行う。

- Trigger は `workflow_dispatch` のみ。`push` / `pull_request` 等の自動 trigger は使わない
- `production` environment を作り、**approval required** に設定する。reviewer は repo owner（自分）
- スマホからは GitHub アプリで「Run workflow」→ approval を承認、の 2 タップで適用できる
- workflow からの呼び出し方法は ADR-0020 で別途決める

## Consequences

### 肯定的影響

- **スマホ運用が成立する**。PC を開かずに migration を流せる
- **破壊的変更の事故防止が一段挟まる**。approval ステップで「diff 見てから承認」できる
- **GitHub の権限モデルで保護される**。`workflow_dispatch` は repo の write 権限保有者しか実行できないため、
  fork PR や外部からの誘発はない（`pull_request_target` のような落とし穴も避けられる）
- **secret は GitHub Secrets に閉じる**。PC の `.env.local` に置きっぱなしにするより、
  漏洩経路（laptop 紛失 / 誤コミット / shell history）が減る

### 否定的影響・トレードオフ

- **GitHub Actions の supply chain 攻撃を受け得る**。依存 action が乗っ取られた場合、
  step 内の secret が抜かれる可能性は残る。kozutsumi の脅威モデル（個人プロダクト・アルファ期・
  自分のデータが主・migration workflow は週0〜数回しか動かない）では許容範囲と判断
- **approval ステップの分だけ実行に時間がかかる**。即時性は落ちる（が migration はそもそも
  即時性が必要な操作ではない）
- **workflow のメンテ対象が増える**。CI 既存 workflow に加えて migration workflow を維持する必要がある

### Approval gate の意味の限定

approval gate の目的は **「破壊的 migration の事故防止」** であり、
**supply chain 防御ではない**。approve した瞬間に runner が起動して secret が注入されるため、
compromised action からの secret 抽出は approve のタイミングと無関係に起きうる。
ここを混同しない。

## Alternatives considered

- **PC からの手動 `supabase db push`**: 現状維持案。スマホ運用要件と相反するため不採用
- **main merge 起点の完全自動 CD**: 破壊的変更が即本番に流れるリスクが許容できないため不採用。
  PR 時点で `supabase db diff` を bot コメントに出す + lint で破壊的変更を検出する、
  といった補強でも、ヒトのレビューが間に挟まらないと事故率が下がりきらないため
- **PR コメント `/migrate` での trigger**: 仕組みとしては可能だが、
  `workflow_dispatch` + Environment approval と blast radius が変わらない上、
  実装が複雑になるため不採用

## Notes

- supply chain hardening（action の SHA pin / step env / minimal permissions など）は
  リポジトリ全体に対する横断的方針として別途扱う（pinact 等の自動化ツールでまとめて適用）。
  本 ADR では migration workflow 個別の話としては扱わない
- 漏洩時の対応（DB password rotate）と認証情報の選択は ADR-0020 を参照
- 将来 supersede される条件:
  - スマホ運用要件が変わって PC 手動運用が現実的に戻った場合
  - Supabase Edge Function 等、別の実行基盤に migration 実行を移す場合
  - 自動化要件が高まって approval gate が運用負荷になった場合（破壊的変更を別経路で検知できる仕組みとセットで再検討）
