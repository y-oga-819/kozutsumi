# ADR 0051: AI 分解への user editorial signal を action_log で完全捕捉する

- **Status**: Accepted
- **Date**: 2026-05-06
- **Related**: Issue #214 / 親 roadmap #208 / [ADR-0017](./0017-ai-task-decomposition-async.md) / [ADR-0021](./0021-ai-decomposition-failure-visibility.md) / [ADR-0027](./0027-child-resplit-flatten.md) / [ADR-0030](./0030-child-resplit-action-log.md) / [ADR-0035](./0035-action-log-payload-schema-and-actor-type.md)

## Context

親 roadmap #208 の設計原則「**学習信号の出所は user 起源（編集差分 / 行動指標）であって、AI 出力そのものではない**」（self-reinforcing 回避）を満たすには、AI 分解結果に対する user の editorial action（title 編集 / 子削除 / 子追加 / 再分解）が漏れなく `action_logs` に残っている必要がある。

Issue #214 の現状監査で 2 つの事実が判明:

1. 既存 type 定義は揃っている（`task_title_changed` / `decomposition_modified` (kind: child_deleted/child_edited/parent_merged) / `task_child_resplit`）
2. しかし `task_title_changed` と `decomposition_modified` の **発火経路が production code に存在しない**（type / logger / server-side FK ハンドリングまで揃っているが、呼び出し側が空）。`grep -r TASK_TITLE_CHANGED src/` の結果は type 定義 / test / logger constants のみ

加えて以下のギャップがある:

- **Gap A (新規)**: 「user が AI 分解後に同階層へ手動で子を追加した」事象の signal が無い。現状は `decomposition_modified` の kind に `child_added` が無く、`task` の create でも logging しない
- **Gap B (新規)**: resplit (`task_child_resplit`) の `resplit_target_snapshot` は再分解直前の子しか持たず、**「初期 AI 分解」と「再分解」を join するキー**が無い。粒度調整の前後比較を集計クエリで自動再構成できない
- **Gap C (新規)**: `task_deleted.snapshot` に「分解由来の子か / user 手動追加か」を区別する tag が無く、削除パターン分析時に手作業 join が要る

これらを Phase 4 の暗黙フィードバック分析（#208 軸 2「個人の作業スタイル」）の前提として今のうちに整える必要がある。

## Decision

AI 分解に関わる user の editorial action を action_log で 1:1 に捕捉する。具体的には:

### D1. 既存型の発火経路を実装する（schema 拡張なし）

- `task_title_changed`: 全 task の title 変更で発火（root / 分解子の区別なし、汎用）
- `decomposition_modified.kind=child_deleted`: 親が `decompose_status='decomposed'` の子を削除した時
- `decomposition_modified.kind=child_edited`: 親が `decompose_status='decomposed'` の子の title / estimated_minutes が変わった時（`task_title_changed` と**併発で発火**。前者は「title を変えた」、後者は「分解構成が変わった」と意味が異なる）
- `decomposition_modified.kind=parent_merged`: 分解済み親が削除されて子が孤児化した時（[ADR-0018](./0018-keep-parent-task-id-for-ai-decomposition.md) のセマンティクス記録）

### D2. `decomposition_modified.kind` に `child_added` を追加する

`decompose_status='decomposed'` の親に user が手動で子を追加した操作を捕捉する。`DecompositionModifiedKind` 型を `"child_deleted" | "child_edited" | "parent_merged" | "child_added"` に拡張。**親に既存の AI 分解が無い純粋な手動階層作成は対象外**（学習信号として価値が薄い、かつ「分解の修正」ではない）。

### D3. resplit の lineage を表現するキーを `resplit_target_snapshot` に追加する

`task_child_resplit.metadata.resplit_target_snapshot` に **`source_decomposition_log_id: string | null`** を追加。再分解された子が「どの初期 AI 分解 (`task_decomposed`) で生まれたか」の `action_logs.id` を持つ。

- 親が `task_decomposed` 経由で生まれた子なら、その親の `task_decomposed` ログ id
- 親が user 手動追加 (Gap A の `child_added`) で生まれた子なら null
- 親自身が前回 resplit で生まれた子（多段 resplit）なら、ひとつ前の `task_child_resplit` ログ id（resplit chain の遡及）

これで「初期分解 → user 編集 → resplit → user 編集 …」の lineage を log id chain として 1 クエリで再構成できる。

### D4. `task_deleted.snapshot` に `was_decomposition_child: boolean` を追加する

削除前 `parent_task_id != null` かつ親が `decompose_status='decomposed'` だった場合に true。Phase 4 で「分解粒度の偏り」分析時、AI 由来 vs user 起源の子削除を分離できる。

### D5. retention は既存方針を踏襲

ADR-0030 の「`task_deleted` / `decomposition_modified` は task_id を null 上書きしても metadata snapshot で再構成可能」原則に乗る。新規 `child_added` も同方針（snapshot を inline）。TTL は既存 action_logs と同じ（個別 TTL は持たない）。

## Consequences

### 肯定的影響

- AI 分解への editorial feedback の**取りこぼしがゼロ**になる。Phase 4 prompt 個人化の前提が整う（#208 軸 2 の signal 完備）
- 既存 type 設計を尊重する形で増分的に実装でき、過去ログとの整合（ADR-0035 §6 の backfill しない原則）を崩さない
- resplit lineage の chain により「user が AI 分解結果をどう変形させたか」が action_logs だけで完結（join 元のテーブル削除に強い、ADR-0030 と整合）

### 否定的影響・トレードオフ

- action_logs の write 量が増える（1 タスク編集で `task_title_changed` + `decomposition_modified.child_edited` の 2 行になるケースが発生）。ただし学習信号としての意味が異なる（汎用 title 変更 vs 分解構成の修正）ので冗長ではない
- `resplit_target_snapshot.source_decomposition_log_id` は inline の参照 id。元 log が物理削除されない限り解決可能だが、retention で消えた場合は null 同等の扱い（既存 ADR-0030 と同レベルの強度）
- `decomposition_modified` の発火条件（親が `decomposed` 状態か）を毎回判定する必要がある。実装側で gateway 層に判定を集約する責務が増える

## Alternatives considered

- **案 A: 編集差分は signal #213（行動評価指標）で代替する** → ❌ 行動指標は粒度の粗い客観量（先送り率 / 見積もり誤差等）で、「title をこう書き換えた」のような micro-signal を持たない。両者は相補で、片方では prompt 個人化に届かない
- **案 B: `decomposition_modified` を廃止し、editorial action を全て独立 type に**（`child_added_by_user` / `child_deleted_after_decompose` / `child_edited_after_decompose` 等）→ ❌ ADR-0035 で確立した「kind で区別する単一 type」設計を破る。type 種類が増えて retrieval / 集計クエリが複雑化、対する利点（型の精緻さ）は kind enum で十分得られる
- **案 C: 既存型の発火 (D1) だけ実装し、Gap A/B/C は将来検討に回す** → ❌ Gap A/B/C はいずれも「今 schema を整えなければ過去ログが教師信号として使えない」性質（後から backfill できない、ADR-0035 §6）。コストは小さく、後回しにする利得がない
- **案 D: `task_title_changed` を分解子では発火させない（`decomposition_modified.child_edited` で代替）** → ❌ 「title 変更」は task 全般で発生する横断 signal で、root / 分解子で型を分けるのは retrieval 時に煩雑。両発火させて意味を分ける方が素直

## Notes

### 監査結果の根拠

- `task_title_changed`: 型定義 `src/entities/action-log/types.ts:8,116-120` / logger `src/entities/action-log/logger.ts:26`、production 発火地点ゼロ（`grep -rn TASK_TITLE_CHANGED src/` で test と type 定義のみ）
- `decomposition_modified`: 型定義 `src/entities/action-log/types.ts:22,212-216` / server.ts:24 で FK null-handling まで実装済み、production 発火地点ゼロ
- `task_decomposed.metadata.raw_response`: AI 生出力は `src/entities/task/decompose-server.ts:127-179` で完全保存
- `task_child_resplit.metadata.resplit_target_snapshot`: `src/entities/task/resplit-server.ts:205-223` で再分解直前の子を保存

### 将来見直す条件

- D2 で追加する `child_added` kind が、実装してみると「単発の子追加」と「分解全体の組み直し」を区別できないことが判明した場合 → kind 追加（例: `decomposition_replaced`）または ADR 分割
- D3 の chain id 解決が retention で頻繁に null になり集計に支障が出る場合 → snapshot の content を `source_decomposition_log_id` 以外で持つ（例: 初期 AI raw_response 本文を resplit_target_snapshot に inline コピー）
- D4 の `was_decomposition_child` だけでは不足し「どの分解 log の子か」が要る場合 → `decomposition_log_id` を `task_deleted.snapshot` に追加。本 ADR を supersede

### 実装スコープ（本 ADR 外）

実装の単位（PR の切り方 / firing 地点 / migration ファイル）は issue #214 で扱う。本 ADR は「**何を捕捉するか**」と「**action_log のどの type にどう乗せるか**」のみ確定する。
