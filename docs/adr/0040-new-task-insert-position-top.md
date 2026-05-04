# ADR 0040: 新規タスクは Top 直下に挿入する

- **Status**: Accepted
- **Date**: 2026-05-04
- **Related**: [ADR-0036](./0036-simplify-task-registration-workflow.md) / [ADR-0016](./0016-stack-view-decomposition-children-only.md) / [ADR-0041](./0041-parent-shared-grouping-reorder.md)

## Context

[ADR-0036](./0036-simplify-task-registration-workflow.md) で「タスクを登録 / 上から順にやるだけ」の世界観を方針化した。これに伴い、新規タスク登録時の差し込み位置を明示的に決める必要がある。

現状の挙動と問題:

- 新規タスクの差し込み位置は実装依存で、ユーザーから見て「直近で登録したものをすぐ着手したい」のか「末尾に積みたい」のか判別できない
- 末尾追加にすると「上から順にやる」前提と矛盾する。新規タスクが Stack の下に埋もれ、Top に古いタスクが残る
- Top 直下挿入にすると、Top と親共有のタスク群が分断される問題が発生する (これは [ADR-0041](./0041-parent-shared-grouping-reorder.md) で別途解く)

## Decision

新規タスクは **Top 直下** に挿入する。

- TaskForm から新規登録されたタスクは、現在の Top タスクの 1 つ下 (= 上から 2 番目) の位置に入る
- 「Top に置く」ではない: 現在の Top をそのまま尊重する (今やっているもの / 着手予定のものを邪魔しない)
- AI 分解後の子は親と同じ位置で flatten される ([ADR-0016](./0016-stack-view-decomposition-children-only.md) の挙動を継続)

## Consequences

### 肯定的影響

- 「直近で登録したもの → すぐ着手」が default 経路になる。ADR-0036 の世界観と直結
- Top の固定 (今やっているもの) を壊さないので、Pomodoro 的に走っているセッション中に登録しても作業中タスクが押し下げられない

### 否定的影響・トレードオフ

- 親共有タスク群が分断される: 親 P の子 c1 が Top にいる状態で新規タスク N を入れると `c1 / N / c2 / c3` になる。本 ADR 単独ではこの問題を解かない ([ADR-0041](./0041-parent-shared-grouping-reorder.md) で受ける)
- 「末尾に積みたいケース」(後でやればいいタスク) のサポートが標準フローには無い。必要なら登録後に手動で並べ替える前提

## Alternatives considered

- **案A (末尾追加)**: 新規タスクは Stack の最下段に追加 → 「上から順にやる」前提と矛盾。新規タスクが下に積み上がり、Top が古いまま。棄却
- **案B (Top に置く)**: 新規タスクが現在の Top を押し下げる → 作業中のタスクが急に切り替わるため認知負荷が大きい。棄却
- **案C (ユーザー選択)**: 登録 UI に「先頭 / Top 直下 / 末尾」を選ばせる → ADR-0036 のシンプル世界観 (覚えるべき分岐を減らす) と矛盾。棄却

## Notes

- 親共有タスク群の分断問題は [ADR-0041](./0041-parent-shared-grouping-reorder.md) で別途扱う
- 「Top タスクが無いとき (Stack が空)」の挿入位置は実装で素直に頭に入れる。本 ADR の判断対象ではない
- 本 ADR の supersede trigger: 「新規タスクは末尾 / Top に置く / ユーザー選択」のいずれかに方針転換する場合
