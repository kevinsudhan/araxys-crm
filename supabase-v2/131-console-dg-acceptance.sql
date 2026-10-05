-- ---------------------------------------------------------------------------
-- 131: Accepting dangerous goods into a console.
--
-- A DG house cannot just be put in the box. Before it goes in, the console
-- desk needs the shipper's signed DG declaration, the safety data sheet (in
-- English, and recent: most lines want it under five years old), the line's
-- DG approval for it — the co-loader's on space bought from one — and the
-- house kept apart from every other DG house in the box as the IMDG Code's
-- segregation table says. The UN number, class, packing group and flash point
-- are the job's facts and stay on the enquiry (046, 065); this is the
-- acceptance.
--
-- The checks are lib/dgAcceptance.ts. The database keeps the record, refuses
-- an acceptance without the papers, and forgets it when the cargo or the
-- console it was accepted into changes.
-- ---------------------------------------------------------------------------

alter table public.shipments
  -- The date on the safety data sheet (its issue or last revision).
  add column if not exists msds_date          date,
  -- The shipper's signed dangerous goods declaration, in hand.
  add column if not exists dg_declaration_at  timestamptz,
  -- The line's DG approval for it, or the co-loader's acceptance.
  add column if not exists dg_line_ref        text,
  -- Accepted into the console, by whom, with anything said.
  add column if not exists dg_accepted_at     timestamptz,
  add column if not exists dg_accepted_by     uuid references auth.users(id),
  add column if not exists dg_accept_note     text;


-- ---------------------------------------------------------------------------
-- What was accepted is that cargo, into that console. A different class or UN
-- number, or another console, is a new question.
-- ---------------------------------------------------------------------------
create or replace function public.dg_acceptance_follows()
returns trigger
language plpgsql
as $fn$
begin
  if new.dg_accepted_at is not null
     and row(new.un_number, new.imo_class, new.packing_group, new.console_id)
         is distinct from row(old.un_number, old.imo_class, old.packing_group, old.console_id)
  then
    new.dg_accepted_at := null;
    new.dg_accepted_by := null;
    new.dg_accept_note := null;
  end if;
  -- Accepting goes through accept_dg_house(), which checks the papers.
  if current_user in ('authenticated', 'anon')
     and new.dg_accepted_at is not null
     and new.dg_accepted_at is distinct from old.dg_accepted_at
  then
    raise exception 'accept a DG house from its console''s Dangerous goods section';
  end if;
  return new;
end $fn$;

drop trigger if exists shipments_dg_acceptance on public.shipments;
create trigger shipments_dg_acceptance
  before update on public.shipments
  for each row execute function public.dg_acceptance_follows();


-- ---------------------------------------------------------------------------
-- Accepting one. The screen has checked the segregation against the other DG
-- houses; this refuses what no screen should let through.
-- ---------------------------------------------------------------------------
create or replace function public.accept_dg_house(p_shipment text, p_note text default null)
returns public.shipments
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_s   public.shipments;
  v_cls text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first';
  end if;
  select * into v_s from public.shipments where id = p_shipment for update;
  if not found then
    raise exception 'No job %', p_shipment;
  end if;
  if v_s.console_id is null then
    raise exception '% is on no console', p_shipment;
  end if;

  v_cls := btrim(regexp_replace(coalesce(v_s.imo_class, ''), '^(class|cl\.?)\s*', '', 'i'));
  if v_cls = '' then
    raise exception 'No IMO class on %', p_shipment;
  end if;
  if v_cls ~ '^1(\.|$)' or v_cls in ('6.2', '7') then
    raise exception 'Class % is not taken in a consolidation', v_cls;
  end if;
  if coalesce(v_s.un_number, '') !~* '^\s*(UN)?\s*[0-9]{4}\s*$' then
    raise exception 'No UN number on %', p_shipment;
  end if;
  if v_s.msds_provided is not true then
    raise exception 'The safety data sheet is not in hand';
  end if;
  if v_s.msds_date is not null and v_s.msds_date < (current_date - interval '5 years') then
    raise exception 'The safety data sheet is more than five years old';
  end if;
  if v_s.dg_declaration_at is null then
    raise exception 'The shipper''s DG declaration is not in hand';
  end if;
  if coalesce(btrim(v_s.dg_line_ref), '') = '' then
    raise exception 'No DG approval from the line';
  end if;

  -- As the table owner, past the guard above.
  update public.shipments
     set dg_accepted_at = now(),
         dg_accepted_by = auth.uid(),
         dg_accept_note = nullif(btrim(coalesce(p_note, '')), ''),
         updated_at = now()
   where id = p_shipment
  returning * into v_s;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  select v_s.enquiry_ref, 'dg_accepted',
         format('Dangerous goods accepted into the console: %s, class %s', upper(btrim(v_s.un_number)), v_cls),
         jsonb_build_object('shipment_id', v_s.id, 'console_id', v_s.console_id, 'line_ref', v_s.dg_line_ref),
         auth.uid()
   where v_s.enquiry_ref is not null;

  return v_s;
end $fn$;

revoke execute on function public.accept_dg_house(text, text) from public, anon;
grant execute on function public.accept_dg_house(text, text) to authenticated;

-- Taking an acceptance back is a plain update (nulls pass the guard).
