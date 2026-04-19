# ADR 0001: action_logs テーブルは Phase 1 から運用開始する

- **Status**: Accepted
- **Date**: 2026-04-15（prototype 着手時に決定）
- **Related**: `docs/design/vision.md`（差別化の核）/ `docs/design/architecture.md` §2.4 / Issue #23, #25

## Context

kozutsumi の差別化の核は「行動パターン分析の深さ」（vision.md）。スタック内での並べ替え、削除、
タイトル書き換え、active/paused 遷移、割り込みの発生タイミング等の操作履歴が、
Phase 3 の見積もり補正エンジンと Phase 4 の二段階提案の学習データ源になる。

一方、Phase 1 ではこれらのデータは**まだ使わない**。
Phase 1 のスコープは「手動でイベントとタスクを入力し、イベント駆動スタックの体験を検証する」こと。
分析は Phase 3-4 で行う。

したがって「Phase 1 で action_logs を作る必要があるのか」という論点が生じる。

## Decision

action_logs テーブルとロガーを **Phase 1 の初日から実装し、全操作を永続化する**。
UI 上では可視化しない（検索・閲覧画面は作らない）が、DB への記録は Phase 1 から漏れなく行う。

## Consequences

### 肯定的影響

- **データの取りこぼしが発生しない**。Phase 3 で学習を始める時点で、過去数ヶ月分の
  実使用データが既に蓄積されている（著者自身が Phase 1 を使い込む前提）。
- **スキーマ変更コストを前倒しで回避**。action_logs のスキーマは Phase 3 の学習内容に
  依存するが、Phase 1 のうちから JSONB metadata で揺らぎを吸収しておけば、
  Phase 3 で既存データを破棄せずに済む。
- Phase 2 以降に遡って後付けしようとすると、既に数週間〜数ヶ月使い込んだ後になり、
  **行動パターンの初期サンプルを永久に失う**リスクがある。

### 否定的影響・トレードオフ

- Phase 1 の実装工数が増える（logger.ts、action_type 定数、呼び出し箇所の仕込み）。
- action_type の命名を Phase 1 時点で決める必要がある（後から変更は可能だが、
  既存データとの整合が必要）。
- RLS の設定対象テーブルが増える。

実装工数は小さく（logger は薄いラッパー）、取りこぼしを回避する価値の方が大きいと判断。

## Alternatives considered

- **Phase 3 で作る**: スキーマ・呼び出し箇所を全部 Phase 3 で追加。
  → Phase 1-2 の数ヶ月分の行動データを失う。差別化の核が弱る。不採用。
- **Phase 1 はファイル or console のみ、DB 化は Phase 2**: prototype 段階では採用していた。
  → Phase 1 本実装 (Issue #25) で DB 化することにより解消。
- **Phase 1 から UI も作る（ログ閲覧画面）**: スコープ過多。
  → UI は Phase 4 の分析機能と合わせて作る。

## Notes

- Phase 1 時点で定数化する action_type は Issue #25 に列挙。
  今はコード (`src/entities/action-log/logger.ts` / `types.ts`) が正。
- fire-and-forget で UI をブロックしない実装にする（DnD の体感ラグ回避）。
