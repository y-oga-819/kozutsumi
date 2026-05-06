# ADR 0054: recurring event の系列 override は「rule + bulk apply」併用で表現する

- **Status**: Accepted
- **Date**: 2026-05-06
- **Related**: [ADR 0031](./0031-calendar-subscription-and-event-promotion.md) / [ADR 0032](./0032-events-visibility-override-physical-model.md) / [ADR 0033](./0033-events-cross-source-uniqueness.md) / [ADR 0034](./0034-calendar-subscription-lifecycle.md) / Issue #145 / Issue #154 / Issue #229

## Context

ADR 0032 で event 単位の `visibility_override` を物理化したが、kozutsumi の sync は Google Calendar API を `singleEvents=true` で叩いて recurring event を instance 展開して取得しており、`recurringEventId` / `recurrence` / `iCalUID` を保持していない。そのため「この event が繰り返しの一部か / 他の instance はどれか」を判別できない。

結果、毎週の 1on1 / 定例のような繰り返し予定を予定化解除したい時に 1 件ずつ操作する必要があり、日常利用の摩擦になる。一方で「今週だけ別件で休み」のような単発 override も残したい。Google Calendar / Outlook 流の **3 択（この予定だけ / これ以降の予定もまとめて / すべての繰り返し）** が必要。

行動データ観点でも「単発 override」と「系列 override」は別シグナル（前者＝突発対応、後者＝固定的習慣からの方針転換）なので、scope を区別して action_log に残せると Phase 4 の解像度が上がる。`is_override_of_default = true` の系列 override は特に情報濃度が高い。

本 ADR は **系列 override の永続化方式と適用範囲** を決める。schema 追加・「これ以降」の境界・単発 override 保護・action_log の粒度はすべて永続化方式に従属するので、本 ADR の Decision に内包する。

## Decision

系列 override は **「事実への bulk apply」と「方針の rule 永続化」を併用** する。事実（既存 instance の `visibility_override`）と方針（未取り込み instance への適用ルール）を別レイヤで持つことで、events テーブルの状態は常に「現時点の事実」として綺麗に保つ。

### 1. schema

- `events.recurring_event_id` (text nullable) を追加。`source` / `external_calendar_id` と組み合わせて recurring グループを識別する
- `event_visibility_override_rules` テーブルを新設:
  - `id` (uuid)
  - `user_id` / `source` / `external_calendar_id` / `recurring_event_id`
  - `scope` enum (`'this_and_following'` / `'all'`)
  - `override_value` enum (`'shown'` / `'hidden'`)
  - `from_start_time` (timestamptz nullable, `scope='this_and_following'` のみ NOT NULL)
  - `created_at`
- 既存 events の `recurring_event_id` への backfill は行わず、次回 sync で埋まる挙動を許容

### 2. sync 拡張

- `singleEvents=true` のまま、各 instance の `recurringEventId` を取得して `events.recurring_event_id` に保持（API 仕様で `singleEvents=true` でもこのフィールドは返る）
- 新規 instance 取り込み時、該当する rule があれば `visibility_override` を rule の `override_value` で insert する。該当なしは ADR 0032 通り `'none'` で insert

### 3. 系列 override 操作の挙動

`scope = 'this_and_following' | 'all'` の操作時:

1. **bulk apply**: 該当 instance の `visibility_override` を `'shown'` / `'hidden'` に更新（**単発 override 済の instance は保護＝上書きしない**、後述 5）
2. **rule 永続化**: `event_visibility_override_rules` に 1 行 insert
3. 以降の sync で取り込まれる新規 instance に rule が適用される

### 4. 「これ以降」の境界

`scope = 'this_and_following'` の `from_start_time` 起点は **操作対象 instance の `start_time`**（操作時刻ではない）。理由は Alternatives 参照。

### 5. 単発 override の保護

bulk apply / rule 適用のどちらでも、既に `visibility_override != 'none'` の instance は **上書きしない**。明示的にユーザーが個別判断したものを尊重する（行動データ的に最も濃いシグナルを消さない）。

### 6. default scope

UI の 3 択 modal の default 選択は **`single`** に固定する。系列影響は明示選択でしか発生させない。

### 7. rule の lifecycle

kozutsumi 側で **rule の能動的な lifecycle 管理は行わない**。Google 側で master の recurrence が削除された場合、`singleEvents=true` 取得では各 instance に `cancelled` が飛ぶだけで master 削除そのものは API から検知できないため、孤立 rule の検知は信号がなく実装不能。孤立 rule は副作用がない（適用される instance が来ない）ので放置で許容する。

ユーザーが手動で rule を削除する導線は #145 設定画面「override 一覧 / 一括リセット」に **rules セクション**を追加して提供する。「instance reset（事実）」と「rule reset（方針）」は別操作として並べる。

### 8. action_log

「事実への適用」と「方針の登録」を log でも分け、**1 instance 1 log + `bulk_operation_id` でグルーピング** する：

- `event_promoted` / `event_demoted` (user actor): 1 instance につき 1 件（既存 #145 の semantics と整合）
  - metadata: `scope` (`'single'` / `'this_and_following'` / `'all'`), `recurring_event_id` (recurring 由来なら `single` でも入れる), `bulk_operation_id` (uuid, scope != `'single'` で必須), `is_override_of_default`, triple
- `event_visibility_rule_added` (user actor): 1 件
  - metadata: `rule_id`, `recurring_event_id`, `scope`, `override_value`, `from_start_time`, `bulk_operation_id` (高位 log と紐付け), triple(calendar 部分)
- `event_visibility_rule_removed` (user actor): 1 件 — rule 単独削除

`bulk_operation_id` により「scope=this_and_following を選んだ user 操作」を 1 単位として集計可能（uniq で取れる）。同時に instance 単位の log があるので「ある instance がいつ何起点で操作されたか」は instance.id だけの 1 lookup で復元できる。

詳細 schema は #154 で確定、本 ADR では type 一覧と metadata 必須項目のみ宣言。

## Consequences

### 肯定的影響

- **事実と方針の責務分離**: events テーブルは「現時点の事実」として常に綺麗、rule は「未来への方針」として独立に管理。状態の意味曖昧さがない
- **未取り込み未来 instance への自然な適用**: rule があるので新規取り込み時に default が適用される。「次に取り込まれる instance も override 状態であってほしい」というユーザーの直感と一致
- **行動シグナルの濃度向上**: 系列 override が rule として永続化される＝「習慣からの方針転換」が DB の一級市民データになる。Phase 4 prompt 注入時に「過去の override 系列ルール」を直接参照できる
- **bulk_operation_id による両立**: 集計（1 操作 1 単位）と復元（1 instance 1 log）が同じ schema で両立
- **「これ以降」境界が直感的**: 操作対象 instance の `start_time` 起点なので、UI 上見えていた回が境界の外に落ちない
- **単発 override 保護**: 明示操作の情報濃度を消さず、Phase 4 シグナルとして最も濃いものを守る

### 否定的影響・トレードオフ

- **schema が 1 列 + 1 テーブル増える**: 「parity feature だから最小で」という milestone description の方針からは少し膨らむ。ただし rule を持たないと未来 instance 適用ロジックが再構築不能になるので、ここは妥協できない
- **孤立 rule を許容する**: 全系列削除・master 分裂で rule が実質無効化されても DB に残る。手動 reset でしか掃除できない。副作用がないので実害はないが、運用上「rules テーブルが純粋な現状方針表」ではなくなる
- **bulk update の対象数が大きい時の処理コスト**: scope='all' で過去含め数百 instance を更新する操作が発生しうる。トランザクション境界・action_log 量を考慮した実装が必要（数値閾値はパラメータなので code constant に置き、本 ADR では決めない）
- **「これ以降」境界を timezone 跨ぎで厳密化していない**: JST 固定運用前提。将来 multi-tz 対応時に改めて議論
- **1 操作で N+1 件の action_log が発生**: bulk_operation_id で集計はできるが、`event_promoted` 行数自体は instance 数に比例する。年間規模では許容範囲だが、Phase 4 prompt 注入時にノイズにならないよう抽象化レイヤで集約する想定

## Alternatives considered

- **案 A: bulk apply のみ（rule 永続化なし）**: 既存 instance だけ bulk update し、未来取り込み instance は default に戻る。schema は `events.recurring_event_id` 1 列追加で済むが、新規取り込みのたびに「override されていた事実」が消え、Phase 4 シグナルの時間的継続性が action_log にしか残らない。「次に取り込まれる instance も override 状態でいてほしい」という直感とも一致しない。不採用。
- **案 B: rule 永続化のみ（bulk apply なし）**: 既存 instance を更新せず rule だけ作り、表示時に rule とのマージで visibility を計算する。events テーブルの `visibility_override` が「現時点の事実」を表さなくなり、表示クエリの度に rule join が必要。事実と方針の境界が曖昧になりデータが綺麗に保てない。不採用。
- **「これ以降」を操作時刻起点にする**: 「操作した瞬間以降」の方が直感的に思えるが、UI 上同じ画面で見えていた今週分の回が境界の外側に落ちて違和感が出る（特に金曜に来週月曜の予定を「これ以降」にした時、今週は何の override も発生しないのに「これ以降」と言われている）。操作対象 instance の `start_time` 起点の方が「この回も含めて以降」と読めて自然。不採用。
- **単発 override を直近上書きで処理**: scope='all' の意思を最後の操作として尊重する案。実装は単純（bulk update を素で当てるだけ）だが、ユーザーが「これだけ違う」と意図的に逆らった結果が消える。Phase 4 シグナルとして最も濃いものを破壊するのは惜しい。不採用。
- **action_log を高位 1 件 + target_instance_count 集約**: 量が少なく集計しやすいが、bulk update された 2 番目以降の instance について「いつ何起点で hidden になったか」を instance.id だけから復元できず、`recurring_event_id` で join + scope/from_start_time から該当判定が必要になる。`event_promoted = 1 instance を表す` という既存 schema invariant も崩れる。不採用。
- **孤立 rule の検知**: master 削除を能動検知する API 信号が無い（`singleEvents=true` では instance ごとの cancelled しか飛ばない）。「N 日新規 instance を観測しなかったら孤立扱い」のような heuristic は誤検知リスク（単に未来分が未取り込みなだけのケースを孤立と誤判定）。検知できない＋実害がない＋手動削除導線で十分なので、能動検知はしない。不採用。

## Notes

- 本 ADR は #229 のスコープ全体（schema + sync + UI + 系列 override 挙動 + action_log 設計）を 1 判断として扱う。supersede trigger は「rule-based を捨てて bulk-only に切替」「Google 側 recurrence webhook 導入」「rule に rrule そのものを持たせる」など。これらが起きたら本 ADR を supersede する別 ADR を起票する
- 数値パラメータ（bulk update のトランザクション境界、scope='all' 時の最大対象数など）は code constant に置く。本 ADR では決めない
- 詳細 action_log payload schema は #154 で確定（bulk_operation_id を共通 metadata 規約に取り込むかは #154 側の判断）
- timezone 跨ぎの「これ以降」厳密化は JST 固定運用解除時に再議論
- master 分裂（Google 側で「this and following」を別 master に切り出した）後の旧 / 新系列の関連付けは行わない。Google 側のユーザー意思（系列を分けた）を尊重する設計
