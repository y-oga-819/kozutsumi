# ADR 0004: タイマーの状態機械と multi-tab 戦略

- **Status**: Accepted
- **Date**: 2026-04-19
- **Related**: `docs/design/vision.md` / `docs/design/architecture.md` §2 / Issue #27 (P1-5)

## Context

Phase 1 の P1-5 で「開始 / 中断 / 再開 / 完了」操作を実装するにあたり、
`task_time_entries` への insert/update のやり方と、以下の論点を決める必要がある。

1. **中断の表現**: 1タスク = 1 entry の `paused_at` 更新で表すか、
   再開のたびに新規 entry を作って複数行に分割するか。
2. **リロード時の復元**: 「アクティブ」状態をどう DB から復元するか。
3. **複数タブで同時に開始された場合の挙動**: 開いた 2 つのブラウザタブそれぞれで
   同一タスクに「開始」が押された場合どう整合させるか。
4. **duration_seconds の計算時点**: insert 時か close 時か。

これらは vision.md の差別化の核「行動パターン分析」のためのデータ品質に直結する。
中断履歴が欠損したり、重複 entry が生まれて合計時間が狂うと、
Phase 3 の見積もり補正エンジンの学習が不正確になる。

## Decision

**タイマー状態機械** を `tasks.status` (`idle` / `active` / `paused` / `done`) と
`task_time_entries` の open entry (paused_at = null) の組で表現する。
具体的には以下のルール:

1. **entry は再開のたびに分割**する。中断すると open entry を close し、
   再開すると新規 entry を insert する (= 1タスクに複数 entry が並ぶ)。
2. **`duration_seconds` は close 時点で計算して保存**する
   (= `paused_at - started_at`)。open entry は null。
3. **リロード復元**は `tasks.status` と最新 entries を引くだけ。クライアントは
   open entry が存在すれば active、なければ pauseReason バッジを最終 entry から
   引いて paused バッジを表示する。
4. **multi-tab は「後勝ち」**: start 時に既に open entry があれば
   `pause_reason = voluntary` で強制 close してから新規 entry を開く。

## Consequences

### 肯定的影響

- **中断理由の時系列が保存される**。"meeting で 30 分 → 再開して 15 分 → 割り込みで 10 分"
  のような粒度の分析ができる (Phase 3-4 で活きる)。
- **duration_seconds は不変量**。読み出し側で日時差分を毎回計算する必要がなく、
  Phase 3 の見積もり補正エンジンのクエリがシンプルになる。
- **後勝ち戦略**は実装が最小。別タブで開いた古い open entry を "voluntary" で
  強制 close することで、少なくとも合計時間は正しく積める。
- **リロード復元は DB 参照だけで完結**。localStorage 等の追加レイヤーが要らない。

### 否定的影響・トレードオフ

- **1タスクに entry が増えやすい**。頻繁に中断するユーザーでは 1タスクに 10+ 行もありうる。
  ただし Supabase で十分捌けるボリュームであり、action_logs 側の粒度とも揃う。
- **後勝ち** はユーザーが別タブで進めていた作業の中断理由が `voluntary` で上書き
  される。本当は meeting 由来だったかもしれない。だが Phase 1 のユーザーは著者 1 人で
  multi-tab の同時操作はレアケース扱いで十分と判断。将来問題になったら警告ダイアログを
  導入する。
- **close 時計算**のため、クライアントのクロックがずれていると duration がずれる。
  server time を使わないトレードオフ。Phase 1 の PoC としては許容。

### 将来的な制約

- Phase 2 の「MTG 開始時の自動 paused」(`pause_reason = meeting`) でも同じ entry 分割モデル
  を再利用する。meeting 終了後に新規 entry で再開する。
- Phase 3 の見積もり補正エンジンは `sum(duration_seconds)` で actual を取る前提。
  ある期間で未 close entry が残っている場合の扱いは別途判断 (当面: 無視して sum)。

## Alternatives considered

- **1 entry = 1 タスクで paused_at を上書き**: 中断履歴が消える。
  Phase 3-4 の行動分析で「中断理由ごとの時間構成」を見たいのに取れなくなる。不採用。
- **duration_seconds を insert 時に NULL で入れ、読み出し時に都度計算**:
  Phase 3 のクエリが「いま動いてる entry を除外して sum」という条件付きになり複雑。
  保存時に確定する方がシンプル。不採用。
- **multi-tab で先勝ち (後のタブでは「他のタブで動いています」エラー)**:
  UI のエラー導線を Phase 1 で作るのは過剰。後勝ちの方が UX としても自然。不採用。
- **localStorage で active state を先にキャッシュしてリロード復元**:
  DB が正の原則 (CLAUDE.md 「コードが仕様」) に反する。キャッシュレイヤーが増えると
  同期バグの温床。不採用。

## Notes

- 実装: `src/entities/task/time-entries.ts` (API 層) と
  `src/features/task-stack/useTaskTimer.ts` (状態機械 hook)。
- DB 制約 (`task_time_entries_pause_reason_requires_paused`) により、
  完了時の close では `paused_at` だけ打って `pause_reason = null` を許容する。
  これは「完了時の終了」と「中断」を区別するため。
- 見直し条件: Phase 2 で MTG 連動 paused を入れるとき、meeting 開始時の
  自動 close が後勝ちと衝突しないか要検証。
