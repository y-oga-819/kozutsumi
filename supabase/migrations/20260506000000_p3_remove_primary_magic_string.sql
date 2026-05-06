-- ADR 0049: primary calendar の external_calendar_id を Google API resolve した実 id に統一する。
--
-- migration 20260503100000 では Phase 2 互換のためリテラル 'primary' を seed していたが、
-- ADR 0033 の `external_calendar_id` = source の実 id 規約と矛盾し、設定 UI で primary が
-- 「取り込み中」と「追加できるカレンダー」に重複表示される原因になっていた。
--
-- 本 migration は既存の 'primary' リテラルデータを物理削除し、`user_calendar_sync_state.external_calendar_id`
-- の column default 'primary' を削除する。新規 subscription / sync_state は code 経路で
-- Google API resolve した実 id を明示的に渡すため (sync.ts の seedPrimarySubscriptionFromApi)、
-- default は不要。
--
-- 削除対象は **source = 'google_calendar'** に限定する。manual 行 (`external_calendar_id = 'manual'`) には影響しない。
--
-- References:
-- * docs/adr/0049-primary-calendar-id-as-resolved-real-id.md
-- * docs/adr/0033-events-cross-source-uniqueness.md
-- * docs/adr/0034-calendar-subscription-lifecycle.md

-- =====================================================================
-- 1. 'primary' リテラルを持つ events / subscriptions / sync_state を削除
-- =====================================================================
--
-- 削除順序: events → subscriptions → sync_state。
-- events.external_calendar_id は subscription への FK ではなく値による緩い参照なので、
-- 順序は実害ないが意味的に「葉から消す」順にする。
-- 削除対象の events は ADR 0049 適用前の不整合データのみ。次回 sync で実 id (email) で再取得される。

delete from public.events
 where source = 'google_calendar'
   and external_calendar_id = 'primary';

delete from public.user_calendar_subscriptions
 where source = 'google_calendar'
   and external_calendar_id = 'primary';

delete from public.user_calendar_sync_state
 where source = 'google_calendar'
   and external_calendar_id = 'primary';

-- =====================================================================
-- 2. user_calendar_sync_state.external_calendar_id の default 'primary' を撤去
-- =====================================================================
--
-- 旧 migration 20260503100000 が compare.mjs 「NOT NULL + default なし」アサーション回避のために
-- default 'primary' を付けていた。ADR 0049 でリテラル 'primary' を禁止したので default も外す。
-- 新規行は code 経路 (saveSyncState) が常に明示的に external_calendar_id を渡すため NOT NULL 安全。
-- 同じ理由で column comment に @migration-safe-not-null marker を追加。

alter table public.user_calendar_sync_state
  alter column external_calendar_id drop default;

comment on column public.user_calendar_sync_state.external_calendar_id is
  'ADR 0033/0049: source 内 calendar 識別子 (primary は Google API resolve した email)。新規行は code 経路 (saveSyncState) が常に明示値を渡すため NOT NULL 安全。 @migration-safe-not-null';
