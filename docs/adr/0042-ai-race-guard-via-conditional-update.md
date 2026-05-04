# ADR 0042: AI 機能の race guard は条件付き UPDATE で claim する

- **Status**: Accepted
- **Date**: 2026-05-04
- **Related**: Issue #157 / [ADR-0017](./0017-ai-task-decomposition-async.md) / [ADR-0021](./0021-ai-decomposition-failure-visibility.md) / [ADR-0027](./0027-child-resplit-flatten.md)

## Context

AI 機能 (decompose / resplit / categorize) は fire-and-forget の Route Handler から起動される ([ADR-0017](./0017-ai-task-decomposition-async.md))。同じタスクに対する 2 重 click や client 側 optimistic ズレで重複起動が発生し、race を踏むと:

- `decompose_status` が `decomposing` で固まる ([ADR-0021](./0021-ai-decomposition-failure-visibility.md) §1 不変条件の violation)
- 1 本目成功後の 2 本目が `target_not_found` 経由で spurious な `task_decompose_failed` を action_log に積む ([ADR-0021](./0021-ai-decomposition-failure-visibility.md) HC-4 学習素材の品質劣化)
- 人間 override が AI 応答到着で上書きされる (categorize)

現状、3 つの AI server で guard 戦略が非対称:

| server | pattern |
|---|---|
| `decompose-server.ts:48-66` | read → guard 判定 → `setDecomposeStatus("decomposing")` の **2 step。間に TOCTOU race window** |
| `resplit-server.ts:87,239-255` (`tryClaimDecomposing`) | `.update().eq().neq()` の **条件付き UPDATE で 1 step claim** |
| `categorize-server.ts:74-93` | `.update().eq().is("task_category", null)` の **条件付き UPDATE で 1 step claim** |

新規 AI 機能を追加するとき、どちらを踏襲すべきかコードから読み取れず、選定意図も明文化されていない。

## Decision

AI 機能の race guard は **条件付き UPDATE で対象列を atomic に claim する** pattern に統一する。新規 AI 機能はこの pattern を踏襲する。

具体には:

- 「AI が排他的に書き込む列」を 1 つ決め、その列の「未着手を表す値」を `WHERE` 条件に入れた `UPDATE ... RETURNING` を投げる
- 0 行更新 = 既に他 actor (concurrent run / 人間 override) が確定済 → orchestrator は skipped に倒す
- 1 行更新 = 自分が claim 成功 → 以降の AI 呼び出しに進む

既存 `decompose-server.ts` も同 pattern に揃える (issue #157 の実装フェーズで対応)。

共通 helper は **作らない**。guard 列と未着手判定の述語が機能ごとに異なる (`decompose_status != 'decomposing'` / `task_category IS NULL` / 将来追加される列) ため、generic 化すると call site の意図が薄れる。pattern (規約) を共有するだけで十分。

## Consequences

### 肯定的影響

- 新規 AI 機能追加時に「どちらを踏襲すべきか」の迷いが消える
- decompose の TOCTOU race window が消え、[ADR-0021](./0021-ai-decomposition-failure-visibility.md) §1 の不変条件が DB レベルで保証される
- spurious `task_decompose_failed` log が減り、Phase 4 学習素材の品質が向上する
- 各 server に置かれる `tryClaim*` 関数が同じ命名・形になり、コードレビューで「これは race guard」と一目で識別できる

### 否定的影響・トレードオフ

- 既存 `decompose-server.ts` を揃える migration PR が 1 本必要 (issue #157)
- 各 server に `tryClaim*` の薄い実装が重複する (共通 helper を作らない判断のコスト)
- 条件付き UPDATE が 0 行更新を返すケースを必ず分岐扱いする必要がある (write-time error か concurrent claim かを区別する)。これは既に resplit / categorize で実装パターンが確立しているので追従するだけ

## Alternatives considered

- **案A**: 共通 helper `guardAiClaim(column, predicate, target)` を作る
  - 不採用: guard 列・未着手述語・成功時の値が機能ごとに異なり、generic signature が複雑化する。call site で「この helper が何を排他しているか」が読み取りにくくなる。pattern (規約) として共有するだけで code 重複は最小 (各 `tryClaim*` は数行)
- **案B**: 現状維持 (decompose は 2 step、新規は実装者判断)
  - 不採用: [ADR-0021](./0021-ai-decomposition-failure-visibility.md) §1 不変条件を破る race window が残る。新規実装者が判断ミスで 2 step を選ぶと race window が増える
- **案C**: 新規 AI 機能だけ resplit pattern を踏襲、decompose は触らない
  - 不採用: 一貫性が崩れたままで「なぜ decompose だけ違うか」が読み取れない。新規実装者は古い decompose を見て真似する可能性が高い (近場のコードを参照しがち)
- **案D**: Supabase RPC (Postgres function) に concurrency control を寄せる
  - 不採用: 現在の `fn_decompose_parent_task` / `fn_resplit_child_task` は claim 後の atomic な write 部分を担っており、claim 自体は orchestrator (TS 側) で行う方が「AI 呼び出し前後」の制御フローが追いやすい。RPC 化が必要になるのは別 trigger (例: ストリーム化 / queue 経由) で、その時に supersede すればよい

## Notes

- 既存 `decompose-server.ts` を揃える実装は issue #157 で行う。2 step を 1 step に変える際、`SKIP_STATUSES` (`status` 列) と `ALREADY_RESOLVED` (`decompose_status` 列) は別概念なので、status は read 時 check + decompose_status は条件付き UPDATE、という形にする
- supersede trigger:
  - 別の concurrency control (Postgres advisory lock / SELECT FOR UPDATE / message queue で single-writer 保証) に倒す方針に変えた時
  - DB を Postgres から別物に変えた時
  - AI orchestrator を Route Handler から別基盤 (queue worker 等) に移し、claim 自体を queue 側で行う時
- 関連 code:
  - `src/entities/task/decompose-server.ts:48-69` (旧 pattern, 揃える対象)
  - `src/entities/task/resplit-server.ts:87,239-255` (`tryClaimDecomposing`)
  - `src/entities/task/categorize-server.ts:74-93` (条件付き UPDATE on `task_category IS NULL`)
