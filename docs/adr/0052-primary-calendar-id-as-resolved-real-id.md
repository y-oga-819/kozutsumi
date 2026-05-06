# ADR 0052: primary calendar の external_calendar_id は Google API で resolve した実 id を使う

- **Status**: Accepted
- **Date**: 2026-05-06
- **Related**: [ADR 0033](./0033-events-cross-source-uniqueness.md) / [ADR 0034](./0034-calendar-subscription-lifecycle.md) / Issue #144 / Issue #159

## Context

ADR 0033 で `external_calendar_id` を「source 内での calendar 識別子 (Google の calendarId、Apple の CalDAV calendar URL 等)」と定義した。Google Calendar の primary calendar は API 上 `id = ユーザーのメールアドレス` (例: `user@gmail.com`) として返却される。

しかし Phase 2 互換のため、migration `20260503100000_p3_159_calendar_ext_schema.sql` の seed と `src/entities/event/sync.ts` の lazy seed は **リテラル文字列 `'primary'`** を `external_calendar_id` に書き込んでいた (Google Calendar API が `'primary'` を primary alias として受け付けるため、API call はこの値で動く)。

この副作用として、設定パネル (`SettingsPanel.tsx`) の「取り込み中」と「追加できるカレンダー」で primary calendar が**重複表示** される: 取り込み中側は `external_calendar_id = 'primary'`、Google API 側は `id = メールアドレス` を返すので Set 比較が一致しない。さらに将来複数アカウント連携をする際、`'primary'` リテラルは複数 Google アカウント間で衝突する (アカウント A の primary もアカウント B の primary も同じ `'primary'` 文字列になる)。

ADR 0033 の趣旨 (`external_calendar_id` = source の実 id) と矛盾する実装ショートカットを残しているのが原因。

## Decision

`external_calendar_id` には常に **Google Calendar API が返す calendar の実 `id`** (primary calendar の場合はメールアドレス) を格納する。リテラル `'primary'` をデータベース行に書き込まない。

具体:

- 新規 OAuth ユーザー / subscription 未保有ユーザーへの primary subscription 自動 seed (`defaultResolveSubscriptionTargets`) は、Google Calendar API の `calendarList.list` を叩いて `primary: true` な entry の `id` を `external_calendar_id` に格納する。
- migration の seed (`user_calendar_subscriptions` への primary seed と `events.external_calendar_id = 'primary'` backfill) は廃止する。既存ユーザーには次回 sync 時に lazy seed が走り、実 id で subscription を作る。
- Google Calendar API への request 時 (`listEvents` の `calendarId` パラメータ等) は、保存している実 id をそのまま渡す。Google 側は実 id でも `'primary'` alias でも受け付けるが、kozutsumi 内では実 id 一本に統一する。

`'primary'` というアプリ側マジック文字列は、**API alias を内部識別子に流用しない**という方針として、コードベース全体で禁止する。

## Consequences

### 肯定的影響

- **設定 UI の duplicate 表示が解消する**: 取り込み中側と Google API 側で同じ `id` (= メールアドレス) になり、`SettingsPanel` の Set 比較が自然に一致する。
- **複数アカウント連携の衝突を回避できる**: アカウント A / B がそれぞれ別のメールアドレスを `external_calendar_id` に持つので、`(user_id, external_account_id, external_calendar_id)` UNIQUE 制約で素直に分離される。
- **ADR 0033 の意図と整合**: `external_calendar_id` が「source 内の実 id」になり、source-agnostic な triple 識別子 (`(source, external_calendar_id, external_id)`) の意味が崩れない。
- **event の triple がアカウント識別を含意する**: primary calendar の triple は `(google_calendar, user@gmail.com, EVENT_ID)` になり、どのアカウント由来かが triple だけで判別できる (Phase 4 行動分析の素材としての価値が上がる)。

### 否定的影響・トレードオフ

- **lazy seed が Google API call を 1 回伴う**: 新規 OAuth ユーザーの初回 sync で `calendarList.list` を 1 回呼ぶ必要がある (primary calendar の実 id 解決のため)。SQL だけでは完結しない。token expiration / 401 retry の対象が増えるが、既存の sync 経路の retry 機構を流用できるので追加コードは限定的。
- **既存の `'primary'` リテラルデータは削除する**: 旧 migration 20260503100000 が seed したリテラル `'primary'` 行 (`user_calendar_subscriptions` / `events` / `user_calendar_sync_state`) を新 migration で物理削除する。dogfood 単独運用 + 適用から数日 + 失われる Phase 4 データが極小という前提で受容。削除対象 events は次回 sync で実 id (email) で再取得される。
- **`'primary'` API alias を使った実装を意識的に拒否する**: Google API call の `calendarId` パラメータには `'primary'` alias を渡せば API call 自体は成立するが、その値を kozutsumi 内に保存することを禁止する。コード上この区別を読み手に意識させる必要がある。

## Alternatives considered

- **UI 側で表示 dedup する (DB は `'primary'` リテラルのまま)**: `SettingsPanel` のフィルタで `subscription.external_calendar_id === 'primary'` と `calendarList item.primary === true` を equivalent と扱う。表面的な duplicate 表示は消えるが、ADR 0033 違反は残り、複数アカウント連携で衝突する。バグの根を残すので不採用。
- **`'primary'` リテラルのまま、複数アカウント時にだけ実 id に切替**: 切替条件のロジックが複雑化し、移行 timing でデータ不整合が発生する余地がある。最初から実 id に統一する方が単純。不採用。
- **migration を 1 本追加して `'primary'` 行を実 id に backfill する**: backfill には Google API call が必要 (各 user の primary calendar 実 id を取りに行く)。SQL migration の中で API call はできず、code-as-migration スクリプトを作るとコストが大きい。代わりに本 ADR は「`'primary'` 行を削除し、次回 sync で code 経路の lazy seed (Google API resolve 内蔵) に任せる」アプローチを採る。失われる Phase 4 データは 'primary' 行が存在した期間 (dogfood で数日) 分のみ。
- **既存 migration 20260503100000 を編集して `'primary'` seed を撤去する**: migration framework は適用済み version を再実行しないため、既に migration 適用済みの環境 (preview / 個人運用) には変更が伝播しない。DB リセット運用を伴う前提だと preview env / 個人 Supabase project の手動リセット手順が必要になり、事故率が上がる。append-only な新 migration の方が安全。不採用。
- **新 OAuth ユーザーの primary を seed しない (subscription 0 件で開始)**: ユーザーが設定パネルを開いて明示的に「取り込む」を押すまで何も同期されない。vision の「使い続けるほど学習する」(蓄積価値) と整合せず、初回体験で「何も表示されない」状態を作る。不採用。

## Notes

- 本 ADR は ADR 0034 を supersede しない。ADR 0034 の subscription lifecycle (subscribe / sync / unsubscribe / 再 subscribe) はそのまま有効。本 ADR は「`external_calendar_id` の値域は実 id に限る」という分離可能な方針の宣言。
- 本 ADR の DB 反映は **新規 migration を 1 本追加** する形で行う (append-only、既存 migration は編集しない)。具体的には migration `20260506000000_p3_remove_primary_magic_string.sql` で `'primary'` リテラル行 3 テーブル分を `DELETE` し、`user_calendar_sync_state.external_calendar_id` の column default `'primary'` を `DROP DEFAULT` する。これにより preview env / 個人運用 / ローカル dev の全環境に `supabase db push` 一発で適用でき、reset 不要。
- 既存 e2e / unit test の fixture で `external_calendar_id: "primary"` を使っているケースは残してよい (内部識別子としての文字列に意味はなく、kozutsumi の subscription / sync ロジックが任意の文字列を扱えるかをテストしているだけ)。新規テストでは可能ならメールアドレス相当の値を使う。
- 将来見直す条件:
  - Google Calendar API が primary calendar の `id` 仕様を変更したら本 ADR を見直す (現状は email address で安定)。
  - Apple Calendar 等の新 source で「primary」概念が API alias に依存している場合、source 別に同様の決定を再起票する (本 ADR の supersede ではなく、新 source 対応 ADR で同じ方針を踏襲する)。
