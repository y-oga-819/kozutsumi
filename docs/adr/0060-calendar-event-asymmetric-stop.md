# ADR 0060: Calendar event は非対称 stop (auto-stop / manual resume)

- **Status**: Accepted
- **Date**: 2026-05-10
- **Related**: `docs/design/architecture.md` §1.2 / [Issue #234](https://github.com/y-oga-819/kozutsumi/issues/234) / [ADR-0058](./0058-timer-three-verbs-and-no-ai-interruption.md) / [ADR-0062](./0062-morning-review-ritual-fifteen-minutes.md)

## Context

想定ユーザーの行動特性 (#234) のうち (1) 過集中で時間を忘れる、を踏まえると、scheduled event (Google Calendar 等から取得した予定) の開始時刻に timer が回り続けると会議に遅れる事故が発生する。

調査 4 本横断で次の知見が示された:

- Comment 1 (Barkley): "Externalize Key Information" — 時間を「見える」状態にし続けるのが ADHD 文脈の処方
- Comment 4 (SDT): Motion 型の自動スケジューリング (タスクを次々に自動再開) は Autonomy を奪うと批判される

ADR-0058 で確定した「ユーザーが触るのは timer だけ」原則と、Autonomy 保持の両立が必要。

## Decision

Calendar event と timer の関係を **非対称** にする:

1. **予定の開始時刻になったら timer を自動停止 (auto-stop)** する
2. **予定終了時には自動再開しない (manual resume 必須)** — ユーザーが明示的に start を押すまで何も起きない

## Consequences

### 肯定的影響

- Externalize time (Barkley) の処方に適合。時間を忘れて会議に遅れる事故を構造的に防ぐ
- Autonomy 保持 — 予定終了後の作業再開は user 主導。Motion 型自動スケジューリングへの批判 (Autonomy 剥奪) を構造的に回避
- 「予定が終わって席に戻ってきたら timer が勝手に動いていた」という違和感がない
- per-task 計測のノイズが減る (scheduled event 中も timer が回り続ける状態を排除)

### 否定的影響・トレードオフ

- 予定終了後に再開し忘れて作業が放置されるケースが起きうる。これは ADR-0062 朝の棚卸しで事後検出される設計
- auto-stop のタイミング閾値 (予定開始時刻ジャストか / N 分前か) を実装で決める必要がある (本 ADR では「予定開始で stop する」までしか決めない)

## Alternatives considered

- **対称: 予定開始で auto-stop + 予定終了で auto-resume**: Autonomy 剥奪、Motion 型の批判に該当。会議終了直後に作業継続を強制される体感が不快。不採用
- **対称 (どちらも手動): 予定開始も auto-stop しない**: 想定ユーザー特性 (1) 過集中で時間を忘れる、への対処にならない。会議遅刻リスクが残る。不採用
- **何もしない (calendar event と timer を独立に扱う)**: scheduled event 中も timer が回り続けると per-task 計測がノイズだらけになる。不採用

## Notes

- auto-stop の具体的なタイミング閾値 (ジャスト / N 分前 / 通知時刻) は実装 issue で決める
- 関連: 既存 calendar 同期 ADR (0005-0010 系) は本 ADR で supersede されない (calendar 取得方式は変えない)
- 将来見直す条件: 「予定終了後の自動再開を opt-in で欲しい」要望が dogfooding で繰り返し出たら追加検討
