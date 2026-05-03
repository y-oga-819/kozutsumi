# ADR 0033: events の cross-calendar uniqueness と source-agnostic 命名

- **Status**: Accepted
- **Date**: 2026-05-03
- **Related**: [ADR 0031](./0031-calendar-subscription-and-event-promotion.md) / Issue #144 / Issue #146

## Context

ADR 0031 で複数 calendar 取り込みを採用した。これに伴い:

- **同じ external event id が cross-calendar で衝突する**ケースがある。例: 招待された会議が
  自分の primary と他人 calendar の両方から見える場合、event id は同じでも別レコードとして扱いたい。
  現状の events UNIQUE は `(source, external_id)` なのでこのケースを表現できない。
- 既存の `event_source` enum は `('manual', 'google_calendar')` で **複数 source 想定の設計** が
  最初から入っている。Apple Calendar 等の追加を将来視野に入れるなら、命名を Google 固定にせず
  source-agnostic にしておく必要がある。
- `unsubscribe → 再 subscribe` を跨いだ Phase 4 行動データの連続性 (ADR 0034) を action_log の
  metadata で確保するには、event を一意に識別する **source-agnostic な triple** が必要。

## Decision

events を **`(source, external_calendar_id, external_id)` の triple** で一意に識別する。

具体:

- `events` に `external_calendar_id text` 列を追加 (source 内での calendar 識別子)
- 既存 UNIQUE 制約 `(source, external_id)` を **`(source, external_calendar_id, external_id)`** に置き換える
- 命名は **source-agnostic** に統一する。Google 固定の名前 (`google_calendar_id` / `google_account_id`) は使わない:
  - `external_account_id`: source 内でのアカウント識別子 (Google の email、Apple の iCloud account 等)
  - `external_calendar_id`: source 内での calendar 識別子 (Google の calendarId、Apple の CalDAV calendar URL 等)
  - `external_id`: source 内での event 識別子 (既存列名を踏襲)
- subscription テーブル (ADR 0034 で具体化) も同じ命名を使う:
  `(user_id, source, external_account_id, external_calendar_id)` を unique key とする。
- action_log の event 関連 type (詳細は Issue #154) では metadata に **triple `(source, external_calendar_id, external_id)`
  を必須** で含める。これにより kozutsumi 内 uuid が変わっても (例: unsubscribe → 再 subscribe で events 物理削除を経た後)、
  Phase 4 分析は triple で同一 event を時系列に追える。
- `event_source` enum はそのまま維持。新 source 追加 (例: `'apple_calendar'`) は **enum 値追加 +
  subscription 設計の見直し** で対応する (本 ADR の supersede ではなく、新 source 対応 ADR を別途起票)。

## Consequences

### 肯定的影響

- **cross-calendar 衝突を表現できる**。同じ external event id を別 calendar に持っても conflict しない。
- **Phase 4 行動データの連続性**: action_log の triple で source 横断 / unsubscribe 跨ぎの同一性判定が可能。
  「同じ予定に対するユーザー判断の時系列」を再構成できる。
- **Apple 等の新 source 追加が軽い**: enum 値追加 + subscription テーブル設計の拡張で対応でき、
  events / action_log の命名変更 migration は不要。
- **subscription join が自然**: `events.external_calendar_id = subscription.external_calendar_id` で
  subscription default を引ける。

### 否定的影響・トレードオフ

- **既存 events 行の backfill が必要**。現状 primary 固定 (ADR 0008 supersede 前) で取り込まれた行は
  `external_calendar_id = 'primary'` で埋める migration が要る。
- **既存 UNIQUE 制約の置き換え** が migration で発生 (DROP CONSTRAINT + ADD CONSTRAINT)。既存データが
  triple で衝突しなければ安全だが、念のため事前検証する。
- **Apple Calendar 等の新 source 追加** は本 ADR 範囲外。新 source 追加時には subscription
  テーブル設計が源泉ごとに必要な属性 (例: CalDAV エンドポイント URL) で拡張される可能性があり、
  そのときに別 ADR を起票する。

## Alternatives considered

- **`external_id` を `${calendar_id}::${event_id}` で合成**: 列追加なしで衝突回避できるが、
  source 内で calendar 識別子が独立した属性として持てなくなり、subscription join が文字列分解を伴う。
  Phase 4 分析でも calendar 単位の集計が辛い。不採用。
- **`google_calendar_id` 等 Google 固定の命名**: 短期的には素直だが、将来 Apple 等を入れるたびに
  rename migration が必要になる。`event_source` enum が既に複数 source 想定なのと整合しない。不採用。
- **events の uniqueness を変えず、衝突は ON CONFLICT で握り潰す**: データの整合性を失う (どちらの
  calendar の event か不明になる)。Phase 4 分析が歪む。不採用。
- **新 source 対応を本 ADR で扱う (Apple / iCloud 含めた完全な設計)**: スコープが膨らむ。
  Apple 対応の具体的な制約 (CalDAV / EventKit 等) は実際に着手するときに判明するので、
  そのとき別 ADR で扱うほうが筋。不採用。

## Notes

- subscription テーブルの具体的な column 構成と migration は ADR 0034 + 実装 (Issue #144) で扱う。
- action_log の type 一覧と metadata schema は Issue #154 で確定する。本 ADR は「triple を必須含める」方針のみ宣言する。
- 既存 `event_source` enum はそのまま使用。新 source 追加 = enum 値追加 + subscription 設計拡張 (新 ADR)。
- 将来見直す条件:
  - cross-calendar 衝突が想定外パターンで起きる場合 (例: source 跨ぎの同一 ID) に triple では足りないと判明したら、
    本 ADR を supersede。
  - subscription / event 識別子に追加属性 (CalDAV URL 等) が必要になる新 source 対応時。
