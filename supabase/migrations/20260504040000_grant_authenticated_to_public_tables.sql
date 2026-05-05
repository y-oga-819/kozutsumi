-- kozutsumi: public schema の全 table に authenticated ロールへの table-level GRANT を付与する (Issue #200)
--
-- References:
-- * Issue #200: preview Supabase project で authenticated に table-level GRANT が無く 42501 で全 REST が 403
-- * docs/adr/0046-db-grants-fully-described-by-migrations.md
--     public schema の table-level GRANT は migration が完全記述する原則
-- * docs/adr/0001-action-logs-from-phase1.md
--     anon に grant しない (Phase 1 方針)。RLS で行アクセスは制御済み
-- * docs/adr/0042-preview-env-uses-separate-supabase-project.md
--     preview env が独立 Supabase project になり、本番では暗黙に効いていた
--     project 初期化時の table-level GRANT が無い状態が顕在化した
-- * docs/adr/0043-preview-db-migration-auto-apply-on-pr-push.md
--     preview reset / 再生成のたびに同じ問題が再発するため migration 化が必要
--
-- 設計判断:
-- * **table-level GRANT は permissive、RLS が gatekeeper** (ADR 0046)。
--   `authenticated` に SELECT/INSERT/UPDATE/DELETE を一律に与え、
--   実際の行アクセスは既存の RLS policy (user_id = auth.uid()) で制御する。
--   action_logs は policy 上 UPDATE/DELETE は許可していないが、
--   table-level GRANT を 4 種揃えても RLS が拒むため安全。
-- * **anon には grant しない** (ADR-0001 / ADR-0046 と整合)。
--   Phase 1 では未認証ユーザーに DB を直接触らせない方針。
-- * **idempotent**。GRANT は重複実行しても no-op。本番に当てても既存暗黙 GRANT を破壊しない。
--   本番では事実上 no-op、preview では実体変化を起こす (ADR 0046 の趣旨)。
-- * **ALTER DEFAULT PRIVILEGES** で **postgres ロールが今後 public schema に作る table は
--   自動で authenticated に GRANT** される。これにより新規 table 追加時に同じ罠を踏まない。
--   (注) ALTER DEFAULT PRIVILEGES は **本 migration を流すロールが今後作る** object に効く。
--   Supabase の migration apply は postgres role で行われるため、`FOR ROLE postgres` を明示する。

-- =====================================================================
-- 1. 既存 table 全部に authenticated への GRANT を明示する
-- =====================================================================
--
-- 対象 table は本 migration 時点で public schema に存在するもの:
--   - projects / tasks / events / task_time_entries / action_logs
--     (initial_schema)
--   - user_calendar_sync_state (20260424120000)
--   - external_accounts / user_calendar_subscriptions (20260503100000)

grant select, insert, update, delete on
    public.projects,
    public.tasks,
    public.events,
    public.task_time_entries,
    public.action_logs,
    public.user_calendar_sync_state,
    public.external_accounts,
    public.user_calendar_subscriptions
  to authenticated;

-- =====================================================================
-- 2. 今後 postgres が public schema に作る新規 table を自動 grant 対象にする
-- =====================================================================
--
-- これにより新規 migration で `create table public.foo (...)` を追加するだけで
-- authenticated が table-level access を得る (RLS は別途 enable + policy 必須)。
-- 本 migration 以降に追加された table への grant 漏れを構造的に防ぐ。

alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to authenticated;
