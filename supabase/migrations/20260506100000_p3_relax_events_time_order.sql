-- ADR 0050: ゼロ長 / 終日イベントを heuristic で扱う。
--
-- ゼロ長 (start === end) の締切系予定 (例: `18:00 までに学童のお迎え`) を取り込めるようにするため、
-- `events_time_order` 制約を strict (`end > start`) から非 strict (`end >= start`) に緩める。
-- 逆順 (end < start) は引き続き不正データとして弾く。
--
-- References:
-- * docs/adr/0050-zero-and-full-day-event-handling.md
-- * Issue #221 / Issue #222

alter table public.events
  drop constraint if exists events_time_order;

alter table public.events
  add constraint events_time_order check (end_time >= start_time);
