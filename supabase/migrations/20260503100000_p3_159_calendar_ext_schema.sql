-- kozutsumi calendar 機能拡張 schema migration (Issue #159)
--
-- ADR 0031 / 0032 / 0033 / 0034 / 0035 で確定した設計を一括で schema に当てる。
-- これは Issue #144 / #145 / #146 を block 解除する前提 migration。
--
-- References:
-- * docs/adr/0031-calendar-subscription-and-event-promotion.md
--     subscription / auto-promote / event 単位 override の 3 層モデル
-- * docs/adr/0032-events-visibility-override-physical-model.md
--     events.visibility_override の物理モデル (enum 3 値, NOT NULL DEFAULT 'none')
-- * docs/adr/0033-events-cross-source-uniqueness.md
--     source-agnostic 命名 (`external_*`) + cross-source UNIQUE
-- * docs/adr/0034-calendar-subscription-lifecycle.md
--     subscription / sync / unsubscribe / 再 subscribe ライフサイクル
-- * docs/adr/0035-action-log-payload-schema-and-actor-type.md
--     action_logs.actor_type 列追加 + 判断基準
-- * docs/adr/0001-action-logs-from-phase1.md
--     action_logs には CHECK / enum を貼らない
-- * docs/adr/0019-db-migration-via-manual-github-actions.md
--     本番は手動 GitHub Actions で適用
--
-- 設計判断の要点:
-- * 命名は source-agnostic (ADR 0033)。Google 限定の名前は使わない。
-- * `external_accounts` の Google OAuth 用列 (refresh_token 等) は本 migration に含めない
--   (Issue #146 の auth model 再設計 ADR で確定後に追加)。
-- * primary calendar の `external_calendar_id` は Google `calendarList.list` で resolve した
--   実 id (= メールアドレス) を使う (ADR 0049)。マジック文字列 `'primary'` は保存しない。
-- * 既存ユーザーへの seed (`external_accounts` / `user_calendar_subscriptions`) は本 migration では
--   行わない。Google API resolve が必要なため、code 側 (`syncGoogleCalendar` の lazy seed) で
--   subscribe 済 0 件の user に対して 1 行 upsert する。dogfood 単独運用 + migration 適用直後の
--   DB リセット前提で、過去 ADR 0034 の seed 戦略 (`'primary'` リテラル) は本 migration から撤去した。
-- * sync 経路で新しい external_account_id が必要になるケースは、code 側で lazy upsert
--   する (Issue #159 §8 の最小コード変更スコープ)。

-- =====================================================================
-- 1. external_accounts (ADR 0033 source-agnostic、最小列)
-- =====================================================================
--
-- 本 migration では (id, user_id, source, external_account_id, display_name, created_at)
-- だけを持つ最小スキーマ。Google OAuth 列は #146 で追加する。
-- `external_account_id` は source 内でアカウントを一意に識別する文字列。
-- Google なら email or google_user_id (本 migration の seed では auth.users.email を使う)。

create table public.external_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source public.event_source not null,
  external_account_id text not null,
  display_name text,
  created_at timestamptz not null default now(),
  unique (user_id, source, external_account_id)
);

create index external_accounts_user_id_idx on public.external_accounts (user_id);

comment on table public.external_accounts is
  'ADR 0033: 外部 calendar source 内のアカウント識別 (source-agnostic)。Google OAuth 用列は #146 で追加。';

-- =====================================================================
-- 2. user_calendar_subscriptions (ADR 0031)
-- =====================================================================
--
-- calendar 単位の subscription (取り込み対象) を管理する。
-- `auto_promote_to_timeline` の default は **既存挙動 (primary 固定で timeline に出る)**
-- と整合させて true にする。

create table public.user_calendar_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  external_account_id uuid not null references public.external_accounts (id) on delete cascade,
  source public.event_source not null,
  external_calendar_id text not null,
  auto_promote_to_timeline boolean not null default true,
  display_name text,
  color text,
  subscribed_at timestamptz not null default now(),
  unique (user_id, external_account_id, external_calendar_id)
);

create index user_calendar_subscriptions_user_id_idx
  on public.user_calendar_subscriptions (user_id);
create index user_calendar_subscriptions_account_idx
  on public.user_calendar_subscriptions (user_id, external_account_id);
-- FK (external_account_id) lookup の standalone index。
-- 複合 (user_id, external_account_id) は leading column が user_id なので
-- external_accounts 削除時の cascade lookup を覆わない (supabase db lint 対策)。
create index user_calendar_subscriptions_external_account_idx
  on public.user_calendar_subscriptions (external_account_id);

comment on table public.user_calendar_subscriptions is
  'ADR 0031: calendar 単位の subscription (Layer 1) と auto-promote 設定 (Layer 2)。';

-- =====================================================================
-- 3. (ADR 0049) primary 自動 seed は migration では行わない
-- =====================================================================
--
-- primary calendar の `external_calendar_id` は Google `calendarList.list` で resolve した実 id
-- (= メールアドレス) を使う (ADR 0049)。SQL migration からは Google API を叩けないため、本セクション
-- では何も seed しない。code 側 (`syncGoogleCalendar` 経由の lazy seed) が subscription 0 件の user に
-- 対して、初回 sync 時に primary calendar を 1 行 upsert する (実 id 解決を内包)。
--
-- 過去 ADR 0034 の seed 戦略 (リテラル `'primary'` を `external_calendar_id` に格納) は ADR 0049 で
-- 廃止した。dogfood 単独運用 + migration 適用直後の DB リセット前提のため、本 migration から
-- 既存ユーザー seed のロジックを撤去している。

-- =====================================================================
-- 4. events.visibility_override (ADR 0032)
-- =====================================================================
--
-- 3 値 enum (`none` / `shown` / `hidden`)。`none` は「subscription default に従う」。
-- 既存行は default 'none' で埋まり、UI 経由でユーザーが override すると `shown`/`hidden` になる。
-- 三値モデル (`info_only` 等) は ADR 0032 で将来拡張余地のみ確保、本 migration では実装しない。

create type public.event_visibility_override as enum ('none', 'shown', 'hidden');

alter table public.events
  add column visibility_override public.event_visibility_override
    not null default 'none';

comment on column public.events.visibility_override is
  'ADR 0032: 個別 event の予定化 override。none = subscription default に従う。';

-- =====================================================================
-- 5. events.external_calendar_id + UNIQUE 拡張 (ADR 0033)
-- =====================================================================
--
-- triple `(source, external_calendar_id, external_id)` で events を一意化する。
-- 既存 UNIQUE `(source, external_id)` は drop して置き換える。
-- default は `'manual'` (manual source の固定値と一致):
--   - 既存行 (manual / google) を NOT NULL 違反させない backfill 兼任
--   - PR migration diff (compare.mjs) の「NOT NULL + default なし」アサーション回避
--   - 実際の sync / create コードは常に external_calendar_id を明示的に渡す
--     (google: subscription の calendar id、manual: 'manual')
-- google_calendar 既存行の backfill は本 migration では行わない (ADR 0049: primary calendar の実 id は
-- Google API resolve でしか得られず、SQL からは backfill 不能)。dogfood 単独運用 + DB リセット前提で、
-- 既存 google_calendar 行が残っているケースは想定しない (リセット後は code 経由で実 id を埋める)。
-- manual 行の external_id は NULL のまま残るが、Postgres の UNIQUE は NULL 同士を等価としない
-- ので、複数の manual event が共存できる挙動は変わらない (initial_schema と同じ)。

alter table public.events
  add column external_calendar_id text not null default 'manual';

alter table public.events drop constraint events_external_id_unique;

alter table public.events
  add constraint events_external_unique
  unique (source, external_calendar_id, external_id);

comment on column public.events.external_calendar_id is
  'ADR 0033 / 0049: triple uniqueness の中間軸。manual は ''manual'' / google_calendar は Google API resolve した実 calendar id (primary なら user の email)。';

create index events_user_calendar_start_idx
  on public.events (user_id, source, external_calendar_id, start_time);

-- =====================================================================
-- 6. user_calendar_sync_state を複合キー化 (ADR 0031/0033/0049)
-- =====================================================================
--
-- 旧 PK: (user_id) / 新 PK: (user_id, source, external_account_id, external_calendar_id)
--
-- これにより複数 calendar / 複数 account 対応 (#144 / #146) で sync_token と
-- lastSyncedAt を独立に管理できるようになる。
--
-- default の方針 (compare.mjs 「NOT NULL + default なし」アサーション対策):
--   - source: 'google_calendar' (現状 sync 経路は GCal のみ。Apple 等は将来別 ADR)
--   - external_account_id / external_calendar_id: default 不能 (前者は uuid FK、後者は ADR 0049 で
--     マジック文字列 `'primary'` を禁止したため)。column comment に `@migration-safe-not-null`
--     marker を付けて compare.mjs で opt-out。本 migration 内で section 3 seed を撤去した結果、
--     既存行は backfill で external_account_id IS NULL になり下段 DELETE で全消えする (DB リセット相当)。
--     よって NOT NULL 化は安全。
--
-- ADR 0049: section 3 で external_accounts を seed しないため、本 migration を既存 DB に当てた場合
-- 既存 user_calendar_sync_state 行は backfill で external_account_id = NULL → 一括削除される。
-- dogfood 単独運用 + DB リセット前提なのでこの破壊は意図的。

alter table public.user_calendar_sync_state
  add column source public.event_source not null default 'google_calendar',
  add column external_account_id uuid references public.external_accounts (id) on delete cascade,
  add column external_calendar_id text;

update public.user_calendar_sync_state ucs
   set external_account_id = (
         select ea.id
           from public.external_accounts ea
          where ea.user_id = ucs.user_id
            and ea.source = 'google_calendar'
          limit 1
       );

delete from public.user_calendar_sync_state where external_account_id is null;

alter table public.user_calendar_sync_state
  alter column external_account_id set not null,
  alter column external_calendar_id set not null;

comment on column public.user_calendar_sync_state.external_account_id is
  'ADR 0031/0033: 外部アカウント (Google / Apple 等) の uuid FK。section 6 直後に NOT NULL 化、新規行は code 経路で常に明示値を渡すため NOT NULL 安全。 @migration-safe-not-null';

comment on column public.user_calendar_sync_state.external_calendar_id is
  'ADR 0033/0049: source 内 calendar 識別子 (primary は Google API resolve した email)。section 6 で既存行を全削除し、新規行は code 経路 (saveSyncState) が常に明示値を渡すため NOT NULL 安全。 @migration-safe-not-null';

-- 旧 PK (user_id) を drop して複合 PK に置き換える。
-- 旧 PK は initial_schema で `user_id uuid primary key references ...` の inline で
-- 作られているので、制約名は `user_calendar_sync_state_pkey`。
alter table public.user_calendar_sync_state
  drop constraint user_calendar_sync_state_pkey;

alter table public.user_calendar_sync_state
  add constraint user_calendar_sync_state_pkey
  primary key (user_id, source, external_account_id, external_calendar_id);

create index user_calendar_sync_state_user_idx
  on public.user_calendar_sync_state (user_id);
-- FK (external_account_id) lookup の standalone index (supabase db lint 対策)
create index user_calendar_sync_state_external_account_idx
  on public.user_calendar_sync_state (external_account_id);

-- =====================================================================
-- 7. external_accounts / user_calendar_subscriptions の RLS
-- =====================================================================
--
-- owner-only 4 種ポリシー (initial_schema の events / projects と同等)。
-- ADR 0023 の規約チェックも 4 種揃いを要求する。

alter table public.external_accounts enable row level security;

create policy "external_accounts: owner can select"
  on public.external_accounts for select
  using (user_id = auth.uid());
create policy "external_accounts: owner can insert"
  on public.external_accounts for insert
  with check (user_id = auth.uid());
create policy "external_accounts: owner can update"
  on public.external_accounts for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "external_accounts: owner can delete"
  on public.external_accounts for delete
  using (user_id = auth.uid());

alter table public.user_calendar_subscriptions enable row level security;

create policy "user_calendar_subscriptions: owner can select"
  on public.user_calendar_subscriptions for select
  using (user_id = auth.uid());
create policy "user_calendar_subscriptions: owner can insert"
  on public.user_calendar_subscriptions for insert
  with check (user_id = auth.uid());
create policy "user_calendar_subscriptions: owner can update"
  on public.user_calendar_subscriptions for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "user_calendar_subscriptions: owner can delete"
  on public.user_calendar_subscriptions for delete
  using (user_id = auth.uid());

-- =====================================================================
-- 8. action_logs.actor_type (ADR 0035)
-- =====================================================================
--
-- ADR 0001 の「CHECK / enum を貼らない」原則に従い text 列のまま運用する。
-- TypeScript リテラル union (`'user' | 'system'`) で値域を担保する。
-- default 'user' により既存行は実質的に正しい値で埋まる
-- (本 ADR 確定前は user actor のみが INSERT していた前提)。
--
-- index は Phase 4 で `WHERE user_id = ? AND actor_type = ?` の絞り込みが
-- 頻発する想定で先回り (vision の差別化の核 = 「人間の操作のうち AI 代替可能なもの」分析)。

alter table public.action_logs
  add column actor_type text not null default 'user';

comment on column public.action_logs.actor_type is
  'ADR 0035: アクションを起こした主体 (''user'' / ''system'' / 将来 ''ai'')。CHECK は貼らず TypeScript 側で値域維持。';

create index action_logs_actor_user_created_idx
  on public.action_logs (user_id, actor_type, created_at desc);
