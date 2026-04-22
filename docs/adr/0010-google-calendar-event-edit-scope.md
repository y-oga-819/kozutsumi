# ADR 0010: google_calendar イベントは Google 側属性を read-only、kozutsumi 拡張だけ編集可

- **Status**: Accepted
- **Date**: 2026-04-22
- **Related**: [ADR 0006](./0006-google-calendar-sync-mode-staged-adoption.md) / `docs/design/architecture.md` §2.5

## Context

[ADR 0006](./0006-google-calendar-sync-mode-staged-adoption.md) で、`google_calendar` ソースのイベントは
Google 側から full sync で upsert され、将来 syncToken 差分同期に移行する設計とした。

一方、kozutsumi の `events` テーブルには Google Calendar には存在しない拡張属性がある:

- `project_id`: kozutsumi のプロジェクト階層（architecture.md §2.1）に紐づけるリンク
- `description` (markdown): kozutsumi 側で書くメモ（Google の description とは別概念）

ユーザーは `google_calendar` イベントの詳細パネルを開いた時、何を編集できるべきか。
以下が論点:

1. **title / start_time / end_time / meet_url / has_attachments**（Google 側が正）は
   kozutsumi 側で編集できるか
2. **project_id / description**（kozutsumi 拡張）は編集できるか
3. **削除**はできるか
4. **Google 側の description** と **kozutsumi 側の description** を混ぜるのか分離するのか

## Decision

### 1. Google 側属性は read-only

`source = 'google_calendar'` のイベントについて、以下は **UI から編集不可**:

- `title`
- `start_time` / `end_time`
- `meet_url`
- `has_attachments`
- `external_id`

これらを変えたい場合は Google Calendar 側で編集する。次回同期で反映される。

### 2. kozutsumi 拡張属性だけ編集可

以下は `google_calendar` イベントでも編集可能:

- `project_id`（どのプロジェクトに紐づけるか）

### 3. description は Google 側の値で上書きする（kozutsumi 独自メモは持たない）

`description` カラムは Google 側の description で上書きする運用とする。
kozutsumi 独自のイベントメモは Phase 2 では持たない。

理由: 独自メモを持つと「どちらを表示するか」「同期時にどう扱うか」の判断が
生まれて、Phase 2 の仮説検証（連携で体験が改善するか）からズレる。必要性が
確認されたら将来 ADR で `events.user_notes` のような別カラムを追加する。

### 4. 削除は不可

`source = 'google_calendar'` のイベントは UI から削除できない。Google 側で
削除すると次回同期で `status: 'cancelled'` を受け取って local から消える。

### 5. manual イベントは従来通り全て編集可

`source = 'manual'` のイベントの挙動は Phase 1 から変えない。

## Consequences

### 肯定的影響

- **「Google 側が正」という単純な責務分離**。同期と編集の間で競合が起きない。
  次回同期で上書きされるリスクをユーザーに説明する必要もない。
- **UI が単純**。`source` によって編集可能なフィールドが切り替わるだけで、
  複雑なマージロジックが要らない。
- **description の二重管理を回避**。Google 側の description を使うと決めたことで、
  Phase 2 のデータモデルに揺らぎが入らない。

### 否定的影響・トレードオフ

- **kozutsumi 独自のメモを書きたい場合の出口がない**。MTG に対する私的な準備
  メモを書く場合は manual イベントか、関連タスクの body に書く運用になる。
  実運用で不便が強ければ将来 `events.user_notes` 等で拡張する。
- **Google Calendar 側で誤編集した時の戻し口が UI にない**。ただし Google
  Calendar 側に履歴機能があるので実害は小さい。

## Alternatives considered

- **全フィールド編集可**: 同期との競合が避けられない。「次に同期したら消える」
  という UX 上の不意打ちが発生する。不採用。
- **Google 由来 description と kozutsumi 独自メモを別カラムで併存**: データモデル
  は綺麗だが、Phase 2 の範囲を超える。必要性が確認されてからで遅くない。不採用。
- **UI 上で編集を許しつつ、同期時にマージ戦略を実装**: ロジックが複雑化し、
  行動ログで「どちらを優先したか」を分析可能にする必要が出る。Phase 2 の
  仮説検証とは関係ない複雑度。不採用。

## Notes

- 編集制御は UI 層（詳細パネル）だけでなく、RLS や API 層でも担保するかは
  実装 issue で判断（現時点の RLS は `user_id` ベースのみ。source による
  制約は DB 側 trigger を足すか、アプリ層で担保するかの選択）。
- 将来「kozutsumi 独自メモ」が必要になったら `events.user_notes text` 等で
  拡張し、本 ADR を superseded する。
