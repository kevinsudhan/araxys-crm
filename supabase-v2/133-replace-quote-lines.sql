-- ---------------------------------------------------------------------------
-- 133: A pasted rate replaces a draft's charges in one step.
--
-- "Paste a new rate" on a draft deleted its charges, then added the new ones
-- in a second call (106). A failure between the two — a dropped connection,
-- a charge the database refused — left the draft with no charges at all, and
-- the desk with nothing to go back to. This does both together: all of the
-- new charges in place of the old, or nothing changed.
--
-- As the signed-in person (security invoker), so the table's own rules apply
-- exactly as they do to the two calls it replaces. Only a draft: a sent
-- quotation's charges are what the customer has, and a new rate on one is
-- its next version.
-- ---------------------------------------------------------------------------
create or replace function public.replace_quote_lines(p_quote uuid, p_lines jsonb)
returns int
language plpgsql
security invoker
set search_path = public
as $fn$
declare
  v_status text;
  v_n      int;
begin
  select status into v_status from public.quotes where id = p_quote for update;
  if not found then
    raise exception 'No quotation %', p_quote;
  end if;
  if v_status <> 'draft' then
    raise exception 'Only a draft''s charges are replaced; this quotation is %', v_status
      using hint = 'A new rate on a sent quotation becomes its next version.';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'No charges to put in';
  end if;

  delete from public.quote_lines where quote_id = p_quote;

  insert into public.quote_lines (quote_id, position, description, currency, fx_rate, unit, quantity, rate, section, gst_rate)
  select p_quote, l.position, l.description, l.currency, l.fx_rate, l.unit, l.quantity, l.rate, l.section, l.gst_rate
    from jsonb_to_recordset(p_lines) as l(
      position int, description text, currency text, fx_rate numeric, unit text,
      quantity numeric, rate numeric, section text, gst_rate numeric
    );
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

revoke execute on function public.replace_quote_lines(uuid, jsonb) from public, anon;
grant execute on function public.replace_quote_lines(uuid, jsonb) to authenticated;
