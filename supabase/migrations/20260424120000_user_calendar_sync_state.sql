-- kozutsumi Phase 2 (P2-3): Google Calendar 同期状態の永続化
--
-- References:
-- * docs/adr/0007-google-calendar-sync-trigger-manual-and-lazy.md
--   (最終同期時刻を元に「15 分以上経過していれば起動時遅延同期」を判定する)
-- * docs/adr/0006-google-calendar-sync-mode-staged-adoption.md
--   (P2-6 で `sync_token` に syncToken を保存する器を先に作る)

create table public.user_calendar_sync_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_synced_at timestamptz not null,
  sync_token text,
  updated_at timestamptz not null default now()
);

alter table public.user_calendar_sync_state enable row level security;

create policy "user_calendar_sync_state: owner can select"
  on public.user_calendar_sync_state for select
  using (user_id = auth.uid());
create policy "user_calendar_sync_state: owner can insert"
  on public.user_calendar_sync_state for insert
  with check (user_id = auth.uid());
create policy "user_calendar_sync_state: owner can update"
  on public.user_calendar_sync_state for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "user_calendar_sync_state: owner can delete"
  on public.user_calendar_sync_state for delete
  using (user_id = auth.uid());
