-- Data integrity on the live project: every check is a SELECT, and the whole
-- report comes back as one JSON row. A healthy database answers with every
-- list empty and every "ok" true.
--
--   node <q.mjs> "@scripts/audit/integrity.sql"
with
-- The number generators must be ahead of every number already used, or the
-- next insert collides with an existing row.
seqs as (
  select jsonb_agg(x) filter (where not x.ok) as behind, count(*) as checked from (
    select 'shipment_no_seq' as seq, pg_sequence_last_value('public.shipment_no_seq') as at,
           (select max(nullif(regexp_replace(id, '\D', '', 'g'), '')::int) from public.shipments) as used
    union all select 'warehouse_receipt_seq', pg_sequence_last_value('public.warehouse_receipt_seq'),
           (select max(nullif(regexp_replace(receipt_no, '\D', '', 'g'), '')::int) from public.warehouse_receipts)
    union all select 'sailing_schedule_seq', pg_sequence_last_value('public.sailing_schedule_seq'),
           (select max(nullif(regexp_replace(id::text, '\D', '', 'g'), '')::bigint)::int from public.sailing_schedules where id::text like 'SAIL%')
    union all select 'hawb_seq', pg_sequence_last_value('public.hawb_seq'),
           (select max(nullif(regexp_replace(right(hawb_no, 7), '\D', '', 'g'), '')::int) from public.house_airwaybills)
    union all select 'csn_job_seq', pg_sequence_last_value('public.csn_job_seq'), (select max(job_no) from public.csn_files)
  ) s, lateral (select s.seq, s.at, s.used, coalesce(s.at, 0) >= coalesce(s.used, 0) as ok) x
),
-- ALG/PALG references: the series' next number must be past every reference issued that month.
series as (
  select jsonb_agg(jsonb_build_object('series', r.series, 'yy', r.yy, 'mm', r.mm, 'next', r.next_number, 'max_used', u.max_used))
           filter (where u.max_used >= r.next_number) as behind
    from public.reference_series r
    left join lateral (
      select max(substring(e.ref from '^' || r.series || r.mm || '(\d+)-' || r.yy || '$')::int) as max_used
        from public.enquiries e
    ) u on true
),
-- The stage is the furthest milestone step ticked (066), and a stage step is
-- ticked exactly when its customer milestone is recorded (102).
stage_drift as (
  select jsonb_agg(jsonb_build_object('id', s.id, 'stage', s.stage, 'steps_say', d.stage)) as rows
    from public.shipments s
    left join lateral (
      select c.stage from public.shipment_checkpoints c
       where c.shipment_id = s.id and c.done_at is not null and c.stage is not null
       order by array_position(array['booked','cargo_received','stuffed','gated_in','sailed','arrived','delivered'], c.stage) desc
       limit 1) d on true
   where s.stage <> 'cancelled' and s.stage is distinct from coalesce(d.stage, 'booked')
),
milestone_drift as (
  select jsonb_agg(jsonb_build_object('id', c.shipment_id, 'stage', c.stage, 'step_done', c.done_at is not null, 'milestone_reached', m.reached_on is not null)) as rows
    from public.shipment_checkpoints c
    left join public.shipment_milestones m on m.shipment_id = c.shipment_id and m.stage = c.stage
   where c.stage is not null and (c.done_at is not null) is distinct from (m.reached_on is not null)
),
missing_lists as (
  select jsonb_agg(s.id) filter (where not exists (select 1 from public.shipment_checkpoints c where c.shipment_id = s.id)) as no_steps,
         jsonb_agg(s.id) filter (where not exists (select 1 from public.shipment_milestones m where m.shipment_id = s.id)) as no_milestones
    from public.shipments s
),
-- The pipeline: what the enquiry says against what exists.
pipeline as (
  select
    jsonb_agg(e.ref) filter (where e.status = 'accepted' and not exists (select 1 from public.quotes q where q.enquiry_ref = e.ref and q.status = 'accepted')) as accepted_without_accepted_quote,
    jsonb_agg(e.ref) filter (where exists (select 1 from public.shipments s where s.enquiry_ref = e.ref) and e.status not in ('accepted', 'booked', 'won', 'closed')) as booked_but_status,
    jsonb_agg(distinct e.status) as statuses
    from public.enquiries e
),
quotes_state as (
  select jsonb_agg(jsonb_build_object('id', q.id, 'ref', q.enquiry_ref, 'status', q.status, 'approval', q.approval_status))
           filter (where q.status in ('sent', 'accepted') and coalesce(q.approval_status, 'draft') <> 'approved') as sent_unapproved
    from public.quotes q
),
intake_state as (
  select jsonb_agg(i.id) filter (where i.status = 'promoted' and (i.enquiry_ref is null or not exists (select 1 from public.enquiries e where e.ref = i.enquiry_ref))) as promoted_without_enquiry,
         jsonb_agg(i.id) filter (where i.status = 'new' and i.enquiry_ref is not null) as new_but_linked
    from public.intake i
),
people as (
  select
    (select jsonb_agg(u.email) from auth.users u where not exists (select 1 from public.profiles p where p.id = u.id)) as users_without_profile,
    (select jsonb_agg(p.email) from public.profiles p where not exists (select 1 from auth.users u where u.id = p.id)) as profiles_without_user,
    (select jsonb_agg(jsonb_build_object('email', u.email, 'app_role', u.raw_app_meta_data->>'role', 'profile_role', p.role))
       from auth.users u join public.profiles p on p.id = u.id
      where coalesce(u.raw_app_meta_data->>'role', '') is distinct from coalesce(p.role, '')) as role_mismatch,
    (select jsonb_agg(u.email) from auth.users u where u.banned_until > now()) as disabled
),
-- Files the database points at that storage does not hold.
files as (
  select jsonb_agg(jsonb_build_object('ref', f.enquiry_ref, 'path', f.path)) as missing
    from public.enquiry_files f
   where not exists (select 1 from storage.objects o where o.name = f.path)
),
-- Tables in the public schema without row level security: reachable by any signed-in person, unfiltered.
rls as (
  select jsonb_agg(c.relname) as off
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'r' and not c.relrowsecurity
),
-- Views that ignore RLS (096 set security_invoker on all 14).
views as (
  select jsonb_agg(c.relname) as definer
    from pg_class c
   where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
     and not coalesce((select option_value = 'true' from pg_options_to_table(c.reloptions) where option_name = 'security_invoker'), false)
),
-- New functions get a fixed search_path (096).
paths as (
  select jsonb_agg(p.proname order by p.proname) as unset
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
),
realtime as (
  select count(*) as tables from pg_publication_tables where pubname = 'supabase_realtime'
)
select jsonb_build_object(
  'sequences_checked', (select checked from seqs),
  'sequences_behind', (select behind from seqs),
  'series_behind', (select behind from series),
  'stage_drift', (select rows from stage_drift),
  'milestone_drift', (select rows from milestone_drift),
  'shipments_without_steps', (select no_steps from missing_lists),
  'shipments_without_milestones', (select no_milestones from missing_lists),
  'enquiry_statuses', (select statuses from pipeline),
  'accepted_without_accepted_quote', (select accepted_without_accepted_quote from pipeline),
  'booked_but_status', (select booked_but_status from pipeline),
  'quotes_sent_unapproved', (select sent_unapproved from quotes_state),
  'intake_promoted_without_enquiry', (select promoted_without_enquiry from intake_state),
  'intake_new_but_linked', (select new_but_linked from intake_state),
  'users_without_profile', (select users_without_profile from people),
  'profiles_without_user', (select profiles_without_user from people),
  'role_mismatch', (select role_mismatch from people),
  'disabled_users', (select disabled from people),
  'enquiry_files_missing_in_storage', (select missing from files),
  'tables_without_rls', (select off from rls),
  'views_ignoring_rls', (select definer from views),
  'definer_functions_without_search_path', (select unset from paths),
  'realtime_tables', (select tables from realtime)
) as report;
