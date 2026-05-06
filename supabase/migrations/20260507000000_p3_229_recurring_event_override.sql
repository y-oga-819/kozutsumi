-- Issue #229 / ADR 0056: recurring event の系列 override は「rule + bulk apply」併用で表現する。
--
-- References:
-- * docs/adr/0056-recurring-event-override-via-rule-and-bulk-apply.md
--     events.recurring_event_id 列追加 + event_visibility_override_rules テーブル新設
--     (本 ADR §1)。事実 (events.visibility_override) と方針 (rules) を別レイヤで持つ。
-- * docs/adr/0032-events-visibility-override-physical-model.md
--     visibility_override の 3 値 enum (none / shown / hidden)。本 migration で再利用。
-- * docs/adr/0033-events-cross-source-uniqueness.md
--     triple `(source, external_calendar_id, external_id)` で events を一意化する原則。
--     rules テーブルの recurring グループ識別もこれに揃える (`source` + `external_calendar_id`
--     + `recurring_event_id` の triple)。
-- * docs/adr/0046-db-grants-fully-described-by-migrations.md
--     authenticated への table-level GRANT は migration が完全記述する。
--     ALTER DEFAULT PRIVILEGES があるので新規 table も自動 GRANT 対象になるが、
--     idempotent に明示しておく。
-- * docs/adr/0001-action-logs-from-phase1.md
--     action_logs には CHECK / enum を貼らない原則。本 migration は触らない。
--
-- 設計判断の要点:
-- * `events.recurring_event_id` は **既存行 backfill しない** (ADR 0056 §1)。
--   次回 sync で各 instance の `recurringEventId` が埋まる挙動を許容する。
--   manual / 単発 google event は NULL のまま (= 単発 event を表す)。
-- * rules の `scope` は text 列 (CHECK 無し)。値域は TS リテラル union で固定する
--   (ADR 0001 と整合)。`override_value` も同様。
-- * rules の UNIQUE は `(user_id, source, external_calendar_id, recurring_event_id, scope,
--   override_value, from_start_time)` ではなく **`(user_id, source, external_calendar_id,
--   recurring_event_id)`** にして、1 系列につき rule は 1 件だけにする。系列に対する方針は
--   常に最新 1 件で十分 (ADR 0056 §3 後段: 既存 rule があれば置き換える)。

-- =====================================================================
-- 1. events.recurring_event_id を追加 (ADR 0056 §1)
-- =====================================================================
--
-- Google Calendar API `events.list?singleEvents=true` でも各 instance の
-- `recurringEventId` が返る (recurring の master を指す文字列、Google 内部 id)。
-- kozutsumi 側は (source, external_calendar_id, recurring_event_id) で recurring グループを
-- 識別する (`source` / `external_calendar_id` は既存の triple 軸を流用)。
--
-- 既存行 backfill はしない: 次回 sync で各 instance に値が入る (ADR 0056 §1)。
-- 単発 event は NULL のまま。

alter table public.events
  add column recurring_event_id text;

comment on column public.events.recurring_event_id is
  'ADR 0056: Google Calendar の recurring master id (singleEvents=true でも返る)。NULL = 単発 event。'
  ' (source, external_calendar_id, recurring_event_id) で recurring グループを識別する。';

-- recurring グループ単位の bulk update / rule 適用クエリを高速化する。
-- WHERE clause は `(user_id, source, external_calendar_id, recurring_event_id)` の複合になり、
-- recurring_event_id IS NOT NULL の行に絞った partial index が選択性として有効。
create index events_recurring_group_idx
  on public.events (user_id, source, external_calendar_id, recurring_event_id)
  where recurring_event_id is not null;

-- =====================================================================
-- 2. event_visibility_override_rules テーブル新設 (ADR 0056 §1)
-- =====================================================================
--
-- 「方針」を表すテーブル。事実 (events.visibility_override) とは別レイヤ。
-- rule は新規 instance 取り込み時の default を上書きするために使う (ADR 0056 §2)。
--
-- 1 recurring グループ (source + external_calendar_id + recurring_event_id) につき
-- rule は 1 件まで。新しい操作は既存 rule を上書きする (ON CONFLICT DO UPDATE)。
-- これにより「方針」は常に「最新の意思」として 1 件に正規化される。
--
-- `scope`:
--   - 'this_and_following' = 操作対象 instance の start_time 以降の新規 instance に適用
--   - 'all'                = 全ての新規 instance に適用 (from_start_time は NULL)
-- `from_start_time`:
--   - scope='this_and_following' のとき NOT NULL (操作対象 instance の start_time)
--   - scope='all'                のとき NULL
-- `override_value`:
--   - 'shown' / 'hidden' のいずれか。`'none'` は rule として持たない
--     (rule 削除 = 方針撤回 = 新規 instance を default に戻す)。

create table public.event_visibility_override_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  source public.event_source not null,
  external_calendar_id text not null,
  recurring_event_id text not null,
  scope text not null,
  override_value public.event_visibility_override not null,
  from_start_time timestamptz,
  created_at timestamptz not null default now(),
  -- 1 recurring グループにつき rule は 1 件 (ADR 0056 §3)
  unique (user_id, source, external_calendar_id, recurring_event_id),
  -- override_value は 'none' を rule として持たない (rule 自体が「方針あり」を意味する)
  constraint event_visibility_override_rules_value_chk
    check (override_value in ('shown', 'hidden')),
  -- scope と from_start_time の整合性 (ADR 0056 §1 / §4)
  constraint event_visibility_override_rules_scope_chk
    check (
      (scope = 'this_and_following' and from_start_time is not null) or
      (scope = 'all' and from_start_time is null)
    )
);

comment on table public.event_visibility_override_rules is
  'ADR 0056: recurring event の系列 override 方針。新規 instance 取り込み時に default を上書きする。';

-- 適用判定 (新規 instance insert 時) のクエリ高速化。
create index event_visibility_override_rules_lookup_idx
  on public.event_visibility_override_rules
     (user_id, source, external_calendar_id, recurring_event_id);

-- =====================================================================
-- 3. RLS (owner-only 4 種、ADR 0023 規約)
-- =====================================================================

alter table public.event_visibility_override_rules enable row level security;

create policy "event_visibility_override_rules: owner can select"
  on public.event_visibility_override_rules for select
  using (user_id = auth.uid());
create policy "event_visibility_override_rules: owner can insert"
  on public.event_visibility_override_rules for insert
  with check (user_id = auth.uid());
create policy "event_visibility_override_rules: owner can update"
  on public.event_visibility_override_rules for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "event_visibility_override_rules: owner can delete"
  on public.event_visibility_override_rules for delete
  using (user_id = auth.uid());

-- =====================================================================
-- 4. authenticated への table-level GRANT (ADR 0046)
-- =====================================================================
--
-- 20260504040000_grant_authenticated_to_public_tables.sql で ALTER DEFAULT PRIVILEGES
-- を入れているので postgres role で create した本 table は自動的に GRANT 対象になる。
-- 念のため明示的にも grant して preview / 本番のずれを防ぐ (idempotent)。

grant select, insert, update, delete on
    public.event_visibility_override_rules
  to authenticated;
