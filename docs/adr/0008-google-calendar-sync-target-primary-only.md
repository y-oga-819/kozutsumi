# ADR 0008: 同期対象は primary カレンダーのみ

- **Status**: Accepted
- **Date**: 2026-04-22
- **Related**: [ADR 0005](./0005-google-calendar-sync-via-route-handler.md)

## Context

Google Calendar は 1 ユーザーに複数カレンダー（primary、社内 Workspace 共有、
誕生日、購読カレンダー等）を持つ。同期対象として候補:

1. **primary カレンダーのみ**
2. **全カレンダー**（subscribed 含む）
3. **ユーザーが UI で選択した複数カレンダー**

Phase 2 の仮説検証（カレンダー連携で体験が改善するか）には、まず単純な
構成で動かして判断したい。複数カレンダー対応は UI 設計と取捨選択ロジックが
必要になり、Phase 2 のスコープを広げる。

## Decision

同期対象は **primary カレンダーのみ** (`calendarId = 'primary'`)。
複数カレンダー対応は将来 ADR で拡張する。

## Consequences

### 肯定的影響

- **実装が単純**。`calendarId = 'primary'` 固定で `events.list` を呼ぶだけ。
- **UI 設計が単純**。カレンダー選択画面が要らない。
- 仮説検証（連携で体験が改善するか）に必要な最小構成。

### 否定的影響・トレードオフ

- **会社アカウントの Workspace カレンダーや、共有カレンダーが反映されない**。
  Phase 2 の検証期間中、これが致命的に不便なら拡張が前倒しになる可能性あり。
- 複数カレンダー対応の必要性は Phase 2 の使用感で判断する（前提として「primary
  だけで足りる」かをまず確認したい）。

## Alternatives considered

- **全カレンダー**: 即座に便利だが、購読カレンダー（誕生日等）まで読み込んで
  ノイズが増える。選別ロジックを Phase 2 で組むのは過剰。不採用。
- **複数選択 UI**: Phase 2 の範囲を広げる。primary 固定で動かしてから必要性を
  判断するのが筋。不採用。

## Notes

- 取得期間（過去 7 日〜未来 30 日等の時間窓）は code の constant とする（ADR 化しない）。
- 拡張する時は本 ADR を Superseded にし、新 ADR でカレンダー選択モデルを定義する。
