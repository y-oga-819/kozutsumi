# ADR 0059: 突発割り込みは 1-tap で timer 停止 + イベント記録、stack には push しない

- **Status**: Superseded by [ADR-0065](./0065-interrupt-buttons-per-source.md)
- **Date**: 2026-05-10
- **Related**: `docs/design/architecture.md` §1.4 / [Issue #234](https://github.com/y-oga-819/kozutsumi/issues/234) / [ADR-0058](./0058-timer-three-verbs-and-no-ai-interruption.md) / [ADR-0062](./0062-morning-review-ritual-fifteen-minutes.md)

## Context

想定ユーザーの日常 (Slack / Notion / huddle / 突発の huddle 等) では小さな割り込みが頻発する。現 architecture §1.4 「割り込みのスタック表現」では割り込みタスクを生成 + stack に push する設計だが、

- 割り込みタスクの新規作成 + 分類入力は摩擦が大きく、現実には記録されないことが多い
- ADR-0058 で確定した「ユーザーが触るのは timer だけ」原則と整合させる必要がある
- ADHD 文脈の "Externalize Key Information" (Barkley) を活かすには記録は残したいが、入力フリクションが上がると取らなくなる

割り込みパターンの記録は kozutsumi 差別化軸の深層 (行動データ蓄積) にとって重要なシグナルなので、データを取り続けられる UX が必要。

## Decision

突発割り込みは **専用ボタン 1 タップ** で次を行う:

1. 現在の timer を **停止 (paused)** する
2. **割り込みイベントを記録** する。記録するのは時刻のみで、タイトル / 分類 / 詳細の事前入力は要求しない
3. **割り込みタスクは stack に push しない** (= architecture §1.4 の push/pop モデルから本 ADR で離れる)

割り込みの分類 / 振り返り / 必要に応じたタスク化は ADR-0062 (朝の棚卸し) で後追いする。

## Consequences

### 肯定的影響

- 割り込みデータを摩擦ゼロで記録できる。行動データとして「割り込みパターン」が蓄積される (差別化軸の深層に資する)
- ADR-0058 の「ユーザーが触るのは timer の 3 動詞だけ」原則に近い形で運用できる (1 タップ追加のみ)
- 割り込みの「詳細はあとで」が可能になり、現在のタスク復帰までのコストが下がる

### 否定的影響・トレードオフ

- architecture §1.4 「割り込みのスタック表現」(push/pop) から部分的に離れる。割り込みタスクを stack の一部として扱う既存メンタルモデルが変わる
- 事前分類しない設計のため、振り返り時の分類負荷は朝の棚卸し (ADR-0062) に集中する
- 割り込みされた元タスクを後でやり直すフローは別途設計が必要 (= 既存タスクは paused のまま、別操作で再開)

## Alternatives considered

- **割り込みボタンで分類 (MTG / 緊急 / 雑談 等) を選ばせる**: 1-tap 主義に反する。事後分類で十分。不採用
- **割り込みタスクを自動生成 + stack に push (architecture §1.4 維持)**: stack 構造が割り込みのたびに変わると mental model が混乱する。割り込みは記録だけで足り、タスク化が必要なら明示的に操作する方が自然。不採用
- **割り込みボタンを置かず、stop で代替 (差分は事後分類)**: 「停止理由 = 割り込み / 自発」の区別が消えると、行動データから割り込みパターンが抽出できなくなる。不採用

## Notes

- architecture §1.4 「割り込みのスタック表現」は本 ADR で部分的に変更される (= 割り込みは stack に push しない)。architecture.md の更新は本軌道修正 ADR 群が確定後に別途
- 割り込みイベントのスキーマ (action_log type 名 / metadata 項目) は実装 issue で確定する。本 ADR では「時刻のみで分類なし」とだけ決める
- 将来見直す条件: 朝の棚卸しで「この割り込みをタスクに昇格」操作が頻繁に必要なら、棚卸し画面側に専用 UI を追加する。割り込み発生時の分類は引き続きしない
