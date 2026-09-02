-- Calls deliberately kept out of the CRM.
--
-- SnapServe will not delete a call -- DELETE /calls/{id} answers 404 and the
-- call survives -- so "remove this call" has to mean "never import it again".
-- Deleting the row alone would not do it: the next ingest would find it on the
-- account and put it straight back.
--
-- This is how a test call gets cleared so the same number can be used again
-- from a clean slate.

create table if not exists public.suppressed_calls (
  call_id     text primary key,
  reason      text not null default '',
  suppressed_by uuid references auth.users(id),
  suppressed_at timestamptz not null default now()
);

alter table public.suppressed_calls enable row level security;

drop policy if exists suppressed_calls_read on public.suppressed_calls;
create policy suppressed_calls_read on public.suppressed_calls
  for select to authenticated using (true);

drop policy if exists suppressed_calls_insert on public.suppressed_calls;
create policy suppressed_calls_insert on public.suppressed_calls
  for insert to authenticated with check (true);

drop policy if exists suppressed_calls_delete on public.suppressed_calls;
create policy suppressed_calls_delete on public.suppressed_calls
  for delete to authenticated using (true);

-- ---------------------------------------------------------------------------
-- Forget a call: suppress it, then remove what it left behind.
--
-- Order matters. The suppression is written first, so an ingest running in the
-- same moment cannot re-import the call between the delete and the guard being
-- in place -- which is exactly the race that made wiping a caller unreliable in
-- v1 until the cutoff was written before the deletion rather than after.
-- ---------------------------------------------------------------------------
create or replace function public.forget_call(p_call_id text, p_reason text default '')
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_enquiry text;
  v_removed_enquiry boolean := false;
begin
  insert into public.suppressed_calls (call_id, reason, suppressed_by)
  values (p_call_id, coalesce(p_reason, ''), auth.uid())
  on conflict (call_id) do nothing;

  select enquiry_ref into v_enquiry from public.calls where call_id = p_call_id;

  delete from public.calls where call_id = p_call_id;

  -- An enquiry this call opened, that nothing else has happened on, goes with
  -- it. One that has been quoted or worked on is somebody's real work and stays
  -- whatever the call did.
  if v_enquiry is not null then
    delete from public.enquiry_events
     where enquiry_ref = v_enquiry
       and detail->>'call_id' = p_call_id;

    delete from public.enquiries e
     where e.ref = v_enquiry
       and e.source = 'call'
       and e.status in ('new', 'qualifying')
       and not exists (select 1 from public.quotes q where q.enquiry_ref = e.ref)
       and not exists (select 1 from public.calls c where c.enquiry_ref = e.ref)
       and not exists (select 1 from public.shipments s where s.enquiry_ref = e.ref);

    get diagnostics v_removed_enquiry = row_count;
  end if;

  -- A customer invented purely to hold this caller, now with nothing attached.
  delete from public.customers c
   where c.name like 'Caller %'
     and not exists (select 1 from public.enquiries e where e.customer_id = c.id)
     and not exists (select 1 from public.calls k where k.customer_id = c.id);

  return jsonb_build_object(
    'call_id', p_call_id,
    'suppressed', true,
    'enquiry_removed', v_removed_enquiry,
    'enquiry_ref', v_enquiry
  );
end $fn$;

grant execute on function public.forget_call(text, text) to authenticated;
