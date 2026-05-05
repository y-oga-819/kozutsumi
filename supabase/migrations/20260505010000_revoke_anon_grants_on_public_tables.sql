-- kozutsumi: public schema の全 table から anon role への暗黙 GRANT を REVOKE する (Issue #202)
--
-- References:
-- * Issue #202: 本番 Supabase project の public.* に anon への ALL PRIVILEGES が残っている
-- * docs/adr/0001-action-logs-from-phase1.md
--     anon に grant しない (Phase 1 方針)。RLS で行アクセスは制御済み
-- * docs/adr/0046-db-grants-fully-described-by-migrations.md
--     public schema の table-level GRANT は migration が完全記述する原則。
--     ADR-0046 の射程は authenticated 軸 (正しい暗黙 GRANT を保存・明示再宣言する) で、
--     本 migration は anon 軸 (誤った暗黙 GRANT を REVOKE する) を補完する。
--     両者は対象ロールが異なり、共存する判断 (ADR-0001 / 0046 と principle が一致した実装)。
-- * supabase/migrations/20260504040000_grant_authenticated_to_public_tables.sql
--     authenticated 軸の対となる migration (#200 / PR #201)
--
-- 設計判断:
-- * **anon に table-level GRANT を残さない**。ADR-0001 で「anon に grant しない」と
--   方針が決まっているが、古い Supabase project template の置き土産で本番の `pg_class.relacl` と
--   `pg_default_acl` に anon への ALL PRIVILEGES が残っていた。RLS で行アクセスは
--   `auth.uid() = user_id` (anon は auth.uid()=NULL) で守られているため実害は無いが、
--   RLS が一瞬でも無効化される / 新規 table で RLS enable し忘れる、等で
--   defense-in-depth が崩れる経路がある。table-level でも anon を弾く。
-- * **idempotent**。REVOKE は重複実行しても no-op。preview / 新規 project では既に anon GRANT が
--   無いので何も変化しない (本番のみ実体変化)。
-- * **default privileges は 2 ロール分**。本番では `pg_default_acl` の granting role が
--   `postgres` と `supabase_admin` の両方に anon entry を持っているため、両方 REVOKE する。
--   preview / 新規 project では両 entry が無いので no-op。
-- * **本番への適用は ADR-0019 の手動 workflow 経由**。事前に `\dp public.<table>` で anon GRANT が
--   存在することを確認してから適用、適用後に anon 行が消えていることを検証する。
-- * **anon REVOKE は authenticated / postgres / service_role 経路に影響しない**。それぞれ
--   独立した role で接続する。

-- =====================================================================
-- 1. 既存 table から anon の GRANT を全て剥がす
-- =====================================================================
--
-- 対象 table は ADR-0046 初回 migration (20260504040000) と同じ集合:
--   - projects / tasks / events / task_time_entries / action_logs (initial_schema)
--   - user_calendar_sync_state (20260424120000)
--   - external_accounts / user_calendar_subscriptions (20260503100000)

revoke all on
    public.projects,
    public.tasks,
    public.events,
    public.task_time_entries,
    public.action_logs,
    public.user_calendar_sync_state,
    public.external_accounts,
    public.user_calendar_subscriptions
  from anon;

-- =====================================================================
-- 2. 今後新規 table を作っても anon に自動 GRANT が付かないようにする
-- =====================================================================
--
-- 本番の `pg_default_acl` には postgres / supabase_admin 両ロールに anon entry が
-- 残っているため、両方 REVOKE する。preview / 新規 project では entry が無いため no-op。

alter default privileges for role postgres in schema public
  revoke all on tables from anon;

alter default privileges for role supabase_admin in schema public
  revoke all on tables from anon;
