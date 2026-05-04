-- kozutsumi Phase 3 派生 (issue #171 / ADR 0039): tasks.project_id の親-子-兄弟伝播 RPC を追加
--
-- References:
-- * docs/adr/0039-task-project-edit-and-cascade.md
--   ADR-0039 が決めた伝播ルールを atomic に実装する:
--     - 親の project_id を変更 → 同じ parent_task_id を持つ全子も同じ project_id に
--     - 子の project_id を変更 → 親と同じ parent_task_id を持つ全兄弟も同じ project_id に
--     - 単独タスクは当該行のみ (RPC ではなく既存の update 経路で十分なので扱わない)
-- * docs/adr/0036-simplify-task-registration-workflow.md (シンプル世界観: 後から修正できる前提)
-- * docs/adr/0019-db-migration-via-manual-github-actions.md / 0020 (本番適用は手動 workflow)
-- * supabase/migrations/20260503000000_p3_decompose_parent_task_fn.sql
--   (fn_decompose_parent_task と同じ security invoker + atomic update パターン)
--
-- 設計判断:
-- - RPC を 2 本に分ける (1 本に内部判定で寄せない)。
--   呼び出し側 (frontend) で親/子/単独の判定 + 影響件数の事前計算を確認 dialog に出す
--   ため、入口を分けたほうが UI 側の責任分解がきれい (ADR-0039 Notes 「視認性は実装の関心」)。
-- - 戻り値は影響を受けた task id 配列。呼び出し側はこれを action_log の
--   `affected_task_ids` payload (1 操作 = 1 ログ + 範囲) に詰めて Phase 4 学習素材化する。
-- - action_logs への記録は呼び出し側 (useDashboardMutations) で行う。RPC 内で log すると
--   失敗時のロールバック範囲が広がり、楽観更新と整合させづらい (fn_decompose_parent_task と同じ方針)。

-- =====================================================================
-- fn_update_task_project_with_children
-- =====================================================================
--
-- 引数:
--   p_task_id          : 親タスクの id (parent_task_id is null である前提)
--   p_new_project_id   : 新しい project_id (null で「未指定」)
--
-- 戻り値:
--   uuid[]             : 影響を受けた task id 配列 (親自身 + 全子)
--
-- 想定呼び出し: target が親 (parent_task_id is null) かつ子が 1 件以上居る場合のみ。
-- target が単独 (子なし) の場合は呼び出し側で update 経路に倒すこと。
-- target が子 (parent_task_id not null) を渡されたら例外で弾く (ガード)。

create or replace function public.fn_update_task_project_with_children(
  p_task_id uuid,
  p_new_project_id uuid
) returns uuid[]
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_parent_task_id uuid;
  v_affected uuid[] := '{}';
begin
  -- 1. target row を読む (RLS で別 user は 0 行 → v_user_id is null)
  select user_id, parent_task_id
    into v_user_id, v_parent_task_id
    from public.tasks
   where id = p_task_id;

  if v_user_id is null then
    raise exception 'fn_update_task_project_with_children: target task not found or not authorized: %', p_task_id;
  end if;

  -- 2. ガード: target は親 (parent_task_id is null) であること
  if v_parent_task_id is not null then
    raise exception 'fn_update_task_project_with_children: target must be a parent task (parent_task_id is null), got %', p_task_id;
  end if;

  -- 3. 親自身 + 全子 (parent_task_id = p_task_id) を 1 文で update し、影響 id を回収
  with updated as (
    update public.tasks
       set project_id = p_new_project_id
     where id = p_task_id
        or parent_task_id = p_task_id
     returning id
  )
  select array_agg(id) into v_affected from updated;

  return v_affected;
end;
$$;

comment on function public.fn_update_task_project_with_children(uuid, uuid) is
  'Issue #171 / ADR 0039: 親 task の project_id 変更を全子に atomic 伝播する。security invoker (RLS 適用)。';

-- =====================================================================
-- fn_update_task_project_with_siblings_and_parent
-- =====================================================================
--
-- 引数:
--   p_task_id          : 子タスクの id (parent_task_id is not null である前提)
--   p_new_project_id   : 新しい project_id (null で「未指定」)
--
-- 戻り値:
--   uuid[]             : 影響を受けた task id 配列 (target 子 + 親 + 全兄弟)
--
-- 想定呼び出し: target が子 (parent_task_id not null) の場合のみ。
-- target が親 / 単独を渡されたら例外で弾く (ガード)。

create or replace function public.fn_update_task_project_with_siblings_and_parent(
  p_task_id uuid,
  p_new_project_id uuid
) returns uuid[]
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid;
  v_parent_id uuid;
  v_affected uuid[] := '{}';
begin
  -- 1. target row を読む
  select user_id, parent_task_id
    into v_user_id, v_parent_id
    from public.tasks
   where id = p_task_id;

  if v_user_id is null then
    raise exception 'fn_update_task_project_with_siblings_and_parent: target task not found or not authorized: %', p_task_id;
  end if;

  -- 2. ガード: target は子 (parent_task_id is not null) であること
  if v_parent_id is null then
    raise exception 'fn_update_task_project_with_siblings_and_parent: target must be a child task (parent_task_id is not null), got %', p_task_id;
  end if;

  -- 3. 親 + 同じ parent_task_id を持つ全行 (target 子 + 全兄弟) を一括 update。
  --    1 文で id = v_parent_id OR parent_task_id = v_parent_id を update することで、
  --    親と兄弟を 1 トランザクション内の 1 文で揃える。
  with updated as (
    update public.tasks
       set project_id = p_new_project_id
     where id = v_parent_id
        or parent_task_id = v_parent_id
     returning id
  )
  select array_agg(id) into v_affected from updated;

  return v_affected;
end;
$$;

comment on function public.fn_update_task_project_with_siblings_and_parent(uuid, uuid) is
  'Issue #171 / ADR 0039: 子 task の project_id 変更を親と全兄弟に atomic 伝播する。security invoker (RLS 適用)。';

-- =====================================================================
-- 権限
-- =====================================================================
--
-- ADR-0039 / 既存 RPC (fn_decompose_parent_task / fn_resplit_child_task) と揃え、
-- authenticated ロールにのみ execute を許可。anon には grant しない。
-- security invoker なので RLS は呼び出し元の auth.uid() 一致で効く (kozutsumi の Phase 1 方針 / ADR 0001)。

grant execute on function public.fn_update_task_project_with_children(uuid, uuid) to authenticated;
grant execute on function public.fn_update_task_project_with_siblings_and_parent(uuid, uuid) to authenticated;
