# ADR 0035: action_log payload schema の判断基準と `actor_type` 列の追加

- **Status**: Accepted
- **Date**: 2026-05-03
- **Related**: [ADR 0001](./0001-action-logs-from-phase1.md) / [ADR 0031](./0031-calendar-subscription-and-event-promotion.md) / [ADR 0032](./0032-events-visibility-override-physical-model.md) / [ADR 0033](./0033-events-cross-source-uniqueness.md) / [ADR 0034](./0034-calendar-subscription-lifecycle.md) / Issue #154 / Issue #159 / Issue #144 / Issue #145 / Issue #146

## Context

kozutsumi の差別化の核は「行動データの蓄積による行動ベーススケジューリング」(`docs/design/vision.md`)。
ADR 0001 で action_logs を Phase 1 から運用開始することは決めたが、その時点では payload (metadata) の中身は
type ごとに ad hoc に決まり、判断基準は明文化されていない。

ADR 0033 / 0034 で calendar / event 関連の action_log について以下を **部分的に宣言した**:

- triple `(source, external_calendar_id, external_id)` の metadata 必須化 (ADR 0033)
- 削除系 type の snapshot 必須化 (ADR 0034)
- system actor / user actor の区別 (ADR 0034 で `event_visibility_frozen_by_subscription_toggle` 等を宣言)

本 ADR ではこれらの宣言を **完成** させる:

- Phase 4 で必要な特徴量を vision.md から逆引きし、payload 必須項目の判断基準を明文化する
- ADR 0034 で宣言された type の payload schema を確定する
- Issue #145 / #146 で発火する type (設定画面の reset / 複数アカウント関連) の payload を確定する
- user / system actor の表現方法を確定する (schema 変更を伴うかどうかも含めて)
- 既存 type の payload を判断基準に照らして整理する

これは #159 (DB migration) の前提となる。schema 変更を伴う判断 (`actor_type` 列追加 / 既存 type の追加列) は
本 ADR で確定し、#159 の migration 範囲を確定させる。

## Decision

### 1. 判断基準: Phase 4 必要特徴量からの逆引き

vision.md の「行動データ」項目を逆引きして、payload 必須項目の判断軸を確定する:

| Phase 4 特徴量 | 何から取れるか |
|---|---|
| 着手パターン | type + `task_id` + `created_at`。`task_category` は tasks join、履歴は `task_category_changed` 時系列再構成 |
| 中断パターン | `task_paused.pause_reason` / `task_resumed` の対 + `task_time_entries` |
| 回避パターン | **削除系 type の snapshot 必須**。元 entity が物理削除された後でもパターン分析できる必要がある |
| エネルギー変動 | 全 type の `created_at` |
| 見積もり誤差 | `task_completed.estimated_minutes` / `actual_minutes` |
| 時間帯 × タスク種類クロス | `created_at` + `task_category` (join + `task_category_changed` 履歴) |
| カレンダー関連 (subscription 切替頻度 / 個別 override 方向性) | ADR 0034 で宣言した event 関連 type 群 |

### 2. 必須メタデータの 3 つの判断基準

新 type を起こすときも既存 type を見直すときも、以下 3 基準に照らして payload を決める。

#### (i) entity 参照の triple / id 必須化

- **event エンティティを参照する type** は metadata に triple `(source, external_calendar_id, external_id)` を必須含める (ADR 0033 で宣言、本 ADR で確定)
- **calendar 単位の type** は triple の calendar 部分 `(source, external_account_id, external_calendar_id)` を必須含める
- **task エンティティ参照** は `task_id` 必須 (既存)
- **external_account 単位の type** は `(source, external_account_id)` を必須含める

理由: kozutsumi 内 uuid は events / external_accounts / tasks の物理削除や再 subscribe で失われるが、
triple / external id は source 側で安定なので、Phase 4 が時系列を再構成できる。

#### (ii) 削除系 type の snapshot 必須化

- 元 entity が物理削除される type は、削除前の主要属性を `snapshot` として metadata に含める (ADR 0034 で宣言、本 ADR で確定)
- 対象属性は entity 種別ごとに異なる:
  - event: `title` / `start_time` / `end_time` / `visibility_override`
  - task: `title` / `estimated_minutes` / `task_category` / `status` / `parent_task_id`
  - external_account: `display_name`
- 連鎖削除 (例: `external_account_removed` から派生する unsubscribe → events 削除) は **入れ子 snapshot** で表現する

理由: ON DELETE で FK が NULL になっても、entity 行自体が消えると後追いで title 等を引けない。
Phase 4 の回避パターン分析 / 振り返りには「あの時のあれ」が必要。

#### (iii) Phase 4 シグナル必須化

- default に逆らった個別判断は学習素材として価値が高いので、判断時の文脈を metadata に含める:
  - `is_override_of_default: boolean` — default 表示状態と user 判断が逆向きか
  - `subscription_auto_promote: boolean` — 判断時点の subscription default
- 「ユーザーが個別判断した事実」と「default が何だったか」を 1 行から復元可能にする

### 3. `actor_type` を `action_logs` の列として追加する (schema 変更)

`action_logs` に **`actor_type text not null default 'user'`** 列を追加する。

- 値: 当面 `'user'` / `'system'` を運用。将来 `'ai'` 等を追加可能
- ADR 0001 の「action_log には CHECK / enum を貼らない」原則に従い CHECK 制約は貼らず、
  TypeScript リテラル union で値域を維持する

#### なぜ列追加 (metadata 拡張ではなく schema 拡張) なのか

kozutsumi のプロダクトコンセプトは「個人特化 AI 秘書 = AI が人間の操作を代替する」(vision.md)。
**「誰がアクションを起こしたか (人間 / システム / 将来は AI)」は product concept に直結する固定軸** であり、
ad hoc な metadata 拡張ではない。

具体的に:

- Phase 4 の中核分析は「人間がやっている操作のうち、AI で代替できるものはどれか」。
  これは `WHERE actor_type = 'user'` で母集団を切り出す分析パターンが頻出することを意味する
- 将来 AI による自動操作が増えると `actor_type = 'ai'` のログが増え、`'user'` との比率変化を時系列で見たくなる
- これらは「個別 type に固有の payload 揺らぎ」(ADR 0001 が想定するもの) ではなく、
  **type 横断の固定軸**

ADR 0001 との関係:

- ADR 0001 は「**個別 type ごとに発生する payload 変動を JSONB で吸収する**」設計判断。
  本 ADR の `actor_type` は type 横断の固定軸であり、ADR 0001 が想定する「拡張」とは性格が異なる
- 本 ADR は ADR 0001 を **supersede しない**。両者は独立に並立する

### 4. Calendar / Event 関連 type の payload schema (ADR 0034 で宣言した type の確定)

#### user actor

| type | metadata schema |
|---|---|
| `calendar_subscribed` | `source` / `external_account_id` / `external_calendar_id` / `auto_promote_to_timeline: boolean` |
| `calendar_unsubscribed` | `source` / `external_account_id` / `external_calendar_id` / `deleted_events: Array<{ external_id, title, start_time, end_time, visibility_override }>` |
| `calendar_auto_promote_changed` | `source` / `external_account_id` / `external_calendar_id` / `from: boolean` / `to: boolean` |
| `event_promoted` | triple + `from: 'none' \| 'shown' \| 'hidden'` / `to: 'shown'` / `subscription_auto_promote: boolean` / `is_override_of_default: boolean` |
| `event_demoted` | triple + `from: 'none' \| 'shown' \| 'hidden'` / `to: 'hidden'` / `subscription_auto_promote: boolean` / `is_override_of_default: boolean` |
| `event_override_cleared` | triple + `from: 'shown' \| 'hidden'` / `subscription_auto_promote: boolean` |
| `external_account_added` | `source` / `external_account_id` / `display_name` |
| `external_account_removed` | `source` / `external_account_id` / `display_name` / `cascaded_unsubscribes: Array<{ external_calendar_id, deleted_events: [...] }>` |

#### system actor

| type | metadata schema |
|---|---|
| `event_visibility_frozen_by_subscription_toggle` | triple + `frozen_to: 'shown' \| 'hidden'` / `triggered_by: action_log_id (uuid string)` |
| `event_deleted_by_source` | triple + `snapshot: { title, start_time, end_time, visibility_override }` |
| `task_event_dependency_lost` | `task_id` + triple + `deletion_reason: 'deleted_by_source' \| 'unsubscribed'` + `event_snapshot: { title, start_time, end_time }` |
| `external_account_reauth_required` | `source` / `external_account_id` / `error_kind: string` (`token_revoked` / `refresh_failed` 等は code 定数で運用、本 ADR では値固定しない) |

備考:

- `is_override_of_default` の判定: 操作後の表示状態 (`to`) が subscription default の表示状態と逆向きなら `true`。
  例: `auto_promote=ON` (default = shown) で `event_demoted` (to = hidden) → `is_override_of_default = true`
- `event_override_cleared` の `to` は `'none'` 固定なので metadata に含めない (action_type 自体が意味を担う)
- 設定画面の「override 一覧 / 一括リセット」操作 (ADR 0032 / Issue #145) は `event_override_cleared` で記録する
  (`event_promoted` / `event_demoted` の `to: 'none'` ではなく別 type 化する。理由は Alternatives 参照)

### 5. 既存 type の payload 整理

判断基準 (i) (ii) (iii) に照らして既存 type を見直し、**`task_deleted` のみ snapshot を追加** する。
他は現状で十分。

| type | 変更 | 理由 |
|---|---|---|
| `task_deleted` | snapshot 追加: `{ task_id, snapshot: { title, estimated_minutes, task_category, status, parent_task_id } }` | 削除系 snapshot 必須 (基準 ii)。回避パターン分析の中核。元 task が物理削除された後でも「どんなタスクが未着手のまま削除されたか」が再構成可能 |

変更しない既存 type:

- `task_started` / `task_paused` / `task_resumed` / `task_completed`: 必要属性は揃っている。
  `task_category` は tasks join + `task_category_changed` 履歴で時系列再構成可能
- `task_reordered`: from/to position が揃っている
- `task_title_changed` / `task_category_changed`: from/to が揃っている
- `task_dependency_set` / `task_dependency_cleared`: 必要十分
- `interruption_pushed` / `interruption_completed`: 中断割込みパターンには task_id + created_at で十分
- `stack_proposed` / `stack_proposal_accepted`: 現状 placeholder。Phase 4 / 機能実装時に payload を別 ADR で確定 (本 ADR では未確定で残す)
- `calendar_synced`: synced/deleted/trigger カウンタは Phase 4 の頻度分析に十分
- `task_decomposed` / `task_decompose_failed` / `task_decompose_skipped` / `task_child_resplit` / `decomposition_modified`: ADR 0017 / 0021 / 0030 で確定済

### 6. 後方互換: 新規ログから埋める (backfill しない)

新項目 (`actor_type` 列 / `task_deleted.snapshot` / 新 type 群) は **新規ログから埋める**。
既存ログは backfill しない。

理由:

- ADR 0001 の「JSONB で揺らぎ吸収」設計に沿う
- `task_deleted.snapshot` は元 task が物理削除済みのため backfill 不能なケースが大半
- `actor_type` は default `'user'` で既存ログも DDL レベルで埋まる (新規 INSERT も default で `'user'`)
- Phase 4 学習開始までに量的に十分な新規ログが蓄積される前提 (ADR 0001 と同じ前提)

Phase 4 分析ロジックは欠損項目を `null`-safe に扱う。

## #159 に流す migration の指示

本 ADR 確定の結果、#159 で実施すべき migration は以下:

### schema 変更 (DDL) — 実施する

```sql
alter table public.action_logs
  add column actor_type text not null default 'user';

create index action_logs_actor_user_created_idx
  on public.action_logs (user_id, actor_type, created_at desc);
```

- CHECK 制約は貼らない (ADR 0001 / 本 ADR §3)
- 既存行は default `'user'` で埋まる
- index は Phase 4 で `WHERE user_id = ? AND actor_type = ?` の絞り込みが頻発する想定で先回り (なくても動く、index 設計は #159 で最終判断)

### data migration — 実施しない

- 新規ログから埋める方針 (本 ADR §6) のため backfill は行わない
- 既存ログは `actor_type = 'user'` で実質的に正しい (system actor の type は本 ADR 確定後に新規発火するため)

### コード側の追従 (#159 の最小コード変更スコープ)

- `action_logs` への INSERT で `actor_type` を明示渡しに変更 (default 任せにしない)
- TypeScript で `ActionType` / `ActionMetadataMap` / `ActorType` を本 ADR の schema に合わせて拡張
- ただし新 type の発火実装は #144 / #145 / #146 のスコープ。#159 は「既存挙動を壊さず新 schema に乗せる」最小範囲のみ

## Consequences

### 肯定的影響

- payload 設計の判断基準が明文化され、新 type 追加時にチェックリストが回せる
  (triple 必須 / snapshot 必須 / Phase 4 シグナル)
- `actor_type` が first-class 軸として可視化され、Phase 4 で
  「人間の操作のうち AI で代替可能なものの分析」が効率的に行える (vision の差別化の核に直結)
- ADR 0034 で宣言した type の payload が正式に確定し、#144 / #145 / #146 が実装可能になる
- #159 の migration 範囲が確定し、後追い migration を避けられる
- 削除系 snapshot により Phase 4 の回避パターン分析が成立する

### 否定的影響・トレードオフ

- `actor_type` 列追加で migration 1 回が必要 (#159 で実施)
- ADR 0001 の「拡張は metadata」原則からは逸れる判断 (本 ADR §3 で個別正当化)
- 既存ログには新項目 (`task_deleted.snapshot` 等) が欠損する。Phase 4 分析は欠損許容ロジックを書く必要がある
- 削除系 snapshot で 1 操作あたりの metadata サイズが大きくなる
  (`calendar_unsubscribed` / `external_account_removed` の `cascaded_unsubscribes` は events 数に比例)
- `is_override_of_default` の計算ロジックが「判断時点の subscription default」依存。
  発火側で正しく算出する責務が増える

## Alternatives considered

### actor 表現方法

- **metadata に `actor` キーを持つ (案 b)**: ADR 0001 の「拡張は metadata」原則に最も忠実。schema 変更不要。
  不採用: actor は product concept (AI 秘書) に直結する固定軸であり、ad hoc 拡張ではない。
  Phase 4 で WHERE 句に頻出する想定なので column のほうが効率的。schema レベルで「AI 代替分析が core である」ことを宣言する意味もある
- **action_type prefix で actor 区別 (`system.event_visibility_frozen_*`) (案 c)**:
  schema 変更不要だが、enum-like な action_type の語彙が爆発し、既存命名規則 (`task_<verb>` / `event_<verb>`) と矛盾。
  prefix が「actor 軸」と「ドメイン軸」のどちらか曖昧。不採用

### reset 操作の type

- **`event_promoted` / `event_demoted` の `to: 'none'` で記録 (案 a)**:
  type 数が増えない。不採用: 「方向 override」(shown / hidden) と「reset (個別判断撤回)」は
  Phase 4 で別シグナル。「promoted to none」は意味論的に矛盾する。
  type 自体で意味を担うほうが分析が単純で、metadata から判別する複雑性が要らない

### 後方互換

- **既存ログを backfill する (案 b)**: `task_deleted.snapshot` を data migration で埋める等。
  不採用: 削除済 entity からは復元不能なケースが大半。実施しても Phase 4 の素材としての完全性は保証できず、コストに見合わない。
  ADR 0001 の「JSONB で揺らぎを吸収する」設計と整合しない

### その他

- **CHECK 制約で `actor_type` の値域を強制**: ADR 0001 の方針 (action_log には CHECK / enum を貼らない) と矛盾。
  TypeScript 側のリテラル union で値域を担保する。不採用
- **既存 type すべてに大幅な metadata 追加 (例: `task_started` に `task_category` snapshot)**:
  時刻時点の値は join + `task_category_changed` 履歴で再構成可能。冗長。
  不採用: 削除系のみ snapshot を必須化する判断基準 (基準 ii) で十分

## Notes

- 本 ADR は **ADR 0001 を supersede しない**。
  ADR 0001 は「action_logs を text 列 + JSONB metadata で持ち、SQL CHECK / enum を貼らない」基盤方針。
  本 ADR は「payload 内容の判断基準」と「actor_type という固定軸の追加」を扱う独立判断
- ADR 0033 (triple 必須化) / ADR 0034 (削除系 snapshot 必須化 / 対象 type 列挙) は本 ADR §2 で判断基準として確定
- `actor_type` の値追加 (将来 `'ai'` 等) は本 ADR の supersede ではなく、追加判断として扱える
  (CHECK 制約を貼らないため値追加は migration 不要)
- `stack_proposed` / `stack_proposal_accepted` の payload は機能実装時に別途確定する (本 ADR では現状の placeholder を維持)
- 将来見直す条件:
  - actor_type の値域が `'user'` / `'system'` を超えて多様化し、enum 的固定が必要になったら本 ADR を supersede
  - Phase 4 分析で「`task_deleted.snapshot` に欲しい属性が不足」と判明したら追加判断 (拡張として扱える)
  - metadata size がインフラ的に問題化したら、削除系 snapshot 戦略を見直す
  - `is_override_of_default` の発火側計算ロジックが複雑化したら、DB 側の view 化等を検討
