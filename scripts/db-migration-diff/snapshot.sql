-- public schema の構造化スナップショットを 1 行 JSON で出力する。
-- 出力先: stdout (psql -At で囲わずに JSON 1 行が出る)
--
-- 対象は public schema のみ (auth / storage / supabase_* は触らない)。
-- 本ファイルは scripts/db-migration-diff/snapshot.sh から呼ばれる。
--
-- 構造はおおよそ:
--   {
--     "tables":      [{ schema, table, rls_enabled, rls_forced }],
--     "columns":     [{ schema, table, column, type, udt, nullable, default, ordinal }],
--     "constraints": [{ schema, table, name, type, definition }],
--     "foreign_keys":[{ schema, table, name, columns, ref_schema, ref_table, ref_columns, delete_rule, update_rule }],
--     "indexes":     [{ schema, table, name, definition }],
--     "policies":    [{ schema, table, name, permissive, roles, command, using, with_check }],
--     "enums":       [{ schema, name, values }]
--   }

with
  tables as (
    select coalesce(json_agg(t order by t->>'schema', t->>'table'), '[]'::json) as data
    from (
      select json_build_object(
        'schema', n.nspname,
        'table', c.relname,
        'rls_enabled', c.relrowsecurity,
        'rls_forced', c.relforcerowsecurity
      ) as t
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
    ) sub
  ),
  columns as (
    select coalesce(json_agg(c order by c->>'schema', c->>'table', (c->>'ordinal')::int), '[]'::json) as data
    from (
      select json_build_object(
        'schema', table_schema,
        'table', table_name,
        'column', column_name,
        'type', data_type,
        'udt', udt_name,
        'nullable', is_nullable,
        'default', column_default,
        'ordinal', ordinal_position
      ) as c
      from information_schema.columns
      where table_schema = 'public'
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
  )
select json_build_object(
  'tables', (select data from tables),
  'columns', (select data from columns),
  'constraints', (select data from constraints),
  'foreign_keys', (select data from foreign_keys),
  'indexes', (select data from indexes),
  'policies', (select data from policies),
  'enums', (select data from enums)
);
