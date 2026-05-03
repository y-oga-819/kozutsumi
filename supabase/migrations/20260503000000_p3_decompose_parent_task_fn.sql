-- kozutsumi Phase 3 派生 (issue #150): AI 分解の子 insert + 親 decompose_status 更新を 1 トランザクション化
--
-- References:
-- * docs/adr/0017-ai-task-decomposition-async.md (AI 分解は async fire-and-forget)
-- * docs/adr/0021-ai-decomposition-failure-visibility.md
--   (decomposing で固まらない不変条件: 子 insert と親 status 更新の中間 failure を消す)
-- * supabase/migrations/20260430230402_p3_resplit_child_task_fn.sql
--   (子の再分解 RPC fn_resplit_child_task。本 migration は同じパターンで親 → 子 insert を atomic 化する)
--
-- 本 migration が決めること:
-- 1. fn_decompose_parent_task PL/pgSQL function を新設
--    新規子 insert + 親 decompose_status='decomposed' 更新を 1 トランザクションで行う
-- 2. action_logs への記録は呼び出し側 (decompose-server.ts) で行う
--    (RPC 内で log すると失敗時のロールバック範囲が広がる + 学習素材の主要属性は呼び出し側でしか取れない。
--     fn_resplit_child_task と同じ設計方針)

-- =====================================================================
-- fn_decompose_parent_task
-- =====================================================================
--
-- 引数:
--   p_parent_id         : 分解対象の親 task id
--   p_base_stack_order  : 子の先頭 stack_order (= 親の stack_order を引き継ぐ)
--   p_new_children      : 新規子の配列 (jsonb)。各要素は
--                         { title, body, estimated_minutes, task_category } を持つ
--
-- 戻り値:
--   uuid[]              : 新規子の id 配列 (jsonb 入力順 = stack_order 昇順)
--
-- security invoker: RLS で auth.uid() 一致のみ許可 (kozutsumi の Phase 1 方針 / ADR 0001)。
-- 別ユーザーの行は select / update / insert すべてが 0 行扱いで弾かれる。
--
-- 順序:
--   1. 親 row から user_id / project_id / depends_on_event_id を取得 (子継承用)
--   2. 新規子を base_stack_order, base+1, ..., base+N-1 で連続 insert
--   3. 親の decompose_status を 'decomposed' に更新
--
-- 中間で失敗すれば transaction 全体が rollback され、orchestrator (decompose-server.ts) が
-- ADR 0021 の last-resort safety net で parent を 'failed' に倒す経路に合流する。
-- これにより「子 insert 成功 + 親 status 更新失敗 → decomposing で固まる」経路を構造的に消す。

create or replace function public.fn_decompose_parent_task(
  p_parent_id uuid,
  p_base_stack_order integer,
  p_new_children jsonb
) returns uuid[]
language plpgsql
security invoker
as $$
declare
  v_user_id uuid;
  v_project_id uuid;
  v_depends_on_event_id uuid;
  v_idx int;
  v_count int;
  v_child jsonb;
  v_new_id uuid;
  v_new_ids uuid[] := '{}';
begin
  -- 1. 親 row の継承用属性を取得 (RLS で別 user の親は 0 行 → v_user_id is null になる)
  select user_id, project_id, depends_on_event_id
    into v_user_id, v_project_id, v_depends_on_event_id
    from public.tasks
   where id = p_parent_id;

  if v_user_id is null then
    raise exception 'fn_decompose_parent_task: parent task not found or not authorized: %', p_parent_id;
  end if;

  -- 2. 新規子配列のサイズを確認 (空配列禁止: orchestrator で 0 件は skipped 経路に流れる)
  v_count := jsonb_array_length(p_new_children);
  if v_count < 1 then
    raise exception 'fn_decompose_parent_task: new_children must be non-empty (got %)', v_count;
  end if;

  -- 3. 新規子を base_stack_order, base+1, ..., base+N-1 で順に insert
  for v_idx in 0 .. v_count - 1 loop
    v_child := p_new_children -> v_idx;
    insert into public.tasks (
      user_id,
      project_id,
      parent_task_id,
      depends_on_event_id,
      title,
      body,
      estimated_minutes,
      task_category,
      stack_order,
      decompose_status
    ) values (
      v_user_id,
      v_project_id,
      p_parent_id,
      v_depends_on_event_id,
      v_child ->> 'title',
      coalesce(v_child ->> 'body', ''),
      nullif(v_child ->> 'estimated_minutes', '')::integer,
      nullif(v_child ->> 'task_category', '')::text,
      p_base_stack_order + v_idx,
      'none'::public.decompose_status
    )
    returning id into v_new_id;

    v_new_ids := array_append(v_new_ids, v_new_id);
  end loop;

  -- 4. 親の decompose_status を 'decomposed' に倒す (ADR 0021 の終端 status)
  update public.tasks
     set decompose_status = 'decomposed'::public.decompose_status
   where id = p_parent_id;

  return v_new_ids;
end;
$$;

comment on function public.fn_decompose_parent_task(uuid, integer, jsonb) is
  'Issue #150 / ADR 0021: AI 分解の子 insert + 親 decompose_status 更新を 1 トランザクション化。security invoker (RLS 適用)。';
