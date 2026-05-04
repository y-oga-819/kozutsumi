-- kozutsumi calendar 拡張 (Issue #144) Layer 2 atomic toggle 用 RPC
--
-- ADR 0034 L6/L7 で確定した「auto_promote 切替時、過去 event を旧 default で固定」を
-- subscription update + events bulk update で 1 トランザクションにまとめる PL/pgSQL function。
--
-- References:
-- * docs/adr/0031-calendar-subscription-and-event-promotion.md
-- * docs/adr/0032-events-visibility-override-physical-model.md
-- * docs/adr/0034-calendar-subscription-lifecycle.md  (L6 / L7)
-- * docs/adr/0035-action-log-payload-schema-and-actor-type.md  (`event_visibility_frozen_by_subscription_toggle`)
-- * supabase/migrations/20260503100000_p3_159_calendar_ext_schema.sql (subscription / events.visibility_override)

-- =====================================================================
-- fn_set_subscription_auto_promote
-- =====================================================================
--
-- 引数:
--   p_subscription_id : 対象 user_calendar_subscriptions.id
--   p_new_value       : 新しい auto_promote_to_timeline (true / false)
--
-- 戻り値 (jsonb):
--   {
--     "changed": boolean,            -- 値が実際に変わったか
--     "from": boolean,               -- 旧値
--     "to": boolean,                 -- 新値
--     "source": text,                -- subscription.source
--     "external_account_id": text,   -- external_accounts.external_account_id
--     "external_calendar_id": text,  -- subscription.external_calendar_id
--     "frozen_to": text|null,        -- 'shown' / 'hidden' / null (changed=false 時)
--     "frozen_events": [             -- 旧 default で固定した過去 event 一覧
--       { "external_id": "...", "title": "...", "start_time": "...", "end_time": "..." }
--     ]
--   }
--
-- 動作 (ADR 0034 L6/L7):
--   1. subscription を SELECT (RLS で別 user は 0 行 → not found エラー)
--   2. auto_promote_to_timeline = p_new_value で UPDATE
--   3. 値に変化があった場合、旧 default = (旧 auto_promote ? 'shown' : 'hidden') を計算
--   4. start_time < now() AND visibility_override = 'none' AND
--      (source, external_calendar_id) が subscription と一致する events を旧 default で UPDATE
--   5. UPDATE で固定した event の triple + snapshot 部分を返却 (action_log で system actor が記録)
--
-- 既に override されている event (visibility_override != 'none') は触らない。
-- 未来 event は更新しない (新 default に追従、visibility_override='none' のまま)。
-- external_account_id 列は subscription に直接無いので external_accounts と JOIN して取る
-- (action_log の triple metadata は source 内識別子 = external_accounts.external_account_id を使う)。
--
-- security invoker: subscription / events / external_accounts の RLS が user_id 一致を保証する。
-- 別ユーザーの subscription_id を渡しても RLS で 0 行扱いになり not found エラーになる。

create or replace function public.fn_set_subscription_auto_promote(
  p_subscription_id uuid,
  p_new_value boolean
) returns jsonb
language plpgsql
security invoker
as $$
declare
  v_user_id uuid;
  v_old_value boolean;
  v_source public.event_source;
  v_external_account_uuid uuid;
  v_external_account_id text;
  v_external_calendar_id text;
  v_frozen_to public.event_visibility_override;
  v_frozen_events jsonb;
begin
  -- 1. subscription の現状を取得
  select s.user_id, s.auto_promote_to_timeline, s.source, s.external_account_id, s.external_calendar_id
    into v_user_id, v_old_value, v_source, v_external_account_uuid, v_external_calendar_id
    from public.user_calendar_subscriptions s
   where s.id = p_subscription_id;

  if v_user_id is null then
    raise exception 'fn_set_subscription_auto_promote: subscription not found or not authorized: %', p_subscription_id;
  end if;

  -- 2. external_accounts の identifier (text) を取得 (action_log triple の middle id)
  select ea.external_account_id
    into v_external_account_id
    from public.external_accounts ea
   where ea.id = v_external_account_uuid;

  if v_external_account_id is null then
    raise exception 'fn_set_subscription_auto_promote: external_account row missing for id %', v_external_account_uuid;
  end if;

  -- 3. 値が変わらないなら何もしない (idempotent)
  if v_old_value is not distinct from p_new_value then
    return jsonb_build_object(
      'changed', false,
      'from', v_old_value,
      'to', p_new_value,
      'source', v_source::text,
      'external_account_id', v_external_account_id,
      'external_calendar_id', v_external_calendar_id,
      'frozen_to', null,
      'frozen_events', '[]'::jsonb
    );
  end if;

  -- 4. subscription を新値に更新
  update public.user_calendar_subscriptions
     set auto_promote_to_timeline = p_new_value
   where id = p_subscription_id;

  -- 5. 旧 default を確定 (既存挙動: 旧 auto_promote=true → 'shown' / false → 'hidden')
  v_frozen_to := case when v_old_value then 'shown' else 'hidden' end::public.event_visibility_override;

  -- 6. 過去 event のうち visibility_override='none' のものを旧 default で固定。
  --    subscription と (source, external_calendar_id) が一致する events のみ。
  --    user_id は subscription 由来 (RLS でも保護される)。
  with frozen as (
    update public.events e
       set visibility_override = v_frozen_to
     where e.user_id = v_user_id
       and e.source = v_source
       and e.external_calendar_id = v_external_calendar_id
       and e.visibility_override = 'none'::public.event_visibility_override
       and e.start_time < now()
       and e.external_id is not null
    returning e.external_id, e.title, e.start_time, e.end_time
  )
  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'external_id', frozen.external_id,
               'title', frozen.title,
               'start_time', frozen.start_time,
               'end_time', frozen.end_time
             )
             order by frozen.start_time
           ),
           '[]'::jsonb
         )
    into v_frozen_events
    from frozen;

  return jsonb_build_object(
    'changed', true,
    'from', v_old_value,
    'to', p_new_value,
    'source', v_source::text,
    'external_account_id', v_external_account_id,
    'external_calendar_id', v_external_calendar_id,
    'frozen_to', v_frozen_to::text,
    'frozen_events', v_frozen_events
  );
end;
$$;

comment on function public.fn_set_subscription_auto_promote(uuid, boolean) is
  'Issue #144 / ADR 0034 L6/L7: subscription auto_promote 切替 + 過去 event 旧 default 固定を atomic 化。security invoker (RLS 適用)。';
