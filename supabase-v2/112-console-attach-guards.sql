-- 112: What can go on a console (Operations sweep, 1 Oct).
--
-- attach_to_console took any shipment: an AIR job went onto a sea LCL console
-- (consoles are sea only: LCL or FCL), an import onto an export console, and a
-- cancelled or signed-off job too. A job moved from one console to another was
-- recorded only as "Put on console CON/2", so the first console's history said
-- it was still there.
--
-- Now: sea jobs only; the direction must agree when both are known (a
-- cross-trade console takes either); not cancelled, not signed off; choosing
-- the console it is already on changes nothing; and a move says where from.

create or replace function public.attach_to_console(p_shipment text, p_console uuid)
returns public.shipments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_con  public.consoles;
  v_old  public.consoles;
  v_ship public.shipments;
  v_row  public.shipments;
begin
  if auth.uid() is null then
    raise exception 'not signed in';
  end if;

  select * into v_con from public.consoles where id = p_console;
  if not found then
    raise exception 'No console %', p_console;
  end if;
  if v_con.status in ('sailed', 'arrived', 'cancelled') then
    raise exception 'Console % has already %', v_con.console_no, v_con.status
      using hint = 'Cargo cannot be added to a console that has gone.';
  end if;

  select * into v_ship from public.shipments where id = p_shipment for update;
  if not found then
    raise exception 'No shipment %', p_shipment;
  end if;
  if v_ship.console_id = p_console then
    return v_ship;
  end if;
  if v_ship.signed_off_at is not null then
    raise exception '% is signed off; an admin has to reopen it first', p_shipment;
  end if;
  if v_ship.stage = 'cancelled' or v_ship.cancelled_at is not null then
    raise exception '% is cancelled', p_shipment;
  end if;
  if v_ship.transport_mode is not null and v_ship.transport_mode not in ('sea_lcl', 'sea_fcl') then
    raise exception '% travels by %, and a console is a sea consolidation', p_shipment, replace(v_ship.transport_mode, '_', ' ')
      using hint = 'An air consol is kept on the HAWB and its MAWB, not on a console.';
  end if;
  if v_ship.trade_direction is not null and v_con.direction <> 'cross_trade'
     and v_ship.trade_direction <> v_con.direction then
    raise exception '% is an %, and console % is an %', p_shipment, v_ship.trade_direction, v_con.console_no, v_con.direction;
  end if;

  if v_ship.console_id is not null then
    select * into v_old from public.consoles where id = v_ship.console_id;
  end if;

  update public.shipments
     set console_id  = p_console,
         -- The console knows the voyage. Carried across so the shipment's own
         -- documents read the same as the manifest rather than being filled in
         -- twice and disagreeing.
         vessel      = coalesce(nullif(v_con.vessel, ''), vessel),
         voyage      = coalesce(nullif(v_con.voyage, ''), voyage),
         carrier     = coalesce(nullif(v_con.carrier, ''), carrier),
         etd         = coalesce(v_con.etd, etd),
         eta         = coalesce(v_con.eta, eta),
         -- The master bill, once the console has one (082); the old console's
         -- master leaves with it.
         mainline_no = coalesce(nullif(v_con.mbl_number, ''),
                                case when v_old.id is not null and mainline_no = nullif(v_old.mbl_number, '') then null else mainline_no end),
         updated_at  = now()
   where id = p_shipment
  returning * into v_row;

  insert into public.enquiry_events (enquiry_ref, kind, summary, detail, actor)
  values (v_row.enquiry_ref, 'console_attached',
          case when v_old.id is not null
               then format('Moved from console %s to %s', v_old.console_no, v_con.console_no)
               else format('Put on console %s', v_con.console_no) end
            || coalesce(' (MBL ' || nullif(v_con.mbl_number, '') || ')', ''),
          jsonb_build_object('console_id', p_console, 'console_no', v_con.console_no,
                             'mbl_number', nullif(v_con.mbl_number, ''),
                             'from_console_id', v_old.id, 'from_console_no', v_old.console_no),
          auth.uid());

  return v_row;
end $$;

revoke execute on function public.attach_to_console(text, uuid) from public, anon;
grant execute on function public.attach_to_console(text, uuid) to authenticated;
