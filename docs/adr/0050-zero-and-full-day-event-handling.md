# ADR 0050: ゼロ長 / 終日イベントを heuristic で扱う

- **Status**: Accepted
- **Date**: 2026-05-06
- **Related**: Issue #221 / Issue #222 / [ADR-0033](./0033-events-cross-source-uniqueness.md) / [ADR-0049](./0049-primary-calendar-id-as-resolved-real-id.md)

## Context

Google Calendar から取り込む event のうち、kozutsumi 上で「特殊な時間幅」をもつ 2 種類の扱いが未整理だった。

1. **終日 event** (Issue #221)
   - Google API は `start.date` / `end.date` (date-only, exclusive) で表現する
   - sync mapper は `start.date` / `end.date` を JST 00:00 として 24h の `[start, end)` に正規化して `events.start_time` / `end_time` に保存する
   - DB 上は `start = JST 00:00`, `end = 翌 JST 00:00`、終日フラグそのものは捨てている
   - UI は `HH:mm-HH:mm` で出すため「`00:00 - 00:00`」と表示され、終日であることが分からない
2. **ゼロ長 event** (Issue #222)
   - `18:00 までに学童のお迎え` のように `start === end` で登録される締切系の予定
   - DB 制約 `events_time_order check (end_time > start_time)` (strict) で弾かれて取り込みに失敗する
   - PR #220 (Issue #219 救済) でゼロ長は「skipped」に分類していたが、実害がある締切系は取り込みたい

両者は表面的には別 issue だが、内側では同じ問題を抱える:

- DB 上 `start_time` / `end_time` だけ持っていて、event の「種類」(timed / 終日 / 締切) を表す軸がない
- UI が `HH:mm-HH:mm` 一辺倒で、特殊な時間幅を上手く表現できない
- 将来 multi-tz 対応 (ADR-0049 でも触れた将来課題) が入ると、終日の JST 固定 heuristic は破綻する

## Decision

「ゼロ長 / 終日 を含む特殊な時間幅 event」を **DB schema を変えずに heuristic で扱う**。

具体的には:

1. **DB 制約**: `events_time_order` を `end_time > start_time` から `end_time >= start_time` に緩める。逆順 (`end < start`) は引き続き不正データとして弾く。
2. **sync mapper**: `resolveEventTimes` の skip 条件を「逆順のみ」に縮める。ゼロ長は upsert に乗せる。
3. **判定の集約**: `src/shared/lib/time.ts` に純粋関数として `isAllDayEvent(event)` / `isDeadlineEvent(event)` を 1 つずつ置く。heuristic は以下:
   - `isAllDayEvent`: start_time が JST 00:00 ぴったり、かつ duration が 24h の正の倍数
   - `isDeadlineEvent`: `start_time === end_time`
4. **UI 分岐**: 上記 2 関数を読むコンポーネントで、`HH:mm-HH:mm` 表示の代わりに以下を出す:
   - 終日: 「終日」 pill。複数日の終日は期間も補足
   - ゼロ長: ⏰ アイコン + `HH:mm` (締切感)
   - DayTimeline では終日 event を時刻判定 (`isPast` / `isNow` / `isNext`) から除外し、常に「今日中」として上段に表示する

判定 heuristic は **必ずこの 2 関数経由** で行い、UI / 表示計算ロジックに散らさない。

## Consequences

### 肯定的影響

- DB migration 1 枚 + heuristic 関数 1 ペアで両 issue を一気に解決できる (低コスト)
- 終日 / 締切系の予定が UI 上で意味のある形で可視化される
- heuristic の集約点が 1 箇所なので、将来 schema 化 (`is_all_day` 等のカラム追加) するときの差し替えが容易

### 否定的影響・トレードオフ

- **マルチタイムゾーン対応を入れた瞬間に終日 heuristic は破綻する**: `start_time = JST 00:00` 前提なので、別 tz のユーザーが終日予定を作ったら誤判定する。kozutsumi が単一ユーザー前提で JST 固定 (ADR-0049 で言及された将来課題) のため、現状は許容する。
- ユーザーが意図的に `00:00 - 24:00` (JST) の timed event を作った場合は終日と誤判定される。頻度はほぼゼロ・実害も低いと判断。
- `events_time_order` を緩めることで「end < start」だけが invariant になる。完全にゼロ長を弾く性質を失うため、DB 直叩きで意図しないデータが入る余地がある。code 側 (sync mapper / event form validation) で網羅する前提で受け入れる。

## Alternatives considered

- **DB スキーマに `is_all_day` (boolean) を追加 (案 A)**
  - 確実・曖昧さなし。multi-tz 対応時にも壊れない
  - 不採用理由: 現時点で実害が出ていない (単一ユーザー / JST 固定) のに対して、migration + sync mapper / UI 双方の改修コストが大きい。実害が出てから移行する方が筋が良い。本 ADR を supersede する trigger として `Notes` に残す。
- **ゼロ長 event を許容しない (案 X)**
  - DB 制約を strict のまま保ち、ユーザーに「`18:00-18:30`」等で登録してもらう
  - 不採用理由: Google Calendar 側でユーザーが既に「`18:00`」だけで登録する習慣があり、kozutsumi 側の制約のために登録方法を変えるのは本末転倒。
- **2 ADR に分割 (案 Y)**
  - `events_time_order` 緩和と heuristic 表示は厳密には独立に supersede されうる
  - 不採用理由: 「ゼロ長を許容したから heuristic を整える」「終日 heuristic を整えるなら同時にゼロ長も heuristic で扱う」という結合が強く、将来の supersede trigger も「schema で表現する」という共通の 1 つに集約される見込み。読みやすさを優先して 1 枚にした。

## Notes

- 本 ADR を supersede する代表的な trigger:
  - kozutsumi がマルチタイムゾーン対応する → 終日 heuristic が破綻するので案 A (`is_all_day` カラム追加) に切り替える
  - 「締切系」が独立したエンティティとして必要になる (例: 通知 / 順序付けで特殊扱い) → `events.kind` enum 等で表現する
- 「終日」「締切」をスタック計画ロジックでどう扱うか (例: 終日は ToDo に降ろさない、締切は依存条件として task に紐づけられる) は将来の判断。本 ADR は表示と取り込みの正規化のみ扱う。
