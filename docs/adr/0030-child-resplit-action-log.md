# ADR 0030: 子の再分解は新 action_type task_child_resplit で記録し、既存 decomposition_modified.kind='child_resplit' は廃止する

- **Status**: Accepted
- **Date**: 2026-04-30
- **Related**: [ADR 0001](./0001-action-logs-from-phase1.md) / [ADR 0021](./0021-ai-decomposition-failure-visibility.md) / [ADR 0027](./0027-child-resplit-flatten.md) / Issue #121

## Context

ADR 0027 で「子の再分解は flatten + 元の子物理 delete + action_log に snapshot inline 保存」と決めた。これを行動ログとしてどう表現するかの判断が必要。

既存の `action-log/types.ts` には `decomposition_modified.kind = 'child_resplit'` が値域として定義されているが、Phase 1〜3 では発火経路が無く未使用。`decomposition_modified` の metadata は `{ task_id, parent_id, kind }` の薄い構造で、raw_response や snapshot を持つ余地がない。

選択肢:

- (A) 新 action_type `task_child_resplit` を追加。`decomposition_modified.kind='child_resplit'` を廃止
- (B) 既存 `decomposition_modified.kind='child_resplit'` を拡張し、metadata に optional フィールド (raw_response / snapshot / new_child_ids) を追加して再利用
- (C) 既存 `task_decomposed` をそのまま再利用し、再分解と新規分解を action_type 上で区別しない

判断の論点は「Phase 4 集計で型の一貫性をどう保つか」「学習素材の inline 情報をどう保存するか」。

## Decision

新 action_type **`task_child_resplit`** を追加し、metadata に `resplit_target_snapshot` / `new_child_ids` / `raw_response` を inline で保存する。既存 `decomposition_modified.kind = 'child_resplit'` は **未使用のため値域から削除** する。失敗時のログは ADR 0021 の **`task_decompose_failed` を再利用** する (子 id を `task_id` に入れる)。

### 1. 新 action_type の追加

```ts
ActionType に追加:
  | "task_child_resplit"

ActionMetadataMap に追加:
  task_child_resplit: {
    task_id: string;        // 新規子のうち先頭 (action_log の主体行)
    parent_id: string;      // 元の親 (削除された子の親)
    resplit_target_snapshot: {
      id: string;
      title: string;
      body: string;
      estimated_minutes: number | null;
      task_category: string | null;
      created_at: string;
    };
    new_child_ids: string[];
    raw_response: string;
  };
```

### 2. 既存 kind の縮小

```ts
DecompositionModifiedKind:
  | "child_deleted"
  | "child_edited"
  | "parent_merged"
// 'child_resplit' を削除
```

### 3. 失敗時のログ

ADR 0021 の `task_decompose_failed` をそのまま再利用する。再分解の失敗でも `task_id` には対象の子 id を入れ、`reason` の値域 (quota_exhausted / upstream_unavailable / ai_response_unparseable / insert_failed / internal_error) も同一とする。新たな action_type は作らない。

### 4. 成功時の発火タイミング

`task_child_resplit` は **再分解の transaction (delete + insert + reorder) が COMMIT した後** に発火する。失敗時は `task_decompose_failed` のみで、`task_child_resplit` は発火しない。

## Consequences

### 肯定的影響

- **action_type ごとに metadata 構造が固定**。Phase 4 集計で型の一貫性を維持できる (kind による分岐で metadata 形が変わる構造を避けられる)
- **学習素材が inline で保存される** (ADR 0001)。削除された子のスナップショットが action_log の metadata に永続化され、Phase 4 の暗黙フィードバック分析で「ユーザーが粒度を変えた」シグナルとして使える
- **既存の `task_decomposed` (親分解) と並列の構造**。Phase 4 集計で「分解操作」を action_type 軸で集計できる (`task_decomposed` = 親 1 回目、`task_child_resplit` = 子の再分解)
- **失敗パスは ADR 0021 の枠組みをそのまま流用**。新たな失敗ハンドリング体験を作らないので UX が分裂しない (要求定義 HC-5)
- **未使用の `'child_resplit'` kind を消すので型定義がクリーン**

### 否定的影響・トレードオフ

- **`DecompositionModifiedKind` から `'child_resplit'` を削除する型変更**。型定義の更新が必要だが、未使用なので影響範囲は型定義のみ
- **action_type が 1 つ増える**。`logger.ts` の ACTION_TYPES 定数 / `types.ts` の ActionMetadataMap の両方で追加が必要
- **本 ADR の前提は「DB の action_logs に kind='child_resplit' の行が無い」**。万一存在する場合は migration で救済 (例: `kind='child_edited'` に倒す) が必要。Phase 2 実装前に DB 直接 query で確認する
- **raw_response が action_logs に蓄積される**ので容量が増える (1 件数 KB)。個人ツール段階では問題ない規模だが、ADR 0021 の Notes と同じく将来の削減方針 (古い snapshot の null 化等) は別 ADR で検討する余地がある

## Alternatives considered

- **既存 `decomposition_modified.kind='child_resplit'` を拡張して metadata に optional フィールド追加**:
  - action_type を増やさない
  - 同じ action_type で metadata 構造が kind ごとに激変 (`kind='child_deleted'` の metadata は薄く、`kind='child_resplit'` だけ raw_response や snapshot で厚い)
  - 型としての一貫性が崩れ、Phase 4 集計時に kind ごとの分岐コードが必要
  - **不採用**

- **`task_decomposed` をそのまま再利用 (再分解も「成功した分解」として記録)**:
  - 最も簡単、型変更なし
  - 再分解と新規分解が action_type で区別できなくなる
  - 削除子のスナップショットを保存する欄が無い (`task_decomposed.metadata = { task_id, child_ids, raw_response }` のみ)
  - Phase 4 で「再分解操作」を分析する手段が消える (= 学習シグナルとして劣化、HC-4 違反)
  - **不採用**

- **`task_child_resplit` 新設 + `decomposition_modified.kind='child_resplit'` を残す (両方発火)**:
  - 旧 kind を将来の用途で残しておく
  - 同じイベントで 2 つの action_log が発火するのは冗長 (集計時のノイズ)
  - 旧 kind に発火経路が無いまま型定義に残るのは技術的負債
  - **不採用**

- **失敗時に新 `task_child_resplit_failed` を別途追加**:
  - 「再分解 vs 新規分解」を失敗ログでも区別できる
  - 失敗 reason の値域は ADR 0021 と同一なので、新 action_type を増やす実益が薄い
  - 集計側で `task_decompose_failed.metadata.task_id` の親子関係から「親の失敗 / 子の再分解の失敗」を判別可能
  - **不採用**。シンプルさを優先

## Notes

- `resplit_target_snapshot` のフィールド (id / title / body / estimated_minutes / task_category / created_at) は ADR 0027 の Decision §3 と同じ最小セット。Phase 4 で必要が出たら拡張する (例: `decompose_status` / `is_interruption` 等)
- 削除子に紐づく既存の `task_started` / `task_paused` / `task_completed` 等の action_log は **そのまま残す** (ADR 0001 の方針)。`task_id` が tasks に存在しない状態 (dangling) は許容する。Phase 4 集計側で「task_id が tasks に存在しない場合は `task_child_resplit.resplit_target_snapshot` から属性を引く」処理を入れる想定
- Phase 2 実装前のチェック: `select count(*) from action_logs where action_type = 'decomposition_modified' and metadata->>'kind' = 'child_resplit'` が 0 件であることを Supabase 直接 query で確認する。万一存在した場合は本 ADR を実装前に再考する
- 本 ADR を supersede する trigger:
  - **再分解操作を別の構造で表現する必要が出る** (例: 親の再分解 / 兄弟統合 / 親への昇格 (issue #140) 等の関連操作で action_type を再設計する場合)
  - **`task_decompose_failed` の reason 値域が再分解パスで不足する** (例: 兄弟 fetch 失敗専用の reason が必要)
  - **action_logs の容量が問題化** (raw_response / snapshot の保存方針を圧縮 / null 化に変更)
- 本 ADR は「子の再分解の action_log 設計」のみを決める。flatten 方針は ADR 0027、stack_order は ADR 0028、prompt 設計は ADR 0029 で別途記録する
