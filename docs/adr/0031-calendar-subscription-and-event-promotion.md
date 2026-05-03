# ADR 0031: カレンダー購読 と event の timeline 予定化を分離した 3 層モデル

- **Status**: Accepted
- **Date**: 2026-05-03
- **Related**: Supersedes [ADR 0008](./0008-google-calendar-sync-target-primary-only.md) / [ADR 0005](./0005-google-calendar-sync-via-route-handler.md) / [ADR 0006](./0006-google-calendar-sync-full-then-synctoken.md) / [ADR 0010](./0010-google-calendar-events-read-only.md) / `docs/design/vision.md` / Issue #144 / Issue #145 / Issue #146

## Context

ADR 0008 で「同期対象は primary カレンダーのみ」を仮置きした。Phase 2 の使用を通じて以下の摩擦が判明した:

- 仕事 (Workspace) と家族 / 趣味の calendar が落ちて、日常利用が成立しない
- 逆に全 calendar を一律取り込むと、祝日 / 他人の勤怠 / 子供の帰宅時間 等のノイズで「自分の時間拘束」が見えなくなる
- 「見えてはいたいが時間拘束ではない」予定が現実に存在する (子供の帰宅時間 typical)

vision の差別化は「行動データの蓄積による行動ベーススケジューリング」にある。
そのためには「自分の時間拘束がこのツールに集約されている」状態が前提条件。
primary 固定では集約が成立せず、一律取り込みでは「時間拘束」が判別できない。

「取り込み (events テーブルに行を入れる)」と「予定化 (DayTimeline / TimelineBar 等の時間拘束 UI に乗せる)」が
これまで未分離だったことが、この 2 つの摩擦の根本原因。両者を分離した上で、calendar の性質ごとに
default の予定化方針が違うこと、個別 event ではそれを上書きしたいこと、を素直に表現するモデルが要る。

## Decision

events の visibility を **3 層** で管理する:

| 層 | 概念 | 単位 | 操作 | 影響範囲 |
|---|---|---|---|---|
| 1. Subscription | calendar を取り込み対象にする | calendar | 取り込む / 取り込まない | events テーブルに行が入るかどうか |
| 2. Auto-promote | calendar ごとの「自動予定化」トグル | calendar | ON / OFF | その calendar の event の **default** が timeline に乗るか |
| 3. Event override | 個別 event の予定化 | event | 予定化する / 予定化解除 | 個別 event を timeline に出すかの最終決定 |

用語:
- **取り込み (subscription / sync)**: events テーブルへの行追加。layer 1。
- **予定化 (promote to timeline)**: 取り込んだ event を「自分の時間拘束」UI に乗せること。layer 2 / 3。
- 「自動取り込み」のような取り込みと予定化を混ぜた呼称は使わない (ミスリードのため)。

行動データ (vision の差別化の核) としては、layer 2 の default に対する layer 3 の **override シグナル**
(「default では合っていなかった」というユーザーの個別判断) が最も情報濃度が高く、Phase 4 の学習素材として中心になる。

将来の三値モデル (`shown` / `info_only` / `hidden`) への拡張余地を schema レベルで残す
(layer 3 の visibility を boolean ではなく enum 相当で持つ)。
ただし三値の即時導入はしない (本 ADR の決定範囲外)。

## Consequences

### 肯定的影響

- **calendar の性質ごとに自然な操作量**:
  仕事 calendar は auto-promote ON で大半の event が自動で timeline に乗り、家族 calendar は
  auto-promote OFF で必要な event だけ手動で予定化できる。どちらに振っても操作回数が爆発しない。
- **「集約」と「ノイズ排除」が両立**: 全予定を取り込みつつ、timeline には時間拘束だけ乗せられる。
  vision の「全時間拘束がツールに集約されている」前提が成立する。
- **行動データの濃度が上がる**: layer 2 の default に対する layer 3 の override が
  「ユーザーの個別判断」として強いシグナルになる (Phase 4 の暗黙フィードバック)。
- **将来拡張余地**: 「見えるが時間拘束ではない (info_only)」モードが必要になっても、
  schema レベルで取り込める。
- **複数アカウント (#146) への素直な拡張**: subscription の単位を `(account, calendar)` 複合キーで
  持てば、複数 Google アカウント対応の土台になる。

### 否定的影響・トレードオフ

- **DB schema 変更が大きい**: 購読を表す新テーブルと、event 単位 override 列の追加が必要。migration を伴う。
- **UI の操作軸が増える**:
  「取り込み (subscription)」「自動予定化トグル (auto-promote)」「個別予定化 (event override)」の 3 軸が
  ユーザーに露出する。学習コストが上がる。命名 / IA で「取り込み ≠ 予定化」を明示しないと混乱する。
- **既存ユーザーの移行が必要**: primary のみ取り込み済の既存ユーザーを、auto-promote ON で自動購読した
  ものとみなして壊さない移行が要る。
- **subscription default の事後変更時の挙動を決める必要**:
  auto-promote トグルを後から切り替えた時、既存の event override (layer 3) を保持するのか、
  リセットするのかをコード側で明確にする必要がある。
- **取り込み済だが timeline に乗らない event のための表示 / 操作面が要る**:
  layer 2 OFF の calendar の event を後から手動で予定化するための UI (event 一覧 / 検索 / 当日候補など) が
  別途必要になる。

## Alternatives considered

- **二値: default include + event 単位 hide のみ (元の #145 案)**:
  家族 / 趣味 calendar で大量の hide 操作が必要になる。
  複数 calendar 取り込み時に「ノイズ排除」のコストが爆発する。不採用。
- **二値: default exclude + event 単位 include のみ (純 whitelist)**:
  仕事 calendar で取り込みのたびに大量の include 操作が必要になり、「取り込んだ意味」が薄れる。不採用。
- **calendar 単位制御のみ (event 単位 override なし)**:
  「家族 calendar の中の自分の用事だけ timeline に乗せたい」「仕事 calendar の中の社内全員定例だけ外したい」
  というニーズに対応できない。不採用。
- **event 単位制御のみ (subscription / auto-promote なし)**:
  calendar の性質に関わらず一律ポラリティになり、上記二値案と同じ問題が出る。不採用。
- **三値モデル (`shown` / `info_only` / `hidden`) を即時導入**:
  Phase 1 / 2 のスコープを大きく広げる。timeline への載せ方 / カウントへの寄与 / タスク選択時の扱い等、
  決めるべき意味論が増える。schema レベルで余地は残すが、運用ロジックの導入は本 ADR では見送る。
- **subscription を持たず取り込みは Google API の `calendarList` で動的に判定**:
  sync token / lastSyncedAt を calendar 単位で永続化したいので、subscription は明示的に持つほうが素直。不採用。
- **#144 と #145 を別 ADR に分割**:
  layer 1 / 2 / 3 が密結合 (layer 2 を廃止すると layer 3 の override 対象が消える等) しており、
  3 層を 1 つの概念フレームとして提示するほうが将来の supersede 単位として自然。本 ADR では 1 本にまとめた。

## Notes

- 本 ADR は **概念モデルと層の境界** を確定するもの。テーブル名 / column 名 / enum 値 / migration の具体は
  実装段階で決める (パラメータ / 実装詳細は ADR に含めない原則)。
- ADR 0009 (Google provider token self-managed refresh) は本 ADR では触らない。
  複数アカウント対応 (Issue #146) で別途 supersede する。
- ADR 0006 (full sync → syncToken) と ADR 0010 (Google 由来 events は read-only) は本 ADR で前提が
  変わらない。subscription 単位で sync_token を独立に持つ拡張は本 ADR の含意の範囲。
- 行動データの観点で、Phase 4 までに `is_override_of_default` 相当のシグナルが action_log に
  載っていることを確認する (action_log schema 設計は別 issue / ADR で扱う、Issue #154 と整合)。
- 将来見直す条件:
  - 三値モデル (info_only) のニーズが dogfooding で明確になったら、schema 拡張 + 運用ロジック追加の ADR を起票する
  - layer 2 と 3 の併存が UX 的に冗長と判明したら、layer 統合の supersede を検討する
  - 自動フィルタルール (title pattern / participants 数 / RSVP) を導入する場合は別 ADR
