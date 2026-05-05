-- kozutsumi Phase 3 派生 (issue #184 / #185): tasks.stack_order の atomic 一括更新 RPC を追加
--
-- References:
-- * issue #184: migration / RPC の追加
-- * issue #185: gateway を `Promise.all` 並列 update から本 RPC 経由に切り替え
-- * docs/adr/0019-db-migration-via-manual-github-actions.md (本番適用は手動 workflow)
-- * docs/adr/0023-pr-migration-diff-auto-comment.md
-- * supabase/migrations/20260504020000_p3_171_task_project_cascade_fns.sql
--   (security invoker + atomic update + grant authenticated パターン)
--
-- 設計判断:
-- - これまで gateway 側で `Promise.all` で N 件の update を並列発行していたが、
--   partial failure で DB が中途半端に残るリスクがある。グループ reorder
--   (ADR-0041 / issue #172) で更新範囲が広がるとリスクが顕在化しやすいため、
--   1 transaction で一括 update する RPC を入口に揃える。
-- - 入力は `[{id: uuid, stack_order: int|null}, ...]` の jsonb 配列。
--   `jsonb_to_recordset` で展開して 1 文 update。loop は不要 (1 statement
--   なので plpgsql ループより素直で、件数 (実用上 数〜数十件) でも十分速い)。
-- - `security invoker` で RLS が呼び出し元の auth.uid() に効く
--   (Phase 1 方針 / ADR-0001)。自分の task 以外は RLS で update 0 行に落ちる。
-- - 戻り値は不要 (gateway 側は成功/失敗だけ知れればよい)。

create or replace function public.reorder_tasks_atomic(
  entries jsonb
) returns void
language sql
security invoker
set search_path = public, pg_temp
as $$
  update public.tasks t
     set stack_order = e.stack_order
    from jsonb_to_recordset(entries) as e(id uuid, stack_order int)
   where t.id = e.id;
$$;

comment on function public.reorder_tasks_atomic(jsonb) is
  'Issue #184 / #185: tasks.stack_order を 1 transaction で一括更新する RPC。security invoker (RLS 適用)。';

-- 権限: 既存 RPC と揃え authenticated のみ。anon には grant しない。
grant execute on function public.reorder_tasks_atomic(jsonb) to authenticated;
