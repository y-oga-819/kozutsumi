# ADR 0032: events.visibility_override の物理化

- **Status**: Accepted
- **Date**: 2026-05-03
- **Related**: [ADR 0031](./0031-calendar-subscription-and-event-promotion.md) / [ADR 0001](./0001-action-logs-from-phase1.md) / Issue #145 / Issue #154

## Context

ADR 0031 で events visibility の 3 層モデル (subscription / auto-promote toggle / event override) を確定した。
本 ADR は **Layer 3 (event 単位 override) の物理化方法** を決める。

物理化の選択は以下に影響する:

- 「ユーザーが個別に触ったか」の判別容易性 (Phase 4 の `is_override_of_default` シグナル抽出)
- subscription auto_promote 切替時の挙動 (override は保持しつつ default 追従の event は新 default へ)
- 将来の三値モデル (`info_only` 等) への拡張余地

## Decision

`events.visibility_override` を **enum 列 (`'none'` / `'shown'` / `'hidden'`)** で持つ。`NOT NULL DEFAULT 'none'`。

| 値 | 意味 |
|---|---|
| `none` | 個別 override なし。subscription default に従う。sync 新規取り込みもこの値で insert |
| `shown` | ユーザーが「予定化する」と override |
| `hidden` | ユーザーが「予定化解除」と override |

採用ルール:

- **enum 採用** (kozutsumi 慣習: 構造的ステータスは enum、`task_status` / `decompose_status` 等と揃える)。
  TypeScript literal union と 1:1 対応する。
- **日常 UI では `none` への reset 不可**。取り消したい時は反対方向の再 override (`shown` ↔ `hidden`) で行う。
  完全に default 挙動へ戻したいレアケースは設定画面の「override 一覧 / 一括リセット」専用導線でのみ提供する。
- **sync の挙動**:
  - 新規取り込みは `'none'` で insert (subscription default に従う状態)
  - 既存 event の override は sync で **保持** (Google 由来フィールドだけ upsert)
- **過去 event の個別 override は制限なし**。いつでも `none → shown` / `none → hidden` / `shown ↔ hidden` 可。
- **三値モデル (`info_only` 等) の追加** は本 ADR を supersede する別 ADR で扱う (アーキ判断レベル)。

## Consequences

### 肯定的影響

- **column 1 個で全状態を表現できる** (NULL センチネル不要)。意味の曖昧さがない。
- **override 有無の判定が単純**: `WHERE visibility_override = 'none'` / `!= 'none'`。
  Phase 4 の `is_override_of_default` シグナル抽出も `(visibility_override != 'none')` で取れる。
- **kozutsumi 慣習に準拠**。`gen types typescript` の出力も既存 enum と揃う。
- **subscription auto_promote 切替時の挙動が自然**: `'none'` の event だけが新 default に追従し、
  ユーザーが個別判断した event (`'shown'` / `'hidden'`) は影響を受けない (詳細は ADR 0034)。

### 否定的影響・トレードオフ

- **enum 値追加は migration が重い** (PostgreSQL の `ALTER TYPE ADD VALUE` はトランザクション内制約あり)。
  ただし値追加 = 三値モデル導入は重い設計判断なので、軽い追加にはならず筋は通る。
- **日常 UI で reset 不可** という制約により、「default 挙動に戻したい」レアニーズは
  設定画面経由でしか満たせない。誤操作はほぼ反対方向 override で復旧できる前提。
- **過去 event の override を制限しない** ため、過去の timeline 表示が後から変わりうる。
  履歴改変リスクは action_log で `is_override_of_default` 含めて記録することで追跡可能にする。

## Alternatives considered

- **text + CHECK 制約**: 値追加は軽いが、kozutsumi 慣習 (構造的なものは enum) に反する。
  `task_category` (text + CHECK) はラベル拡張が頻繁な用途で、`visibility_override` の用途とは性格が違う。不採用。
- **NULL センチネル方式 (`shown` / `hidden` / NULL)**: 値だけ見たとき NULL の意味が曖昧。
  `WHERE visibility IS NULL` の SQL も意図を読み取りにくい。column 名 `visibility_override` で意図を担う今案のほうが明示的。不採用。
- **boolean 2 列分離 (`visibility` boolean + `visibility_user_set` boolean)**:
  正規化されておらず (`visibility_set=false かつ visibility=true` は意味不明)、複合制約が必要。不採用。
- **`default` / `user_shown` / `user_hidden` 命名**: prefix で「ユーザーアクション」を示せるが、
  column 名 `visibility_override` 自体が意図を担うので値側 prefix は冗長。不採用 (好みレベル)。
- **日常 UI で reset 許容**: 「予定化解除」を取り消すボタンが操作ミスで押されると個別判断が消える。
  反対方向 override で十分代替できるので不採用。
- **過去 event の override 不可**: 振り返り補正 (「あの会議は時間拘束じゃなかった」「やっぱり予定化しておこう」) の
  価値を失う。Phase 4 行動データの濃度も下がる。不採用。

## Notes

- L3 (新規取り込みの初期 override) / L4 (sync は override 保持) / L8 (過去 override 可) の決定を本 ADR に取り込んでいる。
- subscription auto_promote 切替時の `'none'` の扱い (旧 default で固定する bulk update) は ADR 0034 で扱う。
- action_log の `event_promoted` / `event_demoted` / `event_visibility_frozen_by_subscription_toggle` の
  schema は Issue #154 で決める (本 ADR は visibility_override の物理化のみ)。
- `info_only` 等の三値拡張が必要になったら本 ADR を supersede する別 ADR を起票する。
