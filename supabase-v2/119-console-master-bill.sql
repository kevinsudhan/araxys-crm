-- 119: The master B/L of a console, from the instruction to the line to its release.
--
-- ---------------------------------------------------------------------------
-- A console is one master B/L with the house bills under it (consoles, 061).
-- The console held the master's number, date and carrier, and nothing of how
-- it came to exist: what the desk instructed the line to print, the line's
-- draft and whether it was right, how it is released, and when.
--
--   carrier_booking_no   The line's booking number for the box(es).
--   mbl_si               What the desk instructs the line to print, as the
--                        desk edited it: parties, freight terms, description
--                        (lib/masterBill.ts `SiTerms`). The boxes and totals
--                        are read from the jobs each time, never stored here.
--   mbl_stage            none → si_sent → draft_received → draft_approved →
--                        issued → released. Moves forward as the desk acts;
--                        set back only by the desk (a corrected draft).
--   si_sent_at / si_sent_to          The instruction mailed, and to whom.
--   mbl_draft / mbl_draft_at         The line's draft as read, and when.
--   mbl_draft_approved_at            The draft agreed with the instruction.
--   mbl_release / mbl_originals      Originals (with how many), telex
--                                    release, sea waybill, or electronic B/L.
--   mbl_released_at / mbl_release_ref
--                        When it was released to the destination agent, and
--                        the reference: the courier's airway bill for
--                        originals, the line's telex release number, the
--                        eBL platform's transfer reference.
-- ---------------------------------------------------------------------------

alter table public.consoles add column if not exists carrier_booking_no text not null default '';
alter table public.consoles add column if not exists mbl_si jsonb;
alter table public.consoles add column if not exists mbl_stage text not null default 'none';
alter table public.consoles drop constraint if exists consoles_mbl_stage_check;
alter table public.consoles add constraint consoles_mbl_stage_check
  check (mbl_stage in ('none', 'si_sent', 'draft_received', 'draft_approved', 'issued', 'released'));
alter table public.consoles add column if not exists si_sent_at timestamptz;
alter table public.consoles add column if not exists si_sent_to text not null default '';
alter table public.consoles add column if not exists mbl_draft jsonb;
alter table public.consoles add column if not exists mbl_draft_at timestamptz;
alter table public.consoles add column if not exists mbl_draft_approved_at timestamptz;
alter table public.consoles add column if not exists mbl_release text;
alter table public.consoles drop constraint if exists consoles_mbl_release_check;
alter table public.consoles add constraint consoles_mbl_release_check
  check (mbl_release is null or mbl_release in ('original', 'telex', 'seaway', 'ebl'));
alter table public.consoles add column if not exists mbl_originals integer;
alter table public.consoles drop constraint if exists consoles_mbl_originals_check;
alter table public.consoles add constraint consoles_mbl_originals_check
  check (mbl_originals is null or mbl_originals between 0 and 3);
alter table public.consoles add column if not exists mbl_released_at timestamptz;
alter table public.consoles add column if not exists mbl_release_ref text not null default '';

notify pgrst, 'reload schema';
