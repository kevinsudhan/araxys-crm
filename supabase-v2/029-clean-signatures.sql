-- ---------------------------------------------------------------------------
-- Repairing signatures the editor let through.
--
-- WHAT HAPPENED
--
-- The rich-text sanitiser allowed the `style` attribute by name and never read
-- its value, so a paste out of any Tailwind-styled page carried the whole
-- --tw-* custom property block through. A pasted style REPLACES the attribute,
-- which took `max-width:220px` off the signature image with it — and Outlook
-- renders an unconstrained image at its intrinsic size, so Parasu's signature
-- arrived enormous.
--
-- The sanitiser now reads the declarations and forces a max-width onto every
-- image. This repairs what it already stored: new saves are clean, and these
-- rows would otherwise stay broken until somebody re-edited them by hand.
--
-- WHY REGEX AND NOT A PARSER
--
-- There is no HTML parser in Postgres, and the target is narrow and literal:
-- one attribute, one well-known prefix. The alternative is asking four people
-- to rebuild their signature.
-- ---------------------------------------------------------------------------

-- 1. Strip any style attribute that is carrying custom properties. They cannot
--    do anything in a mail client, and every one of them here is noise.
update public.profiles
   set signature = regexp_replace(signature, '\s*style="[^"]*--tw-[^"]*"', '', 'g')
 where signature is not null
   and signature like '%--tw-%';

-- 2. Put the constraint back on any image that now has no style at all.
update public.profiles
   set signature = regexp_replace(
         signature,
         '(<img\s)((?![^>]*style=)[^>]*>)',
         '\1style="max-width:220px;height:auto" \2',
         'g')
 where signature is not null
   and signature ~* '<img'
   and signature !~* '<img[^>]*max-width';

select jsonb_pretty(jsonb_agg(jsonb_build_object(
  'email', email,
  'len', length(coalesce(signature,'')),
  'tw_vars', coalesce(signature,'') like '%--tw-%',
  'imgs_without_maxwidth',
    (select count(*) from regexp_matches(coalesce(signature,''), '<img(?![^>]*max-width)[^>]*>', 'g'))
) order by email)) as after
from public.profiles where coalesce(signature,'') <> '';
