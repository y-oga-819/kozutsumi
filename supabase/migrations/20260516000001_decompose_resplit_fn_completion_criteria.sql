-- kozutsumi (issue #246): fn_decompose_parent_task / fn_resplit_child_task を完了条件対応に更新
--
-- References:
-- * docs/adr/0066-decompose-completion-criteria-deliverable-done-first-step.md
--   (完了条件 schema = deliverable / done / first_step)
-- * supabase/migrations/20260516000000_completion_criteria_columns.sql (列追加)
-- * supabase/migrations/20260505000000_p3_204_decompose_global_stack_order.sql (旧 fn v3)
--
-- 変更点:
-- * `p_new_children` jsonb の各要素に `deliverable` / `done` / `first_step` を追加
--   (旧: title / body / estimated_minutes / task_category / task_size)
-- * 子 insert 時に 3 列も埋める。body と同じく `coalesce(v_child ->> 'x', '')` で
--   キー欠損を空文字に倒す (NOT NULL DEFAULT '' 列なので欠損は空文字が正)。
--
-- 後方互換: 呼び出し側が 3 キーを渡さない場合は coalesce で空文字になり、列の
-- NOT NULL DEFAULT '' と整合する。stack_order の global shift ロジック (ADR 0047) は v3 のまま。

-- =====================================================================
-- fn_decompose_parent_task v4 (ADR 0066: completion criteria)
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

  -- 3. ADR 0047: 同一 user 内で stack_order > p_base_stack_order のすべての task を
  --    v_count だけシフト。子と親兄弟が同じ視覚平面に並ぶため、shift も user スコープ全体。
  update public.tasks
     set stack_order = stack_order + v_count
   where user_id = v_user_id
     and stack_order > p_base_stack_order
     and id <> p_parent_id;

  -- 4. 新規子を p_base_stack_order+1, +2, ..., +N で順に insert (= 親の直後)
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
      deliverable,
      done,
      first_step,
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
      coalesce(v_child ->> 'deliverable', ''),
      coalesce(v_child ->> 'done', ''),
      coalesce(v_child ->> 'first_step', ''),
      p_base_stack_order + 1 + v_idx,
      'none'::public.decompose_status
    )
    returning id into v_new_id;

    v_new_ids := array_append(v_new_ids, v_new_id);
  end loop;

  -- 5. 親の decompose_status を 'decomposed' に倒す (ADR 0021 の終端 status)
  update public.tasks
     set decompose_status = 'decomposed'::public.decompose_status
   where id = p_parent_id;

  return v_new_ids;
end;
$$;

comment on function public.fn_decompose_parent_task(uuid, integer, jsonb) is
  'Issue #246 / ADR 0021 / 0047 / 0066: AI 分解の子 insert + 親 decompose_status 更新を 1 トランザクション化。完了条件 (deliverable / done / first_step) 対応。security invoker (RLS 適用)。';

-- =====================================================================
-- fn_resplit_child_task v4 (ADR 0066: completion criteria)
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

  -- 2.1 HC-3 (並び順決定論性) の SQL 防衛層: caller が渡す shift_amount は new_children 数 - 1
  --     と一致しなければならない (= 元の target 1 件を消した分だけ後続が前にずれる)。
  if p_shift_amount <> v_count - 1 then
    raise exception 'fn_resplit_child_task: shift_amount (%) must equal new_children length (%) - 1',
      p_shift_amount, v_count;
  end if;

  -- 3. ADR 0047: 同一 user 内で stack_order > base のすべての task を p_shift_amount シフト。
  if p_shift_amount > 0 then
    update public.tasks
       set stack_order = stack_order + p_shift_amount
     where user_id = v_user_id
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
      deliverable,
      done,
      first_step,
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
      coalesce(v_child ->> 'deliverable', ''),
      coalesce(v_child ->> 'done', ''),
      coalesce(v_child ->> 'first_step', ''),
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
  'Issue #246 / ADR 0027 / 0047 / 0066: 子タスクの再分解 flatten。完了条件 (deliverable / done / first_step) 対応。security invoker (RLS 適用)。';
