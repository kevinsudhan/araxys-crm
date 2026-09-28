-- Every PL/pgSQL function in public, checked against the live schema by
-- plpgsql_check: a table, column or function a body names that no longer
-- exists, a wrong type, a missing RETURN. Postgres checks only the syntax when
-- a function is created, so a column dropped later breaks it silently until
-- it runs. Installs the extension for the one transaction and rolls it all
-- back: the findings come back in the error.
--
--   node supabase-v2/run-sql.mjs ../scripts/audit/plpgsql-check.sql   (or q.mjs @file)
do $t$
declare
  r     jsonb := '[]'::jsonb;
  n     int := 0;
  f     record;
  e     record;
  v_rel oid;
begin
  create extension if not exists plpgsql_check;
  for f in
    select p.oid, p.proname, p.prorettype = 'trigger'::regtype as is_trigger
      from pg_proc p join pg_language l on l.oid = p.prolang
     where l.lanname = 'plpgsql' and p.pronamespace = 'public'::regnamespace
     order by p.proname
  loop
    n := n + 1;
    v_rel := 0;
    if f.is_trigger then
      select t.tgrelid into v_rel from pg_trigger t where t.tgfoid = f.oid and not t.tgisinternal limit 1;
      if v_rel is null then
        r := r || jsonb_build_object('fn', f.proname, 'msg', 'trigger function attached to no trigger');
        continue;
      end if;
    end if;
    begin
      for e in
        select * from plpgsql_check_function_tb(f.oid, v_rel,
                 fatal_errors => false, other_warnings => false, performance_warnings => false, extra_warnings => false)
      loop
        r := r || jsonb_build_object('fn', f.proname, 'line', e.lineno, 'level', e.level, 'msg', e.message, 'stmt', e.statement);
      end loop;
    exception when others then
      r := r || jsonb_build_object('fn', f.proname, 'msg', 'check failed: ' || sqlerrm);
    end;
  end loop;
  raise exception 'RESULTS %', jsonb_build_object('checked', n, 'findings', r)::text;
end $t$;
