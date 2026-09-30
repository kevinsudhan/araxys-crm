-- 113: A rate finds the enquiry it is for (Operations sweep, 1 Oct).
--
-- rates_for matched a rate's origin and destination to the enquiry's by exact
-- text. Enquiries read "Chennai (MAA)" and "Jebel Ali / Dubai, UAE" — how the
-- mail reader writes them — so a rate kept for "Chennai" or "Dubai" was never
-- found, and "fill from the rate master" came back empty on exactly the lanes
-- the desk quotes.
--
-- Places now match on their words: every word of one is among the words of
-- the other, either way round. "Chennai" matches "Chennai (MAA)", "MAA" does
-- too, "Dubai" matches "Jebel Ali / Dubai, UAE", and "Chennai (MAA)" matches
-- an enquiry that says only "Chennai". A null on either side is still a
-- wildcard, and the specificity that ranks them is unchanged.

create or replace function public.place_words(p text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(w order by w), '{}')
    from regexp_split_to_table(lower(coalesce(p, '')), '[^[:alnum:]]+') as w
   where w <> ''
$$;

create or replace function public.place_matches(p_rate text, p_asked text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_rate is null
      or p_asked is null
      or lower(btrim(p_rate)) = lower(btrim(p_asked))
      or (cardinality(public.place_words(p_rate)) > 0 and cardinality(public.place_words(p_asked)) > 0
          and (public.place_words(p_rate) <@ public.place_words(p_asked)
               or public.place_words(p_asked) <@ public.place_words(p_rate)))
$$;

create or replace function public.rates_for(
  p_origin text default null,
  p_destination text default null,
  p_mode text default null,
  p_direction text default null,
  p_on date default current_date
)
returns table(id uuid, charge_head text, sac_code text, mode text, direction text, origin text, destination text,
              unit text, currency text, sell_rate numeric, cost_rate numeric, min_amount numeric, partner_id uuid,
              valid_from date, valid_to date, notes text, specificity integer)
language sql
stable
set search_path = ''
as $$
  select r.id, r.charge_head, r.sac_code, r.mode, r.direction, r.origin, r.destination,
         r.unit, r.currency, r.sell_rate, r.cost_rate, r.min_amount, r.partner_id,
         r.valid_from, r.valid_to, r.notes,
         -- Two points for naming a place, one for naming a mode or a
         -- direction. A row written for this exact lane therefore always beats
         -- one written for the mode in general, which is the order people mean.
         ((case when r.origin      is not null then 2 else 0 end) +
          (case when r.destination is not null then 2 else 0 end) +
          (case when r.mode        is not null then 1 else 0 end) +
          (case when r.direction   is not null then 1 else 0 end))::int as specificity
    from public.rate_cards r
   where r.active
     and public.place_matches(r.origin, p_origin)
     and public.place_matches(r.destination, p_destination)
     and (r.mode        is null or p_mode        is null or r.mode      = p_mode)
     and (r.direction   is null or p_direction   is null or r.direction = p_direction)
     and (r.valid_from is null or r.valid_from <= p_on)
     and (r.valid_to   is null or r.valid_to   >= p_on)
   order by specificity desc, r.updated_at desc;
$$;

revoke execute on function public.place_words(text) from public, anon;
revoke execute on function public.place_matches(text, text) from public, anon;
revoke execute on function public.rates_for(text, text, text, text, date) from public, anon;
grant execute on function public.rates_for(text, text, text, text, date) to authenticated;
