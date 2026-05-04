# ADR 0039: タスクの project 修正可能性と親-子-兄弟への伝播

- **Status**: Accepted
- **Date**: 2026-05-04
- **Related**: [ADR-0036](./0036-simplify-task-registration-workflow.md) / [ADR-0018](./0018-keep-parent-task-id-for-ai-decomposition.md) / [ADR-0017](./0017-ai-task-decomposition-async.md)

## Context

[ADR-0036](./0036-simplify-task-registration-workflow.md) の方針 (登録ミスの手戻りを「削除 → 再登録」から「編集」に縮める) に従い、project の修正可能性を組み込む。現状は次の不整合がある:

- gateway 層には `UpdateTaskInput.projectId` がある
- 一方で `useDashboardMutations` には project 変更の callback が無く、UI 経路が存在しない
- 分解時の子は `fn_decompose_parent_task` で親の `project_id` を継承するが、**親 → 既存子への伝播 trigger は無い**
- 結果: 親登録時に project をミスると、子が誤った project で大量生成され、それを直す手段が「タスクを 1 つずつ修正」しかない

加えて、登録経路で project を必須にしている現状は ADR-0036 の「default 経路はシンプルに」と整合しない。後から付けられる前提なら登録時は任意で十分。

## Decision

project の修正可能性を有効化し、伝播ルールを次のように決める。

- **登録時の project は任意**: `tasks.project_id` は NULLABLE のまま、TaskForm の project 入力を任意化する
- **編集 UI**: TaskDetailPanel に project 編集 UI を追加する
- **親 → 子の伝播**: 親タスクの `project_id` を変更すると、同じ `parent_task_id` を持つ既存子全員の `project_id` も同期する (RPC 1 本で atomic)
- **子 → 兄弟の伝播**: 子タスクの `project_id` を変更すると、同じ `parent_task_id` を持つ全兄弟と親の `project_id` も同期する (RPC 1 本で atomic)
- 単独タスク (親も子もない) の編集は当該行のみ変更

## Consequences

### 肯定的影響

- 親 project ミスによる「子が誤った project で大量生成される」問題を 1 操作で復旧できる
- 「親と子は同じ project に属する」というデータ不変条件を UI 操作レベルで維持できる
- 登録時 project の任意化で、プロジェクトを決め切れない初期登録 (Inbox 的運用) ができる

### 否定的影響・トレードオフ

- 1 行編集が複数行 update に膨らむため、操作の効果範囲が「見た目以上」になる。視認性 (確認 dialog / toast での影響件数表示) は実装の関心
- 兄弟が多い親で子 project を変更すると、意図せず大量の兄弟が動く。「兄弟に伝播することの明示」は UI 側で吸収する必要がある
- 行動ログ (action_log) には伝播分も記録される。Phase 4 分析の「ユーザーが 1 回押した操作 vs 連鎖した DB 変更」を区別したい場合、ログ層で意識する必要がある (「triggered_by」相当のメタデータ)
- 登録時 project の任意化で、project 未設定タスクが Stack 上で見落とされうる (未設定 = どこに属するか不明)。Inbox 的扱いをするか、「未設定タスクのバッジ」を出すかは実装の関心

## Alternatives considered

- **案A (親変更時、既存子は触らない)**: 親と子の project が乖離することを許容する → 「親 P の子 c が project Q に属する」というデータが生まれ、Stack / Tree / フィルタの一貫性が崩れる。棄却
- **案B (子の project は親と同じに固定し、編集不可)**: 子からの編集経路を塞ぐ → 「家事プロジェクトに属する子だけ仕事プロジェクトに移したい」のようなケースが ADR-0017 (子は独立タスクとしても扱える) と矛盾。さらに「子で気付いて修正」は最も自然な復旧導線なので潰したくない。棄却
- **案C (子変更時、兄弟には伝播せず、親と当該子だけ揃える)**: 親と子 1 個が同じ project、他の兄弟は古いまま → 「親と子の project が一致する」不変条件が一部だけ崩れる。データ不変条件を維持するなら全兄弟まで揃える方が一貫。棄却
- **案D (project 必須を維持)**: 登録時の認知負荷をそのまま受ける → ADR-0036 のシンプル世界観方針と矛盾。棄却

## Notes

- 確認 dialog の有無、toast の文言、伝播対象の件数表示などは実装で詰める。ADR の関心ではない
- RPC は 1 本にまとめ、atomic に動かす ([ADR-0017](./0017-ai-task-decomposition-async.md) の race guard pattern と整合させる必要がある場合は実装側で吸収)
- action_log の payload (triggered_by、波及範囲) は [ADR-0035](./0035-action-log-payload-schema-and-actor-type.md) のスキーマに従って実装で詰める
- 本 ADR の supersede trigger: 「親と子で project が異なることを許容する」「子変更時の伝播範囲を兄弟以外に広げる / 狭める」のいずれか
