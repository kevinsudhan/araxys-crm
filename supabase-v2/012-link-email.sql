-- The mirror of link_phone_to_customer.
--
-- An address heard on a call is the bridge to that customer's mail, so it goes
-- onto the record as soon as it is offered. Added rather than replacing what is
-- already there: a company has more than one person, and a second address is
-- another way to reach the same customer, not a correction of the first.

create or replace function public.link_email_to_customer(
  p_customer_id text,
  p_email       text
) returns public.customers
language plpgsql
security definer
set search_path = public
as $fn$
declare v_row public.customers;
begin
  update public.customers
     set emails = case
                    when lower(p_email) = any (select lower(unnest(emails))) then emails
                    else array_append(emails, lower(p_email))
                  end,
         updated_at = now()
   where id = p_customer_id
  returning * into v_row;

  return v_row;
end $fn$;

grant execute on function public.link_email_to_customer(text, text) to authenticated;
