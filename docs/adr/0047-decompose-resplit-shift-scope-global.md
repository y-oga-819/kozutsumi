# ADR 0047: 分解 / 再分解時の `stack_order` 後続シフトはユーザースコープ全体に広げる

- **Status**: Accepted
- **Date**: 2026-05-05
- **Related**: [ADR 0028](./0028-child-resplit-stack-order-strategy.md) / Issue #204 / PR #205

## Context

ADR 0028 で「再分解時は同一親内 (`parent_task_id` が一致する) の後続兄弟をシフトする」と決めた。これは「子の `stack_order` 空間は親 scope に閉じている」前提に基づいた判断だった。

実際には、Stack View (`buildStackItems`, ADR 0016 §1) は decomposed 親を除外して**子をそのままトップレベルと同じリストに flatten する**。つまり子と親兄弟は同じ視覚平面上に並ぶ。一方、DB 側の `stack_order` は per-`parent_task_id` で決定論的に振られていたため、トップレベルの親 (`parent_task_id IS NULL`) を AI 分解した直後は

- 親 B (`stack_order = 1`)
- 子 b1, b2, b3 (`parent_task_id = B`, `stack_order = 1, 2, 3`)
- 親兄弟 C, D, E (`parent_task_id = NULL`, `stack_order = 2, 3, 4`)

のように **同じ視覚平面の中で `stack_order` が衝突する** 状態が発生した。`SupabaseTaskGateway.list()` の `(stack_order, created_at)` 昇順ソートだと `A b1 C b2 D b3 E` と「親兄弟と子が交互に挟まる」表示になる (Issue #204)。

PR #205 ではレンダリング層 (`buildStackItems`) で「decomposed 親の id 集合を先に取り、子は親の位置でまとめて emit」する集約ロジックを入れて視覚上の並びだけ直した。しかしこれによって**視覚順と DB の `stack_order` 順が乖離**し、DnD 並べ替え (`reorderTasksById` / `reorderGroupById`) が「視覚位置 → DB 順」の翻訳を持たないため:

- 子の間に別タスクをドロップしても挿入できない
- 別の親の子グループ間に未分解タスクを入れても入らない

という別バグが発生した。視覚層で吸収するアプローチは reorder 経路と本質的に整合しないため、**DB 側の `stack_order` を視覚順と一致させる**根本対処が必要になった。

## Decision

`fn_decompose_parent_task` および `fn_resplit_child_task` の「後続シフト」スコープを、**`parent_task_id` 一致のみ → 同一 `user_id` のすべての task** に広げる。

具体的には:

### 1. `fn_decompose_parent_task` (新規)

親 P (`stack_order = K`) を AI 分解して N 件の子を出す場合:

1. 同一 `user_id` で `stack_order > K` のすべての task を `stack_order += N` でシフト
2. 子を `stack_order = K+1, K+2, ..., K+N` で insert (`parent_task_id = P.id`)
3. P の `decompose_status = 'decomposed'`

### 2. `fn_resplit_child_task` (再分解)

子 B (`stack_order = K`) を再分解して N 件を出す場合:

1. 同一 `user_id` で `stack_order > K` のすべての task を `stack_order += (N - 1)` でシフト (target B 自身は除外)
2. B を delete (`stack_order = K` 位置を空ける)
3. 新規子を `stack_order = K, K+1, ..., K+N-1` で insert (`parent_task_id = B.parent_task_id`)

ADR 0028 の「整数 `stack_order` + 後続シフト」「1 transaction で atomic」「並列競合は scope_out」という方針はそのまま継続する。**変わるのは shift 範囲だけ**。

### 3. レンダリング層

`buildStackItems` は decomposed 親を skip するだけの素朴版に戻す (PR #205 で入れた集約ロジックは廃止)。視覚順は DB の `(stack_order, created_at)` 順で素直に決まる。

### 4. データ移行

過去に旧 `fn_decompose_parent_task` で衝突 `stack_order` を持つ既存データは、視覚順 (= PR #205 の集約ロジックで見えていた順) に合わせて `stack_order` を 0..n-1 で振り直す one-shot data migration を同 migration ファイル内で実行する。

## Consequences

### 肯定的影響

- **視覚順 ≡ DB `stack_order` 順** の不変条件が回復する。reorder / 挿入が「視覚位置 → DB 順」の翻訳を必要とせず素直に動く。
- `buildStackItems` の責務が「decomposed 親を隠す」だけになりロジックが単純化される (PR #205 で入れた pendingChildrenByParent / decomposedParentIds が不要になる)。
- 子の DnD で「親グループ内の任意位置に挿入」「別親グループ間に未分解タスクを差し込む」が自然に可能になる (Issue #204 の派生バグ解消)。
- 既存データも data migration で自動的に正しい `stack_order` に揃う。

### 否定的影響・トレードオフ

- **書き込み量が増える**: 旧実装は同一親内の後続兄弟だけシフトしていたが、新実装はユーザー全体の後続 task を全部シフトする。ユーザーの total task 数 N に対して O(N) の update が走る。個人ツール段階 (N < 数百) では無視できる差。
- **ADR 0028 を部分的に supersede する**: ADR 0028 §1 ステップ 2 の「同一親内」という限定が本 ADR で覆る。ADR 0028 自体は「整数 `stack_order` + 後続シフト + atomic + 並列許容」の包括的な判断で、本 ADR はそのうち shift スコープだけを変える partial supersede。ADR 0028 の Status は Accepted のまま残し、Notes で本 ADR を参照する。
- **migration の冪等性に依存する**: data migration は全ユーザーの全 task の `stack_order` を再計算する。再実行しても同じ結果になる設計にしたが、運用時に手動操作 + migration の競合があり得る (個人ツール段階では実質ゼロリスク)。

## Alternatives considered

- **レンダリング層 (`buildStackItems`) で集約 (PR #205 の方向)**: 視覚順だけ直す。DB は触らない。
  → 視覚順と DB 順が乖離するため reorder 経路が壊れる (今回顕在化したバグ)。**不採用**。

- **`(parent_task_id, stack_order)` の複合キーで並べる**: 子の `stack_order` 空間を親 scope に閉じたまま、レンダリング時に親の `stack_order` を base に composite key を組む。
  → flat な 1 次元順序を 2 次元に拡張するため、DnD reorder の API ([id, stackOrder] の配列) と整合させる改造範囲が広い。schema 変更も発生しうる。**不採用**。

- **浮動小数 `stack_order`**: 子は親の `stack_order` と次の兄弟の中間値 (例: 1.5) を取る。後続シフトが要らない。
  → ADR 0028 で既に検討済み・不採用。schema migration が必要 + 精度の長期問題。**不採用**。

- **schema に `(user_id, stack_order)` の unique 制約を追加**: 今回の衝突をそもそも DB で禁止する。
  → 健全な防御層だが、reorder の transient な衝突 (renumber 中) を回避するための DEFERRABLE 設定が必要で、影響範囲が広い。本 ADR の対象外として将来別 ADR で検討。

## Notes

- ADR 0028 §1 ステップ 2 の「同一親内」は本 ADR で global に置き換わる。それ以外 (整数継続 / atomic / 並列許容) は維持される。ADR 0028 は in-place で書き換えず、Notes に本 ADR への参照を追加する。
- 本 ADR を supersede する trigger:
  - schema レベルで unique 制約を入れる場合 (本 ADR より強い defense になる)
  - 並列操作が日常化して「shift 中の transient 状態」がユーザーに見えるようになる場合 (atomicity と shift scope の見直しが必要)
  - 1 ユーザーの total task 数が数千 〜数万規模になる場合 (O(N) shift がボトルネック化)
