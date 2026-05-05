-- kozutsumi (Issue #204 / PR #205 / ADR 0047): 分解 / 再分解時の stack_order shift scope を
-- ユーザースコープ全体に広げる。併せて既存データを視覚順に揃える data migration を実行する。
--
-- References:
-- * docs/adr/0047-decompose-resplit-shift-scope-global.md (本判断)
-- * docs/adr/0028-child-resplit-stack-order-strategy.md (整数 stack_order + 後続シフトの基本方針 / 部分的に supersede)
-- * supabase/migrations/20260504000001_p3_decompose_resplit_fn_task_size.sql (旧 fn_*)
-- * Issue #204: AI 分解後に親兄弟と子が交互に並ぶ + reorder で挿入できない
--
-- 変更点:
-- 1. fn_decompose_parent_task: 親 P (stack=K) を分解する時、同一 user_id で stack > K の
--    すべての task を +N シフトしてから子を K+1..K+N で insert (旧: 子を K..K+N-1 で insert
--    のみ、親兄弟との衝突を考慮しない)。親自身は K のまま。
-- 2. fn_resplit_child_task: 同一 user_id で stack > target.stack_order のすべての task を
--    シフト (旧: parent_task_id = target.parent_task_id だけシフト)。視覚平面が user 全体で
--    flatten されるため、shift スコープも user 全体に揃える。
-- 3. data migration: 既存の decomposed 親 + 子の stack_order を視覚順 (PR #205 の集約ロジック
--    で見えていた順) に揃え直す。トップレベルを stack 順に並べ、decomposed 親の直後にその子
--    を stack 順で連続させる。

-- =====================================================================
-- fn_decompose_parent_task v3 (ADR 0047: global shift)
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
  --    parent 自身は除外 (parent.stack_order = p_base_stack_order なので条件に該当しない
  --    が defense-in-depth で id != p_parent_id も付ける)。
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
  'Issue #204 / ADR 0047: AI 分解の子 insert + 親 decompose_status 更新を 1 トランザクション化。同一 user 内で親より後ろの全 task を後続シフト。security invoker (RLS 適用)。';

-- =====================================================================
-- fn_resplit_child_task v3 (ADR 0047: global shift)
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
  --    target 自身は除外 (target は base 位置なので条件 stack_order > base に該当しないが
  --    defense-in-depth で id != p_target_id も付ける)。
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
  'Issue #204 / ADR 0027 / 0047: 子タスクの再分解 flatten。同一 user 内で target より後ろの全 task を後続シフト。security invoker (RLS 適用)。';

-- =====================================================================
-- data migration: 既存 decomposed 親 + 子の stack_order を視覚順に振り直す
-- =====================================================================
--
-- 旧 fn_decompose_parent_task は子を「親の stack_order から連番」で振っていたため、
-- トップレベル親の兄弟と stack_order が衝突する状態が DB 上に残っている可能性がある。
-- PR #205 のレンダリング集約は廃止したため、DB 側で視覚順 (= PR #205 の集約ロジックで
-- 見えていた順) に合わせて stack_order を 0..n-1 で振り直す。
--
-- 手順 (per user):
--   1. parent_task_id IS NULL の task を旧 stack_order, created_at 昇順で walk
--   2. 各 task に新 stack_order を付与 (counter++)
--   3. その task が decomposed なら、その子を旧 stack_order, created_at 昇順で walk して
--      連続する新 stack_order を付与
--   4. 最後に、上記で処理されなかった子 (親が pending に存在しない / 親が decomposed でない
--      不整合系) を旧順序で末尾に並べる
--
-- 算出した新 stack_order は一旦 temp table に貯め、最後に 1 文 update で適用する
-- (in-place 更新だと walk 中に順序が変わる)。security definer で実行 (migration runner は
-- postgres ロール) なので RLS は無視され全 user を走査する。

do $$
declare
  v_user_id uuid;
  v_top record;
  v_child record;
  v_orphan record;
  v_new_order int;
begin
  create temp table _migrate_204_new_orders (
    id uuid primary key,
    new_order int not null
  ) on commit drop;

  for v_user_id in select distinct user_id from public.tasks loop
    v_new_order := 0;

    for v_top in
      select id, decompose_status
        from public.tasks
       where user_id = v_user_id
         and parent_task_id is null
       order by stack_order nulls last, created_at
    loop
      insert into _migrate_204_new_orders (id, new_order) values (v_top.id, v_new_order);
      v_new_order := v_new_order + 1;

      if v_top.decompose_status = 'decomposed' then
        for v_child in
          select id
            from public.tasks
           where user_id = v_user_id
             and parent_task_id = v_top.id
           order by stack_order nulls last, created_at
        loop
          insert into _migrate_204_new_orders (id, new_order) values (v_child.id, v_new_order);
          v_new_order := v_new_order + 1;
        end loop;
      end if;
    end loop;

    -- 親が pending top に存在しない / 親が decomposed でない子 (不整合系) は末尾に。
    -- buildStackItems が leaf-child としてレンダリングする可能性があるので落とさない。
    for v_orphan in
      select t.id
        from public.tasks t
       where t.user_id = v_user_id
         and t.parent_task_id is not null
         and not exists (select 1 from _migrate_204_new_orders m where m.id = t.id)
       order by t.stack_order nulls last, t.created_at
    loop
      insert into _migrate_204_new_orders (id, new_order) values (v_orphan.id, v_new_order);
      v_new_order := v_new_order + 1;
    end loop;
  end loop;

  -- 一括 update
  update public.tasks t
     set stack_order = m.new_order
    from _migrate_204_new_orders m
   where t.id = m.id;
end $$;
