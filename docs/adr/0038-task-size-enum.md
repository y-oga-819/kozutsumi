# ADR 0038: `task_size` enum 導入 — ユーザー意図サイズと AI 推定の分離

- **Status**: Accepted
- **Date**: 2026-05-04
- **Related**: [ADR-0036](./0036-simplify-task-registration-workflow.md) / [ADR-0022](./0022-task-category-labeling-per-generation-path.md) / [ADR-0024](./0024-estimation-correction-by-category-median.md) / [ADR-0025](./0025-estimation-correction-via-supabase-view-and-pure-fn.md) / [ADR-0026](./0026-estimation-correction-display-style.md)

## Context

現状、タスクの「重さ」は `tasks.estimated_minutes` (integer, nullable, `> 0`) の 1 軸で表現されている。ここに 2 つの異なる意味が混ざっている:

- ユーザーが登録時に「これはこれくらいだろう」と思った見立て (主観)
- AI 分解時に推定された分単位の値 (補正エンジンの入力)

vision の差別化軸 (行動パターン分析の深さ) に照らすと、**この 2 つは別シグナルとして分けて蓄積したい**。「ユーザーの主観サイズ」は本人の見積もり傾向 (甘い / 厳しい / カテゴリ別の癖) の核データであり、「AI 推定 + 補正後値」とは別の系列で残すほうが行動分析が効く。

また UX 面でも 1 軸では問題がある: 登録時にユーザーへ「分単位入力」を強いると、5 分単位の悩みで意思決定が遅延する。「これは 30 分くらい / 半日くらい」レベルの粗い感覚で十分なのに、UI が分の精度を要求している。

## Decision

新たに `task_size` を導入し、「ユーザーが感じたサイズ」と「AI 推定の `estimated_minutes`」を別軸で並存させる。

- **値域**: `'15m' | '30m' | '1h' | '2h' | '4h' | '1d' | 'large'` の 7 段階
- **DB 表現**: `text + CHECK` 制約 ([ADR-0022](./0022-task-category-labeling-per-generation-path.md) で確立した `task_category` と同じパターン。Postgres enum は使わない)
- **親登録時**: ユーザーが必須選択 (TaskForm の見積もり入力を `task_size` 7 段階に置き換える)
- **AI 分解時**: AI が子の `task_size` を推定し、出力スキーマに含める
- **`estimated_minutes` の扱い**: 削除しない。AI 推定値 (補正エンジン入力) として残し、`task_size` と並存する
- **既存タスクの migration**: `task_size` は NULLABLE で開始する。後方互換のため未設定 = 既存挙動 (estimated_minutes ベース) に倒れる

## Consequences

### 肯定的影響

- 主観サイズと推定値を分けて蓄積できる。「task_size=1h と申告したタスクの実所要中央値が 90 分」のような Phase 4 行動分析シグナルが取れる
- 登録時の認知負荷が下がる (分入力 → 7 段階ボタン)
- 既存の補正エンジン ([ADR-0024](./0024-estimation-correction-by-category-median.md) 〜 [ADR-0026](./0026-estimation-correction-display-style.md)) は `estimated_minutes` 軸のまま動く。互換性が保たれる

### 否定的影響・トレードオフ

- 軸が 1 つ増える分、AI prompt と DB schema の表面積が増える
- 7 段階に丸めることで「45 分」「90 分」のような中間値を表現できなくなる。これは「主観は粗くていい」という設計判断と背理しないが、UX 観察対象
- `task_size` ⇄ `estimated_minutes` の対応 (例: `1h` を分換算するときの代表値) は code 定数で持つ。代表値の選定は実装の関心であり ADR では扱わない
- AI 出力スキーマ拡張のため、`parseDecomposeResponse` と prompt の互換性に注意が必要 (segregated rollout で吸収)

## Alternatives considered

- **案A (1 軸維持: `estimated_minutes` のみ)**: 入力 UI だけ 7 段階ボタンにし、選択値を分換算して `estimated_minutes` に書く → 主観と推定が同じ列に混ざり、行動分析が分離不能になる。棄却
- **案B (Postgres enum)**: `CREATE TYPE task_size AS ENUM (...)` を使う → 値追加 / 削除が migration の手間 + ビュー再作成を伴う。プロジェクトとして既に `text + CHECK` パターンを採用しているので、それに揃える ([ADR-0022](./0022-task-category-labeling-per-generation-path.md) の前例)
- **案C (連続値 + presetボタン)**: 自由分入力 + よく使う preset ボタン → 結局「主観 vs 推定」が分離されない。棄却
- **案D (`estimated_minutes` を削除して `task_size` のみ)**: 補正エンジン ([ADR-0024](./0024-estimation-correction-by-category-median.md)) が分単位入力に依存しているため大規模 supersede が必要。今回の方針 (シンプル化) のスコープを超える。棄却

## Notes

- 値域の 7 段階の数や分割境界 (15m と 30m の間など) は本 ADR で確定する。これらは「ユーザー意図サイズの解像度」という設計判断であり、code 定数のチューニングではない
- 各値の代表分数 (例: `1h` を分に直す代表値)、AI prompt の出力スキーマ詳細、`MIN_CHILDREN` / `MAX_CHILDREN` との整合は実装の関心 (code constants)
- 既存タスクへの埋め戻し (NULL のまま運用 vs バックフィル) は migration 計画 (issue 起票) で詰める
- 補正エンジンとの関係: 補正は `category × estimated_minutes` 軸のまま継続。`task_size` は補正の入力ではなく、行動分析の独立シグナル
- 本 ADR の supersede trigger: 「主観サイズと推定値を 1 軸に統合する」「7 段階 → 別の段階数に変える」「`text + CHECK` を Postgres enum に切り替える」のいずれか
