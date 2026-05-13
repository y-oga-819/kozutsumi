# ADR 0065: 1-tap 割り込みは source 別に複数ボタン (Slack / Notion / PR Review) を並べる

- **Status**: Accepted
- **Date**: 2026-05-13
- **Related**: Supersedes [ADR-0059](./0059-one-tap-interrupt-recording.md) / `docs/design/architecture.md` §1.5 / [ADR-0058](./0058-timer-three-verbs-and-no-ai-interruption.md) / [ADR-0062](./0062-morning-review-ritual-fifteen-minutes.md) / Issue #239

## Context

[ADR-0059](./0059-one-tap-interrupt-recording.md) で「割り込みは専用ボタン 1 タップ、事前分類なし」を決め、Issue #239 で実装した。dogfooding 設計段階で見直すと、想定ユーザーの実際の割り込みは **発生源 (source) が user 視点で即座に判別できる**:

- Slack の通知音 / バッジ
- Notion のメンション通知
- PR Review コメントの通知

source は「割り込まれた瞬間に user 自身が知っている情報」であって、後段で推測すべきカテゴリ抽象ではない。事前に source を捨てて朝の棚卸し (ADR-0062) で再構成しても、復元精度は下がる (= 情報量は事前 1-tap の時点で最大)。

ADR-0059 の Alternatives で却下した「ボタンで分類を選ばせる」は **MTG / 緊急 / 雑談** のような **カテゴリ抽象** を想定していた (= 「これは MTG か雑談か」は本人でも揺れる)。source 分類はそれとは性質が違うため、ここで再判断する。

## Decision

割り込みボタンは **source 別に複数並べる**:

- 当面は **Slack / Notion / PR Review の 3 ボタン**を hardcoded で配置する
- 各ボタンは 1 タップで:
  1. 現在の timer を **停止 (paused)** する
  2. **`task_interrupted` イベントを記録**する。`metadata.source` に押したボタンの値を入れる
  3. **割り込みタスクは stack に push しない** (= ADR-0059 から維持)
- modal は経由しない (= ボタン側で source が確定するので reason 選択は不要)

「ユーザーが触る動詞」は ADR-0058 の start / stop / complete + 本 ADR の **source 別 interrupt 群** という構造で固定する。1 タップで完了する不変条件は維持される (タップ回数は 1 のまま、ボタン総数だけ増える)。

source 値は schema 上 `string` で保持する (TS レベルで union 型として `"slack" | "notion" | "pr_review"` に制約する一方、DB の `action_logs.metadata` は JSONB なので将来 user-defined source を追加しても migration は不要)。

## Consequences

### 肯定的影響

- 行動データの粒度が source 単位で取れる。朝の棚卸し (ADR-0062) や週次 / 四半期 Wrapped (M-δ) で「Slack 割り込みが集中する時間帯」「PR Review 割り込みが過集中を切る頻度」等が **追加コストなしで** 分析できる
- 朝の棚卸しでの事後分類負荷が下がる (source は確定済み)
- 押す瞬間に「何に割り込まれたか」を user が言語化することで、自己観察 (Barkley "Externalize Key Information") の質が上がる
- 「事前分類を要求しない」原則は本 ADR で source 分類に限り緩めるが、**カテゴリ抽象 (MTG / 緊急 / 雑談)** の事前分類は引き続き不採用 (ADR-0059 Alternatives の判断は source 分類以外には残す)

### 否定的影響・トレードオフ

- ADR-0059 の「ボタンは 1 個」が「ボタンは N 個 (現状 3)」に変わる。Top カードに専有面積が増え、ボタン数が増えれば見た目の摩擦は上がる。ADR-0058「ユーザーが触るのは timer の 3 動詞だけ」原則の **動詞数増加** に該当する側面はある (start / stop / complete + interrupt × N)
- ボタンに表示する source 名 (Slack / Notion / PR Review) が増えるごとに UI 配置設計が壊れうる (現状 3 個は許容範囲、5 個を超えたら別 UI を検討)
- ADR-0059 Alternatives で却下した「分類を選ばせる」と表面的には矛盾するため、ADR の判断履歴を読む者に対する説明コストが上がる
- 3 source 以外の割り込み (例: 同僚の声かけ / 紙のメモ) は記録手段が無い。当面はそのまま落として OK (= dogfooding で頻度を観察してから追加判断)

### 後から見たときの判定軸

本 ADR を将来 supersede する trigger:

- dogfooding で「3 source の枠が窮屈で、押せない割り込みが頻発」と判明
- user-defined source の追加要求が定期的に出る (= settings 経由で追加 UI を作る判断)
- ボタン群が画面を圧迫してタスク title 視認性が落ちる (= 別 UI 構造へ)

## Alternatives considered

- **ADR-0059 の現状維持 (ボタン 1 個 + 朝の棚卸しで事後分類)**: source 情報を 1-tap 時点で捨てるのは情報量を loss する。朝の棚卸しでの分類復元精度は実証されていない。dogfooding の前段階でわざわざ情報を捨てる必要がない。不採用
- **設定画面で user 自身が source を追加・編集できるようにする (一段階目から)**: 「最初の dogfooding で使う source 数」が不確定なため、設定 UI を先に作ると yagni。Slack / Notion / PR Review の 3 個は実体験ベースで確実に押す source、これを hardcoded で先に出す方が高速。将来追加要求が定期的に出てから設定 UI を別 ADR で起票する。不採用
- **source 別に action_type を分ける (`task_interrupted_slack` / `task_interrupted_notion` / ...)** : SELECT 文がシンプルになる利点はあるが、source を増やすたびに `ACTION_TYPES` 名義が爆発して logger.ts / types.ts / test の更新が広がる。`task_interrupted.metadata.source` で吸収すれば 1 action_type のまま source を増減できる。不採用
- **割り込みボタンを Top カード以外 (画面下部・固定 FAB 等) に置く**: Top カード内に置くことで「今走っている timer をどう扱うか」と「割り込み記録」が同じ視野に収まる。FAB 化は導線が遠くなり 1-tap 主義の体感を損なう。不採用

## Notes

- 本 ADR は ADR-0059 を完全 supersede する。ADR-0059 の Decision (停止 + 記録 + stack push しない) のうち停止と「stack に push しない」は維持され、「分類なし」だけが上書きされる。読み手が混乱しないよう、ADR-0059 側を `Superseded by ADR-0065` に書き換える
- architecture.md §1.5 は「専用ボタン 1 タップ」と書いてあるが、本 ADR でも「1 タップ」自体は維持される (= ボタン数が増えても 1 push で完了する不変条件は同じ)。文面整理は軌道修正 ADR 群 (0057〜0065) 確定後にまとめて反映する
- 朝の棚卸し (ADR-0062) で「この割り込みをタスクに昇格」する操作は、metadata.source がある分 source filter / グルーピングが効きやすくなる。具体 UI は M-γ の枠で別 issue
- 将来の user-defined source 対応で見直す条件: dogfooding で 3 source 以外の押したい source が定期的に観察される、もしくは「source が思い出せない」割り込みが多発する
