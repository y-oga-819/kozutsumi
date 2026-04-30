-- kozutsumi Phase 3 派生 (issue #121): 子タスクの再分解 flatten 用 RPC
--
-- References:
-- * docs/adr/0027-child-resplit-flatten.md (flatten + 元の子物理 delete)
-- * docs/adr/0028-child-resplit-stack-order-strategy.md (整数 stack_order + 後続シフト)
-- * docs/adr/0030-child-resplit-action-log.md (action_log は別経路で記録)
--
-- 本 migration が決めること:
-- 1. fn_resplit_child_task PL/pgSQL function を新設
--    delete 元の子 + insert 新規子 + 後続兄弟の stack_order シフトを 1 トランザクションで行う
-- 2. action_logs への記録は呼び出し側 (resplit-server.ts) で行う
--    (RPC 内で log すると失敗時のロールバック範囲が広がる + 学習素材の主要属性
--     は呼び出し側でしか取れないため)

-- =====================================================================
-- fn_resplit_child_task
-- =====================================================================
--
-- 引数:
--   p_target_id         : 再分解対象の子 task id (削除される)
--   p_parent_id         : 元の親 task id (新規子も同じ親に紐付く = HC-1 flatten)
--   p_base_stack_order  : 元の子の stack_order (新規子の先頭がこの位置を引き継ぐ)
--   p_shift_amount      : 後続兄弟をシフトする量 (= 新規子数 - 1、HC-3 並び順決定論性)
--   p_new_children      : 新規子の配列 (jsonb)。各要素は
--                         { title, body, estimated_minutes, task_category } を持つ
--
-- 戻り値:
--   uuid[]              : 新規子の id 配列 (jsonb 入力順 = stack_order 昇順)
--
-- security invoker: RLS で auth.uid() 一致のみ許可 (kozutsumi の Phase 1 方針 / ADR 0001)。
-- 別ユーザーの行は select / update / delete / insert すべてが 0 行扱いで弾かれる。
--
-- 順序:
--   1. 削除対象 row から user_id / project_id / depends_on_event_id を取得 (継承用)
--   2. 後続兄弟 (stack_order > base) を p_shift_amount だけシフト (target は除外)
--   3. 削除対象 row を delete (これで base_stack_order 位置が空く)
--   4. 新規子を base_stack_order, base+1, ..., base+N-1 で連続 insert
--
-- ステップ 2 と 3 を入れ替えても外から見える結果は同じだが、`(parent_task_id, stack_order)`
-- に将来 unique 制約を入れる場合に備えて「target を消してから新規子を入れる」順を維持する。

create or replace function public.fn_resplit_child_task(
  p_target_id uuid,
  p_parent_id uuid,
  p_base_stack_order integer,
  p_shift_amount integer,
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
  -- 1. target row の継承用属性を取得
  select user_id, project_id, depends_on_event_id
    into v_user_id, v_project_id, v_depends_on_event_id
    from public.tasks
   where id = p_target_id;

  if v_user_id is null then
    raise exception 'fn_resplit_child_task: target task not found or not authorized: %', p_target_id;
  end if;

  -- 2. 新規子配列のサイズを確認 (空配列禁止)
  v_count := jsonb_array_length(p_new_children);
  if v_count < 1 then
    raise exception 'fn_resplit_child_task: new_children must be non-empty (got %)', v_count;
  end if;

  -- 3. 後続兄弟 (stack_order > base) を p_shift_amount だけシフト
  --    target 自身は除外 (target は base_stack_order なので条件 stack_order > base に
  --    そもそも該当しないが、defense-in-depth で id != p_target_id も付ける)
  if p_shift_amount > 0 then
    update public.tasks
       set stack_order = stack_order + p_shift_amount
     where parent_task_id = p_parent_id
       and stack_order > p_base_stack_order
       and id <> p_target_id;
  end if;

  -- 4. target を delete (base_stack_order 位置を空ける)
  delete from public.tasks where id = p_target_id;

  -- 5. 新規子を base_stack_order, base+1, ..., base+N-1 で順に insert
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

  return v_new_ids;
end;
$$;

comment on function public.fn_resplit_child_task(uuid, uuid, integer, integer, jsonb) is
  'ADR 0027 / 0028 / Issue #121: 子タスクの再分解 flatten。target を delete + 新規子を base_stack_order から連続 insert + 後続兄弟をシフト。security invoker (RLS 適用)。';
