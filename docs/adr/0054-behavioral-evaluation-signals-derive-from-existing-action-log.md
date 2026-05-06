# ADR 0054: AI 分解品質の行動評価信号は既存 action_log から導出する（新規 event 追加なし）

- **Status**: Accepted
- **Date**: 2026-05-06
- **Related**: Issue #213 / 親 roadmap #208 / [ADR-0024](./0024-estimation-correction-by-category-median.md) / [ADR-0030](./0030-child-resplit-action-log.md) / [ADR-0035](./0035-action-log-payload-schema-and-actor-type.md) / [ADR-0051](./0051-capture-user-editorial-signals-on-decomposition.md)

## Context

親 roadmap #208 軸 2「個人の作業スタイル」を補うための行動評価信号として、Issue #213 で以下 4 つを集めたいと整理した:

1. 子タスクの**先送り率**（着手されず日跨ぎする率）→ 粒度大きすぎサイン
2. 子タスクの**再分割率** → 一発で正解にならなかったサイン
3. 子タスクの**見積もり時間 vs 実時間の誤差**（タスク種類別）→ キャリブレーション源
4. 子タスクの**完了率 / 完了順序** → 順序設計の妥当性

Issue #213 で詰めるべきと挙がった論点は次の 3 つ:

- (a) action_log の event 種別を整える（既存に足りるか / 新規 event 追加か）
- (b) 集計クエリの設計（後で重くならないか）
- (c) prompt 注入時の使い方（context 量 / 抽象度）

ADR-0051 で AI 分解への user editorial signal（title 編集 / 子削除 / 子追加 / 再分解の lineage）は完全捕捉される状態になった。残るのは「精度評価のための客観行動指標」を新たな event として持つかどうかの判断である。

action_log の現状を監査した結果、4 信号と既存 event の対応は以下:

| 信号 | 既存信号での取得可否 |
|---|---|
| 先送り率 | `task_started` の欠損 + `task_created`/`task.created_at` の日跨ぎ判定で**集計時に導出可能** |
| 再分割率 | `task_child_resplit` で完全捕捉。ADR-0051 D3 の `source_decomposition_log_id` chain で多段 resplit も lineage 追跡可 |
| 見積もり誤差 | `task_completed` の `estimated_minutes` / `actual_minutes` で完全捕捉。category 別中央値は ADR-0024 の view (`task_category_correction_factors`) で既に集計済み |
| 完了率 / 順序 | `task_completed.created_at` の時系列 + `parent_task_id` join で再構成可。親タスクの自動完了が無い件は別問題（手動完了で十分） |

新規 event を増やす必要があるのは「先送り率」だけだが、これも既存信号の組み合わせで導出できる。

## Decision

**4 信号いずれについても、新規 action_log event type は追加しない。既存 action_log と task テーブルからの導出（集計クエリ）で取得する。**

論点 (a) / (b) / (c) は次のように分岐する:

### D1. event 種別 — 新規追加なし

4 信号すべてを既存の `task_started` / `task_completed` / `task_child_resplit` / `task_decomposed` / `task.created_at` から導出する。本 ADR で確定する取得経路は次の表のとおり:

| 信号 | 取得経路 |
|---|---|
| 先送り率 | `task.created_at` と最初の `task_started` の有無で「日跨いで未着手か」を判定する集計 |
| 再分割率 | `task_child_resplit` の発生数を `task_decomposed.metadata.child_ids` の母集団で割る。ADR-0051 D3 の `source_decomposition_log_id` で初期分解 → resplit を join |
| 見積もり誤差 | `task_completed.metadata.estimated_minutes` / `actual_minutes` を category で group。ADR-0024 の既存 view を流用 |
| 完了率 / 順序 | `task_completed.created_at` の時系列を `parent_task_id` で group して順序を再構成 |

### D2. 集計レイヤの選定は本 ADR の範囲外

view を切るか / 都度クエリか / materialized view 化するかは、prompt 注入の使い方（context 量・抽象度・更新頻度）が確定してから決める。**本 ADR では「どこから取れるか」のみを確定し、集計戦略は利用 issue / 個別 ADR で扱う**。

### D3. prompt 注入の設計は Phase 4 着手時に個別 ADR

「どの信号を、どの粒度で、どう要約して、AI 分解 / スコアリングの prompt に注入するか」は実利用フェーズで詰める。本 ADR ではスコープ外。

## Consequences

### 肯定的影響

- migration / schema 拡張ゼロ。実装コストが極小（ADR を 1 本書いて issue を close する以外の作業が無い）
- 過去ログがそのまま行動評価信号の母数になる。ADR-0035 §6 の「過去ログ backfill しない」原則と整合し、信号取得を**今すぐ開始できる**
- ADR-0051 と方針が揃う（「event type を増やすより既存信号の活用を優先」）。kozutsumi の action_log 設計の一貫性を保つ
- 「先送り」のような曖昧な user 行動を新 event 化しないことで、後から「先送りの定義が違った」と気づいた時に schema rollback が不要

### 否定的影響・トレードオフ

- 「先送り」が user の**能動的な判断**（「明日やる」を明示的に押した）と**暗黙的な放置**（単に手をつけなかった）を区別できない。当面 UI に能動 punt 操作が無いので実害なしだが、将来 UI が拡張されたら本 ADR を見直す
- 集計クエリに「`task_started` 欠損 × `created_at` 日跨ぎ」のような複合 logic が要る。view を切れば呼び出し側の複雑度は隠せるが、view 設計判断は別 ADR に持ち越し（D2）
- 親タスクの自動完了が無いため、親レベルの「完了率」は user が手動完了させた割合になる。子タスクレベルの完了率には影響しないので、当面の Phase 4 prompt 用途では問題にならない

## Alternatives considered

- **案 A: 「先送り event」（例 `task_punted`）を新設する** → ❌ 現状の UI に能動的 punt 操作が存在せず、event 化する**起点 (firing point) が無い**。将来 punt 専用 UI を入れる時に新設すればよく、今 schema を増やしても発火されないコードが残るだけ
- **案 B: 4 信号を集めるための集計 view を本 ADR で同時確定する** → ❌ view 設計は prompt 注入の使い方（更新頻度 / 集計粒度 / context 量）と一体で決まる。今の段階で view 化すると、Phase 4 着手時に必ず再設計が必要になる。supersede trigger が独立しないため ADR の粒度として正しくない（SKILL §1）
- **案 C: 4 信号それぞれを別 ADR にする** → ❌ 本 ADR で下す判断は「**新規 event を追加するか否か**」という 1 つの判断。各信号の集計戦略は将来 D2 / D3 で個別 ADR 化される予定なので、本 ADR を信号ごとに割っても supersede trigger が独立せず、過剰分割になる
- **案 D: ADR-0051 に取り込んで本 ADR を起票しない** → ❌ ADR-0051 は「user editorial signal の捕捉」、本 ADR は「行動評価信号の取得方針」で対象 signal が異なる。supersede trigger も独立する（editorial signal の補捉手段は変わっても行動評価信号の方針は影響しない、逆も同じ）

## Notes

### 将来見直す条件

- 能動的 punt UI（「明日やる」ボタン等）が追加された場合 → 「先送り」の能動 / 受動を区別する独立 event を検討する個別 ADR を起票し、本 ADR の D1「先送り行 (line)」だけを supersede（本 ADR 全体の supersede ではない）
- 集計クエリのコストが膨らみ view 化 / materialized view 化が必要になった場合 → 集計層の ADR を新規起票（本 ADR D2 を埋める形）
- prompt 注入の context 設計が固まってきた場合 → Phase 4 着手 ADR で本 ADR を `Related` に引く

### 監査の根拠

- `task_started` / `task_completed`: `src/entities/action-log/types.ts` / DB migration `supabase/migrations/20260419000000_initial_schema.sql:117-134`
- `task_child_resplit.metadata.resplit_target_snapshot.source_decomposition_log_id`: ADR-0051 D3 で追加（`src/entities/task/resplit-server.ts:57`）
- `task_completed.metadata` の見積もり誤差用フィールド: `src/entities/action-log/types.ts` （`estimated_minutes` / `actual_minutes`）
- category 別補正 view: ADR-0024 / ADR-0025 で確定し既に運用中

### 実装スコープ（本 ADR 外）

本 ADR が確定するのは「**新規 event を追加しない**」「**4 信号は既存経路から導出する**」の 2 点のみ。集計クエリの実装 / view 化判断 / prompt への注入設計は本 ADR では扱わない。Issue #213 は本 ADR の確定と同時に close する。
