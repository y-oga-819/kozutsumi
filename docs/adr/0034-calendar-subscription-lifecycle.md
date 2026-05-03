# ADR 0034: subscription 取り込み戦略 (subscribe / sync / 切替 / unsubscribe / 再 subscribe)

- **Status**: Accepted
- **Date**: 2026-05-03
- **Related**: [ADR 0031](./0031-calendar-subscription-and-event-promotion.md) / [ADR 0032](./0032-events-visibility-override-physical-model.md) / [ADR 0033](./0033-events-cross-source-uniqueness.md) / [ADR 0001](./0001-action-logs-from-phase1.md) / Issue #144 / Issue #145 / Issue #146 / Issue #154

## Context

ADR 0031 で events visibility の 3 層モデル (subscription / auto-promote toggle / event override) を確定し、
ADR 0032 で Layer 3 の物理化 (`visibility_override` enum)、ADR 0033 で events の triple identifier を確定した。

本 ADR は **Layer 1〜2 (subscription) のライフサイクル** に関わる挙動を確定する。
具体的には以下の操作と event / action_log への影響:

- 初回 subscribe (calendar を新規取り込み対象にする)
- 通常 sync (定期 / 手動)
- Google 側での event 削除検知
- subscription auto_promote の ON ↔ OFF 切替
- unsubscribe (calendar を取り込み対象から外す)
- 再 subscribe (一度 unsubscribe した calendar を再度 subscribe)

これらの判断は **Phase 4 行動データの連続性** に直結する (vision 差別化の核)。
events を物理削除する操作 (Google 削除 / unsubscribe) でも分析価値が失われない設計が必要。

## Decision

### 操作ごとの挙動

| 操作 | 挙動 |
|---|---|
| **初回 subscribe** | 過去 N 日分も含めて event を取り込む (N は code 定数、現状 7 日想定で調整可)。新規取り込み event は `visibility_override='none'` で insert。auto_promote=ON なら timeline 表示、OFF なら非表示 (subscription default に従う) |
| **過去 event の表示** | subscription default に従う (過去だけの特別ルールなし)。「振り返って見たくない」場合は個別に demote する |
| **通常 sync** | 新規 event は `'none'` で insert。既存 event の `visibility_override` は **保持**、Google 由来フィールド (title / start / end / location 等) のみ upsert |
| **Google 側 event 削除** | events 物理削除 + 後述の `event_deleted_by_source` を action_log に記録 + 関連 tasks への伝播 |
| **auto_promote 切替** | 切替時点で `visibility_override='none'` の **過去 event** を旧 default の値 (`'shown'` または `'hidden'`) で固定する bulk update を行う。`'none'` の **未来 event** は更新しない (新 default に追従)。bulk update 操作は system 主体として action_log に `event_visibility_frozen_by_subscription_toggle` を記録 |
| **過去 event の個別 override** | 制限なし、いつでも `none → shown` / `none → hidden` / `shown ↔ hidden` 可 |
| **unsubscribe** | events 物理削除 + `calendar_unsubscribed` を action_log に記録 (削除された events の snapshot を含む) + 関連 tasks への伝播。Google 削除と挙動は揃える |
| **再 subscribe** | ゼロから取り込み直し (kozutsumi 内 uuid は新規)。Phase 4 の連続性は action_log metadata の triple `(source, external_calendar_id, external_id)` で確保 |

### 「過去」と「未来」の境界

auto_promote 切替時の bulk update における「過去 event」とは **切替操作のサーバー時刻 (`now()`) より `start_time` が前** の event を指す。タイムゾーン解釈の必要はない (UTC 比較で十分)。

### action_log の必須要件 (Phase 4 連続性の担保)

ADR 0033 で確定した triple `(source, external_calendar_id, external_id)` を、event 関連の全 action_log type の metadata に **必須** で含める。詳細 schema は Issue #154 で扱うが、対象 type は以下:

| action_type | 主体 | 主な metadata |
|---|---|---|
| `calendar_subscribed` | user | triple の calendar 部分 (source / external_account_id / external_calendar_id) + initial auto_promote |
| `calendar_unsubscribed` | user | triple の calendar 部分 + 削除された events の snapshot list |
| `calendar_auto_promote_changed` | user | triple の calendar 部分 + from / to |
| `event_promoted` | user | triple + from / to |
| `event_demoted` | user | triple + from / to |
| `event_visibility_frozen_by_subscription_toggle` | system | triple + frozen_to (`'shown'` / `'hidden'`) + triggered_by (auto_promote 切替操作の参照) |
| `event_deleted_by_source` | system | triple + 削除前 snapshot (title / start / end / visibility_override) |
| `task_event_dependency_lost` | system | task_id + triple + 削除理由 (`deleted_by_source` / `unsubscribed`) + 削除前 event snapshot |

削除系 (events 物理削除を伴うもの) では title / start / end の snapshot を必ず残す。kozutsumi 内 uuid は失われても、triple + snapshot で「あの時の予定」が後から再構成できる。

### tasks への伝播

`tasks.depends_on_event_id` は ON DELETE SET NULL で孤児化されるが、SET NULL される **前** に該当タスクの action_log に `task_event_dependency_lost` を記録する。これにより「あのタスクは元々この event に紐づいていた」が後から追える。

## Consequences

### 肯定的影響

- **過去 event の振り返り価値**: 初回 subscribe で過去 N 日分も取り込むため、Phase 4 行動分析の素材が即座に蓄積される。
- **subscription 切替の UX が自然**: 過去は固定、未来は追従、というシンメトリックな分割。「もう見たくない予定タイプを今日から非表示にしたい」要求に応えつつ、過去のタイムラインを書き換えない。
- **削除でも連続性が保たれる**: events を物理削除しても action_log に triple + snapshot が残るので、Phase 4 分析は時系列で同一 event を識別可能。
- **source-agnostic**: ADR 0033 の triple identifier に依存することで、Apple 等の新 source 追加時も本 ADR の方針 (取り込みライフサイクル) は流用できる。
- **役割分担の明確化**: 「一時的に非表示」は auto_promote=OFF、「完全に取り込みやめ」は unsubscribe、と操作の意味が分かれる。

### 否定的影響・トレードオフ

- **subscription 切替時の bulk update**: 過去 event 全件を旧 default の値で更新する SQL が走る。切替頻度は低い前提なので大きな負荷ではないが、event 数が万単位になると注意が要る。
- **action_log のエントリ増加**: event 削除時の snapshot や tasks 伝播で 1 操作あたりのログが多くなる。Phase 4 価値とのトレードオフで採用。
- **再 subscribe で過去の個別 override は復活しない**: kozutsumi 内 uuid は新規になり、`visibility_override` も `'none'` から始まる。Phase 4 分析は action_log で連続するが、events テーブルの現在状態としては「ユーザーが個別判断していた事実」は失われる。これは「unsubscribe = 不要」の意思を尊重する設計判断として受け入れる。
- **bulk update のタイミング解釈**: 「サーバー時刻で過去」と一律に決めることで、ユーザーのタイムゾーンや日付境界の議論を避ける。本人の感覚と数時間ずれる可能性はあるが、許容。

## Alternatives considered

- **L1 で未来のみ取り込み**: 過去取り込みなしだと Phase 4 振り返り価値を失う。subscribe 時の即時性も低い。不採用。
- **L2 で過去 event を一律非表示** (`override='hidden'` で seed): subscription default の意味が薄れ、後から個別 promote が大量に必要。不採用。
- **L5/L9 で論理削除 (deleted_at)**: テーブル肥大、表示クエリで `deleted_at IS NULL` フィルタが必須化。Phase 4 連続性は action_log で代替可能なので物理削除を採用。不採用。
- **L6 で全 event を新 default に追従**: 過去のタイムライン表示が一気に変わる UX ショック。「これからの予定」と「過去の記録」を分けたい意図と整合しない。不採用。
- **L6 で events に `visibility_override_origin` 列追加** (`'user'` / `'system_freeze'`): events 単独で origin が見える利点があるが、action_log と二重管理になる。ADR 0001 の「action_log で拡張コスト下げる」設計と整合させて action_log 駆動で識別する。不採用。
- **L8 で過去 override 不可**: 振り返り補正の価値を失う。Phase 4 シグナルも弱まる。不採用。
- **L9 で events を残す (subscription だけ削除)**: subscription join が解決できなくなり、auto_promote が引けない event が残る。表示クエリ複雑化。不採用。
- **L10 で再 subscribe 時に action_log から override 復元**: append-only log を reducer として使うコードが複雑、unsubscribe の意思に逆らう。Phase 4 連続性は triple identifier で十分担保されるので不採用。
- **N (過去取り込み期間) を ADR で固定**: パラメータは ADR にしない原則 (kozutsumi-adr skill)。code 定数で柔軟に調整する。

## Notes

- 本 ADR は ADR 0031 の Layer 1〜2 (subscription) を具体化し、ADR 0008 (primary 固定) の supersede を ADR 0031 と合わせて完了させる位置付け。
- N (過去取り込み期間) / sync 間隔 / bulk update のバッチサイズなどは code 定数 (パラメータ扱い)。
- subscription テーブルの具体的 column 構成は実装時 (Issue #144) で migration として確定する (ADR には書かない)。
- action_log type の完全 list / metadata schema / 主体 (`actor`) の表現方法は Issue #154 で確定する。本 ADR は「event 関連 type の metadata に triple を必須含める」「削除系は snapshot を含める」という制約のみ宣言。
- Apple 等の新 source 対応時は subscription テーブルの拡張可能性を考慮し、新 ADR を別途起票する (本 ADR の supersede ではなく、新 source 対応 ADR)。
- 将来見直す条件:
  - subscription 切替時の bulk update 性能が問題になったら、論理削除 + lazy resolution に切り替えて本 ADR を supersede。
  - 「再 subscribe で個別 override 復活させたい」という要望が dogfooding で強く出たら、本 ADR を supersede して L10 を変更。
  - action_log の triple metadata 要件が schema 変更で変わるなら、本 ADR の該当節と Issue #154 を同時更新。
