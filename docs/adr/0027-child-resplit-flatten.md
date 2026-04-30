# ADR 0027: 子タスクの再分解は孫を作らず親の子として flatten する

- **Status**: Accepted
- **Date**: 2026-04-30
- **Related**: `docs/design/vision.md` §「差別化の核」 / `docs/design/architecture.md` §1.7 / [ADR 0001](./0001-action-logs-from-phase1.md) / [ADR 0016](./0016-stack-view-decomposition-children-only.md) / [ADR 0017](./0017-ai-task-decomposition-async.md) / [ADR 0018](./0018-keep-parent-task-id-for-ai-decomposition.md) / [ADR 0021](./0021-ai-decomposition-failure-visibility.md) / Issue #121

## Context

Phase 3 で AI 分解 (ADR 0017) を入れたが、実機で運用すると「AI が出した子粒度では大きすぎる / 全体像が見えにくい」というシーンが残り、子をさらに再分解する手段が必要になった。

最初は素直に「孫タスクを許容する」(= `parent_task_id` を 2 段にする) ことを検討したが、実機で孫を試した結果、**認知的に破綻** することが分かった:

- 孫タスクが親の ParallelogramProgress (ADR 0016 §5) と独立して走るので、「親の進捗バーを 1 進めるためにどの粒度のタスクを完了にすればいいか」が分からなくなる
- Stack View に出ている粒度（消化対象）と、進捗バーの粒度（達成感のメトリクス）が一致しなくなる
- ADR 0016 の不変条件「Stack 行 = 子のみフラット」が破壊される
- 結果として、kozutsumi のコア体験「上から取る」基本動線が崩れる

しかし、子の再分解という機能自体は必要。問題は「データモデルとして孫を作る方向に倒すか、flatten する方向に倒すか」の判断。

派生して「再分解された元の子をどうするか」の判断も必要になる:
- 物理 delete: シンプルだが、紐づく action_log の task_id が dangling になる
- archive (新カラム `archived_at`): tasks に残るが、全 query に filter が必要になる
- status enum 拡張: state machine と混線する

## Decision

子タスクを再分解した結果は、**孫としてではなく、同じ親の追加の子として flatten** する。元の子 (再分解対象) は **物理 delete** し、削除直前のスナップショットを action_log の metadata に inline で保存することで学習素材を保持する。

### 1. flatten 配置

子 B (親 P) を再分解して b1/b2/b3 が出る場合:

- `b1, b2, b3` は `parent_task_id = P` (B の親) として作成
- `stack_order` は B の元の位置から連続採番 (B の位置に b1, 次に b2, 次に b3)
- 後続兄弟の `stack_order` は (新規子数 - 1) だけシフト

### 2. 元の子は物理 delete

元の B は `tasks` テーブルから物理削除する。新カラムや status 拡張は導入しない。

### 3. action_log に snapshot を inline 保存

`task_child_resplit` action_type (ADR 0030) の metadata に `resplit_target_snapshot` フィールドを設け、削除直前の B の主要属性 (id / title / body / estimated_minutes / task_category / created_at) を inline で保存する。

これにより、ADR 0001 (Phase 1 からの行動ログ蓄積) の前提を保ったまま、Phase 4 以降の暗黙フィードバック分析で「再分解された経歴」を学習素材として参照できる。

### 4. ParallelogramProgress は無変更

ADR 0016 §5 の `ParallelogramProgress` は `total = 親の全子数` を渡せば動的にセグメント数が変わる作りなので、本 ADR の flatten 配置で自動的に「分解で伸びる」体験になる。コード変更は不要。

## Consequences

### 肯定的影響

- **ADR 0016 (Stack View / decomposition children only) の不変条件が保たれる**。Stack 行 = 子のみフラットの構造が崩れない
- **「分解で進捗バーが伸びる」体験**が成立する。ParallelogramProgress のセグメント数が増え、「進んだ感」が消えない
- **「上から取る」動線が崩れない**。Stack View に出る粒度と進捗バーの粒度が常に一致する (要求定義 HC-1 / HC-2)
- **tasks テーブルのスキーマが不変**。新カラム / 新 status を入れない、全 query の見直し不要
- **学習素材が保持される** (ADR 0001)。action_log の snapshot で再分解前の子の属性が永続化される

### 否定的影響・トレードオフ

- **削除した子に紐づく action_log の `task_id` が dangling になる**。`task_started` / `task_paused` / `task_completed` 等の log は tasks 経由で復元できない。Phase 4 集計側で「task_id が tasks に存在しない場合は snapshot 経由で属性を引く」処理を加えて吸収する
- **再分解 = delete + insert + reorder の 3 操作を atomic に通す必要がある**。partial failure すると tasks の整合性が破壊される (重複 stack_order / dangling parent_task_id)。実装側で PL/pgSQL function による transaction 保証が必要 (実装パラメータ)
- **再分解の連続使用で同一親の子が 10 件超になる可能性**。`ParallelogramProgress` の幅縮小ロジックは 10 子で 480px が上限なので、それを超えると UI が破綻する。AI prompt の `MAX_CHILDREN=7` 制約と「元の子 1 件削除 → 純増 N-1」で頻度は限定されるが、運用観測が必要

## Alternatives considered

- **孫タスクを許容する** (`parent_task_id` を 2 段に):
  - 既存スキーマで完結 (migration 不要)
  - 実機で進捗バーと Stack 粒度が乖離することを確認済み (issue #121 背景)
  - ADR 0016 の不変条件を破壊する
  - **不採用**。本 ADR の動機そのもの

- **flatten + 元の子は archive (新カラム `archived_at`)**:
  - 元の子が tasks に残り、紐づく action_log の参照が切れない
  - 全 tasks query に `archived_at IS NULL` filter を追加する必要がある (実装範囲が広い)
  - tasks の状態軸が `status` + `decompose_status` + `archived_at` の 3 軸になる
  - HC-4 (行動ログ蓄積) は本 ADR の snapshot 案でも満たせるため、archive のコストを払う動機が薄い
  - **不採用**

- **flatten + 元の子は status enum 拡張 (`'archived'` 追加)**:
  - state machine (`idle` / `active` / `paused` / `done`) と permanence 状態 (archive) が混線する
  - 業務状態 enum と永続化状態を同じ列で管理するのはアンチパターン
  - **不採用**

- **flatten + 元の子は delete + 紐づく action_log を物理削除 or 一括 deactivate**:
  - 学習素材が消える
  - ADR 0001 (行動ログは消さない) の方針に違反
  - **不採用**

## Notes

- 削除前 snapshot のフィールド (id / title / body / estimated_minutes / task_category / created_at) は、Phase 4 の暗黙フィードバック分析で必要になりそうな最小セット。それ以外 (status / decompose_status / completed_at 等) は学習素材として価値が低いと判断した。観測の結果フィールドが足りなければ別 ADR で拡張する
- 新規子の `depends_on_event_id` は **target (再分解対象の子) のものを継承** する (RPC 内で `select depends_on_event_id from tasks where id = p_target_id` で取得)。親分解 (`decomposeTask`) では parent の dependency を継承するが、resplit は target を 1:N に置き換える操作なので「target に紐づく依存関係を引き継ぐ」方が一貫する (子が手動で親と異なる依存先を持つケースに対応)。target.depends_on_event_id が null (= 通常の AI 生成子) なら新規子もすべて null になる
- 本 ADR を supersede する trigger:
  - **孫を許容する判断に戻す**: 例えば多階層 (epic / story) を Stack View で扱う必要が出た場合 (ADR 0016 の見直し条件と連動)
  - **元の子を archive 状態で残す方針に切り替える**: Phase 4 集計で dangling task_id の解決コストが想定より高いと判明した場合
  - **再分解の頻度が高く、snapshot による action_log 容量が問題化**: 圧縮 / 古い snapshot の null 化方針を別 ADR で検討
- 本 ADR は「再分解で生まれる新規子」「元の子の扱い」までを決める。並び順データ構造の選定は ADR 0028、prompt 設計は ADR 0029、action_log のスキーマは ADR 0030 で別途記録する
