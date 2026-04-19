-- kozutsumi Phase 1 initial schema
--
-- Scope: projects / tasks / events / task_time_entries / action_logs
-- References: docs/specs/phase1.md Step 1
--
-- 設計判断:
-- * Phase 1 では action_logs / task_time_entries も先に掘っておく
--   (docs/design/vision.md の差別化の核=行動データ取得基盤)
-- * Enum は SQL 型として定義しフロント型と一致させる
-- * RLS は user_id = auth.uid() を基本、子テーブルは親テーブル経由で制約
-- * 並べ替えの多頻度 update を想定し tasks(user_id, stack_order) に index

create extension if not exists "pgcrypto";

-- =====================================================================
-- Enum types
-- =====================================================================

create type public.task_status as enum ('idle', 'active', 'paused', 'done');
create type public.event_source as enum ('manual', 'google_calendar');
create type public.pause_reason as enum ('meeting', 'interruption', 'voluntary');

-- =====================================================================
-- projects
-- =====================================================================

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  color text not null,
  is_primary boolean not null default false,
  created_at timestamptz not null default now()
);

create index projects_user_id_idx on public.projects (user_id);

-- =====================================================================
-- tasks
-- =====================================================================

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  project_id uuid references public.projects (id) on delete set null,
  title text not null,
  body text not null default '',
  estimated_minutes integer,
  status public.task_status not null default 'idle',
  stack_order integer,
  depends_on_event_id uuid,
  is_interruption boolean not null default false,
  parent_task_id uuid references public.tasks (id) on delete set null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint tasks_estimated_minutes_positive
    check (estimated_minutes is null or estimated_minutes > 0)
);

create index tasks_user_id_idx on public.tasks (user_id);
create index tasks_user_stack_idx on public.tasks (user_id, stack_order);
create index tasks_project_id_idx on public.tasks (project_id);
create index tasks_parent_task_id_idx on public.tasks (parent_task_id);

-- =====================================================================
-- events
-- =====================================================================

create table public.events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  start_time timestamptz not null,
  end_time timestamptz not null,
  project_id uuid references public.projects (id) on delete set null,
  meet_url text,
  has_attachments boolean not null default false,
  description text not null default '',
  source public.event_source not null default 'manual',
  external_id text,
  created_at timestamptz not null default now(),
  constraint events_time_order check (end_time > start_time),
  constraint events_external_id_unique unique (source, external_id)
);

create index events_user_id_idx on public.events (user_id);
create index events_user_start_idx on public.events (user_id, start_time);

-- depends_on_event_id は events 作成後に FK を追加
alter table public.tasks
  add constraint tasks_depends_on_event_fk
  foreign key (depends_on_event_id) references public.events (id) on delete set null;

-- =====================================================================
-- task_time_entries
-- =====================================================================

create table public.task_time_entries (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks (id) on delete cascade,
  started_at timestamptz not null,
  paused_at timestamptz,
  pause_reason public.pause_reason,
  duration_seconds integer,
  constraint task_time_entries_pause_reason_requires_paused
    check (pause_reason is null or paused_at is not null),
  constraint task_time_entries_duration_non_negative
    check (duration_seconds is null or duration_seconds >= 0)
);

create index task_time_entries_task_id_idx on public.task_time_entries (task_id);
create index task_time_entries_open_idx
  on public.task_time_entries (task_id)
  where paused_at is null;

-- =====================================================================
-- action_logs
-- =====================================================================

create table public.action_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  action_type text not null,
  task_id uuid references public.tasks (id) on delete set null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 想定クエリ: ユーザー単位で時系列に再生 / 種類で絞り込み
create index action_logs_user_created_idx
  on public.action_logs (user_id, created_at desc);
create index action_logs_action_type_idx
  on public.action_logs (action_type);
create index action_logs_task_id_idx on public.action_logs (task_id);

-- =====================================================================
-- Row Level Security
-- =====================================================================

alter table public.projects enable row level security;
alter table public.tasks enable row level security;
alter table public.events enable row level security;
alter table public.task_time_entries enable row level security;
alter table public.action_logs enable row level security;

-- projects
create policy "projects: owner can select"
  on public.projects for select
  using (user_id = auth.uid());
create policy "projects: owner can insert"
  on public.projects for insert
  with check (user_id = auth.uid());
create policy "projects: owner can update"
  on public.projects for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "projects: owner can delete"
  on public.projects for delete
  using (user_id = auth.uid());

-- tasks
create policy "tasks: owner can select"
  on public.tasks for select
  using (user_id = auth.uid());
create policy "tasks: owner can insert"
  on public.tasks for insert
  with check (user_id = auth.uid());
create policy "tasks: owner can update"
  on public.tasks for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "tasks: owner can delete"
  on public.tasks for delete
  using (user_id = auth.uid());

-- events
create policy "events: owner can select"
  on public.events for select
  using (user_id = auth.uid());
create policy "events: owner can insert"
  on public.events for insert
  with check (user_id = auth.uid());
create policy "events: owner can update"
  on public.events for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "events: owner can delete"
  on public.events for delete
  using (user_id = auth.uid());

-- task_time_entries: 親 tasks 経由で所有者チェック
create policy "task_time_entries: owner can select"
  on public.task_time_entries for select
  using (
    exists (
      select 1 from public.tasks t
      where t.id = task_time_entries.task_id
        and t.user_id = auth.uid()
    )
  );
create policy "task_time_entries: owner can insert"
  on public.task_time_entries for insert
  with check (
    exists (
      select 1 from public.tasks t
      where t.id = task_time_entries.task_id
        and t.user_id = auth.uid()
    )
  );
create policy "task_time_entries: owner can update"
  on public.task_time_entries for update
  using (
    exists (
      select 1 from public.tasks t
      where t.id = task_time_entries.task_id
        and t.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.tasks t
      where t.id = task_time_entries.task_id
        and t.user_id = auth.uid()
    )
  );
create policy "task_time_entries: owner can delete"
  on public.task_time_entries for delete
  using (
    exists (
      select 1 from public.tasks t
      where t.id = task_time_entries.task_id
        and t.user_id = auth.uid()
    )
  );

-- action_logs: 読み取りのみユーザーに許可 (行動ログは削除させない運用が原則)
create policy "action_logs: owner can select"
  on public.action_logs for select
  using (user_id = auth.uid());
create policy "action_logs: owner can insert"
  on public.action_logs for insert
  with check (user_id = auth.uid());
