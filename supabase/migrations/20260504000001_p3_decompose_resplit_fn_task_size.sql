-- kozutsumi (issue #169): fn_decompose_parent_task / fn_resplit_child_task を task_size 対応に更新
--
-- References:
-- * docs/adr/0038-task-size-enum.md (task_size を AI 分解の出力スキーマに含める)
-- * supabase/migrations/20260503000000_p3_decompose_parent_task_fn.sql (旧版)
-- * supabase/migrations/20260430230402_p3_resplit_child_task_fn.sql (旧版)
-- * supabase/migrations/20260504000000_task_size.sql (列追加)
--
-- 変更点:
-- * `p_new_children` jsonb の各要素に `task_size` を追加 (旧: title / body / estimated_minutes / task_category)
-- * 子 insert 時に `task_size` 列も埋める (`nullif(...)::text` で空文字を null に倒す)
--
-- 後方互換: 呼び出し側 (decompose-server.ts / resplit-server.ts) が `task_size` を渡さない場合は
-- `v_child ->> 'task_size'` が null になり、`nullif(null, '')` も null。CHECK 制約も nullable を
-- 許容するので壊れない。

-- =====================================================================
-- fn_decompose_parent_task v2 (task_size 対応)
-- =====================================================================

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
      task_size,
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
      nullif(v_child ->> 'task_size', '')::text,
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
  'Issue #150 / #169 / ADR 0021 / ADR 0038: AI 分解の子 insert + 親 decompose_status 更新を 1 トランザクション化。task_size 対応。security invoker (RLS 適用)。';

-- =====================================================================
-- fn_resplit_child_task v2 (task_size 対応)
-- =====================================================================

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
  v_target_parent_id uuid;
  v_idx int;
  v_count int;
  v_child jsonb;
  v_new_id uuid;
  v_new_ids uuid[] := '{}';
begin
  -- 1. target row の継承用属性を取得 (parent_task_id も併せて取り、HC-1 検証に使う)
  select user_id, project_id, depends_on_event_id, parent_task_id
    into v_user_id, v_project_id, v_depends_on_event_id, v_target_parent_id
    from public.tasks
   where id = p_target_id;

  if v_user_id is null then
    raise exception 'fn_resplit_child_task: target task not found or not authorized: %', p_target_id;
  end if;

  -- 1.1 HC-1 (孫禁止) の SQL 防衛層
  if v_target_parent_id is null or v_target_parent_id <> p_parent_id then
    raise exception 'fn_resplit_child_task: HC-1 violation: target.parent_task_id (%) does not match p_parent_id (%)',
      v_target_parent_id, p_parent_id;
  end if;

  -- 2. 新規子配列のサイズを確認 (空配列禁止)
  v_count := jsonb_array_length(p_new_children);
  if v_count < 1 then
    raise exception 'fn_resplit_child_task: new_children must be non-empty (got %)', v_count;
  end if;

  -- 2.1 HC-3 (並び順決定論性) の SQL 防衛層
  if p_shift_amount <> v_count - 1 then
    raise exception 'fn_resplit_child_task: shift_amount (%) must equal new_children length (%) - 1',
      p_shift_amount, v_count;
  end if;

  -- 3. 後続兄弟 (stack_order > base) を p_shift_amount だけシフト
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
      task_size,
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
      nullif(v_child ->> 'task_size', '')::text,
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
  'ADR 0027 / 0028 / 0038 / Issue #121 / #169: 子タスクの再分解 flatten。task_size 対応。security invoker (RLS 適用)。';
