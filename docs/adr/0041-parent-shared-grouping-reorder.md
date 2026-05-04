# ADR 0041: 親共有タスク群のグルーピング順序操作

- **Status**: Accepted
- **Date**: 2026-05-04
- **Related**: [ADR-0036](./0036-simplify-task-registration-workflow.md) / [ADR-0016](./0016-stack-view-decomposition-children-only.md) / [ADR-0040](./0040-new-task-insert-position-top.md)

## Context

[ADR-0016](./0016-stack-view-decomposition-children-only.md) で確定済の方針: decomposed 親は Stack に出さず、子をフラットに並べる。各子は「親バッジ (`⤷ 親名`)」で所属を示す。

この上で [ADR-0040](./0040-new-task-insert-position-top.md) (新規タスクは Top 直下) を組み合わせると、次の問題が発生する:

- Top に親 P の子 `c1` がいる状態で、新規タスク N を Top 直下に挿入すると Stack は `c1 / N / c2 / c3` となり、親 P の子グループが分断される
- 新規タスク N が AI 分解されると、さらに `c1 / N の子1 / N の子2 / c2 / c3` のように親 P と親 N の子が交互に混じる
- 一度分断されると、ユーザーが手動で並べ替える際も「親 P の子だけ動かす」操作がなく、1 件ずつ動かすしかない

シンプル世界観 ([ADR-0036](./0036-simplify-task-registration-workflow.md)) を維持しつつ、親共有グループを再収束できる手段が必要。同時に [ADR-0016](./0016-stack-view-decomposition-children-only.md) の「行カード 3 行 / 子フラット」原則は崩したくない。

## Decision

親バッジを単位として、同じ親に属するタスク群をまとめて並べ替えできるようにする。

- Stack View の各行に表示されている親バッジ (`⤷ 親名`) を選択基点とし、同じ `parent_task_id` を持つ全行を 1 グループとして扱う
- グループに対するドラッグ移動 (もしくは同等の操作) で、グループを構成する全行が相対順序を保ったまままとめて移動する
- グループ内の個別行を 1 件だけ動かす操作は従来通り維持する (子は独立タスクとしても扱える原則を残す)
- 新規タスク N が AI 分解された結果、N の子グループも親バッジを介して同様に動かせる

## Consequences

### 肯定的影響

- 新規タスク挿入や分解で分断された親共有グループを 1 操作で再収束できる
- [ADR-0016](./0016-stack-view-decomposition-children-only.md) の「子フラット + 親バッジ」表示モデルをそのまま流用するため、新しい階層 UI を追加する必要がない (Tree View 化を避けられる)
- 「グループ単位のドラッグ」操作自体が Phase 4 の暗黙フィードバック (どの単位で並べ替えたいか) として価値あるシグナルになる

### 否定的影響・トレードオフ

- 親バッジに「グループ選択」のインタラクションを乗せるため、行カード 3 行原則 ([ADR-0016](./0016-stack-view-decomposition-children-only.md)) のタップ領域配分を圧迫する。具体 UI (親バッジ長押し / 親バッジ横のハンドル / shift+ドラッグ) は実装で詰める
- グループ移動は複数行の `stack_order` を atomic に更新するため、現状の単行 reorder ロジック (`reorderTasks.ts`) を拡張する必要がある
- グループ単位移動と個別移動が同居するため、ユーザーが「いま何が動くのか」を予期できる視覚表現が必要 (実装で吸収)

## Alternatives considered

- **案A (Stack に collapse / expand を出す)**: 親バッジで折りたためる Tree View 風の挙動 → ADR-0016 の「子フラット原則」と矛盾。Stack の本質である「上から順にやる」フラット性が崩れる。棄却
- **案B (新規タスク挿入時に親グループの境界を予測してずらす)**: 挿入位置を自動調整する → 「新規タスクは Top 直下」([ADR-0040](./0040-new-task-insert-position-top.md)) のシンプルな約束が複雑な if-else に変質する。ユーザーがどこに入るか予測しづらくなる。棄却
- **案C (グループ操作を提供せず、個別 1 件ずつ並べ替えのみ)**: 現状維持 → 分断後の復旧コストが高い。「上から順にやる」世界観の体験価値を損なう。棄却

## Notes

- グループ選択のトリガー (親バッジクリック / 親バッジ長押し / 別アイコン / shift+ドラッグ) は実装の関心。ADR の判断対象ではない
- 同じ親を持つグループが Stack 内で複数の塊に分かれている (= 分断中) ときも、それら全行が 1 グループとして移動する (グループ = `parent_task_id` の equivalence class)
- 行動ログ (action_log) には「グループ移動」の type を別に持たせるか、`task_reordered` の payload に「対象 task_id list」を入れるかは [ADR-0035](./0035-action-log-payload-schema-and-actor-type.md) のスキーマ運用で吸収する (実装の関心)
- 本 ADR の supersede trigger: 「Stack View を Tree View 化する」「グループ操作を提供しない方針に戻す」「親バッジ表示そのものを廃止する」のいずれか
- [ADR-0040](./0040-new-task-insert-position-top.md) と本 ADR は分断問題への 2 つの異なる解 (片方が挿入位置の約束、もう一方が事後の再収束手段)。supersede 関係は無く、互いに補完
