# ADR 0036: タスク登録ワークフローのシンプル化 — 方針

- **Status**: Accepted
- **Date**: 2026-05-04
- **Related**: [`docs/design/vision.md`](../design/vision.md) / [ADR-0013](./0013-ai-as-augmentation-only.md) / [ADR-0016](./0016-stack-view-decomposition-children-only.md) / [ADR-0017](./0017-ai-task-decomposition-async.md) / [ADR-0018](./0018-keep-parent-task-id-for-ai-decomposition.md) / 本 ADR から派生する [ADR-0037](./0037-task-form-single-entry-with-body.md) / [ADR-0038](./0038-task-size-enum.md) / [ADR-0039](./0039-task-project-edit-and-cascade.md) / [ADR-0040](./0040-new-task-insert-position-top.md) / [ADR-0041](./0041-parent-shared-grouping-reorder.md)

## Context

タスク登録〜着手までの体験が、機能を継ぎ足してきた結果として痒いところに手が届かない状態になっている。具体的には:

- 入力 IF: `TaskForm` は title / project / 見積もり / 依存イベントのみで `body` を持たないが、AI 分解 (`buildDecomposePrompt`) は body を文脈にする → 登録経路の分解は文脈薄
- 親概念: 親-子 2 階層を維持しているが、親登録時のサイズ感や分解可否の表現が弱い
- 分解の起動点: 登録直後に無条件で `triggerDecompose` が走る (`useDashboardMutations.ts:418`) が、ユーザー側の意図 (「これは分解したい」「これは単発」) を伝える手段がない
- 修正可能性: `UpdateTaskInput.projectId` は gateway にあるが UI 経路がなく、親 project をミスると子が誤った project で大量生成される
- 順序操作: 新規タスク差し込みで親共有の子グループが分断され、AI 分解後にさらに混じる

ユーザーの問題意識は「タスクを登録 / 上から順にやるだけ」というシンプルな世界観に戻したい、というもの。各論を個別に潰すと整合が崩れるため、まず方針を束ねる。

vision の差別化軸は「行動パターン分析の深さ」。シンプル化が default 経路の認知負荷を下げ、行動データ蓄積の安定性を上げるならば、軸とは矛盾しない。むしろ「default 経路が複雑」だと蓄積データに dropout が入って分析を弱める。

## Decision

「タスクを登録 / 上から順にやるだけ」を default 経路の到達点とし、以下を方針として束ねる。具体仕様は派生 ADR に委譲する。

- 入力 IF は単一に保ち、`body` を含めて TaskForm 1 画面で完結させる ([ADR-0037](./0037-task-form-single-entry-with-body.md))
- 親-子 2 階層を維持する ([ADR-0018](./0018-keep-parent-task-id-for-ai-decomposition.md) を継続)
- 登録時 AI 分解は常時起動し、「分解不要」は AI 側の判定に倒す ([ADR-0017](./0017-ai-task-decomposition-async.md) を継続)
- ユーザーの意図サイズ (`task_size`) と AI 推定の `estimated_minutes` を分離する ([ADR-0038](./0038-task-size-enum.md))
- project は後から修正できる。親→子 / 子→兄弟で伝播する ([ADR-0039](./0039-task-project-edit-and-cascade.md))
- 新規タスクは Top 直下に挿入する ([ADR-0040](./0040-new-task-insert-position-top.md))
- 親共有タスク群はまとめて並べ替えできる ([ADR-0041](./0041-parent-shared-grouping-reorder.md))

本 ADR 自体は方針宣言に留め、個別の supersede 判断は派生 ADR で行う。

## Consequences

### 肯定的影響

- default 経路 (登録 → 上からやる) の分岐が減り、ユーザーが覚えるべきルールが「TaskForm に書く / 上から手をつける」に縮む
- AI 判定への委譲が増え、ユーザーは「分解させるか」を毎回判断しなくてよい
- 修正可能性が組み込まれることで、間違えた登録の手戻りが「タスク削除 → 再登録」から「項目編集」に縮む
- vision の「行動データを取れるか」軸を弱めない。むしろ default 経路が単純になり、暗黙フィードバック (override / 修正 / 並べ替え) が安定して取れる

### 否定的影響・トレードオフ

- TaskForm に body を統合することで「単発タスクの即時登録」のキータップ数が増える ([ADR-0037](./0037-task-form-single-entry-with-body.md) で吸収)
- 修正可能性 + 伝播ルールが増えることで、操作と DB 効果の対応が「単一行 update から複数行 update」に変わる ([ADR-0039](./0039-task-project-edit-and-cascade.md) で受ける)
- グルーピング操作 UI を増やすので、ADR-0016 の「行カード 3 行」原則が圧迫されないかは [ADR-0041](./0041-parent-shared-grouping-reorder.md) で詰める

## Alternatives considered

- **案A (分離 UI)**: 「分解依頼」と「単発登録」を別画面にする → 入口が 2 つに増え、ユーザーが毎回モード判定する負荷が出る。「シンプル世界観」と直接矛盾するため棄却
- **案B (トグル)**: TaskForm に「分解依頼として送る」トグルを置く → 分解可否はユーザー意図ではなく内容 (body の量と複雑さ) の問題。AI 判定に倒した方が一貫し、ユーザーの判断ステップが減る
- **案C (現状維持 + 個別パッチ)**: 痒みを個別 issue で潰す → 入力 IF / 親概念 / 修正可能性 / 順序操作が独立に追加されて整合が崩れる。これまでの蓄積で発生している問題そのものなので棄却

## Notes

- 本 ADR の supersede trigger は「シンプル世界観 (登録 → 上からやる) そのものを取り下げる」場合に限定する。個別判断 (TaskForm 統合 / `task_size` / project 伝播 / 挿入位置 / グルーピング操作) の覆しは派生 ADR 側で受ける
- 「秘書から相談があります」モード (AI が分解判断材料不足のときユーザーと対話する future) は将来構想。`docs/open-questions.md` / `docs/roadmap.md` で扱い、本 ADR との互換性のみ意識する (TaskForm 統合 + body 欄が対話起点に流用できる)
- 関連 ADR との整合: [ADR-0013](./0013-ai-as-augmentation-only.md) (AI は augmentation のみ) / [ADR-0016](./0016-stack-view-decomposition-children-only.md) (decomposed 親は Stack に出さず子フラット) を維持。本方針は両者の上で動く
