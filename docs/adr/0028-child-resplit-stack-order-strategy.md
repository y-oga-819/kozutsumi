# ADR 0028: 子タスク再分解の並び順は整数 stack_order + 後続兄弟の一括シフトで再構築する

- **Status**: Accepted
- **Date**: 2026-04-30
- **Related**: `docs/design/architecture.md` §1.3 / [ADR 0027](./0027-child-resplit-flatten.md) / Issue #121

## Context

ADR 0027 で「子の再分解結果は flatten で同じ親の子として配置する」と決めた。これに伴い、再分解時に同一親内の `stack_order` を再構築する操作が発生する。

例: 子 [A(0), B(1), C(2)] のうち B を再分解して b1/b2/b3 が出る場合、結果として [A(0), b1(1), b2(2), b3(3), C(4)] にする必要がある。後続の C は `stack_order` が 2 → 4 にシフトする (シフト量 = 新規子数 - 1)。

ここで並び順データ構造の選択肢が分岐する:

- **整数 `stack_order` + 後続シフト**: 既存の実装パターン。挿入時に N 件 update が走る
- **浮動小数 / 分数 `stack_order`**: 1 と 2 の間に 1.5 を入れる方式。挿入が cheap だが精度が縮む
- **linked list (`prev_id` / `next_id`)**: 局所更新で済むが、reorder mutation が大改造になる

現状 (`SupabaseTaskGateway.reorder`) は整数 `stack_order` + 並列 update。要求定義 SC-4 で「整数方式の継続を許容できる」とユーザーが明示している。

判断の論点は「個人ツール段階で 20-30 件規模の update 負荷が許容できるか」「並列 reorder との競合が問題化するか」。

## Decision

並び順データ構造は **整数 `stack_order` を継続** し、再分解時は同一親内の **後続兄弟の `stack_order` をトランザクション内で一括シフト** する。

### 1. 並び順の再構築

子 B (`stack_order = K`) を再分解して N 件の新規子 b1..bN が出る場合:

1. b1..bN を `stack_order = K, K+1, ..., K+N-1` で insert
2. 同一親内で `stack_order > K` の後続兄弟を `stack_order += (N - 1)` でシフト
3. B を delete (元の `stack_order = K` を b1 が引き継ぐ)

### 2. atomicity

上記 1〜3 を **1 トランザクション内** で実行する。クライアント側の Promise.all による並列 update ではなく、Supabase の rpc (PL/pgSQL function) で BEGIN/COMMIT を 1 つの SQL function 内に封じる。

これは現状の `SupabaseTaskGateway.reorder` (個別 update を Promise.all で流す方式) とは別経路の、再分解専用の transactional method として実装する。

### 3. 並列競合の扱い

並列で他端末が reorder している間に再分解が走り、`stack_order` が衝突する可能性は **個人ツール段階では許容** する (要求定義 scope_out)。

## Consequences

### 肯定的影響

- **既存の整数 `stack_order` 前提コードが不変**。`SupabaseTaskGateway.reorder` / `list` 等の既存パスを変更しない
- **データ移行コストがゼロ**。浮動小数 / linked list への schema migration が不要
- **20-30 件規模なら p95 で問題ない** (個人ツール段階の負荷想定)
- **PL/pgSQL function 内で atomicity が保証される**ので、partial failure による `stack_order` の重複や dangling parent_task_id が発生しない
- **要求定義 HC-3 (並び順の決定論性) を満たす**

### 否定的影響・トレードオフ

- **再分解時の DB 書き込み量が「新規子数 + 後続兄弟数」に比例**。1 親 30 件で全件後続シフトの場合、最大 30 件程度の update。20-30 件規模なら許容できるが、子数が 100 件超になる規模では再考が必要
- **PL/pgSQL function による transaction 管理が必要**。1 つの SQL function を migration として追加する実装コストが発生する
- **並列 reorder との競合解決をしない**。複数端末同時操作で並び順がユーザーの意図と外れる可能性がある (個人ツール段階では発生頻度が低い前提)
- **「再分解後の `stack_order` は一時的に重複する瞬間がある」という性質を内部に持つ**。トランザクション内で解消されるので外から見える状態にはならないが、PL/pgSQL function を書く際の注意点として残る

## Alternatives considered

- **浮動小数 / 分数 `stack_order`** (例: 1 と 2 の間に 1.5 を入れる):
  - 挿入時に後続を update しなくて良い
  - 精度が縮むので長期的には rebalance が必要になる
  - 既存の整数 `stack_order` からの schema migration が必要
  - 浮動小数の比較で並び順の安定性に不安 (binary representation の問題)
  - **不採用**。個人ツール段階で update 負荷は許容できるため、移行コストを払う動機が薄い

- **linked list (`prev_id` / `next_id` カラム)**:
  - 挿入 / 削除が局所更新で済む
  - 既存 reorder mutation が大改造 (整数 `stack_order` の前提が全面変更)
  - linked list は壊れやすい (中間ノード欠損で全体が破綻)
  - **不採用**

- **子のグループ別 `sub_order` を別 column で持つ**:
  - 親 group 内での順序のみ管理し、flat 表示時に親の base_order × 1000 + sub_order 等で合成
  - schema 変更 + 表示ロジックの全面修正が必要
  - 既存 ADR 0016 の Stack View 描画ロジックと整合性を取り直す必要がある
  - **不採用**

- **client 側の Promise.all による個別 update (現状 `reorder` パターン)**:
  - 既存実装と同じパスで簡単
  - partial failure 時に `stack_order` が破損する (中間で失敗すると重複や dangling が発生)
  - **不採用**。再分解は delete + insert + reorder を atomic にする必要があるため、トランザクション保証が必須

## Notes

- 既存の `SupabaseTaskGateway.reorder` は変更しない。再分解用の `resplitTransaction` method を新設し、PL/pgSQL function を介して atomic 化する。普段の DnD 並べ替えは現状の Promise.all 方式のまま (こちらは個別 update が partial failure しても影響範囲が限定的)
- PL/pgSQL function 名は `fn_resplit_child_task` を想定 (実装パラメータ)。引数は `target_id` / `new_children jsonb` / `shift_amount int` 等
- **2026-05-05 追記**: 本 ADR §1 ステップ 2 の「同一親内」シフトは [ADR 0047](./0047-decompose-resplit-shift-scope-global.md) で同一 `user_id` のユーザースコープ全体に拡大された。`buildStackItems` の flatten で子と親兄弟が同じ視覚平面に並ぶため、`stack_order` 空間も同一スコープで衝突しないように振る必要がある (Issue #204)。本 ADR の他の判断 (整数継続 / atomic / 並列許容) は維持される。
- 本 ADR を supersede する trigger:
  - **並列 reorder の頻度が増え、競合が体感できる問題になる**: 浮動小数 stack_order or linked list への移行を別 ADR で検討
  - **1 親の子数が 100 件超になる規模が常態化する**: 後続シフト量が大きくなりすぎ、書き込み負荷で目立つ遅延が出る場合
  - **マルチテナント / プロダクト化で同時操作が日常的になる**: 個人ツール段階の許容前提が崩れる場合
- 本 ADR は「再分解時の並び順データ構造」のみを決める。再分解の方針自体は ADR 0027、prompt 設計は ADR 0029、action_log は ADR 0030 で別途記録する
