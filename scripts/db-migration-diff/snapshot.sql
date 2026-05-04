-- public schema の構造化スナップショットを 1 行 JSON で出力する。
-- 出力先: stdout (psql -At で囲わずに JSON 1 行が出る)
--
-- 対象は public schema のみ (auth / storage / supabase_* は触らない)。
-- 本ファイルは scripts/db-migration-diff/snapshot.sh から呼ばれる。
--
-- 構造はおおよそ:
--   {
--     "tables":      [{ schema, table, kind, rls_enabled, rls_forced }],
--     "columns":     [{ schema, table, kind, column, type, udt, nullable, default, ordinal }],
--     "constraints": [{ schema, table, name, type, definition }],
--     "foreign_keys":[{ schema, table, name, columns, ref_schema, ref_table, ref_columns, delete_rule, update_rule }],
--     "indexes":     [{ schema, table, name, definition }],
--     "policies":    [{ schema, table, name, permissive, roles, command, using, with_check }],
--     "enums":       [{ schema, name, values }],
--     "views":       [{ schema, name, kind, definition, security_invoker, security_barrier }],
--     "functions":   [{ schema, name, args, return_type, body, security_definer, volatility, comment }],
--     "triggers":    [{ schema, table, name, function_name, timing, event, level, comment }]
--   }
--
-- `tables` は relkind in ('r','v','m') を含むので「table / view / matview を一律
-- 列挙したい」用途には tables を、view 専用の検査 (security_invoker 等) には views を使う。

with
  tables as (
    select coalesce(json_agg(t order by t->>'schema', t->>'table'), '[]'::json) as data
    from (
      select json_build_object(
        'schema', n.nspname,
        'table', c.relname,
        'kind', case c.relkind
          when 'r' then 'table'
          when 'v' then 'view'
          when 'm' then 'matview'
        end,
        'rls_enabled', c.relrowsecurity,
        'rls_forced', c.relforcerowsecurity
      ) as t
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'v', 'm')
    ) sub
  ),
  views as (
    -- view / matview の定義 + 主要 reloptions を抜く。security_invoker は PG 15+ の
    -- view option で、未指定だと definer (= view 所有者) 権限で評価され RLS をバイパスする。
    -- kozutsumi では原則 security_invoker = true を要求する。
    select coalesce(json_agg(v order by v->>'schema', v->>'name'), '[]'::json) as data
    from (
      select json_build_object(
        'schema', n.nspname,
        'name', c.relname,
        'kind', case c.relkind when 'v' then 'view' when 'm' then 'matview' end,
        'definition', pg_get_viewdef(c.oid, true),
        'security_invoker', coalesce(
          (select option_value::boolean
           from pg_options_to_table(c.reloptions)
           where option_name = 'security_invoker'),
          false
        ),
        'security_barrier', coalesce(
          (select option_value::boolean
           from pg_options_to_table(c.reloptions)
           where option_name = 'security_barrier'),
          false
        )
      ) as v
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('v', 'm')
    ) sub
  ),
  columns as (
    -- information_schema.columns は view / matview の列も含む。compare.mjs 側で
    -- 「既存テーブルへのカラム追加」判定をする時に view 由来を除外できるよう、
    -- pg_class から relkind を join して kind ('table' / 'view' / 'matview') を付与する。
    -- comment は migration safety marker (`@migration-safe-not-null` 等) を compare.mjs
    -- が読み取れるように含める。COMMENT ON COLUMN で付与した文字列が入る。
    select coalesce(json_agg(c order by c->>'schema', c->>'table', (c->>'ordinal')::int), '[]'::json) as data
    from (
      select json_build_object(
        'schema', col.table_schema,
        'table', col.table_name,
        'kind', case cls.relkind
          when 'r' then 'table'
          when 'v' then 'view'
          when 'm' then 'matview'
        end,
        'column', col.column_name,
        'type', col.data_type,
        'udt', col.udt_name,
        'nullable', col.is_nullable,
        'default', col.column_default,
        'ordinal', col.ordinal_position,
        'comment', col_description(cls.oid, col.ordinal_position::int)
      ) as c
      from information_schema.columns col
      join pg_namespace ns on ns.nspname = col.table_schema
      join pg_class cls on cls.relname = col.table_name and cls.relnamespace = ns.oid
      where col.table_schema = 'public' and cls.relkind in ('r', 'v', 'm')
    ) sub
  ),
  constraints as (
    select coalesce(json_agg(k order by k->>'schema', k->>'table', k->>'name'), '[]'::json) as data
    from (
      select json_build_object(
        'schema', n.nspname,
        'table', cl.relname,
        'name', con.conname,
        'type', con.contype::text,
        'definition', pg_get_constraintdef(con.oid)
      ) as k
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
      where n.nspname = 'public'
    ) sub
  ),
  foreign_keys as (
    select coalesce(json_agg(f order by f->>'schema', f->>'table', f->>'name'), '[]'::json) as data
    from (
      select json_build_object(
        'schema', n.nspname,
        'table', cl.relname,
        'name', con.conname,
        'columns', (
          select json_agg(att.attname order by u.ord)
          from unnest(con.conkey) with ordinality as u(attnum, ord)
          join pg_attribute att on att.attrelid = con.conrelid and att.attnum = u.attnum
        ),
        'ref_schema', rn.nspname,
        'ref_table', rcl.relname,
        'ref_columns', (
          select json_agg(att.attname order by u.ord)
          from unnest(con.confkey) with ordinality as u(attnum, ord)
          join pg_attribute att on att.attrelid = con.confrelid and att.attnum = u.attnum
        ),
        'delete_rule', case con.confdeltype
          when 'a' then 'NO ACTION'
          when 'r' then 'RESTRICT'
          when 'c' then 'CASCADE'
          when 'n' then 'SET NULL'
          when 'd' then 'SET DEFAULT'
        end,
        'update_rule', case con.confupdtype
          when 'a' then 'NO ACTION'
          when 'r' then 'RESTRICT'
          when 'c' then 'CASCADE'
          when 'n' then 'SET NULL'
          when 'd' then 'SET DEFAULT'
        end
      ) as f
      from pg_constraint con
      join pg_class cl on cl.oid = con.conrelid
      join pg_namespace n on n.oid = cl.relnamespace
      join pg_class rcl on rcl.oid = con.confrelid
      join pg_namespace rn on rn.oid = rcl.relnamespace
      where n.nspname = 'public' and con.contype = 'f'
    ) sub
  ),
  indexes as (
    select coalesce(json_agg(i order by i->>'schema', i->>'table', i->>'name'), '[]'::json) as data
    from (
      select json_build_object(
        'schema', schemaname,
        'table', tablename,
        'name', indexname,
        'definition', indexdef
      ) as i
      from pg_indexes
      where schemaname = 'public'
    ) sub
  ),
  policies as (
    select coalesce(json_agg(p order by p->>'schema', p->>'table', p->>'name'), '[]'::json) as data
    from (
      select json_build_object(
        'schema', schemaname,
        'table', tablename,
        'name', policyname,
        'permissive', permissive,
        'roles', to_json(roles),
        'command', cmd,
        'using', qual,
        'with_check', with_check
      ) as p
      from pg_policies
      where schemaname = 'public'
    ) sub
  ),
  enums as (
    select coalesce(json_agg(e order by e->>'schema', e->>'name'), '[]'::json) as data
    from (
      select json_build_object(
        'schema', n.nspname,
        'name', t.typname,
        'values', json_agg(e.enumlabel order by e.enumsortorder)
      ) as e
      from pg_type t
      join pg_enum e on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
      where n.nspname = 'public'
      group by n.nspname, t.typname
    ) sub
  ),
  functions as (
    -- 関数 / トリガー関数の定義 + 主要属性。security_definer は postgres の SECURITY DEFINER
    -- フラグで、true だと所有者権限で実行され RLS を迂回する。kozutsumi では原則
    -- SECURITY INVOKER (= prosecdef = false) を要求する。
    -- 同名異シグネチャを別関数として扱うため key には pg_get_function_arguments を含める。
    select coalesce(json_agg(f order by f->>'schema', f->>'name', f->>'args'), '[]'::json) as data
    from (
      select json_build_object(
        'schema', n.nspname,
        'name', p.proname,
        'args', pg_get_function_arguments(p.oid),
        'return_type', pg_get_function_result(p.oid),
        'body', p.prosrc,
        'security_definer', p.prosecdef,
        'volatility', case p.provolatile
          when 'i' then 'immutable'
          when 's' then 'stable'
          when 'v' then 'volatile'
        end,
        'comment', obj_description(p.oid, 'pg_proc')
      ) as f
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
    ) sub
  ),
  triggers as (
    -- ユーザー定義 trigger のみ (tgisinternal = false で内部 FK trigger 等を除外)。
    -- tgtype は bitmask: 1=ROW, 2=BEFORE, 4=INSERT, 8=DELETE, 16=UPDATE, 32=TRUNCATE, 64=INSTEAD OF
    -- (BEFORE / INSTEAD OF どちらでもなければ AFTER)。event は複数同時指定可能なので配列で出す。
    select coalesce(json_agg(t order by t->>'schema', t->>'table', t->>'name'), '[]'::json) as data
    from (
      select json_build_object(
        'schema', n.nspname,
        'table', cl.relname,
        'name', tg.tgname,
        'function_name', pn.nspname || '.' || pp.proname,
        'timing', case
          when (tg.tgtype & 64) <> 0 then 'INSTEAD OF'
          when (tg.tgtype & 2) <> 0 then 'BEFORE'
          else 'AFTER'
        end,
        'event', (
          select coalesce(json_agg(ev order by ev), '[]'::json)
          from (values
            (case when (tg.tgtype & 4) <> 0 then 'INSERT' end),
            (case when (tg.tgtype & 8) <> 0 then 'DELETE' end),
            (case when (tg.tgtype & 16) <> 0 then 'UPDATE' end),
            (case when (tg.tgtype & 32) <> 0 then 'TRUNCATE' end)
          ) as v(ev)
          where ev is not null
        ),
        'level', case when (tg.tgtype & 1) <> 0 then 'ROW' else 'STATEMENT' end,
        'comment', obj_description(tg.oid, 'pg_trigger')
      ) as t
      from pg_trigger tg
      join pg_class cl on cl.oid = tg.tgrelid
      join pg_namespace n on n.oid = cl.relnamespace
      join pg_proc pp on pp.oid = tg.tgfoid
      join pg_namespace pn on pn.oid = pp.pronamespace
      where n.nspname = 'public' and tg.tgisinternal = false
    ) sub
  )
select json_build_object(
  'tables', (select data from tables),
  'columns', (select data from columns),
  'constraints', (select data from constraints),
  'foreign_keys', (select data from foreign_keys),
  'indexes', (select data from indexes),
  'policies', (select data from policies),
  'enums', (select data from enums),
  'views', (select data from views),
  'functions', (select data from functions),
  'triggers', (select data from triggers)
);
