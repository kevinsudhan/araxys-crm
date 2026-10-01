-- 116: Every partner says which country they are in.
--
-- ---------------------------------------------------------------------------
-- WHY
--
-- Live rates now lists the partners by country (Taiwan → the agents there →
-- one of them, and the mail with them), so a partner with no country is one
-- the desk cannot find there. The user's rule (1 Oct 2026): giving the country
-- is mandatory when a partner is added.
--
-- WHAT THE DATABASE HOLDS TO
--
-- A new partner must have a country, and a country once given cannot be
-- blanked. Partners saved before this keep their empty country until somebody
-- edits them (the form asks for it then too); Live rates lists them under
-- "Country not set" with a link to do so. The spelling is the form's job: it
-- reads what is typed against one list (src/lib/countries.ts) and saves that
-- list's name, so "taiwan", "TW" and "Taiwan, ROC" are one group.
--
-- The rule is a trigger and not a CHECK, because a CHECK would refuse every
-- update of an old partner -- archiving one included -- until a country was
-- invented for it.
-- ---------------------------------------------------------------------------

alter table public.partners
  add column if not exists country text not null default '';

create or replace function public.guard_partner_country()
returns trigger
language plpgsql
set search_path = ''
as $fn$
begin
  new.country := btrim(coalesce(new.country, ''));
  if new.country = '' and (tg_op = 'INSERT' or btrim(old.country) <> '') then
    raise exception 'Say which country this partner is in'
      using hint = 'Live rates lists partners by country, so every new partner needs one.';
  end if;
  return new;
end $fn$;

revoke execute on function public.guard_partner_country() from public, anon, authenticated;

drop trigger if exists partners_country_required on public.partners;
create trigger partners_country_required
  before insert or update on public.partners
  for each row execute function public.guard_partner_country();
